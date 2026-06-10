#!/usr/bin/env bash
# =============================================================================
# upload-screenshots.sh — Upload AMO store screenshots via API
#
# Uploads all PNGs from store/ as previews on your AMO listing.
# Run this separately from publish.sh (screenshots rarely change).
#
# Usage:
#   chmod +x upload-screenshots.sh
#   ./upload-screenshots.sh
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/.env"
export AMO_JWT_ISSUER AMO_JWT_SECRET AMO_ADDON_ID

AMO_API="https://addons.mozilla.org/api/v5"
STORE_DIR="$SCRIPT_DIR/store"
JWT_HELPER="$SCRIPT_DIR/.jwt_helper.py"

log()  { echo "▶  $*"; }
ok()   { echo "✅  $*"; }
fail() { echo "❌  $*" >&2; exit 1; }

# Write JWT helper
cat > "$JWT_HELPER" << 'PYEOF'
import hmac as _hmac, hashlib, base64, json, time, os, secrets
key    = os.environ["AMO_JWT_ISSUER"]
secret = os.environ["AMO_JWT_SECRET"]
now    = int(time.time())
header  = base64.urlsafe_b64encode(json.dumps({"alg":"HS256","typ":"JWT"}).encode()).rstrip(b"=").decode()
payload = base64.urlsafe_b64encode(json.dumps({"iss":key,"jti":secrets.token_hex(16),"iat":now,"exp":now+300}).encode()).rstrip(b"=").decode()
sig = _hmac.new(secret.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest()
print(f"{header}.{payload}.{base64.urlsafe_b64encode(sig).rstrip(b'=').decode()}")
PYEOF

cleanup() { rm -f "$JWT_HELPER"; }
trap cleanup EXIT

make_jwt() { python3 "$JWT_HELPER"; }

[[ -d "$STORE_DIR" ]] || fail "store/ directory not found. Create it and add PNG screenshots."

SCREENSHOTS=("$STORE_DIR"/screenshot-*.png)
[[ ${#SCREENSHOTS[@]} -gt 0 ]] || fail "No screenshot-*.png files found in store/"

log "Uploading ${#SCREENSHOTS[@]} screenshot(s) to AMO listing..."

POSITION=1
for IMG in "${SCREENSHOTS[@]}"; do
  FILENAME=$(basename "$IMG")
  JWT=$(make_jwt)

  log "  Uploading $FILENAME (position $POSITION)..."

  RESPONSE=$(curl -sS \
    -X POST "$AMO_API/addons/addon/$AMO_ADDON_ID/previews/" \
    -H "Authorization: JWT $JWT" \
    -F "image=@${IMG};type=image/png" \
    -F "position=$POSITION")

  PREVIEW_ID=$(echo "$RESPONSE" | jq -r '.id // empty')
  if [[ -n "$PREVIEW_ID" ]]; then
    ok "  Uploaded → preview id: $PREVIEW_ID"
  else
    echo "$RESPONSE" | jq .
    fail "Failed to upload $FILENAME"
  fi

  POSITION=$((POSITION + 1))
  sleep 1  # be polite to the API
done

echo ""
ok "All screenshots uploaded!"
echo "  View on AMO: https://addons.mozilla.org/developers/addon/$AMO_ADDON_ID/edit#screenshots"
