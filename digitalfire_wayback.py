#!/usr/bin/env python3
"""
digitalfire_wayback.py - finds missing digitalfire.com pages via the
Wayback Machine CDX API and fills gaps in our JSON datasets.

Two modes:
  --audit   : compare Drive archive against Wayback index, log missing pages
  --fill    : fetch missing pages from Wayback and extract data

Usage:
    python digitalfire_wayback.py --audit
    python digitalfire_wayback.py --fill --section minerals
    python digitalfire_wayback.py --fill --section all
"""

from __future__ import annotations

import argparse
import json
import re
import time
from pathlib import Path
from urllib.parse import quote

import requests
from bs4 import BeautifulSoup

CDX_API = "https://web.archive.org/cdx/search/cdx"
WB_BASE = "https://web.archive.org/web"
OUT = Path("app/public/data")
MISSING_LOG = Path("missing_pages.json")

SECTIONS = ["material", "oxide", "mineral", "recipe", "temperature"]

try:
    import lxml  # noqa: F401
    PARSER = "lxml"
except Exception:
    PARSER = "html.parser"

SESSION = requests.Session()
SESSION.headers.update({"User-Agent": "Mozilla/5.0 (compatible; digitalfire-preservation/1.0)"})


# ── CDX helpers ───────────────────────────────────────────────────────────────

def cdx_list_section(section: str) -> list[dict]:
    """Query Wayback CDX for all archived URLs under a section (paginated)."""
    print(f"  Querying CDX for digitalfire.com/{section}/...")
    all_rows: list[dict] = []
    offset = 0
    page_size = 500  # small pages to avoid timeout
    base_params = {
        "url": f"digitalfire.com/{section}/*",
        "output": "json",
        "fl": "original,timestamp,statuscode",
        "collapse": "urlkey",
        "filter": "statuscode:200",
        "limit": page_size,
    }
    while True:
        params = {**base_params, "offset": offset}
        for attempt in range(4):
            try:
                r = SESSION.get(CDX_API, params=params, timeout=90)
                r.raise_for_status()
                break
            except Exception as e:
                wait = 5 * (attempt + 1)
                print(f"    CDX attempt {attempt+1} failed ({e}), retrying in {wait}s...")
                time.sleep(wait)
        else:
            print(f"  CDX gave up for {section} at offset {offset}")
            break
        rows = r.json()
        if not rows or len(rows) <= 1:
            break
        headers = rows[0]
        page = [dict(zip(headers, row)) for row in rows[1:]]
        all_rows.extend(page)
        if len(page) < page_size:
            break
        offset += page_size
        time.sleep(1)  # be polite between pages
    print(f"    → {len(all_rows)} URLs found")
    return all_rows


def wayback_url(original: str, timestamp: str) -> str:
    return f"{WB_BASE}/{timestamp}/{original}"


def fetch(url: str, retries: int = 3) -> str | None:
    for attempt in range(retries):
        try:
            r = SESSION.get(url, timeout=30)
            if r.status_code == 200:
                return r.text
            if r.status_code == 429:
                time.sleep(5 * (attempt + 1))
        except requests.RequestException:
            time.sleep(2 ** attempt)
    return None


# ── parsers (same as other scripts) ──────────────────────────────────────────

def clean(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def num(text):
    if text is None:
        return None
    m = re.search(r"-?\d+(?:\.\d+)?", str(text).replace(",", ""))
    return float(m.group()) if m else None


def first_next_p(h1, predicate):
    for p in h1.find_all_next("p"):
        t = clean(p.get_text())
        if predicate(t):
            return t
    return None


def parse_oxide_analysis(soup):
    analysis, oxide_weight, formula_weight = [], None, None
    for atable in soup.find_all("table", class_="table-sm"):
        found = False
        for tr in atable.find_all("tr"):
            cells = tr.find_all("td")
            if not cells:
                continue
            first = cells[0]
            low = clean(first.get_text()).lower()
            if low.startswith("oxide weight"):
                oxide_weight = num(clean(tr.get_text())); found = True; continue
            if "formula weight" in low:
                formula_weight = num(clean(tr.get_text())); found = True; continue
            link = first.find("a", href=True)
            if not (link and "/oxide/" in link["href"]):
                continue
            analysis.append({
                "oxide": clean(first.get_text()),
                "analysis_pct": num(cells[1].get_text()) if len(cells) > 1 else None,
                "formula": num(cells[2].get_text()) if len(cells) > 2 else None,
                "tolerance": (clean(cells[3].get_text()) or None) if len(cells) > 3 else None,
            })
            found = True
        if found:
            break
    return analysis, oxide_weight, formula_weight


def parse_data_table(soup):
    props = {}
    h = soup.find(lambda t: t.name in ("h3", "h4") and clean(t.get_text()) == "Data")
    if h:
        table = h.find_next("table", class_="table-bordered")
        if table:
            for tr in table.find_all("tr"):
                th, td = tr.find("th"), tr.find("td")
                if th and td:
                    props[clean(th.get_text())] = clean(td.get_text())
    return props


def parse_for_section(section: str, soup: BeautifulSoup, slug: str) -> dict | None:
    h1 = soup.find("h1")
    if not h1:
        return None
    name_raw = clean(h1.get_text())
    if not name_raw or len(name_raw) < 2:
        return None

    base = {"id": slug, "source": "digitalfire.com (wayback)"}

    if section == "oxide":
        m = re.match(r"^(.*?)\s*\((.*)\)\s*$", name_raw)
        symbol, name = (clean(m.group(1)), clean(m.group(2))) if m else (name_raw, "")
        return {**base, "symbol": symbol, "name": name, "data": parse_data_table(soup)}

    if section == "material":
        alt = first_next_p(h1, lambda t: t.startswith("Alternate Names"))
        desc = first_next_p(h1, lambda t: t.startswith("Description"))
        analysis, ow, fw = parse_oxide_analysis(soup)
        return {**base, "name": name_raw,
                "alternate_names": alt.split(":", 1)[1].strip() if alt else None,
                "description": desc.split(":", 1)[1].strip() if desc else None,
                "analysis": analysis, "oxide_weight": ow, "formula_weight": fw,
                "properties": parse_data_table(soup)}

    if section == "mineral":
        formula = first_next_p(h1, lambda t: t.lower().startswith("formula:"))
        analysis, ow, fw = parse_oxide_analysis(soup)
        return {**base, "name": name_raw,
                "formula": formula.split(":", 1)[1].strip() if formula else None,
                "analysis": analysis, "oxide_weight": ow, "formula_weight": fw,
                "data": parse_data_table(soup)}

    if section == "recipe":
        heading = name_raw
        code, rname = (heading.split(" - ", 1) + [""])[:2] if " - " in heading else (heading, "")
        materials = []
        for table in soup.find_all("table", class_="table-sm"):
            for tr in table.find_all("tr"):
                cells = tr.find_all("td")
                if not cells:
                    continue
                link = cells[0].find("a", href=True)
                if not (link and "/material/" in link["href"]):
                    continue
                materials.append({
                    "material": clean(cells[0].get_text()),
                    "amount": num(cells[1].get_text()) if len(cells) > 1 else None,
                    "percent": num(cells[2].get_text()) if len(cells) > 2 else None,
                })
            if materials:
                break
        return {**base, "code": clean(code), "name": clean(rname),
                "source_url": f"https://digitalfire.com/recipe/{slug}",
                "materials": materials}

    if section == "temperature":
        h4 = soup.find("h4", class_="text-muted")
        event = clean(h4.get_text()) if h4 else first_next_p(h1, lambda t: len(t) > 5)
        return {**base, "value": name_raw, "event": event}

    return None


# ── audit mode ────────────────────────────────────────────────────────────────

def audit(sections: list[str] | None = None):
    """Compare what we have vs what Wayback has. Log missing slugs."""
    # load existing log so partial runs accumulate
    existing_log: dict = {}
    if MISSING_LOG.exists():
        try:
            existing_log = json.loads(MISSING_LOG.read_text(encoding="utf-8"))
        except Exception:
            pass

    missing = dict(existing_log)
    for section in (sections or SECTIONS):
        plural = section + "s"
        json_path = OUT / f"{plural}.json"
        have_ids = set()
        if json_path.exists():
            data = json.loads(json_path.read_text(encoding="utf-8"))
            have_ids = {r["id"] for r in data}

        try:
            cdx = cdx_list_section(section)
        except Exception as e:
            print(f"  {section}: CDX query failed ({e}), skipping")
            continue

        wayback_slugs = {}
        for row in cdx:
            url = row["original"]
            slug = url.rstrip("/").split("/")[-1].replace(".html", "")
            if slug and slug not in ("index", "list", ""):
                wayback_slugs[slug] = row

        missing_slugs = {s: r for s, r in wayback_slugs.items() if s not in have_ids}
        print(f"{section:12}: have {len(have_ids):4} | wayback {len(wayback_slugs):4} | missing {len(missing_slugs):4}")
        missing[section] = [
            {"slug": s, "original": r["original"], "timestamp": r["timestamp"]}
            for s, r in missing_slugs.items()
        ]
        # save after each section so partial runs aren't lost
        MISSING_LOG.write_text(json.dumps(missing, indent=2, ensure_ascii=False), encoding="utf-8")
        time.sleep(2)

    total = sum(len(v) for v in missing.values())
    print(f"\nTotal missing: {total} pages logged to {MISSING_LOG}")
    return missing


# ── fill mode ─────────────────────────────────────────────────────────────────

def fill(sections: list[str]):
    """Fetch missing pages from Wayback and merge into JSON."""
    if not MISSING_LOG.exists():
        print("Run --audit first to identify missing pages.")
        return

    missing = json.loads(MISSING_LOG.read_text(encoding="utf-8"))

    for section in sections:
        items = missing.get(section, [])
        if not items:
            print(f"{section}: nothing missing, skipping")
            continue

        plural = section + "s"
        json_path = OUT / f"{plural}.json"
        existing = {}
        if json_path.exists():
            data = json.loads(json_path.read_text(encoding="utf-8"))
            existing = {r["id"]: r for r in data}

        print(f"\n── filling {section} ({len(items)} missing) ──")
        new_count = failed = 0
        for i, item in enumerate(items):
            if (i + 1) % 20 == 0:
                print(f"  {i+1}/{len(items)}...")
            wb_url = wayback_url(item["original"], item["timestamp"])
            html = fetch(wb_url)
            if not html:
                failed += 1
                continue
            soup = BeautifulSoup(html, PARSER)
            rec = parse_for_section(section, soup, item["slug"])
            if not rec:
                failed += 1
                continue
            existing[item["slug"]] = rec
            new_count += 1
            time.sleep(0.5)  # Wayback rate limit

        records = list(existing.values())
        json_path.write_text(json.dumps(records, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"  {new_count} filled, {failed} failed → {len(records)} total")


# ── entry point ───────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--audit", action="store_true", help="Log missing pages")
    parser.add_argument("--fill", action="store_true", help="Fetch missing from Wayback")
    parser.add_argument("--section", default="all",
                        help="Section(s) for --fill: all, material, mineral, recipe, temperature, oxide")
    args = parser.parse_args()

    secs = SECTIONS if args.section == "all" else [s.strip() for s in args.section.split(",")]
    if args.audit:
        audit(None if args.section == "all" else secs)
    elif args.fill:
        fill(secs)
    else:
        print("Run with --audit (find gaps) or --fill (fetch from Wayback)")
        print("Typical workflow:")
        print("  python digitalfire_wayback.py --audit --section mineral,temperature")
        print("  python digitalfire_wayback.py --fill --section mineral,temperature")


if __name__ == "__main__":
    main()
