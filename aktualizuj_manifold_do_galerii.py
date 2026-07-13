#!/usr/bin/env python3
"""Sync Manifold Gallery auctions → auctions_gallery.json (Blueprint Faza 6).

Open API (no key):
  https://marketplace.api.manifoldxyz.dev/listing/{marketplace}/{listingId}
  https://marketplace.api.manifoldxyz.dev/listing/{marketplace}/activity

Chains:
  - Base (active) — low gas, Manifold creator contract
  - Ethereum L1 (optional, disabled until new contract)

Usage:
  python3 aktualizuj_manifold_do_galerii.py
  python3 aktualizuj_manifold_do_galerii.py --dry-run
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MAIN_GALLERY_JSON = ROOT / "gallery.json"
AUCTIONS_GALLERY_JSON = ROOT / "auctions_gallery.json"
MARKETPLACE_API = "https://marketplace.api.manifoldxyz.dev"
USER_AGENT = "JackBeatnicGallery/1.0"
AUCTION_LISTING_TYPE = 1
CHAIN_SLUG = {"base": "base", "ethereum": "eth", "eth": "eth"}


def load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def save_json(path: Path, data: dict) -> None:
    with path.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
        fh.write("\n")


def fetch_json(url: str, label: str = "") -> dict | list:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"HTTP {exc.code} {label or url}: {exc.reason}") from exc


def bignum_to_int(value: object) -> int:
    if value is None:
        return 0
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.isdigit():
        return int(value)
    if isinstance(value, dict):
        hx = value.get("hex") or value.get("_hex")
        if hx:
            return int(str(hx), 16)
    return 0


def wei_to_eth(value: object) -> float | None:
    wei = bignum_to_int(value)
    if wei <= 0:
        return None
    return round(wei / 1_000_000_000_000_000_000, 5)


def stable_token_id(listing_id: str) -> int:
    base = int(listing_id)
    return 900_000_000 + (base % 99_000_000)


def manifold_share_url(chain: str, contract: str, token_id: int) -> str:
    slug = CHAIN_SLUG.get(chain, chain)
    return f"https://manifold.xyz/{slug}/{contract}/{token_id}"


def default_manifold_config() -> dict:
    return {
        "creator_wallet": "0xf0b840349b3f285fc05c89eac594ddd254183fb9",
        "profile_url": "https://manifold.gallery/jbeatnic",
        "studio_url": "https://manifold.xyz/@jbeatnic",
        "chains": {
            "base": {
                "enabled": True,
                "chain": "base",
                "chain_id": 8453,
                "label": "Base",
                "native_currency": "ETH",
                "marketplace_address": "0x5246807fB65d87b0D0a234E0f3D42374DE83b421",
                "contracts": ["0x3ae3dd0baa83dfcb8f07e55ae6737bcd0d694347"],
                "watch_listing_ids": [],
                "activity_scan_pages": 3,
            },
            "ethereum": {
                "enabled": False,
                "chain": "ethereum",
                "chain_id": 1,
                "label": "Ethereum",
                "native_currency": "ETH",
                "marketplace_address": "0x3a3548e060be10c2614d0a4cb0c03cc9093fd799",
                "contracts": [],
                "watch_listing_ids": [],
                "activity_scan_pages": 0,
                "note": "Planned L1 high-art auctions — enable when contract deploys",
            },
        },
    }


def load_manifold_config() -> dict:
    if not MAIN_GALLERY_JSON.exists():
        return default_manifold_config()
    info = load_json(MAIN_GALLERY_JSON).get("collection_info") or {}
    cfg = info.get("manifold_auctions") or default_manifold_config()
    defaults = default_manifold_config()
    cfg.setdefault("creator_wallet", defaults["creator_wallet"])
    cfg.setdefault("profile_url", defaults["profile_url"])
    cfg.setdefault("studio_url", defaults["studio_url"])
    chains = cfg.setdefault("chains", {})
    for key, default_chain in defaults["chains"].items():
        chains.setdefault(key, default_chain)
        for field, val in default_chain.items():
            chains[key].setdefault(field, val)
    return cfg


def fetch_listing(marketplace: str, listing_id: str) -> dict:
    url = f"{MARKETPLACE_API}/listing/{marketplace}/{listing_id}"
    data = fetch_json(url, label=f"listing {listing_id}")
    return data if isinstance(data, dict) else {}


def fetch_activity_page(marketplace: str, page: int, page_size: int = 50) -> list[dict]:
    # page is 1-based; API rejects pageNumber=0
    if page <= 1:
        url = f"{MARKETPLACE_API}/listing/{marketplace}/activity?pageSize={page_size}"
    else:
        url = (
            f"{MARKETPLACE_API}/listing/{marketplace}/activity"
            f"?pageNumber={page}&pageSize={page_size}"
        )
    data = fetch_json(url, label=f"activity page {page}")
    if isinstance(data, dict):
        rows = data.get("listings") or []
        return rows if isinstance(rows, list) else []
    return []


def scan_seller_auctions(
    *,
    marketplace: str,
    seller: str,
    pages: int,
) -> dict[str, dict]:
    seller_l = seller.lower()
    found: dict[str, dict] = {}
    for page in range(1, max(0, int(pages)) + 1):
        rows = fetch_activity_page(marketplace, page)
        if not rows:
            break
        for row in rows:
            if str(row.get("seller", "")).lower() != seller_l:
                continue
            details = row.get("details") or {}
            if int(details.get("type_", details.get("type", -1))) != AUCTION_LISTING_TYPE:
                continue
            lid = str(row.get("id") or "")
            if lid:
                found[lid] = row
        time.sleep(0.1)
    return found


def merge_metadata(activity_row: dict | None, listing: dict) -> dict:
    token = (activity_row or {}).get("token") or listing.get("token") or {}
    meta = token.get("metadata") or {}
    return meta if isinstance(meta, dict) else {}


def build_entry(
    *,
    listing_id: str,
    chain_key: str,
    chain_cfg: dict,
    listing: dict,
    activity_row: dict | None,
    creator: str,
    old_by_id: dict[str, dict],
) -> dict | None:
    seller = str(listing.get("seller") or (activity_row or {}).get("seller") or "")
    if seller.lower() != creator.lower():
        return None

    details = listing.get("details") or (activity_row or {}).get("details") or {}
    if int(details.get("type_", details.get("type", -1))) != AUCTION_LISTING_TYPE:
        return None

    if listing.get("finalized"):
        return None

    token = (activity_row or {}).get("token") or listing.get("token") or {}
    contract = str(token.get("address_") or token.get("address") or "").lower()
    token_id = bignum_to_int(token.get("id"))
    meta = merge_metadata(activity_row, listing)

    reserve = wei_to_eth(details.get("initialAmount"))
    bid_amount = wei_to_eth((listing.get("bid") or {}).get("amount"))
    current = bid_amount if bid_amount is not None else reserve

    share = (activity_row or {}).get("shareLink") or ""
    if not share and contract and token_id:
        share = manifold_share_url(chain_cfg["chain"], contract, token_id)

    name = (meta.get("name") or f"Manifold auction #{listing_id}").strip()
    description = (meta.get("description") or "").strip()
    image_url = meta.get("image_url") or meta.get("image") or ""

    entry = {
        "token_id": stable_token_id(listing_id),
        "manifold_listing_id": listing_id,
        "name": name,
        "manifold_url": share,
        "marketplace_url": share,
        "image_url": image_url,
        "supply": 1,
        "traits": {},
        "ai": {
            "description": description or f"{name} — live auction on Manifold ({chain_cfg['label']}).",
            "dominant_colors": [],
            "vibe_tags": ["auction", "manifold", chain_cfg["chain"]],
            "category": "auction",
            "keywords": ["auction", "manifold", chain_cfg["chain"], "jackbeatnic"],
        },
        "likes_count": 0,
        "status": "auction",
        "chain": chain_cfg["chain"],
        "chain_key": chain_key,
        "contract_address": contract,
        "nft_token_id": token_id,
        "listing_status": "Live",
        "auction_status": "live",
        "listing_currency": chain_cfg.get("native_currency", "ETH"),
        "display_rank": int(listing_id) if str(listing_id).isdigit() else 9999,
        "medium": "manifold_auction",
        "source": "manifold",
        "marketplace": "manifold",
    }

    if reserve is not None:
        entry["reserve_eth"] = reserve
    if current is not None:
        entry["current_bid_eth"] = current

    old = old_by_id.get(listing_id)
    if old:
        if old.get("likes_count") not in (None, ""):
            entry["likes_count"] = old["likes_count"]
        for key in ("share_url", "og_image"):
            if old.get(key) and not entry.get(key):
                entry[key] = old[key]
        if not image_url and old.get("image_url"):
            entry["image_url"] = old["image_url"]
        if not description and old.get("ai", {}).get("description"):
            entry["ai"]["description"] = old["ai"]["description"]

    return entry


def sync_chain(
    *,
    chain_key: str,
    chain_cfg: dict,
    creator: str,
    old_by_id: dict[str, dict],
) -> list[dict]:
    if not chain_cfg.get("enabled"):
        print(f"  [{chain_key}] pominięty (disabled)")
        return []

    marketplace = chain_cfg["marketplace_address"]
    print(f"  [{chain_key}] marketplace {marketplace[:10]}…")

    activity_rows = scan_seller_auctions(
        marketplace=marketplace,
        seller=creator,
        pages=int(chain_cfg.get("activity_scan_pages", 3)),
    )
    print(f"  [{chain_key}] activity scan: {len(activity_rows)} aukcji")

    listing_ids = set(activity_rows.keys())
    for lid in chain_cfg.get("watch_listing_ids") or []:
        listing_ids.add(str(lid))

    entries: list[dict] = []
    for listing_id in sorted(listing_ids, key=lambda x: int(x) if x.isdigit() else 0, reverse=True):
        try:
            listing = fetch_listing(marketplace, listing_id)
            entry = build_entry(
                listing_id=listing_id,
                chain_key=chain_key,
                chain_cfg=chain_cfg,
                listing=listing,
                activity_row=activity_rows.get(listing_id),
                creator=creator,
                old_by_id=old_by_id,
            )
            if entry:
                entries.append(entry)
        except Exception as exc:
            print(f"    listing {listing_id}: {exc}", file=sys.stderr)
        time.sleep(0.12)

    return entries


def sync(*, dry_run: bool = False) -> int:
    cfg = load_manifold_config()
    creator = cfg["creator_wallet"]

    old_data = load_json(AUCTIONS_GALLERY_JSON) if AUCTIONS_GALLERY_JSON.exists() else {}
    old_by_id = {
        str(row["manifold_listing_id"]): row
        for row in old_data.get("nfts") or []
        if row.get("manifold_listing_id")
    }

    print(f"[manifold] Creator: {creator}")
    all_entries: list[dict] = []
    for chain_key, chain_cfg in (cfg.get("chains") or {}).items():
        all_entries.extend(
            sync_chain(
                chain_key=chain_key,
                chain_cfg=chain_cfg,
                creator=creator,
                old_by_id=old_by_id,
            )
        )

    all_entries.sort(key=lambda row: row.get("display_rank", 0), reverse=True)

    payload = {
        "collection_info": {
            "creator_wallet": creator,
            "profile_url": cfg.get("profile_url"),
            "studio_url": cfg.get("studio_url"),
            "chains": cfg.get("chains"),
            "last_manifold_sync": datetime.now(timezone.utc)
            .replace(microsecond=0)
            .isoformat()
            .replace("+00:00", "Z"),
        },
        "site": {
            "sections": {
                "atelier": {
                    "label": "The Atelier",
                    "label_short": "Atelier",
                    "explore_title": "The Atelier",
                    "default_kind": "auctions",
                    "default_chain": "base",
                    "kind_subsections": [
                        {"id": "auctions", "label": "Auctions"},
                        {"id": "editions", "label": "Limited Editions"},
                    ],
                    "chain_subsections": [
                        {"id": "base", "label": "Base"},
                        {"id": "ethereum", "label": "Ethereum"},
                    ],
                    "disabled_kinds": ["editions"],
                    "disabled_chains": ["ethereum"],
                    "kind_notes": {
                        "editions": "Numbered editions in small batches — coming soon.",
                    },
                    "chain_notes": {
                        "ethereum": "Reserved for select one-of-one works.",
                    },
                    "explore_titles": {
                        "auctions": "Auctions · The Atelier",
                        "editions": "Limited Editions · The Atelier",
                    },
                    "empty_messages": {
                        "auctions": {
                            "base": "No auction is live at the moment. The next piece will appear here when the gavel is set.",
                            "ethereum": "Select one-of-one auctions — reserved for a future chapter.",
                        },
                        "editions": {
                            "base": "Numbered editions are in preparation — intimate batches, released at a gentle pace.",
                            "ethereum": "A dedicated room for photography — planned with its own contract.",
                        },
                    },
                    "promo_eyebrow": "The Atelier",
                    "promo_lead": "A private room for those who collect closely — rare auctions and numbered editions in small batches, offered straight from the studio. Only live sales appear here; the wider studio catalogue lives on Manifold.",
                    "promo_collector": "Returning collectors may soon unlock early access and quiet releases — nothing personal, only your wallet.",
                    "collection_url": cfg.get("profile_url"),
                    "collection_cta": "Manifold Gallery",
                    "studio_listings_url": "https://manifold.xyz/@jbeatnic/p/jackbeatnic",
                    "studio_listings_cta": "Studio catalogue",
                }
            }
        },
        "nfts": all_entries,
    }

    print(f"[manifold] Gotowe: {len(all_entries)} live auction(s)")

    if dry_run:
        print("[dry-run] Bez zapisu auctions_gallery.json")
        return 0

    save_json(AUCTIONS_GALLERY_JSON, payload)
    print(f"[manifold] Zapisano: {AUCTIONS_GALLERY_JSON}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Sync Manifold auctions → auctions_gallery.json")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    return sync(dry_run=args.dry_run)


if __name__ == "__main__":
    raise SystemExit(main())