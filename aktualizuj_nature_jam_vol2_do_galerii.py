#!/usr/bin/env python3
"""Sync Nature Jam vol.2 (ERC-1155) into nature_jam_gallery.json alongside vol.1.

Vol.1  avalanche_nature_jam       — leaves existing entries
Vol.2  avalanche_nature_jam_vol2  — from raport CSV + jb-nft-assets images

Images for vol.2:
  - prefer GH Pages media: …/jb-nft-assets/media/nature-jam-2/{id}.jpg
  - else image from meta JSON (ipfs:// → gateway)

Usage:
  python3 aktualizuj_nature_jam_vol2_do_galerii.py
  python3 aktualizuj_nature_jam_vol2_do_galerii.py --dry-run
"""
from __future__ import annotations

import argparse
import csv
import json
import re
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
JB = ROOT.parent
RAPORT = JB / "raportowanie" / "raporty" / "avalanche_nature_jam_vol2_raport.csv"
KOLEKCJE = JB / "raportowanie" / "kolekcje.json"
ASSETS_META = JB / "jb-nft-assets" / "meta" / "avalanche" / "nature-jam-2"
ASSETS_MEDIA = JB / "jb-nft-assets" / "media" / "nature-jam-2"
OUTPUT = ROOT / "nature_jam_gallery.json"

VOL2_ID = "avalanche_nature_jam_vol2"
VOL2_RANK_OFFSET = 10_000
PAGES_MEDIA = (
    "https://jackbeatnic.github.io/jb-nft-assets/media/nature-jam-2/{id}.jpg"
)


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def save_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def parse_price(value: str) -> float | None:
    if not value or value in ("N/A", "Not Listed", ""):
        return None
    try:
        return float(value)
    except ValueError:
        return None


def ipfs_to_http(uri: str) -> str:
    uri = (uri or "").strip()
    if uri.startswith("ipfs://"):
        return "https://dweb.link/ipfs/" + uri[len("ipfs://") :]
    return uri


def image_for_token(tid: int) -> str:
    local = ASSETS_MEDIA / f"{tid}.jpg"
    if local.exists():
        return PAGES_MEDIA.format(id=tid)
    meta_p = ASSETS_META / str(tid)
    if meta_p.exists():
        try:
            img = json.loads(meta_p.read_text(encoding="utf-8")).get("image") or ""
            return ipfs_to_http(img)
        except Exception:
            pass
    return ""


def load_raport() -> dict[int, dict]:
    if not RAPORT.exists():
        raise SystemExit(f"Brak raportu: {RAPORT}")
    out: dict[int, dict] = {}
    with RAPORT.open(encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            tid = int(row["token_id"])
            out[tid] = row
    return out


def contract_for_vol2() -> str:
    data = load_json(KOLEKCJE)
    for c in data.get("collections", []):
        if c.get("id") == VOL2_ID:
            return (c.get("contract") or "").lower()
    return "0xfeafbadf5f0fe4821ae34d1d379625e6a4acb55a"


def build_vol2_entry(tid: int, raport: dict, contract: str, old: dict | None) -> dict | None:
    image_url = image_for_token(tid)
    if not image_url and old:
        image_url = old.get("image_url") or ""
    if not image_url:
        return None

    name = (raport.get("name") or "").strip() or f"JB NJ #{tid + 786:04d}"
    price = parse_price((raport.get("price") or "").strip())
    listing_status = raport.get("listing_status") or "Not Listed"
    supply = int(float(raport.get("supply") or 3000))

    entry: dict = {
        "token_id": VOL2_RANK_OFFSET + tid,
        "onchain_token_id": tid,
        "name": name,
        "opensea_url": raport.get("opensea_url")
        or f"https://opensea.io/assets/avalanche/{contract}/{tid}",
        "marketplace_url": raport.get("opensea_url")
        or f"https://opensea.io/assets/avalanche/{contract}/{tid}",
        "image_url": image_url,
        "supply": supply,
        "edition_label": f"×{supply}" if supply > 1 else "1/1",
        "traits": {},
        "ai": {
            "description": "",
            "dominant_colors": [],
            "vibe_tags": ["nature jam", "vol2", "avalanche", "ai art"],
            "category": "nature_jam",
            "keywords": ["nature jam", "vol2", "jack beatnic", "avalanche"],
        },
        "likes_count": 0,
        "status": "listed" if listing_status == "For Sale" else "minted",
        "chain": "avalanche",
        "contract_address": contract,
        "collection_id": VOL2_ID,
        "listing_status": listing_status,
        "listing_currency": "AVAX",
        "display_rank": VOL2_RANK_OFFSET + tid,
        "medium": "ai_art",
        "ai_series": "nature_jam",
        "source": "opensea",
        "marketplace": "opensea",
        "subseries": "vol2",
    }
    if price is not None:
        entry["current_price_avax"] = price
        entry["opensea_price_avax"] = price
        # exclusive T0 reference for s=3000
        if supply == 3000:
            entry["system_price_t0_avax"] = 51.24

    if old:
        if old.get("likes_count") not in (None, ""):
            entry["likes_count"] = old["likes_count"]
        for key in ("share_url", "og_image"):
            if old.get(key):
                entry[key] = old[key]
        desc = (old.get("ai") or {}).get("description") or ""
        if desc.strip():
            entry["ai"]["description"] = desc
        colors = (old.get("ai") or {}).get("dominant_colors") or []
        if colors:
            entry["ai"]["dominant_colors"] = colors

    # description from assets meta if empty
    meta_p = ASSETS_META / str(tid)
    if meta_p.exists() and not (entry["ai"].get("description") or "").strip():
        try:
            md = json.loads(meta_p.read_text(encoding="utf-8"))
            if md.get("description"):
                entry["ai"]["description"] = md["description"]
        except Exception:
            pass

    return entry


def sync(*, dry_run: bool = False) -> int:
    contract = contract_for_vol2()
    raport = load_raport()
    print(f"[nj_vol2] raport tokens: {len(raport)} contract={contract}")

    old = load_json(OUTPUT) if OUTPUT.exists() else {}
    old_nfts = list(old.get("nfts") or [])

    # keep vol1 (not vol2)
    vol1 = [
        e
        for e in old_nfts
        if e.get("collection_id") != VOL2_ID and e.get("subseries") != "vol2"
    ]
    old_vol2 = {
        int(e.get("onchain_token_id") or 0): e
        for e in old_nfts
        if e.get("collection_id") == VOL2_ID or e.get("subseries") == "vol2"
    }

    vol2_entries: list[dict] = []
    skipped = 0
    for tid in sorted(raport.keys()):
        e = build_vol2_entry(tid, raport[tid], contract, old_vol2.get(tid))
        if e is None:
            skipped += 1
        else:
            vol2_entries.append(e)

    merged = vol1 + vol2_entries
    merged.sort(key=lambda e: e.get("display_rank") or e.get("onchain_token_id") or 0)

    info = dict(old.get("collection_info") or {})
    info.update(
        {
            "ai_series": "nature_jam",
            "label": "Nature Jam",
            "includes_vol2": True,
            "vol2_collection_id": VOL2_ID,
            "vol2_contract": contract,
            "vol2_token_count": len(vol2_entries),
            "vol1_token_count": len(vol1),
            "last_nature_jam_vol2_sync": datetime.now(timezone.utc)
            .replace(microsecond=0)
            .isoformat()
            .replace("+00:00", "Z"),
            "token_count": len(merged),
        }
    )

    payload = {"collection_info": info, "nfts": merged}
    print(
        f"[nj_vol2] vol1={len(vol1)} vol2={len(vol2_entries)} "
        f"skip_no_image={skipped} total={len(merged)}"
    )
    if dry_run:
        print("[dry-run] no write")
        return 0
    save_json(OUTPUT, payload)
    print(f"[nj_vol2] saved {OUTPUT}")
    return 0


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    raise SystemExit(sync(dry_run=args.dry_run))


if __name__ == "__main__":
    main()
