#!/usr/bin/env bash
# =============================================================================
# publish-chrome.sh — YouTube Playlist Tools: Full Chrome Web Store auto-publish script
#
# What it does (100% automated):
#   1. Runs ./build-chrome.sh to generate the clean MV3 ZIP
#   2. Exchanges Google OAuth2 Refresh Token for a short-lived Access Token
#   3. Uploads the .zip package to Chrome Web Store API
#   4. Triggers publishing / submission for review
#
# Prerequisites (install once):
#   sudo apt install jq curl
#
# Usage:
#   1. Copy .env.example → .env and fill in your Chrome API credentials
#   2. chmod +x publish-chrome.sh
#   3. ./publish-chrome.sh
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌  .env file not found. Copy .env.example → .env and fill in your credentials."
  exit 1
fi

# shellcheck source=.env
source "$ENV_FILE"

# Validate required environment variables
: "${CHROME_CLIENT_ID:?     Set CHROME_CLIENT_ID in .env}"
: "${CHROME_CLIENT_SECRET:? Set CHROME_CLIENT_SECRET in .env}"
: "${CHROME_REFRESH_TOKEN:? Set CHROME_REFRESH_TOKEN in .env}"
: "${CHROME_ITEM_ID:?       Set CHROME_ITEM_ID in .env}"

log()  { echo "▶  $*"; }
ok()   { echo "✅  $*"; }
fail() { echo "❌  $*" >&2; exit 1; }

# 1. Build Chrome extension package
log "Building Chrome extension package..."
"$SCRIPT_DIR/build-chrome.sh"

VERSION=$(jq -r '.version' "$SCRIPT_DIR/manifest.json")
ZIP_PATH="$SCRIPT_DIR/youtube-playlist-tools-chrome-v${VERSION}.zip"

if [[ ! -f "$ZIP_PATH" ]]; then
  fail "Build file not found at $ZIP_PATH"
fi

# 2. Retrieve Access Token via OAuth2 Refresh Token
log "Fetching Google OAuth2 Access Token..."
TOKEN_RESPONSE=$(curl -s -X POST "https://oauth2.googleapis.com/token" \
  -d "client_id=${CHROME_CLIENT_ID}" \
  -d "client_secret=${CHROME_CLIENT_SECRET}" \
  -d "refresh_token=${CHROME_REFRESH_TOKEN}" \
  -d "grant_type=refresh_token")

ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.access_token // empty')

if [[ -z "$ACCESS_TOKEN" ]]; then
  ERR_MSG=$(echo "$TOKEN_RESPONSE" | jq -r '.error_description // .error // "Unknown error"')
  fail "Failed to retrieve Access Token: $ERR_MSG"
fi

ok "Access Token acquired."

# 3. Upload package to Chrome Web Store API
log "Uploading $ZIP_PATH to Chrome Web Store (Item ID: $CHROME_ITEM_ID)..."
UPLOAD_RESPONSE=$(curl -s -X PUT \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "x-goog-api-version: 2" \
  --data-binary "@$ZIP_PATH" \
  "https://www.googleapis.com/upload/chromewebstore/v1.1/items/${CHROME_ITEM_ID}")

UPLOAD_STATE=$(echo "$UPLOAD_RESPONSE" | jq -r '.uploadState // empty')

if [[ "$UPLOAD_STATE" != "SUCCESS" ]]; then
  echo "$UPLOAD_RESPONSE" | jq . >&2
  fail "Upload failed."
fi

ok "Package uploaded successfully!"

# 4. Trigger Publish / Review submission
log "Submitting update for review on Chrome Web Store..."
PUBLISH_RESPONSE=$(curl -s -X POST \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "x-goog-api-version: 2" \
  -H "Content-Length: 0" \
  "https://www.googleapis.com/chromewebstore/v1.1/items/${CHROME_ITEM_ID}/publish")

STATUS=$(echo "$PUBLISH_RESPONSE" | jq -r '.status[0] // empty')

if [[ "$STATUS" == "OK" ]]; then
  ok "Submitted for review successfully! Check status on Chrome Developer Dashboard."
else
  echo "$PUBLISH_RESPONSE" | jq . >&2
  fail "Publish command returned an error state."
fi
