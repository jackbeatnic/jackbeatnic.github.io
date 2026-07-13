#!/usr/bin/env python3
"""Sync JB AI Play → ai_play_gallery.json (Polygon + Base Manifold).

Źródła (w kolejności):
  1. raportowanie/raporty/{collection_id}_raport.csv (ceny OpenSea)
  2. Skan on-chain ERC-1155 totalSupply (metadane z token URI)

Usage:
  python3 aktualizuj_ai_play_do_galerii.py
  python3 aktualizuj_ai_play_do_galerii.py --dry-run
  python3 aktualizuj_ai_play_do_galerii.py --max-scan 250
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from web3 import Web3

ROOT = Path(__file__).resolve().parent
JB_NFT = ROOT.parent
KOLEKCJE_JSON = JB_NFT / "raportowanie" / "kolekcje.json"
RAPORTY_DIR = JB_NFT / "raportowanie" / "raporty"
MAIN_GALLERY_JSON = ROOT / "gallery.json"
AI_PLAY_JSON = ROOT / "ai_play_gallery.json"

PLAY_COLLECTIONS = ("polygon_jb_ai_play", "base_jb_ai_play")
TOKEN_ID_BASE = {
    "polygon_jb_ai_play": 700_000_000,
    "base_jb_ai_play": 710_000_000,
}
MANIFOLD_HUB = "https://manifold.xyz/@jbeatnic/contract/231786736"

RPC = {
    "polygon": "https://polygon-bor.publicnode.com",
    "base": "https://mainnet.base.org",
}

ERC1155_ABI = [
    {
        "inputs": [{"name": "id", "type": "uint256"}],
        "name": "totalSupply",
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [{"name": "tokenId", "type": "uint256"}],
        "name": "uri",
        "outputs": [{"name": "", "type": "string"}],
        "stateMutability": "view",
        "type": "function",
    },
]

OPENSEA_CHAIN = {"polygon": "matic", "base": "base", "avalanche": "avalanche"}


def load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def save_json(path: Path, data: dict) -> None:
    with path.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
        fh.write("\n")


def ipfs_to_http(url: str) -> str:
    if not url:
        return ""
    if url.startswith("ipfs://"):
        return f"https://ipfs.io/ipfs/{url[7:]}"
    if url.startswith("ar://"):
        return f"https://arweave.net/{url[4:]}"
    return url


def fetch_json_url(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "JackBeatnicGallery/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def stable_gallery_token_id(collection_id: str, onchain_id: int) -> int:
    return TOKEN_ID_BASE[collection_id] + int(onchain_id)


def load_collections() -> dict[str, dict]:
    data = load_json(KOLEKCJE_JSON)
    out = {}
    for row in data.get("collections", []):
        if row.get("id") in PLAY_COLLECTIONS:
            out[row["id"]] = row
    return out


def load_raport_index(collection_id: str) -> dict[str, dict]:
    path = RAPORTY_DIR / f"{collection_id}_raport.csv"
    if not path.exists():
        return {}
    index: dict[str, dict] = {}
    with path.open(encoding="utf-8", newline="") as fh:
        for row in csv.DictReader(fh):
            index[str(row.get("token_id", ""))] = row
    return index


def rpc_call(fn, *, retries: int = 6, base_wait: float = 2.0):
    last_exc: Exception | None = None
    for attempt in range(retries):
        try:
            return fn()
        except Exception as exc:
            last_exc = exc
            msg = str(exc).lower()
            if "429" in msg or "too many requests" in msg or "timeout" in msg:
                time.sleep(base_wait * (attempt + 1))
                continue
            raise
    raise last_exc  # type: ignore[misc]


def scan_minted_ids(w3: Web3, contract: str, max_scan: int, delay: float) -> list[int]:
    ct = w3.eth.contract(address=Web3.to_checksum_address(contract), abi=ERC1155_ABI)
    minted: list[int] = []
    for tid in range(1, max_scan + 1):
        try:
            supply = rpc_call(lambda: ct.functions.totalSupply(tid).call())
            if supply > 0:
                minted.append(tid)
        except Exception:
            pass
        if tid % 10 == 0:
            time.sleep(delay)
    return minted


def token_metadata(w3: Web3, contract: str, token_id: int) -> dict:
    ct = w3.eth.contract(address=Web3.to_checksum_address(contract), abi=ERC1155_ABI)
    uri = rpc_call(lambda: ct.functions.uri(token_id).call())
    if "{id}" in uri:
        hex_id = hex(token_id)[2:].zfill(64)
        uri = uri.replace("{id}", hex_id)
    meta_url = ipfs_to_http(uri)
    if not meta_url:
        return {}
    try:
        return fetch_json_url(meta_url)
    except (urllib.error.URLError, json.JSONDecodeError, TimeoutError):
        return {}


def parse_price(value: str) -> float | None:
    if not value or value in ("N/A", "Not Listed", ""):
        return None
    try:
        return float(value)
    except ValueError:
        return None


def opensea_asset_url(chain: str, contract: str, token_id: int) -> str:
    slug = OPENSEA_CHAIN.get(chain, chain)
    return f"https://opensea.io/assets/{slug}/{contract}/{token_id}"


def build_entry(
    *,
    collection: dict,
    onchain_id: int,
    meta: dict,
    raport_row: dict | None,
    old: dict | None,
) -> dict:
    col_id = collection["id"]
    chain = collection["chain"]
    contract = collection["contract"].lower()
    name = (raport_row or {}).get("name") or meta.get("name") or f"AI Play #{onchain_id}"
    description = (meta.get("description") or "").strip()
    image_url = ipfs_to_http(meta.get("image") or meta.get("image_url") or "")

    listing_status = (raport_row or {}).get("listing_status") or "Not Listed"
    currency = ((raport_row or {}).get("currency") or "").strip()
    price = parse_price((raport_row or {}).get("price", ""))

    opensea_url = (raport_row or {}).get("opensea_url") or opensea_asset_url(
        chain, contract, onchain_id
    )
    manifold_url = ""
    if col_id == "base_jb_ai_play":
        manifold_url = f"{MANIFOLD_HUB}/{onchain_id}"

    entry = {
        "token_id": stable_gallery_token_id(col_id, onchain_id),
        "onchain_token_id": onchain_id,
        "name": name.strip(),
        "opensea_url": opensea_url,
        "manifold_url": manifold_url or None,
        "marketplace_url": manifold_url or opensea_url,
        "image_url": image_url,
        "supply": 1,
        "traits": {},
        "ai": {
            "description": description or f"{name} — JB AI Play on {chain}.",
            "dominant_colors": [],
            "vibe_tags": ["ai play", "experimental", chain],
            "category": "ai_play",
            "keywords": ["ai play", "jack beatnic", chain],
        },
        "likes_count": 0,
        "status": "minted",
        "chain": chain,
        "contract_address": contract,
        "collection_id": col_id,
        "listing_status": listing_status,
        "listing_currency": currency or ("ETH" if chain == "base" else "POL"),
        "display_rank": onchain_id,
        "medium": "ai_art",
        "ai_series": "jb_ai_play",
        "source": "manifold" if col_id == "base_jb_ai_play" else "opensea",
        "marketplace": "manifold" if col_id == "base_jb_ai_play" else "opensea",
    }

    if listing_status == "For Sale" and price is not None and currency:
        entry[f"current_price_{currency.lower()}"] = price

    if old:
        if old.get("likes_count") not in (None, ""):
            entry["likes_count"] = old["likes_count"]
        for key in ("share_url", "og_image"):
            if old.get(key):
                entry[key] = old[key]
        if old.get("ai", {}).get("dominant_colors") and not entry["ai"]["dominant_colors"]:
            entry["ai"]["dominant_colors"] = old["ai"]["dominant_colors"]

    entry["manifold_url"] = manifold_url or entry.get("manifold_url")
    if not entry.get("manifold_url"):
        entry.pop("manifold_url", None)

    return entry


def sync_collection(
    collection: dict,
    *,
    max_scan: int,
    scan_delay: float,
    meta_delay: float,
    old_by_key: dict[tuple[str, int], dict],
) -> list[dict]:
    col_id = collection["id"]
    chain = collection["chain"]
    contract = collection["contract"]

    print(f"[ai_play] {col_id} ({chain})")
    w3 = Web3(Web3.HTTPProvider(RPC[chain], request_kwargs={"timeout": 60}))
    raport = load_raport_index(col_id)
    if raport:
        print(f"  raport CSV: {len(raport)} wierszy")
    else:
        print("  raport CSV: brak (tylko on-chain)")

    minted = scan_minted_ids(w3, contract, max_scan, scan_delay)
    print(f"  on-chain minted: {len(minted)} tokenów")

    entries: list[dict] = []
    for onchain_id in minted:
        meta = token_metadata(w3, contract, onchain_id)
        time.sleep(meta_delay)
        row = raport.get(str(onchain_id))
        old = old_by_key.get((col_id, onchain_id))
        entries.append(
            build_entry(
                collection=collection,
                onchain_id=onchain_id,
                meta=meta,
                raport_row=row,
                old=old,
            )
        )

    entries.sort(key=lambda e: (e["collection_id"], e.get("onchain_token_id", 0)))
    return entries


def sync(
    *,
    dry_run: bool = False,
    max_scan: int = 250,
    scan_delay: float = 0.08,
    meta_delay: float = 0.15,
    only: str | None = None,
) -> int:
    collections = load_collections()
    if len(collections) < len(PLAY_COLLECTIONS):
        missing = set(PLAY_COLLECTIONS) - set(collections)
        raise SystemExit(f"Brak kolekcji w kolekcje.json: {', '.join(sorted(missing))}")

    old_data = load_json(AI_PLAY_JSON) if AI_PLAY_JSON.exists() else {}
    old_by_key = {
        (row["collection_id"], int(row["onchain_token_id"])): row
        for row in old_data.get("nfts") or []
        if row.get("collection_id") and row.get("onchain_token_id") is not None
    }

    col_ids = list(PLAY_COLLECTIONS)
    if only:
        if only not in collections:
            raise SystemExit(f"Nieznana kolekcja: {only}")
        col_ids = [only]
        keep = [
            row
            for row in old_data.get("nfts") or []
            if row.get("collection_id") != only
        ]
    else:
        keep = []

    all_entries: list[dict] = list(keep)
    for col_id in col_ids:
        all_entries.extend(
            sync_collection(
                collections[col_id],
                max_scan=max_scan,
                scan_delay=scan_delay,
                meta_delay=meta_delay,
                old_by_key=old_by_key,
            )
        )

    payload = {
        "collection_info": {
            "ai_series": "jb_ai_play",
            "label": "JB AI Play",
            "last_ai_play_sync": datetime.now(timezone.utc)
            .replace(microsecond=0)
            .isoformat()
            .replace("+00:00", "Z"),
            "token_count": len(all_entries),
        },
        "nfts": all_entries,
    }

    print(f"[ai_play] Gotowe: {len(all_entries)} tokenów")

    if dry_run:
        print("[dry-run] Bez zapisu ai_play_gallery.json")
        return 0

    save_json(AI_PLAY_JSON, payload)
    print(f"[ai_play] Zapisano: {AI_PLAY_JSON}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Sync JB AI Play → ai_play_gallery.json")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--max-scan", type=int, default=250)
    parser.add_argument("--scan-delay", type=float, default=0.08)
    parser.add_argument("--meta-delay", type=float, default=0.15)
    parser.add_argument(
        "--only",
        choices=PLAY_COLLECTIONS,
        help="Sync a single collection (merge with existing JSON)",
    )
    args = parser.parse_args(argv)
    return sync(
        dry_run=args.dry_run,
        max_scan=args.max_scan,
        scan_delay=args.scan_delay,
        meta_delay=args.meta_delay,
        only=args.only,
    )


if __name__ == "__main__":
    raise SystemExit(main())