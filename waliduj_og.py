#!/usr/bin/env python3
"""Validate Open Graph / X (Twitter) card tags for Jack Beatnic Gallery."""

from __future__ import annotations

import argparse
import re
import sys
import urllib.error
import urllib.request
from io import BytesIO

from PIL import Image

REQUIRED = {
    "og:type": r'property="og:type"\s+content="([^"]+)"',
    "og:title": r'property="og:title"\s+content="([^"]+)"',
    "og:description": r'property="og:description"\s+content="([^"]+)"',
    "og:image": r'property="og:image"\s+content="([^"]+)"',
    "og:image:width": r'property="og:image:width"\s+content="([^"]+)"',
    "og:image:height": r'property="og:image:height"\s+content="([^"]+)"',
    "twitter:card": r'name="twitter:card"\s+content="([^"]+)"',
    "twitter:image": r'name="twitter:image"\s+content="([^"]+)"',
}


def fetch(url: str, user_agent: str | None = None) -> bytes:
    headers = {"User-Agent": user_agent or "JackBeatnicOGValidator/1.0"}
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read()


def extract_meta(html: str) -> dict[str, str]:
    found: dict[str, str] = {}
    for key, pattern in REQUIRED.items():
        match = re.search(pattern, html, re.I)
        if match:
            found[key] = match.group(1)
    return found


def validate_image(url: str) -> list[str]:
    issues: list[str] = []
    try:
        data = fetch(url, user_agent="Twitterbot/1.0")
    except urllib.error.HTTPError as exc:
        return [f"og:image HTTP {exc.code}: {url}"]
    except urllib.error.URLError as exc:
        return [f"og:image unreachable: {exc.reason}"]

    size_kb = len(data) // 1024
    if size_kb > 5120:
        issues.append(f"og:image too large: {size_kb} KB (max ~5 MB)")

    try:
        img = Image.open(BytesIO(data))
        width, height = img.size
    except Exception as exc:  # noqa: BLE001
        return [f"og:image not a valid image: {exc}"]

    if (width, height) != (1200, 630):
        issues.append(f"og:image size {width}x{height} (recommended 1200x630)")

    return issues


def validate_page(url: str) -> int:
    print(f"Checking: {url}")
    try:
        html = fetch(url, user_agent="Twitterbot/1.0").decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        print(f"FAIL page HTTP {exc.code}")
        return 1
    except urllib.error.URLError as exc:
        print(f"FAIL page unreachable: {exc.reason}")
        return 1

    meta = extract_meta(html)
    errors: list[str] = []

    for key in REQUIRED:
        if key not in meta:
            errors.append(f"missing meta: {key}")

    if meta.get("twitter:card") != "summary_large_image":
        errors.append(f"twitter:card should be summary_large_image, got {meta.get('twitter:card')!r}")

    og_image = meta.get("og:image", "")
    twitter_image = meta.get("twitter:image", "")
    if og_image and twitter_image and og_image != twitter_image:
        errors.append("og:image and twitter:image differ")

    if og_image:
        errors.extend(validate_image(og_image))

    if errors:
        print("FAIL")
        for item in errors:
            print(f"  - {item}")
        return 1

    print("OK")
    for key, value in meta.items():
        print(f"  {key}: {value}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate OG / X card tags.")
    parser.add_argument(
        "url",
        nargs="?",
        default="https://jackbeatnic.github.io/",
        help="Page URL to validate (default: homepage)",
    )
    args = parser.parse_args(argv)
    return validate_page(args.url.rstrip("/") + ("/" if args.url.endswith(".github.io") else ""))


if __name__ == "__main__":
    raise SystemExit(main())