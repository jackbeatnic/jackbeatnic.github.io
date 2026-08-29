#!/usr/bin/env python3
"""Zbuduj/odśwież www/xrp_gallery.json z katalogu JBN (MANIFEST + CDN).

Źródło prawdy: XRPL/catalog/MANIFEST.csv + opcjonalnie ledger (account_nfts).
Statusy: available | minted | listed | sold

Usage:
  python3 aktualizuj_xrp_catalog_do_galerii.py
  python3 aktualizuj_xrp_catalog_do_galerii.py --dry-run
  python3 aktualizuj_xrp_catalog_do_galerii.py --sync-ledger   # sold jeśli NFT nie na koncie mintera a było minted
  python3 aktualizuj_xrp_catalog_do_galerii.py --limit 20
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
JB = ROOT.parent
MANIFEST = JB / "XRPL" / "catalog" / "MANIFEST.csv"
OUT = ROOT / "xrp_gallery.json"
sys.path.insert(0, str(JB / "XRPL"))
from linie import COLLECTION_ID, COLLECTION_NAME, line_cfg  # noqa: E402

CDN_META = (
    "https://cdn.jsdelivr.net/gh/jackbeatnic/jb-nft-assets@main/meta/xrpl/jbn/{id}.json"
)
CDN_IMG = (
    "https://cdn.jsdelivr.net/gh/jackbeatnic/jb-nft-assets@main/media/xrpl/jbn/{id}.jpg"
)
DEFAULT_ISSUER = "rK4o7s2QDXPYWqB2jQRhH3ew9E8KeKYuxn"


def load_manifest() -> list[dict]:
    if not MANIFEST.is_file():
        raise SystemExit(f"Brak {MANIFEST}")
    rows = []
    with MANIFEST.open(encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            rows.append(row)
    return rows


def ledger_owned_ids(address: str) -> set[str]:
    try:
        from xrpl.clients import JsonRpcClient
        from xrpl.models.requests import AccountNFTs
    except ImportError:
        print("warn: xrpl-py brak — pomijam --sync-ledger")
        return set()
    client = JsonRpcClient("https://s1.ripple.com:51234/")
    ids: set[str] = set()
    marker = None
    while True:
        req = (
            AccountNFTs(account=address, limit=400, marker=marker)
            if marker
            else AccountNFTs(account=address, limit=400)
        )
        r = client.request(req).result
        for n in r.get("account_nfts") or []:
            if n.get("NFTokenID"):
                ids.add(n["NFTokenID"])
        marker = r.get("marker")
        if not marker:
            break
    return ids


def build(
    rows: list[dict],
    *,
    owned: set[str] | None = None,
    limit: int = 0,
) -> dict:
    issuer = (
        os.environ.get("XRPL_ADDRESS") or DEFAULT_ISSUER
    ).strip() or DEFAULT_ISSUER
    nfts = []
    for row in rows:
        try:
            tid = int(row["id"])
        except (KeyError, ValueError):
            continue
        if limit and tid > limit and len(nfts) >= limit:
            # limit = max id lub max count? użyj max count
            pass
        status = (row.get("status") or "available").strip().lower()
        nft_id = (row.get("xrpl_nft_id") or "").strip()
        # ledger: jeśli było minted/listed a NFT zniknęło z konta → sold
        if owned is not None and nft_id:
            if status in ("minted", "listed") and nft_id not in owned:
                status = "sold"
            elif status == "available" and nft_id in owned:
                status = "minted"

        price = float(row.get("price_xrp") or 0.1)
        listing_status = {
            "available": "Mint Available",
            "minted": "Not listed",
            "listed": "For Sale",
            "sold": "Sold",
        }.get(status, status)

        try:
            cfg = line_cfg(row.get("line") or "ai")
        except ValueError:
            cfg = line_cfg("ai")
        supply = int(float(row.get("supply_ref") or cfg["supply"]))
        name = (row.get("name") or f"{cfg['prefix']} #{tid} X").strip()
        img = CDN_IMG.format(id=tid)
        medium = cfg["gh_medium"]
        # lokalny fallback ścieżka względna (www nie serwuje XRPL/ — CDN primary)
        item = {
            "token_id": tid,
            "xrpl_nft_id": nft_id or None,
            "nft_serial": None,
            "name": name,
            "xrp_cafe_url": (
                f"https://xrp.cafe/nft/{nft_id}" if nft_id else None
            ),
            # NIE wstawiaj meta .json jako marketplace_url (otwierało JSON w przeglądarce)
            "marketplace_url": (
                f"https://xrp.cafe/nft/{nft_id}" if nft_id else None
            ),
            "collection_url": "https://jackbeatnic.github.io",
            "image_url": img,
            "meta_url": CDN_META.format(id=tid),
            "supply": supply,
            "traits": [
                {"trait_type": "Line", "value": cfg["label"]},
                {"trait_type": "Series", "value": cfg["prefix"]},
            ],
            "ai": {
                "description": (
                    f"{cfg['body']}\n\n"
                    f"(c) Jack Beatnic 2026 | XRPL Edition | {cfg['footer']}\n"
                    "https://jackbeatnic.github.io"
                ),
                "category": cfg["key"],
                "vibe_tags": ["xrpl", cfg["prefix"].lower(), "semi-exclusive"],
            },
            "likes_count": 0,
            "status": status,
            "chain": "xrpl",
            "contract_address": issuer,
            "nft_taxon": 0,
            "collection_id": COLLECTION_ID,
            "collection_name": COLLECTION_NAME,
            "listing_status": listing_status,
            "listing_currency": "XRP",
            "current_price_xrp": price if status in ("available", "listed") else None,
            "display_rank": tid,
            "medium": medium,
            "photo_kind": cfg["photo_kind"] or None,
            "xrpl_line": cfg["key"],
            "source": "catalog_manifest",
            "marketplace": "gh_gallery",
            "price_xrp": price,
            "drops": row.get("drops") or str(int(round(price * 1_000_000))),
            "minted_count": 1 if nft_id else 0,
        }
        nfts.append(item)
        if limit and len(nfts) >= limit:
            break

    nfts.sort(key=lambda x: int(x["token_id"]))
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    counts = {}
    for n in nfts:
        counts[n["status"]] = counts.get(n["status"], 0) + 1
    price_vals = [
        round(float(n["price_xrp"]), 6)
        for n in nfts
        if n.get("price_xrp") is not None
    ]
    default_price = Counter(price_vals).most_common(1)[0][0] if price_vals else 0.1

    return {
        "collection_info": {
            "issuer_wallet": issuer,
            "nft_taxon": 0,
            "collection_name": COLLECTION_NAME,
            "collection_id": COLLECTION_ID,
            "chain": "xrpl",
            "native_currency": "XRP",
            "marketplace": "gh_gallery_lazy",
            "model": "mint_on_demand_semi_exclusive",
            "supply_ref": 3000,
            "price_xrp_default": default_price,
            "mint_live": True,
            "catalog_size": len(nfts),
            "status_counts": counts,
            "cdn_meta": CDN_META,
            "cdn_media": CDN_IMG,
            "manifest": str(MANIFEST.relative_to(JB)),
            "last_xrp_sync": now,
        },
        "site": {
            "title": "Jack Beatnic · XRPL",
            "chain": "xrpl",
            "sections": {
                "ai_art": {
                    "explore_titles": {"xrpl": "Explore · XRPL"},
                    "empty_messages": {
                        "xrpl": (
                            "Nothing here yet — more XRPL works will appear "
                            "as they are released."
                        )
                    },
                    "promo_eyebrow": "Jack Beatnic · XRPL",
                    "promo_lead": (
                        "Lazy mint from the studio. AI Nature up to 3000 copies; "
                        "pay the destination tag, then accept the 0 XRP offer."
                    ),
                    "promo_collections": [],
                },
                "photography": {
                    "explore_titles": {
                        "xrpl": "Explore Photography & Artworks · XRPL"
                    },
                    "empty_messages": {
                        "xrpl": (
                            "Nothing here yet — more XRPL photography and "
                            "artworks will appear as they are released."
                        )
                    },
                    "promo_eyebrow": "Jack Beatnic · XRPL",
                    "promo_lead": (
                        "Lazy mint from the studio. Photography and artworks — "
                        "up to 500 copies of each image. Pay with the destination "
                        "tag, then accept the 0 XRP offer."
                    ),
                    "promo_collections": [],
                },
            },
        },
        "nfts": nfts,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--sync-ledger", action="store_true")
    ap.add_argument("--limit", type=int, default=0, help="max rekordów (0=all)")
    args = ap.parse_args()

    rows = load_manifest()
    print(f"manifest rows: {len(rows)}")
    owned = None
    if args.sync_ledger:
        addr = (os.environ.get("XRPL_ADDRESS") or DEFAULT_ISSUER).strip()
        owned = ledger_owned_ids(addr)
        print(f"ledger NFTs on {addr}: {len(owned)}")

    data = build(rows, owned=owned, limit=args.limit)
    counts = data["collection_info"]["status_counts"]
    print("status_counts:", counts)
    print("sample:", data["nfts"][0]["name"], data["nfts"][0]["status"])

    if args.dry_run:
        print("[dry-run] bez zapisu")
        return 0

    # backup starej galerii jeśli była z Cafe
    if OUT.is_file():
        bak = OUT.with_suffix(
            f".bak_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json"
        )
        bak.write_bytes(OUT.read_bytes())
        print("backup →", bak.name)

    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("wrote", OUT, "nfts=", len(data["nfts"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
