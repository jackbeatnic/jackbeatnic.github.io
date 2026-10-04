#!/usr/bin/env python3
"""Validate Open Graph / X (Twitter) card tags for Jack Beatnic Gallery."""

from __future__ import annotations

import argparse
import re
import sys
import urllib.error
import urllib.request
import urllib.robotparser
from io import BytesIO
from urllib.parse import urlsplit

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


BOT_AGENTS = ("Twitterbot", "TelegramBot", "facebookexternalhit", "LinkedInBot")


def _robots_groups(text: str) -> list[tuple[list[str], list[tuple[bool, str]]]]:
    groups: list[tuple[list[str], list[tuple[bool, str]]]] = []
    agents: list[str] = []
    rules: list[tuple[bool, str]] = []
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip()
        if ":" not in line:
            continue
        key, val = (x.strip() for x in line.split(":", 1))
        key = key.lower()
        if key == "user-agent":
            if rules:
                groups.append((agents, rules))
                agents, rules = [], []
            agents.append(val.lower())
        elif key in ("allow", "disallow") and agents:
            if val:
                rules.append((key == "allow", val))
            elif key == "disallow":
                rules.append((True, "/"))  # empty Disallow = allow all
    if agents:
        groups.append((agents, rules))
    return groups


def _rule_match(pattern: str, path: str) -> bool:
    rx = "^" + re.escape(pattern).replace(r"\*", ".*")
    if rx.endswith(r"\$"):
        rx = rx[:-2] + "$"
    return re.match(rx, path) is not None


def robots_allows(text: str, agent: str, path: str) -> bool:
    """RFC 9309 / Google semantics (what Twitterbot uses): most specific UA group,
    longest matching rule wins, Allow wins ties. urllib.robotparser is first-match
    and gets this wrong."""
    groups = _robots_groups(text)
    agent_l = agent.lower()
    chosen = [r for a, r in groups if any(x != "*" and x in agent_l for x in a)]
    if not chosen:
        chosen = [r for a, r in groups if "*" in a]
    rules = [rule for g in chosen for rule in g]
    best: tuple[int, bool] | None = None
    for allow, pat in rules:
        if _rule_match(pat, path):
            cand = (len(pat), allow)
            if best is None or cand[0] > best[0] or (cand[0] == best[0] and allow):
                best = cand
    return True if best is None else best[1]


_ROBOTS_CACHE: dict[str, str] = {}


def robots_issues(url: str) -> list[str]:
    """X/Telegram skip pages/images that the host robots.txt disallows for them."""
    parts = urlsplit(url)
    host = f"{parts.scheme}://{parts.netloc}"
    if host not in _ROBOTS_CACHE:
        try:
            _ROBOTS_CACHE[host] = fetch(f"{host}/robots.txt").decode("utf-8", "replace")
        except Exception:  # noqa: BLE001
            _ROBOTS_CACHE[host] = ""
    path = parts.path or "/"
    return [
        f"robots.txt blocks {ua} for {url}"
        for ua in BOT_AGENTS
        if not robots_allows(_ROBOTS_CACHE[host], ua, path)
    ]


def validate_image(url: str, declared: tuple[int, int] | None = None) -> list[str]:
    issues: list[str] = []
    if not url.startswith("https://"):
        issues.append(f"og:image must be an absolute https URL: {url}")
    issues.extend(robots_issues(url))
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Twitterbot/1.0"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            ctype = resp.headers.get("Content-Type", "")
            data = resp.read()
        if not ctype.startswith("image/"):
            issues.append(f"og:image Content-Type {ctype!r}")
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

    # summary_large_image: ~1.91:1 (1200x630) or a square promo board are both fine.
    if not ((width, height) == (1200, 630) or (width == height and width >= 300)):
        issues.append(f"og:image size {width}x{height} (want 1200x630 or square >= 300)")
    if declared and declared != (width, height):
        issues.append(f"og:image:width/height {declared[0]}x{declared[1]} != real {width}x{height}")

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
    # twitter:image may be the card-image redirect (X gets the banner) or the
    # banner file itself. og:image stays the square.
    if (
        og_image
        and twitter_image
        and og_image != twitter_image
        and "/card-image/" not in twitter_image
        and "/promo_banner/" not in twitter_image
    ):
        errors.append("og:image and twitter:image differ")

    errors.extend(robots_issues(url))
    declared = None
    try:
        declared = (int(meta["og:image:width"]), int(meta["og:image:height"]))
    except (KeyError, ValueError):
        pass
    if og_image:
        errors.extend(validate_image(og_image, declared))

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