#!/usr/bin/env python3
"""
digitalfire_scrape_live.py - scrapes live digitalfire.com pages directly
and extracts factual ceramic chemistry data into JSON.

Targets only sections where the archived HTML was incomplete:
  minerals, recipes, temperatures (and optionally materials/oxides)

Usage:
    python digitalfire_scrape_live.py --section minerals
    python digitalfire_scrape_live.py --section all
    python digitalfire_scrape_live.py --section recipes,temperatures,minerals
"""

from __future__ import annotations

import argparse
import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE = "https://digitalfire.com"
OUT = Path("app/public/data")
OUT.mkdir(parents=True, exist_ok=True)

SECTION_LIST_URLS = {
    "minerals":     f"{BASE}/mineral/index.html",
    "recipes":      f"{BASE}/recipe/index.html",
    "temperatures": f"{BASE}/temperature/index.html",
    "materials":    f"{BASE}/material/index.html",
    "oxides":       f"{BASE}/oxide/index.html",
}

# How long to wait between requests (be polite)
DELAY = 0.4

try:
    import lxml  # noqa: F401
    PARSER = "lxml"
except Exception:
    PARSER = "html.parser"

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": "Mozilla/5.0 (compatible; digitalfire-archive-bot/1.0; preservation project)"
})


# ── fetch helpers ─────────────────────────────────────────────────────────────

def fetch(url: str, retries: int = 3) -> str | None:
    for attempt in range(retries):
        try:
            r = SESSION.get(url, timeout=20)
            if r.status_code == 200:
                return r.text
            if r.status_code == 429:
                wait = 5 * (attempt + 1)
                print(f"  Rate limited, waiting {wait}s...")
                time.sleep(wait)
            elif r.status_code == 404:
                return None
        except requests.RequestException as e:
            print(f"  Error fetching {url}: {e}")
            time.sleep(2 ** attempt)
    return None


def get_links_from_list_page(url: str, section: str) -> list[str]:
    """Fetch the index page and extract all individual page URLs."""
    html = fetch(url)
    if not html:
        # Try alternate URL patterns
        alt = f"{BASE}/{section}/list"
        html = fetch(alt)
    if not html:
        print(f"  Could not fetch list page: {url}")
        return []

    soup = BeautifulSoup(html, PARSER)
    links = []
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if f"/{section}/" in href and href != f"/{section}/":
            full = href if href.startswith("http") else f"{BASE}{href}"
            if full not in links:
                links.append(full)
    print(f"  Found {len(links)} links on list page")
    return links


# ── parsers ───────────────────────────────────────────────────────────────────

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
    analysis = []
    oxide_weight = formula_weight = None
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


def parse_data_table(soup, heading="Data"):
    props = {}
    h = soup.find(lambda t: t.name in ("h3", "h4") and clean(t.get_text()) == heading)
    if h:
        table = h.find_next("table", class_="table-bordered")
        if table:
            for tr in table.find_all("tr"):
                th, td = tr.find("th"), tr.find("td")
                if th and td:
                    props[clean(th.get_text())] = clean(td.get_text())
    return props


def parse_mineral(soup, url):
    h1 = soup.find("h1")
    if not h1:
        return None
    name = clean(h1.get_text())
    if not name or len(name) < 2:
        return None
    formula = first_next_p(h1, lambda t: t.lower().startswith("formula:"))
    formula = formula.split(":", 1)[1].strip() if formula else None
    analysis, ow, fw = parse_oxide_analysis(soup)
    slug = url.rstrip("/").split("/")[-1].replace(".html", "")
    return {
        "id": slug, "name": name, "formula": formula,
        "analysis": analysis, "oxide_weight": ow, "formula_weight": fw,
        "data": parse_data_table(soup), "source": "digitalfire.com",
    }


def parse_recipe(soup, url):
    h1 = soup.find("h1")
    if not h1:
        return None
    heading = clean(h1.get_text())
    code, name = (heading.split(" - ", 1) + [""])[:2] if " - " in heading else (heading, "")
    if not code:
        return None
    description = first_next_p(
        h1, lambda t: bool(t) and not t.lower().startswith("modified")
        and not t.lower().startswith("all recipe"))
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
    slug = url.rstrip("/").split("/")[-1].replace(".html", "")
    return {
        "id": slug, "code": clean(code), "name": clean(name),
        "description": description, "materials": materials,
        "source": "digitalfire.com",
    }


def parse_temperature(soup, url):
    h1 = soup.find("h1")
    if not h1:
        return None
    value = clean(h1.get_text())
    if not value:
        return None
    h4 = soup.find("h4", class_="text-muted")
    event = clean(h4.get_text()) if h4 else None
    # fallback: first meaningful p after h1
    if not event:
        event = first_next_p(h1, lambda t: len(t) > 5)
    slug = url.rstrip("/").split("/")[-1].replace(".html", "")
    return {
        "id": slug, "value": value, "event": event,
        "source": "digitalfire.com",
    }


def parse_material(soup, url):
    h1 = soup.find("h1")
    if not h1:
        return None
    name = clean(h1.get_text())
    if not name:
        return None
    alt_names = first_next_p(h1, lambda t: t.startswith("Alternate Names"))
    description = first_next_p(h1, lambda t: t.startswith("Description"))
    alt_names = alt_names.split(":", 1)[1].strip() if alt_names else None
    description = description.split(":", 1)[1].strip() if description else None
    analysis, ow, fw = parse_oxide_analysis(soup)
    slug = url.rstrip("/").split("/")[-1].replace(".html", "")
    return {
        "id": slug, "name": name, "alternate_names": alt_names,
        "description": description, "analysis": analysis,
        "oxide_weight": ow, "formula_weight": fw,
        "properties": parse_data_table(soup), "source": "digitalfire.com",
    }


PARSERS = {
    "minerals":     parse_mineral,
    "recipes":      parse_recipe,
    "temperatures": parse_temperature,
    "materials":    parse_material,
}

OUTPUT_NAMES = {
    "minerals":     "minerals",
    "recipes":      "recipes",
    "temperatures": "temperatures",
    "materials":    "materials",
    "oxides":       "oxides",
}


# ── merge with existing JSON (don't lose what we have) ────────────────────────

def load_existing(section: str) -> dict:
    path = OUT / f"{OUTPUT_NAMES[section]}.json"
    if path.exists():
        data = json.loads(path.read_text(encoding="utf-8"))
        return {r["id"]: r for r in data}
    return {}


# ── main ──────────────────────────────────────────────────────────────────────

def scrape_section(section: str):
    print(f"\n── {section} ──")
    list_url = SECTION_LIST_URLS[section]
    links = get_links_from_list_page(list_url, section)
    if not links:
        print(f"  No links found for {section}")
        return

    parse_fn = PARSERS.get(section)
    if not parse_fn:
        print(f"  No parser for {section}")
        return

    existing = load_existing(section)
    print(f"  {len(existing)} existing records to merge with")

    new_count = updated = failed = 0
    for i, url in enumerate(links):
        if (i + 1) % 25 == 0:
            print(f"  {i+1}/{len(links)}...")
        html = fetch(url)
        if not html:
            failed += 1
            continue
        soup = BeautifulSoup(html, PARSER)
        rec = parse_fn(soup, url)
        if not rec:
            failed += 1
            continue
        slug = rec["id"]
        if slug in existing:
            updated += 1
        else:
            new_count += 1
        existing[slug] = rec
        time.sleep(DELAY)

    records = list(existing.values())
    out_path = OUT / f"{OUTPUT_NAMES[section]}.json"
    out_path.write_text(json.dumps(records, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"  Done: {new_count} new, {updated} updated, {failed} failed → {len(records)} total → {out_path}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--section", default="minerals,recipes,temperatures",
                        help="Comma-separated sections or 'all'")
    args = parser.parse_args()

    sections = (
        list(SECTION_LIST_URLS.keys())
        if args.section == "all"
        else [s.strip() for s in args.section.split(",")]
    )

    for section in sections:
        if section not in SECTION_LIST_URLS:
            print(f"Unknown section: {section}. Valid: {list(SECTION_LIST_URLS.keys())}")
            continue
        scrape_section(section)

    print("\nAll done.")


if __name__ == "__main__":
    main()
