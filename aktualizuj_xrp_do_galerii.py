#!/usr/bin/env python3
"""Import XRP.Cafe / XRPL NFTs into xrp_gallery.json (separate from OpenSea gallery.json).

Data sources (open, no API key):
  - XRPScan account NFTs (full ledger list): api.xrpscan.com
  - XRP.Cafe NFT pages + collection index (__NEXT_DATA__ SSR)
  - XRP.Cafe CDN for images and metadata JSON

All marketplace links point to https://xrp.cafe/

Usage:
  python3 aktualizuj_xrp_do_galerii.py
  python3 aktualizuj_xrp_do_galerii.py --dry-run
  python3 aktualizuj_xrp_do_galerii.py --limit 5
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent
XRP_GALLERY_JSON = ROOT / "xrp_gallery.json"
MAIN_GALLERY_JSON = ROOT / "gallery.json"
XRPSCAN_API = "https://api.xrpscan.com/api/v1"
CAFE_BASE = "https://xrp.cafe"
USER_AGENT = "JackBeatnicGallery/1.0"
DEFAULT_ISSUER = "rK4o7s2QDXPYWqB2jQRhH3ew9E8KeKYuxn"
DEFAULT_TAXON = 0
DEFAULT_COLLECTION = "JB AI Nature"
DEFAULT_VANITY = "jb-ai-nature"
DROPS_PER_XRP = 1_000_000

TOPIC_TO_CATEGORY = {
    "mountains": "landscape",
    "mountain": "landscape",
    "sea": "landscape",
    "ocean": "landscape",
    "forest": "landscape",
    "flower": "floral",
    "flowers": "floral",
    "animal": "wildlife",
    "animals": "wildlife",
    "bird": "wildlife",
    "abstract": "abstract",
    "city": "urban",
    "street": "urban",
}

VIBE_WORDS = (
    "serene",
    "minimalist",
    "ethereal",
    "contemplative",
    "harmonious",
    "playful",
    "dreamy",
    "moody",
    "vibrant",
    "quiet",
    "peaceful",
    "dramatic",
    "soft",
    "bold",
    "delicate",
)


def load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def save_json(path: Path, data: dict) -> None:
    with path.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
        fh.write("\n")


def fetch_bytes(url: str) -> bytes:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "*/*"},
    )
    with urllib.request.urlopen(req, timeout=90) as resp:
        return resp.read()


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


def fetch_cafe_html(url: str, label: str = "") -> str:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            return resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"HTTP {exc.code} {label or url}: {exc.reason}") from exc


def parse_next_data(html: str) -> dict:
    match = re.search(
        r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>',
        html,
        re.DOTALL,
    )
    if not match:
        raise RuntimeError("Brak __NEXT_DATA__ na stronie XRP.Cafe")
    payload = json.loads(match.group(1))
    return payload.get("props", {}).get("pageProps") or {}


def cafe_nft_url(nft_id: str) -> str:
    return f"{CAFE_BASE}/nft/{nft_id}"


def cafe_collection_url(issuer: str, taxon: int) -> str:
    return f"{CAFE_BASE}/usercollection/{issuer}/{issuer}/{taxon}"


def cafe_collection_vanity_url(vanity: str) -> str:
    return f"{CAFE_BASE}/collection/{vanity}"


def cafe_profile_url(issuer: str) -> str:
    return f"{CAFE_BASE}/user/{issuer}"


def ipfs_to_http(uri: str | None) -> str:
    if not uri:
        return ""
    uri = uri.strip()
    if uri.startswith("ipfs://"):
        return f"https://ipfs.io/ipfs/{uri[7:]}"
    if uri.startswith("http://") or uri.startswith("https://"):
        return uri
    return uri


def decode_nft_uri(raw: str | None) -> str:
    if not raw:
        return ""
    text = str(raw).strip()
    if text.startswith("ipfs://") or text.startswith("http"):
        return text
    try:
        if re.fullmatch(r"[0-9a-fA-F]+", text) and len(text) % 2 == 0:
            return bytes.fromhex(text).decode("utf-8")
    except ValueError:
        pass
    return text


def drops_to_xrp(drops: object) -> float | None:
    if drops in (None, "", 0):
        return None
    try:
        return round(int(drops) / DROPS_PER_XRP, 5)
    except (TypeError, ValueError):
        return None


def stable_token_id(xrpl_nft_id: str, nft_serial: int) -> int:
    """Numeric id for gallery UI — avoids collision with EVM low ids."""
    base = int(nft_serial) if nft_serial else 0
    if base >= 10_000_000:
        return base
    suffix = int(xrpl_nft_id[-8:], 16) % 9_000_000
    return 10_000_000 + suffix


def extract_number_from_name(name: str) -> int:
    match = re.search(r"#(\d+)", name or "")
    return int(match.group(1)) if match else 9999


def dominant_colors(image_url: str, count: int = 4) -> list[str]:
    if not image_url:
        return []
    try:
        data = fetch_bytes(image_url)
        img = Image.open(BytesIO(data)).convert("RGB")
        img.thumbnail((160, 160), Image.Resampling.LANCZOS)
        quantized = img.quantize(colors=12, method=Image.Quantize.MEDIANCUT)
        palette = quantized.getpalette() or []
        color_counts = Counter(quantized.getdata())
        ranked: list[tuple[int, tuple[int, int, int]]] = []
        for idx, freq in color_counts.most_common():
            if idx == 0:
                continue
            base = idx * 3
            if base + 2 >= len(palette):
                continue
            rgb = (palette[base], palette[base + 1], palette[base + 2])
            ranked.append((freq, rgb))
        ranked.sort(key=lambda row: row[0], reverse=True)
        hexes: list[str] = []
        for _, rgb in ranked[: count * 2]:
            hx = "#{:02X}{:02X}{:02X}".format(*rgb)
            if hx.upper() in {"#000000", "#FFFFFF"}:
                continue
            if hx not in hexes:
                hexes.append(hx)
            if len(hexes) >= count:
                break
        return hexes[:count]
    except Exception:
        return []


def infer_category(meta: dict, traits: dict) -> str:
    topic = (traits.get("Topic") or traits.get("topic") or "").strip().lower()
    if topic in TOPIC_TO_CATEGORY:
        return TOPIC_TO_CATEGORY[topic]
    for key, cat in TOPIC_TO_CATEGORY.items():
        if key in topic:
            return cat
    desc = (meta.get("description") or "").lower()
    if "landscape" in desc or "mountain" in desc or "sea" in desc:
        return "landscape"
    if "flower" in desc or "floral" in desc:
        return "floral"
    return "landscape"


def infer_vibe_tags(meta: dict, traits: dict) -> list[str]:
    tags: list[str] = []
    topic = traits.get("Topic") or traits.get("topic")
    if topic:
        tags.append(str(topic).strip().lower())
    blob = f"{meta.get('name', '')} {meta.get('description', '')}".lower()
    for word in VIBE_WORDS:
        if word in blob and word not in tags:
            tags.append(word)
    tags.extend(["ai art", "xrpl", "xrp cafe"])
    out: list[str] = []
    for tag in tags:
        clean = re.sub(r"\s+", " ", tag).strip()
        if clean and clean not in out:
            out.append(clean)
    return out[:8]


def infer_mood_score(vibe_tags: list[str], description: str) -> int:
    score = 6
    text = " ".join(vibe_tags) + " " + (description or "").lower()
    if any(w in text for w in ("serene", "peaceful", "quiet", "contemplative")):
        score += 1
    if any(w in text for w in ("dramatic", "bold", "vibrant")):
        score += 1
    if "moody" in text:
        score -= 1
    return max(4, min(9, score))


def traits_from_attributes(attrs: list[dict]) -> dict:
    traits: dict[str, str] = {}
    for row in attrs or []:
        key = (row.get("trait_type") or row.get("name") or "").strip()
        val = row.get("value")
        if key and val not in (None, ""):
            traits[key] = str(val)
    return traits


def keywords_from(meta: dict, traits: dict, vibe_tags: list[str]) -> list[str]:
    words: list[str] = []
    words.extend(vibe_tags[:6])
    for key in ("Topic", "Size"):
        if traits.get(key):
            words.append(str(traits[key]).lower())
    name = meta.get("name") or ""
    words.extend(re.findall(r"[A-Za-z]{4,}", name.lower()))
    words.extend(["jackbeatnic", "jb ai nature", "xrpl", "xrp cafe"])
    out: list[str] = []
    for w in words:
        w = w.strip().lower()
        if w and w not in out:
            out.append(w)
    return out[:10]


def fetch_account_nfts(issuer: str) -> list[dict]:
    url = f"{XRPSCAN_API}/account/{issuer}/nfts"
    data = fetch_json(url, label=f"account {issuer}")
    if not isinstance(data, list):
        raise RuntimeError(f"Unexpected XRPScan payload for {issuer}")
    return data


def fetch_cafe_collection_index(issuer: str, taxon: int) -> dict[str, dict]:
    """First SSR page of usercollection — maps nft_id → row (incl. bestSellOffer)."""
    url = cafe_collection_url(issuer, taxon)
    page_props = parse_next_data(fetch_cafe_html(url, label="collection index"))
    index: dict[str, dict] = {}
    for row in page_props.get("nfts") or []:
        cafe = row.get("cafeNft") or {}
        nft_id = cafe.get("nft_id") or (row.get("ledgerNft") or {}).get("nft_id")
        if nft_id:
            index[nft_id] = row
    return index


def fetch_cafe_nft(nft_id: str) -> dict:
    page_props = parse_next_data(
        fetch_cafe_html(cafe_nft_url(nft_id), label=f"cafe nft {nft_id[:12]}")
    )
    nftdata = page_props.get("nftdata") or {}
    nft = nftdata.get("nft")
    return nft if isinstance(nft, dict) else {}


def fetch_metadata_url(meta_url: str) -> dict:
    if not meta_url:
        return {}
    try:
        data = fetch_json(meta_url, label="cafe metadata")
        return data if isinstance(data, dict) else {}
    except Exception:
        try:
            raw = fetch_bytes(meta_url)
            return json.loads(raw.decode("utf-8"))
        except Exception:
            return {}


def fetch_metadata_from_uri(uri: str | None) -> dict:
    decoded = decode_nft_uri(uri)
    if not decoded:
        return {}
    return fetch_metadata_url(ipfs_to_http(decoded))


def listing_from_cafe(cafe: dict, collection_row: dict | None) -> tuple[str, float | None]:
    drops = cafe.get("amount")
    if drops in (None, "", 0) and collection_row:
        drops = collection_row.get("bestSellOffer") or (collection_row.get("ledgerNft") or {}).get(
            "sellOffer"
        )
    price = drops_to_xrp(drops)
    if price is not None and price > 0:
        return "For Sale", price
    return "Not Listed", None


def build_entry(
    *,
    issuer: str,
    taxon: int,
    collection_name: str,
    vanity: str,
    ledger_row: dict,
    cafe: dict,
    collection_row: dict | None,
    meta: dict,
    old_by_id: dict[str, dict],
    with_colors: bool = True,
) -> dict:
    nft_id = cafe.get("nft_id") or ledger_row.get("NFTokenID") or ""
    nft_serial = int(
        cafe.get("nft_sequence")
        or ledger_row.get("nft_serial")
        or ledger_row.get("NFTokenSerial")
        or 0
    )
    name = (cafe.get("item_name") or meta.get("name") or f"{collection_name} #{nft_serial}").strip()
    description = (cafe.get("item_desc") or meta.get("description") or "").strip()
    image_url = (
        cafe.get("media_url")
        or ipfs_to_http(meta.get("image") or meta.get("image_url"))
        or ipfs_to_http(cafe.get("original_media_url"))
    )
    traits = traits_from_attributes(meta.get("attributes") or [])
    category = infer_category(meta, traits)
    vibe_tags = infer_vibe_tags(meta, traits)
    mood = infer_mood_score(vibe_tags, description)
    colors = dominant_colors(image_url) if (with_colors and image_url) else []

    listing_status, current_price = listing_from_cafe(cafe, collection_row)
    token_id = stable_token_id(nft_id, nft_serial)
    xrp_cafe_url = cafe_nft_url(nft_id)
    collection_url = cafe_collection_vanity_url(vanity)

    entry = {
        "token_id": token_id,
        "xrpl_nft_id": nft_id,
        "nft_serial": nft_serial,
        "name": name,
        "xrp_cafe_url": xrp_cafe_url,
        "marketplace_url": xrp_cafe_url,
        "collection_url": collection_url,
        "image_url": image_url,
        "supply": 1,
        "traits": traits,
        "ai": {
            "description": description
            or f"{name} — AI nature art on XRPL ({collection_name}).",
            "dominant_colors": colors,
            "vibe_tags": vibe_tags,
            "category": category,
            "mood_score": mood,
            "keywords": keywords_from(meta, traits, vibe_tags),
        },
        "likes_count": 0,
        "status": "minted",
        "chain": "xrpl",
        "contract_address": issuer,
        "nft_taxon": int(
            cafe.get("token_taxon")
            or ledger_row.get("NFTokenTaxon")
            or taxon
        ),
        "collection_id": "xrpl_jb_ai_nature",
        "collection_name": collection_name,
        "listing_status": listing_status,
        "listing_currency": "XRP",
        "display_rank": extract_number_from_name(name),
        "medium": "xrpl_ai",
        "source": "xrp_cafe",
        "marketplace": "xrp_cafe",
    }

    if cafe.get("add_date"):
        entry["mint_timestamp"] = cafe["add_date"]
    if current_price is not None:
        entry["current_price_xrp"] = current_price

    old = old_by_id.get(nft_id)
    if old:
        if old.get("likes_count") not in (None, ""):
            entry["likes_count"] = old["likes_count"]
        for key in ("share_url", "og_image"):
            if old.get(key) and not entry.get(key):
                entry[key] = old[key]
        if not colors and old.get("ai", {}).get("dominant_colors"):
            entry["ai"]["dominant_colors"] = old["ai"]["dominant_colors"]

    return entry


def sync(*, dry_run: bool = False, limit: int | None = None, skip_colors: bool = False) -> int:
    issuer = DEFAULT_ISSUER
    taxon = DEFAULT_TAXON
    collection_name = DEFAULT_COLLECTION
    vanity = DEFAULT_VANITY

    if MAIN_GALLERY_JSON.exists():
        main = load_json(MAIN_GALLERY_JSON)
        info = main.get("collection_info") or {}
        issuer = info.get("xrpl_issuer_wallet") or issuer
        taxon = int(info.get("xrpl_nft_taxon", taxon))
        collection_name = info.get("xrpl_collection_name") or collection_name

    old_data = load_json(XRP_GALLERY_JSON) if XRP_GALLERY_JSON.exists() else {}
    old_by_id = {
        row["xrpl_nft_id"]: row
        for row in old_data.get("nfts") or []
        if row.get("xrpl_nft_id")
    }

    print(f"[xrp] Issuer: {issuer} | taxon: {taxon} | źródło: XRP.Cafe")
    print("[xrp] Pobieram indeks kolekcji z XRP.Cafe…")
    collection_index = fetch_cafe_collection_index(issuer, taxon)
    print(f"[xrp] Indeks kolekcji (strona 1): {len(collection_index)} NFT")

    raw = fetch_account_nfts(issuer)
    filtered = [row for row in raw if int(row.get("NFTokenTaxon", -1)) == taxon]
    filtered.sort(key=lambda row: int(row.get("nft_serial") or 0))
    print(f"[xrp] Ledger (XRPScan): {len(raw)} NFT | w kolekcji: {len(filtered)}")

    if limit:
        filtered = filtered[: int(limit)]

    entries: list[dict] = []
    ok, fail = 0, 0
    for i, row in enumerate(filtered):
        nft_id = row.get("NFTokenID") or ""
        print(f"  [{i + 1}/{len(filtered)}] {nft_id[:16]}…")
        try:
            cafe = fetch_cafe_nft(nft_id)
            meta_url = cafe.get("meta_url") or ""
            meta = fetch_metadata_url(meta_url) if meta_url else fetch_metadata_from_uri(row.get("URI"))
            entry = build_entry(
                issuer=issuer,
                taxon=taxon,
                collection_name=collection_name,
                vanity=vanity,
                ledger_row=row,
                cafe=cafe,
                collection_row=collection_index.get(nft_id),
                meta=meta,
                old_by_id=old_by_id,
                with_colors=not skip_colors,
            )
            entries.append(entry)
            ok += 1
        except Exception as exc:
            fail += 1
            print(f"    BŁĄD: {exc}", file=sys.stderr)
        if i < len(filtered) - 1:
            time.sleep(0.15)

    entries.sort(key=lambda n: n.get("display_rank", 9999))
    listed = sum(1 for n in entries if n.get("listing_status") == "For Sale")

    payload = {
        "collection_info": {
            "issuer_wallet": issuer,
            "nft_taxon": taxon,
            "collection_name": collection_name,
            "chain": "xrpl",
            "native_currency": "XRP",
            "marketplace": "xrp_cafe",
            "xrp_cafe_profile": cafe_profile_url(issuer),
            "xrp_cafe_collection": cafe_collection_url(issuer, taxon),
            "xrp_cafe_collection_vanity": cafe_collection_vanity_url(vanity),
            "last_xrp_sync": datetime.now(timezone.utc)
            .replace(microsecond=0)
            .isoformat()
            .replace("+00:00", "Z"),
        },
        "site": {
            "sections": {
                "xrpl": {
                    "label": "AI on XRPL",
                    "label_short": "XRPL",
                    "explore_title": "Explore AI on XRPL · XRP.Cafe",
                    "empty_message": "JB AI Nature on XRP.Cafe will appear here after sync.",
                    "promo_eyebrow": "JB AI Nature on XRPL",
                    "promo_lead": "Collect and trade on XRP.Cafe — every work links to the marketplace.",
                    "collection_url": cafe_collection_vanity_url(vanity),
                    "collection_cta": "View collection on XRP.Cafe",
                }
            }
        },
        "nfts": entries,
    }

    print(f"[xrp] Gotowe: {ok} OK, {fail} błędów | na sprzedaż: {listed}/{len(entries)}")

    if dry_run:
        print("[dry-run] Bez zapisu xrp_gallery.json")
        return 0 if fail == 0 else 1

    save_json(XRP_GALLERY_JSON, payload)
    print(f"[xrp] Zapisano: {XRP_GALLERY_JSON} ({len(entries)} prac)")
    return 0 if fail == 0 else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Sync XRP.Cafe / XRPL NFTs → xrp_gallery.json")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, help="max liczba NFT (test)")
    parser.add_argument("--skip-colors", action="store_true", help="pomiń analizę kolorów (szybciej)")
    args = parser.parse_args(argv)
    return sync(dry_run=args.dry_run, limit=args.limit, skip_colors=args.skip_colors)


if __name__ == "__main__":
    raise SystemExit(main())