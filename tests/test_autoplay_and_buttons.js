/*
 * YouTube Playlist Tools — test_autoplay_and_buttons.js
 * Intensive unit tests for Autoplay Control, YouTube Autoplay Interception,
 * and Customizable Button Visibility across Firefox and Chrome environments.
 */
import "./setup.js";
import { test, describe, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

describe("Autoplay Control & Button Visibility (Intensive Suite)", async () => {
  let originalQuerySelector;
  let originalQuerySelectorAll;
  let originalGetElementById;
  let originalReadItems;
  let originalGoToIndex;

  before(async () => {
    await import("../src/state.js");
    await import("../src/playlist.js");
    await import("../src/playback.js");
    await import("../src/sidebar.js");
    await import("../src/panel.js");
    await import("../src/toolbar.js");

    originalQuerySelector = document.querySelector;
    originalQuerySelectorAll = document.querySelectorAll;
    originalGetElementById = document.getElementById;
    originalReadItems = window.RYP.Playlist.readItems;
    originalGoToIndex = window.RYP.Playlist.goToIndex;
  });

  beforeEach(() => {
    globalThis.browser.storage.local.data = {};
    location.pathname = "/watch";
    location.search = "?v=vid2&list=PLtestList&index=2";
    location.hash = "";
    document.querySelector = () => null;
    document.querySelectorAll = () => [];
    document.getElementById = () => null;
  });

  after(() => {
    document.querySelector = originalQuerySelector;
    document.querySelectorAll = originalQuerySelectorAll;
    document.getElementById = originalGetElementById;
    window.RYP.Playlist.readItems = originalReadItems;
    window.RYP.Playlist.goToIndex = originalGoToIndex;
  });

  describe("Autoplay Control", () => {
    test("disableAutoplay setting is read from settings", () => {
      const { Playback } = window.RYP;
      Playback.updateSettings({ disableAutoplay: true });
      assert.equal(Playback.isAutoplayDisabled(), true);
      Playback.updateSettings({ disableAutoplay: false });
      assert.equal(Playback.isAutoplayDisabled(), false);
      Playback.updateSettings(undefined);
      assert.equal(Playback.isAutoplayDisabled(), false);
    });

    test("handleNavigation leaves a manually chosen video alone when autoplay is disabled", async () => {
      const { Playback, Playlist } = window.RYP;
      const listId = "PLtestList";

      Playlist.readItems = () => [
        { index: 1, videoId: "vid1" },
        { index: 2, videoId: "vid2" },
        { index: 3, videoId: "vid3" },
      ];

      let navTarget = null;
      Playlist.goToIndex = (idx) => {
        navTarget = idx;
        return true;
      };
      let videoPaused = false;
      document.querySelector = (sel) =>
        sel.includes("video") ? { pause() { videoPaused = true; } } : null;

      await Playback.enableReverse(listId);
      location.search = "?v=vid1&list=PLtestList&index=1";
      Playback.handleNavigation();

      // Autoplay disabled: arriving at index+1 can only be the user's own
      // click (the near-end pause already stops YouTube's advance), so it
      // must neither be redirected nor paused.
      Playback.updateSettings({ disableAutoplay: true });
      location.search = "?v=vid2&list=PLtestList&index=2";
      navTarget = null;
      Playback.handleNavigation();
      assert.equal(navTarget, null, "must not redirect when autoplay is disabled");
      assert.equal(videoPaused, false, "must not pause a video the user navigated to");

      // Autoplay enabled, but the previous video was mid-way: that is the
      // user clicking the next row, and it must play — not be "corrected".
      Playback.updateSettings({ disableAutoplay: false });
      const video = { duration: 600, currentTime: 120, pause() { videoPaused = true; } };
      document.querySelector = (sel) => (sel.includes("video") ? video : null);
      Playback._onNavigateStart();
      location.search = "?v=vid3&list=PLtestList&index=3";
      Playback.handleNavigation();
      assert.equal(navTarget, null, "a mid-video click on index+1 is the user's choice");

      // The previous video reached its end: YouTube's own forward-advance
      // slipped through, and is redirected to the reverse order.
      location.search = "?v=vid2&list=PLtestList&index=2";
      Playback.handleNavigation();
      video.currentTime = 599.2;
      Playback._onNavigateStart();
      location.search = "?v=vid3&list=PLtestList&index=3";
      Playback.handleNavigation();
      assert.equal(navTarget, 1, "must redirect to the reverse target when autoplay is enabled");
    });
  });

  describe("Button Visibility Control", () => {
    test("applyButtonVisibility adds ryp-hidden to disabled buttons and removes it from enabled ones", () => {
      const { Toolbar } = window.RYP;

      const mockElements = {
        "#ryp-btn-reverse": { classList: new Set() },
        "#ryp-ov-reverse": { classList: new Set() },
        "#ryp-btn-shuffle": { classList: new Set() },
        "#ryp-ov-shuffle": { classList: new Set() },
        "#ryp-sort-wrapper": { classList: new Set() },
        "#ryp-export-wrapper": { classList: new Set() },
        "#ryp-ov-export-wrapper": { classList: new Set() },
        "#ryp-btn-reorder": { classList: new Set() },
        "#ryp-btn-reset": { classList: new Set() },
        "#ryp-btn-save": { classList: new Set() },
        "#ryp-ov-save": { classList: new Set() },
        "#ryp-btn-playlists": { classList: new Set() },
        "#ryp-duration-pill": { classList: new Set() },
        "#ryp-overview-duration-pill": { classList: new Set() },
        ".ryp-load-all-pill": { classList: new Set() },
      };

      for (const el of Object.values(mockElements)) {
        el.classList.toggle = function (cls, force) {
          if (force !== undefined) {
            force ? this.add(cls) : this.delete(cls);
          } else {
            this.has(cls) ? this.delete(cls) : this.add(cls);
          }
        };
      }

      document.querySelectorAll = (sel) => {
        return mockElements[sel] ? [mockElements[sel]] : [];
      };

      // Hide reverse, shuffle, reset, duration
      Toolbar.setButtonVisibility({
        reverse: false,
        shuffle: false,
        reset: false,
        duration: false,
      });

      assert.equal(mockElements["#ryp-btn-reverse"].classList.has("ryp-hidden"), true);
      assert.equal(mockElements["#ryp-ov-reverse"].classList.has("ryp-hidden"), true);
      assert.equal(mockElements["#ryp-btn-shuffle"].classList.has("ryp-hidden"), true);
      assert.equal(mockElements["#ryp-ov-shuffle"].classList.has("ryp-hidden"), true);
      assert.equal(mockElements["#ryp-btn-reset"].classList.has("ryp-hidden"), true);
      assert.equal(mockElements["#ryp-duration-pill"].classList.has("ryp-hidden"), true);
      assert.equal(mockElements["#ryp-overview-duration-pill"].classList.has("ryp-hidden"), true);

      // Other buttons default to visible
      assert.equal(mockElements["#ryp-sort-wrapper"].classList.has("ryp-hidden"), false);
      assert.equal(mockElements["#ryp-export-wrapper"].classList.has("ryp-hidden"), false);
      assert.equal(mockElements["#ryp-btn-reorder"].classList.has("ryp-hidden"), false);
      assert.equal(mockElements["#ryp-btn-save"].classList.has("ryp-hidden"), false);
      assert.equal(mockElements["#ryp-btn-playlists"].classList.has("ryp-hidden"), false);
      assert.equal(mockElements[".ryp-load-all-pill"].classList.has("ryp-hidden"), false);

      // Re-enable reverse and duration
      Toolbar.setButtonVisibility({
        reverse: true,
        shuffle: false,
        reset: false,
        duration: true,
      });

      assert.equal(mockElements["#ryp-btn-reverse"].classList.has("ryp-hidden"), false);
      assert.equal(mockElements["#ryp-ov-reverse"].classList.has("ryp-hidden"), false);
      assert.equal(mockElements["#ryp-duration-pill"].classList.has("ryp-hidden"), false);
      assert.equal(mockElements["#ryp-btn-shuffle"].classList.has("ryp-hidden"), true);

      // Sort and Export are both dropdowns: hiding one must not hide the other.
      Toolbar.setButtonVisibility({ sort: false });
      assert.equal(mockElements["#ryp-sort-wrapper"].classList.has("ryp-hidden"), true);
      assert.equal(mockElements["#ryp-export-wrapper"].classList.has("ryp-hidden"), false);
      Toolbar.setButtonVisibility({ export: false });
      assert.equal(mockElements["#ryp-sort-wrapper"].classList.has("ryp-hidden"), false);
      assert.equal(mockElements["#ryp-export-wrapper"].classList.has("ryp-hidden"), true);
      assert.equal(mockElements["#ryp-ov-export-wrapper"].classList.has("ryp-hidden"), true);
    });

    test("missing keys in buttonVisibility default to true (visible)", () => {
      const { Toolbar } = window.RYP;

      const mockElement = {
        classList: new Set(),
      };
      mockElement.classList.toggle = function (cls, force) {
        if (force !== undefined) {
          force ? this.add(cls) : this.delete(cls);
        } else {
          this.has(cls) ? this.delete(cls) : this.add(cls);
        }
      };

      document.querySelectorAll = () => [mockElement];

      // Empty visibility object
      Toolbar.setButtonVisibility({});
      assert.equal(mockElement.classList.has("ryp-hidden"), false);

      // Null or undefined
      Toolbar.setButtonVisibility(null);
      assert.equal(mockElement.classList.has("ryp-hidden"), false);
    });
  });

  describe("Cross-Browser Chrome & Firefox Compatibility", () => {
    test("chrome global fallback works identically when browser is undefined", async () => {
      const fakeData = {};
      const mockChrome = {
        storage: {
          local: {
            get: async (k) => (typeof k === "string" ? { [k]: fakeData[k] } : { ...fakeData }),
            set: async (obj) => Object.assign(fakeData, obj),
          },
        },
      };

      const savedBrowser = globalThis.browser;
      const savedChrome = globalThis.chrome;
      delete globalThis.browser;
      globalThis.chrome = mockChrome;
      try {
        const api = typeof globalThis.browser !== "undefined" ? globalThis.browser : globalThis.chrome;
        assert.ok(api, "api must resolve to chrome when browser is undefined");
        assert.equal(typeof api.storage.local.get, "function");
        assert.equal(typeof api.storage.local.set, "function");

        // Write and read settings through chrome mock
        await api.storage.local.set({
          ryp_settings: {
            disableAutoplay: true,
            buttonVisibility: { reverse: false },
          },
        });
        const res = await api.storage.local.get("ryp_settings");
        assert.equal(res.ryp_settings.disableAutoplay, true);
        assert.equal(res.ryp_settings.buttonVisibility.reverse, false);
      } finally {
        globalThis.browser = savedBrowser;
        globalThis.chrome = savedChrome;
      }
    });
  });
});
