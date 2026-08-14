/*
 * YouTube Playlist Tools — test_sidebar_toolbar.js
 * Exercises the real Playlist/Playback modules behind the sidebar's reorder
 * helpers and the virtual-playlist panel lookup.
 */
import "./setup.js";
import { test, describe, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

/** Minimal stand-in for a ytd-playlist-panel-video-renderer element. */
function fakeItem({ index, videoId, title = "", channel = "", duration = "1:00", href }) {
  const anchor = {
    getAttribute: (name) => (name === "href" ? href : null),
    clicked: 0,
    click() {
      this.clicked++;
    },
  };
  return {
    anchor,
    dataset: { index: String(index), videoId },
    hasAttribute: () => false,
    classList: { contains: () => false },
    querySelector: (sel) => {
      if (sel === "#video-title") return { textContent: title };
      if (sel.startsWith("#byline")) return { textContent: channel };
      if (sel === "img") return { src: "" };
      if (sel.includes("wc-endpoint")) return anchor;
      if (sel.includes("badge-shape") || sel.includes("time-status")) {
        return { textContent: duration };
      }
      return null;
    },
  };
}

function fakePanel(items) {
  return { querySelectorAll: () => items };
}

describe("Sidebar & Toolbar Reordering Logic", async () => {
  let originalQuerySelector;
  let originalGetElementById;

  before(async () => {
    await import("../src/state.js");
    await import("../src/playlist.js");
    await import("../src/playback.js");
    originalQuerySelector = document.querySelector;
    originalGetElementById = document.getElementById;
  });

  beforeEach(() => {
    globalThis.browser.storage.local.data = {};
    location.pathname = "/watch";
    location.search = "?v=testVideo1&list=PLtestList";
    location.hash = "";
    document.querySelector = () => null;
    document.getElementById = () => null;
  });

  after(() => {
    document.querySelector = originalQuerySelector;
    document.getElementById = originalGetElementById;
  });

  test("readItems reads the real panel on a normal playlist", () => {
    const { Playlist } = window.RYP;
    const items = [
      fakeItem({ index: 1, videoId: "vidA", title: "First", duration: "2:00", href: "/watch?v=vidA&list=PLtestList&index=1" }),
      fakeItem({ index: 2, videoId: "vidB", title: "Second", duration: "1:30", href: "/watch?v=vidB&list=PLtestList&index=2" }),
    ];
    document.querySelector = (sel) => (sel === Playlist.SEL.panel ? fakePanel(items) : null);

    const read = Playlist.readItems();
    assert.equal(read.length, 2);
    assert.deepEqual(read.map((it) => it.index), [1, 2]);
    assert.equal(read[0].videoId, "vidA");
    assert.equal(read[1].durationSeconds, 90);
  });

  test("a virtual playlist reads our own panel, not a stale YouTube one", () => {
    const { Playlist } = window.RYP;
    location.search = "?v=vidC";
    location.hash = "#ryp_list=SNAP123&ryp_index=1";

    const stale = [
      fakeItem({ index: 9, videoId: "old", title: "Stale", href: "/watch?v=old&list=PLold&index=9" }),
    ];
    const virtual = [
      fakeItem({ index: 1, videoId: "vidC", title: "Snapshot item", href: "/watch?v=vidC#ryp_list=SNAP123&ryp_index=1" }),
    ];
    document.querySelector = (sel) => (sel === Playlist.SEL.panel ? fakePanel(stale) : null);
    document.getElementById = (id) => (id === "ryp-virtual-playlist-panel" ? fakePanel(virtual) : null);

    const read = Playlist.readItems();
    assert.equal(read.length, 1);
    assert.equal(read[0].videoId, "vidC", "must not fall back to the stale real panel");
  });

  test("getItemsContainer resolves the virtual container when there is no real one", () => {
    const { Playlist } = window.RYP;
    location.search = "?v=vidC";
    location.hash = "#ryp_list=SNAP123&ryp_index=1";
    const virtualContainer = { id: "items" };
    document.querySelector = (sel) =>
      sel === "#ryp-virtual-playlist-panel #items" ? virtualContainer : null;

    assert.equal(Playlist.getItemsContainer(), virtualContainer);
  });

  test("goToIndex clicks the anchor of the requested index", () => {
    const { Playlist } = window.RYP;
    const items = [
      fakeItem({ index: 1, videoId: "vidA", href: "/watch?v=vidA&list=PLtestList&index=1" }),
      fakeItem({ index: 2, videoId: "vidB", href: "/watch?v=vidB&list=PLtestList&index=2" }),
    ];
    document.querySelector = (sel) => (sel === Playlist.SEL.panel ? fakePanel(items) : null);

    assert.equal(Playlist.goToIndex(2), true);
    assert.equal(items[1].anchor.clicked, 1);
    assert.equal(items[0].anchor.clicked, 0);
    assert.equal(Playlist.goToIndex(99), false, "unknown index must not navigate");
  });

  test("move to top / bottom persists through applyCustomOrder", async () => {
    const { Playback } = window.RYP;
    const listId = "PLmove";
    const visibleOrder = [10, 20, 30, 40, 50];

    // What Sidebar.moveItemToPosition computes for "top".
    const toTop = [30, ...visibleOrder.filter((i) => i !== 30)];
    await Playback.applyCustomOrder(listId, toTop);
    assert.deepEqual(Playback.getState().customOrder, [30, 10, 20, 40, 50]);
    assert.deepEqual(
      globalThis.browser.storage.local.data[`customOrder:${listId}`],
      [30, 10, 20, 40, 50]
    );
    assert.equal(Playback.getState().reverseOn, false);
    assert.equal(Playback.getState().shuffleOn, false);

    // ...and for "bottom".
    const toBottom = [...visibleOrder.filter((i) => i !== 20), 20];
    await Playback.applyCustomOrder(listId, toBottom);
    assert.deepEqual(Playback.getState().customOrder, [10, 30, 40, 50, 20]);

    await Playback.disableAll(listId);
    assert.equal(Playback.getState().customOrder, null);
    assert.equal(globalThis.browser.storage.local.data[`customOrder:${listId}`], undefined);
  });
});
