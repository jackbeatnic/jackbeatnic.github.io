#!/usr/bin/env python3
"""Build data/promo_boards.json — which promo boards (jbg-present/promo) are PUBLIC.

generate_og_preview.py reads this index to put the work's promo board into
og:image / twitter:image of nft/<collection>/<id>.html (fallback: og-preview.jpg).

Board file name = ON-CHAIN token id, 4 digits: promo/<collection_id>/<NNNN>.jpg
Horizontal banners (1200x630, X link previews) are indexed the same way from
promo_banner/<collection_id>/<NNNN>.jpg into the "banners" key.
  (gallery token_id for NJ vol2 = 10000+n and AI Play = 700000000+n,
   so the generator uses onchain_token_id when present).

Sources (only what is committed = what GitHub Pages serves):
  --local  : ../jbg-present (git ls-tree origin/main promo + blob headers) [default if present]
  --github : GitHub API tree + 2 KB Range request per new board     [no clone needed]
Unchanged boards (same blob sha) are reused from the existing index.

Usage:
  python3 build_promo_board_index.py            # auto
  python3 build_promo_board_index.py --github
"""
from __future__ import annotations

import argparse
import json
import os
import struct
import subprocess
import sys
import urllib.error
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
BANNER_DIR = "promo_banner"
BANNER_BASE = "https://jackbeatnic.github.io/jbg-present/promo_banner"
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


def list_github(top: str = "promo") -> dict[str, dict[str, str]]:
    """{collection: {NNNN: blob_sha}} from the default branch of jbg-present."""
    try:
        root = gh_json(f"repos/{REPO}/contents/{top}")
    except urllib.error.HTTPError as exc:
        if exc.code == 404 and top != "promo":
            return {}
        raise
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


def _present_ref() -> str:
    """Published tree = origin/main (what Pages serves), else HEAD."""
    for ref in ("origin/main", "HEAD"):
        r = subprocess.run(["git", "rev-parse", "--verify", "-q", ref], cwd=PRESENT,
                           capture_output=True, text=True)
        if r.returncode == 0:
            return ref
    raise SystemExit(f"{PRESENT}: no origin/main and no HEAD")


def list_local(top: str = "promo") -> dict[str, dict[str, str]]:
    r = subprocess.run(
        ["git", "ls-tree", "-r", _present_ref(), top],
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


def sizes_local(items: list[tuple[str, str, str]]) -> dict[str, tuple[int, int]]:
    """Read the committed blobs (git cat-file --batch) — not the working tree."""
    if not items:
        return {}
    proc = subprocess.Popen(["git", "cat-file", "--batch"], cwd=PRESENT,
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    out: dict[str, tuple[int, int]] = {}
    try:
        for _col, _stem, sha in items:
            proc.stdin.write(sha.encode() + b"\n")
            proc.stdin.flush()
            header = proc.stdout.readline().split()
            if len(header) < 3 or header[1] == b"missing":
                continue
            data = proc.stdout.read(int(header[2]))
            proc.stdout.read(1)  # trailing LF
            size = jpeg_size(data[:65536])
            if not size:
                try:
                    from PIL import Image
                    with Image.open(BytesIO(data)) as im:
                        size = im.size
                except Exception:
                    size = None
            if size:
                out[sha] = size
    finally:
        proc.stdin.close()
        proc.wait()
    return out


def size_remote(col: str, stem: str, base: str = PUBLIC_BASE) -> tuple[int, int] | None:
    url = f"{base}/{col}/{stem}.jpg"
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


def build_part(source: str, top: str, old: dict, base: str) -> dict[str, dict[str, list]]:
    listing = list_local(top) if source == "local" else list_github(top)
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
    print(f"[promo-index] {top}: {sum(len(v) for v in listing.values())} boards, {len(todo)} to measure ({source})")

    failed = 0
    if source == "local":
        sizes = sizes_local(todo)
        for col, stem, sha in todo:
            size = sizes.get(sha)
            if not size:
                failed += 1
                continue
            cols[col][stem] = [size[0], size[1], sha[:10]]
    else:
        def work(item):
            col, stem, _sha = item
            return item, size_remote(col, stem, base)

        with ThreadPoolExecutor(max_workers=16) as ex:
            for (col, stem, sha), size in ex.map(work, todo):
                if not size:
                    failed += 1
                    continue
                cols[col][stem] = [size[0], size[1], sha[:10]]
    if failed:
        print(f"[promo-index] WARN: {top}: {failed} boards without size (skipped)")
    return {c: v for c, v in cols.items() if v}


def build(source: str) -> dict:
    prev = load_old()
    cols = build_part(source, "promo", prev.get("collections") or {}, PUBLIC_BASE)
    banners = build_part(source, BANNER_DIR, prev.get("banners") or {}, BANNER_BASE)
    return {
        "_doc": "Public promo boards on jbg-present Pages. Key = on-chain token id (4 digits). "
                "Value = [width, height, blob sha (cache-bust ?v=)]. 'banners' = horizontal 1200x630 boards "
                "(promo_banner/, Arena share pages). Built by build_promo_board_index.py.",
        "base": PUBLIC_BASE,
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "source": source,
        "collections": cols,
        "banner_base": BANNER_BASE,
        "banners": banners,
    }


def refresh(source: str | None = None, quiet: bool = False) -> dict:
    """Rebuild and write the index (used by generate_og_preview.py).
    Writes only when the set of boards / sizes / shas changed."""
    if source is None:
        source = "local" if (PRESENT / ".git").exists() else "github"
    doc = build(source)
    total = sum(len(v) for v in doc["collections"].values())
    prev = load_old()
    nb = sum(len(v) for v in doc["banners"].values())
    if prev.get("collections") == doc["collections"] and prev.get("banners") == doc["banners"]:
        print(f"[promo-index] unchanged ({total} boards, {nb} banners)")
        return prev
    INDEX.parent.mkdir(parents=True, exist_ok=True)
    INDEX.write_text(
        json.dumps(doc, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n",
        encoding="utf-8",
    )
    if not quiet:
        for c, v in doc["collections"].items():
            print(f"[promo-index] {c}: {len(v)}")
    print(f"[promo-index] saved {INDEX.relative_to(ROOT)} ({total} boards, {nb} banners)")
    return doc


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--local", action="store_true", help="../jbg-present clone (origin/main)")
    g.add_argument("--github", action="store_true", help="GitHub API + Range requests")
    a = ap.parse_args(argv)
    source = "github" if a.github else ("local" if a.local else None)
    refresh(source)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
