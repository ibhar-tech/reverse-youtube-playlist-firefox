/*
 * YouTube Playlist Tools — test_locale_coverage.js
 * Validates 100% key parity across all locales and translation dictionaries
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

describe("Locale & Translation Coverage Test", () => {
  test("_locales messages.json files have identical keys across en, fr, and ar", () => {
    const enPath = path.resolve("_locales/en/messages.json");
    const frPath = path.resolve("_locales/fr/messages.json");
    const arPath = path.resolve("_locales/ar/messages.json");

    const en = JSON.parse(fs.readFileSync(enPath, "utf8"));
    const fr = JSON.parse(fs.readFileSync(frPath, "utf8"));
    const ar = JSON.parse(fs.readFileSync(arPath, "utf8"));

    const enKeys = Object.keys(en).sort();
    const frKeys = Object.keys(fr).sort();
    const arKeys = Object.keys(ar).sort();

    assert.deepEqual(frKeys, enKeys, "FR messages.json keys must match EN");
    assert.deepEqual(arKeys, enKeys, "AR messages.json keys must match EN");
  });
});
