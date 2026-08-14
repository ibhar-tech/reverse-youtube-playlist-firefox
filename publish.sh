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

[[ "$AMO_JWT_ISSUER" != "user:XXXXX:XX" ]] || {
  echo "❌  Replace the placeholder AMO_JWT_ISSUER in .env with your AMO API key."
  exit 1
}
[[ "$AMO_JWT_SECRET" != "your-long-api-secret-here" ]] || {
  echo "❌  Replace the placeholder AMO_JWT_SECRET in .env with your AMO API secret."
  exit 1
}

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
(cd "$SOURCE_DIR" && zip -r "$ZIP_PATH" manifest.json icons/ src/ _locales/ popup/ \
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

RELEASE_NOTES_EN="v${VERSION} adds six features:
• Sort dropdown — order a playlist by title, duration, channel, or watched state.
• Load All — resolves every item of a lazily-loaded long playlist in one click, so Reverse, Shuffle, Sort and Save act on the whole list.
• Watch-time pill — total, watched and remaining time, with 1.25x/1.5x/1.75x/2x estimates.
• Playlist overview pages (youtube.com/playlist?list=…) now get their own toolbar: Play Reverse, Play Shuffled, Save Snapshot.
• Local playlists — build a list of your own from any video you are watching, using the ＋ button under the player or the popup. It is stored only in your browser and plays from the extension's own sidebar.
• Move to Top / Move to Bottom buttons in Reorder mode.

Fixes: saved snapshots no longer inject rows into YouTube's sidebar (which corrupted reverse, reorder and the item count); playing a snapshot of a real playlist no longer shows a duplicate sidebar; overview-page actions load the full playlist before acting; playlist and search pages read correctly after YouTube's move to the new card layout."
RELEASE_NOTES_FR="La version ${VERSION} ajoute six fonctionnalités :
• Menu Trier — classez une playlist par titre, durée, chaîne ou état de visionnage.
• Tout charger — charge en un clic tous les éléments d'une longue playlist, pour qu'Inverser, Mélanger, Trier et Enregistrer portent sur la liste entière.
• Pastille de durée — temps total, vu et restant, avec estimations à 1,25x/1,5x/1,75x/2x.
• Les pages d'aperçu de playlist (youtube.com/playlist?list=…) ont leur propre barre d'outils : Lire à l'envers, Lire en aléatoire, Enregistrer un instantané.
• Playlists locales — composez votre propre liste à partir de n'importe quelle vidéo, via le bouton ＋ sous le lecteur ou la fenêtre de l'extension. Elle reste dans votre navigateur et se lit depuis la barre latérale de l'extension.
• Boutons Déplacer en haut / en bas dans le mode Réorganiser.

Corrections : les instantanés n'insèrent plus de lignes dans la barre latérale de YouTube (ce qui faussait l'inversion, la réorganisation et le décompte) ; lire l'instantané d'une vraie playlist n'affiche plus de barre latérale en double ; les actions de la page d'aperçu chargent la playlist complète avant d'agir ; les pages playlist et recherche sont lues correctement depuis le nouveau format de vignettes de YouTube."

VERSION_BODY=$(jq -n \
  --arg uuid "$UPLOAD_UUID" \
  --arg notes_en "$RELEASE_NOTES_EN" \
  --arg notes_fr "$RELEASE_NOTES_FR" \
  '{"upload": $uuid, "release_notes": {"en-US": $notes_en, "fr": $notes_fr}}')

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
log "Fetching enabled locales for the add-on..."
JWT=$(make_jwt)
ADDON_DETAILS=$(curl -sS \
  "$AMO_API/addons/addon/$AMO_ADDON_ID/" \
  -H "Authorization: JWT $JWT")

# Extract enabled locales (keys of name translation dictionary)
ENABLED_LOCALES=$(echo "$ADDON_DETAILS" | jq -r '.name | keys[]? // empty')
log "Enabled locales: $(echo "$ENABLED_LOCALES" | tr '\n' ' ')"

log "Updating listing name, summary, and description..."
JWT=$(make_jwt)

LONG_DESC_EN="🎬 REVERSE YouTube playlists — play oldest-first, newest-first, or any custom order.
🔀 SHUFFLE playlists with a persistent random order that survives in-app navigation.
⇅ SORT by title, duration, channel, or watched state — one click, seven presets.
↕️ DRAG & REORDER videos in the sidebar without touching YouTube's servers, with Move to Top / Move to Bottom shortcuts.
⚡ LOAD ALL items of a long playlist in one click, so reverse, shuffle, sort and save act on the complete list instead of only the visible rows.
⏱️ SEE THE WATCH TIME — total, already watched, and remaining, plus how long it takes at 1.25x, 1.5x, 1.75x and 2x.
📋 PLAYLIST OVERVIEW PAGES too — start a playlist in reverse or shuffled, or save a snapshot, straight from youtube.com/playlist.
➕ BUILD YOUR OWN LOCAL PLAYLISTS from any video you are watching. They live only in your browser and play from the extension's own sidebar, so they can hold anything — no YouTube playlist required.
💾 SAVE custom playlists locally — no Google login, no data sent anywhere.
📤 EXPORT & IMPORT your saved playlists as JSON backup files — your lists are permanent and portable across devices.
⏯️ RESUME WHERE YOU LEFT OFF — a one-click prompt jumps back to your last position in any playlist.
🔁 LOOP your custom play order endlessly with one setting.
✅ MARK videos as watched and see a ✓ badge automatically — tracking survives playlist edits.
⏭️ AUTO-SKIP already watched videos automatically to save time.
🌐 MULTI-LANGUAGE UI — switch dynamically between English, French, and Arabic (العربية) with full RTL support.
📐 COMPACT LAYOUT mode for a cleaner, distraction-free view.
🚀 LAUNCH FROM ANYWHERE — play your saved playlists directly from the browser popup on any website.

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

LONG_DESC_FR="🎬 INVERSEZ les playlists YouTube — lisez du plus ancien au plus récent, du plus récent au plus ancien, ou dans n'importe quel ordre personnalisé.
🔀 MÉLANGEZ les playlists avec un ordre aléatoire persistant qui survit à la navigation.
⇅ TRIEZ par titre, durée, chaîne ou état de visionnage — un clic, sept préréglages.
↕️ GLISSEZ & RÉORGANISEZ les vidéos dans la barre latérale sans toucher aux serveurs de YouTube, avec les raccourcis Déplacer en haut / en bas.
⚡ CHARGEZ TOUS les éléments d'une longue playlist en un clic, pour qu'inverser, mélanger, trier et enregistrer portent sur la liste complète et non sur les seules lignes visibles.
⏱️ VOYEZ LA DURÉE — temps total, déjà vu et restant, ainsi que la durée à 1,25x, 1,5x, 1,75x et 2x.
📋 AUSSI SUR LES PAGES D'APERÇU — lancez une playlist à l'envers ou en aléatoire, ou enregistrez un instantané, directement depuis youtube.com/playlist.
➕ COMPOSEZ VOS PROPRES PLAYLISTS LOCALES à partir de n'importe quelle vidéo que vous regardez. Elles restent dans votre navigateur et se lisent depuis la barre latérale de l'extension : elles peuvent donc contenir n'importe quoi, sans playlist YouTube.
💾 SAUVEGARDEZ des playlists personnalisées localement — pas de connexion Google, aucune donnée envoyée.
📤 EXPORTEZ & IMPORTEZ vos playlists sauvegardées en fichiers JSON — vos listes sont permanentes et portables entre appareils.
⏯️ REPRENEZ OÙ VOUS ÉTIEZ — une invite en un clic vous ramène à votre dernière position dans chaque playlist.
🔁 LISEZ EN BOUCLE votre ordre de lecture personnalisé avec une seule option.
✅ MARQUEZ les vidéos comme lues et voyez un badge ✓ s'afficher automatiquement — le suivi survit aux modifications de playlist.
⏭️ PASSEZ AUTOMATIQUEMENT les vidéos déjà vues pour gagner du temps.
🌐 INTERFACE MULTILINGUE — basculez dynamiquement entre l'anglais, le français et l'arabe (العربية) avec support RTL complet.
📐 MODE COMPACT pour une vue épurée et sans distraction.
🚀 LANCEZ DEPUIS N'IMPORTE OÙ — lancez vos playlists sauvegardées directement depuis le popup sur n'importe quel site.

✨ Entièrement gratuit. Zéro publicité. Zéro suivi. Open source.

--- COMMENT ÇA MARCHE ---
Tout s'exécute dans votre navigateur sous forme de script de contenu côté client. Nous ne nous connectons jamais à l'API de YouTube, ne lisons jamais votre compte Google et ne stockons rien en dehors de votre propre storage.local.

--- IDÉAL POUR ---
• Regarder une playlist de cours dans l'ordre chronologique de mise en ligne
• Regarder une série en continu du plus récent au plus ancien épisode
• Créer une séquence de visionnage personnalisée pour une playlist sélectionnée
• Reprendre exactement là où vous vous étiez arrêté dans une longue série éducative"

LONG_DESC_AR="🎬 اعكس قوائم تشغيل يوتيوب — شغّلها من الأقدم إلى الأحدث، أو من الأحدث إلى الأقدم، أو بأي ترتيب تختاره.
🔀 تشغيل عشوائي بترتيب ثابت لا يتغيّر أثناء التنقّل داخل الموقع.
⇅ الترتيب حسب العنوان أو المدة أو القناة أو حالة المشاهدة — بنقرة واحدة وسبعة خيارات جاهزة.
↕️ اسحب وأعد ترتيب الفيديوهات في الشريط الجانبي دون المساس بخوادم يوتيوب، مع اختصاري النقل إلى الأعلى وإلى الأسفل.
⚡ حمّل كل عناصر القائمة الطويلة بنقرة واحدة، ليعمل العكس والعشوائي والترتيب والحفظ على القائمة كاملة لا على الصفوف الظاهرة فقط.
⏱️ اطّلع على مدة المشاهدة — المدة الكلية والمُشاهَدة والمتبقّية، ومدّتها بسرعة ١٫٢٥x و١٫٥x و١٫٧٥x و٢x.
📋 وعلى صفحات عرض القوائم أيضًا — ابدأ التشغيل معكوسًا أو عشوائيًا، أو احفظ نسخة، مباشرةً من youtube.com/playlist.
➕ أنشئ قوائمك المحلية الخاصة من أي فيديو تشاهده. تبقى داخل متصفّحك وتُشغَّل من الشريط الجانبي للإضافة، فيمكنها أن تضمّ أي شيء دون الحاجة إلى قائمة تشغيل على يوتيوب.
💾 احفظ قوائمك المخصّصة محليًا — دون تسجيل دخول بحساب Google ودون إرسال أي بيانات.
📤 صدّر واستورد قوائمك المحفوظة كملفات JSON — قوائمك دائمة ويمكن نقلها بين الأجهزة.
⏯️ تابع من حيث توقّفت — تذكير بنقرة واحدة يعيدك إلى آخر موضع في أي قائمة.
🔁 كرّر ترتيب التشغيل المخصّص بلا نهاية بخيار واحد.
✅ علّم الفيديوهات المُشاهَدة وسترى شارة ✓ تلقائيًا — التتبّع يصمد أمام تعديلات القائمة.
⏭️ تخطَّ الفيديوهات المُشاهَدة تلقائيًا لتوفير الوقت.
🌐 واجهة متعدّدة اللغات — بدّل فوريًا بين الإنجليزية والفرنسية والعربية مع دعم كامل للاتجاه من اليمين إلى اليسار.
📐 وضع مضغوط لعرض أنظف وبلا تشتيت.
🚀 شغّلها من أي مكان — ابدأ قوائمك المحفوظة من نافذة الإضافة على أي موقع.

✨ مجانية بالكامل. بلا إعلانات. بلا تتبّع. مفتوحة المصدر.

--- كيف تعمل ---
كل شيء يجري داخل متصفّحك عبر برنامج نصي من جهة العميل. لا نتصل بواجهة يوتيوب البرمجية، ولا نقرأ حسابك على Google، ولا نخزّن أي شيء خارج storage.local الخاص بمتصفّحك.

--- مثالية لـ ---
• متابعة قائمة دورة تعليمية بترتيب النشر الزمني
• مشاهدة مسلسل متتاليًا من أحدث حلقة إلى أقدمها
• إنشاء تسلسل مشاهدة خاص بك لقائمة منتقاة
• استئناف المشاهدة تمامًا من حيث توقّفت في سلسلة تعليمية طويلة"

EXPORT_DESC_EN="$LONG_DESC_EN"
EXPORT_DESC_FR="$LONG_DESC_FR"
EXPORT_DESC_AR="$LONG_DESC_AR"

PATCH_PAYLOAD=$(export EXPORT_DESC_EN EXPORT_DESC_FR EXPORT_DESC_AR; python3 -c '
import os, sys, json
enabled_locales = sys.argv[1].split()
payload = {"name": {}, "summary": {}, "description": {}}

translations = {
  "en-US": {
    "name": "YT Playlist Tools — Reverse, Shuffle & Reorder",
    "summary": "Reverse, shuffle, sort and drag-reorder YouTube playlists. Load every item of a long list, see total and remaining watch time, build your own local playlists, and save, export and import custom orders. EN/FR/AR.",
    "desc": os.environ.get("EXPORT_DESC_EN", "")
  },
  "fr": {
    "name": "YT Playlist Tools — Reverse, Shuffle & Reorder",
    "summary": "Inversez, mélangez, triez et réorganisez vos playlists YouTube. Chargez une longue liste en entier, voyez la durée totale et restante, composez vos playlists locales, enregistrez et exportez vos ordres. EN/FR/AR.",
    "desc": os.environ.get("EXPORT_DESC_FR", "")
  },
  "ar": {
    "name": "أدوات قوائم يوتيوب — عكس وعشوائي وإعادة ترتيب",
    "summary": "اعكس قوائم تشغيل يوتيوب ورتّبها وشغّلها عشوائيًا وأعد ترتيبها بالسحب. حمّل القوائم الطويلة كاملة، واطّلع على المدة الكلية والمتبقّية، وأنشئ قوائمك المحلية، واحفظ ترتيبك وصدّره. بالعربية والإنجليزية والفرنسية.",
    "desc": os.environ.get("EXPORT_DESC_AR", "")
  }
}

for locale in enabled_locales:
  if locale in translations:
    payload["name"][locale] = translations[locale]["name"]
    payload["summary"][locale] = translations[locale]["summary"]
    payload["description"][locale] = translations[locale]["desc"]

print(json.dumps(payload))
' "$ENABLED_LOCALES")

PATCH_RESPONSE=$(curl -sS \
  -X PATCH "$AMO_API/addons/addon/$AMO_ADDON_ID/" \
  -H "Authorization: JWT $JWT" \
  -H "Content-Type: application/json" \
  -d "$PATCH_PAYLOAD")

echo "$PATCH_RESPONSE" | jq '{name, summary, detail} // .'
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
