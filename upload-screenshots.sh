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

# This endpoint only ever appends. Uploading a new set on top of an old one
# leaves the listing showing both, so check first and say so.
JWT=$(make_jwt)
EXISTING=$(curl -sS "$AMO_API/addons/addon/$AMO_ADDON_ID/previews/" \
  -H "Authorization: JWT $JWT" | jq -r '.results[]?.id // empty')
EXISTING_COUNT=$(echo "$EXISTING" | grep -c . || true)

if [[ "$EXISTING_COUNT" -gt 0 ]]; then
  if [[ "${1:-}" == "--replace" ]]; then
    log "Deleting $EXISTING_COUNT existing preview(s) before upload..."
    for ID in $EXISTING; do
      JWT=$(make_jwt)
      curl -sS -o /dev/null -X DELETE \
        "$AMO_API/addons/addon/$AMO_ADDON_ID/previews/$ID/" \
        -H "Authorization: JWT $JWT"
      log "  deleted preview $ID"
    done
  else
    fail "The listing already has $EXISTING_COUNT screenshot(s); uploading now
    would leave both sets on the page. Re-run as:

        ./upload-screenshots.sh --replace

    which deletes the existing previews first. That is not reversible."
  fi
fi

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
