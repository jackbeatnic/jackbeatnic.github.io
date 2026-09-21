#!/usr/bin/env python3
"""Import photography listings from Salvor / JackBeatnic → gallery.json.

Źródło: https://salvor.io/api/profile/{slug}/listings
Profil: JackBeatnic (fotografia — nie JackBeatnicAI)

Do galerii trafiają pozycje z aktywną ceną na Salvor (AVAX).
Gdy API Salvor zwraca pustą listę, skrypt kończy się bez zmian w JSON
(i wypisuje ostrzeżenie).

Usage:
  python3 aktualizuj_salvor_foto_do_galerii.py
  python3 aktualizuj_salvor_foto_do_galerii.py --dry-run
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
JB_NFT = ROOT.parent
GALLERY_JSON = ROOT / "gallery.json"
KOLEKCJE_JSON = JB_NFT / "raportowanie" / "kolekcje.json"
SALVOR_API = "https://salvor.io/api"
USER_AGENT = "JackBeatnicGallery/1.0"

SALVOR_PROFILE = "JackBeatnic"
SALVOR_PROFILE_URL = "https://salvor.io/profile/JackBeatnic"

AI_COLLECTION_IDS = {
    "avalanche_nature_jam",
    "avalanche_nature_jam_vol2",
    "avalanche_nature_stories",
    "avalanche_flower_stories",
    "polygon_flower_stories_vol2",
    "polygon_nature_stories_vol2",
    "polygon_jb_ai_play",
    "base_flower_stories_vol3",
    "base_nature_stories_vol3",
    "base_jb_based_ai",
    "base_jb_based_ai_vol2",
    "base_jb_ai_play",
}

SEADN_RE = re.compile(
    r"https://i2c\.seadn\.io/avalanche/[a-fA-F0-9x]+/[a-f0-9]+/[a-f0-9]+\.jpeg(?:\?w=\d+)?",
    re.I,
)


def load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def save_json(path: Path, data: dict) -> None:
    with path.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
        fh.write("\n")


def fetch_json(url: str) -> dict | list:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/json",
            "Origin": "https://salvor.io",
            "Referer": SALVOR_PROFILE_URL,
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def parse_price(value: object) -> float | None:
    if value in (None, ""):
        return None
    try:
        raw = float(value)
    except (TypeError, ValueError):
        return None
    return raw if raw > 0 else None


def salvor_asset_url(contract: str, token_id: int | str) -> str:
    return f"https://salvor.io/asset/{contract}/{token_id}"


def opensea_asset_url(contract: str, token_id: int | str) -> str:
    return f"https://opensea.io/assets/avalanche/{contract}/{token_id}"


def normalize_image(url: str) -> str:
    if not url:
        return ""
    if "seadn.io" in url:
        base = url.split("?", 1)[0]
        return f"{base}?w=1000"
    return url


def ai_contracts() -> set[str]:
    contracts: set[str] = set()
    if KOLEKCJE_JSON.exists():
        data = load_json(KOLEKCJE_JSON)
        for row in data.get("collections") or []:
            col_id = row.get("id") or ""
            contract = (row.get("contract") or "").lower()
            if col_id in AI_COLLECTION_IDS and contract:
                contracts.add(contract)
    return contracts


def extract_listing_rows(payload: object) -> list[dict]:
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    if not isinstance(payload, dict):
        return []
    data = payload.get("data")
    if isinstance(data, list):
        return [row for row in data if isinstance(row, dict)]
    if isinstance(data, dict):
        for key in ("listings", "nfts", "items", "assets"):
            block = data.get(key)
            if isinstance(block, list):
                return [row for row in block if isinstance(row, dict)]
    return []


def fetch_salvor_listings(profile: str) -> list[dict]:
    endpoints = [
        f"{SALVOR_API}/profile/{profile}/listings",
        f"{SALVOR_API}/profile/{profile}/nfts",
    ]
    rows: list[dict] = []
    for url in endpoints:
        try:
            payload = fetch_json(url)
            batch = extract_listing_rows(payload)
            print(f"[salvor-foto] {url} → {len(batch)} pozycji")
            rows.extend(batch)
        except urllib.error.URLError as exc:
            print(f"[salvor-foto] {url}: {exc}", file=sys.stderr)
    return rows


def row_contract(row: dict) -> str:
    for key in ("contract", "contract_address", "token_address", "collection_address"):
        val = row.get(key)
        if val:
            return str(val).lower()
    token = row.get("token") or row.get("nft") or {}
    if isinstance(token, dict):
        for key in ("contract", "contract_address", "token_address"):
            val = token.get(key)
            if val:
                return str(val).lower()
    return ""


def row_token_id(row: dict) -> int | None:
    for key in ("token_id", "tokenId", "id"):
        val = row.get(key)
        if val is not None and str(val).isdigit():
            return int(val)
    token = row.get("token") or row.get("nft") or {}
    if isinstance(token, dict):
        for key in ("token_id", "tokenId", "id"):
            val = token.get(key)
            if val is not None and str(val).isdigit():
                return int(val)
    return None


def row_name(row: dict) -> str:
    for key in ("name", "title", "nazwa"):
        val = (row.get(key) or "").strip()
        if val:
            return val
    token = row.get("token") or row.get("nft") or {}
    if isinstance(token, dict):
        val = (token.get("name") or "").strip()
        if val:
            return val
    return ""


def row_image(row: dict) -> str:
    for key in ("image", "image_url", "imageUrl", "thumbnail"):
        val = row.get(key)
        if val:
            return normalize_image(str(val))
    token = row.get("token") or row.get("nft") or {}
    if isinstance(token, dict):
        for key in ("image", "image_url", "imageUrl", "thumbnail"):
            val = token.get(key)
            if val:
                return normalize_image(str(val))
    meta = row.get("metadata") or {}
    if isinstance(meta, dict):
        val = meta.get("image")
        if val:
            return normalize_image(str(val))
    return ""


def row_price_avax(row: dict) -> float | None:
    for key in ("price", "price_avax", "listing_price", "cena_salvor", "salvor_price"):
        price = parse_price(row.get(key))
        if price is not None:
            return price
    listing = row.get("listing") or {}
    if isinstance(listing, dict):
        for key in ("price", "price_avax"):
            price = parse_price(listing.get(key))
            if price is not None:
                return price
    return None


def stable_token_id(contract: str, token_id: int) -> int:
    """Unikalny token_id w gallery.json (nie koliduje z OBJKT pk)."""
    suffix = int(contract[-6:], 16) % 500_000
    return 700_000_000 + suffix * 10_000 + (token_id % 10_000)


def build_entry(row: dict, *, display_rank: int, skip_contracts: set[str]) -> dict | None:
    contract = row_contract(row)
    token_id = row_token_id(row)
    if not contract or token_id is None:
        return None
    if contract in skip_contracts:
        return None

    price = row_price_avax(row)
    if price is None:
        return None

    name = row_name(row) or f"Salvor #{token_id}"
    image_url = row_image(row)
    salvor_url = salvor_asset_url(contract, token_id)
    opensea_url = opensea_asset_url(contract, token_id)
    gallery_token_id = stable_token_id(contract, token_id)

    return {
        "token_id": gallery_token_id,
        "onchain_token_id": token_id,
        "name": name,
        "salvor_url": salvor_url,
        "opensea_url": opensea_url,
        "marketplace_url": salvor_url,
        "image_url": image_url,
        "supply": 1,
        "traits": {},
        "ai": {
            "description": f"{name} — photography on Avalanche, listed on Salvor.",
            "dominant_colors": [],
            "vibe_tags": ["photography", "salvor", "avalanche"],
            "category": "photography",
            "keywords": ["photography", "salvor", "avalanche", "jackbeatnic"],
        },
        "likes_count": 0,
        "status": "listed",
        "chain": "avalanche",
        "contract_address": contract,
        "collection_id": f"salvor_photo_{contract[:10]}",
        "listing_status": "For Sale",
        "listing_currency": "AVAX",
        "current_price_avax": price,
        "salvor_price_avax": price,
        "display_rank": display_rank,
        "medium": "photography",
        "photo_kind": "photo",
        "source": "salvor",
        "marketplace": "salvor",
        "marketplaces": ["salvor", "opensea"],
    }


def merge_salvor_photo(data: dict, entries: list[dict]) -> int:
    kept = [
        nft
        for nft in data.get("nfts") or []
        if not (nft.get("medium") == "photography" and nft.get("source") == "salvor")
    ]
    data["nfts"] = kept + entries
    return len(entries)


def sync(*, dry_run: bool = False) -> int:
    gallery = load_json(GALLERY_JSON)
    info = gallery.setdefault("collection_info", {})
    skip_contracts = ai_contracts()

    print(f"[salvor-foto] Profil: {SALVOR_PROFILE_URL}")
    print(f"[salvor-foto] Pomijam kontrakty AI: {len(skip_contracts)}")

    raw_rows = fetch_salvor_listings(SALVOR_PROFILE)
    if not raw_rows:
        print(
            "[salvor-foto] Brak pozycji z API Salvor — gallery.json bez zmian. "
            "Sprawdź profil w przeglądarce lub uruchom sync później.",
            file=sys.stderr,
        )
        return 0

    entries: list[dict] = []
    seen: set[tuple[str, int]] = set()
    rank = 50
    for row in raw_rows:
        contract = row_contract(row)
        token_id = row_token_id(row)
        if not contract or token_id is None:
            continue
        key = (contract, token_id)
        if key in seen:
            continue
        seen.add(key)
        entry = build_entry(row, display_rank=rank, skip_contracts=skip_contracts)
        if entry:
            entries.append(entry)
            rank += 1

    print(f"[salvor-foto] Do galerii (z ceną, nie-AI): {len(entries)}")
    if not entries:
        return 0

    if dry_run:
        print("[dry-run] Bez zapisu gallery.json")
        return 0

    count = merge_salvor_photo(gallery, entries)
    info["salvor_photo_profile"] = SALVOR_PROFILE_URL
    info["last_salvor_photo_sync"] = (
        datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    )
    info["salvor_photo_count"] = count
    save_json(GALLERY_JSON, gallery)
    print(f"[salvor-foto] Zapisano: {GALLERY_JSON}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync Salvor/JackBeatnic photography into gallery.json")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    try:
        return sync(dry_run=args.dry_run)
    except urllib.error.URLError as exc:
        print(f"[salvor-foto] Błąd sieci: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())