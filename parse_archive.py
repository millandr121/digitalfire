#!/usr/bin/env python3
"""
Parse the digitalfire.com HTML archive and output JSON files for
articles, glossary entries, and pictures.
"""

import json
import os
import glob
import re
import sys
from pathlib import Path
from bs4 import BeautifulSoup, Comment

ARCHIVE_DIR = "/home/user/digitalfire/site-archive"
OUTPUT_DIR = "/home/user/digitalfire/app/public/data"

os.makedirs(OUTPUT_DIR, exist_ok=True)


def get_effective_container(soup):
    """
    Handle double-embedded HTML: the outer .container may contain a full
    inner HTML document. If so, find the inner .container after stripping
    nav/shutdown banner from the inner body. Otherwise return the outer
    .container directly.
    """
    outer_container = soup.find("div", class_="container")
    if not outer_container:
        return None

    inner_html = outer_container.find("html")
    if inner_html:
        inner_body = inner_html.find("body")
        if inner_body:
            inner_container = inner_body.find("div", class_="container")
            if inner_container:
                return inner_container
        # Fallback: use the inner html itself
        return inner_html

    return outer_container


def clean_container(container):
    """
    Remove nav, footer, script, style, shutdown banner, and other boilerplate
    from a container element. Modifies in place.
    """
    # Remove script, style, nav, footer tags
    for tag in container.find_all(["script", "style", "nav", "footer"]):
        tag.decompose()

    # Remove HTML comments
    for comment in container.find_all(string=lambda t: isinstance(t, Comment)):
        comment.extract()

    # Remove shutdown notice (orange banner: background-color:#ff9933)
    for tag in container.find_all(True):
        style = tag.get("style", "")
        if "ff9933" in style:
            tag.decompose()

    # Remove donation/ko-fi footer sections
    for tag in container.find_all("table", style=lambda s: s and "margin:30px" in s):
        tag.decompose()

    # Remove "Got a Question?" / ko-fi section
    for h3 in container.find_all("h3"):
        if h3.get_text(strip=True) == "Got a Question?":
            # Remove this h3 and everything after in parent
            for sib in list(h3.next_siblings):
                sib.extract() if hasattr(sib, "extract") else None
            h3.decompose()
            break

    # Remove the footer logo/copyright hr block
    for hr in container.find_all("hr"):
        # Remove hr and everything after it (footer)
        for sib in list(hr.next_siblings):
            if hasattr(sib, "decompose"):
                sib.decompose()
            else:
                sib.extract()
        hr.decompose()

    return container


def get_title(container, soup):
    """Extract title from h1, or fall back to <title> tag."""
    h1 = container.find("h1")
    if h1:
        return h1.get_text(strip=True)
    title_tag = soup.find("title")
    if title_tag:
        return title_tag.get_text(strip=True)
    return ""


def get_body_html(container):
    """
    Return the inner HTML of the container, stripping the h1 (already
    captured as title) but preserving h2/h3/p/ul/li/img/a/b/i/table.
    """
    # Remove h1 (captured separately as title)
    h1 = container.find("h1")
    if h1:
        h1.decompose()

    # Remove the "All Pictures" collapse button and list (picture-specific)
    collapse_btn = container.find("a", class_="btn", attrs={"data-toggle": "collapse"})
    if collapse_btn:
        collapse_btn.decompose()
    collapse_div = container.find("div", class_="collapse")
    if collapse_div:
        collapse_div.decompose()

    return container.decode_contents().strip()


def get_image_srcs(container):
    """Collect all img src attributes from a container."""
    srcs = []
    for img in container.find_all("img"):
        src = img.get("src", "")
        if src and not src.endswith(".svg") and "ko-fi" not in src and "PayPal" not in src:
            srcs.append(src)
    return srcs


def is_404(container):
    """Detect 404/error pages."""
    text = container.get_text(strip=True)
    return "Error 404" in text or "Failed to parse json" in text or "API server returned an invalid response" in text[:200]


def slugify(text):
    """Create a URL-safe slug from text."""
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_]+", "-", text)
    text = re.sub(r"-+", "-", text)
    return text


# ---------------------------------------------------------------------------
# Article parsing
# ---------------------------------------------------------------------------

def parse_articles():
    article_dir = os.path.join(ARCHIVE_DIR, "article")
    files = sorted(glob.glob(os.path.join(article_dir, "*.html")))
    total = len(files)
    articles = []
    skipped = 0

    for i, filepath in enumerate(files, 1):
        if i % 50 == 0 or i == total:
            print(f"  Parsed {i}/{total} articles...")

        filename = os.path.basename(filepath)
        article_id = filename.replace(".html", "")

        with open(filepath, encoding="utf-8", errors="ignore") as f:
            html = f.read()

        soup = BeautifulSoup(html, "html.parser")
        container = get_effective_container(soup)
        if not container:
            skipped += 1
            continue

        clean_container(container)

        if is_404(container):
            skipped += 1
            continue

        title = get_title(container, soup)
        # Also try meta description as subtitle/summary
        meta_desc = soup.find("meta", attrs={"name": "description"})
        description = meta_desc["content"].strip() if meta_desc and meta_desc.get("content") else ""

        image_srcs = get_image_srcs(container)
        body_html = get_body_html(container)

        if not title and not body_html.strip():
            skipped += 1
            continue

        articles.append({
            "id": article_id,
            "title": title,
            "description": description,
            "body": body_html,
            "images": image_srcs,
        })

    print(f"  Articles: {len(articles)} parsed, {skipped} skipped (404/empty)")
    return articles


# ---------------------------------------------------------------------------
# Glossary parsing
# ---------------------------------------------------------------------------

def parse_glossary():
    glossary_dir = os.path.join(ARCHIVE_DIR, "glossary")
    files = sorted(glob.glob(os.path.join(glossary_dir, "*.html")))
    total = len(files)
    entries = []
    skipped = 0

    for i, filepath in enumerate(files, 1):
        if i % 100 == 0 or i == total:
            print(f"  Parsed {i}/{total} glossary entries...")

        filename = os.path.basename(filepath)
        # Skip list.html and other non-entry files
        if filename in ("list.html",):
            skipped += 1
            continue

        with open(filepath, encoding="utf-8", errors="ignore") as f:
            html = f.read()

        soup = BeautifulSoup(html, "html.parser")
        container = get_effective_container(soup)
        if not container:
            skipped += 1
            continue

        clean_container(container)

        if is_404(container):
            skipped += 1
            continue

        term = get_title(container, soup)
        if not term:
            skipped += 1
            continue

        # ID: use slugified term (matches the filename pattern for glossary)
        entry_id = filename.replace(".html", "")

        meta_desc = soup.find("meta", attrs={"name": "description"})
        summary = meta_desc["content"].strip() if meta_desc and meta_desc.get("content") else ""

        image_srcs = get_image_srcs(container)
        body_html = get_body_html(container)

        entries.append({
            "id": entry_id,
            "term": term,
            "summary": summary,
            "definition": body_html,
            "images": image_srcs,
        })

    print(f"  Glossary: {len(entries)} parsed, {skipped} skipped (404/empty)")
    return entries


# ---------------------------------------------------------------------------
# Picture parsing
# ---------------------------------------------------------------------------

def parse_pictures():
    picture_dir = os.path.join(ARCHIVE_DIR, "picture")
    files = sorted(glob.glob(os.path.join(picture_dir, "*.html")))
    total = len(files)
    pictures = []
    skipped = 0

    for i, filepath in enumerate(files, 1):
        if i % 500 == 0 or i == total:
            print(f"  Parsed {i}/{total} pictures...")

        filename = os.path.basename(filepath)
        if filename in ("list.html",):
            skipped += 1
            continue

        picture_id = filename.replace(".html", "")

        # Skip non-numeric IDs (index pages etc.)
        if not re.match(r"^\d+$", picture_id):
            skipped += 1
            continue

        with open(filepath, encoding="utf-8", errors="ignore") as f:
            html = f.read()

        soup = BeautifulSoup(html, "html.parser")
        container = get_effective_container(soup)
        if not container:
            skipped += 1
            continue

        clean_container(container)

        if is_404(container):
            skipped += 1
            continue

        # For picture pages, the title is in <h1> after the collapse div
        title = get_title(container, soup)

        meta_desc = soup.find("meta", attrs={"name": "description"})
        summary = meta_desc["content"].strip() if meta_desc and meta_desc.get("content") else ""

        image_srcs = get_image_srcs(container)
        body_html = get_body_html(container)

        # Extract caption: first <p> text in the content
        caption_soup = BeautifulSoup(body_html, "html.parser")
        first_p = caption_soup.find("p")
        caption = first_p.get_text(strip=True) if first_p else ""

        if not title:
            skipped += 1
            continue

        pictures.append({
            "id": picture_id,
            "title": title,
            "summary": summary,
            "caption": caption,
            "body": body_html,
            "images": image_srcs,
        })

    print(f"  Pictures: {len(pictures)} parsed, {skipped} skipped (404/empty/non-numeric)")
    return pictures


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print("=== Parsing Articles ===")
    articles = parse_articles()
    articles_path = os.path.join(OUTPUT_DIR, "articles.json")
    with open(articles_path, "w", encoding="utf-8") as f:
        json.dump(articles, f, ensure_ascii=False, indent=2)
    print(f"  Wrote {len(articles)} articles to {articles_path}")

    print("\n=== Parsing Glossary ===")
    glossary = parse_glossary()
    glossary_path = os.path.join(OUTPUT_DIR, "glossary.json")
    with open(glossary_path, "w", encoding="utf-8") as f:
        json.dump(glossary, f, ensure_ascii=False, indent=2)
    print(f"  Wrote {len(glossary)} glossary entries to {glossary_path}")

    print("\n=== Parsing Pictures ===")
    pictures = parse_pictures()
    pictures_path = os.path.join(OUTPUT_DIR, "pictures.json")
    with open(pictures_path, "w", encoding="utf-8") as f:
        json.dump(pictures, f, ensure_ascii=False, indent=2)
    print(f"  Wrote {len(pictures)} pictures to {pictures_path}")

    # Show samples
    print("\n=== Sample: First Article ===")
    if articles:
        a = articles[0]
        print(json.dumps({
            "id": a["id"],
            "title": a["title"],
            "description": a["description"],
            "images": a["images"][:2],
            "body_preview": a["body"][:500] + "..." if len(a["body"]) > 500 else a["body"],
        }, indent=2, ensure_ascii=False))

    print("\n=== Sample: First Glossary Entry ===")
    if glossary:
        g = glossary[0]
        print(json.dumps({
            "id": g["id"],
            "term": g["term"],
            "summary": g["summary"],
            "images": g["images"][:2],
            "definition_preview": g["definition"][:500] + "..." if len(g["definition"]) > 500 else g["definition"],
        }, indent=2, ensure_ascii=False))

    print("\n=== Sample: First Picture ===")
    if pictures:
        p = pictures[0]
        print(json.dumps({
            "id": p["id"],
            "title": p["title"],
            "summary": p["summary"],
            "caption": p["caption"][:200],
            "images": p["images"][:2],
        }, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
