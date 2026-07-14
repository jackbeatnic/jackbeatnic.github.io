#!/usr/bin/env python3
"""Sync Sui collection from TradePort → sui_gallery.json.

TradePort NFT Data API (GraphQL):
  POST https://api.indexer.xyz/graphql
  Headers: x-api-key, x-api-user

Usage:
  export TRADEPORT_API_KEY="..."
  export TRADEPORT_API_USER="..."
  ./venv/bin/python3 aktualizuj_sui_tradeport_do_galerii.py
  ./venv/bin/python3 aktualizuj_sui_tradeport_do_galerii.py --dry-run --limit 5
"""

from __future__ import annotations

import argparse
import json
import os
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
JB_NFT = ROOT.parent
KOLEKCJE_JSON = JB_NFT / "raportowanie" / "kolekcje.json"
OUTPUT_JSON = ROOT / "sui_gallery.json"

GRAPHQL_URL = "https://api.indexer.xyz/graphql"
DEFAULT_COLLECTION_ID = "990ced13-2d2c-4fee-8ff1-1c30177d9171"
COLLECTION_ID_KEY = "sui_nature_stories_tradeport"
PAGE_SIZE = 100
SUI_DECIMALS = 1_000_000_000

COLLECTION_QUERY = """
query fetchCollection($collectionId: uuid!) {
  sui {
    collections(where: { id: { _eq: $collectionId } }) {
      id
      title
      slug
      semantic_slug
      description
      cover_url
      supply
      floor
      volume
      verified
    }
  }
}
"""

NFTS_QUERY = """
query fetchCollectionNfts(
  $collectionId: uuid!
  $offset: Int!
  $limit: Int!
) {
  sui {
    nfts(
      where: {
        collection_id: { _eq: $collectionId }
        burned: { _eq: false }
      }
      order_by: [{ ranking: asc_nulls_last }, { token_id: asc }]
      offset: $offset
      limit: $limit
    ) {
      id
      token_id
      name
      media_url
      media_type
      ranking
      owner
      listings(
        where: { listed: { _eq: true } }
        order_by: { price: asc }
        limit: 1
      ) {
        price
        listed
        market_name
      }
    }
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


def load_collection_config() -> dict:
    data = load_json(KOLEKCJE_JSON)
    for row in data.get("collections", []):
        if row.get("id") == COLLECTION_ID_KEY:
            return row
    raise SystemExit(f"Brak {COLLECTION_ID_KEY} w raportowanie/kolekcje.json")


def api_credentials() -> tuple[str, str]:
    api_key = os.environ.get("TRADEPORT_API_KEY", "").strip()
    api_user = os.environ.get("TRADEPORT_API_USER", "").strip()
    if not api_key or not api_user:
        raise SystemExit(
            "Ustaw TRADEPORT_API_KEY i TRADEPORT_API_USER "
            "(nagłówki x-api-key / x-api-user — patrz tradeport.xyz/docs)"
        )
    return api_key, api_user


def graphql(query: str, variables: dict) -> dict:
    api_key, api_user = api_credentials()
    payload = json.dumps({"query": query, "variables": variables}).encode("utf-8")
    req = urllib.request.Request(
        GRAPHQL_URL,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "x-api-key": api_key,
            "x-api-user": api_user,
            "User-Agent": "JackBeatnicGallery/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")[:500]
        raise SystemExit(f"TradePort HTTP {exc.code}: {detail}") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise SystemExit(f"TradePort request failed: {exc}") from exc

    if body.get("errors"):
        raise SystemExit(f"TradePort GraphQL: {body['errors']}")
    return body.get("data") or {}


def collection_public_url(slug: str) -> str:
    return f"https://www.tradeport.xyz/sui/collection/{slug}"


def nft_public_url(slug: str, token_id: str) -> str:
    return f"https://www.tradeport.xyz/sui/collection/{slug}/{token_id}"


def sui_price(value: object) -> float | None:
    if value is None or value == "":
        return None
    try:
        raw = float(value)
    except (TypeError, ValueError):
        return None
    if raw >= 1_000_000:
        return round(raw / SUI_DECIMALS, 4)
    return raw


def stable_token_id(token_id: str, ranking: int | None) -> int:
    if ranking is not None:
        try:
            rank = int(ranking)
            if rank > 0:
                return rank
        except (TypeError, ValueError):
            pass
    digits = "".join(ch for ch in str(token_id) if ch.isdigit())
    if digits:
        return int(digits[-9:]) % 9_000_000 or 1
    return abs(hash(str(token_id))) % 9_000_000 or 1


def build_entry(
    *,
    nft: dict,
    slug: str,
    collection_id: str,
    old: dict | None,
) -> dict | None:
    media_url = (nft.get("media_url") or "").strip()
    if not media_url:
        return None

    token_id = str(nft.get("token_id") or "")
    display_id = stable_token_id(token_id, nft.get("ranking"))
    name = (nft.get("name") or "").strip() or f"JB Sui #{display_id:04d}"
    tradeport_url = nft_public_url(slug, token_id)

    listings = nft.get("listings") or []
    listing = listings[0] if listings else {}
    price = sui_price(listing.get("price"))
    listing_status = "For Sale" if listing.get("listed") and price is not None else "Not Listed"

    entry: dict = {
        "token_id": display_id,
        "sui_token_id": token_id,
        "tradeport_nft_id": nft.get("id"),
        "name": name,
        "tradeport_url": tradeport_url,
        "marketplace_url": tradeport_url,
        "image_url": media_url,
        "supply": 1,
        "traits": {},
        "ai": {
            "description": "",
            "dominant_colors": [],
            "vibe_tags": ["nature stories", "sui", "tradeport", "ai art"],
            "category": "nature_stories",
            "keywords": ["nature stories", "jack beatnic", "sui", "tradeport"],
        },
        "likes_count": 0,
        "status": "listed" if listing_status == "For Sale" else "minted",
        "chain": "sui",
        "collection_id": COLLECTION_ID_KEY,
        "listing_status": listing_status,
        "listing_currency": "SUI",
        "display_rank": display_id,
        "medium": "sui_ai",
        "ai_series": "nature_stories",
        "source": "tradeport",
        "marketplace": "tradeport",
    }

    if price is not None:
        entry["current_price_sui"] = price

    if old:
        if old.get("likes_count") not in (None, ""):
            entry["likes_count"] = old["likes_count"]
        for key in ("share_url", "og_image"):
            if old.get(key):
                entry[key] = old[key]
        if old.get("ai", {}).get("dominant_colors") and not entry["ai"]["dominant_colors"]:
            entry["ai"]["dominant_colors"] = old["ai"]["dominant_colors"]
        if (old.get("ai", {}).get("description") or "").strip():
            entry["ai"]["description"] = old["ai"]["description"]

    return entry


def fetch_all_nfts(collection_id: str, *, limit: int | None) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    while True:
        batch_limit = PAGE_SIZE
        if limit is not None:
            remaining = limit - len(rows)
            if remaining <= 0:
                break
            batch_limit = min(PAGE_SIZE, remaining)

        data = graphql(
            NFTS_QUERY,
            {
                "collectionId": collection_id,
                "offset": offset,
                "limit": batch_limit,
            },
        )
        batch = (data.get("sui") or {}).get("nfts") or []
        if not batch:
            break
        rows.extend(batch)
        offset += len(batch)
        print(f"  NFTs… {len(rows)}")
        if len(batch) < batch_limit:
            break
        time.sleep(0.15)
    return rows


def sync(*, dry_run: bool = False, limit: int | None = None) -> int:
    cfg = load_collection_config()
    collection_id = cfg.get("tradeport_collection_id") or DEFAULT_COLLECTION_ID
    print(f"[sui] TradePort collection_id={collection_id}")

    meta_data = graphql(COLLECTION_QUERY, {"collectionId": collection_id})
    collections = (meta_data.get("sui") or {}).get("collections") or []
    if not collections:
        raise SystemExit("TradePort: brak kolekcji o podanym ID")
    col = collections[0]
    slug = col.get("semantic_slug") or col.get("slug") or collection_id
    title = col.get("title") or cfg.get("name") or "Nature Stories · Sui"
    print(f"  {title} · slug={slug} · supply={col.get('supply')}")

    old_data = load_json(OUTPUT_JSON) if OUTPUT_JSON.exists() else {}
    old_by_token = {
        str(row.get("sui_token_id")): row
        for row in old_data.get("nfts") or []
        if row.get("sui_token_id")
    }

    raw_nfts = fetch_all_nfts(collection_id, limit=limit)
    entries: list[dict] = []
    skipped = 0
    for nft in raw_nfts:
        old = old_by_token.get(str(nft.get("token_id")))
        entry = build_entry(nft=nft, slug=slug, collection_id=collection_id, old=old)
        if entry is None:
            skipped += 1
        else:
            entries.append(entry)

    entries.sort(key=lambda e: e.get("display_rank", 0))
    print(f"  w galerii: {len(entries)} · pominięto bez obrazu: {skipped}")

    collection_url = collection_public_url(slug)
    payload = {
        "collection_info": {
            "tradeport_collection_id": collection_id,
            "tradeport_slug": slug,
            "collection_name": title,
            "collection_url": collection_url,
            "chain": "sui",
            "native_currency": "SUI",
            "marketplace": "tradeport",
            "tradeport_profile": collection_url,
            "last_sui_sync": datetime.now(timezone.utc)
            .replace(microsecond=0)
            .isoformat()
            .replace("+00:00", "Z"),
            "token_count": len(entries),
        },
        "site": {
            "sections": {
                "ai_art": {
                    "explore_titles": {"sui": f"Explore {title} · Sui"},
                    "empty_messages": {
                        "sui": f"{title} on TradePort — sync with aktualizuj_sui_tradeport_do_galerii.py"
                    },
                    "promo_eyebrow": f"{title} on Sui",
                    "promo_lead": "Collect and trade on TradePort — every work links to the marketplace.",
                    "collection_url": collection_url,
                    "collection_cta": "View collection on TradePort",
                }
            }
        },
        "nfts": entries,
    }

    if dry_run:
        print("[dry-run] Bez zapisu sui_gallery.json")
        return 0

    save_json(OUTPUT_JSON, payload)
    print(f"[sui] Zapisano: {OUTPUT_JSON}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Sync Sui TradePort → sui_gallery.json")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=None, help="Max NFTów (test)")
    args = parser.parse_args(argv)
    return sync(dry_run=args.dry_run, limit=args.limit)


if __name__ == "__main__":
    raise SystemExit(main())