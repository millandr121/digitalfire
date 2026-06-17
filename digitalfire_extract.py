#!/usr/bin/env python3
"""
digitalfire_extract.py - clean-room factual data extractor for a local
digitalfire.com mirror.

Scope (deliberate): extracts ONLY non-copyrightable factual data --
oxide identities, material/mineral oxide analyses & unity formulas,
glaze recipe formulas (material + amount + percent), firing-event
temperatures, and measured physical properties.

It does NOT copy authored prose ("Notes" / "Related Information"
articles), photographs, or the site's curated arrangement. Source
provenance is recorded for integrity -- it is not stripped.

Requires: beautifulsoup4  (uses lxml if present, else stdlib html.parser)
"""

from __future__ import annotations

import json
import re
import sqlite3
from pathlib import Path

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "data"
OUT.mkdir(exist_ok=True)

SOURCE_NOTE = (
    "Factual data extracted from a local mirror of digitalfire.com, the ceramic "
    "materials reference originally compiled by Tony Hansen. Authored prose and "
    "images are deliberately not included; only non-copyrightable chemical and "
    "physical data is extracted, with source credit retained."
)

try:
    import lxml  # noqa: F401
    PARSER = "lxml"
except Exception:
    PARSER = "html.parser"

# Markers left behind by failed wget captures (timeouts -> 404 / JSON error pages).
BROKEN_MARKERS = ("Failed to parse json", "Operation timed out", "Error 404")


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #

def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def is_broken(html: str) -> bool:
    if any(m in html for m in BROKEN_MARKERS):
        return True
    if html.lower().count("<!doctype html") > 1:   # a clean capture is one document
        return True
    return False


def num(text):
    """Pull a float out of '20.00%' / '190.75'; None if absent."""
    if text is None:
        return None
    m = re.search(r"-?\d+(?:\.\d+)?", text.replace(",", ""))
    return float(m.group()) if m else None


def clean(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def is_slug(stem: str) -> bool:
    return not stem.isdigit()


def parse_data_table(soup, heading="Data"):
    """The '<h3>Data</h3>' physical-property table -> {property: value}."""
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


def parse_oxide_analysis(soup):
    """The unity-formula / % analysis table. Only rows whose first cell links
    to an /oxide/ page are accepted, so Links rows absorbed into a malformed
    (chem-less) table are rejected. Returns (analysis, oxide_wt, formula_wt)."""
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


def first_next_p(h1, predicate):
    """First <p> after the page heading satisfying predicate(text)."""
    for p in h1.find_all_next("p"):
        t = clean(p.get_text())
        if predicate(t):
            return t
    return None


# --------------------------------------------------------------------------- #
# per-type parsers
# --------------------------------------------------------------------------- #

def parse_oxide(soup):
    h1 = soup.find("h1")
    if not h1:
        return None
    heading = clean(h1.get_text())                 # "Bi2O3 (Bismuth Oxide)"
    m = re.match(r"^(.*?)\s*\((.*)\)\s*$", heading)
    symbol, name = (clean(m.group(1)), clean(m.group(2))) if m else (heading, "")
    return {"symbol": symbol, "name": name, "data": parse_data_table(soup)}


def parse_material(soup):
    h1 = soup.find("h1")
    if not h1:
        return None
    name = clean(h1.get_text())
    alt_names = first_next_p(h1, lambda t: t.startswith("Alternate Names"))
    description = first_next_p(h1, lambda t: t.startswith("Description"))
    alt_names = alt_names.split(":", 1)[1].strip() if alt_names else None
    description = description.split(":", 1)[1].strip() if description else None
    analysis, ow, fw = parse_oxide_analysis(soup)
    return {
        "name": name, "alternate_names": alt_names, "description": description,
        "analysis": analysis, "oxide_weight": ow, "formula_weight": fw,
        "properties": parse_data_table(soup),
    }


def parse_mineral(soup):
    h1 = soup.find("h1")
    if not h1:
        return None
    name = clean(h1.get_text())
    formula = first_next_p(h1, lambda t: t.lower().startswith("formula:"))
    formula = formula.split(":", 1)[1].strip() if formula else None
    analysis, ow, fw = parse_oxide_analysis(soup)
    return {
        "name": name, "formula": formula, "analysis": analysis,
        "oxide_weight": ow, "formula_weight": fw, "data": parse_data_table(soup),
    }


def parse_recipe(soup):
    h1 = soup.find("h1")
    if not h1:
        return None
    heading = clean(h1.get_text())                 # "G2896 - Ravenscrag Plum Red Cone 6"
    code, name = (heading.split(" - ", 1) + [""])[:2] if " - " in heading else (heading, "")
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
                continue                           # skip 'Added' separators / totals
            materials.append({
                "material": clean(cells[0].get_text()),
                "amount": num(cells[1].get_text()) if len(cells) > 1 else None,
                "percent": num(cells[2].get_text()) if len(cells) > 2 else None,
            })
        if materials:
            break
    return {"code": clean(code), "name": clean(name),
            "description": description, "materials": materials}


def parse_temperature(soup):
    h1 = soup.find("h1")
    if not h1:
        return None
    h4 = soup.find("h4", class_="text-muted")
    return {"value": clean(h1.get_text()), "event": clean(h4.get_text()) if h4 else None}


# --------------------------------------------------------------------------- #
# directory walk + de-duplication
# --------------------------------------------------------------------------- #

def extract_dir(folder, parse_fn, key_fn):
    base = ROOT / folder
    records = {}
    stats = {"total": 0, "broken": 0, "skipped": 0, "dupes": 0}
    for path in sorted(base.glob("*.html")):
        if path.name == "list.html":
            continue
        stats["total"] += 1
        html = read(path)
        if is_broken(html):
            stats["broken"] += 1
            continue
        rec = parse_fn(BeautifulSoup(html, PARSER))
        if not rec or not key_fn(rec):
            stats["skipped"] += 1
            continue
        rec["id"] = path.stem
        rec["source"] = "digitalfire.com"
        key = key_fn(rec).lower()
        if key in records:
            stats["dupes"] += 1
            if is_slug(path.stem) and not is_slug(records[key]["id"]):
                records[key] = rec
            continue
        records[key] = rec
    stats["kept"] = len(records)
    return list(records.values()), stats


# --------------------------------------------------------------------------- #
# output
# --------------------------------------------------------------------------- #

def write_json(name, records):
    (OUT / f"{name}.json").write_text(
        json.dumps(records, indent=2, ensure_ascii=False), encoding="utf-8")


def build_sqlite(datasets):
    db = OUT / "digitalfire.sqlite"
    if db.exists():
        db.unlink()
    con = sqlite3.connect(db)
    cur = con.cursor()
    cur.executescript("""
        CREATE TABLE oxides(id TEXT PRIMARY KEY, symbol TEXT, name TEXT);
        CREATE TABLE oxide_data(oxide_id TEXT, property TEXT, value TEXT);
        CREATE TABLE materials(id TEXT PRIMARY KEY, name TEXT, alternate_names TEXT,
            description TEXT, oxide_weight REAL, formula_weight REAL);
        CREATE TABLE material_analysis(material_id TEXT, oxide TEXT, analysis_pct REAL,
            formula REAL, tolerance TEXT);
        CREATE TABLE material_data(material_id TEXT, property TEXT, value TEXT);
        CREATE TABLE minerals(id TEXT PRIMARY KEY, name TEXT, formula TEXT,
            oxide_weight REAL, formula_weight REAL);
        CREATE TABLE mineral_analysis(mineral_id TEXT, oxide TEXT, analysis_pct REAL,
            formula REAL, tolerance TEXT);
        CREATE TABLE recipes(id TEXT PRIMARY KEY, code TEXT, name TEXT, description TEXT);
        CREATE TABLE recipe_materials(recipe_id TEXT, material TEXT, amount REAL, percent REAL);
        CREATE TABLE temperatures(id TEXT PRIMARY KEY, value TEXT, event TEXT);
    """)
    for o in datasets["oxides"]:
        cur.execute("INSERT INTO oxides VALUES(?,?,?)", (o["id"], o["symbol"], o["name"]))
        for k, v in o["data"].items():
            cur.execute("INSERT INTO oxide_data VALUES(?,?,?)", (o["id"], k, v))
    for m in datasets["materials"]:
        cur.execute("INSERT INTO materials VALUES(?,?,?,?,?,?)", (
            m["id"], m["name"], m["alternate_names"], m["description"],
            m["oxide_weight"], m["formula_weight"]))
        for a in m["analysis"]:
            cur.execute("INSERT INTO material_analysis VALUES(?,?,?,?,?)", (
                m["id"], a["oxide"], a["analysis_pct"], a["formula"], a["tolerance"]))
        for k, v in m["properties"].items():
            cur.execute("INSERT INTO material_data VALUES(?,?,?)", (m["id"], k, v))
    for m in datasets["minerals"]:
        cur.execute("INSERT INTO minerals VALUES(?,?,?,?,?)", (
            m["id"], m["name"], m["formula"], m["oxide_weight"], m["formula_weight"]))
        for a in m["analysis"]:
            cur.execute("INSERT INTO mineral_analysis VALUES(?,?,?,?,?)", (
                m["id"], a["oxide"], a["analysis_pct"], a["formula"], a["tolerance"]))
    for r in datasets["recipes"]:
        cur.execute("INSERT INTO recipes VALUES(?,?,?,?)", (
            r["id"], r["code"], r["name"], r["description"]))
        for x in r["materials"]:
            cur.execute("INSERT INTO recipe_materials VALUES(?,?,?,?)", (
                r["id"], x["material"], x["amount"], x["percent"]))
    for t in datasets["temperatures"]:
        cur.execute("INSERT INTO temperatures VALUES(?,?,?)", (t["id"], t["value"], t["event"]))
    con.commit()
    con.close()


def main():
    datasets = {}
    plan = [
        ("oxides", "oxide", parse_oxide, lambda r: r["symbol"]),
        ("materials", "material", parse_material, lambda r: r["name"]),
        ("minerals", "mineral", parse_mineral, lambda r: r["name"]),
        ("recipes", "recipe", parse_recipe, lambda r: r["code"] or r["name"]),
        ("temperatures", "temperature", parse_temperature,
         lambda r: f"{r['value']}|{r['event'] or ''}"),
    ]
    for name, folder, fn, key in plan:
        records, stats = extract_dir(folder, fn, key)
        datasets[name] = records
        write_json(name, records)
        print(f"{name:13} -> {stats}")

    build_sqlite(datasets)
    (OUT / "README.txt").write_text(SOURCE_NOTE + "\n", encoding="utf-8")

    print(f"\nparser: {PARSER}")
    print(f"materials with analysis: {sum(1 for m in datasets['materials'] if m['analysis'])}")
    print(f"recipes with materials:  {sum(1 for r in datasets['recipes'] if r['materials'])}")
    print(f"minerals with formula:   {sum(1 for m in datasets['minerals'] if m['formula'])}")
    print(f"output -> {OUT}")


if __name__ == "__main__":
    main()
