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
import re
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

ROOT = Path(__file__).resolve().parent
JB_NFT = ROOT.parent
KOLEKCJE_JSON = JB_NFT / "raportowanie" / "kolekcje.json"
OUTPUT_JSON = ROOT / "sui_gallery.json"

GRAPHQL_URL = "https://api.indexer.xyz/graphql"
LAUNCHPAD_PUBLIC_BASE = "https://api.indexer.xyz/sui/lp/public/collection"
PAGE_SIZE = 100
LAUNCHPAD_PAGE_SIZE = 50
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

LAUNCHPAD_EDITION_QUERY = """
query fetchLaunchpadEdition($collectionId: uuid!) {
  sui {
    edition_launches(where: { collection_id: { _eq: $collectionId } }, limit: 5) {
      id
      name
      media_url
      preview_url
      price
      supply_count
      minted
      description
      collection_slug
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


def graphql(query: str, variables: dict, *, strict: bool = True) -> dict:
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
        if strict:
            raise SystemExit(f"TradePort GraphQL: {body['errors']}")
        return {}
    return body.get("data") or {}


def normalize_media_url(url: str) -> str:
    raw = (url or "").strip()
    if not raw:
        return ""
    if raw.startswith("ipfs://"):
        cid = raw[7:].strip("/")
        return f"https://ipfs.io/ipfs/{cid}" if cid else ""
    return raw


def try_launchpad_api_row(launchpad_id: str) -> dict | None:
    """Opcjonalnie: edition_launches (gdy TradePort włączy tabelę na kluczu API)."""
    if not launchpad_id:
        return None
    data = graphql(
        LAUNCHPAD_EDITION_QUERY,
        {"collectionId": launchpad_id},
        strict=False,
    )
    rows = (data.get("sui") or {}).get("edition_launches") or []
    return rows[0] if rows else None


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


def launchpad_item_url(base_url: str, token_uuid: str) -> str:
    base = (base_url or "").strip()
    token_uuid = (token_uuid or "").strip()
    if not base or not token_uuid:
        return base
    parsed = urlparse(base)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query["tokenId"] = token_uuid
    return urlunparse(parsed._replace(query=urlencode(query)))


def launchpad_display_rank(name: str, *, fallback: int, kind: str) -> int:
    match = re.search(r"#(\d+)", name or "")
    if match:
        try:
            rank = int(match.group(1))
            if rank > 0:
                return DISPLAY_RANK_1OF1_OFFSET + rank if kind == "1of1" else rank
        except (TypeError, ValueError):
            pass
    return DISPLAY_RANK_1OF1_OFFSET + fallback if kind == "1of1" else fallback


def launchpad_edition_label(*, kind: str, supply: object) -> str:
    if kind == "1of1":
        return "1/1"
    try:
        supply_i = int(supply)
    except (TypeError, ValueError):
        return "Mint · edition"
    if supply_i > 1:
        return f"Edition · {supply_i}"
    return "Mint · edition"


def fetch_launchpad_public_page(launchpad_id: str, *, page: int, page_size: int) -> dict:
    query = urlencode({"page": page, "pageSize": page_size})
    url = f"{LAUNCHPAD_PUBLIC_BASE}/{launchpad_id}/edition-token?{query}"
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "JackBeatnicGallery/1.0", "Accept": "application/json"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")[:500]
        raise SystemExit(f"Launchpad public API HTTP {exc.code}: {detail}") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise SystemExit(f"Launchpad public API failed: {exc}") from exc
    if not isinstance(body, dict):
        raise SystemExit("Launchpad public API: nieoczekiwana odpowiedź")
    return body


def fetch_launchpad_edition_tokens(launchpad_id: str, *, limit: int | None) -> tuple[list[dict], int]:
    if not launchpad_id:
        return [], 0

    rows: list[dict] = []
    total = 0
    page = 1
    while True:
        batch_limit = LAUNCHPAD_PAGE_SIZE
        if limit is not None:
            remaining = limit - len(rows)
            if remaining <= 0:
                break
            batch_limit = min(LAUNCHPAD_PAGE_SIZE, remaining)

        payload = fetch_launchpad_public_page(
            launchpad_id,
            page=page,
            page_size=batch_limit,
        )
        total = int(payload.get("total") or 0)
        batch = payload.get("items") or []
        if not batch:
            break
        rows.extend(batch)
        print(f"  launchpad edition-token… {len(rows)}/{total or '?'}")
        if len(batch) < batch_limit:
            break
        if total and len(rows) >= total:
            break
        page += 1
        time.sleep(0.1)

    return rows, total


def build_launchpad_item_entry(
    *,
    item: dict,
    cfg: dict,
    slug: str,
    tradeport_uuid: str,
    kind: str,
    local_rank: int,
    old: dict | None,
) -> dict | None:
    """Pojedyncza praca dostępna do mintu na TradePort Launchpad."""
    launchpad_base = (cfg.get("tradeport_launchpad_url") or "").strip()
    token_uuid = str(item.get("id") or "").strip()
    if not launchpad_base or not token_uuid:
        return None

    image = normalize_media_url(item.get("mediaUrl") or item.get("previewUrl") or "")
    if not image:
        return None

    col_key = cfg.get("id") or "sui_tradeport"
    name = (item.get("name") or "").strip() or f"JB Sui #{local_rank:04d}"
    description = (item.get("description") or "").strip()
    supply = item.get("supplyCount") if item.get("supplyCount") not in (None, "") else 1
    display_id = launchpad_display_rank(name, fallback=local_rank, kind=kind)
    mint_url = launchpad_item_url(launchpad_base, token_uuid)

    entry: dict = {
        "token_id": display_id,
        "sui_token_id": f"launchpad:{token_uuid}",
        "launchpad_token_id": token_uuid,
        "name": name,
        "tradeport_url": mint_url,
        "marketplace_url": mint_url,
        "image_url": image,
        "supply": supply,
        "edition_label": launchpad_edition_label(kind=kind, supply=supply),
        "subseries": kind,
        "traits": {},
        "ai": {
            "description": description,
            "dominant_colors": [],
            "vibe_tags": ["nature stories", "sui", "tradeport", "launchpad", "ai art"],
            "category": "nature_stories",
            "keywords": ["nature stories", "jack beatnic", "sui", "tradeport", "mint"],
        },
        "likes_count": 0,
        "status": "launchpad",
        "chain": "sui",
        "contract_address": tradeport_uuid,
        "collection_id": col_key,
        "listing_status": "Mint Available",
        "listing_currency": "SUI",
        "display_rank": display_id,
        "medium": "sui_ai",
        "ai_series": "nature_stories",
        "source": "launchpad",
        "marketplace": "tradeport",
        "launchpad": True,
        "tradeport_slug": slug,
    }

    mint_price = sui_price(item.get("price"))
    if mint_price is None and cfg.get("tradeport_mint_price_sui") not in (None, ""):
        try:
            mint_price = float(cfg["tradeport_mint_price_sui"])
        except (TypeError, ValueError):
            mint_price = None
    if mint_price is not None:
        entry["mint_price_sui"] = mint_price

    if old:
        if old.get("likes_count") not in (None, ""):
            entry["likes_count"] = old["likes_count"]
        for key in ("share_url", "og_image"):
            if old.get(key):
                entry[key] = old[key]
        if old.get("ai", {}).get("dominant_colors") and not entry["ai"]["dominant_colors"]:
            entry["ai"]["dominant_colors"] = old["ai"]["dominant_colors"]
        if (old.get("ai", {}).get("description") or "").strip() and not entry["ai"]["description"]:
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

    launchpad_id = (cfg.get("tradeport_launchpad_id") or "").strip()
    launchpad_total = 0
    launchpad_public = False
    if not entries and launchpad_id:
        lp_items, launchpad_total = fetch_launchpad_edition_tokens(
            launchpad_id,
            limit=limit,
        )
        launchpad_public = bool(lp_items)
        if lp_items:
            print(f"  launchpad public API: {len(lp_items)} prac do mintu")
        skipped_lp = 0
        for idx, item in enumerate(lp_items, start=1):
            token_uuid = str(item.get("id") or "").strip()
            old_lp = old_by_key.get((col_key, f"launchpad:{token_uuid}"))
            lp_entry = build_launchpad_item_entry(
                item=item,
                cfg=cfg,
                slug=slug,
                tradeport_uuid=tradeport_uuid,
                kind=kind,
                local_rank=idx,
                old=old_lp,
            )
            if lp_entry is None:
                skipped_lp += 1
            else:
                entries.append(lp_entry)
        if skipped_lp:
            print(f"  launchpad: pominięto bez obrazu: {skipped_lp}")
    elif launchpad_id:
        api_row = try_launchpad_api_row(launchpad_id)
        if api_row:
            print("  launchpad GraphQL: edition_launches OK (indexer ma NFT)")

    entries.sort(key=lambda e: e.get("display_rank", 0))
    minted_n = sum(1 for e in entries if not e.get("launchpad"))
    launchpad_n = len(entries) - minted_n
    print(
        f"  w galerii: {len(entries)} "
        f"(zmintowane={minted_n}, launchpad={launchpad_n}) · pominięto bez obrazu: {skipped}"
    )

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
        "minted_count": minted_n,
        "launchpad_count": launchpad_n,
        "supply": col.get("supply"),
        "launchpad_api": launchpad_public,
        "launchpad_items_total": launchpad_total or None,
    }
    return entries, meta


def build_site_sections(collection_metas: list[dict]) -> dict:
    primary = collection_metas[0] if collection_metas else {}
    primary_title = primary.get("collection_name") or "Nature Stories · Sui"
    primary_url = primary.get("collection_url") or ""

    promo_collections = []
    for meta in collection_metas:
        if not (meta.get("collection_url") or meta.get("launchpad_url")):
            continue
        kind = meta.get("edition_kind")
        lp_total = meta.get("launchpad_items_total") or meta.get("launchpad_count") or 0
        if kind == "1of1":
            edition_label = "1/1"
        elif lp_total and int(lp_total) > 1:
            edition_label = f"Editions · {int(lp_total)} works"
        else:
            edition_label = "Editions"
        promo_collections.append(
            {
                "title": meta.get("collection_name") or meta.get("collection_id"),
                "url": meta.get("launchpad_url") or meta.get("collection_url") or "",
                "edition_label": edition_label,
                "cta": "Mint on TradePort"
                if meta.get("launchpad_count")
                else "View on TradePort",
            }
        )

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
                    "Mint or trade on TradePort — edycje i 1/1; "
                    "karty launchpad linkują do mintu, zmintowane do marketplace."
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

    minted_count = sum(1 for e in all_entries if not e.get("launchpad"))
    launchpad_count = sum(1 for e in all_entries if e.get("launchpad"))
    edition_count = sum(
        1 for e in all_entries if e.get("subseries") != "1of1" and not e.get("launchpad")
    )
    one_of_one_count = sum(
        1 for e in all_entries if e.get("subseries") == "1of1" and not e.get("launchpad")
    )
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
            "minted_count": minted_count,
            "launchpad_count": launchpad_count,
            "edition_count": edition_count,
            "one_of_one_count": one_of_one_count,
        },
        "site": build_site_sections(collection_metas),
        "nfts": all_entries,
    }

    print(
        f"[sui] Gotowe: {len(all_entries)} kart "
        f"(zmintowane={minted_count}, launchpad={launchpad_count})"
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