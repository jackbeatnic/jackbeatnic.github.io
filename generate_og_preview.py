#!/usr/bin/env python3
"""Generate Open Graph previews for Jack Beatnic Gallery.

- Site card: assets/og-preview.jpg (homepage, stays on WWW — one file)
- Per-NFT share image: the published promo board (jbg-present/promo), else the
  one fallback assets/og-preview.jpg. The old per-NFT price cards repo
  was retired on 2026-10-03; no per-NFT OG cards are generated any more.
- Share landing pages: nft/{collection_id}/{id}.html (OG meta → redirect)
  Legacy flat nft/{id}.html kept as redirect stubs when unique.
"""

from __future__ import annotations

import argparse
import html
import json
import os
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
# Per-NFT OG price cards (old separate repo) are retired (2026-10-03): share pages
# use the promo board, else assets/og-preview.jpg.
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
SHOP_COLLECTION_NAMES = {
    "avalanche_nature_stories": "Nature Stories",
    "avalanche_flower_stories": "Flower Stories",
    "xrpl_jb_ai_nature": "Jack Beatnic",
    "xrpl_jack_beatnic": "Jack Beatnic",
    "xrpl_jbn": "Jack Beatnic",
}

WIDTH = 1200
HEIGHT = 630
SITE_BRAND_TITLE = "Jack Beatnic"
SITE_BRAND_TAGLINE = "From the Lens to SI"
SITE_GALLERY_LABEL = "SI Art and Photography Gallery"
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
    last_err: Exception | None = None
    import ssl

    contexts = [None]
    try:
        contexts.append(ssl._create_unverified_context())
    except Exception:
        pass
    for ctx in contexts:
        try:
            with urllib.request.urlopen(req, timeout=12, context=ctx) as resp:
                data = resp.read()
            return Image.open(BytesIO(data)).convert("RGB")
        except Exception as exc:  # noqa: BLE001
            last_err = exc
    raise last_err or RuntimeError(f"fetch failed: {url}")


def _id_variants(nft: dict) -> list[int]:
    ids: list[int] = []
    for key in ("token_id", "onchain_token_id", "launchpad_token_id"):
        raw = nft.get(key)
        if raw in (None, ""):
            continue
        try:
            n = int(raw)
        except (TypeError, ValueError):
            continue
        if n not in ids:
            ids.append(n)
    name = str(nft.get("name") or "")
    m = re.search(r"#\s*0*(\d+)\b", name)
    if m:
        n = int(m.group(1))
        if n not in ids:
            ids.append(n)
    return ids


def local_image_path(nft: dict) -> Path | None:
    """Prefer studio cache over IPFS/OpenSea CDNs."""
    ids = _id_variants(nft)
    if not ids:
        return None
    cid = (nft.get("collection_id") or "").strip()
    slug_us = nft_collection_id(nft).replace("-", "_")
    folders = []
    for folder in (cid, slug_us):
        if folder and folder not in folders:
            folders.append(folder)

    candidates: list[Path] = []
    for tid in ids:
        for folder in folders:
            candidates.append(PRESENT_ROOT / folder / f"{tid}.view.webp")
            media = BACKUP_ROOT / folder / "media"
            for ext in (".jpg", ".jpeg", ".png", ".webp"):
                candidates.append(media / f"{tid}{ext}")
            # Tezos/Objkt studio squares (~650px) — enough for the 558px OG tile.
            candidates.append(PROMO_TEZOS / "square" / f"{tid}.jpg")
            candidates.append(PROMO_TEZOS / "vertical" / f"{tid}.jpg")
            candidates.append(PRESENT_ROOT / folder / f"{tid}.thumb.webp")
        if (nft.get("medium") == "xrpl_ai") or "xrpl" in cid or "xrpl" in slug_us:
            candidates.append(ASSETS_MEDIA / "xrpl" / "jbn" / f"{tid}.jpg")
            candidates.append(ASSETS_MEDIA / "xrpl" / "jbn" / f"{tid}.webp")

    for path in candidates:
        if not path.is_file():
            continue
        try:
            with Image.open(path) as im:
                if min(im.size) < OG_MIN_SRC and "thumb" in path.name:
                    continue
        except Exception:
            continue
        return path
    return None


def load_nft_image(nft: dict) -> Image.Image:
    local = local_image_path(nft)
    if local is not None:
        return Image.open(local).convert("RGB")
    url = (nft.get("image_url") or "").strip()
    if url.startswith("http://") or url.startswith("https://"):
        return fetch_image(url)
    raise FileNotFoundError(f"no image for {nft_collection_id(nft)} #{nft.get('token_id')}")


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
    "polygon": "POL",
    "base": "ETH",
    "ethereum": "ETH",
    "xrpl": "XRP",
    "sui": "SUI",
}

PRESENT_ROOT = ROOT.parent / "jbg-present"
ASSETS_MEDIA = ROOT.parent / "jb-nft-assets" / "media"
BACKUP_ROOT = ROOT.parent / "backup_offline" / "by_collection"
PROMO_TEZOS = ROOT.parent / "promo" / "tezos"
# Don't use the local presentation *small-portrait* (~400px) — that batch looked soft on OG cards.
OG_MIN_SRC = 500
# X/Facebook draw a domain chip on the bottom of summary_large_image.
OG_SAFE_BOTTOM = 96


def collection_display_name(info: dict) -> str:
    desc = info.get("description") or ""
    head = re.split(r"\s*[–—-]\s*", desc, maxsplit=1)[0].strip()
    if head:
        return head
    cid = info.get("collection_id") or ""
    return cid.replace("_", " ").title() or "Collection"


COLLECTION_LABELS = {
    "avalanche_nature_stories": "Nature Stories",
    "avalanche_nature_jam": "Nature Jam",
    "avalanche_nature_jam_vol2": "Nature Jam vol.2",
    "xrpl_jb_ai_nature": "Jack Beatnic",
    "xrpl_jack_beatnic": "Jack Beatnic",
    "sui_nature_stories_tradeport": "Nature Stories SE",
    "sui_nature_stories_1of1_tradeport": "Nature Stories SE 1/1",
    "polygon_jb_ai_play": "JB AI Play",
    "objkt_jack_beatnic_open_editions": "Open Editions",
    "objkt_jacks_nature": "Jack's Nature",
}


def nft_collection_name(nft: dict, info: dict) -> str:
    name = (nft.get("collection_name") or "").strip()
    if name:
        return name
    cid = (nft.get("collection_id") or "").strip()
    if cid in COLLECTION_LABELS:
        return COLLECTION_LABELS[cid]
    if cid in SHOP_COLLECTION_NAMES:
        return SHOP_COLLECTION_NAMES[cid]
    # Do not fall back to gallery.json (Nature Stories) for other feeds.
    if cid:
        return cid.replace("_", " ").replace("-", " ").title()
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


def format_amount(value) -> str:
    """Exact catalog figure. Never :g — that turns 1.797001 into 1.797."""
    if value is None or value == "":
        return ""
    if isinstance(value, str):
        return value.strip()
    from decimal import Decimal, InvalidOperation

    try:
        d = Decimal(str(value))
    except InvalidOperation:
        return str(value)
    s = format(d, "f")
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    return s or "0"


def format_share_price(nft: dict, info: dict) -> tuple[str, str]:
    symbol = nft_currency(nft, info)
    # Studio shop: token id lives in pay_amount. Do not round.
    if (nft.get("medium") == "shop") and nft.get("pay_amount") not in (None, ""):
        return f"{format_amount(nft['pay_amount'])} {symbol}", "Studio shop"

    listed = price_field(nft, "current_price", symbol)
    last_sale = price_field(nft, "last_sale_price", symbol)
    mint = price_field(nft, "mint_price", symbol)

    if listed is None and symbol == "XTZ" and nft.get("current_price_xtz") not in (None, ""):
        listed = nft["current_price_xtz"]
    if listed is None and symbol == "XRP" and nft.get("current_price_xrp") not in (None, ""):
        listed = nft["current_price_xrp"]
    if listed is None and nft.get("price_xrp") not in (None, ""):
        listed = nft["price_xrp"]
        if symbol != "XRP":
            symbol = "XRP"

    status = (nft.get("listing_status") or nft.get("status") or "").lower()
    if listed is not None and status in {
        "for sale",
        "listed",
        "available",
        "mint available",
    }:
        hint = "Listed" if status in {"for sale", "listed"} else "Mint"
        return f"{format_amount(listed)} {symbol}", hint
    if last_sale is not None:
        return f"{format_amount(last_sale)} {symbol}", "Last sale"
    if mint is not None:
        return f"{format_amount(mint)} {symbol}", "Mint price"
    if listed is not None:
        return f"{format_amount(listed)} {symbol}", "Price"
    if nft.get("medium") == "sui_ai":
        return "Sui", "Mint"
    if nft.get("medium") == "xrpl_ai" or nft.get("chain") == "xrpl":
        px = nft.get("current_price_xrp")
        if px in (None, ""):
            px = nft.get("price_xrp")
        if px not in (None, ""):
            return f"{format_amount(px)} XRP", "Mint"
        return "0.1 XRP", "Mint"
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


def _load_site_hero_bg(data: dict) -> tuple[Image.Image, str]:
    """Locked hero_image wins — never rotate with gallery front / jbg-present promo."""
    info = data.get("collection_info") or {}
    locked = (info.get("hero_image") or info.get("hero_bg") or "").strip()
    if locked:
        if locked.startswith(("http://", "https://")):
            return fetch_image(locked), locked
        path = ROOT / locked
        if path.is_file():
            return Image.open(path).convert("RGB"), str(path)
        raise SystemExit(f"gallery.json hero_image missing file: {path}")
    nfts = data.get("nfts") or []
    if not nfts:
        raise SystemExit("gallery.json: no NFT for the page background (and no hero_image)")
    label = nfts[0].get("name", "—")
    return fetch_image(nfts[0]["image_url"]), f"nfts[0]={label}"


def generate_site_og(data: dict, output: Path = SITE_OG_PATH) -> Path:
    info = data["collection_info"]
    title = og_plain_text(info.get("hero_title") or info.get("artist") or SITE_BRAND_TITLE)
    tagline = og_plain_text(info.get("hero_tagline") or SITE_BRAND_TAGLINE)
    gallery_label = og_plain_text(SITE_GALLERY_LABEL)

    bg, src = _load_site_hero_bg(data)
    print(f"[site] Background (locked): {src}")
    canvas = draw_site_brand_overlay(
        cover_crop(bg, WIDTH, HEIGHT, focus_y=0.4),
        title,
        tagline,
        gallery_label,
    )

    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(output, "JPEG", quality=92, optimize=True, subsampling=0)
    print(f"[site] Saved: {output} ({output.stat().st_size // 1024} KB)")
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


def fit_price_font(text: str, max_width: int) -> ImageFont.FreeTypeFont:
    for size in (50, 42, 36, 30, 24):
        font = ImageFont.truetype(str(FONTS_DIR / "Inter.ttf"), size)
        bbox = font.getbbox(text)
        if bbox[2] - bbox[0] <= max_width:
            return font
    return ImageFont.truetype(str(FONTS_DIR / "Inter.ttf"), 24)


def generate_nft_og(nft: dict, info: dict, thumb: Image.Image | None = None) -> Image.Image:
    f = fonts()
    collection = nft_collection_name(nft, info)
    artwork_title = nft_artwork_title(nft)
    price_text, _hint = format_share_price(nft, info)
    white = (255, 255, 255, 255)
    muted = (210, 220, 235, 255)
    text_max_w = WIDTH - NFT_TEXT_X - NFT_PAD

    if thumb is None:
        thumb = load_nft_image(nft)

    canvas = nft_card_background()
    tile = rounded_thumb(thumb, NFT_THUMB)
    canvas.paste(tile, (NFT_PAD, NFT_PAD), tile)

    draw = ImageDraw.Draw(canvas)
    draw.text((NFT_TEXT_X, NFT_PAD + 8), collection, font=f["label"], fill=muted)
    draw_title_block(draw, NFT_TEXT_X, NFT_PAD + 48, artwork_title, text_max_w, white)
    price_font = fit_price_font(price_text, text_max_w)
    price_bbox = price_font.getbbox(price_text)
    price_h = price_bbox[3] - price_bbox[1]
    price_y = HEIGHT - OG_SAFE_BOTTOM - price_h
    draw_bold(draw, (NFT_TEXT_X, price_y), price_text, price_font, white)
    return canvas


def generate_nft_ogs(
    data: dict,
    token_ids: set[int] | None = None,
    output_dir: Path | None = None,
    nfts: list[dict] | None = None,
    skip_existing: bool = False,
    limit: int | None = None,
) -> list[Path]:
    """Retired (2026-10-03): no per-NFT OG cards. Share pages use the promo
    board or the single fallback assets/og-preview.jpg."""
    print("[og] per-NFT OG cards retired — share pages use promo boards / og-preview.jpg")
    return []


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
        photo_chain = (nft.get("chain") or "").lower()
        if photo_chain in {"xrpl", "avalanche"}:
            q["pchain"] = photo_chain
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


def site_og_image_url(base_url: str, og_version: str) -> str:
    return og_url_with_version(base_url, "assets/og-preview.jpg", og_version)


# Promo boards (white 1:1 board, ~683–687 px) — public on the jbg-present
# Pages site: https://jackbeatnic.github.io/jbg-present/promo/<collection_id>/<NNNN>.jpg
# NNNN = ON-CHAIN token id (NJ vol2 / AI Play gallery token_id is synthetic).
# Which boards are actually published comes from data/promo_boards.json
# (build_promo_board_index.py) — never guess from local files, a local board
# that was not pushed would be a 404 card.
# robots.txt must keep /jbg-present/promo/ allowed for Twitterbot & co.
PROMO_INDEX_JSON = ROOT / "data" / "promo_boards.json"
PROMO_PUBLIC_BASE = "https://jackbeatnic.github.io/jbg-present/promo"
# Horizontal banners (1200x630) live at jbg-present/promo_banner.
# The share page keeps the square as og:image. twitter:image points at
# /card-image/ when a banner is published: X's crawler is redirected to the
# banner, and every other client (including Arena) is redirected to the square.
# nft/<col>/<id>-a.html puts the banner on both tags.
PROMO_BANNER_PUBLIC_BASE = "https://jackbeatnic.github.io/jbg-present/promo_banner"
_PROMO_INDEX: dict | None = None


def refresh_promo_index() -> None:
    """With a local jbg-present clone (JB), re-read which boards are published
    (origin/main) before writing share pages. JB_PROMO_INDEX_AUTO=0 disables."""
    if os.environ.get("JB_PROMO_INDEX_AUTO", "1") == "0":
        return
    present = Path(os.environ.get("JB_PRESENT_DIR") or (ROOT.parent / "jbg-present"))
    if not (present / ".git").exists():
        return
    global _PROMO_INDEX
    try:
        sys.path.insert(0, str(ROOT))
        import build_promo_board_index as idx

        idx.refresh("local", quiet=True)
        _PROMO_INDEX = None
    except Exception as exc:  # noqa: BLE001 — keep the committed index
        print(f"[promo] WARN: board index not refreshed ({exc}) — using {PROMO_INDEX_JSON.name}")


def promo_index() -> dict:
    global _PROMO_INDEX
    if _PROMO_INDEX is None:
        try:
            _PROMO_INDEX = json.loads(PROMO_INDEX_JSON.read_text(encoding="utf-8"))
        except FileNotFoundError:
            print(f"[promo] missing {PROMO_INDEX_JSON.name} — share pages use og-preview.jpg")
            _PROMO_INDEX = {}
    return _PROMO_INDEX


# Salvor photography listings are not the board folder name. Squares live at
# jbg-present/promo/avalanche_jb_photography/<on-chain token>.jpg.
PHOTO_BOARD = "avalanche_jb_photography"
PHOTO_CONTRACT = "0xf3e01890467d204ff7cc0cdebb69f11e7f55f92c"


def promo_board_folder(nft: dict) -> str:
    cid = (nft.get("collection_id") or "").strip().lower().replace("-", "_")
    contract = (nft.get("contract_address") or "").strip().lower()
    if (
        cid == PHOTO_BOARD
        or cid.startswith("salvor_photo_")
        or contract == PHOTO_CONTRACT
        or nft.get("source") == "salvor"
    ):
        return PHOTO_BOARD
    return cid


def promo_board_key(nft: dict) -> tuple[str, int] | None:
    """(board folder, on-chain token id) or None."""
    cid = promo_board_folder(nft)
    if not cid:
        return None
    for key in ("onchain_token_id", "token_id"):
        raw = nft.get(key)
        if raw in (None, ""):
            continue
        try:
            return cid, int(raw)
        except (TypeError, ValueError):
            continue
    return None


def promo_board(nft: dict) -> dict | None:
    """Published promo board for this work: {url, width, height} or None."""
    key = promo_board_key(nft)
    if key is None:
        return None
    cid, tid = key
    idx = promo_index()
    entry = ((idx.get("collections") or {}).get(cid) or {}).get(f"{tid:04d}")
    if not entry:
        return None
    width, height, sha = entry
    base = (idx.get("base") or PROMO_PUBLIC_BASE).rstrip("/")
    return {
        "url": f"{base}/{cid}/{tid:04d}.jpg?v={sha[:8]}",
        "width": int(width),
        "height": int(height),
    }


CARD_IMAGE_BASE = "https://api.jackbeatnic.shop/card-image"


def card_image_url(nft: dict, banner: dict) -> str:
    """twitter:image target. The card-image service redirects Twitterbot to the
    horizontal banner and every other client to the square."""
    key = promo_board_key(nft)
    if key is None:
        return banner["url"]
    cid, tid = key
    sha = banner["url"].rsplit("v=", 1)[-1]
    return f"{CARD_IMAGE_BASE}/{cid}/{tid:04d}?v={sha}"


def promo_banner(nft: dict) -> dict | None:
    """Published horizontal banner (1200x630, jbg-present/promo_banner) or None."""
    key = promo_board_key(nft)
    if key is None:
        return None
    cid, tid = key
    idx = promo_index()
    entry = ((idx.get("banners") or {}).get(cid) or {}).get(f"{tid:04d}")
    if not entry:
        return None
    width, height, sha = entry
    base = (idx.get("banner_base") or PROMO_BANNER_PUBLIC_BASE).rstrip("/")
    return {
        "url": f"{base}/{cid}/{tid:04d}.jpg?v={sha[:8]}",
        "width": int(width),
        "height": int(height),
    }


def arena_share_path_for_nft(nft: dict) -> str:
    """Arena variant: nft/{collection_slug}/{token_id}-a.html (og:image = banner)."""
    rel = share_path_for_nft(nft)
    return rel[: -len(".html")] + "-a.html"


def promo_square_url(nft: dict) -> str | None:
    """Back-compat helper: public board URL or None."""
    board = promo_board(nft)
    return board["url"] if board else None


def og_image_url(nft: dict, base_url: str, og_version: str) -> str:
    """Fallback share image when there is no promo board: the site og-preview.jpg."""
    return site_og_image_url(base_url, og_version)


def share_og_image(nft: dict, base_url: str, og_version: str) -> tuple[str, int, int, str]:
    """(url, width, height, kind) — promo board first, else fallback card."""
    board = promo_board(nft)
    if board:
        return board["url"], board["width"], board["height"], "board"
    url = og_image_url(nft, base_url, og_version)
    return url, WIDTH, HEIGHT, "site"


def share_page_html(
    nft: dict,
    info: dict,
    base_url: str,
    og_version: str,
    *,
    arena: bool = False,
) -> str:
    """Share landing. The square promo board is og:image. When a horizontal
    banner is published, twitter:image is the card-image redirect (X receives
    the banner, other clients receive the square). Otherwise twitter:image
    is the same square. arena=True: the -a.html variant, banner on both tags, noindex."""
    token_id = int(nft["token_id"])
    collection = nft_collection_name(nft, info)
    artwork_title = nft_artwork_title(nft)
    price_text, price_hint = format_share_price(nft, info)
    rel_path = arena_share_path_for_nft(nft) if arena else share_path_for_nft(nft)
    share_url = f"{base_url}/{rel_path}"
    # og:image is the square. twitter:image is a redirect when a banner exists:
    # Twitterbot is sent the horizontal banner, every other client the square.
    banner = promo_banner(nft)
    og_image, og_w, og_h, _kind = share_og_image(nft, base_url, og_version)
    twitter_image = og_image
    if banner and arena:
        og_image, og_w, og_h = banner["url"], banner["width"], banner["height"]
        twitter_image = og_image
    elif banner:
        twitter_image = card_image_url(nft, banner)
    robots_meta = '\n    <meta name="robots" content="noindex">' if arena else ""
    gallery_url = gallery_deep_link(nft, base_url)
    title = f"{artwork_title} | Jack Beatnic Gallery"
    description = f"{price_text} · {collection} — {price_hint}"

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="{html.escape(description)}">
    <title>{html.escape(title)}</title>{robots_meta}
    <meta property="og:type" content="website">
    <meta property="og:url" content="{html.escape(share_url)}">
    <meta property="og:title" content="{html.escape(title)}">
    <meta property="og:description" content="{html.escape(description)}">
    <meta property="og:image" content="{html.escape(og_image)}">
    <meta property="og:image:secure_url" content="{html.escape(og_image)}">
    <meta property="og:image:type" content="image/jpeg">
    <meta property="og:image:width" content="{og_w}">
    <meta property="og:image:height" content="{og_h}">
    <meta property="og:image:alt" content="{html.escape(title)}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:site" content="{html.escape(info.get('twitter_handle') or '@JackBeatnicSI')}">
    <meta name="twitter:title" content="{html.escape(title)}">
    <meta name="twitter:description" content="{html.escape(description)}">
    <meta name="twitter:image" content="{html.escape(twitter_image)}">
    <meta name="twitter:image:alt" content="{html.escape(title)}">
    <link rel="canonical" href="{html.escape(share_url)}">
    <script>location.replace({json.dumps(gallery_url)});</script>
    <link rel="stylesheet" href="/css/redesign-pages.css?v=20261001">
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
    <link rel="stylesheet" href="/css/redesign-pages.css?v=20261001">
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
    cleanup_stale: bool = True,
) -> list[Path]:
    info = data["collection_info"]
    base_url = site_base_url(info)
    og_version = info.get("og_cache_version") or og_cache_version()
    refresh_promo_index()
    if nfts is None:
        nfts = collect_all_share_nfts(data)
    output_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    active_paths: set[Path] = set()
    per_col: dict[str, int] = {}
    per_kind: dict[str, int] = {}
    # Flat nft/{id}.html only when this token_id is unique across ALL feeds
    # (not after the --chain filter — otherwise XRPL overwrites NS #1).
    tid_counts: dict[int, int] = {}
    for nft in collect_all_share_nfts(data):
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
        # Arena variant (banner og:image) only when the banner is published.
        if promo_banner(nft):
            out_a = ROOT / arena_share_path_for_nft(nft)
            out_a.write_text(share_page_html(nft, info, base_url, og_version, arena=True), encoding="utf-8")
            written.append(out_a)
            active_paths.add(out_a.resolve())
            per_kind["banner"] = per_kind.get("banner", 0) + 1
        share_url = f"{base_url}/{rel}"
        nft["share_url"] = share_url
        col = nft_collection_id(nft)
        og_url, _w, _h, kind = share_og_image(nft, base_url, og_version)
        nft["og_image"] = og_url.split("?", 1)[0] if kind != "board" else og_url
        per_kind[kind] = per_kind.get(kind, 0) + 1
        per_col[col] = per_col.get(col, 0) + 1

        # Legacy flat nft/{id}.html — only when this token_id is unique
        if tid_counts.get(token_id, 0) == 1:
            legacy = output_dir / f"{token_id}.html"
            legacy.write_text(legacy_redirect_html(share_url), encoding="utf-8")
            written.append(legacy)
            active_paths.add(legacy.resolve())

    # Keep existing flat nft/{id}.html (old tweets).
    # Drop stale namespaced pages only on a full run — a --token filter
    # must not wipe the rest of the catalog.
    if cleanup_stale and token_ids is None:
        for sub in output_dir.iterdir():
            if not sub.is_dir():
                continue
            for stale in sub.glob("*.html"):
                if stale.resolve() not in active_paths:
                    stale.unlink()
                    print(f"[page] Removed stale: {stale.relative_to(ROOT)}")
            if not any(sub.iterdir()):
                sub.rmdir()

    for col, n in sorted(per_col.items()):
        print(f"[page] {col}: {n}")
    print(f"[page] og:image — promo board: {per_kind.get('board', 0)}, "
          f"og-preview.jpg: {per_kind.get('site', 0)}, "
          f"Arena -a.html (banner): {per_kind.get('banner', 0)}")
    print(f"[page] total {len(written)} files")
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
            raise SystemExit(f"index.html: meta {attr} not found")

    INDEX_HTML.write_text(html_text, encoding="utf-8")
    print(f"[site] index.html — og:image?v={version}")


def generate_all(
    *,
    site: bool = True,
    nft: bool = True,
    pages: bool = True,
    write_gallery: bool = True,
    token_ids: set[int] | None = None,
    skip_existing: bool = True,
    limit: int | None = None,
) -> None:
    data = load_gallery()

    version = stamp_gallery_meta(data)

    if site:
        generate_site_og(data)
        update_site_index_og(data, version)
    if nft:
        generate_nft_ogs(
            data,
            token_ids=token_ids,
            skip_existing=skip_existing,
            limit=limit,
        )
    if pages:
        generate_share_pages(data, token_ids=token_ids)

    if write_gallery and (site or pages):
        save_gallery(data)
        print("[meta] gallery.json — og_cache_version / share_url / og_generated_at")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate Open Graph cards for the gallery.")
    parser.add_argument("--site-only", action="store_true", help="Only og-preview.jpg (homepage)")
    parser.add_argument("--nft-only", action="store_true", help="Only per-NFT cards + share pages")
    parser.add_argument(
        "--pages-only",
        action="store_true",
        help="Only share pages (all feeds: XRPL/Sui/NJ/shop). No JPG cards.",
    )
    parser.add_argument(
        "--og-all",
        action="store_true",
        help="OG JPG cards for all feeds (NS/XRPL/Sui/NJ/shop) + refresh landings.",
    )
    parser.add_argument(
        "--skip-existing",
        action="store_true",
        help="Do not overwrite OG cards already on disk.",
    )
    parser.add_argument("--limit", type=int, default=None, help="Max number of new OG cards (test).")
    parser.add_argument("--no-gallery-json", action="store_true", help="Do not write share_url into gallery.json")
    parser.add_argument("--token", type=int, action="append", dest="tokens", help="Only the given token_id(s)")
    parser.add_argument(
        "--collection",
        help="Only this collection_id (e.g. polygon_nature_stories_vol2).",
    )
    parser.add_argument(
        "--chain",
        help="Only this chain (e.g. xrpl). Does not delete other collections' landings.",
    )
    return parser.parse_args(argv)


def _norm_cid(s: str) -> str:
    return (s or "").strip().lower().replace("-", "_")


def nfts_for_run(data: dict, *, chain: str | None = None, collection_filter: str | None = None) -> list[dict]:
    nfts = collect_all_share_nfts(data)
    if collection_filter:
        want_c = _norm_cid(collection_filter)
        nfts = [
            n
            for n in nfts
            if _norm_cid(nft_collection_id(n)) == want_c
            or _norm_cid(n.get("collection_id") or "") == want_c
        ]
    if not chain:
        return nfts
    want = chain.strip().lower()
    out = []
    for nft in nfts:
        ch = (nft.get("chain") or "").lower()
        if ch == want or (want == "xrpl" and ch in ("xrpl", "xrp")):
            out.append(nft)
    return out


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    token_ids = set(args.tokens) if args.tokens else None
    chain = (args.chain or "").strip() or None
    collection_filter = (getattr(args, "collection", None) or "").strip() or None
    subset = bool(token_ids or chain or collection_filter)

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
        nfts = nfts_for_run(data, chain=chain, collection_filter=collection_filter)
        generate_share_pages(
            data,
            token_ids=token_ids,
            nfts=nfts,
            cleanup_stale=not subset,
        )
        if not args.no_gallery_json:
            save_gallery(data)
            print("[meta] gallery.json — share_url")
        return 0

    if args.og_all:
        data = load_gallery()
        version = stamp_gallery_meta(data)
        nfts = nfts_for_run(data, chain=chain, collection_filter=collection_filter)
        generate_nft_ogs(
            data,
            token_ids=token_ids,
            nfts=nfts,
            skip_existing=args.skip_existing,
            limit=args.limit,
        )
        generate_share_pages(
            data,
            token_ids=token_ids,
            nfts=nfts,
            cleanup_stale=not subset,
        )
        if not args.no_gallery_json:
            save_gallery(data)
            print(f"[meta] gallery.json — og_cache_version={version}")
        return 0

    if args.nft_only:
        data = load_gallery()
        version = stamp_gallery_meta(data)
        nfts = nfts_for_run(data, chain=chain, collection_filter=collection_filter)
        generate_nft_ogs(
            data,
            token_ids=token_ids,
            nfts=nfts,
            skip_existing=args.skip_existing,
            limit=args.limit,
        )
        generate_share_pages(
            data,
            token_ids=token_ids,
            nfts=nfts,
            cleanup_stale=not subset,
        )
        if not args.no_gallery_json:
            save_gallery(data)
        return 0

    generate_all(
        write_gallery=not args.no_gallery_json,
        token_ids=token_ids,
        skip_existing=args.skip_existing,
        limit=args.limit,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())