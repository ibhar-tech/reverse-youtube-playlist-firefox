#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION=$(jq -r '.version' "$SCRIPT_DIR/manifest.json")
ZIP_NAME="youtube-playlist-tools-chrome-v${VERSION}.zip"
ZIP_PATH="$SCRIPT_DIR/$ZIP_NAME"
BUILD_DIR="$SCRIPT_DIR/build_temp_chrome"

echo "▶  Building $ZIP_NAME for Chrome Web Store..."

# Cleanup old build
rm -rf "$BUILD_DIR"
rm -f "$ZIP_PATH"
mkdir -p "$BUILD_DIR"

# Copy files
cp -r "$SCRIPT_DIR/src" "$BUILD_DIR/src"
cp -r "$SCRIPT_DIR/popup" "$BUILD_DIR/popup"
cp -r "$SCRIPT_DIR/icons" "$BUILD_DIR/icons"
cp -r "$SCRIPT_DIR/_locales" "$BUILD_DIR/_locales"

# Process manifest (remove browser_specific_settings for Chrome)
jq 'del(.browser_specific_settings)' "$SCRIPT_DIR/manifest.json" > "$BUILD_DIR/manifest.json"

# Create zip
cd "$BUILD_DIR"
zip -r "$ZIP_PATH" manifest.json icons/ src/ _locales/ popup/ \
  --exclude "*.DS_Store" --exclude "*/.git/*"

cd "$SCRIPT_DIR"
rm -rf "$BUILD_DIR"

echo "✅  Built $ZIP_PATH ($(du -h "$ZIP_PATH" | cut -f1))"
echo "You can now upload this zip file to the Chrome Web Store Developer Console."
