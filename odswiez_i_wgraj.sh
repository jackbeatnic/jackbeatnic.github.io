#!/usr/bin/env bash
# Odśwież ceny z OpenSea (raport → gallery.json) i wgraj na GitHub Pages.
#
# Wymaga: OPENSEA_API_KEY, git z remote w tym katalogu (www/).
#
# Użycie:
#   export OPENSEA_API_KEY="..."
#   ./odswiez_i_wgraj.sh
#   ./odswiez_i_wgraj.sh --kolekcja avalanche_nature_stories
#   ./odswiez_i_wgraj.sh --dry-run          # raport + podgląd sync, bez zapisu i push
#   ./odswiez_i_wgraj.sh --no-push          # sync lokalnie, bez git push
#   ./odswiez_i_wgraj.sh -m "sync after listing batch"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JB_NFT="$(dirname "$SCRIPT_DIR")"
RAPORT_DIR="$JB_NFT/raportowanie"
WWW_DIR="$SCRIPT_DIR"
if [[ -x "$JB_NFT/venv/bin/python3" ]]; then
    PYTHON="$JB_NFT/venv/bin/python3"
else
    PYTHON="python3"
fi

KOLEKCJA="${KOLEKCJA:-avalanche_nature_stories}"
DRY_RUN=false
NO_PUSH=false
COMMIT_MSG=""

usage() {
    sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --kolekcja)
            KOLEKCJA="$2"
            shift 2
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --no-push)
            NO_PUSH=true
            shift
            ;;
        -m|--message)
            COMMIT_MSG="$2"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Nieznany argument: $1" >&2
            usage >&2
            exit 1
            ;;
    esac
done

if [[ -z "${OPENSEA_API_KEY:-}" ]]; then
    echo "Błąd: brak OPENSEA_API_KEY." >&2
    echo "  export OPENSEA_API_KEY=\"twój-klucz\"" >&2
    exit 1
fi

echo "=== [1/4] Raport OpenSea (--krok report) — $KOLEKCJA ==="
(
    cd "$RAPORT_DIR"
    "$PYTHON" raportuj_kolekcje.py --kolekcja "$KOLEKCJA" --krok report
)

echo ""
echo "=== [2/4] Sync gallery.json ==="
(
    cd "$WWW_DIR"
    if $DRY_RUN; then
        "$PYTHON" aktualizuj_ceny_z_raportu.py --kolekcja "$KOLEKCJA" --dry-run
    else
        "$PYTHON" aktualizuj_ceny_z_raportu.py --kolekcja "$KOLEKCJA"
    fi
)

echo ""
echo "=== [3/4] OG preview (site + per-NFT) ==="
(
    cd "$WWW_DIR"
    if $DRY_RUN; then
        echo "[dry-run] Pominięto generuj_og_preview.py"
    else
        "$PYTHON" generuj_og_preview.py
    fi
)

if $DRY_RUN; then
    echo ""
    echo "[dry-run] Pominięto zapis gallery.json (jeśli --dry-run w sync) i git push."
    exit 0
fi

if $NO_PUSH; then
    echo ""
    echo "[--no-push] gallery.json zaktualizowany lokalnie. Bez commit/push."
    exit 0
fi

echo ""
echo "=== [4/4] Git commit + push (GitHub Pages) ==="
cd "$WWW_DIR"

if ! git rev-parse --git-dir >/dev/null 2>&1; then
    echo "Błąd: brak repozytorium git w $WWW_DIR" >&2
    echo "Pierwszy raz: zobacz DEPLOY_GITHUB.txt" >&2
    exit 1
fi

if ! git remote get-url origin >/dev/null 2>&1; then
    echo "Błąd: brak remote 'origin'. Zobacz DEPLOY_GITHUB.txt" >&2
    exit 1
fi

if git diff --quiet -- gallery.json assets/og-preview.jpg assets/og nft/ js/gallery.js \
    && git diff --cached --quiet -- gallery.json assets/og-preview.jpg assets/og nft/ js/gallery.js; then
    echo "Brak zmian (gallery / OG) — pomijam commit i push."
    exit 0
fi

git add gallery.json assets/og-preview.jpg assets/og nft/ js/gallery.js generuj_og_preview.py
if [[ -z "$COMMIT_MSG" ]]; then
    COMMIT_MSG="sync prices ($KOLEKCJA) $(date -u +%Y-%m-%dT%H:%MZ)"
fi
git commit -m "$COMMIT_MSG"
git push

echo ""
echo "Gotowe. GitHub Pages odświeży się za ok. 1–2 minuty."