/*
 * YouTube Playlist Tools — test_backup.js
 * Unit tests for Backup module (validation, tag normalization, merge logic)
 */
import "./setup.js";
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

describe("Backup Module — Unit Tests", async () => {
  before(async () => {
    await import("../src/backup.js");
  });

  test("normalizeTags formats, deduplicates and trims tags", () => {
    const { Backup } = window.RYP;
    assert.deepEqual(Backup.normalizeTags("coding, tutorials, #coding, study"), ["coding", "tutorials", "study"]);
    assert.deepEqual(Backup.normalizeTags(["music", "lofi", "music"]), ["music", "lofi"]);
    assert.deepEqual(Backup.normalizeTags(""), []);
    assert.deepEqual(Backup.normalizeTags(null), []);
  });

  test("isValidSnapshot validates well-formed playlist snapshots", () => {
    const { Backup } = window.RYP;

    const validSnapshot = {
      id: "snap-123",
      name: "My Custom Playlist",
      tags: ["study"],
      sourceListId: "PL1234567890abcdef",
      order: [1, 2],
      videos: [
        { index: 1, videoId: "abc123XYZ01", title: "Video 1" },
        { index: 2, videoId: "abc123XYZ02", title: "Video 2" },
      ],
      savedAt: "2026-08-14T00:00:00.000Z"
    };
    assert.equal(Backup.isValidSnapshot(validSnapshot), true);

    // Custom sourceListId is valid
    assert.equal(Backup.isValidSnapshot({ ...validSnapshot, sourceListId: "custom" }), true);

    // Invalid snapshot (empty order)
    assert.equal(Backup.isValidSnapshot({ ...validSnapshot, order: [] }), false);

    // Invalid snapshot (missing name)
    assert.equal(Backup.isValidSnapshot({ ...validSnapshot, name: "  " }), false);
  });

  test("mergeSnapshots handles deduplication and ID collisions", () => {
    const { Backup } = window.RYP;

    const existing = [
      {
        id: "id-1",
        name: "Existing List",
        tags: ["tag1"],
        sourceListId: "PL1",
        order: [1],
        videos: [{ index: 1, videoId: "v1", title: "Video 1" }],
        savedAt: "2026-01-01T00:00:00.000Z"
      }
    ];

    const incoming = [
      // Duplicate of existing
      {
        id: "id-1",
        name: "Existing List",
        tags: ["tag1"],
        sourceListId: "PL1",
        order: [1],
        videos: [{ index: 1, videoId: "v1", title: "Video 1" }],
        savedAt: "2026-01-01T00:00:00.000Z"
      },
      // New distinct snapshot
      {
        id: "id-2",
        name: "Brand New List",
        tags: ["tag2"],
        sourceListId: "PL2",
        order: [1],
        videos: [{ index: 1, videoId: "v2", title: "Video 2" }],
        savedAt: "2026-02-01T00:00:00.000Z"
      }
    ];

    const { merged, added, skipped } = Backup.mergeSnapshots(existing, incoming);
    assert.equal(added, 1);
    assert.equal(skipped, 1);
    assert.equal(merged.length, 2);
    assert.equal(merged[1].name, "Brand New List");
  });

  test("normalizeSettings sanitizes and validates settings object", () => {
    const { Backup } = window.RYP;

    assert.equal(Backup.normalizeSettings(null), null);
    assert.equal(Backup.normalizeSettings("string"), null);
    assert.equal(Backup.normalizeSettings({}), null);

    const valid = {
      lang: "fr",
      showBadges: false,
      resumePrompt: true,
      compact: true,
      loop: true,
      disableAutoplay: true,
      buttonVisibility: {
        reverse: false,
        shuffle: true,
        invalidKey: true,
      },
    };

    const norm = Backup.normalizeSettings(valid);
    assert.equal(norm.lang, "fr");
    assert.equal(norm.showBadges, false);
    assert.equal(norm.compact, true);
    assert.equal(norm.loop, true);
    // The keys the popup actually writes — a legacy/misspelt key must not leak through.
    assert.equal(Backup.normalizeSettings({ showWatchedBadges: true, compactMode: true }), null);
    assert.equal(norm.disableAutoplay, true);
    assert.equal(norm.buttonVisibility.reverse, false);
    assert.equal(norm.buttonVisibility.shuffle, true);
    assert.equal("invalidKey" in norm.buttonVisibility, false);

    // Invalid language is ignored
    const badLang = Backup.normalizeSettings({ lang: "es" });
    assert.equal(badLang, null);
  });

  test("mergeSettings cleanly merges incoming settings into base", () => {
    const { Backup } = window.RYP;

    const base = {
      lang: "en",
      disableAutoplay: false,
      buttonVisibility: {
        reverse: true,
        shuffle: true,
        sort: true,
      },
    };

    const incoming = {
      disableAutoplay: true,
      buttonVisibility: {
        reverse: false,
      },
    };

    const merged = Backup.mergeSettings(base, incoming);
    assert.equal(merged.lang, "en");
    assert.equal(merged.disableAutoplay, true);
    assert.equal(merged.buttonVisibility.reverse, false);
    assert.equal(merged.buttonVisibility.shuffle, true);
    assert.equal(merged.buttonVisibility.sort, true);
  });

  test("parseBackup and parseImport handle both legacy and settings-bearing backups", () => {
    const { Backup } = window.RYP;

    const sampleSnapshot = {
      id: "snap-1",
      name: "List 1",
      tags: ["dev"],
      sourceListId: "PLabc123",
      order: [1],
      videos: [{ index: 1, videoId: "video12345", title: "V1" }],
      savedAt: "2026-01-01T00:00:00.000Z",
    };

    // 1. Legacy v1 array
    const legacyJson = JSON.stringify([sampleSnapshot]);
    const parsedLegacy = Backup.parseImport(legacyJson);
    assert.equal(parsedLegacy.length, 1);
    assert.equal(parsedLegacy.settings, null);

    // 2. v2 with playlists and settings
    const v2Payload = {
      schema: "ryp-saved-playlists",
      schemaVersion: 2,
      exportedAt: new Date().toISOString(),
      settings: {
        disableAutoplay: true,
        buttonVisibility: { reverse: false },
      },
      playlists: [sampleSnapshot],
    };
    const parsedV2 = Backup.parseImport(JSON.stringify(v2Payload));
    assert.equal(parsedV2.length, 1);
    assert.equal(parsedV2.settings.disableAutoplay, true);
    assert.equal(parsedV2.settings.buttonVisibility.reverse, false);

    // 3. Backup with settings only (0 playlists)
    const settingsOnlyPayload = {
      schema: "ryp-saved-playlists",
      schemaVersion: 2,
      exportedAt: new Date().toISOString(),
      settings: { disableAutoplay: true },
      playlists: [],
    };
    const parsedSettingsOnly = Backup.parseImport(JSON.stringify(settingsOnlyPayload));
    assert.equal(parsedSettingsOnly.length, 0);
    assert.equal(parsedSettingsOnly.settings.disableAutoplay, true);

    // 4. Invalid file throws
    assert.throws(() => Backup.parseImport(JSON.stringify({ schema: "unknown" })));
    assert.throws(() => Backup.parseImport(JSON.stringify({ playlists: [] })));
  });
});
