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

# Validate required vars
: "${AMO_JWT_ISSUER:?  Set AMO_JWT_ISSUER in .env (your API Key from AMO developer hub)}"
: "${AMO_JWT_SECRET:?  Set AMO_JWT_SECRET in .env (your API Secret from AMO developer hub)}"
: "${AMO_ADDON_ID:?    Set AMO_ADDON_ID in .env (the extension's UUID or slug, e.g. reverse-playlist@benmoussa)}"

# ── Config (edit if you change filenames) ───────────────────────────────────
ADDON_SLUG="reverse-playlist@benmoussa"    # same as gecko.id in manifest.json
SOURCE_DIR="$SCRIPT_DIR"
VERSION=$(jq -r '.version' "$SOURCE_DIR/manifest.json")
ZIP_NAME="youtube-playlist-tools-v${VERSION}.zip"
ZIP_PATH="$SCRIPT_DIR/$ZIP_NAME"
AMO_API="https://addons.mozilla.org/api/v5"

# Long description sent to AMO (update here whenever you change it)
read -r -d '' LONG_DESCRIPTION << 'EOF' || true
🎬 REVERSE YouTube playlists — play oldest-first, newest-first, or any custom order.
🔀 SHUFFLE playlists with a persistent random order that survives in-app navigation.
↕️ DRAG &amp; REORDER videos in the sidebar without touching YouTube's servers.
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
• Resuming exactly where you left off in a long educational series
EOF

# ── Helpers ──────────────────────────────────────────────────────────────────

log()  { echo "▶  $*"; }
ok()   { echo "✅  $*"; }
fail() { echo "❌  $*" >&2; exit 1; }

require_cmd() {
  command -v "$1" &>/dev/null || fail "'$1' is not installed. Run: $2"
}

# ── Dependency check ─────────────────────────────────────────────────────────
require_cmd jq       "sudo apt install jq"
require_cmd web-ext  "npm install -g web-ext"
require_cmd curl     "sudo apt install curl"
require_cmd python3  "sudo apt install python3"

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

# ── Step 3: Generate JWT ─────────────────────────────────────────────────────
# AMO uses HS256-signed JWTs. We generate one in pure Python (no extra libs).
log "Generating AMO JWT..."

JWT=$(python3 - <<PYEOF
import hmac, hashlib, base64, json, time, os, secrets

key    = os.environ["AMO_JWT_ISSUER"]
secret = os.environ["AMO_JWT_SECRET"]
now    = int(time.time())

header  = base64.urlsafe_b64encode(json.dumps({"alg":"HS256","typ":"JWT"}).encode()).rstrip(b"=").decode()
payload = base64.urlsafe_b64encode(json.dumps({
    "iss": key,
    "jti": secrets.token_hex(16),
    "iat": now,
    "exp": now + 300   # 5-minute window is plenty
}).encode()).rstrip(b"=").decode()

signing_input = f"{header}.{payload}".encode()
sig = hmac.new(secret.encode(), signing_input, hashlib.sha256).digest()
sig_b64 = base64.urlsafe_b64encode(sig).rstrip(b"=").decode()

print(f"{header}.{payload}.{sig_b64}")
PYEOF
)

ok "JWT generated"

# ── Step 4: Upload the zip ───────────────────────────────────────────────────
log "Uploading $ZIP_NAME to AMO..."

UPLOAD_RESPONSE=$(curl -sS \
  -X POST "$AMO_API/addons/upload/" \
  -H "Authorization: JWT $JWT" \
  -F "upload=@${ZIP_PATH};type=application/zip" \
  -F "channel=listed")

echo "$UPLOAD_RESPONSE" | jq .

UPLOAD_UUID=$(echo "$UPLOAD_RESPONSE" | jq -r '.uuid // empty')
[[ -n "$UPLOAD_UUID" ]] || fail "Upload failed — no UUID returned. Response: $UPLOAD_RESPONSE"
ok "Upload accepted — UUID: $UPLOAD_UUID"

# ── Step 5: Poll until AMO processes the upload ──────────────────────────────
log "Waiting for AMO to validate the upload..."
POLL_URL="$AMO_API/addons/upload/$UPLOAD_UUID/"
for i in $(seq 1 20); do
  sleep 5
  POLL=$(curl -sS "$POLL_URL" -H "Authorization: JWT $JWT")
  PROCESSED=$(echo "$POLL" | jq -r '.processed // false')
  VALID=$(echo "$POLL"     | jq -r '.valid     // false')
  if [[ "$PROCESSED" == "true" ]]; then
    if [[ "$VALID" == "true" ]]; then
      ok "Upload validated"
      break
    else
      ERRORS=$(echo "$POLL" | jq -r '.validation.messages[]? | select(.type=="error") | .message')
      fail "AMO validation errors:\n$ERRORS"
    fi
  fi
  log "  Still processing... (attempt $i/20)"
done
[[ "$PROCESSED" == "true" ]] || fail "AMO did not finish processing after 100s. Check the Developer Hub."

# ── Step 6: Create a new version linked to the upload ───────────────────────
log "Creating version $VERSION on the listing..."

# Re-generate JWT (previous one may have aged during polling)
JWT=$(python3 - <<PYEOF
import hmac, hashlib, base64, json, time, os, secrets
key    = os.environ["AMO_JWT_ISSUER"]
secret = os.environ["AMO_JWT_SECRET"]
now    = int(time.time())
header  = base64.urlsafe_b64encode(json.dumps({"alg":"HS256","typ":"JWT"}).encode()).rstrip(b"=").decode()
payload = base64.urlsafe_b64encode(json.dumps({"iss":key,"jti":secrets.token_hex(16),"iat":now,"exp":now+300}).encode()).rstrip(b"=").decode()
sig = hmac.new(secret.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest()
print(f"{header}.{payload}.{base64.urlsafe_b64encode(sig).rstrip(b'=').decode()}")
PYEOF
)

VERSION_RESPONSE=$(curl -sS \
  -X POST "$AMO_API/addons/addon/$AMO_ADDON_ID/versions/" \
  -H "Authorization: JWT $JWT" \
  -H "Content-Type: application/json" \
  -d "{
    \"upload\": \"$UPLOAD_UUID\",
    \"release_notes\": {
      \"en-US\": \"v$VERSION: Shuffle mode, drag-to-reorder, save snapshots, watched badges, in-page panel. Full modular rewrite. 0 lint errors.\"
    }
  }")

echo "$VERSION_RESPONSE" | jq .
VERSION_ID=$(echo "$VERSION_RESPONSE" | jq -r '.id // empty')
[[ -n "$VERSION_ID" ]] || fail "Version creation failed. Response: $VERSION_RESPONSE"
ok "Version $VERSION created (id: $VERSION_ID)"

# ── Step 7: Patch listing metadata (name, summary, description) ──────────────
log "Updating listing metadata..."

JWT=$(python3 - <<PYEOF
import hmac, hashlib, base64, json, time, os, secrets
key    = os.environ["AMO_JWT_ISSUER"]
secret = os.environ["AMO_JWT_SECRET"]
now    = int(time.time())
header  = base64.urlsafe_b64encode(json.dumps({"alg":"HS256","typ":"JWT"}).encode()).rstrip(b"=").decode()
payload = base64.urlsafe_b64encode(json.dumps({"iss":key,"jti":secrets.token_hex(16),"iat":now,"exp":now+300}).encode()).rstrip(b"=").decode()
sig = hmac.new(secret.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest()
print(f"{header}.{payload}.{base64.urlsafe_b64encode(sig).rstrip(b'=').decode()}")
PYEOF
)

PATCH_PAYLOAD=$(jq -n \
  --arg name "YouTube Playlist Tools — Reverse & Reorder" \
  --arg summary "Reverse, shuffle, drag-reorder, and save YouTube playlists locally. No login. No tracking." \
  --arg desc "$LONG_DESCRIPTION" \
  '{
    "name":    {"en-US": $name},
    "summary": {"en-US": $summary},
    "description": {"en-US": $desc}
  }')

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
ok "v$VERSION submitted to AMO!"
echo ""
echo "  Monitor review progress:"
echo "  https://addons.mozilla.org/developers/addon/$ADDON_SLUG/versions/"
echo ""
echo "  Typical review time: automated (minutes) + human (1–3 days)"
echo "============================================================"
