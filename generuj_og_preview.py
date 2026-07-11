#!/usr/bin/env python3
"""Generate branded Open Graph preview (1200×630) for Jack Beatnic Gallery."""

from __future__ import annotations

import json
import sys
import urllib.request
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
GALLERY_JSON = ROOT / "gallery.json"
OUTPUT_PATH = ROOT / "assets" / "og-preview.jpg"
FONTS_DIR = ROOT / "assets" / "fonts"

WIDTH = 1200
HEIGHT = 630
BAR_HEIGHT = 200

OG_TITLE = "Jack Beatnic Gallery"
OG_BLURB = "Quiet landscapes · AI art & photography"


def load_gallery() -> dict:
    with GALLERY_JSON.open(encoding="utf-8") as fh:
        return json.load(fh)


def fetch_image(url: str) -> Image.Image:
    req = urllib.request.Request(url, headers={"User-Agent": "JackBeatnicGallery/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = resp.read()
    img = Image.open(BytesIO(data))
    return img.convert("RGB")


def cover_crop(img: Image.Image, width: int, height: int, focus_y: float = 0.4) -> Image.Image:
    """Crop to cover, aligning vertical focus (0=top, 1=bottom)."""
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


def draw_gradient_bar(base: Image.Image) -> Image.Image:
    """Dark bottom bar with soft fade into artwork."""
    overlay = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    fade_start = HEIGHT - BAR_HEIGHT - 120
    for y in range(fade_start, HEIGHT - BAR_HEIGHT):
        t = (y - fade_start) / max(1, (HEIGHT - BAR_HEIGHT) - fade_start)
        alpha = int(220 * (t ** 1.4))
        draw.line([(0, y), (WIDTH, y)], fill=(10, 10, 10, alpha))

    draw.rectangle(
        [(0, HEIGHT - BAR_HEIGHT), (WIDTH, HEIGHT)],
        fill=(10, 10, 10, 245),
    )

    return Image.alpha_composite(base.convert("RGBA"), overlay)


def draw_text(canvas: Image.Image, title: str, blurb: str) -> Image.Image:
    title_font = ImageFont.truetype(str(FONTS_DIR / "Inter.ttf"), 46)
    blurb_font = ImageFont.truetype(str(FONTS_DIR / "Inter.ttf"), 26)

    draw = ImageDraw.Draw(canvas)
    bar_top = HEIGHT - BAR_HEIGHT
    text_x = 72
    title_y = bar_top + 54
    blurb_y = title_y + 62
    white = (255, 255, 255, 255)

    # Faux-bold title (variable Inter has no weight axis in PIL).
    for dx, dy in ((0, 0), (1, 0), (0, 1)):
        draw.text((text_x + dx, title_y + dy), title, font=title_font, fill=white)
    draw.text((text_x, blurb_y), blurb, font=blurb_font, fill=white)
    return canvas


def generate(output: Path = OUTPUT_PATH) -> Path:
    data = load_gallery()
    nfts = data.get("nfts") or []
    if not nfts:
        raise SystemExit("gallery.json: brak NFT do tła")

    bg_url = nfts[0]["image_url"]
    info = data["collection_info"]
    title = info.get("project_name") or OG_TITLE
    blurb = OG_BLURB

    print(f"Tło: {nfts[0].get('name', bg_url)}")
    bg = fetch_image(bg_url)
    canvas = cover_crop(bg, WIDTH, HEIGHT, focus_y=0.4)
    canvas = draw_gradient_bar(canvas)
    canvas = draw_text(canvas, title, blurb)

    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(output, "JPEG", quality=92, optimize=True, subsampling=0)
    print(f"Zapisano: {output} ({output.stat().st_size // 1024} KB)")
    return output


if __name__ == "__main__":
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else OUTPUT_PATH
    generate(out)