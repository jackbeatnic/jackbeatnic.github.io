#!/usr/bin/env python3
"""Import OBJKT (Tezos) tokens into gallery.json — Photography / Other sections.

Source: https://data.objkt.com/v3/graphql
Wallet: jackbeatnic.tez (configurable in gallery.json → collection_info)

Do galerii trafiają tylko tokeny POSIADANE (supply>0 i quantity>0 u Ciebie).
Spalone (supply=0) i sprzedane (odeszły z portfela) zostają na objkt.com jako
historia utworzonych — ale nie wchodzą do gallery.json.

Usage:
  python3 aktualizuj_objkt_do_galerii.py
  python3 aktualizuj_objkt_do_galerii.py --dry-run
  python3 aktualizuj_objkt_do_galerii.py --audyt   # CSV w raportowanie/audyt/
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import time
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
JB_NFT = ROOT.parent
GALLERY_JSON = ROOT / "gallery.json"
AUDYT_DIR = JB_NFT / "raportowanie" / "audyt"
GRAPHQL_URL = "https://data.objkt.com/v3/graphql"
USER_AGENT = "JackBeatnicGallery/1.0"

PHOTO_COLLECTIONS = {
    "Jack's nature",
    "JB: Soul Shots | 1/1 ed",
    "DNS Marketplace",
    "Jack Beatnic Open Editions",
}

SKIP_COLLECTIONS = {
    "JB: AI Art Jam",
}

FADE_DIARY_RE = re.compile(r"\bfade\s+diary\b", re.I)
ANALOG_NATURE_RE = re.compile(r"\banalog\s+nature\b", re.I)

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
        supply
        flag
        tags {
          tag {
            name
          }
        }
        holders(where: {holder_address: {_eq: $address}}, limit: 1) {
          quantity
          holder_address
        }
        listings_active(limit: 1) {
          price_xtz
          amount_left
        }
      }
    }
  }
}
"""

AUDYT_FIELDS = [
    "ownership_status",
    "collection_name",
    "fa_contract",
    "tezos_token_id",
    "objkt_pk",
    "name",
    "supply",
    "wallet_quantity",
    "flag",
    "photo_kind",
    "objkt_url",
    "mint_timestamp",
]


@dataclass
class ObjktAudytRow:
    ownership_status: str
    collection_name: str
    fa_contract: str
    tezos_token_id: str
    objkt_pk: str
    name: str
    supply: str
    wallet_quantity: str
    flag: str
    photo_kind: str
    objkt_url: str
    mint_timestamp: str

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
    name = (token.get("name") or "").strip()
    fa_name = ((token.get("fa") or {}).get("name") or "").strip()
    if fa_name in SKIP_COLLECTIONS:
        return None

    # Other / Collage: Fade Diary series only
    if FADE_DIARY_RE.search(name):
        return "other"

    if fa_name in PHOTO_COLLECTIONS:
        return "photo"

    if (token.get("mime") or "").startswith("image/"):
        return "photo"
    return None


def ai_category(token: dict, photo_kind: str) -> str:
    name = (token.get("name") or "").strip()

    if photo_kind == "other":
        return "collage"
    if ANALOG_NATURE_RE.search(name):
        return "analog nature"
    return "photography"


def creator_quantity(token: dict, address: str) -> int:
    for row in token.get("holders") or []:
        if row.get("holder_address") == address:
            return int(row.get("quantity") or 0)
    return 0


def compute_ownership_status(token: dict, address: str) -> str:
    """
    posiadane  — supply>0 i masz quantity>0 (do galerii)
    sprzedane  — supply>0, quantity=0 (historia na objkt.com, nie spalone)
    spalone    — supply=0 on-chain
    """
    supply = int(token.get("supply") or 0)
    quantity = creator_quantity(token, address)
    if supply <= 0:
        return "spalone"
    if quantity > 0:
        return "posiadane"
    return "sprzedane"


def fetch_created_tokens(address: str) -> list[dict]:
    tokens: list[dict] = []
    offset = 0
    limit = 500

    while True:
        data = graphql(
            TOKEN_QUERY, {"address": address, "limit": limit, "offset": offset}
        )
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


def build_nft_entry(
    token: dict, photo_kind: str, display_rank: int, *, creator_address: str
) -> dict:
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
    category = ai_category(token, photo_kind)

    entry = {
        "token_id": pk,
        "name": name,
        "objkt_url": f"https://objkt.com/tokens/{fa_contract}/{tezos_token_id}",
        "opensea_url": f"https://objkt.com/tokens/{fa_contract}/{tezos_token_id}",
        "image_url": image_url,
        "traits": {},
        "ai": {
            "description": ai_description,
            "dominant_colors": [],
            "vibe_tags": tags[:6],
            "category": category,
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
        listings = token.get("listings_active") or []
        if listings:
            amount_left = int(listings[0].get("amount_left") or 0)
            if amount_left > 0:
                entry["listed_quantity"] = amount_left

    mint_ts = (token.get("timestamp") or "").strip()
    if mint_ts:
        entry["mint_timestamp"] = mint_ts

    supply = int(token.get("supply") or 0)
    wallet_qty = creator_quantity(token, creator_address)
    ownership = compute_ownership_status(token, creator_address)
    entry["supply"] = supply
    entry["wallet_quantity"] = wallet_qty
    entry["ownership_status"] = ownership

    return entry


def build_audyt_row(
    token: dict, *, photo_kind: str | None, creator_address: str
) -> ObjktAudytRow:
    fa_contract = token.get("fa_contract") or ""
    tezos_token_id = str(token.get("token_id") or "")
    fa_name = ((token.get("fa") or {}).get("name") or "Tezos").strip()
    supply = int(token.get("supply") or 0)
    wallet_qty = creator_quantity(token, creator_address)
    return ObjktAudytRow(
        ownership_status=compute_ownership_status(token, creator_address),
        collection_name=fa_name,
        fa_contract=fa_contract,
        tezos_token_id=tezos_token_id,
        objkt_pk=str(token.get("pk") or ""),
        name=(token.get("name") or f"OBJKT #{tezos_token_id}").strip(),
        supply=str(supply),
        wallet_quantity=str(wallet_qty),
        flag=str(token.get("flag") or "none"),
        photo_kind=photo_kind or "",
        objkt_url=f"https://objkt.com/tokens/{fa_contract}/{tezos_token_id}",
        mint_timestamp=(token.get("timestamp") or "").strip(),
    )


def write_audyt_csv(path: Path, rows: list[ObjktAudytRow]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=AUDYT_FIELDS)
        writer.writeheader()
        for row in sorted(rows, key=lambda item: int(item.tezos_token_id or 0)):
            writer.writerow(asdict(row))


def export_objkt_audyt(
    raw_tokens: list[dict],
    *,
    creator_address: str,
    stamp: str,
) -> dict[str, Path]:
    by_status: dict[str, list[ObjktAudytRow]] = {
        "posiadane": [],
        "sprzedane": [],
        "spalone": [],
    }
    for token in raw_tokens:
        kind = classify_photo_kind(token)
        row = build_audyt_row(token, photo_kind=kind, creator_address=creator_address)
        bucket = row.ownership_status
        if bucket not in by_status:
            bucket = "sprzedane"
        by_status[bucket].append(row)

    paths: dict[str, Path] = {}
    for status, rows in by_status.items():
        path = AUDYT_DIR / f"objkt_audyt_{status}_{stamp}.csv"
        write_audyt_csv(path, rows)
        paths[status] = path
    summary_path = AUDYT_DIR / f"objkt_audyt_podsumowanie_{stamp}.csv"
    write_audyt_csv(
        summary_path,
        [
            ObjktAudytRow(
                ownership_status="podsumowanie",
                collection_name="OBJKT jackbeatnic",
                fa_contract="",
                tezos_token_id="",
                objkt_pk="",
                name=f"utworzone={len(raw_tokens)}",
                supply=str(len(by_status["posiadane"])),
                wallet_quantity=str(len(by_status["sprzedane"])),
                flag=str(len(by_status["spalone"])),
                photo_kind="",
                objkt_url="",
                mint_timestamp=datetime.now(timezone.utc)
                .replace(microsecond=0)
                .isoformat()
                .replace("+00:00", "Z"),
            )
        ],
    )
    paths["podsumowanie"] = summary_path
    return paths


def merge_photography(data: dict, objkt_entries: list[dict]) -> tuple[int, int]:
    preserve_keys = ("share_url", "og_image", "likes_count")
    old_by_id = {
        int(nft["token_id"]): nft
        for nft in data.get("nfts") or []
        if nft.get("source") == "objkt" and nft.get("token_id") is not None
    }
    for entry in objkt_entries:
        old = old_by_id.get(int(entry["token_id"]))
        if not old:
            continue
        for key in preserve_keys:
            if old.get(key) not in (None, "") and not entry.get(key):
                entry[key] = old[key]

    kept = [
        nft
        for nft in data.get("nfts") or []
        if (nft.get("medium") or "ai_art") != "photography" or nft.get("source") != "objkt"
    ]
    data["nfts"] = kept + objkt_entries

    photo_count = sum(1 for n in objkt_entries if n.get("photo_kind") == "photo")
    other_count = sum(1 for n in objkt_entries if n.get("photo_kind") == "other")
    return photo_count, other_count


def sync(*, dry_run: bool = False, audyt_only: bool = False) -> int:
    data = load_gallery()
    info = data.setdefault("collection_info", {})

    address = resolve_tezos_address(info)
    info["tezos_creator_wallet"] = address
    info.setdefault("tezos_domain", "jackbeatnic.tez")
    info.setdefault("objkt_profile", "https://objkt.com/@jackbeatnic/")

    print(f"[objkt] Wallet: {info.get('tezos_domain')} → {address}")
    raw_tokens = fetch_created_tokens(address)
    print(f"[objkt] Razem utworzonych (historia OBJKT): {len(raw_tokens)}")

    status_counts = {"posiadane": 0, "sprzedane": 0, "spalone": 0}
    for token in raw_tokens:
        status = compute_ownership_status(token, address)
        status_counts[status] = status_counts.get(status, 0) + 1
    print(
        f"[objkt] Saldo: posiadane={status_counts.get('posiadane', 0)}, "
        f"sprzedane={status_counts.get('sprzedane', 0)}, "
        f"spalone={status_counts.get('spalone', 0)}"
    )

    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    audyt_paths = export_objkt_audyt(raw_tokens, creator_address=address, stamp=stamp)
    print("[objkt] Audyt CSV:")
    for key, path in audyt_paths.items():
        print(f"  {key}: {path.name}")

    if audyt_only:
        print("[audyt] Tylko CSV — bez zmian w gallery.json")
        return 0

    classified: list[tuple[dict, str]] = []
    skipped_kind = 0
    skipped_not_owned = 0
    for token in raw_tokens:
        if compute_ownership_status(token, address) != "posiadane":
            skipped_not_owned += 1
            continue
        kind = classify_photo_kind(token)
        if kind is None:
            skipped_kind += 1
            continue
        classified.append((token, kind))

    print(
        f"[objkt] Do galerii (posiadane): {len(classified)} | "
        f"pominięto kategorię: {skipped_kind} | "
        f"sprzedane/spalone: {skipped_not_owned}"
    )

    entries: list[dict] = []
    rank_by_kind = {"photo": 0, "other": 0}
    for token, kind in classified:
        rank_by_kind[kind] += 1
        entries.append(
            build_nft_entry(
                token, kind, rank_by_kind[kind], creator_address=address
            )
        )

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
    parser.add_argument(
        "--audyt",
        action="store_true",
        help="Tylko eksport CSV do raportowanie/audyt/ (bez gallery.json)",
    )
    args = parser.parse_args(argv)
    return sync(dry_run=args.dry_run, audyt_only=args.audyt)


if __name__ == "__main__":
    raise SystemExit(main())