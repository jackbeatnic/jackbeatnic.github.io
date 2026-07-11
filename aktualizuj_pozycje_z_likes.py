#!/usr/bin/env python3
"""
Ustawia kolejność NFT w gallery.json według likes_count (malejąco).

Źródło: likes_count w każdym NFT (aktualizujesz ręcznie lub z eksportu statystyk).
Efekt: display_rank 1 = najwyżej na stronie po codziennym uruchomieniu.

Uruchomienie (np. cron raz dziennie, po zebraniu statystyk):
  cd /home/jb/jb_nft/www
  python3 aktualizuj_pozycje_z_likes.py
  ./odswiez_i_wgraj.sh --no-push   # tylko JSON lokalnie
  git add gallery.json && git commit -m "chore: daily likes sort" && git push

Opcjonalnie: --stats stats/likes_aggregate.json nadpisuje likes_count przed sortem.
Format JSON: { "chain:contract:token_id": 12, ... } lub lista { "key", "likes_count" }.
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
    parser = argparse.ArgumentParser(description="Sortuj gallery.json według likes_count.")
    parser.add_argument("--gallery", type=Path, default=DEFAULT_GALLERY)
    parser.add_argument(
        "--stats",
        type=Path,
        help="Opcjonalny JSON z zagregowanymi likes (nadpisuje likes_count)",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    gallery_path = args.gallery.resolve()
    gallery = load_json(gallery_path)
    nfts = gallery.get("nfts", [])
    if not nfts:
        raise SystemExit("Brak NFT w gallery.json")

    if args.stats:
        if not args.stats.exists():
            raise SystemExit(f"Brak pliku statystyk: {args.stats}")
        n = apply_stats(nfts, args.stats)
        print(f"Zaktualizowano likes_count z {args.stats}: {n} wpisów")

    assign_ranks(nfts)
    info = gallery.setdefault("collection_info", {})
    info["last_likes_sort"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    top = sorted(nfts, key=lambda x: x.get("display_rank", 999))[:3]
    print("Kolejność (top 3):")
    for nft in top:
        print(
            f"  #{nft.get('display_rank')} token {nft.get('token_id')} "
            f"— likes {nft.get('likes_count', 0)}"
        )

    if args.dry_run:
        print("[dry-run] Nie zapisano gallery.json")
    else:
        save_json(gallery_path, gallery)
        print(f"Zapisano: {gallery_path}")


if __name__ == "__main__":
    main()