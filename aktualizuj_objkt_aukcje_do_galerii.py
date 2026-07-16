#!/usr/bin/env python3
"""Sync live OBJKT auctions (English + Dutch) → objkt_auctions_gallery.json.

Źródło: https://data.objkt.com/v3/graphql
Portfel: jackbeatnic.tez (seller_address lub creator tokena)

Aukcje OBJKT są „powierzane” przez portfel marketplace — seller_address w API
to nadal Twój adres tz… gdy aukcja jest aktywna.

Usage:
  python3 aktualizuj_objkt_aukcje_do_galerii.py
  python3 aktualizuj_objkt_aukcje_do_galerii.py --dry-run
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
GALLERY_JSON = ROOT / "gallery.json"
OUTPUT_JSON = ROOT / "objkt_auctions_gallery.json"
GRAPHQL_URL = "https://data.objkt.com/v3/graphql"
USER_AGENT = "JackBeatnicGallery/1.0"

SKIP_COLLECTIONS = {"JB: AI Art Jam"}
FADE_DIARY_RE = re.compile(r"\bfade\s+diary\b", re.I)
PHOTO_COLLECTIONS = {
    "Jack's nature",
    "JB: Soul Shots | 1/1 ed",
    "DNS Marketplace",
    "Jack Beatnic Open Editions",
}

ENGLISH_AUCTION_QUERY = """
query EnglishAuctions($address: String!) {
  by_seller: english_auction_active(
    where: { seller_address: { _eq: $address } }
    order_by: { id: desc }
  ) {
    id
    seller_address
    reserve_xtz
    highest_bid_xtz
    start_time
    end_time
    token {
      pk
      name
      fa_contract
      token_id
      display_uri
      thumbnail_uri
      description
      supply
      fa { name }
      creators { creator_address }
    }
  }
  by_creator: english_auction_active(
    where: { token: { creators: { creator_address: { _eq: $address } } } }
    order_by: { id: desc }
  ) {
    id
    seller_address
    reserve_xtz
    highest_bid_xtz
    start_time
    end_time
    token {
      pk
      name
      fa_contract
      token_id
      display_uri
      thumbnail_uri
      description
      supply
      fa { name }
      creators { creator_address }
    }
  }
}
"""

DUTCH_AUCTION_QUERY = """
query DutchAuctions($address: String!) {
  by_seller: dutch_auction_active(
    where: { seller_address: { _eq: $address } }
    order_by: { id: desc }
  ) {
    id
    seller_address
    start_price_xtz
    end_price_xtz
    start_time
    end_time
    amount_left
    token {
      pk
      name
      fa_contract
      token_id
      display_uri
      thumbnail_uri
      description
      supply
      fa { name }
      creators { creator_address }
    }
  }
  by_creator: dutch_auction_active(
    where: { token: { creators: { creator_address: { _eq: $address } } } }
    order_by: { id: desc }
  ) {
    id
    seller_address
    start_price_xtz
    end_price_xtz
    start_time
    end_time
    amount_left
    token {
      pk
      name
      fa_contract
      token_id
      display_uri
      thumbnail_uri
      description
      supply
      fa { name }
      creators { creator_address }
    }
  }
}
"""

RESOLVE_DOMAIN_QUERY = """
query ResolveDomain($domain: String!) {
  holder(where: { tzdomain: { _eq: $domain } }, limit: 1) {
    address
    tzdomain
  }
}
"""


def load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def save_json(path: Path, data: dict) -> None:
    with path.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
        fh.write("\n")


def graphql(query: str, variables: dict | None = None) -> dict:
    payload = json.dumps({"query": query, "variables": variables or {}}).encode("utf-8")
    req = urllib.request.Request(
        GRAPHQL_URL,
        data=payload,
        headers={"Content-Type": "application/json", "User-Agent": USER_AGENT},
    )
    with urllib.request.urlopen(req, timeout=90) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    if data.get("errors"):
        raise RuntimeError(data["errors"][0].get("message", data["errors"]))
    return data["data"]


def resolve_tezos_address(info: dict) -> str:
    address = info.get("tezos_creator_wallet") or ""
    if address.startswith("tz"):
        return address
    domain = (info.get("tezos_domain") or "jackbeatnic.tez").strip().lower()
    data = graphql(RESOLVE_DOMAIN_QUERY, {"domain": domain})
    holders = data.get("holder") or []
    if not holders:
        raise SystemExit(f"Nie znaleziono holdera dla domeny {domain}")
    return holders[0]["address"]


def ipfs_to_http(uri: str | None) -> str:
    if not uri:
        return ""
    uri = uri.strip()
    if uri.startswith("ipfs://"):
        return f"https://ipfs.io/ipfs/{uri[7:]}"
    if uri.startswith(("http://", "https://")):
        return uri
    return uri


def mutez_to_xtz(value: object) -> float | None:
    if value in (None, ""):
        return None
    raw = int(value)
    if raw <= 0:
        return None
    return round(raw / 1_000_000, 6)


def classify_photo_kind(token: dict) -> str:
    name = (token.get("name") or "").strip()
    fa_name = ((token.get("fa") or {}).get("name") or "").strip()
    if FADE_DIARY_RE.search(name):
        return "other"
    if fa_name in PHOTO_COLLECTIONS:
        return "photo"
    return "photo"


def dedupe_auctions(rows: list[dict]) -> list[dict]:
    seen: set[str] = set()
    out: list[dict] = []
    for row in rows:
        key = str(row.get("id") or "")
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(row)
    return out


def fetch_active_auctions(address: str) -> tuple[list[dict], list[dict]]:
    english_data = graphql(ENGLISH_AUCTION_QUERY, {"address": address})
    dutch_data = graphql(DUTCH_AUCTION_QUERY, {"address": address})

    english = dedupe_auctions(
        (english_data.get("by_seller") or []) + (english_data.get("by_creator") or [])
    )
    dutch = dedupe_auctions(
        (dutch_data.get("by_seller") or []) + (dutch_data.get("by_creator") or [])
    )
    return english, dutch


def build_entry(
    auction: dict,
    *,
    auction_type: str,
    display_rank: int,
    old_by_pk: dict[int, dict],
) -> dict | None:
    token = auction.get("token") or {}
    if not token.get("pk"):
        return None

    fa_name = ((token.get("fa") or {}).get("name") or "").strip()
    if fa_name in SKIP_COLLECTIONS:
        return None

    token_pk = int(token["pk"])
    fa_contract = token.get("fa_contract") or ""
    tezos_token_id = str(token.get("token_id") or "")
    name = (token.get("name") or f"OBJKT auction #{auction.get('id')}").strip()
    description = (token.get("description") or "").strip()
    photo_kind = classify_photo_kind(token)
    auction_id = str(auction.get("id") or "")
    auction_url = f"https://objkt.com/auction/{auction_id}"
    token_url = f"https://objkt.com/tokens/{fa_contract}/{tezos_token_id}"
    image_url = ipfs_to_http(token.get("display_uri") or token.get("thumbnail_uri"))

    entry = {
        "token_id": token_pk,
        "objkt_token_pk": token_pk,
        "objkt_auction_id": auction_id,
        "auction_type": auction_type,
        "name": name,
        "objkt_url": token_url,
        "auction_url": auction_url,
        "marketplace_url": auction_url,
        "image_url": image_url,
        "supply": int(token.get("supply") or 1),
        "traits": {},
        "ai": {
            "description": description or f"{name} — live auction on OBJKT (Tezos).",
            "dominant_colors": [],
            "vibe_tags": ["auction", "objkt", "tezos", "photography"],
            "category": "photography",
            "keywords": ["auction", "objkt", "tezos", fa_name, "jackbeatnic"],
        },
        "likes_count": 0,
        "status": "auction",
        "chain": "tezos",
        "contract_address": fa_contract,
        "tezos_token_id": tezos_token_id,
        "collection_name": fa_name,
        "listing_status": "Live",
        "auction_status": "live",
        "listing_currency": "XTZ",
        "display_rank": display_rank,
        "medium": "objkt_auction",
        "photo_kind": photo_kind,
        "source": "objkt",
        "marketplace": "objkt",
    }

    if auction_type == "english":
        reserve = mutez_to_xtz(auction.get("reserve_xtz"))
        bid = mutez_to_xtz(auction.get("highest_bid_xtz"))
        if reserve is not None:
            entry["reserve_xtz"] = reserve
        if bid is not None:
            entry["current_bid_xtz"] = bid
        end_time = auction.get("end_time")
        if end_time:
            entry["auction_end_time"] = end_time
    else:
        start_price = mutez_to_xtz(auction.get("start_price_xtz"))
        end_price = mutez_to_xtz(auction.get("end_price_xtz"))
        if start_price is not None:
            entry["dutch_start_xtz"] = start_price
        if end_price is not None:
            entry["dutch_end_xtz"] = end_price
            entry["reserve_xtz"] = end_price
        amount_left = int(auction.get("amount_left") or 0)
        if amount_left > 0:
            entry["auction_amount_left"] = amount_left
        end_time = auction.get("end_time")
        if end_time:
            entry["auction_end_time"] = end_time

    old = old_by_pk.get(token_pk)
    if old:
        if old.get("likes_count") not in (None, ""):
            entry["likes_count"] = old["likes_count"]
        for key in ("share_url", "og_image"):
            if old.get(key) and not entry.get(key):
                entry[key] = old[key]
        if not image_url and old.get("image_url"):
            entry["image_url"] = old["image_url"]

    return entry


def sync(*, dry_run: bool = False) -> int:
    gallery = load_json(GALLERY_JSON)
    info = gallery.get("collection_info") or {}
    address = resolve_tezos_address(info)
    print(f"[objkt-auctions] Wallet: {info.get('tezos_domain')} → {address}")

    old_data = load_json(OUTPUT_JSON) if OUTPUT_JSON.exists() else {}
    old_by_pk = {
        int(row["objkt_token_pk"]): row
        for row in old_data.get("nfts") or []
        if row.get("objkt_token_pk") is not None
    }

    english, dutch = fetch_active_auctions(address)
    print(f"[objkt-auctions] Aktywne: english={len(english)}, dutch={len(dutch)}")

    entries: list[dict] = []
    rank = 0
    for auction in english:
        entry = build_entry(auction, auction_type="english", display_rank=rank, old_by_pk=old_by_pk)
        if entry:
            entries.append(entry)
            rank += 1
    for auction in dutch:
        entry = build_entry(auction, auction_type="dutch", display_rank=rank, old_by_pk=old_by_pk)
        if entry:
            entries.append(entry)
            rank += 1

    payload = {
        "collection_info": {
            "tezos_domain": info.get("tezos_domain") or "jackbeatnic.tez",
            "tezos_creator_wallet": address,
            "objkt_profile": info.get("objkt_profile") or "https://objkt.com/@jackbeatnic/",
            "last_objkt_auctions_sync": datetime.now(timezone.utc)
            .replace(microsecond=0)
            .isoformat()
            .replace("+00:00", "Z"),
            "active_count": len(entries),
        },
        "site": {
            "sections": {
                "photography": {
                    "promo_eyebrow": "Live on OBJKT",
                    "promo_lead": "English and Dutch auctions from your Tezos wallet — bid directly on OBJKT.",
                    "promo_cta": "View auction on OBJKT",
                }
            }
        },
        "nfts": entries,
    }

    if dry_run:
        print(f"[dry-run] Zapisano by {len(entries)} aukcji do {OUTPUT_JSON}")
        return 0

    save_json(OUTPUT_JSON, payload)
    print(f"[objkt-auctions] Zapisano: {OUTPUT_JSON} ({len(entries)} aukcji)")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync OBJKT auctions to objkt_auctions_gallery.json")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    try:
        return sync(dry_run=args.dry_run)
    except urllib.error.URLError as exc:
        print(f"[objkt-auctions] Błąd sieci: {exc}", file=sys.stderr)
        return 1
    except RuntimeError as exc:
        print(f"[objkt-auctions] {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())