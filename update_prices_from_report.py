#!/usr/bin/env python3
"""
Syncs OpenSea listing prices from report CSVs -> www/gallery.json

Source: local report CSV {collection_id}_raport.csv (reporting pipeline)
Target: current_price_{currency}, listing_status, opensea_url

Note:   the price column in the report = price per 1 item (not the whole batch value).

Generate a fresh report first with the local OpenSea report step
(needs OPENSEA_API_KEY), e.g. for avalanche_nature_stories.
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
STUDIO = SCRIPT_DIR.parent
REPORTS_DIR = STUDIO / "raportowanie" / "raporty"
COLLECTIONS_JSON = STUDIO / "raportowanie" / "kolekcje.json"
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
    data = load_json(COLLECTIONS_JSON)
    out: dict[str, dict] = {}
    for col in data.get("collections", []):
        contract = str(col.get("contract") or "").strip()
        if not contract:
            continue
        out[contract.lower()] = col
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


def load_report_index(report_path: Path) -> dict[tuple[str, str, str], dict]:
    index: dict[tuple[str, str, str], dict] = {}
    with report_path.open(encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            key = (
                row["chain"],
                row["contract"].lower(),
                str(row["token_id"]),
            )
            index[key] = row
    return index


def resolve_report_path(collection_id: str) -> Path:
    path = REPORTS_DIR / f"{collection_id}_raport.csv"
    if not path.exists():
        raise SystemExit(
            f"Report missing: {path}\n"
            f"Run the local OpenSea report step for {collection_id} first."
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
        raise SystemExit("gallery.json has no NFTs.")

    inferred_ids: set[str] = set()
    for nft in nfts:
        key = nft_key(nft, contract_map)
        if key:
            col = contract_map.get(key[1])
            if col:
                inferred_ids.add(col["id"])

    if collection_id:
        report_ids = [collection_id]
    elif len(inferred_ids) == 1:
        report_ids = [next(iter(inferred_ids))]
    else:
        report_ids = sorted(inferred_ids)

    indexes: dict[str, dict] = {}
    for rid in report_ids:
        indexes[rid] = load_report_index(resolve_report_path(rid))

    updated = 0
    listed = 0
    missing = 0

    for nft in nfts:
        key = nft_key(nft, contract_map)
        if not key:
            missing += 1
            continue

        col = contract_map.get(key[1])
        report_row = None
        if col and col["id"] in indexes:
            report_row = indexes[col["id"]].get(key)
        if report_row is None:
            for idx in indexes.values():
                if key in idx:
                    report_row = idx[key]
                    break

        if report_row is None:
            missing += 1
            continue

        if col:
            nft.setdefault("chain", col["chain"])
            nft.setdefault("contract_address", col["contract"])
            nft.setdefault("collection_id", col["id"])

        currency = (report_row.get("currency") or "").strip()
        if currency and currency != "N/A":
            nft["listing_currency"] = currency

        listing_status = report_row.get("listing_status", "")
        nft["listing_status"] = listing_status

        price = parse_price(report_row.get("price", ""))
        if currency and currency != "N/A":
            field = price_field_name(currency)
            if listing_status == "For Sale" and price is not None:
                nft[field] = price
                listed += 1
            else:
                nft[field] = None

        if report_row.get("opensea_url"):
            nft["opensea_url"] = report_row["opensea_url"]

        if report_row.get("name"):
            nft["name"] = report_row["name"]

        updated += 1

    info = gallery.setdefault("collection_info", {})
    if report_ids:
        info["collection_id"] = report_ids[0] if len(report_ids) == 1 else report_ids
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
        description="Update gallery.json with prices from OpenSea reports (local reporting pipeline)."
    )
    parser.add_argument(
        "--gallery",
        type=Path,
        default=DEFAULT_GALLERY,
        help=f"Path to gallery.json (default: {DEFAULT_GALLERY})",
    )
    parser.add_argument(
        "--collection",
        dest="collection_id",
        help="collection_id from the collections config (e.g. avalanche_nature_stories)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show a summary without writing",
    )
    args = parser.parse_args()

    gallery_path = args.gallery.resolve()
    gallery = load_json(gallery_path)

    updated, listed, missing = sync_gallery(
        gallery,
        collection_id=args.collection_id,
        dry_run=args.dry_run,
    )

    print(f"Gallery: {gallery_path}")
    print(f"Updated entries: {updated}")
    print(f"With an active listing (price): {listed}")
    if missing:
        print(f"No match in the report: {missing}")

    if args.dry_run:
        print("\n[dry-run] gallery.json not written")
        for nft in gallery.get("nfts", [])[:5]:
            tid = nft.get("token_id")
            cur = nft.get("listing_currency", "?")
            field = price_field_name(cur) if cur != "?" else "current_price_*"
            price = nft.get(field) if field in nft else None
            print(f"  token {tid}: {nft.get('listing_status')} -> {price} {cur}")
    else:
        save_json(gallery_path, gallery)
        print(f"\nSaved: {gallery_path}")


if __name__ == "__main__":
    main()