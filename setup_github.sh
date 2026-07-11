#!/usr/bin/env bash
# Pierwsze podpięcie galerii pod GitHub Pages (LOGIN.github.io).
# Uruchom po zalogowaniu: gh auth login
#
#   cd /home/jb/jb_nft/www
#   ./setup_github.sh TWOJ-LOGIN
#
# Przykład:
#   ./setup_github.sh JackBeatnic

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

LOGIN="${1:-}"
if [[ -z "$LOGIN" ]]; then
    echo "Użycie: ./setup_github.sh TWOJ-LOGIN-GITHUB" >&2
    echo "Przykład: ./setup_github.sh JackBeatnic" >&2
    exit 1
fi

REPO_NAME="${LOGIN}.github.io"
REMOTE="https://github.com/${LOGIN}/${REPO_NAME}.git"

if ! command -v gh >/dev/null 2>&1; then
    echo "Brak gh (GitHub CLI). Zainstaluj: sudo apt install gh" >&2
    exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
    echo "Nie jesteś zalogowany do GitHub."
    echo "Uruchom w terminalu (interaktywnie):"
    echo "  gh auth login"
    echo ""
    echo "Wybierz:"
    echo "  • GitHub.com"
    echo "  • HTTPS"
    echo "  • Login with a web browser"
    echo "  • Skopiuj kod, wklej w przeglądarce, zatwierdź"
    exit 1
fi

if [[ -z "$(git config user.email 2>/dev/null || true)" ]]; then
    GIT_EMAIL="$(gh api user --jq .email 2>/dev/null || true)"
    GIT_NAME="$(gh api user --jq .name 2>/dev/null || true)"
    [[ -z "$GIT_NAME" || "$GIT_NAME" == "null" ]] && GIT_NAME="$LOGIN"
    if [[ -n "$GIT_EMAIL" && "$GIT_EMAIL" != "null" ]]; then
        git config user.email "$GIT_EMAIL"
    else
        git config user.email "${LOGIN}@users.noreply.github.com"
    fi
    git config user.name "$GIT_NAME"
    echo "Ustawiono git: $(git config user.name) <$(git config user.email)>"
fi

echo "=== [1/4] Repozytorium lokalne ==="
if [[ ! -d .git ]]; then
    git init
    git branch -M main
fi

if ! git rev-parse HEAD >/dev/null 2>&1; then
    git add .
    git commit -m "Jack Beatnic Gallery — initial deploy"
else
    echo "Commit już istnieje — pomijam."
fi

echo ""
echo "=== [2/4] Repozytorium na GitHub: $REPO_NAME ==="
if gh repo view "$LOGIN/$REPO_NAME" >/dev/null 2>&1; then
    echo "Repo już istnieje — OK."
else
    gh repo create "$REPO_NAME" --public --description "Jack Beatnic Gallery"
    echo "Utworzono: https://github.com/$LOGIN/$REPO_NAME"
fi

echo ""
echo "=== [3/4] Push kodu ==="
if git remote get-url origin >/dev/null 2>&1; then
    git remote set-url origin "$REMOTE"
else
    git remote add origin "$REMOTE"
fi
git push -u origin main

echo ""
echo "=== [4/4] GitHub Pages ==="
gh api -X POST "repos/${LOGIN}/${REPO_NAME}/pages" \
    -f build_type=legacy \
    -f source[branch]=main \
    -f source[path]=/ 2>/dev/null \
    || gh api -X PUT "repos/${LOGIN}/${REPO_NAME}/pages" \
        -f build_type=legacy \
        -f source[branch]=main \
        -f source[path]=/ 2>/dev/null \
    || echo "Pages: włącz ręcznie w Settings → Pages → main / (root) — jednorazowo."

echo ""
echo "Gotowe."
echo "  Repo:  https://github.com/$LOGIN/$REPO_NAME"
echo "  Strona (za 1–2 min): https://${LOGIN,,}.github.io/"
echo ""
echo "Na co dzień (ceny):"
echo "  export OPENSEA_API_KEY=\"...\""
echo "  ./odswiez_i_wgraj.sh"