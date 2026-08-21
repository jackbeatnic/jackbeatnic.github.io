#!/usr/bin/env python3
"""Generate Open Graph previews for Jack Beatnic Gallery.

- Site card: assets/og-preview.jpg (homepage)
- Per-NFT cards: assets/og/nft-{id}.jpg (OpenSea-style: thumb + price)
- Share landing pages: nft/{collection_id}/{id}.html (OG meta → redirect)
  Legacy flat nft/{id}.html kept as redirect stubs when unique.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
GALLERY_JSON = ROOT / "gallery.json"
SITE_OG_PATH = ROOT / "assets" / "og-preview.jpg"
NFT_OG_DIR = ROOT / "assets" / "og"
NFT_PAGES_DIR = ROOT / "nft"
FONTS_DIR = ROOT / "assets" / "fonts"

# Share landings are generated from every feed the gallery loads, not just
# gallery.json. Missing files here are the SHARE → X 404.
EXTRA_FEED_FILES = (
    "xrp_gallery.json",
    "sui_gallery.json",
    "nature_jam_gallery.json",
    "ai_play_gallery.json",
    "based_ai_gallery.json",
    "auctions_gallery.json",
    "objkt_auctions_gallery.json",
)
SALE_INDEX_JSON = ROOT / "data" / "sale_index.json"
FEATURED_PROMO_JSON = ROOT / "data" / "featured_promo.json"
LEGACY_OG_COLLECTION = "avalanche-nature-stories"
SHOP_COLLECTION_NAMES = {
    "avalanche_nature_stories": "Nature Stories",
    "avalanche_flower_stories": "Flower Stories",
    "xrpl_jb_ai_nature": "JB AI Nature",
    "xrpl_jbn": "JB AI Nature",
}

WIDTH = 1200
HEIGHT = 630
SITE_BRAND_TITLE = "Jack Beatnic"
SITE_BRAND_TAGLINE = "From the Lens to AI"
SITE_GALLERY_LABEL = "AI Art and Photography Gallery"
INDEX_HTML = ROOT / "index.html"

NFT_PAD = 36
NFT_THUMB = HEIGHT - NFT_PAD * 2
NFT_TEXT_X = NFT_PAD + NFT_THUMB + 48


def load_gallery() -> dict:
    with GALLERY_JSON.open(encoding="utf-8") as fh:
        return json.load(fh)


def save_gallery(data: dict) -> None:
    with GALLERY_JSON.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
        fh.write("\n")


def site_base_url(info: dict) -> str:
    url = (info.get("site_url") or "https://jackbeatnic.github.io/").rstrip("/")
    return url


def og_cache_version(when: datetime | None = None) -> str:
    when = when or datetime.now(timezone.utc)
    return when.strftime("%Y%m%d%H%M")


def og_url_with_version(base_url: str, asset_path: str, version: str) -> str:
    path = asset_path.lstrip("/")
    return f"{base_url}/{path}?v={version}"


def fetch_image(url: str) -> Image.Image:
    req = urllib.request.Request(url, headers={"User-Agent": "JackBeatnicGallery/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = resp.read()
    return Image.open(BytesIO(data)).convert("RGB")


def cover_crop(img: Image.Image, width: int, height: int, focus_y: float = 0.4) -> Image.Image:
    src_w, src_h = img.size
    target_ratio = width / height
    src_ratio = src_w / src_h

    if src_ratio > target_ratio:
        new_h = src_h
        new_w = int(src_h * target_ratio)
    else:
        new_w = src_w
        new_h = int(src_w / target_ratio)

    left = (src_w - new_w) // 2
    top = int((src_h - new_h) * focus_y)
    top = max(0, min(top, src_h - new_h))
    cropped = img.crop((left, top, left + new_w, top + new_h))
    return cropped.resize((width, height), Image.Resampling.LANCZOS)


def fit_square(img: Image.Image, size: int) -> Image.Image:
    return cover_crop(img, size, size, focus_y=0.42)


def fit_contain(img: Image.Image, max_w: int, max_h: int) -> Image.Image:
    src_w, src_h = img.size
    scale = min(max_w / src_w, max_h / src_h)
    new_w = max(1, int(src_w * scale))
    new_h = max(1, int(src_h * scale))
    return img.resize((new_w, new_h), Image.Resampling.LANCZOS)


def fonts() -> dict[str, ImageFont.FreeTypeFont]:
    return {
        "title_lg": ImageFont.truetype(str(FONTS_DIR / "Inter.ttf"), 52),
        "title_md": ImageFont.truetype(str(FONTS_DIR / "Inter.ttf"), 46),
        "body": ImageFont.truetype(str(FONTS_DIR / "Inter.ttf"), 26),
        "label": ImageFont.truetype(str(FONTS_DIR / "Inter.ttf"), 24),
        "price": ImageFont.truetype(str(FONTS_DIR / "Inter.ttf"), 50),
    }


def og_plain_text(text: str) -> str:
    """Strip HTML entities and spell out ampersands for OG overlay text."""
    plain = html.unescape(text or "")
    plain = re.sub(r"\s*&\s*", " and ", plain)
    return re.sub(r"\s+", " ", plain).strip()


def draw_bold(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str, font, fill) -> None:
    x, y = xy
    for dx, dy in ((0, 0), (1, 0), (0, 1)):
        draw.text((x + dx, y + dy), text, font=font, fill=fill)


CHAIN_LABELS = {
    "avalanche": "Avalanche",
    "tezos": "Tezos",
    "polygon": "Polygon",
    "base": "Base",
    "ethereum": "Ethereum",
    "sui": "Sui",
    "xrpl": "XRPL",
}

CHAIN_CURRENCIES = {
    "avalanche": "AVAX",
    "tezos": "XTZ",
    "polygon": "MATIC",
    "base": "ETH",
    "ethereum": "ETH",
}


def collection_display_name(info: dict) -> str:
    desc = info.get("description") or ""
    head = re.split(r"\s*[–—-]\s*", desc, maxsplit=1)[0].strip()
    if head:
        return head
    cid = info.get("collection_id") or ""
    return cid.replace("_", " ").title() or "Collection"


def nft_collection_name(nft: dict, info: dict) -> str:
    name = (nft.get("collection_name") or "").strip()
    if name:
        return name
    return collection_display_name(info)


def nft_chain(nft: dict, info: dict) -> str:
    return (nft.get("chain") or info.get("chain") or "avalanche").lower()


def nft_currency(nft: dict, info: dict) -> str:
    if nft.get("listing_currency"):
        return str(nft["listing_currency"]).upper()
    return CHAIN_CURRENCIES.get(nft_chain(nft, info), "AVAX")


def nft_chain_label(nft: dict, info: dict) -> str:
    chain = nft_chain(nft, info)
    return CHAIN_LABELS.get(chain, chain.title())


def nft_artwork_title(nft: dict) -> str:
    name = (nft.get("name") or "").strip()
    if name:
        return name
    return f"Token #{nft.get('token_id', '?')}"


def wrap_text_lines(text: str, font, max_width: int) -> list[str]:
    words = text.split()
    if not words:
        return [text]

    lines: list[str] = []
    current = ""
    for word in words:
        trial = f"{current} {word}".strip()
        bbox = font.getbbox(trial)
        if bbox[2] - bbox[0] <= max_width:
            current = trial
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines or [text]


def pick_title_layout(text: str, max_width: int, max_lines: int = 2) -> tuple[ImageFont.FreeTypeFont, list[str]]:
    for size in (40, 34, 28, 24):
        font = ImageFont.truetype(str(FONTS_DIR / "Inter.ttf"), size)
        lines = wrap_text_lines(text, font, max_width)
        if len(lines) <= max_lines:
            return font, lines
    font = ImageFont.truetype(str(FONTS_DIR / "Inter.ttf"), 24)
    lines = wrap_text_lines(text, font, max_width)[:max_lines]
    if len(lines) == max_lines:
        last = lines[-1]
        while len(last) > 1:
            trial = f"{last}…"
            bbox = font.getbbox(trial)
            if bbox[2] - bbox[0] <= max_width:
                lines[-1] = trial
                break
            last = last[:-1]
    return font, lines


def draw_title_block(draw, x: int, y: int, text: str, max_width: int, fill) -> int:
    font, lines = pick_title_layout(text, max_width)
    cursor_y = y
    for line in lines:
        draw_bold(draw, (x, cursor_y), line, font, fill)
        bbox = font.getbbox(line)
        cursor_y += (bbox[3] - bbox[1]) + 8
    return cursor_y


def price_field(nft: dict, prefix: str, symbol: str):
    key = f"{prefix}_{symbol.lower()}"
    if nft.get(key) not in (None, ""):
        return nft[key]
    if symbol == "AVAX" and nft.get(f"{prefix}_avax") not in (None, ""):
        return nft[f"{prefix}_avax"]
    return None


def format_share_price(nft: dict, info: dict) -> tuple[str, str]:
    symbol = nft_currency(nft, info)
    listed = price_field(nft, "current_price", symbol)
    last_sale = price_field(nft, "last_sale_price", symbol)
    mint = price_field(nft, "mint_price", symbol)

    if listed is None and symbol == "XTZ" and nft.get("current_price_xtz") not in (None, ""):
        listed = nft["current_price_xtz"]

    if listed is not None and nft.get("listing_status") == "For Sale":
        return f"{listed:g} {symbol}", "Listed"
    if last_sale is not None:
        return f"{last_sale:g} {symbol}", "Last sale"
    if mint is not None:
        return f"{mint:g} {symbol}", "Mint price"
    return nft_chain_label(nft, info), "Jack Beatnic Gallery"


def draw_site_brand_overlay(
    base: Image.Image,
    title: str,
    tagline: str,
    gallery_label: str,
) -> Image.Image:
    """Top-right: name + claim; bottom-left: gallery label."""
    overlay = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    # Top-right readability gradient
    for y in range(0, int(HEIGHT * 0.42)):
        for x in range(int(WIDTH * 0.45), WIDTH):
            tx = (x - WIDTH * 0.45) / max(1, WIDTH * 0.55)
            ty = 1 - y / max(1, HEIGHT * 0.42)
            alpha = int(175 * tx * ty)
            if alpha > 0:
                overlay.putpixel((x, y), (10, 10, 10, alpha))

    # Bottom-left readability gradient
    for y in range(int(HEIGHT * 0.58), HEIGHT):
        for x in range(0, int(WIDTH * 0.55)):
            tx = 1 - x / max(1, WIDTH * 0.55)
            ty = (y - HEIGHT * 0.58) / max(1, HEIGHT * 0.42)
            alpha = int(165 * tx * ty)
            if alpha > 0:
                overlay.putpixel((x, y), (10, 10, 10, alpha))

    canvas = Image.alpha_composite(base.convert("RGBA"), overlay)
    draw = ImageDraw.Draw(canvas)
    f = fonts()
    white = (255, 255, 255, 255)
    muted = (230, 230, 230, 255)

    pad_r = 56
    pad_l = 56
    title_font = f["title_md"]
    tagline_font = ImageFont.truetype(str(FONTS_DIR / "Inter.ttf"), 22)
    label_font = ImageFont.truetype(str(FONTS_DIR / "Inter.ttf"), 24)

    tagline_bbox = tagline_font.getbbox(tagline)
    title_bbox = title_font.getbbox(title)
    tagline_w = tagline_bbox[2] - tagline_bbox[0]
    title_w = title_bbox[2] - title_bbox[0]

    text_right = WIDTH - pad_r
    title_x = text_right - title_w
    tagline_x = text_right - tagline_w
    title_y = 48
    tagline_y = title_y + 58

    draw_bold(draw, (title_x, title_y), title, title_font, white)
    draw.text((tagline_x, tagline_y), tagline, font=tagline_font, fill=muted)

    label_bbox = label_font.getbbox(gallery_label)
    label_h = label_bbox[3] - label_bbox[1]
    label_y = HEIGHT - 56 - label_h
    draw_bold(draw, (pad_l, label_y), gallery_label, label_font, white)
    return canvas


def generate_site_og(data: dict, output: Path = SITE_OG_PATH) -> Path:
    nfts = data.get("nfts") or []
    if not nfts:
        raise SystemExit("gallery.json: brak NFT do tła strony")

    info = data["collection_info"]
    title = og_plain_text(info.get("hero_title") or info.get("artist") or SITE_BRAND_TITLE)
    tagline = og_plain_text(info.get("hero_tagline") or SITE_BRAND_TAGLINE)
    gallery_label = og_plain_text(SITE_GALLERY_LABEL)

    print(f"[site] Tło: {nfts[0].get('name', '—')}")
    bg = fetch_image(nfts[0]["image_url"])
    canvas = draw_site_brand_overlay(
        cover_crop(bg, WIDTH, HEIGHT, focus_y=0.4),
        title,
        tagline,
        gallery_label,
    )

    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(output, "JPEG", quality=92, optimize=True, subsampling=0)
    print(f"[site] Zapisano: {output} ({output.stat().st_size // 1024} KB)")
    return output


def nft_card_background() -> Image.Image:
    """Dark blue gradient similar to OpenSea share cards."""
    base = Image.new("RGB", (WIDTH, HEIGHT), (13, 27, 42))
    overlay = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    for x in range(WIDTH):
        t = x / max(1, WIDTH - 1)
        alpha = int(90 * t)
        draw.line([(x, 0), (x, HEIGHT)], fill=(27, 38, 59, alpha))

    return Image.alpha_composite(base.convert("RGBA"), overlay)


def rounded_thumb(img: Image.Image, size: int, radius: int = 18) -> Image.Image:
    inner = size - 8
    fitted = fit_contain(img, inner, inner)
    tile = Image.new("RGBA", (size, size), (20, 32, 48, 255))
    ox = (size - fitted.width) // 2
    oy = (size - fitted.height) // 2
    tile.paste(fitted, (ox, oy))

    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    bordered = Image.new("RGBA", (size + 4, size + 4), (255, 255, 255, 255))
    bordered.paste(tile, (2, 2))
    bordered.putalpha(Image.new("L", bordered.size, 255))
    bordered.putalpha(mask.resize(bordered.size))
    return bordered


def generate_nft_og(nft: dict, info: dict, thumb: Image.Image | None = None) -> Image.Image:
    f = fonts()
    collection = nft_collection_name(nft, info)
    artwork_title = nft_artwork_title(nft)
    price_text, _ = format_share_price(nft, info)
    white = (255, 255, 255, 255)
    muted = (210, 220, 235, 255)
    text_max_w = WIDTH - NFT_TEXT_X - NFT_PAD

    if thumb is None:
        thumb = fetch_image(nft["image_url"])

    canvas = nft_card_background()
    tile = rounded_thumb(thumb, NFT_THUMB)
    canvas.paste(tile, (NFT_PAD, NFT_PAD), tile)

    draw = ImageDraw.Draw(canvas)
    draw.text((NFT_TEXT_X, NFT_PAD + 8), collection, font=f["label"], fill=muted)
    draw_title_block(draw, NFT_TEXT_X, NFT_PAD + 48, artwork_title, text_max_w, white)
    draw_bold(draw, (NFT_TEXT_X, HEIGHT - NFT_PAD - 62), price_text, f["price"], white)
    return canvas


def generate_nft_ogs(
    data: dict,
    token_ids: set[int] | None = None,
    output_dir: Path = NFT_OG_DIR,
) -> list[Path]:
    info = data["collection_info"]
    nfts = data.get("nfts") or []
    output_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []

    for nft in nfts:
        token_id = int(nft["token_id"])
        if token_ids is not None and token_id not in token_ids:
            continue

        out = output_dir / f"nft-{token_id}.jpg"
        print(f"[nft] #{token_id}: {nft.get('name', '—')}")
        card = generate_nft_og(nft, info)
        card.convert("RGB").save(out, "JPEG", quality=92, optimize=True, subsampling=0)
        written.append(out)
        print(f"      → {out} ({out.stat().st_size // 1024} KB)")

    return written


def slugify_collection_id(raw: str) -> str:
    """Filesystem/URL-safe collection slug (no spaces, quotes, colons)."""
    import re

    s = (raw or "").strip().lower()
    s = s.replace("'", "").replace('"', "")
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s or "collection"


def nft_collection_id(nft: dict) -> str:
    col = (nft.get("collection_id") or "").strip()
    if col:
        return slugify_collection_id(col)
    # Fallback slug so share paths stay unique across chains/media
    medium = (nft.get("medium") or "work").strip() or "work"
    chain = (nft.get("chain") or "x").strip() or "x"
    return slugify_collection_id(f"{medium}_{chain}")


def share_path_for_nft(nft: dict) -> str:
    """Unique share path: nft/{collection_slug}/{token_id}.html"""
    col = nft_collection_id(nft)
    token_id = int(nft["token_id"])
    return f"nft/{col}/{token_id}.html"


def gallery_deep_link(nft: dict, base_url: str) -> str:
    """Disambiguated deep link — token_id alone collides across NS/NJ/Sui."""
    from urllib.parse import urlencode

    token_id = int(nft["token_id"])
    q: dict[str, str] = {"work": str(token_id)}
    col = nft.get("collection_id")
    if col:
        q["collection"] = str(col)
    medium = nft.get("medium") or "ai_art"
    if medium == "photography" or medium == "objkt_auction":
        q["section"] = "photography"
        kind = nft.get("photo_kind") or "photo"
        if kind != "photo":
            q["photo"] = kind
    elif medium == "xrpl_ai":
        q["section"] = "ai_art"
        q["ai"] = "xrpl"
    elif medium == "sui_ai":
        q["section"] = "ai_art"
        q["ai"] = "sui"
    elif medium == "shop":
        q["section"] = "shop"
    elif medium == "featured_promo":
        q["section"] = "featured"
    elif medium == "manifold_auction":
        q["section"] = "atelier"
        q["market"] = "auctions"
        chain = nft.get("chain_key") or nft.get("chain") or "base"
        if chain != "base":
            q["chain"] = str(chain)
    elif medium == "manifold_edition":
        q["section"] = "atelier"
        q["market"] = "editions"
        chain = nft.get("chain_key") or nft.get("chain") or "base"
        if chain != "base":
            q["chain"] = str(chain)
    elif medium == "ai_art":
        q["section"] = "ai_art"
        q["ai"] = "evm"
        series = nft.get("ai_series")
        if series and series != "nature_stories":
            q["series"] = series
        edition = str(nft.get("edition_label") or nft.get("chain") or "").lower()
        if edition in {"avalanche", "polygon", "base"}:
            q["edition"] = edition
    return f"{base_url}/?{urlencode(q)}"


def token_id_int(nft: dict) -> int | None:
    raw = nft.get("token_id")
    if raw is None or raw == "":
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def share_key(nft: dict) -> tuple[str, int] | None:
    tid = token_id_int(nft)
    if tid is None:
        return None
    return nft_collection_id(nft), tid


def nfts_from_json_file(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict):
        nfts = data.get("nfts")
        if isinstance(nfts, list):
            return nfts
        items = data.get("items")
        if isinstance(items, list):
            return items
    if isinstance(data, list):
        return [item for item in data if isinstance(item, dict)]
    return []


def shop_nfts_from_sale_index() -> list[dict]:
    if not SALE_INDEX_JSON.is_file():
        return []
    doc = json.loads(SALE_INDEX_JSON.read_text(encoding="utf-8"))
    out: list[dict] = []
    for it in doc.get("items") or []:
        if (it.get("channel") or "shop") != "shop":
            continue
        if (it.get("status") or "live") != "live":
            continue
        cid = it.get("collection_id")
        tid = it.get("token_id")
        if not cid or tid in (None, ""):
            continue
        chain = (it.get("chain") or "avalanche").lower()
        cur = (it.get("currency") or "AVAX").upper()
        price = it.get("price")
        if price in (None, ""):
            price = it.get("pay_amount")
        nft: dict = {
            "token_id": tid,
            "name": it.get("name") or f"#{tid}",
            "collection_id": cid,
            "collection_name": SHOP_COLLECTION_NAMES.get(str(cid))
            or str(cid).replace("_", " ").title(),
            "chain": chain,
            "medium": "shop",
            "image_url": it.get("image_url"),
            "listing_status": "For Sale",
            "listing_currency": cur,
            "status": "listed",
        }
        if price not in (None, ""):
            try:
                nft[f"current_price_{cur.lower()}"] = float(price)
            except (TypeError, ValueError):
                nft[f"current_price_{cur.lower()}"] = price
        out.append(nft)
    return out


def featured_nfts_from_promo() -> list[dict]:
    if not FEATURED_PROMO_JSON.is_file():
        return []
    doc = json.loads(FEATURED_PROMO_JSON.read_text(encoding="utf-8"))
    out: list[dict] = []
    for it in doc.get("items") or []:
        cid = it.get("collection_id")
        tid = it.get("token_id")
        if not cid or tid in (None, ""):
            continue
        chain = (it.get("chain") or "").lower()
        cur = (it.get("currency") or "AVAX").upper()
        nft: dict = {
            "token_id": tid,
            "name": it.get("name") or f"#{tid}",
            "collection_id": cid,
            "collection_name": it.get("collection_name"),
            "chain": chain,
            "medium": "featured_promo",
            "image_url": it.get("image_url"),
            "listing_status": "For Sale",
            "listing_currency": cur,
        }
        price = it.get("price")
        if price not in (None, ""):
            nft[f"current_price_{cur.lower()}"] = price
        out.append(nft)
    return out


def collect_all_share_nfts(gallery_data: dict) -> list[dict]:
    """One NFT per (collection slug, token_id). gallery.json wins, then extra feeds, then shop."""
    collected: list[dict] = []
    seen: set[tuple[str, int]] = set()

    def add_many(nfts: list[dict]) -> None:
        for nft in nfts:
            key = share_key(nft)
            if key is None or key in seen:
                continue
            seen.add(key)
            collected.append(nft)

    add_many(gallery_data.get("nfts") or [])
    for name in EXTRA_FEED_FILES:
        add_many(nfts_from_json_file(ROOT / name))
    add_many(featured_nfts_from_promo())
    add_many(shop_nfts_from_sale_index())
    return collected


def og_image_url(nft: dict, base_url: str, og_version: str) -> str:
    token_id = int(nft["token_id"])
    col = nft_collection_id(nft)
    prefixed = NFT_OG_DIR / f"{col}-{token_id}.jpg"
    if prefixed.is_file():
        return og_url_with_version(base_url, f"assets/og/{col}-{token_id}.jpg", og_version)

    # Flat nft-{id}.jpg cards were built only for Nature Stories in gallery.json.
    # Reusing them for XRPL/Sui/NJ would show the wrong artwork (token_id collides).
    legacy = NFT_OG_DIR / f"nft-{token_id}.jpg"
    if col == LEGACY_OG_COLLECTION and legacy.is_file():
        return og_url_with_version(base_url, f"assets/og/nft-{token_id}.jpg", og_version)

    rel = str(nft.get("og_image") or "").strip()
    if rel and not rel.startswith("http://") and not rel.startswith("https://"):
        local = ROOT / rel.lstrip("/")
        if local.is_file():
            return og_url_with_version(base_url, rel.lstrip("/"), og_version)

    img = str(nft.get("image_url") or "").strip()
    if img.startswith("https://") or img.startswith("http://"):
        return img
    if img:
        return og_url_with_version(base_url, img.lstrip("/"), og_version)
    return og_url_with_version(base_url, "assets/og-preview.jpg", og_version)


def share_page_html(nft: dict, info: dict, base_url: str, og_version: str) -> str:
    token_id = int(nft["token_id"])
    collection = nft_collection_name(nft, info)
    artwork_title = nft_artwork_title(nft)
    price_text, price_hint = format_share_price(nft, info)
    rel_path = share_path_for_nft(nft)
    share_url = f"{base_url}/{rel_path}"
    og_image = og_image_url(nft, base_url, og_version)
    gallery_url = gallery_deep_link(nft, base_url)
    title = f"{artwork_title} | Jack Beatnic Gallery"
    description = f"{price_text} · {collection} — {price_hint}"

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="{html.escape(description)}">
    <title>{html.escape(title)}</title>
    <meta property="og:type" content="website">
    <meta property="og:url" content="{html.escape(share_url)}">
    <meta property="og:title" content="{html.escape(title)}">
    <meta property="og:description" content="{html.escape(description)}">
    <meta property="og:image" content="{html.escape(og_image)}">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:site" content="{html.escape(info.get('twitter_handle') or '@JackBeatnicAI')}">
    <meta name="twitter:title" content="{html.escape(title)}">
    <meta name="twitter:description" content="{html.escape(description)}">
    <meta name="twitter:image" content="{html.escape(og_image)}">
    <meta http-equiv="refresh" content="0;url={html.escape(gallery_url)}">
    <link rel="canonical" href="{html.escape(share_url)}">
</head>
<body>
    <p><a href="{html.escape(gallery_url)}">Open in Jack Beatnic Gallery</a></p>
</body>
</html>
"""


def legacy_redirect_html(target_url: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="refresh" content="0;url={html.escape(target_url)}">
    <link rel="canonical" href="{html.escape(target_url)}">
    <title>Redirecting…</title>
</head>
<body>
    <p><a href="{html.escape(target_url)}">Continue to artwork</a></p>
</body>
</html>
"""


def generate_share_pages(
    data: dict,
    token_ids: set[int] | None = None,
    output_dir: Path = NFT_PAGES_DIR,
    nfts: list[dict] | None = None,
) -> list[Path]:
    info = data["collection_info"]
    base_url = site_base_url(info)
    og_version = info.get("og_cache_version") or og_cache_version()
    if nfts is None:
        nfts = collect_all_share_nfts(data)
    output_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    active_paths: set[Path] = set()
    per_col: dict[str, int] = {}
    # Flat nft/{id}.html only when this token_id is unique across ALL feeds
    tid_counts: dict[int, int] = {}
    for nft in nfts:
        tid = token_id_int(nft)
        if tid is None:
            continue
        tid_counts[tid] = tid_counts.get(tid, 0) + 1

    for nft in nfts:
        token_id = token_id_int(nft)
        if token_id is None:
            continue
        if token_ids is not None and token_id not in token_ids:
            continue

        rel = share_path_for_nft(nft)
        out = ROOT / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(share_page_html(nft, info, base_url, og_version), encoding="utf-8")
        written.append(out)
        active_paths.add(out.resolve())
        share_url = f"{base_url}/{rel}"
        nft["share_url"] = share_url
        col = nft_collection_id(nft)
        prefixed = NFT_OG_DIR / f"{col}-{token_id}.jpg"
        if prefixed.is_file():
            nft["og_image"] = f"assets/og/{col}-{token_id}.jpg"
        elif col == LEGACY_OG_COLLECTION and (NFT_OG_DIR / f"nft-{token_id}.jpg").is_file():
            nft["og_image"] = f"assets/og/nft-{token_id}.jpg"
        elif nft.get("og_image"):
            rel = str(nft["og_image"]).lstrip("/")
            if not (ROOT / rel).is_file():
                nft.pop("og_image", None)
        per_col[col] = per_col.get(col, 0) + 1

        # Legacy flat nft/{id}.html — only when this token_id is unique
        if tid_counts.get(token_id, 0) == 1:
            legacy = output_dir / f"{token_id}.html"
            legacy.write_text(legacy_redirect_html(share_url), encoding="utf-8")
            written.append(legacy)
            active_paths.add(legacy.resolve())

    # Keep existing flat nft/{id}.html (old tweets). Drop stale namespaced pages.
    for sub in output_dir.iterdir():
        if not sub.is_dir():
            continue
        for stale in sub.glob("*.html"):
            if stale.resolve() not in active_paths:
                stale.unlink()
                print(f"[page] Usunięto nieaktualny: {stale.relative_to(ROOT)}")
        if not any(sub.iterdir()):
            sub.rmdir()

    for col, n in sorted(per_col.items()):
        print(f"[page] {col}: {n}")
    print(f"[page] razem {len(written)} plików")
    return written


def stamp_gallery_meta(data: dict, when: datetime | None = None) -> str:
    when = when or datetime.now(timezone.utc)
    info = data["collection_info"]
    version = og_cache_version(when)
    info["og_generated_at"] = when.replace(microsecond=0).isoformat().replace("+00:00", "Z")
    info["og_cache_version"] = version
    return version


def update_site_index_og(data: dict, version: str) -> None:
    info = data["collection_info"]
    base_url = site_base_url(info)
    og_image = og_url_with_version(base_url, "assets/og-preview.jpg", version)
    html_text = INDEX_HTML.read_text(encoding="utf-8")

    for attr in ("property=\"og:image\"", "name=\"twitter:image\""):
        pattern = rf'(<meta {attr} content=")[^"]*(")'
        html_text, count = re.subn(pattern, rf"\1{og_image}\2", html_text, count=1)
        if count != 1:
            raise SystemExit(f"index.html: nie znaleziono meta {attr}")

    INDEX_HTML.write_text(html_text, encoding="utf-8")
    print(f"[site] index.html — og:image?v={version}")


def generate_all(
    *,
    site: bool = True,
    nft: bool = True,
    pages: bool = True,
    write_gallery: bool = True,
    token_ids: set[int] | None = None,
) -> None:
    data = load_gallery()

    version = stamp_gallery_meta(data)

    if site:
        generate_site_og(data)
        update_site_index_og(data, version)
    if nft:
        generate_nft_ogs(data, token_ids=token_ids)
    if pages:
        generate_share_pages(data, token_ids=token_ids)

    if write_gallery and (site or pages):
        save_gallery(data)
        print("[meta] gallery.json — og_cache_version / share_url / og_generated_at")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generuj karty Open Graph dla galerii.")
    parser.add_argument("--site-only", action="store_true", help="Tylko og-preview.jpg (strona główna)")
    parser.add_argument("--nft-only", action="store_true", help="Tylko karty per NFT + strony share")
    parser.add_argument(
        "--pages-only",
        action="store_true",
        help="Tylko strony share (wszystkie feedy: XRPL/Sui/NJ/shop). Bez kart JPG.",
    )
    parser.add_argument("--no-gallery-json", action="store_true", help="Nie zapisuj share_url w gallery.json")
    parser.add_argument("--token", type=int, action="append", dest="tokens", help="Tylko wybrane token_id")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    token_ids = set(args.tokens) if args.tokens else None

    if args.site_only:
        data = load_gallery()
        version = stamp_gallery_meta(data)
        generate_site_og(data)
        update_site_index_og(data, version)
        if not args.no_gallery_json:
            save_gallery(data)
        return 0

    if args.pages_only:
        data = load_gallery()
        generate_share_pages(data, token_ids=token_ids)
        if not args.no_gallery_json:
            save_gallery(data)
            print("[meta] gallery.json — share_url")
        return 0

    if args.nft_only:
        data = load_gallery()
        version = stamp_gallery_meta(data)
        generate_nft_ogs(data, token_ids=token_ids)
        generate_share_pages(data, token_ids=token_ids)
        if not args.no_gallery_json:
            save_gallery(data)
        return 0

    generate_all(
        write_gallery=not args.no_gallery_json,
        token_ids=token_ids,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())