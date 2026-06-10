#!/usr/bin/env bash
# =============================================================================
# publish.sh — YouTube Playlist Tools: Full AMO auto-publish script
#
# What it does (100% automated):
#   1. Lint the extension (web-ext lint)
#   2. Build a clean .zip
#   3. Generate a short-lived JWT from your AMO API key + secret
#   4. Upload the .zip to AMO via the /api/v5/addons/upload/ endpoint
#   5. Poll until AMO finishes processing the upload (gets a UUID)
#   6. Create a new version on your live listing via /api/v5/addons/<id>/versions/
#   7. PATCH the listing metadata (name, summary, description) via /api/v5/addons/<id>/
#   8. Print a link to the Developer Hub so you can watch review progress
#
# Prerequisites (install once):
#   sudo apt install jq      # JSON parser used throughout
#   npm install -g web-ext   # Mozilla's linting + packaging tool
#
# Usage:
#   1. Copy .env.example → .env  and fill in your credentials
#   2. chmod +x publish.sh
#   3. ./publish.sh
# =============================================================================

set -euo pipefail

# ── Load credentials from .env (never commit that file) ─────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌  .env file not found. Copy .env.example → .env and fill in your credentials."
  exit 1
fi

# shellcheck source=.env
source "$ENV_FILE"
export AMO_JWT_ISSUER AMO_JWT_SECRET AMO_ADDON_ID

# Validate required vars
: "${AMO_JWT_ISSUER:?  Set AMO_JWT_ISSUER in .env}"
: "${AMO_JWT_SECRET:?  Set AMO_JWT_SECRET in .env}"
: "${AMO_ADDON_ID:?    Set AMO_ADDON_ID in .env}"

# ── Config ───────────────────────────────────────────────────────────────────
ADDON_SLUG="reverse-playlist@benmoussa"
SOURCE_DIR="$SCRIPT_DIR"
VERSION=$(jq -r '.version' "$SOURCE_DIR/manifest.json")
ZIP_NAME="youtube-playlist-tools-v${VERSION}.zip"
ZIP_PATH="$SCRIPT_DIR/$ZIP_NAME"
AMO_API="https://addons.mozilla.org/api/v5"
JWT_HELPER="$SCRIPT_DIR/.jwt_helper.py"

# ── Helpers ───────────────────────────────────────────────────────────────────
log()  { echo "▶  $*"; }
ok()   { echo "✅  $*"; }
fail() { echo "❌  $*" >&2; exit 1; }

require_cmd() {
  command -v "$1" &>/dev/null || fail "'$1' is not installed. Run: $2"
}

# Write the JWT helper script once and reuse it — avoids heredoc-in-subshell issues.
write_jwt_helper() {
  cat > "$JWT_HELPER" << 'PYEOF'
import hmac as _hmac, hashlib, base64, json, time, os, secrets

key    = os.environ["AMO_JWT_ISSUER"]
secret = os.environ["AMO_JWT_SECRET"]
now    = int(time.time())

header  = base64.urlsafe_b64encode(
    json.dumps({"alg": "HS256", "typ": "JWT"}).encode()
).rstrip(b"=").decode()

payload = base64.urlsafe_b64encode(
    json.dumps({
        "iss": key,
        "jti": secrets.token_hex(16),
        "iat": now,
        "exp": now + 300,
    }).encode()
).rstrip(b"=").decode()

signing_input = f"{header}.{payload}".encode()
sig = _hmac.new(secret.encode(), signing_input, hashlib.sha256).digest()
sig_b64 = base64.urlsafe_b64encode(sig).rstrip(b"=").decode()

print(f"{header}.{payload}.{sig_b64}")
PYEOF
}

make_jwt() {
  python3 "$JWT_HELPER"
}

cleanup() {
  rm -f "$JWT_HELPER"
}
trap cleanup EXIT

# ── Dependency check ─────────────────────────────────────────────────────────
require_cmd jq       "sudo apt install jq"
require_cmd web-ext  "npm install -g web-ext"
require_cmd curl     "sudo apt install curl"
require_cmd python3  "sudo apt install python3"

write_jwt_helper

# ── Step 1: Lint ─────────────────────────────────────────────────────────────
log "Linting extension..."
web-ext lint --source-dir "$SOURCE_DIR" --no-input
ok "Lint passed"

# ── Step 2: Build zip ────────────────────────────────────────────────────────
log "Building $ZIP_NAME..."
rm -f "$ZIP_PATH"
(cd "$SOURCE_DIR" && zip -r "$ZIP_PATH" manifest.json icons/ src/ \
  --exclude "*.DS_Store" --exclude "*/.git/*")
ok "Built $ZIP_PATH ($(du -h "$ZIP_PATH" | cut -f1))"

# ── Step 3: Upload the zip ───────────────────────────────────────────────────
log "Uploading $ZIP_NAME to AMO..."
JWT=$(make_jwt)

UPLOAD_RESPONSE=$(curl -sS \
  -X POST "$AMO_API/addons/upload/" \
  -H "Authorization: JWT $JWT" \
  -F "upload=@${ZIP_PATH};type=application/zip" \
  -F "channel=listed")

echo "$UPLOAD_RESPONSE" | jq .

UPLOAD_UUID=$(echo "$UPLOAD_RESPONSE" | jq -r '.uuid // empty')
[[ -n "$UPLOAD_UUID" ]] || fail "Upload failed — no UUID returned. Response: $UPLOAD_RESPONSE"
ok "Upload accepted — UUID: $UPLOAD_UUID"

# ── Step 4: Poll until AMO validates the upload ──────────────────────────────
log "Waiting for AMO to validate the upload..."
POLL_URL="$AMO_API/addons/upload/$UPLOAD_UUID/"
PROCESSED="false"
for i in $(seq 1 24); do
  sleep 5
  JWT=$(make_jwt)
  POLL=$(curl -sS "$POLL_URL" -H "Authorization: JWT $JWT")
  PROCESSED=$(echo "$POLL" | jq -r '.processed // false')
  VALID=$(echo "$POLL"     | jq -r '.valid     // false')
  if [[ "$PROCESSED" == "true" ]]; then
    if [[ "$VALID" == "true" ]]; then
      ok "Upload validated by AMO"
      break
    else
      ERRORS=$(echo "$POLL" | jq -r '.validation.messages[]? | select(.type=="error") | .message')
      fail "AMO validation errors:\n$ERRORS"
    fi
  fi
  log "  Still processing... (attempt $i/24, ~$((i*5))s elapsed)"
done
[[ "$PROCESSED" == "true" ]] || fail "AMO did not finish processing after 120s. Check the Developer Hub."

# ── Step 5: Create a new version linked to the upload ───────────────────────
log "Creating version $VERSION on the listing..."
JWT=$(make_jwt)

RELEASE_NOTES="v${VERSION}: Shuffle mode, drag-to-reorder sidebar, save snapshots locally, watched badges, in-page panel. Full modular rewrite. 0 lint errors."

VERSION_BODY=$(jq -n \
  --arg uuid "$UPLOAD_UUID" \
  --arg notes "$RELEASE_NOTES" \
  '{"upload": $uuid, "release_notes": {"en-US": $notes}}')

VERSION_RESPONSE=$(curl -sS \
  -X POST "$AMO_API/addons/addon/$AMO_ADDON_ID/versions/" \
  -H "Authorization: JWT $JWT" \
  -H "Content-Type: application/json" \
  -d "$VERSION_BODY")

echo "$VERSION_RESPONSE" | jq .
VERSION_ID=$(echo "$VERSION_RESPONSE" | jq -r '.id // empty')
[[ -n "$VERSION_ID" ]] || fail "Version creation failed. Response: $VERSION_RESPONSE"
ok "Version $VERSION created (version id: $VERSION_ID)"

# ── Step 6: PATCH listing metadata ───────────────────────────────────────────
log "Updating listing name, summary, and description..."
JWT=$(make_jwt)

LONG_DESC="🎬 REVERSE YouTube playlists — play oldest-first, newest-first, or any custom order.
🔀 SHUFFLE playlists with a persistent random order that survives in-app navigation.
↕️ DRAG & REORDER videos in the sidebar without touching YouTube's servers.
💾 SAVE custom playlists locally — no Google login, no data sent anywhere.
✅ MARK videos as watched and see a ✓ badge automatically.

✨ Completely free. Zero ads. Zero tracking. Open source.

--- HOW IT WORKS ---
Everything runs in your browser as a client-side content script. We never
connect to YouTube's API, never read your Google account, and never store
anything outside your browser's own storage.local.

--- PERFECT FOR ---
• Watching a course playlist in chronological upload order
• Binge-watching a series from the newest episode to the oldest
• Creating a custom viewing sequence for a curated playlist
• Resuming exactly where you left off in a long educational series"

PATCH_PAYLOAD=$(jq -n \
  --arg name    "YouTube Playlist Tools — Reverse & Reorder" \
  --arg summary "Reverse, shuffle, drag-reorder, and save YouTube playlists locally. No login. No tracking." \
  --arg desc    "$LONG_DESC" \
  '{"name": {"en-US": $name}, "summary": {"en-US": $summary}, "description": {"en-US": $desc}}')

PATCH_RESPONSE=$(curl -sS \
  -X PATCH "$AMO_API/addons/addon/$AMO_ADDON_ID/" \
  -H "Authorization: JWT $JWT" \
  -H "Content-Type: application/json" \
  -d "$PATCH_PAYLOAD")

echo "$PATCH_RESPONSE" | jq '{name, summary} // .'
ok "Listing metadata updated"

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo "============================================================"
ok "v$VERSION submitted to AMO successfully!"
echo ""
echo "  Monitor review progress:"
echo "  https://addons.mozilla.org/developers/addon/$ADDON_SLUG/versions/"
echo ""
echo "  Typical review time: automated review in minutes,"
echo "  human review within 1–3 days."
echo "============================================================"
