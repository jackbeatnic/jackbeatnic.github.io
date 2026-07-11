#!/usr/bin/env python3
"""Wyciąga tekst z plików .docx w tym katalogu (layout_notes/)."""
from __future__ import annotations

import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

W_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
DIR = Path(__file__).resolve().parent


def docx_to_text(path: Path) -> str:
    with zipfile.ZipFile(path) as zf:
        xml = zf.read("word/document.xml")
    root = ET.fromstring(xml)
    chunks: list[str] = []
    for node in root.iter(f"{W_NS}p"):
        parts = [t.text or "" for t in node.iter(f"{W_NS}t")]
        line = "".join(parts).strip()
        if line:
            chunks.append(line)
    return "\n".join(chunks)


def main() -> None:
    files = sorted(DIR.glob("*.docx"))
    if not files:
        print(f"Brak plików .docx w {DIR}", file=sys.stderr)
        print("Skopiuj tu pliki z Google Drive:", file=sys.stderr)
        print("  01_Ocena_Layout_JackBeatnic_Gallery.docx", file=sys.stderr)
        print("  02_Propozycja_Ulepszen_Kod_Fonty_Kolory.docx", file=sys.stderr)
        sys.exit(1)

    for path in files:
        print("=" * 72)
        print(path.name)
        print("=" * 72)
        print(docx_to_text(path))
        print()


if __name__ == "__main__":
    main()