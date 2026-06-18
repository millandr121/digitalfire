#!/usr/bin/env python3
"""
digitalfire_extract_drive.py - fetches HTML files directly from Google Drive
and extracts factual ceramic chemistry data into JSON.

Usage:
    python digitalfire_extract_drive.py --key YOUR_API_KEY --folder FOLDER_ID

Folder ID is the last part of the Drive folder URL:
    https://drive.google.com/drive/folders/11uHARZFhcvMAXjBjAc7BZ2xKd7EcqN0h
                                           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
"""

from __future__ import annotations

import argparse
import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

# ── known subfolder names in the Drive root ──────────────────────────────────
SECTION_FOLDERS = ["oxide", "material", "mineral", "recipe", "temperature"]

ROOT_FOLDER_ID = "11uHARZFhcvMAXjBjAc7BZ2xKd7EcqN0h"
DRIVE_API = "https://www.googleapis.com/drive/v3"

try:
    import lxml  # noqa: F401
    PARSER = "lxml"
except Exception:
    PARSER = "html.parser"

BROKEN_MARKERS = ("Failed to parse json", "Operation timed out", "Error 404")


# ── Drive API helpers ─────────────────────────────────────────────────────────

def list_folder(folder_id: str, api_key: str) -> list[dict]:
    """Return all files in a Drive folder (handles pagination)."""
    files = []
    page_token = None
    while True:
        params = {
            "q": f"'{folder_id}' in parents",
            "key": api_key,
            "fields": "nextPageToken,files(id,name,mimeType)",
            "pageSize": 1000,
        }
        if page_token:
            params["pageToken"] = page_token
        r = requests.get(f"{DRIVE_API}/files", params=params, timeout=30)
        r.raise_for_status()
        data = r.json()
        files.extend(data.get("files", []))
        page_token = data.get("nextPageToken")
        if not page_token:
            break
    return files


def download_file(file_id: str, api_key: str, retries: int = 3) -> str | None:
    """Download a text file from Drive by ID."""
    url = f"{DRIVE_API}/files/{file_id}"
    params = {"alt": "media", "key": api_key}
    for attempt in range(retries):
        try:
            r = requests.get(url, params=params, timeout=30)
            if r.status_code == 200:
                return r.text
            if r.status_code == 429:
                time.sleep(2 ** attempt)
                continue
            return None
        except requests.RequestException:
            time.sleep(2 ** attempt)
    return None


def find_subfolder(files: list[dict], name: str) -> str | None:
    """Find a subfolder ID by name from a listing."""
    for f in files:
        if f["name"] == name and "folder" in f["mimeType"]:
            return f["id"]
    return None


# ── parsers (same logic as local extractor) ───────────────────────────────────

def is_broken(html: str) -> bool:
    if any(m in html for m in BROKEN_MARKERS):
        return True
    if html.lower().count("<!doctype html") > 1:
        return True
    return False


def num(text):
    if text is None:
        return None
    m = re.search(r"-?\d+(?:\.\d+)?", text.replace(",", ""))
    return float(m.group()) if m else None


def clean(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


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


def first_next_p(h1, predicate):
    for p in h1.find_all_next("p"):
        t = clean(p.get_text())
        if predicate(t):
            return t
    return None


def parse_oxide(soup):
    h1 = soup.find("h1")
    if not h1:
        return None
    heading = clean(h1.get_text())
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
    heading = clean(h1.get_text())
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
                continue
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


PARSERS = {
    "oxide": (parse_oxide, lambda r: r["symbol"]),
    "material": (parse_material, lambda r: r["name"]),
    "mineral": (parse_mineral, lambda r: r["name"]),
    "recipe": (parse_recipe, lambda r: r["code"] or r["name"]),
    "temperature": (parse_temperature, lambda r: f"{r['value']}|{r.get('event') or ''}"),
}


# ── main extraction loop ──────────────────────────────────────────────────────

def extract_section(folder_id: str, section: str, api_key: str) -> tuple[list, dict]:
    parse_fn, key_fn = PARSERS[section]
    files = list_folder(folder_id, api_key)
    html_files = [f for f in files if f["name"].endswith(".html") and f["name"] != "list.html"]

    records = {}
    stats = {"total": len(html_files), "broken": 0, "skipped": 0, "dupes": 0}

    for i, f in enumerate(html_files):
        if (i + 1) % 50 == 0:
            print(f"  {section}: {i+1}/{len(html_files)}...")
        html = download_file(f["id"], api_key)
        if not html or is_broken(html):
            stats["broken"] += 1
            continue
        rec = parse_fn(BeautifulSoup(html, PARSER))
        if not rec or not key_fn(rec):
            stats["skipped"] += 1
            continue
        stem = f["name"].replace(".html", "")
        rec["id"] = stem
        rec["source"] = "digitalfire.com"
        key = key_fn(rec).lower()
        if key in records:
            stats["dupes"] += 1
            # prefer slug IDs over numeric ones
            if not stem.isdigit() and records[key]["id"].isdigit():
                records[key] = rec
            continue
        records[key] = rec
        time.sleep(0.05)  # be gentle with the API

    stats["kept"] = len(records)
    return list(records.values()), stats


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--key", required=True, help="Google Drive API key")
    parser.add_argument("--folder", default=ROOT_FOLDER_ID, help="Root Drive folder ID")
    parser.add_argument("--section", default="all",
                        help="Which section to run: all, oxide, material, mineral, recipe, temperature")
    parser.add_argument("--out", default="app/public/data", help="Output directory")
    args = parser.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    print(f"Listing root folder {args.folder}...")
    root_files = list_folder(args.folder, args.key)
    print(f"Found {len(root_files)} items in root")

    sections = SECTION_FOLDERS if args.section == "all" else [args.section]

    for section in sections:
        folder_id = find_subfolder(root_files, section)
        if not folder_id:
            print(f"  WARNING: subfolder '{section}' not found, skipping")
            continue
        print(f"\nExtracting {section} (folder {folder_id})...")
        records, stats = extract_section(folder_id, section, args.key)
        out_file = out / f"{section}s.json"
        out_file.write_text(json.dumps(records, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"  {section}: {stats} -> {out_file}")

    print("\nDone.")


if __name__ == "__main__":
    main()
