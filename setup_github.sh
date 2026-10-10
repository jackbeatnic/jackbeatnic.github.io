#!/usr/bin/env bash
# First-time hookup of the gallery to GitHub Pages (LOGIN.github.io).
# Run after logging in: gh auth login
#
#   ./setup_github.sh YOUR-LOGIN
#
# Example:
#   ./setup_github.sh JackBeatnic

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

LOGIN="${1:-}"
if [[ -z "$LOGIN" ]]; then
    echo "Usage: ./setup_github.sh YOUR-GITHUB-LOGIN" >&2
    echo "Example: ./setup_github.sh JackBeatnic" >&2
    exit 1
fi

REPO_NAME="${LOGIN}.github.io"
REMOTE="https://github.com/${LOGIN}/${REPO_NAME}.git"

if ! command -v gh >/dev/null 2>&1; then
    echo "gh (GitHub CLI) not found. Install it: sudo apt install gh" >&2
    exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
    echo "You are not logged in to GitHub."
    echo "Run in a terminal (interactively):"
    echo "  gh auth login"
    echo ""
    echo "Choose:"
    echo "  • GitHub.com"
    echo "  • HTTPS"
    echo "  • Login with a web browser"
    echo "  • Copy the code, paste it in the browser, confirm"
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
    echo "Set git identity: $(git config user.name) <$(git config user.email)>"
fi

echo "=== [1/4] Local repository ==="
if [[ ! -d .git ]]; then
    git init
    git branch -M main
fi

if ! git rev-parse HEAD >/dev/null 2>&1; then
    git add .
    git commit -m "Jack Beatnic Gallery — initial deploy"
else
    echo "Commit already exists — skipping."
fi

echo ""
echo "=== [2/4] GitHub repository: $REPO_NAME ==="
if gh repo view "$LOGIN/$REPO_NAME" >/dev/null 2>&1; then
    echo "Repo already exists — OK."
else
    gh repo create "$REPO_NAME" --public --description "Jack Beatnic Gallery"
    echo "Created: https://github.com/$LOGIN/$REPO_NAME"
fi

echo ""
echo "=== [3/4] Push code ==="
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
    || echo "Pages: enable manually in Settings → Pages → main / (root) — one time."

echo ""
echo "Done."
echo "  Repo:  https://github.com/$LOGIN/$REPO_NAME"
echo "  Site (in 1–2 min): https://${LOGIN,,}.github.io/"
echo ""
echo "Day to day (prices):"
echo "  export OPENSEA_API_KEY=\"...\""
echo "  ./refresh_and_push.sh"