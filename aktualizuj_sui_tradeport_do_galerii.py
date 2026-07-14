#!/usr/bin/env python3
"""Sync Sui collections from TradePort → sui_gallery.json.

TradePort NFT Data API (GraphQL):
  POST https://api.indexer.xyz/graphql
  Headers: x-api-key, x-api-user

Kolekcje: wszystkie wpisy chain=sui + tradeport_collection_id w raportowanie/kolekcje.json
  (domyślnie: edycje, potem 1/1).

Usage:
  export TRADEPORT_API_KEY="..."
  export TRADEPORT_API_USER="..."
  # albo (preferowane dla agenta): www/.env z tymi zmiennymi (gitignored)
  ./venv/bin/python3 aktualizuj_sui_tradeport_do_galerii.py
  ./venv/bin/python3 aktualizuj_sui_tradeport_do_galerii.py --dry-run --limit 5
  ./venv/bin/python3 aktualizuj_sui_tradeport_do_galerii.py --collection sui_nature_stories_1of1_tradeport
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
PAGE_SIZE = 100
SUI_DECIMALS = 1_000_000_000
DISPLAY_RANK_1OF1_OFFSET = 10_000

EDITION_ORDER = {"edition": 0, "1of1": 1}

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


def load_env_file(path: Path) -> None:
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def bootstrap_env() -> None:
    for path in (ROOT / ".env", JB_NFT / "raportowanie" / ".env"):
        load_env_file(path)


def load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def save_json(path: Path, data: dict) -> None:
    with path.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
        fh.write("\n")


def edition_kind(cfg: dict) -> str:
    kind = (cfg.get("edition_kind") or "").strip().lower()
    if kind in EDITION_ORDER:
        return kind
    col_id = (cfg.get("id") or "").lower()
    if "1of1" in col_id or "1_1" in col_id:
        return "1of1"
    return "edition"


def load_sui_tradeport_configs(*, only_id: str | None = None) -> list[dict]:
    data = load_json(KOLEKCJE_JSON)
    rows: list[dict] = []
    for row in data.get("collections", []):
        if row.get("chain") != "sui":
            continue
        if not row.get("tradeport_collection_id"):
            continue
        if row.get("enabled") is False:
            continue
        if only_id and row.get("id") != only_id:
            continue
        rows.append(row)
    if only_id and not rows:
        raise SystemExit(f"Brak {only_id} (chain=sui, tradeport_collection_id) w kolekcje.json")
    if not rows:
        raise SystemExit("Brak kolekcji Sui TradePort w raportowanie/kolekcje.json")
    rows.sort(key=lambda r: (EDITION_ORDER.get(edition_kind(r), 9), r.get("id") or ""))
    return rows


def api_credentials() -> tuple[str, str]:
    bootstrap_env()
    api_key = os.environ.get("TRADEPORT_API_KEY", "").strip()
    api_user = os.environ.get("TRADEPORT_API_USER", "").strip()
    if not api_key or not api_user:
        raise SystemExit(
            "Ustaw TRADEPORT_API_KEY i TRADEPORT_API_USER "
            "(export lub www/.env — nagłówki x-api-key / x-api-user, patrz tradeport.xyz/docs)"
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


def display_rank_for(*, kind: str, local_rank: int) -> int:
    if kind == "1of1":
        return DISPLAY_RANK_1OF1_OFFSET + local_rank
    return local_rank


def build_entry(
    *,
    nft: dict,
    slug: str,
    cfg: dict,
    tradeport_uuid: str,
    kind: str,
    old: dict | None,
) -> dict | None:
    media_url = (nft.get("media_url") or "").strip()
    if not media_url:
        return None

    col_key = cfg.get("id") or "sui_tradeport"
    token_id = str(nft.get("token_id") or "")
    local_rank = stable_token_id(token_id, nft.get("ranking"))
    display_id = display_rank_for(kind=kind, local_rank=local_rank)
    name = (nft.get("name") or "").strip() or f"JB Sui #{local_rank:04d}"
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
        "edition_label": "1/1" if kind == "1of1" else "edition",
        "subseries": kind,
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
        "contract_address": tradeport_uuid,
        "collection_id": col_key,
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


def sync_one_collection(
    cfg: dict,
    *,
    old_by_key: dict[tuple[str, str], dict],
    limit: int | None,
) -> tuple[list[dict], dict]:
    col_key = cfg.get("id") or "sui_tradeport"
    tradeport_uuid = str(cfg.get("tradeport_collection_id") or "").strip()
    kind = edition_kind(cfg)
    print(f"[sui] {col_key} · kind={kind} · collection_id={tradeport_uuid}")

    meta_data = graphql(COLLECTION_QUERY, {"collectionId": tradeport_uuid})
    collections = (meta_data.get("sui") or {}).get("collections") or []
    if not collections:
        raise SystemExit(f"TradePort: brak kolekcji {tradeport_uuid}")
    col = collections[0]
    slug = col.get("semantic_slug") or col.get("slug") or tradeport_uuid
    title = col.get("title") or cfg.get("name") or "Nature Stories · Sui"
    print(f"  {title} · slug={slug} · supply={col.get('supply')}")

    raw_nfts = fetch_all_nfts(tradeport_uuid, limit=limit)
    entries: list[dict] = []
    skipped = 0
    for nft in raw_nfts:
        sui_tid = str(nft.get("token_id"))
        old = old_by_key.get((col_key, sui_tid))
        entry = build_entry(
            nft=nft,
            slug=slug,
            cfg=cfg,
            tradeport_uuid=tradeport_uuid,
            kind=kind,
            old=old,
        )
        if entry is None:
            skipped += 1
        else:
            entries.append(entry)

    entries.sort(key=lambda e: e.get("display_rank", 0))
    print(f"  w galerii: {len(entries)} · pominięto bez obrazu: {skipped}")

    collection_url = collection_public_url(slug)
    launchpad_url = (cfg.get("tradeport_launchpad_url") or "").strip()
    meta = {
        "collection_id": col_key,
        "tradeport_collection_id": tradeport_uuid,
        "tradeport_slug": slug,
        "collection_name": title,
        "collection_url": collection_url,
        "launchpad_url": launchpad_url,
        "edition_kind": kind,
        "token_count": len(entries),
        "supply": col.get("supply"),
    }
    return entries, meta


def build_site_sections(collection_metas: list[dict]) -> dict:
    primary = collection_metas[0] if collection_metas else {}
    primary_title = primary.get("collection_name") or "Nature Stories · Sui"
    primary_url = primary.get("collection_url") or ""

    promo_collections = [
        {
            "title": meta.get("collection_name") or meta.get("collection_id"),
            "url": meta.get("collection_url") or meta.get("launchpad_url") or "",
            "edition_label": "1/1" if meta.get("edition_kind") == "1of1" else "Editions",
            "cta": "View on TradePort",
        }
        for meta in collection_metas
        if meta.get("collection_url") or meta.get("launchpad_url")
    ]

    return {
        "sections": {
            "ai_art": {
                "explore_titles": {"sui": f"Explore {primary_title} · Sui"},
                "empty_messages": {
                    "sui": (
                        f"{primary_title} on TradePort — "
                        "sync with aktualizuj_sui_tradeport_do_galerii.py"
                    )
                },
                "promo_eyebrow": "Nature Stories on Sui",
                "promo_lead": (
                    "Collect and trade on TradePort — edycje i 1/1, "
                    "każda praca linkuje do marketplace."
                ),
                "collection_url": primary_url,
                "collection_cta": "View collection on TradePort",
                "promo_collections": promo_collections,
            }
        }
    }


def sync(
    *,
    dry_run: bool = False,
    limit: int | None = None,
    only_collection: str | None = None,
) -> int:
    configs = load_sui_tradeport_configs(only_id=only_collection)

    old_data = load_json(OUTPUT_JSON) if OUTPUT_JSON.exists() else {}
    old_by_key: dict[tuple[str, str], dict] = {}
    for row in old_data.get("nfts") or []:
        col = row.get("collection_id") or ""
        sui_tid = str(row.get("sui_token_id") or "")
        if col and sui_tid:
            old_by_key[(col, sui_tid)] = row

    all_entries: list[dict] = []
    collection_metas: list[dict] = []
    for cfg in configs:
        entries, meta = sync_one_collection(cfg, old_by_key=old_by_key, limit=limit)
        all_entries.extend(entries)
        collection_metas.append(meta)

    all_entries.sort(key=lambda e: e.get("display_rank", 0))

    edition_count = sum(1 for e in all_entries if e.get("subseries") != "1of1")
    one_of_one_count = sum(1 for e in all_entries if e.get("subseries") == "1of1")
    primary = collection_metas[0] if collection_metas else {}

    payload = {
        "collection_info": {
            "collection_name": primary.get("collection_name") or "Nature Stories · Sui",
            "collection_url": primary.get("collection_url") or "",
            "tradeport_profile": primary.get("collection_url") or "",
            "chain": "sui",
            "native_currency": "SUI",
            "marketplace": "tradeport",
            "collections": [m.get("collection_id") for m in collection_metas],
            "collection_details": collection_metas,
            "last_sui_sync": datetime.now(timezone.utc)
            .replace(microsecond=0)
            .isoformat()
            .replace("+00:00", "Z"),
            "token_count": len(all_entries),
            "edition_count": edition_count,
            "one_of_one_count": one_of_one_count,
        },
        "site": build_site_sections(collection_metas),
        "nfts": all_entries,
    }

    print(
        f"[sui] Gotowe: {len(all_entries)} tokenów "
        f"(edycje={edition_count}, 1/1={one_of_one_count})"
    )

    if dry_run:
        print("[dry-run] Bez zapisu sui_gallery.json")
        return 0

    save_json(OUTPUT_JSON, payload)
    print(f"[sui] Zapisano: {OUTPUT_JSON}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Sync Sui TradePort collections → sui_gallery.json"
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=None, help="Max NFTów na kolekcję (test)")
    parser.add_argument(
        "--collection",
        default=None,
        help="Tylko jedna kolekcja (id z kolekcje.json, np. sui_nature_stories_1of1_tradeport)",
    )
    args = parser.parse_args(argv)
    return sync(
        dry_run=args.dry_run,
        limit=args.limit,
        only_collection=args.collection,
    )


if __name__ == "__main__":
    raise SystemExit(main())