/**
 * Cloudflare Pages Function — handles all /api/* routes
 *
 * Routes:
 *   POST /api/auth                        — login with admin password → JWT
 *   GET  /api/overrides                   — public: returns all active overrides
 *   PUT  /api/admin/materials/:id         — upsert material override (auth required)
 *   PUT  /api/admin/recipes/:id           — upsert recipe override (auth required)
 *   POST /api/admin/materials             — create new material (auth required)
 *   POST /api/admin/recipes               — create new recipe (auth required)
 *   DELETE /api/admin/materials/:id       — soft-delete/revert material (auth required)
 *   DELETE /api/admin/recipes/:id         — soft-delete/revert recipe (auth required)
 *   GET  /api/admin/history               — list all edits (auth required)
 *
 * Environment variables (set in Cloudflare Pages dashboard):
 *   ADMIN_PASSWORD   — plain-text admin password (stored only in env, never in D1)
 *   JWT_SECRET       — random string for signing JWTs (min 32 chars)
 */

interface Env {
  DB: D1Database
  ADMIN_PASSWORD: string
  JWT_SECRET: string
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}

function err(msg: string, status = 400) {
  return json({ error: msg }, status)
}

// ── Minimal JWT (HS256 via Web Crypto) ────────────────────────────────────────

async function signJWT(payload: Record<string, unknown>, secret: string): Promise<string> {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=/g, '')
  const body = btoa(JSON.stringify(payload)).replace(/=/g, '')
  const data = `${header}.${body}`
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${data}.${sigB64}`
}

async function verifyJWT(token: string, secret: string): Promise<Record<string, unknown> | null> {
  try {
    const [header, body, sig] = token.split('.')
    const data = `${header}.${body}`
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    )
    const sigBytes = Uint8Array.from(atob(sig.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(data))
    if (!valid) return null
    const payload = JSON.parse(atob(body + '=='))
    if (payload.exp && payload.exp < Date.now() / 1000) return null
    return payload
  } catch {
    return null
  }
}

async function requireAuth(request: Request, env: Env): Promise<Record<string, unknown> | null> {
  const auth = request.headers.get('Authorization') || ''
  const token = auth.replace(/^Bearer\s+/, '')
  if (!token) return null
  return verifyJWT(token, env.JWT_SECRET)
}

// ── D1 bootstrap ──────────────────────────────────────────────────────────────

async function ensureSchema(db: D1Database) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS overrides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      section TEXT NOT NULL,
      record_id TEXT NOT NULL,
      data_json TEXT NOT NULL,
      original_json TEXT,
      is_new INTEGER DEFAULT 0,
      is_deleted INTEGER DEFAULT 0,
      edited_by TEXT DEFAULT 'admin',
      edited_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(section, record_id)
    )
  `)
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function onRequest(ctx: { request: Request; env: Env; params: Record<string, string> }) {
  const { request, env } = ctx
  const url = new URL(request.url)
  const path = url.pathname.replace(/^\/api/, '')
  const method = request.method

  if (method === 'OPTIONS') return new Response(null, { headers: CORS })

  await ensureSchema(env.DB)

  // POST /auth
  if (path === '/auth' && method === 'POST') {
    const body = await request.json<{ password?: string }>().catch(() => ({}))
    if (!body.password || body.password !== env.ADMIN_PASSWORD) {
      return err('Invalid password', 401)
    }
    const token = await signJWT(
      { sub: 'admin', role: 'admin', exp: Math.floor(Date.now() / 1000) + 86400 * 30 },
      env.JWT_SECRET
    )
    return json({ token })
  }

  // GET /overrides — public, returns all active non-deleted overrides
  if (path === '/overrides' && method === 'GET') {
    const rows = await env.DB.prepare(
      'SELECT section, record_id, data_json, is_deleted FROM overrides'
    ).all()
    const result: Record<string, Record<string, unknown>> = {}
    for (const row of rows.results as { section: string; record_id: string; data_json: string; is_deleted: number }[]) {
      if (!result[row.section]) result[row.section] = {}
      if (row.is_deleted) {
        result[row.section][row.record_id] = null  // signals deletion
      } else {
        result[row.section][row.record_id] = JSON.parse(row.data_json)
      }
    }
    return json(result)
  }

  // All /admin/* routes require auth
  const adminMatch = path.match(/^\/admin(?:\/([^/]+))?(?:\/(.+))?$/)
  if (!adminMatch) return err('Not found', 404)

  const user = await requireAuth(request, env)
  if (!user) return err('Unauthorized', 401)

  const [, section, recordId] = adminMatch  // e.g. section='materials', recordId='epk'

  // GET /admin/history
  if (!section && method === 'GET') {
    const rows = await env.DB.prepare(
      'SELECT * FROM overrides ORDER BY edited_at DESC LIMIT 200'
    ).all()
    return json(rows.results)
  }

  // POST /admin/:section — create new record
  if (section && !recordId && method === 'POST') {
    const data = await request.json<Record<string, unknown>>()
    const id = data.id as string
    if (!id) return err('Record must have an id field')
    await env.DB.prepare(
      'INSERT OR REPLACE INTO overrides (section, record_id, data_json, original_json, is_new, is_deleted, edited_at) VALUES (?, ?, ?, NULL, 1, 0, unixepoch())'
    ).bind(section, id, JSON.stringify(data)).run()
    return json({ ok: true, id })
  }

  if (!recordId) return err('Not found', 404)

  // PUT /admin/:section/:id — upsert override
  if (method === 'PUT') {
    const data = await request.json<Record<string, unknown>>()
    const originalJson = url.searchParams.get('original')
    await env.DB.prepare(
      'INSERT INTO overrides (section, record_id, data_json, original_json, is_new, is_deleted, edited_at) VALUES (?, ?, ?, ?, 0, 0, unixepoch()) ON CONFLICT(section, record_id) DO UPDATE SET data_json=excluded.data_json, is_deleted=0, edited_at=unixepoch()'
    ).bind(section, recordId, JSON.stringify(data), originalJson).run()
    return json({ ok: true })
  }

  // DELETE /admin/:section/:id — revert (remove override) or soft-delete new record
  if (method === 'DELETE') {
    const existing = await env.DB.prepare(
      'SELECT is_new FROM overrides WHERE section=? AND record_id=?'
    ).bind(section, recordId).first<{ is_new: number }>()

    if (!existing) return err('No override found for this record', 404)

    if (existing.is_new) {
      // Created via admin — mark as deleted
      await env.DB.prepare(
        'UPDATE overrides SET is_deleted=1, edited_at=unixepoch() WHERE section=? AND record_id=?'
      ).bind(section, recordId).run()
    } else {
      // Override of existing base record — delete the row to revert to base JSON
      await env.DB.prepare(
        'DELETE FROM overrides WHERE section=? AND record_id=?'
      ).bind(section, recordId).run()
    }
    return json({ ok: true, reverted: true })
  }

  return err('Not found', 404)
}
