#!/usr/bin/env python3
"""Sync Nature Jam (ERC-721) → nature_jam_gallery.json.

Źródła:
  - raportowanie/raporty/avalanche_nature_jam_raport.csv (OpenSea, listing)
  - raportowanie/raporty/avalanche_nature_jam_salvor.csv (ceny Salvor)
  - obrazy: strony OpenSea (seadn.io ?w=1000 — pełna proporcja)

Usage:
  ./venv/bin/python3 aktualizuj_nature_jam_do_galerii.py
  ./venv/bin/python3 aktualizuj_nature_jam_do_galerii.py --workers 16
  ./venv/bin/python3 aktualizuj_nature_jam_do_galerii.py --skip-images
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
JB_NFT = ROOT.parent
KOLEKCJE_JSON = JB_NFT / "raportowanie" / "kolekcje.json"
RAPORTY_DIR = JB_NFT / "raportowanie" / "raporty"
OUTPUT_JSON = ROOT / "nature_jam_gallery.json"

COLLECTION_ID = "avalanche_nature_jam"
SALVOR_SLUG = "nature-jam"
SEADN_DISPLAY_WIDTH = 1000

SEADN_RE = re.compile(
    r"https://i2c\.seadn\.io/avalanche/0xad3ff[a-fA-F0-9]+/[a-f0-9]+/[a-f0-9]+\.jpeg(?:\?w=\d+)?",
    re.I,
)
TITLE_RE = re.compile(r"<title>([^<]+)</title>", re.I)


def load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def save_json(path: Path, data: dict) -> None:
    with path.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
        fh.write("\n")


def load_collection() -> dict:
    data = load_json(KOLEKCJE_JSON)
    for row in data.get("collections", []):
        if row.get("id") == COLLECTION_ID:
            return row
    raise SystemExit(f"Brak {COLLECTION_ID} w kolekcje.json")


def parse_price(value: str) -> float | None:
    if not value or value in ("N/A", "Not Listed", ""):
        return None
    try:
        return float(value)
    except ValueError:
        return None


def normalize_seadn_image_url(url: str) -> str:
    if not url or "seadn.io" not in url:
        return url
    base = url.split("?", 1)[0]
    return f"{base}?w={SEADN_DISPLAY_WIDTH}"


def pick_seadn_image(html: str) -> str:
    matches = SEADN_RE.findall(html)
    if not matches:
        return ""
    for img in matches:
        if f"?w={SEADN_DISPLAY_WIDTH}" in img:
            return normalize_seadn_image_url(img)
    for img in matches:
        if "?w=" in img:
            return normalize_seadn_image_url(img)
    return normalize_seadn_image_url(matches[0])


def parse_opensea_title(title: str) -> str:
    raw = title.split("|")[0].strip()
    if " - " in raw:
        raw = raw.split(" - ", 1)[0].strip()
    raw = re.sub(r"\s+#\d+\s*$", "", raw).strip()
    return raw or ""


def fetch_opensea_page(contract: str, token_id: int) -> tuple[str, str]:
    page_url = f"https://opensea.io/assets/avalanche/{contract}/{token_id}"
    req = urllib.request.Request(
        page_url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; JackBeatnicGallery/1.0)",
            "Accept": "text/html",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            html = resp.read().decode("utf-8", errors="ignore")
    except (urllib.error.URLError, TimeoutError, OSError):
        return "", ""

    title_m = TITLE_RE.search(html)
    name = parse_opensea_title(title_m.group(1)) if title_m else ""
    image = pick_seadn_image(html)
    return name, image


def salvor_asset_url(contract: str, token_id: int) -> str:
    return f"https://salvor.io/asset/{contract}/{token_id}"


def load_raport_rows() -> dict[int, dict]:
    path = RAPORTY_DIR / f"{COLLECTION_ID}_raport.csv"
    if not path.exists():
        raise SystemExit(f"Brak raportu: {path}")
    rows: dict[int, dict] = {}
    with path.open(encoding="utf-8", newline="") as fh:
        for row in csv.DictReader(fh):
            try:
                tid = int(row.get("token_id", 0))
            except (TypeError, ValueError):
                continue
            if tid > 0:
                rows[tid] = row
    return rows


def load_salvor_prices() -> dict[int, dict]:
    path = RAPORTY_DIR / f"{COLLECTION_ID}_salvor.csv"
    if not path.exists():
        raise SystemExit(f"Brak tabeli Salvor: {path}")
    prices: dict[int, dict] = {}
    with path.open(encoding="utf-8", newline="") as fh:
        for row in csv.DictReader(fh):
            try:
                tid = int(row.get("token_id", 0))
            except (TypeError, ValueError):
                continue
            if tid > 0:
                prices[tid] = row
    return prices


def enrich_images(
    contract: str,
    token_ids: list[int],
    *,
    workers: int,
    old_by_id: dict[int, dict],
    retries: int = 2,
) -> dict[int, str]:
    results: dict[int, str] = {}
    for tid in token_ids:
        old_img = (old_by_id.get(tid) or {}).get("image_url") or ""
        if old_img and "?w=" in old_img:
            results[tid] = old_img

    pending = [tid for tid in token_ids if tid not in results]

    def scrape_pass(ids: list[int], pass_workers: int, label: str) -> None:
        done = 0
        with ThreadPoolExecutor(max_workers=pass_workers) as pool:
            futures = {pool.submit(fetch_opensea_page, contract, tid): tid for tid in ids}
            for fut in as_completed(futures):
                tid = futures[fut]
                try:
                    _, image = fut.result()
                except Exception:
                    image = ""
                if image:
                    results[tid] = image
                done += 1
                if done % 100 == 0:
                    print(f"  {label}… {done}/{len(ids)} ({len(results)} z obrazem)")

    if pending:
        scrape_pass(pending, workers, "OpenSea scrape")
        for attempt in range(1, retries + 1):
            missing = [tid for tid in token_ids if tid not in results]
            if not missing:
                break
            time.sleep(3 * attempt)
            scrape_pass(
                missing,
                max(4, workers // 2),
                f"retry {attempt}",
            )
    return results


def build_entry(
    *,
    tid: int,
    contract: str,
    raport: dict,
    salvor: dict | None,
    image_url: str,
    old: dict | None,
) -> dict | None:
    if not image_url:
        return None

    name = (raport.get("name") or salvor.get("nazwa") if salvor else "") or f"JB NJ #{tid:04d}"
    opensea_url = raport.get("opensea_url") or (
        f"https://opensea.io/assets/avalanche/{contract}/{tid}"
    )
    salvor_url = salvor_asset_url(contract, tid)

    os_price = parse_price((raport.get("price") or "").strip())
    if os_price is None and salvor:
        os_price = parse_price((salvor.get("cena_opensea") or "").strip())
    salvor_price = parse_price((salvor or {}).get("cena_salvor") or "")

    listing_status = raport.get("listing_status") or "Not Listed"
    if salvor_price is not None and listing_status != "For Sale":
        listing_status = "For Sale"

    entry: dict = {
        "token_id": tid,
        "onchain_token_id": tid,
        "name": name.strip(),
        "opensea_url": opensea_url,
        "salvor_url": salvor_url,
        "marketplace_url": salvor_url,
        "image_url": image_url,
        "supply": 1,
        "traits": {},
        "ai": {
            "description": "",
            "dominant_colors": [],
            "vibe_tags": ["nature jam", "avalanche", "ai art"],
            "category": "nature_jam",
            "keywords": ["nature jam", "jack beatnic", "avalanche"],
        },
        "likes_count": 0,
        "status": "listed" if listing_status == "For Sale" else "minted",
        "chain": "avalanche",
        "contract_address": contract.lower(),
        "collection_id": COLLECTION_ID,
        "listing_status": listing_status,
        "listing_currency": "AVAX",
        "display_rank": tid,
        "medium": "ai_art",
        "ai_series": "nature_jam",
        "source": "dual",
        "marketplace": "dual",
        "marketplaces": ["salvor", "opensea"],
    }

    if salvor_price is not None:
        entry["current_price_avax"] = salvor_price
        entry["salvor_price_avax"] = salvor_price
    if os_price is not None:
        entry["opensea_price_avax"] = os_price

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


def sync(*, dry_run: bool = False, workers: int = 12, skip_images: bool = False) -> int:
    collection = load_collection()
    contract = collection["contract"].lower()
    print(f"[nature_jam] {COLLECTION_ID} · contract={contract}")

    raport = load_raport_rows()
    salvor = load_salvor_prices()
    token_ids = sorted(raport.keys())
    print(f"  raport: {len(token_ids)} tokenów · salvor: {len(salvor)} cen")

    old_data = load_json(OUTPUT_JSON) if OUTPUT_JSON.exists() else {}
    old_by_id = {
        int(row["onchain_token_id"]): row
        for row in old_data.get("nfts") or []
        if row.get("onchain_token_id") is not None
    }

    images: dict[int, str] = {}
    if skip_images:
        for tid in token_ids:
            old_img = (old_by_id.get(tid) or {}).get("image_url") or ""
            if old_img:
                images[tid] = normalize_seadn_image_url(old_img)
    else:
        print("  pobieram obrazy ze stron OpenSea (seadn.io ?w=1000)…")
        images = enrich_images(
            contract,
            token_ids,
            workers=workers,
            old_by_id=old_by_id,
        )

    entries: list[dict] = []
    skipped = 0
    for tid in token_ids:
        entry = build_entry(
            tid=tid,
            contract=contract,
            raport=raport[tid],
            salvor=salvor.get(tid),
            image_url=images.get(tid, ""),
            old=old_by_id.get(tid),
        )
        if entry is None:
            skipped += 1
        else:
            entries.append(entry)

    entries.sort(key=lambda e: e.get("onchain_token_id", 0))
    print(f"  pominięto bez obrazu: {skipped}")

    payload = {
        "collection_info": {
            "ai_series": "nature_jam",
            "label": "Nature Jam",
            "chain": "avalanche",
            "contract": contract,
            "standard": "erc721",
            "salvor_slug": SALVOR_SLUG,
            "salvor_profile": "https://salvor.io/profile/JackBeatnicAI",
            "image_source": "opensea",
            "seadn_display_width": SEADN_DISPLAY_WIDTH,
            "last_nature_jam_sync": datetime.now(timezone.utc)
            .replace(microsecond=0)
            .isoformat()
            .replace("+00:00", "Z"),
            "token_count": len(entries),
            "onchain_total": len(token_ids),
        },
        "nfts": entries,
    }

    print(f"[nature_jam] Gotowe: {len(entries)} tokenów w galerii")
    if dry_run:
        print("[dry-run] Bez zapisu nature_jam_gallery.json")
        return 0

    save_json(OUTPUT_JSON, payload)
    print(f"[nature_jam] Zapisano: {OUTPUT_JSON}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Sync Nature Jam → nature_jam_gallery.json")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--workers", type=int, default=12)
    parser.add_argument(
        "--skip-images",
        action="store_true",
        help="Zachowaj obrazy z poprzedniego JSON (tylko ceny/URL)",
    )
    args = parser.parse_args(argv)
    return sync(dry_run=args.dry_run, workers=args.workers, skip_images=args.skip_images)


if __name__ == "__main__":
    raise SystemExit(main())