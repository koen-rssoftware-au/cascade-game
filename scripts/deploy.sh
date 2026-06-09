#!/usr/bin/env bash
# Build and publish dist/ to the gh-pages branch (GitHub Pages).
# Usage: bash scripts/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."

GIT_BIN="${GIT_BIN:-git}"

npm test
npm run build

REMOTE_URL="$($GIT_BIN remote get-url origin)"
SHA="$($GIT_BIN rev-parse --short HEAD)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cp -R dist/. "$TMP/"
touch "$TMP/.nojekyll"
cd "$TMP"
"$GIT_BIN" init -q -b gh-pages
"$GIT_BIN" add -A
"$GIT_BIN" -c user.email="koen@rssoftware.com.au" -c user.name="Koen" commit -q -m "deploy: $SHA"
"$GIT_BIN" push -f "$REMOTE_URL" gh-pages:gh-pages
echo "deployed $SHA to gh-pages"
