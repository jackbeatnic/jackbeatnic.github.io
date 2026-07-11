#!/usr/bin/env python3
"""Generate Open Graph previews for Jack Beatnic Gallery.

- Site card: assets/og-preview.jpg (homepage)
- Per-NFT cards: assets/og/nft-{id}.jpg (OpenSea-style: thumb + price)
- Share landing pages: nft/{id}.html (OG meta → redirect to gallery)
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

WIDTH = 1200
HEIGHT = 630
SITE_BAR_HEIGHT = 200

SITE_TITLE = "Jack Beatnic Gallery"
SITE_BLURB = "Quiet landscapes · AI art & photography"

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


def fonts() -> dict[str, ImageFont.FreeTypeFont]:
    return {
        "title_lg": ImageFont.truetype(str(FONTS_DIR / "Inter.ttf"), 52),
        "title_md": ImageFont.truetype(str(FONTS_DIR / "Inter.ttf"), 46),
        "body": ImageFont.truetype(str(FONTS_DIR / "Inter.ttf"), 26),
        "label": ImageFont.truetype(str(FONTS_DIR / "Inter.ttf"), 24),
        "price": ImageFont.truetype(str(FONTS_DIR / "Inter.ttf"), 50),
    }


def draw_bold(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str, font, fill) -> None:
    x, y = xy
    for dx, dy in ((0, 0), (1, 0), (0, 1)):
        draw.text((x + dx, y + dy), text, font=font, fill=fill)


def collection_display_name(info: dict) -> str:
    desc = info.get("description") or ""
    head = re.split(r"\s*[–—-]\s*", desc, maxsplit=1)[0].strip()
    if head:
        return head
    cid = info.get("collection_id") or ""
    return cid.replace("_", " ").title() or "Collection"


def parse_nft_labels(nft: dict) -> tuple[str, str]:
    name = nft.get("name") or f"Token #{nft.get('token_id', '?')}"
    match = re.match(r"^(.*?)\s*(#\d+)\s*$", name, re.I)
    if match:
        return match.group(1).strip(), match.group(2)
    token_id = nft.get("token_id")
    suffix = f"#{int(token_id):04d}" if token_id is not None else ""
    return name, suffix


def price_field(nft: dict, prefix: str, symbol: str):
    key = f"{prefix}_{symbol.lower()}"
    if nft.get(key) not in (None, ""):
        return nft[key]
    if symbol == "AVAX" and nft.get(f"{prefix}_avax") not in (None, ""):
        return nft[f"{prefix}_avax"]
    return None


def format_share_price(nft: dict, info: dict) -> tuple[str, str]:
    symbol = info.get("native_currency") or "AVAX"
    listed = price_field(nft, "current_price", symbol)
    last_sale = price_field(nft, "last_sale_price", symbol)
    mint = price_field(nft, "mint_price", symbol)

    if listed is not None and nft.get("listing_status") == "For Sale":
        return f"{listed:g} {symbol}", "Listed on OpenSea"
    if last_sale is not None:
        return f"{last_sale:g} {symbol}", "Last sale"
    if mint is not None:
        return f"{mint:g} {symbol}", "Mint price"
    return "View on OpenSea", "Check listing"


def draw_site_gradient_bar(base: Image.Image) -> Image.Image:
    overlay = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    fade_start = HEIGHT - SITE_BAR_HEIGHT - 120

    for y in range(fade_start, HEIGHT - SITE_BAR_HEIGHT):
        t = (y - fade_start) / max(1, (HEIGHT - SITE_BAR_HEIGHT) - fade_start)
        alpha = int(220 * (t**1.4))
        draw.line([(0, y), (WIDTH, y)], fill=(10, 10, 10, alpha))

    draw.rectangle(
        [(0, HEIGHT - SITE_BAR_HEIGHT), (WIDTH, HEIGHT)],
        fill=(10, 10, 10, 245),
    )
    return Image.alpha_composite(base.convert("RGBA"), overlay)


def generate_site_og(data: dict, output: Path = SITE_OG_PATH) -> Path:
    nfts = data.get("nfts") or []
    if not nfts:
        raise SystemExit("gallery.json: brak NFT do tła strony")

    info = data["collection_info"]
    title = info.get("project_name") or SITE_TITLE
    f = fonts()

    print(f"[site] Tło: {nfts[0].get('name', '—')}")
    bg = fetch_image(nfts[0]["image_url"])
    canvas = draw_site_gradient_bar(cover_crop(bg, WIDTH, HEIGHT, focus_y=0.4))

    draw = ImageDraw.Draw(canvas)
    bar_top = HEIGHT - SITE_BAR_HEIGHT
    text_x = 72
    title_y = bar_top + 54
    blurb_y = title_y + 62
    white = (255, 255, 255, 255)

    draw_bold(draw, (text_x, title_y), title, f["title_md"], white)
    draw.text((text_x, blurb_y), SITE_BLURB, font=f["body"], fill=white)

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
    thumb = fit_square(img, size)
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    bordered = Image.new("RGBA", (size + 4, size + 4), (255, 255, 255, 255))
    bordered.paste(thumb, (2, 2))
    bordered.putalpha(Image.new("L", bordered.size, 255))
    bordered.putalpha(mask.resize(bordered.size))
    return bordered


def generate_nft_og(nft: dict, info: dict, thumb: Image.Image | None = None) -> Image.Image:
    f = fonts()
    collection = collection_display_name(info)
    artwork_name, token_label = parse_nft_labels(nft)
    price_text, _ = format_share_price(nft, info)
    white = (255, 255, 255, 255)
    muted = (210, 220, 235, 255)

    if thumb is None:
        thumb = fetch_image(nft["image_url"])

    canvas = nft_card_background()
    tile = rounded_thumb(thumb, NFT_THUMB)
    canvas.paste(tile, (NFT_PAD, NFT_PAD), tile)

    draw = ImageDraw.Draw(canvas)
    draw.text((NFT_TEXT_X, NFT_PAD + 8), collection, font=f["label"], fill=muted)
    draw_bold(draw, (NFT_TEXT_X, NFT_PAD + 52), artwork_name, f["title_lg"], white)
    if token_label:
        draw_bold(draw, (NFT_TEXT_X, NFT_PAD + 128), token_label, f["title_lg"], white)
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


def share_page_html(nft: dict, info: dict, base_url: str) -> str:
    token_id = int(nft["token_id"])
    collection = collection_display_name(info)
    artwork_name, token_label = parse_nft_labels(nft)
    price_text, price_hint = format_share_price(nft, info)
    share_url = f"{base_url}/nft/{token_id}.html"
    og_image = f"{base_url}/assets/og/nft-{token_id}.jpg"
    gallery_url = f"{base_url}/?work={token_id}"
    title = f"{nft.get('name') or artwork_name} | Jack Beatnic Gallery"
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


def generate_share_pages(
    data: dict,
    token_ids: set[int] | None = None,
    output_dir: Path = NFT_PAGES_DIR,
) -> list[Path]:
    info = data["collection_info"]
    base_url = site_base_url(info)
    nfts = data.get("nfts") or []
    output_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    active_ids = set()

    for nft in nfts:
        token_id = int(nft["token_id"])
        active_ids.add(token_id)
        if token_ids is not None and token_id not in token_ids:
            continue

        out = output_dir / f"{token_id}.html"
        out.write_text(share_page_html(nft, info, base_url), encoding="utf-8")
        written.append(out)
        nft["share_url"] = f"{base_url}/nft/{token_id}.html"
        nft["og_image"] = f"assets/og/nft-{token_id}.jpg"

    for stale in output_dir.glob("*.html"):
        if stale.stem.isdigit() and int(stale.stem) not in active_ids:
            stale.unlink()
            print(f"[page] Usunięto nieaktualny: {stale.name}")

    return written


def stamp_gallery_meta(data: dict) -> None:
    info = data["collection_info"]
    info["og_generated_at"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def generate_all(
    *,
    site: bool = True,
    nft: bool = True,
    pages: bool = True,
    write_gallery: bool = True,
    token_ids: set[int] | None = None,
) -> None:
    data = load_gallery()

    if site:
        generate_site_og(data)
    if nft:
        generate_nft_ogs(data, token_ids=token_ids)
    if pages:
        generate_share_pages(data, token_ids=token_ids)

    if write_gallery and pages:
        stamp_gallery_meta(data)
        save_gallery(data)
        print("[meta] gallery.json — share_url / og_image / og_generated_at")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generuj karty Open Graph dla galerii.")
    parser.add_argument("--site-only", action="store_true", help="Tylko og-preview.jpg (strona główna)")
    parser.add_argument("--nft-only", action="store_true", help="Tylko karty per NFT + strony share")
    parser.add_argument("--no-gallery-json", action="store_true", help="Nie zapisuj share_url w gallery.json")
    parser.add_argument("--token", type=int, action="append", dest="tokens", help="Tylko wybrane token_id")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    token_ids = set(args.tokens) if args.tokens else None

    if args.site_only:
        data = load_gallery()
        generate_site_og(data)
        return 0

    if args.nft_only:
        data = load_gallery()
        generate_nft_ogs(data, token_ids=token_ids)
        generate_share_pages(data, token_ids=token_ids)
        if not args.no_gallery_json:
            stamp_gallery_meta(data)
            save_gallery(data)
        return 0

    generate_all(
        write_gallery=not args.no_gallery_json,
        token_ids=token_ids,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())