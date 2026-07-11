#!/usr/bin/env python3
"""
Synchronizuje ceny listingów OpenSea z raportów CSV -> www/gallery.json

Źródło: raportowanie/raporty/{collection_id}_raport.csv
Cel:    current_price_{waluta}, listing_status, opensea_url

Najpierw wygeneruj świeży raport:
  cd /home/jb/jb_nft/raportowanie
  export OPENSEA_API_KEY="..."
  python3 raportuj_kolekcje.py --kolekcja avalanche_nature_stories
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
JB_NFT = SCRIPT_DIR.parent
RAPORTY_DIR = JB_NFT / "raportowanie" / "raporty"
KOLEKCJE_PATH = JB_NFT / "raportowanie" / "kolekcje.json"
DEFAULT_GALLERY = SCRIPT_DIR / "gallery.json"

OPENSEA_ASSET_RE = re.compile(
    r"opensea\.io/assets/([^/]+)/(0x[a-fA-F0-9]{40})/(\d+)"
)


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def save_json(path: Path, data: dict) -> None:
    path.write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def load_contract_map() -> dict[str, dict]:
    data = load_json(KOLEKCJE_PATH)
    out: dict[str, dict] = {}
    for col in data.get("collections", []):
        out[col["contract"].lower()] = col
    return out


def parse_price(value: str) -> float | None:
    if not value or value in ("N/A", "Not Listed", ""):
        return None
    try:
        return float(Decimal(value))
    except (InvalidOperation, ValueError):
        return None


def price_field_name(currency: str) -> str:
    return f"current_price_{currency.strip().lower()}"


def parse_opensea_url(url: str) -> tuple[str, str, str] | None:
    m = OPENSEA_ASSET_RE.search(url or "")
    if not m:
        return None
    return m.group(1), m.group(2).lower(), m.group(3)


def load_raport_index(raport_path: Path) -> dict[tuple[str, str, str], dict]:
    index: dict[tuple[str, str, str], dict] = {}
    with raport_path.open(encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            key = (
                row["chain"],
                row["contract"].lower(),
                str(row["token_id"]),
            )
            index[key] = row
    return index


def resolve_raport_path(collection_id: str) -> Path:
    path = RAPORTY_DIR / f"{collection_id}_raport.csv"
    if not path.exists():
        raise SystemExit(
            f"Brak raportu: {path}\n"
            f"Uruchom: python3 raportuj_kolekcje.py --kolekcja {collection_id}"
        )
    return path


def nft_key(nft: dict, contract_map: dict[str, dict]) -> tuple[str, str, str] | None:
    if nft.get("chain") and nft.get("contract_address"):
        return (
            nft["chain"],
            str(nft["contract_address"]).lower(),
            str(nft["token_id"]),
        )
    parsed = parse_opensea_url(nft.get("opensea_url", ""))
    if parsed:
        return parsed
    return None


def sync_gallery(
    gallery: dict,
    *,
    collection_id: str | None,
    dry_run: bool,
) -> tuple[int, int, int]:
    contract_map = load_contract_map()
    nfts = gallery.get("nfts", [])
    if not nfts:
        raise SystemExit("gallery.json nie ma żadnych NFT.")

    inferred_ids: set[str] = set()
    for nft in nfts:
        key = nft_key(nft, contract_map)
        if key:
            col = contract_map.get(key[1])
            if col:
                inferred_ids.add(col["id"])

    if collection_id:
        raport_ids = [collection_id]
    elif len(inferred_ids) == 1:
        raport_ids = [next(iter(inferred_ids))]
    else:
        raport_ids = sorted(inferred_ids)

    indexes: dict[str, dict] = {}
    for rid in raport_ids:
        indexes[rid] = load_raport_index(resolve_raport_path(rid))

    updated = 0
    listed = 0
    missing = 0

    for nft in nfts:
        key = nft_key(nft, contract_map)
        if not key:
            missing += 1
            continue

        col = contract_map.get(key[1])
        raport_row = None
        if col and col["id"] in indexes:
            raport_row = indexes[col["id"]].get(key)
        if raport_row is None:
            for idx in indexes.values():
                if key in idx:
                    raport_row = idx[key]
                    break

        if raport_row is None:
            missing += 1
            continue

        if col:
            nft.setdefault("chain", col["chain"])
            nft.setdefault("contract_address", col["contract"])
            nft.setdefault("collection_id", col["id"])

        currency = (raport_row.get("currency") or "").strip()
        if currency and currency != "N/A":
            nft["listing_currency"] = currency

        listing_status = raport_row.get("listing_status", "")
        nft["listing_status"] = listing_status

        price = parse_price(raport_row.get("price", ""))
        if currency and currency != "N/A":
            field = price_field_name(currency)
            if listing_status == "For Sale" and price is not None:
                nft[field] = price
                listed += 1
            else:
                nft[field] = None

        if raport_row.get("opensea_url"):
            nft["opensea_url"] = raport_row["opensea_url"]

        if raport_row.get("name"):
            nft["name"] = raport_row["name"]

        updated += 1

    info = gallery.setdefault("collection_info", {})
    if raport_ids:
        info["collection_id"] = raport_ids[0] if len(raport_ids) == 1 else raport_ids
    if inferred_ids:
        first_col = contract_map.get(nft_key(nfts[0], contract_map)[1]) if nfts else None
        if first_col:
            info.setdefault("chain", first_col["chain"])
            native = {"avalanche": "AVAX", "base": "ETH", "polygon": "POL"}
            info.setdefault("native_currency", native.get(first_col["chain"], "ETH"))
    info["last_price_sync"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    return updated, listed, missing


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Aktualizuj gallery.json cenami z raportów OpenSea (raportowanie/)."
    )
    parser.add_argument(
        "--gallery",
        type=Path,
        default=DEFAULT_GALLERY,
        help=f"Ścieżka do gallery.json (domyślnie: {DEFAULT_GALLERY})",
    )
    parser.add_argument(
        "--kolekcja",
        dest="collection_id",
        help="collection_id z kolekcje.json (np. avalanche_nature_stories)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Pokaż podsumowanie bez zapisu",
    )
    args = parser.parse_args()

    gallery_path = args.gallery.resolve()
    gallery = load_json(gallery_path)

    updated, listed, missing = sync_gallery(
        gallery,
        collection_id=args.collection_id,
        dry_run=args.dry_run,
    )

    print(f"Galeria: {gallery_path}")
    print(f"Zaktualizowano wpisów: {updated}")
    print(f"Z aktywnym listingiem (cena): {listed}")
    if missing:
        print(f"Bez dopasowania w raporcie: {missing}")

    if args.dry_run:
        print("\n[dry-run] Nie zapisano gallery.json")
        for nft in gallery.get("nfts", [])[:5]:
            tid = nft.get("token_id")
            cur = nft.get("listing_currency", "?")
            field = price_field_name(cur) if cur != "?" else "current_price_*"
            price = nft.get(field) if field in nft else None
            print(f"  token {tid}: {nft.get('listing_status')} -> {price} {cur}")
    else:
        save_json(gallery_path, gallery)
        print(f"\nZapisano: {gallery_path}")


if __name__ == "__main__":
    main()