#!/usr/bin/env python3
"""Move gallery card captions out of gallery.json.

Unique readings stay one per work. A line repeated across a series stays
once. Visible text is checked against the original before anything is written.
"""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GALLERY = ROOT / "gallery.json"
CAPTIONS = ROOT / "data" / "captions.json"


def work_key(nft: dict) -> str:
    return f"{nft.get('collection_id')}:{nft.get('token_id')}"


def description_of(nft: dict) -> str:
    ai = nft.get("ai")
    if not isinstance(ai, dict):
        return ""
    text = ai.get("description")
    return text.strip() if isinstance(text, str) else ""


def build(nfts: list[dict]) -> tuple[dict, dict]:
    per_series: dict[str, Counter] = defaultdict(Counter)
    for nft in nfts:
        text = description_of(nft)
        cid = nft.get("collection_id") or ""
        if text and cid:
            per_series[cid][text] += 1

    series: dict[str, str] = {}
    for cid, counts in per_series.items():
        text, count = counts.most_common(1)[0]
        if count > 1:
            series[cid] = text

    works: dict[str, str] = {}
    for nft in nfts:
        text = description_of(nft)
        if not text:
            continue
        cid = nft.get("collection_id") or ""
        ai = nft.get("ai") if isinstance(nft.get("ai"), dict) else {}
        unique = bool(ai.get("image_seen")) or text != series.get(cid, "")
        if unique:
            works[work_key(nft)] = text
    return works, series


def visible(nft: dict, works: dict, series: dict) -> str:
    text = works.get(work_key(nft)) or series.get(nft.get("collection_id") or "", "")
    return text or ""


def main() -> None:
    data = json.loads(GALLERY.read_text(encoding="utf-8"))
    nfts = data.get("nfts") or []
    works, series = build(nfts)

    missing = []
    for nft in nfts:
        original = description_of(nft)
        if visible(nft, works, series) != original:
            missing.append(work_key(nft))
    if missing:
        raise SystemExit(f"caption round-trip failed for {len(missing)} works, e.g. {missing[:5]}")

    seen = [
        nft
        for nft in nfts
        if isinstance(nft.get("ai"), dict) and nft["ai"].get("image_seen")
    ]
    lost_seen = [work_key(nft) for nft in seen if work_key(nft) not in works]
    if lost_seen:
        raise SystemExit(f"image readings missing from works: {len(lost_seen)}")

    payload = {
        "note": (
            "Card captions for the public gallery. "
            "works = one unique reading. "
            "series = the shared line used when a work has no unique reading. "
            "This file is the record of those readings."
        ),
        "works": dict(sorted(works.items())),
        "series": dict(sorted(series.items())),
    }
    CAPTIONS.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    for nft in nfts:
        ai = nft.get("ai")
        if isinstance(ai, dict) and "description" in ai:
            ai.pop("description", None)

    GALLERY.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"works {len(works)}  series {len(series)}  image_seen {len(seen)}")
    print(f"captions {CAPTIONS.stat().st_size}  gallery {GALLERY.stat().st_size}")


if __name__ == "__main__":
    main()
