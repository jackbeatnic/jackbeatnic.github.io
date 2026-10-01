#!/usr/bin/env python3
"""Build data/promo_boards.json — which promo boards (jbg-present/promo) are PUBLIC.

generuj_og_preview.py reads this index to put the work's promo board into
og:image / twitter:image of nft/<collection>/<id>.html (fallback: og-preview.jpg).

Board file name = ON-CHAIN token id, 4 digits: promo/<collection_id>/<NNNN>.jpg
  (gallery token_id for NJ vol2 = 10000+n and AI Play = 700000000+n,
   so the generator uses onchain_token_id when present).

Sources (only what is committed = what GitHub Pages serves):
  --local  : ../jbg-present (git ls-tree HEAD promo + PIL size)   [default if present]
  --github : GitHub API tree + 2 KB Range request per new board     [no clone needed]
Unchanged boards (same blob sha) are reused from the existing index.

Usage:
  python3 buduj_indeks_tablic_promo.py            # auto
  python3 buduj_indeks_tablic_promo.py --github
"""
from __future__ import annotations

import argparse
import json
import os
import struct
import subprocess
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

ROOT = Path(__file__).resolve().parent
INDEX = ROOT / "data" / "promo_boards.json"
PRESENT = Path(os.environ.get("JB_PRESENT_DIR") or (ROOT.parent / "jbg-present"))
REPO = "jackbeatnic/jbg-present"
PUBLIC_BASE = "https://jackbeatnic.github.io/jbg-present/promo"
UA = "JackBeatnicGallery/1.0"


def jpeg_size(data: bytes) -> tuple[int, int] | None:
    """Width/height from JPEG SOF marker (first KB is enough for PIL-made boards)."""
    if data[:2] != b"\xff\xd8":
        return None
    i = 2
    while i + 9 < len(data):
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
            i += 2
            continue
        seg_len = struct.unpack(">H", data[i + 2:i + 4])[0]
        if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
            h, w = struct.unpack(">HH", data[i + 5:i + 9])
            return w, h
        i += 2 + seg_len
    return None


def load_old() -> dict:
    try:
        return json.loads(INDEX.read_text(encoding="utf-8"))
    except Exception:
        return {}


def gh_json(path: str) -> dict:
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    headers = {"Accept": "application/vnd.github+json", "User-Agent": UA}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(f"https://api.github.com/{path}", headers=headers)
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.load(r)


def list_github() -> dict[str, dict[str, str]]:
    """{collection: {NNNN: blob_sha}} from the default branch of jbg-present."""
    root = gh_json(f"repos/{REPO}/contents/promo")
    out: dict[str, dict[str, str]] = {}
    for d in root:
        if d.get("type") != "dir":
            continue
        tree = gh_json(f"repos/{REPO}/git/trees/{d['sha']}")
        if tree.get("truncated"):
            raise SystemExit(f"tree truncated for {d['name']}")
        files = {}
        for e in tree["tree"]:
            p = e["path"]
            if e["type"] == "blob" and p.endswith(".jpg") and p[:-4].isdigit():
                files[p[:-4]] = e["sha"]
        out[d["name"]] = files
    return out


def list_local() -> dict[str, dict[str, str]]:
    r = subprocess.run(
        ["git", "ls-tree", "-r", "HEAD", "promo"],
        cwd=PRESENT, capture_output=True, text=True, check=True,
    )
    out: dict[str, dict[str, str]] = {}
    for line in r.stdout.splitlines():
        meta, path = line.split("\t", 1)
        parts = path.split("/")
        if len(parts) != 3 or not parts[2].endswith(".jpg") or not parts[2][:-4].isdigit():
            continue
        out.setdefault(parts[1], {})[parts[2][:-4]] = meta.split()[2]
    return out


def size_remote(col: str, stem: str) -> tuple[int, int] | None:
    url = f"{PUBLIC_BASE}/{col}/{stem}.jpg"
    for rng in ("bytes=0-4095", None):
        headers = {"User-Agent": UA}
        if rng:
            headers["Range"] = rng
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=30) as r:
                data = r.read()
        except Exception:
            continue
        s = jpeg_size(data)
        if s:
            return s
    return None


def size_local(col: str, stem: str) -> tuple[int, int] | None:
    p = PRESENT / "promo" / col / f"{stem}.jpg"
    try:
        with p.open("rb") as fh:
            s = jpeg_size(fh.read(65536))
        if s:
            return s
        from PIL import Image
        with Image.open(p) as im:
            return im.size
    except Exception:
        return None


def build(source: str) -> dict:
    listing = list_local() if source == "local" else list_github()
    sizer = size_local if source == "local" else size_remote
    old = (load_old().get("collections") or {})
    cols: dict[str, dict[str, list]] = {}
    todo: list[tuple[str, str, str]] = []
    for col, files in sorted(listing.items()):
        cols[col] = {}
        prev = old.get(col) or {}
        for stem, sha in sorted(files.items()):
            p = prev.get(stem)
            if p and len(p) == 3 and sha.startswith(p[2]):
                cols[col][stem] = p
            else:
                todo.append((col, stem, sha))
    print(f"[promo-index] {sum(len(v) for v in listing.values())} boards, {len(todo)} to measure ({source})")

    def work(item):
        col, stem, sha = item
        return item, sizer(col, stem)

    failed = 0
    with ThreadPoolExecutor(max_workers=24 if source == "github" else 4) as ex:
        for (col, stem, sha), size in ex.map(work, todo):
            if not size:
                failed += 1
                continue
            cols[col][stem] = [size[0], size[1], sha[:10]]
    if failed:
        print(f"[promo-index] WARN: {failed} boards without size (skipped)")
    return {
        "_doc": "Public promo boards on jbg-present Pages. Key = on-chain token id (4 digits). "
                "Value = [width, height, blob sha (cache-bust ?v=)]. Built by buduj_indeks_tablic_promo.py.",
        "base": PUBLIC_BASE,
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "source": source,
        "collections": {c: v for c, v in cols.items() if v},
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--local", action="store_true")
    g.add_argument("--github", action="store_true")
    a = ap.parse_args(argv)
    if a.github:
        source = "github"
    elif a.local or (PRESENT / ".git").exists():
        source = "local"
    else:
        source = "github"
    doc = build(source)
    INDEX.parent.mkdir(parents=True, exist_ok=True)
    INDEX.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n", encoding="utf-8")
    for c, v in doc["collections"].items():
        print(f"[promo-index] {c}: {len(v)}")
    print(f"[promo-index] zapisano {INDEX.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
