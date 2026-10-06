#!/usr/bin/env python3
"""Move public site URLs from jackbeatnic.github.io to the custom domain.

Rewrites every absolute URL https://jackbeatnic.github.io/... (and http://)
to https://jackbeatnic.art/... in tracked text files of this repository:
share landings (nft/*), sitemaps, robots, index/404/shop-terms, JS, gallery
JSON (share_url / og_image / image_url) and the generator scripts, so that a
later regeneration keeps the new domain.

Left untouched on purpose:
  - archive/ (historical snapshots)
  - repo references such as github.com/jackbeatnic/jackbeatnic.github.io or
    raw.githubusercontent.com/jackbeatnic/jackbeatnic.github.io/... (not URLs
    of the Pages host)
  - https://api.jackbeatnic.shop (API host stays on .shop)

Idempotent: safe to run again on a newer main / pages-live before cutover.

Usage:
  python3 tools/domain_art_rewrite.py            # rewrite in place
  python3 tools/domain_art_rewrite.py --check    # count only, no writes
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NEW = "https://jackbeatnic.art"
PATTERN = re.compile(r"https?://jackbeatnic\.github\.io(?=[/\"'\s<>?#)\],;:&]|$)")
SKIP_PREFIXES = ("archive/", "tools/domain_art_rewrite.py")
TEXT_SUFFIXES = {
    ".html", ".htm", ".js", ".mjs", ".css", ".json", ".xml", ".txt", ".py",
    ".sh", ".md", ".webmanifest", ".svg", ".toml", ".yml", ".yaml",
}


def tracked_files() -> list[str]:
    out = subprocess.run(["git", "ls-files", "-z"], cwd=ROOT, check=True,
                         capture_output=True).stdout
    return [p for p in out.decode().split("\0") if p]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true", help="count matches, write nothing")
    args = ap.parse_args()
    files = hits = 0
    for rel in tracked_files():
        if rel.startswith(SKIP_PREFIXES):
            continue
        path = ROOT / rel
        if path.suffix.lower() not in TEXT_SUFFIXES and path.name not in ("CNAME",):
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, FileNotFoundError, IsADirectoryError):
            continue
        new, n = PATTERN.subn(NEW, text)
        if n:
            files += 1
            hits += n
            if not args.check:
                path.write_text(new, encoding="utf-8")
    mode = "would rewrite" if args.check else "rewrote"
    print(f"{mode} {hits} URL(s) in {files} file(s) -> {NEW}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
