#!/usr/bin/env python3
"""Sync Based AI vol.1 + vol.2 → based_ai_gallery.json (Base).

Jeden plik, jeden nurt (ai_series: based_ai) — bez osobnych zakładek w UI.

  vol.1  base_jb_based_ai      ERC-721  ~751×1/1  Manifold + OpenSea
  vol.2  base_jb_based_ai_vol2 ERC-1155 ~500 ed.  OpenSea

Źródła:
  - raportowanie/raporty/{collection_id}_raport.csv (gdy jest — preferowane)
  - zapasowo: skan on-chain (ownerOf / totalSupply)
  - obrazy: scrape OpenSea seadn.io ?w=1000

Usage:
  ./venv/bin/python3 aktualizuj_based_ai_do_galerii.py
  ./venv/bin/python3 aktualizuj_based_ai_do_galerii.py --workers 16
  ./venv/bin/python3 aktualizuj_based_ai_do_galerii.py --skip-images
  ./venv/bin/python3 aktualizuj_based_ai_do_galerii.py --vol vol2 --dry-run
"""

from __future__ import annotations

import argparse
import csv
import json
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
OUTPUT_JSON = ROOT / "based_ai_gallery.json"

AI_SERIES = "based_ai"
MANIFOLD_CREATOR = "@jbeatnic"
MANIFOLD_ID_DEFAULT = "231786736"
SEADN_DISPLAY_WIDTH = 1000
CHAIN = "base"

RPC = {"base": "https://base-rpc.publicnode.com"}

VOL1_ID = "base_jb_based_ai"
VOL2_ID = "base_jb_based_ai_vol2"

SEADN_RE = re.compile(
    r"https://i2c\.seadn\.io/base/[a-fA-F0-9]+/[a-f0-9]+/[a-f0-9]+\.(?:jpe?g|png|gif|webp)(?:\?w=\d+)?",
    re.I,
)
TITLE_RE = re.compile(r"<title>([^<]+)</title>", re.I)

ERC721_ABI = [
    {
        "inputs": [{"name": "tokenId", "type": "uint256"}],
        "name": "ownerOf",
        "outputs": [{"name": "", "type": "address"}],
        "stateMutability": "view",
        "type": "function",
    }
]

ERC1155_ABI = [
    {
        "inputs": [{"name": "id", "type": "uint256"}],
        "name": "totalSupply",
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    }
]


def load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def save_json(path: Path, data: dict) -> None:
    with path.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
        fh.write("\n")


def load_collection(collection_id: str) -> dict:
    data = load_json(KOLEKCJE_JSON)
    for row in data.get("collections", []):
        if row.get("id") == collection_id:
            return row
    raise SystemExit(f"Brak {collection_id} w kolekcje.json")


def rpc_call(fn, *, retries: int = 4):
    last_exc = None
    for attempt in range(retries):
        try:
            return fn()
        except Exception as exc:
            last_exc = exc
            time.sleep(0.4 * (attempt + 1))
    raise last_exc  # type: ignore[misc]


def parse_price(value: str) -> float | None:
    if not value or value in ("N/A", "Not Listed", ""):
        return None
    try:
        return float(value)
    except ValueError:
        return None


def normalize_seadn_image_url(url: str) -> str:
    if not url or "seadn.io" not in url:
        return url
    base = url.split("?", 1)[0]
    return f"{base}?w={SEADN_DISPLAY_WIDTH}"


def pick_seadn_image(html: str) -> str:
    matches = SEADN_RE.findall(html)
    if not matches:
        return ""
    for img in matches:
        if f"?w={SEADN_DISPLAY_WIDTH}" in img:
            return normalize_seadn_image_url(img)
    for img in matches:
        if "?w=" in img:
            return normalize_seadn_image_url(img)
    return normalize_seadn_image_url(matches[0])


def parse_opensea_title(title: str) -> str:
    raw = title.split("|")[0].strip()
    if " - " in raw:
        raw = raw.split(" - ", 1)[0].strip()
    raw = re.sub(r"\s+#\d+\s*$", "", raw).strip()
    return raw or ""


def opensea_asset_url(contract: str, token_id: int) -> str:
    return f"https://opensea.io/assets/base/{contract}/{token_id}"


def manifold_token_url(manifold_id: str, token_id: int) -> str:
    return (
        f"https://manifold.xyz/{MANIFOLD_CREATOR}/contract/{manifold_id}/{token_id}"
    )


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
    image = pick_seadn_image(html)
    return name, image


def load_raport_rows(collection_id: str) -> dict[int, dict]:
    path = RAPORTY_DIR / f"{collection_id}_raport.csv"
    if not path.exists():
        return {}
    rows: dict[int, dict] = {}
    with path.open(encoding="utf-8", newline="") as fh:
        for row in csv.DictReader(fh):
            try:
                tid = int(row.get("token_id", 0))
            except (TypeError, ValueError):
                continue
            if tid > 0:
                rows[tid] = row
    return rows


def scan_erc721_minted(w3: Web3, contract: str, *, max_scan: int) -> list[int]:
    ct = w3.eth.contract(address=Web3.to_checksum_address(contract), abi=ERC721_ABI)
    minted: list[int] = []
    for tid in range(1, max_scan + 1):
        try:
            rpc_call(lambda t=tid: ct.functions.ownerOf(t).call())
            minted.append(tid)
        except Exception:
            pass
        if tid % 100 == 0:
            print(f"  skan ownerOf… {tid}/{max_scan} ({len(minted)} minted)")
            time.sleep(0.15)
    return minted


def scan_erc1155_minted(w3: Web3, contract: str, *, max_scan: int) -> dict[int, int]:
    ct = w3.eth.contract(address=Web3.to_checksum_address(contract), abi=ERC1155_ABI)
    minted: dict[int, int] = {}
    for tid in range(1, max_scan + 1):
        try:
            supply = int(rpc_call(lambda t=tid: ct.functions.totalSupply(t).call()))
        except Exception:
            supply = 0
        if supply > 0:
            minted[tid] = supply
        if tid % 50 == 0:
            print(f"  skan totalSupply… {tid}/{max_scan} ({len(minted)} typów)")
            time.sleep(0.2)
    return minted


def enrich_images(
    contract: str,
    token_ids: list[int],
    *,
    workers: int,
    old_by_id: dict[int, dict],
    retries: int = 2,
) -> dict[int, str]:
    results: dict[int, str] = {}
    for tid in token_ids:
        old_img = (old_by_id.get(tid) or {}).get("image_url") or ""
        if old_img and "seadn.io" in old_img:
            results[tid] = normalize_seadn_image_url(old_img)

    pending = [tid for tid in token_ids if tid not in results]

    def scrape_pass(ids: list[int], pass_workers: int, label: str) -> None:
        done = 0
        with ThreadPoolExecutor(max_workers=pass_workers) as pool:
            futures = {
                pool.submit(fetch_opensea_page, contract, tid): tid for tid in ids
            }
            for fut in as_completed(futures):
                tid = futures[fut]
                try:
                    _, image = fut.result()
                except Exception:
                    image = ""
                if image:
                    results[tid] = image
                done += 1
                if done % 75 == 0:
                    print(f"  {label}… {done}/{len(ids)} ({len(results)} z obrazem)")

    if pending:
        scrape_pass(pending, workers, "OpenSea scrape")
        for attempt in range(1, retries + 1):
            missing = [tid for tid in token_ids if tid not in results]
            if not missing:
                break
            time.sleep(3 * attempt)
            scrape_pass(missing, max(4, workers // 2), f"retry {attempt}")
    return results


def build_vol1_entry(
    *,
    tid: int,
    contract: str,
    manifold_id: str,
    name: str,
    image_url: str,
    raport: dict | None,
    old: dict | None,
) -> dict | None:
    if not image_url:
        return None

    display_name = (
        name
        or (raport or {}).get("name")
        or f"JB Based AI #{tid}"
    ).strip()
    opensea_url = (raport or {}).get("opensea_url") or opensea_asset_url(contract, tid)
    manifold_url = manifold_token_url(manifold_id, tid)

    listing_status = (raport or {}).get("listing_status") or "Not Listed"
    currency = ((raport or {}).get("currency") or "ETH").strip()
    price = parse_price((raport or {}).get("price", ""))

    entry: dict = {
        "token_id": tid,
        "onchain_token_id": tid,
        "name": display_name,
        "opensea_url": opensea_url,
        "manifold_url": manifold_url,
        "marketplace_url": manifold_url,
        "image_url": image_url,
        "supply": 1,
        "edition_label": "1/1",
        "subseries": "vol1",
        "traits": {},
        "ai": {
            "description": "",
            "dominant_colors": [],
            "vibe_tags": ["based ai", "base", "1/1", "ai art"],
            "category": "based_ai",
            "keywords": ["based ai", "jack beatnic", "base"],
        },
        "likes_count": 0,
        "status": "listed" if listing_status == "For Sale" else "minted",
        "chain": CHAIN,
        "contract_address": contract.lower(),
        "collection_id": VOL1_ID,
        "listing_status": listing_status,
        "listing_currency": currency,
        "display_rank": tid,
        "medium": "ai_art",
        "ai_series": AI_SERIES,
        "source": "dual",
        "marketplace": "dual",
        "marketplaces": ["manifold", "opensea"],
    }

    if listing_status == "For Sale" and price is not None:
        entry[f"current_price_{currency.lower()}"] = price
        entry["opensea_price_eth"] = price

    if old:
        _merge_preserved(old, entry)
    return entry


def build_vol2_entry(
    *,
    tid: int,
    contract: str,
    supply: int,
    name: str,
    image_url: str,
    raport: dict | None,
    old: dict | None,
) -> dict | None:
    if not image_url:
        return None

    display_name = (
        name
        or (raport or {}).get("name")
        or f"JB Based AI vol. 2 #{tid}"
    ).strip()
    opensea_url = (raport or {}).get("opensea_url") or opensea_asset_url(contract, tid)

    listing_status = (raport or {}).get("listing_status") or "Not Listed"
    currency = ((raport or {}).get("currency") or "ETH").strip()
    price = parse_price((raport or {}).get("price", ""))

    entry: dict = {
        "token_id": tid,
        "onchain_token_id": tid,
        "name": display_name,
        "opensea_url": opensea_url,
        "marketplace_url": opensea_url,
        "image_url": image_url,
        "supply": supply,
        "edition_label": f"×{supply}",
        "subseries": "vol2",
        "traits": {},
        "ai": {
            "description": "",
            "dominant_colors": [],
            "vibe_tags": ["based ai", "base", "edition", "ai art"],
            "category": "based_ai",
            "keywords": ["based ai", "jack beatnic", "base", "vol. 2"],
        },
        "likes_count": 0,
        "status": "listed" if listing_status == "For Sale" else "minted",
        "chain": CHAIN,
        "contract_address": contract.lower(),
        "collection_id": VOL2_ID,
        "listing_status": listing_status,
        "listing_currency": currency,
        "display_rank": 10_000 + tid,
        "medium": "ai_art",
        "ai_series": AI_SERIES,
        "source": "opensea",
        "marketplace": "opensea",
    }

    if listing_status == "For Sale" and price is not None:
        entry[f"current_price_{currency.lower()}"] = price

    if old:
        _merge_preserved(old, entry)
    return entry


def _merge_preserved(old: dict, entry: dict) -> None:
    if old.get("likes_count") not in (None, ""):
        entry["likes_count"] = old["likes_count"]
    for key in ("share_url", "og_image"):
        if old.get(key):
            entry[key] = old[key]
    if old.get("ai", {}).get("dominant_colors") and not entry["ai"]["dominant_colors"]:
        entry["ai"]["dominant_colors"] = old["ai"]["dominant_colors"]
    if (old.get("ai", {}).get("description") or "").strip():
        entry["ai"]["description"] = old["ai"]["description"]


def sync_vol1(
    *,
    w3: Web3,
    workers: int,
    skip_images: bool,
    old_by_key: dict[tuple[str, int], dict],
) -> list[dict]:
    collection = load_collection(VOL1_ID)
    contract = collection["contract"].lower()
    manifold_id = str(collection.get("manifold_id") or MANIFOLD_ID_DEFAULT)
    max_scan = int(collection.get("max_token_id") or 800)

    print(f"[based_ai vol.1] {VOL1_ID} · contract={contract}")

    raport = load_raport_rows(VOL1_ID)
    if raport:
        token_ids = sorted(raport.keys())
        print(f"  raport CSV: {len(token_ids)} tokenów")
    else:
        print(f"  brak raportu — skan ownerOf 1..{max_scan}")
        token_ids = scan_erc721_minted(w3, contract, max_scan=max_scan)
        print(f"  on-chain minted: {len(token_ids)}")

    old_vol1 = {
        int(row["onchain_token_id"]): row
        for key, row in old_by_key.items()
        if key[0] == VOL1_ID and row.get("onchain_token_id") is not None
    }

    images: dict[int, str] = {}
    if skip_images:
        for tid in token_ids:
            old_img = (old_vol1.get(tid) or {}).get("image_url") or ""
            if old_img:
                images[tid] = normalize_seadn_image_url(old_img)
    else:
        print("  pobieram obrazy ze stron OpenSea (seadn.io ?w=1000)…")
        images = enrich_images(
            contract, token_ids, workers=workers, old_by_id=old_vol1
        )

    entries: list[dict] = []
    skipped = 0
    for tid in token_ids:
        entry = build_vol1_entry(
            tid=tid,
            contract=contract,
            manifold_id=manifold_id,
            name="",
            image_url=images.get(tid, ""),
            raport=raport.get(tid),
            old=old_vol1.get(tid),
        )
        if entry is None:
            skipped += 1
        else:
            entries.append(entry)

    print(f"  vol.1 w galerii: {len(entries)} · pominięto bez obrazu: {skipped}")
    return entries


def sync_vol2(
    *,
    w3: Web3,
    workers: int,
    skip_images: bool,
    old_by_key: dict[tuple[str, int], dict],
) -> list[dict]:
    collection = load_collection(VOL2_ID)
    contract = collection["contract"].lower()
    max_scan = int(collection.get("max_token_id") or 520)

    print(f"[based_ai vol.2] {VOL2_ID} · contract={contract}")

    raport = load_raport_rows(VOL2_ID)
    supplies: dict[int, int] = {}

    if raport:
        for tid, row in raport.items():
            try:
                supplies[tid] = int(row.get("supply") or row.get("max_supply") or 0)
            except (TypeError, ValueError):
                supplies[tid] = 0
            if supplies[tid] <= 0:
                supplies[tid] = 500
        print(f"  raport CSV: {len(supplies)} typów")
    else:
        print(f"  brak raportu — skan totalSupply 1..{max_scan}")
        supplies = scan_erc1155_minted(w3, contract, max_scan=max_scan)
        print(f"  on-chain typów: {len(supplies)}")

    token_ids = sorted(supplies.keys())

    old_vol2 = {
        int(row["onchain_token_id"]): row
        for key, row in old_by_key.items()
        if key[0] == VOL2_ID and row.get("onchain_token_id") is not None
    }

    images: dict[int, str] = {}
    if skip_images:
        for tid in token_ids:
            old_img = (old_vol2.get(tid) or {}).get("image_url") or ""
            if old_img:
                images[tid] = normalize_seadn_image_url(old_img)
    else:
        print("  pobieram obrazy ze stron OpenSea (seadn.io ?w=1000)…")
        images = enrich_images(
            contract, token_ids, workers=workers, old_by_id=old_vol2
        )

    entries: list[dict] = []
    skipped = 0
    for tid in token_ids:
        entry = build_vol2_entry(
            tid=tid,
            contract=contract,
            supply=supplies[tid],
            name="",
            image_url=images.get(tid, ""),
            raport=raport.get(tid) if raport else None,
            old=old_vol2.get(tid),
        )
        if entry is None:
            skipped += 1
        else:
            entries.append(entry)

    print(f"  vol.2 w galerii: {len(entries)} · pominięto bez obrazu: {skipped}")
    return entries


def sync(
    *,
    dry_run: bool = False,
    workers: int = 12,
    skip_images: bool = False,
    vol: str = "all",
) -> int:
    old_data = load_json(OUTPUT_JSON) if OUTPUT_JSON.exists() else {}
    old_by_key: dict[tuple[str, int], dict] = {}
    for row in old_data.get("nfts") or []:
        col = row.get("collection_id") or ""
        try:
            tid = int(row.get("onchain_token_id"))
        except (TypeError, ValueError):
            continue
        if col and tid:
            old_by_key[(col, tid)] = row

    w3 = Web3(Web3.HTTPProvider(RPC["base"], request_kwargs={"timeout": 60}))

    entries: list[dict] = []
    vol1_count = 0
    vol2_count = 0

    if vol in ("all", "vol1"):
        vol1_entries = sync_vol1(
            w3=w3,
            workers=workers,
            skip_images=skip_images,
            old_by_key=old_by_key,
        )
        entries.extend(vol1_entries)
        vol1_count = len(vol1_entries)

    if vol in ("all", "vol2"):
        vol2_entries = sync_vol2(
            w3=w3,
            workers=workers,
            skip_images=skip_images,
            old_by_key=old_by_key,
        )
        entries.extend(vol2_entries)
        vol2_count = len(vol2_entries)

    entries.sort(key=lambda e: (e.get("display_rank", 0), e.get("onchain_token_id", 0)))

    payload = {
        "collection_info": {
            "ai_series": AI_SERIES,
            "label": "Based AI",
            "chain": CHAIN,
            "collections": [VOL1_ID, VOL2_ID],
            "vol1": {
                "collection_id": VOL1_ID,
                "standard": "erc721",
                "marketplaces": ["manifold", "opensea"],
                "manifold_id": MANIFOLD_ID_DEFAULT,
            },
            "vol2": {
                "collection_id": VOL2_ID,
                "standard": "erc1155",
                "marketplaces": ["opensea"],
            },
            "image_source": "opensea",
            "seadn_display_width": SEADN_DISPLAY_WIDTH,
            "last_based_ai_sync": datetime.now(timezone.utc)
            .replace(microsecond=0)
            .isoformat()
            .replace("+00:00", "Z"),
            "token_count": len(entries),
            "vol1_count": vol1_count,
            "vol2_count": vol2_count,
        },
        "nfts": entries,
    }

    print(f"[based_ai] Gotowe: {len(entries)} tokenów (vol.1={vol1_count}, vol.2={vol2_count})")

    if dry_run:
        print("[dry-run] Bez zapisu based_ai_gallery.json")
        return 0

    save_json(OUTPUT_JSON, payload)
    print(f"[based_ai] Zapisano: {OUTPUT_JSON}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Sync Based AI vol.1 + vol.2 → based_ai_gallery.json"
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--skip-images", action="store_true")
    parser.add_argument("--workers", type=int, default=12)
    parser.add_argument(
        "--vol",
        choices=("all", "vol1", "vol2"),
        default="all",
        help="Którą kolekcję synchronizować (domyślnie obie)",
    )
    args = parser.parse_args(argv)
    return sync(
        dry_run=args.dry_run,
        workers=args.workers,
        skip_images=args.skip_images,
        vol=args.vol,
    )


if __name__ == "__main__":
    raise SystemExit(main())