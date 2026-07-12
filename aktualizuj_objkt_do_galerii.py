#!/usr/bin/env python3
"""Import OBJKT (Tezos) tokens into gallery.json — Photography / Other sections.

Source: https://data.objkt.com/v3/graphql
Wallet: jackbeatnic.tez (configurable in gallery.json → collection_info)

Usage:
  python3 aktualizuj_objkt_do_galerii.py
  python3 aktualizuj_objkt_do_galerii.py --dry-run
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
GALLERY_JSON = ROOT / "gallery.json"
GRAPHQL_URL = "https://data.objkt.com/v3/graphql"
USER_AGENT = "JackBeatnicGallery/1.0"

COLLECTION_PHOTO_KIND: dict[str, str] = {
    "Jack's nature": "photo",
    "JB: Soul Shots | 1/1 ed": "photo",
    "DNS Marketplace": "photo",
    "Jack Beatnic Open Editions": "other",
}

SKIP_COLLECTIONS = {
    "JB: AI Art Jam",
}

OTHER_NAME_HINTS = re.compile(
    r"\b(classic diary|fade diary|collage|sketch|drawn|pastel|pencil|mixed|diary)\b",
    re.I,
)

TOKEN_QUERY = """
query FetchCreated($address: String!, $limit: Int!, $offset: Int!) {
  holder_by_pk(address: $address) {
    address
    tzdomain
    created_tokens(
      limit: $limit
      offset: $offset
      order_by: { token: { timestamp: desc } }
    ) {
      token {
        pk
        name
        fa_contract
        token_id
        display_uri
        thumbnail_uri
        mime
        description
        timestamp
        fa {
          name
          short_name
          category
        }
        tags {
          tag {
            name
          }
        }
        listings_active(limit: 1) {
          price_xtz
        }
      }
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


def load_gallery() -> dict:
    with GALLERY_JSON.open(encoding="utf-8") as fh:
        return json.load(fh)


def save_gallery(data: dict) -> None:
    with GALLERY_JSON.open("w", encoding="utf-8") as fh:
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
    if uri.startswith("http://") or uri.startswith("https://"):
        return uri
    return uri


def tag_names(token: dict) -> list[str]:
    tags = []
    for row in token.get("tags") or []:
        tag = (row or {}).get("tag") or {}
        name = (tag.get("name") or "").strip()
        if name:
            tags.append(name)
    return tags


def classify_photo_kind(token: dict) -> str | None:
    fa_name = ((token.get("fa") or {}).get("name") or "").strip()
    if fa_name in SKIP_COLLECTIONS:
        return None
    if fa_name in COLLECTION_PHOTO_KIND:
        return COLLECTION_PHOTO_KIND[fa_name]

    blob = " ".join(
        [
            token.get("name") or "",
            token.get("description") or "",
            " ".join(tag_names(token)),
            fa_name,
        ]
    )
    if OTHER_NAME_HINTS.search(blob):
        return "other"
    if (token.get("mime") or "").startswith("image/"):
        return "photo"
    return None


def fetch_created_tokens(address: str) -> list[dict]:
    tokens: list[dict] = []
    offset = 0
    limit = 500

    while True:
        data = graphql(TOKEN_QUERY, {"address": address, "limit": limit, "offset": offset})
        holder = data.get("holder_by_pk")
        if not holder:
            break
        batch = [row["token"] for row in holder.get("created_tokens") or [] if row.get("token")]
        tokens.extend(batch)
        print(f"[objkt] Pobrano {len(batch)} tokenów (offset {offset})")
        if len(batch) < limit:
            break
        offset += limit
        time.sleep(0.25)

    return tokens


def price_xtz_from_listing(token: dict) -> float | None:
    listings = token.get("listings_active") or []
    if not listings:
        return None
    raw = listings[0].get("price_xtz")
    if raw in (None, ""):
        return None
    return round(int(raw) / 1_000_000, 6)


def build_nft_entry(token: dict, photo_kind: str, display_rank: int) -> dict:
    fa_contract = token.get("fa_contract") or ""
    tezos_token_id = str(token.get("token_id") or "")
    pk = int(token["pk"])
    fa_name = ((token.get("fa") or {}).get("name") or "Tezos").strip()
    name = (token.get("name") or f"OBJKT #{tezos_token_id}").strip()
    description = (token.get("description") or "").strip()
    tags = tag_names(token)
    image_url = ipfs_to_http(token.get("display_uri") or token.get("thumbnail_uri"))
    price = price_xtz_from_listing(token)

    ai_description = description or f"{name} — photography on Tezos from {fa_name}."
    category = "collage" if photo_kind == "other" else "photography"

    entry = {
        "token_id": pk,
        "name": name,
        "objkt_url": f"https://objkt.com/tokens/{fa_contract}/{tezos_token_id}",
        "opensea_url": f"https://objkt.com/tokens/{fa_contract}/{tezos_token_id}",
        "image_url": image_url,
        "supply": 1,
        "traits": {},
        "ai": {
            "description": ai_description,
            "dominant_colors": [],
            "vibe_tags": tags[:6],
            "category": category,
            "mood_score": 6,
            "keywords": tags[:8] or [fa_name, "tezos", "photography"],
        },
        "likes_count": 0,
        "status": "listed" if price is not None else "minted",
        "chain": "tezos",
        "contract_address": fa_contract,
        "tezos_token_id": tezos_token_id,
        "collection_id": f"objkt_{fa_name.lower().replace(' ', '_').replace('|', '').replace('/', '_')[:40]}",
        "collection_name": fa_name,
        "listing_status": "For Sale" if price is not None else "Not Listed",
        "listing_currency": "XTZ",
        "display_rank": display_rank,
        "medium": "photography",
        "photo_kind": photo_kind,
        "source": "objkt",
        "marketplace": "objkt",
    }

    if price is not None:
        entry["current_price_xtz"] = price

    return entry


def merge_photography(data: dict, objkt_entries: list[dict]) -> tuple[int, int]:
    kept = [
        nft
        for nft in data.get("nfts") or []
        if (nft.get("medium") or "ai_art") != "photography" or nft.get("source") != "objkt"
    ]
    data["nfts"] = kept + objkt_entries

    photo_count = sum(1 for n in objkt_entries if n.get("photo_kind") == "photo")
    other_count = sum(1 for n in objkt_entries if n.get("photo_kind") == "other")
    return photo_count, other_count


def sync(*, dry_run: bool = False) -> int:
    data = load_gallery()
    info = data.setdefault("collection_info", {})

    address = resolve_tezos_address(info)
    info["tezos_creator_wallet"] = address
    info.setdefault("tezos_domain", "jackbeatnic.tez")
    info.setdefault("objkt_profile", "https://objkt.com/@jackbeatnic/")

    print(f"[objkt] Wallet: {info.get('tezos_domain')} → {address}")
    raw_tokens = fetch_created_tokens(address)
    print(f"[objkt] Razem utworzonych tokenów: {len(raw_tokens)}")

    classified: list[tuple[dict, str]] = []
    skipped = 0
    for token in raw_tokens:
        kind = classify_photo_kind(token)
        if kind is None:
            skipped += 1
            continue
        classified.append((token, kind))

    print(f"[objkt] Do galerii: {len(classified)} | pominięto: {skipped}")

    entries: list[dict] = []
    rank_by_kind = {"photo": 0, "other": 0}
    for token, kind in classified:
        rank_by_kind[kind] += 1
        entries.append(build_nft_entry(token, kind, rank_by_kind[kind]))

    photo_count, other_count = merge_photography(data, entries)
    info["last_objkt_sync"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

    print(f"[objkt] Photography: {photo_count} | Other: {other_count}")

    if dry_run:
        print("[dry-run] Bez zapisu gallery.json")
        return 0

    save_gallery(data)
    print(f"[objkt] Zapisano: {GALLERY_JSON}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Import OBJKT tokens into gallery.json")
    parser.add_argument("--dry-run", action="store_true", help="Podgląd bez zapisu")
    return sync(dry_run=parser.parse_args(argv).dry_run)


if __name__ == "__main__":
    raise SystemExit(main())