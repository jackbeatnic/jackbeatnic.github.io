#!/usr/bin/env python3
"""Regenerate robots.txt + sitemap.xml for GitHub Pages deploy."""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SITE = "https://jackbeatnic.github.io"


def main() -> None:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    urls: list[tuple[str, str, str, str]] = [
        (f"{SITE}/", now, "daily", "1.0"),
    ]
    nft_dir = ROOT / "nft"
    if nft_dir.is_dir():
        for p in sorted(nft_dir.glob("*.html"), key=lambda x: x.name):
            if p.stat().st_size < 50:
                continue
            urls.append((f"{SITE}/nft/{p.name}", now, "weekly", "0.7"))

    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ]
    for loc, lastmod, freq, prio in urls:
        lines.extend(
            [
                "  <url>",
                f"    <loc>{loc}</loc>",
                f"    <lastmod>{lastmod}</lastmod>",
                f"    <changefreq>{freq}</changefreq>",
                f"    <priority>{prio}</priority>",
                "  </url>",
            ]
        )
    lines.append("</urlset>")
    lines.append("")
    (ROOT / "sitemap.xml").write_text("\n".join(lines), encoding="utf-8")

    robots = f"""# Jack Beatnic Gallery — {SITE}/
User-agent: *
Allow: /

Sitemap: {SITE}/sitemap.xml
"""
    (ROOT / "robots.txt").write_text(robots, encoding="utf-8")
    print(f"sitemap.xml: {len(urls)} URLs")
    print(f"robots.txt → Sitemap: {SITE}/sitemap.xml")


if __name__ == "__main__":
    main()
