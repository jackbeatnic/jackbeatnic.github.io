#!/usr/bin/env python3
"""Sync JB AI Play → ai_play_gallery.json (Polygon OpenSea).

Domyślnie obrazy z publicznych stron OpenSea (seadn.io CDN) — bez OPENSEA_API_KEY.
Opcjonalnie: --images ipfs (on-chain uri) lub --images api (wymaga OPENSEA_API_KEY).

Usage:
  ./venv/bin/python3 aktualizuj_ai_play_do_galerii.py
  ./venv/bin/python3 aktualizuj_ai_play_do_galerii.py --workers 16
  ./venv/bin/python3 aktualizuj_ai_play_do_galerii.py --images api
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

from web3 import Web3

ROOT = Path(__file__).resolve().parent
JB_NFT = ROOT.parent
KOLEKCJE_JSON = JB_NFT / "raportowanie" / "kolekcje.json"
RAPORTY_DIR = JB_NFT / "raportowanie" / "raporty"
AI_PLAY_JSON = ROOT / "ai_play_gallery.json"

COLLECTION_ID = "polygon_jb_ai_play"
TOKEN_ID_BASE = 700_000_000
OPENSEA_SLUG = "jb-ai-play"

RPC = {"polygon": "https://polygon-bor.publicnode.com"}
OPENSEA_API = "https://api.opensea.io/api/v2"

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

SEADN_RE = re.compile(
    r"https://i2c\.seadn\.io/polygon/0xb7f10[a-fA-F0-9]+/[a-f0-9]+/[a-f0-9]+\.jpeg"
)
TITLE_RE = re.compile(r"<title>([^<]+)</title>", re.I)


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
        return f"https://dweb.link/ipfs/{url[7:]}"
    if url.startswith("ar://"):
        return f"https://arweave.net/{url[4:]}"
    return url


def load_collection() -> dict:
    data = load_json(KOLEKCJE_JSON)
    for row in data.get("collections", []):
        if row.get("id") == COLLECTION_ID:
            return row
    raise SystemExit(f"Brak {COLLECTION_ID} w kolekcje.json")


def default_max_scan(collection: dict) -> int:
    return int(collection.get("max_token_id") or 2084)


def load_raport_index() -> dict[str, dict]:
    path = RAPORTY_DIR / f"{COLLECTION_ID}_raport.csv"
    if not path.exists():
        return {}
    index: dict[str, dict] = {}
    with path.open(encoding="utf-8", newline="") as fh:
        for row in csv.DictReader(fh):
            index[str(row.get("token_id", ""))] = row
    return index


def rpc_call(fn, *, retries: int = 5, base_wait: float = 1.5):
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


def resolve_minted_ids(
    w3: Web3,
    contract: str,
    *,
    max_scan: int,
    dense_through: int | None,
) -> list[int]:
    ct = w3.eth.contract(address=Web3.to_checksum_address(contract), abi=ERC1155_ABI)

    if dense_through and dense_through > 0:
        try:
            if rpc_call(lambda: ct.functions.totalSupply(dense_through).call()) > 0:
                probe = dense_through + 1
                probe_supply = (
                    0
                    if probe > max_scan
                    else rpc_call(lambda: ct.functions.totalSupply(probe).call())
                )
                if probe_supply == 0:
                    print(f"  dense mint 1..{dense_through} (max_token_id)")
                    return list(range(1, dense_through + 1))
        except Exception:
            pass

    minted: list[int] = []
    for tid in range(1, max_scan + 1):
        try:
            if rpc_call(lambda t=tid: ct.functions.totalSupply(t).call()) > 0:
                minted.append(tid)
        except Exception:
            pass
        if tid % 200 == 0:
            print(f"  skan supply… {tid}/{max_scan} ({len(minted)} minted)")
    return minted


def parse_price(value: str) -> float | None:
    if not value or value in ("N/A", "Not Listed", ""):
        return None
    try:
        return float(value)
    except ValueError:
        return None


def opensea_asset_url(contract: str, token_id: int) -> str:
    return f"https://opensea.io/assets/matic/{contract}/{token_id}"


def parse_opensea_title(title: str) -> str:
    raw = title.split("|")[0].strip()
    if " - " in raw:
        raw = raw.split(" - ", 1)[0].strip()
    raw = re.sub(r"\s+#\d+\s*$", "", raw).strip()
    return raw or ""


def fetch_opensea_page(contract: str, token_id: int) -> tuple[str, str]:
    page_url = opensea_asset_url(contract, token_id)
    req = urllib.request.Request(
        page_url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; JackBeatnicGallery/1.0)",
            "Accept": "text/html",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            html = resp.read().decode("utf-8", errors="ignore")
    except (urllib.error.URLError, TimeoutError, OSError):
        return "", ""

    title_m = TITLE_RE.search(html)
    name = parse_opensea_title(title_m.group(1)) if title_m else ""
    imgs = SEADN_RE.findall(html)
    image = imgs[0] if imgs else ""
    return name, image


def fetch_ipfs_meta(w3: Web3, contract: str, token_id: int) -> dict:
    ct = w3.eth.contract(address=Web3.to_checksum_address(contract), abi=ERC1155_ABI)
    try:
        uri = rpc_call(lambda: ct.functions.uri(token_id).call())
    except Exception:
        return {}
    if "{id}" in uri:
        uri = uri.replace("{id}", hex(token_id)[2:].zfill(64))
    meta_url = ipfs_to_http(uri)
    if not meta_url:
        return {}
    try:
        req = urllib.request.Request(meta_url, headers={"User-Agent": "JackBeatnicGallery/1.0"})
        with urllib.request.urlopen(req, timeout=12) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, json.JSONDecodeError, TimeoutError, OSError):
        return {}


def fetch_opensea_api_nfts(api_key: str, slug: str) -> dict[int, dict]:
    headers = {"x-api-key": api_key, "accept": "application/json"}
    out: dict[int, dict] = {}
    cursor = None
    while True:
        url = f"{OPENSEA_API}/collection/{slug}/nfts?limit=200"
        if cursor:
            url += f"&next={cursor}"
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=90) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        for item in payload.get("nfts") or []:
            try:
                tid = int(item.get("identifier", 0))
            except (TypeError, ValueError):
                continue
            if tid > 0:
                out[tid] = item
        cursor = payload.get("next")
        if not cursor:
            break
        time.sleep(0.25)
    return out


def build_entry(
    *,
    onchain_id: int,
    contract: str,
    name: str,
    image_url: str,
    description: str,
    raport_row: dict | None,
    old: dict | None,
) -> dict | None:
    if not image_url:
        return None

    listing_status = (raport_row or {}).get("listing_status") or "Not Listed"
    currency = ((raport_row or {}).get("currency") or "").strip()
    price = parse_price((raport_row or {}).get("price", ""))
    opensea_url = (raport_row or {}).get("opensea_url") or opensea_asset_url(
        contract, onchain_id
    )
    display_name = name or (raport_row or {}).get("name") or f"AI Play #{onchain_id}"

    entry = {
        "token_id": TOKEN_ID_BASE + int(onchain_id),
        "onchain_token_id": onchain_id,
        "name": display_name.strip(),
        "opensea_url": opensea_url,
        "marketplace_url": opensea_url,
        "image_url": image_url,
        "supply": 1,
        "traits": {},
        "ai": {
            "description": description or f"{display_name} — JB AI Play on Polygon.",
            "dominant_colors": [],
            "vibe_tags": ["ai play", "experimental", "polygon"],
            "category": "ai_play",
            "keywords": ["ai play", "jack beatnic", "polygon"],
        },
        "likes_count": 0,
        "status": "minted",
        "chain": "polygon",
        "contract_address": contract.lower(),
        "collection_id": COLLECTION_ID,
        "listing_status": listing_status,
        "listing_currency": currency or "POL",
        "display_rank": onchain_id,
        "medium": "ai_art",
        "ai_series": "jb_ai_play",
        "source": "opensea",
        "marketplace": "opensea",
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

    return entry


def enrich_from_opensea_pages(
    contract: str,
    minted: list[int],
    *,
    workers: int,
    retries: int = 2,
) -> dict[int, tuple[str, str]]:
    results: dict[int, tuple[str, str]] = {tid: ("", "") for tid in minted}

    def scrape_pass(ids: list[int], pass_workers: int, label: str) -> None:
        done = 0
        with ThreadPoolExecutor(max_workers=pass_workers) as pool:
            futures = {pool.submit(fetch_opensea_page, contract, tid): tid for tid in ids}
            for fut in as_completed(futures):
                tid = futures[fut]
                try:
                    name, image = fut.result()
                except Exception:
                    name, image = "", ""
                if image or not results[tid][1]:
                    results[tid] = (name or results[tid][0], image or results[tid][1])
                done += 1
                if done % 100 == 0:
                    with_img = sum(1 for _, img in results.values() if img)
                    print(f"  {label}… {done}/{len(ids)} ({with_img} z obrazem)")

    scrape_pass(minted, workers, "OpenSea scrape")
    for attempt in range(1, retries + 1):
        missing = [tid for tid, (_, img) in results.items() if not img]
        if not missing:
            break
        time.sleep(3 * attempt)
        scrape_pass(
            missing,
            max(4, workers // 2),
            f"OpenSea retry {attempt}",
        )
    return results


def sync(
    *,
    dry_run: bool = False,
    max_scan: int | None = None,
    images: str = "opensea",
    workers: int = 12,
) -> int:
    collection = load_collection()
    if max_scan is None:
        max_scan = default_max_scan(collection)

    contract = collection["contract"]
    print(f"[ai_play] {COLLECTION_ID} polygon · images={images} · workers={workers}")

    old_data = load_json(AI_PLAY_JSON) if AI_PLAY_JSON.exists() else {}
    old_by_key = {
        int(row["onchain_token_id"]): row
        for row in old_data.get("nfts") or []
        if row.get("onchain_token_id") is not None
    }

    w3 = Web3(Web3.HTTPProvider(RPC["polygon"], request_kwargs={"timeout": 60}))
    raport = load_raport_index()
    if raport:
        print(f"  raport CSV: {len(raport)} wierszy")

    dense = collection.get("max_token_id")
    minted = resolve_minted_ids(
        w3,
        contract,
        max_scan=max_scan,
        dense_through=int(dense) if dense else None,
    )
    print(f"  on-chain minted: {len(minted)} tokenów")

    page_data: dict[int, tuple[str, str]] = {}
    api_data: dict[int, dict] = {}

    if images == "api":
        api_key = os.environ.get("OPENSEA_API_KEY", "").strip()
        if not api_key:
            raise SystemExit("Brak OPENSEA_API_KEY dla --images api")
        print("  pobieram metadane z OpenSea API…")
        api_data = fetch_opensea_api_nfts(api_key, OPENSEA_SLUG)
        print(f"  OpenSea API: {len(api_data)} tokenów")
    elif images == "opensea":
        print("  pobieram obrazy ze stron OpenSea (seadn.io)…")
        page_data = enrich_from_opensea_pages(contract, minted, workers=workers)
    elif images != "ipfs":
        raise SystemExit(f"Nieznany --images: {images}")

    entries: list[dict] = []
    skipped = 0
    for onchain_id in minted:
        name = ""
        image_url = ""
        description = ""

        if images == "api":
            item = api_data.get(onchain_id, {})
            name = str(item.get("name") or "")
            image_url = str(item.get("image_url") or item.get("display_image_url") or "")
            description = ""
        elif images == "opensea":
            name, image_url = page_data.get(onchain_id, ("", ""))
        elif images == "ipfs":
            meta = fetch_ipfs_meta(w3, contract, onchain_id)
            name = str(meta.get("name") or "")
            image_url = ipfs_to_http(meta.get("image") or meta.get("image_url") or "")
            description = str(meta.get("description") or "")

        row = raport.get(str(onchain_id))
        old = old_by_key.get(onchain_id)
        entry = build_entry(
            onchain_id=onchain_id,
            contract=contract,
            name=name,
            image_url=image_url,
            description=description,
            raport_row=row,
            old=old,
        )
        if entry is None:
            skipped += 1
        else:
            entries.append(entry)

    entries.sort(key=lambda e: e.get("onchain_token_id", 0))
    print(f"  pominięto bez obrazu: {skipped}")

    payload = {
        "collection_info": {
            "ai_series": "jb_ai_play",
            "label": "JB AI Play",
            "opensea_slug": OPENSEA_SLUG,
            "chain": "polygon",
            "contract": contract.lower(),
            "image_source": images,
            "last_ai_play_sync": datetime.now(timezone.utc)
            .replace(microsecond=0)
            .isoformat()
            .replace("+00:00", "Z"),
            "token_count": len(entries),
            "onchain_minted": len(minted),
        },
        "nfts": entries,
    }

    print(f"[ai_play] Gotowe: {len(entries)} tokenów w galerii")

    if dry_run:
        print("[dry-run] Bez zapisu ai_play_gallery.json")
        return 0

    save_json(AI_PLAY_JSON, payload)
    print(f"[ai_play] Zapisano: {AI_PLAY_JSON}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Sync JB AI Play → ai_play_gallery.json")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--max-scan", type=int, default=None)
    parser.add_argument(
        "--images",
        choices=("opensea", "api", "ipfs"),
        default="opensea",
        help="Skąd brać obrazy: opensea (strony, domyślnie), api, ipfs",
    )
    parser.add_argument("--workers", type=int, default=12)
    args = parser.parse_args(argv)
    return sync(
        dry_run=args.dry_run,
        max_scan=args.max_scan,
        images=args.images,
        workers=args.workers,
    )


if __name__ == "__main__":
    raise SystemExit(main())