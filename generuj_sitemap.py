#!/usr/bin/env python3
"""Regenerate robots.txt + sitemaps for GitHub Pages / Google Search Console."""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SITE = "https://jackbeatnic.github.io"


def main() -> None:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    urls: list[str] = [f"{SITE}/"]
    nft_dir = ROOT / "nft"
    if nft_dir.is_dir():
        for p in sorted(nft_dir.rglob("*.html")):
            if p.stat().st_size < 40:
                continue
            rel = p.relative_to(ROOT).as_posix()
            urls.append(f"{SITE}/{rel}")

    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ]
    for loc in urls:
        lines.extend(
            [
                "  <url>",
                f"    <loc>{loc}</loc>",
                f"    <lastmod>{now}</lastmod>",
                "  </url>",
            ]
        )
    lines.append("</urlset>")
    lines.append("")
    (ROOT / "sitemap.xml").write_text("\n".join(lines), encoding="utf-8")
    (ROOT / "sitemap.txt").write_text("\n".join(urls) + "\n", encoding="utf-8")

    mini = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        "  <url>",
        f"    <loc>{SITE}/</loc>",
        f"    <lastmod>{now}</lastmod>",
        "  </url>",
        "</urlset>",
        "",
    ]
    (ROOT / "sitemap-home.xml").write_text("\n".join(mini), encoding="utf-8")

    robots = f"""# Jack Beatnic Gallery — {SITE}/
User-agent: *
Allow: /

Sitemap: {SITE}/sitemap.xml
Sitemap: {SITE}/sitemap.txt
"""
    (ROOT / "robots.txt").write_text(robots, encoding="utf-8")
    print(f"sitemap.xml: {len(urls)} URLs")


if __name__ == "__main__":
    main()
