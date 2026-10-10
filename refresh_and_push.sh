#!/usr/bin/env bash
# Refresh prices from OpenSea (report → gallery.json) and push to GitHub Pages.
#
# Requires: OPENSEA_API_KEY, git with a remote in this folder (www/).
#
# Usage:
#   export OPENSEA_API_KEY="..."
#   ./refresh_and_push.sh
#   ./refresh_and_push.sh --collection avalanche_nature_stories
#   ./refresh_and_push.sh --dry-run          # report + sync preview, no write and no push
#   ./refresh_and_push.sh --no-push          # local sync, no git push
#   ./refresh_and_push.sh -m "sync after listing batch"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STUDIO="$(dirname "$SCRIPT_DIR")"
REPORTS_ROOT="$STUDIO/raportowanie"
WWW_DIR="$SCRIPT_DIR"
if [[ -x "$STUDIO/venv/bin/python3" ]]; then
    PYTHON="$STUDIO/venv/bin/python3"
else
    PYTHON="python3"
fi

COLLECTION="${COLLECTION:-avalanche_nature_stories}"
DRY_RUN=false
NO_PUSH=false
COMMIT_MSG=""

usage() {
    sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --collection)
            COLLECTION="$2"
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
            echo "Unknown argument: $1" >&2
            usage >&2
            exit 1
            ;;
    esac
done

if [[ -z "${OPENSEA_API_KEY:-}" ]]; then
    echo "Error: OPENSEA_API_KEY is not set." >&2
    echo "  export OPENSEA_API_KEY=\"your-key\"" >&2
    exit 1
fi

echo "=== [1/4] OpenSea report — $COLLECTION ==="
(
    cd "$REPORTS_ROOT"
    "$PYTHON" raportuj_kolekcje.py --kolekcja "$COLLECTION" --krok report  # local report tool (its own CLI)
)

echo ""
echo "=== [2/4] Sync gallery.json ==="
(
    cd "$WWW_DIR"
    if $DRY_RUN; then
        "$PYTHON" update_prices_from_report.py --collection "$COLLECTION" --dry-run
    else
        "$PYTHON" update_prices_from_report.py --collection "$COLLECTION"
    fi
)

echo ""
echo "=== [3/4] OG preview (site card + share pages: promo board or og-preview.jpg) ==="
(
    cd "$WWW_DIR"
    if $DRY_RUN; then
        echo "[dry-run] Skipped generate_og_preview.py"
    else
        "$PYTHON" generate_og_preview.py --skip-existing
    fi
)

if $DRY_RUN; then
    echo ""
    echo "[dry-run] Skipped writing gallery.json (with --dry-run in the sync) and git push."
    exit 0
fi

if $NO_PUSH; then
    echo ""
    echo "[--no-push] gallery.json updated locally. No commit/push."
    exit 0
fi

echo ""
echo "=== [4/4] Git commit + push (GitHub Pages) ==="
cd "$WWW_DIR"

if ! git rev-parse --git-dir >/dev/null 2>&1; then
    echo "Error: no git repository in $WWW_DIR" >&2
    echo "First run: see the local deploy notes (kept off this repo)." >&2
    exit 1
fi

if ! git remote get-url origin >/dev/null 2>&1; then
    echo "Error: no 'origin' remote. See the local deploy notes (kept off this repo)." >&2
    exit 1
fi

if git diff --quiet -- gallery.json assets/og-preview.jpg nft/ js/gallery.js data/promo_boards.json \
    && git diff --cached --quiet -- gallery.json assets/og-preview.jpg nft/ js/gallery.js data/promo_boards.json; then
    echo "No changes (gallery / landings) — skipping commit and push."
    exit 0
fi

git add gallery.json assets/og-preview.jpg nft/ js/gallery.js generate_og_preview.py data/promo_boards.json
if [[ -z "$COMMIT_MSG" ]]; then
    COMMIT_MSG="sync prices ($COLLECTION) $(date -u +%Y-%m-%dT%H:%MZ)"
fi
git commit -m "$COMMIT_MSG"
git push

echo ""
echo "Done. GitHub Pages refreshes in about 1–2 minutes."