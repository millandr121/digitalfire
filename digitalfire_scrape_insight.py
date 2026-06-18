#!/usr/bin/env python3
"""
digitalfire_scrape_insight.py - scrapes Insight-Live shared recipes linked
from digitalfire.com/recipe/list and merges them into recipes.json.

These are public share URLs (no login required) that Tony Hansen has linked
from the public digitalfire.com recipe index. Recipe ingredient lists and
amounts are factual data, not subject to copyright.

Usage:
    python digitalfire_scrape_insight.py
    python digitalfire_scrape_insight.py --list-url https://digitalfire.com/recipe/list
"""

from __future__ import annotations

import argparse
import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_DF = "https://digitalfire.com"
BASE_IL = "https://insight-live.com"
OUT = Path("app/public/data")
DELAY = 0.5

try:
    import lxml  # noqa: F401
    PARSER = "lxml"
except Exception:
    PARSER = "html.parser"

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": "Mozilla/5.0 (compatible; digitalfire-archive/1.0; preservation)",
    "Accept": "text/html,application/xhtml+xml",
})


def fetch(url: str, retries: int = 3) -> str | None:
    for attempt in range(retries):
        try:
            r = SESSION.get(url, timeout=20)
            if r.status_code == 200:
                return r.text
            if r.status_code == 429:
                time.sleep(10 * (attempt + 1))
            elif r.status_code == 404:
                return None
        except requests.RequestException as e:
            print(f"  Error: {e}")
            time.sleep(2 ** attempt)
    return None


def clean(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def num(text) -> float | None:
    if text is None:
        return None
    m = re.search(r"-?\d+(?:\.\d+)?", str(text).replace(",", ""))
    return float(m.group()) if m else None


# ── step 1: get all insight-live share URLs from the recipe list ──────────────

def get_insight_links(list_url: str) -> list[dict]:
    """
    Fetch digitalfire.com/recipe/list and return all insight-live share links.
    Returns list of {code, name, share_url}.
    """
    print(f"Fetching recipe list from {list_url}...")
    html = fetch(list_url)
    if not html:
        # fallback to Wayback Machine
        wb = f"https://web.archive.org/web/2026/{list_url}"
        print(f"  Direct fetch failed, trying Wayback: {wb}")
        html = fetch(wb)
    if not html:
        print("  Could not fetch recipe list.")
        return []

    soup = BeautifulSoup(html, PARSER)
    links = []
    seen = set()

    for a in soup.find_all("a", href=True):
        href = a["href"]
        if "insight-live.com/insight/share.php" in href:
            if href in seen:
                continue
            seen.add(href)
            label = clean(a.get_text())
            # label is typically "CODE - Name" or just "Name"
            if " - " in label:
                code, name = label.split(" - ", 1)
            else:
                code, name = label, ""
            links.append({
                "code": clean(code),
                "name": clean(name),
                "share_url": href if href.startswith("http") else f"{BASE_IL}{href}",
            })

    print(f"  Found {len(links)} insight-live share links")
    return links


# ── step 2: parse an insight-live share page ──────────────────────────────────

def parse_insight_share(html: str, meta: dict) -> dict | None:
    soup = BeautifulSoup(html, PARSER)

    # Recipe name/code: try h1 first, fall back to title
    h1 = soup.find("h1")
    heading = clean(h1.get_text()) if h1 else ""
    if not heading:
        title = soup.find("title")
        heading = clean(title.get_text()).split("|")[0].strip() if title else ""

    if heading and " - " in heading:
        code, name = heading.split(" - ", 1)
        code, name = clean(code), clean(name)
    elif heading:
        code, name = clean(meta.get("code", "")), heading
    else:
        code = clean(meta.get("code", ""))
        name = clean(meta.get("name", ""))

    if not code and not name:
        return None

    # Slug from share URL: use the z= param as the id
    z_match = re.search(r"[?&]z=([^&]+)", meta.get("share_url", ""))
    slug = f"il-{z_match.group(1)}" if z_match else re.sub(r"[^a-z0-9]", "-", (code or name).lower())[:40]

    # Materials table: look for table rows with material name + amount columns
    materials = []
    for table in soup.find_all("table"):
        rows = table.find_all("tr")
        candidate = []
        for tr in rows:
            cells = tr.find_all(["td", "th"])
            if len(cells) < 2:
                continue
            cell_text = [clean(c.get_text()) for c in cells]
            # skip header rows
            if any(h in cell_text[0].lower() for h in ("material", "ingredient", "oxide", "name")):
                continue
            amt = num(cell_text[1]) if len(cell_text) > 1 else None
            if amt is not None and cell_text[0] and len(cell_text[0]) > 1:
                pct = num(cell_text[2]) if len(cell_text) > 2 else None
                candidate.append({
                    "material": cell_text[0],
                    "amount": amt,
                    "percent": pct,
                })
        if len(candidate) >= 2:
            materials = candidate
            break

    # If no table found, try <ul>/<li> or definition list patterns
    if not materials:
        for ul in soup.find_all("ul"):
            candidate = []
            for li in ul.find_all("li"):
                t = clean(li.get_text())
                # pattern: "Material Name: 25.0" or "25.0 Material Name"
                m = re.match(r"^(.+?)[\s:]+(\d+(?:\.\d+)?)\s*%?$", t)
                if m:
                    candidate.append({
                        "material": clean(m.group(1)),
                        "amount": float(m.group(2)),
                        "percent": None,
                    })
            if len(candidate) >= 2:
                materials = candidate
                break

    return {
        "id": slug,
        "code": code,
        "name": name,
        "materials": materials,
        "source": "insight-live.com (public share) via digitalfire.com",
    }


# ── main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--list-url", default=f"{BASE_DF}/recipe/list",
                        help="URL of the digitalfire recipe list page")
    parser.add_argument("--out", default=str(OUT), help="Output directory")
    args = parser.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    # Load existing recipes
    recipes_path = out / "recipes.json"
    existing: dict[str, dict] = {}
    if recipes_path.exists():
        data = json.loads(recipes_path.read_text(encoding="utf-8"))
        existing = {r["id"]: r for r in data}
    print(f"Loaded {len(existing)} existing recipes")

    # Get insight-live links
    links = get_insight_links(args.list_url)
    if not links:
        print("No insight-live links found. Trying Wayback snapshot...")
        wb_list = "https://web.archive.org/web/2026/https://digitalfire.com/recipe/list"
        links = get_insight_links(wb_list)

    if not links:
        print("Could not retrieve recipe list.")
        return

    # Fetch and parse each share page
    new_count = updated = failed = skipped = 0
    for i, meta in enumerate(links):
        if (i + 1) % 10 == 0:
            print(f"  {i+1}/{len(links)}...")

        html = fetch(meta["share_url"])
        if not html:
            # try Wayback
            wb = f"https://web.archive.org/web/2026/{meta['share_url']}"
            html = fetch(wb)
        if not html:
            failed += 1
            continue

        rec = parse_insight_share(html, meta)
        if not rec:
            skipped += 1
            continue

        if rec["id"] in existing:
            updated += 1
        else:
            new_count += 1
        existing[rec["id"]] = rec
        time.sleep(DELAY)

    records = list(existing.values())
    recipes_path.write_text(json.dumps(records, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nDone: {new_count} new, {updated} updated, {failed} failed, {skipped} skipped")
    print(f"Total recipes: {len(records)} → {recipes_path}")


if __name__ == "__main__":
    main()
