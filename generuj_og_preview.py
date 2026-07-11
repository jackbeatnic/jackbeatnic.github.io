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
SIGNATURE_PATH = ROOT / "assets" / "signature.png"
OUTPUT_PATH = ROOT / "assets" / "og-preview.jpg"
FONTS_DIR = ROOT / "assets" / "fonts"

WIDTH = 1200
HEIGHT = 630
BAR_HEIGHT = 200
SIGNATURE_MAX_W = 340
SIGNATURE_PAD = 36


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


def fit_signature(sig: Image.Image, max_width: int) -> Image.Image:
    sig = sig.convert("RGBA")
    w, h = sig.size
    if w <= max_width:
        return sig
    scale = max_width / w
    return sig.resize((max_width, int(h * scale)), Image.Resampling.LANCZOS)


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


def place_signature(canvas: Image.Image, sig: Image.Image) -> Image.Image:
    """Signature on a subtle light panel (matches site header)."""
    sig = fit_signature(sig, SIGNATURE_MAX_W)
    sw, sh = sig.size
    pad_x, pad_y = 22, 14
    panel_w = sw + pad_x * 2
    panel_h = sh + pad_y * 2
    panel = Image.new("RGBA", (panel_w, panel_h), (255, 255, 255, 230))
    panel.paste(sig, (pad_x, pad_y), sig)

    x = SIGNATURE_PAD
    y = SIGNATURE_PAD
    out = canvas.copy()
    out.paste(panel, (x, y), panel)
    return out


def draw_text(canvas: Image.Image, title: str, tagline: str) -> Image.Image:
    playfair = ImageFont.truetype(str(FONTS_DIR / "PlayfairDisplay.ttf"), 56)
    inter = ImageFont.truetype(str(FONTS_DIR / "Inter.ttf"), 22)

    draw = ImageDraw.Draw(canvas)
    bar_top = HEIGHT - BAR_HEIGHT
    text_x = 72
    title_y = bar_top + 52
    tag_y = title_y + 68

    draw.text((text_x, title_y), title, font=playfair, fill=(255, 255, 255, 255))
    draw.text((text_x, tag_y), tagline.upper(), font=inter, fill=(154, 154, 154, 255))
    return canvas


def generate(output: Path = OUTPUT_PATH) -> Path:
    data = load_gallery()
    info = data["collection_info"]
    nfts = data.get("nfts") or []
    if not nfts:
        raise SystemExit("gallery.json: brak NFT do tła")

    bg_url = nfts[0]["image_url"]
    title = info.get("hero_title") or info.get("artist") or "Jack Beatnic"
    tagline = info.get("hero_tagline") or "AI Artist & Photographer"

    print(f"Tło: {nfts[0].get('name', bg_url)}")
    bg = fetch_image(bg_url)
    canvas = cover_crop(bg, WIDTH, HEIGHT, focus_y=0.4)
    canvas = draw_gradient_bar(canvas)
    canvas = place_signature(canvas, Image.open(SIGNATURE_PATH))
    canvas = draw_text(canvas, title, tagline)

    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(output, "JPEG", quality=92, optimize=True, subsampling=0)
    print(f"Zapisano: {output} ({output.stat().st_size // 1024} KB)")
    return output


if __name__ == "__main__":
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else OUTPUT_PATH
    generate(out)