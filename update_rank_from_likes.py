#!/usr/bin/env python3
"""
Sets the NFT order in gallery.json by likes_count (descending).

Source: likes_count on each NFT (updated by hand or from a stats export).
Effect: display_rank 1 = top of the page after the daily run.

Run (e.g. daily cron, after collecting stats):
  python3 update_rank_from_likes.py
  ./refresh_and_push.sh --no-push   # local JSON only
  git add gallery.json && git commit -m "chore: daily likes sort" && git push

Optional: --stats stats/likes_aggregate.json overrides likes_count before sorting.
JSON format: { "chain:contract:token_id": 12, ... } or a list of { "key", "likes_count" }.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_GALLERY = SCRIPT_DIR / "gallery.json"


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def save_json(path: Path, data: dict) -> None:
    path.write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def nft_key(nft: dict) -> str:
    chain = nft.get("chain") or ""
    contract = str(nft.get("contract_address", "")).lower()
    token = str(nft.get("token_id", ""))
    if chain and contract:
        return f"{chain}:{contract}:{token}"
    return f"{nft.get('collection_id', 'nft')}:{token}"


def apply_stats(nfts: list[dict], stats_path: Path) -> int:
    data = load_json(stats_path)
    counts: dict[str, int] = {}

    if isinstance(data, dict):
        for key, value in data.items():
            if key in ("exported_at", "notes"):
                continue
            if isinstance(value, (int, float)):
                counts[str(key)] = int(value)
    elif isinstance(data, list):
        for row in data:
            if not isinstance(row, dict):
                continue
            key = row.get("key") or nft_key(row)
            if key and row.get("likes_count") is not None:
                counts[str(key)] = int(row["likes_count"])

    updated = 0
    for nft in nfts:
        key = nft_key(nft)
        if key in counts:
            nft["likes_count"] = counts[key]
            updated += 1
    return updated


def assign_ranks(nfts: list[dict]) -> None:
    ordered = sorted(
        nfts,
        key=lambda n: (
            -(n.get("likes_count") or 0),
            int(n.get("token_id") or 0),
        ),
    )
    for rank, nft in enumerate(ordered, start=1):
        nft["display_rank"] = rank


def main() -> None:
    parser = argparse.ArgumentParser(description="Sort gallery.json by likes_count.")
    parser.add_argument("--gallery", type=Path, default=DEFAULT_GALLERY)
    parser.add_argument(
        "--stats",
        type=Path,
        help="Optional JSON with aggregated likes (overrides likes_count)",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    gallery_path = args.gallery.resolve()
    gallery = load_json(gallery_path)
    nfts = gallery.get("nfts", [])
    if not nfts:
        raise SystemExit("No NFTs in gallery.json")

    if args.stats:
        if not args.stats.exists():
            raise SystemExit(f"Stats file missing: {args.stats}")
        n = apply_stats(nfts, args.stats)
        print(f"Updated likes_count from {args.stats}: {n} entries")

    assign_ranks(nfts)
    info = gallery.setdefault("collection_info", {})
    info["last_likes_sort"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    top = sorted(nfts, key=lambda x: x.get("display_rank", 999))[:3]
    print("Order (top 3):")
    for nft in top:
        print(
            f"  #{nft.get('display_rank')} token {nft.get('token_id')} "
            f"— likes {nft.get('likes_count', 0)}"
        )

    if args.dry_run:
        print("[dry-run] gallery.json not written")
    else:
        save_json(gallery_path, gallery)
        print(f"Saved: {gallery_path}")


if __name__ == "__main__":
    main()