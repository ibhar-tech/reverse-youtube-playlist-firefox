/*
 * YouTube Playlist Tools — test_translations.js
 *
 * The _locales files only carry the extension name/description. Every visible
 * string lives in the in-code TRANSLATIONS dictionaries, three per file, and
 * adding a feature means touching all three by hand — this is where key drift
 * actually happens.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const FILES = ["src/panel.js", "src/toolbar.js", "popup/popup.js"];
const LANGS = ["en", "fr", "ar"];

/** Pull the TRANSLATIONS object literal out of a source file and evaluate it. */
function extractTranslations(file) {
  const source = fs.readFileSync(file, "utf8");
  const marker = "const TRANSLATIONS = ";
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${file} must declare a TRANSLATIONS dictionary`);

  const open = source.indexOf("{", start);
  let depth = 0;
  let end = -1;
  let inString = null;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") inString = ch;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      end = i + 1;
      break;
    }
  }
  assert.notEqual(end, -1, `${file}: unbalanced TRANSLATIONS literal`);
  return new Function(`return ${source.slice(open, end)};`)();
}

describe("In-code TRANSLATIONS parity", () => {
  for (const file of FILES) {
    test(`${file} defines the same keys for en, fr and ar`, () => {
      const dicts = extractTranslations(file);
      for (const lang of LANGS) {
        assert.ok(dicts[lang], `${file} is missing the "${lang}" dictionary`);
      }

      const enKeys = Object.keys(dicts.en).sort();
      assert.ok(enKeys.length > 0, `${file}: en dictionary is empty`);

      for (const lang of LANGS.filter((l) => l !== "en")) {
        const keys = Object.keys(dicts[lang]).sort();
        const missing = enKeys.filter((k) => !keys.includes(k));
        const extra = keys.filter((k) => !enKeys.includes(k));
        assert.deepEqual(
          { missing, extra },
          { missing: [], extra: [] },
          `${file}: "${lang}" is out of sync with "en"`
        );
      }
    });

    test(`${file} has no blank translations`, () => {
      const dicts = extractTranslations(file);
      for (const lang of LANGS) {
        for (const [key, value] of Object.entries(dicts[lang])) {
          assert.equal(typeof value, "string", `${file} ${lang}.${key} must be a string`);
          assert.ok(value.trim().length > 0, `${file} ${lang}.${key} is empty`);
        }
      }
    });
  }
});
