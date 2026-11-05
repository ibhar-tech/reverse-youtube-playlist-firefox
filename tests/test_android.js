/*
 * YouTube Playlist Tools — test_android.js
 *
 * Firefox for Android support: the m.youtube.com playlist reader and the
 * play-order engine running on it, plus the desktop-only APIs degrading
 * safely (background.js, the welcome page) where `commands` does not exist.
 *
 * The fake rows mirror m.youtube.com markup as rendered on 2026-11-05:
 *   ytm-playlist-panel-video-renderer[aria-selected]
 *     a[href="/watch?v=…&list=…&index=N&pp=…"]  (thumbnail + text link)
 *     .YtmCompactMediaItemHeadline / .YtmCompactMediaItemByline
 *     ytm-thumbnail-overlay-time-status-renderer .ytBadgeShapeText
 * and the sheet's "N / M" counter, which also sits in the collapsed bar.
 */
import "./setup.js";
import { test, describe, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const LIST = "PLmobileList";

function fakeRow(M, { index, videoId, title, channel = "Chan", duration = "3:00", selected = false, list = LIST }) {
  const href = `/watch?v=${videoId}&list=${list}&index=${index}&pp=iAQB8AUB`;
  const anchor = {
    getAttribute: (n) => (n === "href" ? href : null),
    href,
    clicked: 0,
    click() {
      this.clicked++;
    },
  };
  return {
    anchor,
    selected,
    dataset: {},
    querySelector(sel) {
      if (sel === M.itemLink) return anchor;
      if (sel === M.title) return { textContent: `  ${title}  ` };
      if (sel === M.byline) return { textContent: channel };
      if (sel === ".ytBadgeShapeText") return { textContent: duration };
      if (sel === "img") return { src: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` };
      return null;
    },
  };
}

describe("Firefox for Android — mobile YouTube", async () => {
  let M;
  let rows;
  let sheetOpen;
  let counterText;
  let video;
  const saved = {};

  /** Point the fake document at the current rows / sheet state. */
  function installDom() {
    const panel = { querySelectorAll: (sel) => (sel === M.item ? rows : []) };
    document.querySelector = (sel) => {
      if (sel === "#movie_player video, video") return video;
      if (!sheetOpen) return null;
      if (sel === M.panel) return panel;
      if (sel === M.selected) return rows.find((r) => r.selected) || null;
      if (sel === M.itemsContainer) return { querySelectorAll: () => rows, querySelector: () => null };
      if (sel === M.header) return { id: "fake-header" };
      return null;
    };
    document.querySelectorAll = (sel) => (sel === M.countText && counterText ? [{ textContent: counterText }] : []);
  }

  function makeRows(n, currentIndex, list = LIST) {
    return Array.from({ length: n }, (_, i) =>
      fakeRow(M, {
        index: i + 1,
        videoId: `vid${i + 1}`,
        title: `Video ${i + 1}`,
        duration: `${i + 1}:00`,
        selected: i + 1 === currentIndex,
        list,
      })
    );
  }

  /** Watch item `index` of LIST; the URL's index is YouTube's off-by-one. */
  function watch(index, list = LIST) {
    location.search = `?v=vid${index}&list=${list}&index=${index + 1}`;
    rows.forEach((r, i) => (r.selected = i + 1 === index));
  }

  /** Release the engine's navigation latch between tests. */
  function resetEngine() {
    const path = location.pathname;
    location.pathname = "/";
    window.RYP.Playback.handleNavigation();
    location.pathname = path;
  }

  before(async () => {
    await import("../src/state.js");
    await import("../src/playlist.js");
    await import("../src/playback.js");
    M = window.RYP.Playlist.SEL.mobile;
    saved.querySelector = document.querySelector;
    saved.querySelectorAll = document.querySelectorAll;
    saved.hostname = location.hostname;
    saved.href = location.href;
  });

  beforeEach(() => {
    globalThis.browser.storage.local.data = {};
    location.hostname = "m.youtube.com";
    location.origin = "https://m.youtube.com";
    location.pathname = "/watch";
    location.hash = "";
    delete location.href;
    sheetOpen = true;
    counterText = "Popular Music Videos • 3 / 5";
    video = null;
    rows = makeRows(5, 3);
    watch(3);
    installDom();
    resetEngine();
  });

  after(() => {
    document.querySelector = saved.querySelector;
    document.querySelectorAll = saved.querySelectorAll;
    if (saved.hostname === undefined) delete location.hostname;
    else location.hostname = saved.hostname;
    if (saved.href === undefined) delete location.href;
    location.origin = "https://www.youtube.com";
    location.pathname = "/watch";
    location.search = "?v=testVideo1&list=PLtestList";
    location.hash = "";
  });

  test("isMobile is true only on m.youtube.com", () => {
    const { Playlist } = window.RYP;
    assert.equal(Playlist.isMobile(), true);
    location.hostname = "www.youtube.com";
    assert.equal(Playlist.isMobile(), false);
  });

  test("readItems parses mobile rows: index, videoId, title, channel, duration", () => {
    const { Playlist } = window.RYP;
    const items = Playlist.readItems();
    assert.deepEqual(items.map((it) => it.index), [1, 2, 3, 4, 5]);
    assert.equal(items[1].videoId, "vid2");
    assert.equal(items[1].title, "Video 2");
    assert.equal(items[1].channel, "Chan");
    assert.equal(items[1].durationStr, "2:00");
    assert.equal(items[1].durationSeconds, 120);
    assert.match(items[1].thumbnail, /vid2/);
    assert.ok(items[1].anchor && items[1].element);
  });

  test("currentIndex trusts the selected row over the URL's +1 index", () => {
    const { Playlist } = window.RYP;
    assert.equal(new URLSearchParams(location.search).get("index"), "4");
    assert.equal(Playlist.currentIndex(), 3);
  });

  test("with the sheet closed, remembered rows and the N / M counter still answer", () => {
    const { Playlist } = window.RYP;
    Playlist.readItems(); // sheet open: rows are remembered
    sheetOpen = false;
    const items = Playlist.readItems();
    assert.deepEqual(items.map((it) => it.videoId), ["vid1", "vid2", "vid3", "vid4", "vid5"]);
    assert.equal(items[0].element, null, "a remembered row has no element");
    assert.equal(Playlist.currentIndex(), 3);
    assert.equal(Playlist.getTotalItemCount(), 5);

    // Another playlist, never rendered: only the counter knows the position.
    watch(2, "PLneverRendered");
    counterText = "Other • 2 / 9";
    assert.deepEqual(Playlist.readItems(), []);
    assert.equal(Playlist.currentIndex(), 2);
    assert.equal(Playlist.getTotalItemCount(), 9);
  });

  test("parseFraction takes the last N / M, so a title like '24/7' cannot win", () => {
    const { Playlist } = window.RYP;
    assert.deepEqual(Playlist.parseFraction("Lofi 24/7 • 12 / 1,204"), { current: 12, total: 1204 });
    assert.equal(Playlist.parseFraction("no counter"), null);
  });

  test("goToIndex clicks the rendered row, or loads the remembered video's URL", () => {
    const { Playlist } = window.RYP;
    assert.equal(Playlist.goToIndex(2), true);
    assert.equal(rows[1].anchor.clicked, 1);

    sheetOpen = false;
    assert.equal(Playlist.goToIndex(4), true);
    assert.equal(rows[3].anchor.clicked, 0);
    assert.equal(location.href, `/watch?v=vid4&list=${LIST}`);
  });

  test("Reverse plays the previous item next, sheet open or closed", async () => {
    const { Playback } = window.RYP;
    globalThis.browser.storage.local.data[`reverse:${LIST}`] = true;
    assert.equal(await Playback.loadState(LIST), true);
    Playback.handleNavigation();
    assert.equal(Playback.getState().reverseOn, true);
    assert.equal(Playback.nextIndexInMode(3), 2);

    Playback._stepNext();
    assert.equal(rows[1].anchor.clicked, 1, "stepped from item 3 to item 2");

    // YouTube lands on item 2 with the sheet closed (the usual state while
    // watching) — the next step still resolves from remembered rows.
    sheetOpen = false;
    watch(2);
    Playback.handleNavigation();
    Playback._stepNext();
    assert.equal(location.href, `/watch?v=vid1&list=${LIST}`);
  });

  test("Shuffle builds a video-id order from mobile rows and follows it", async () => {
    const { Playback } = window.RYP;
    await Playback.loadState(LIST);
    Playback.handleNavigation();
    await Playback.enableShuffle(LIST);
    const order = Playback.getState().customOrder;
    assert.deepEqual([...order].sort(), ["vid1", "vid2", "vid3", "vid4", "vid5"]);
    assert.deepEqual(globalThis.browser.storage.local.data[`customOrder:${LIST}`], order);

    // Shuffle starts at the first entry of its order.
    const first = rows.find((r) => r.querySelector(M.itemLink).href.includes(`v=${order[0]}&`));
    if (order[0] !== "vid3") assert.equal(first.anchor.clicked, 1);

    // From there, next is the following entry of the order.
    resetEngine();
    watch(Number(order[0].slice(3)));
    Playback.handleNavigation();
    Playback._stepNext();
    const second = rows.find((r) => r.querySelector(M.itemLink).href.includes(`v=${order[1]}&`));
    assert.ok(second.anchor.clicked >= 1, `expected a click on ${order[1]}`);
  });

  test("an auto-advance seen via state-navigatestart is redirected to the mode's next", async () => {
    const { Playback } = window.RYP;
    globalThis.browser.storage.local.data[`reverse:${LIST}`] = true;
    await Playback.loadState(LIST);
    Playback.handleNavigation(); // on item 3

    // The video ends and YouTube itself moves forward to item 4.
    video = { ended: true, duration: 200, currentTime: 200 };
    window.dispatchEvent(new Event("state-navigatestart"));
    watch(4);
    Playback.handleNavigation();
    assert.equal(rows[1].anchor.clicked, 1, "reverse wanted item 2, not YouTube's item 4");
  });

  test("the mobile player's next/previous buttons follow the active order", async () => {
    const { Playback } = window.RYP;
    globalThis.browser.storage.local.data[`reverse:${LIST}`] = true;
    await Playback.loadState(LIST);
    Playback.handleNavigation(); // on item 3

    const play = { id: "play" };
    const row = { parentElement: null, querySelector: (s) => (s === M.playPauseButton ? play : null) };
    const button = (position) => {
      const btn = {
        parentElement: { parentElement: row, querySelector: () => null },
        compareDocumentPosition: (other) => (other === play ? position : 0),
        closest: (s) => (s === M.prevNextButton ? btn : null),
      };
      return btn;
    };
    const click = (target) => {
      const e = { target, prevented: 0, preventDefault() { this.prevented++; }, stopPropagation() {} };
      Playback._onControlClick(e);
      return e;
    };

    // Next renders after play/pause (play/pause PRECEDES it: position 2).
    const next = click(button(2));
    assert.equal(next.prevented, 1);
    assert.equal(rows[1].anchor.clicked, 1, "next in reverse from item 3 is item 2");

    // Previous renders before play/pause (play/pause FOLLOWS it: position 4).
    resetEngine();
    watch(3);
    Playback.handleNavigation();
    video = { currentTime: 1 };
    const prev = click(button(4));
    assert.equal(prev.prevented, 1);
    assert.equal(rows[3].anchor.clicked, 1, "previous in reverse from item 3 is item 4");

    // Anything else is left to YouTube.
    const other = click({ closest: () => null });
    assert.equal(other.prevented, 0);
  });

  test("Reorder (HTML5 drag-and-drop) is left out of the mobile toolbar", () => {
    const source = fs.readFileSync("src/toolbar.js", "utf8");
    const mobileBranch = source.slice(source.indexOf("if (Playlist.isMobile()) {"), source.indexOf("} else {", source.indexOf("if (Playlist.isMobile()) {")));
    assert.match(mobileBranch, /toolbar\.append\(reverseBtn, shuffleBtn, sortDropdown,/);
    assert.doesNotMatch(mobileBranch, /reorderBtn,/);
  });
});

describe("Firefox for Android — manifest and desktop-only APIs", async () => {
  test("gecko_android requires 142+, the first Android release with data_collection_permissions", () => {
    const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
    const bss = manifest.browser_specific_settings;
    assert.ok(bss.gecko.data_collection_permissions);
    assert.ok(parseFloat(bss.gecko_android.strict_min_version) >= 142);
    assert.equal(bss.gecko.strict_min_version, "140.0", "desktop minimum unchanged");
    assert.ok(manifest.content_scripts[0].matches.includes("*://*.youtube.com/*"), "covers m.youtube.com");
    // Chrome/Edge builds drop the whole key (build-chrome.sh: del(.browser_specific_settings)).
    const chrome = structuredClone(manifest);
    delete chrome.browser_specific_settings;
    assert.doesNotMatch(JSON.stringify(chrome), /gecko/);
  });

  test("background.js loads without a commands API and still opens the welcome page", async () => {
    const runtime = globalThis.browser.runtime;
    const saved = { onInstalled: runtime.onInstalled, getURL: runtime.getURL, tabs: globalThis.browser.tabs };
    const installed = [];
    const created = [];
    runtime.onInstalled = { addListener: (fn) => installed.push(fn) };
    runtime.getURL = (p) => `moz-extension://id/${p}`;
    globalThis.browser.tabs = { create: (o) => created.push(o.url) };
    try {
      assert.equal(globalThis.browser.commands, undefined);
      await import("../src/background.js");
      assert.equal(installed.length, 1);
      installed[0]({ reason: "install" });
      assert.deepEqual(created, ["moz-extension://id/popup/welcome.html"]);
    } finally {
      runtime.onInstalled = saved.onInstalled;
      runtime.getURL = saved.getURL;
      if (saved.tabs === undefined) delete globalThis.browser.tabs;
      else globalThis.browser.tabs = saved.tabs;
    }
  });

  test("welcome page on Android: no shortcuts card, phone wording, no Reorder toggle", async () => {
    const saved = {
      getElementById: document.getElementById,
      querySelector: document.querySelector,
      querySelectorAll: document.querySelectorAll,
      title: document.title,
      getPlatformInfo: globalThis.browser.runtime.getPlatformInfo,
    };
    let keysCardRemoved = false;
    const grid = document.createElement("div");
    const i18nNodes = ["step1Body", "step3Body", "title"].map((key) => {
      const attrs = { "data-i18n": key };
      return { attrs, textContent: "", getAttribute: (n) => attrs[n], setAttribute: (n, v) => (attrs[n] = v) };
    });
    document.getElementById = (id) => {
      if (id === "keys-card") return { remove: () => (keysCardRemoved = true) };
      if (id === "btn-grid") return grid;
      return null; // keys-body, change-keys: gone with the card
    };
    document.querySelector = (sel) => {
      const m = sel.match(/^\[data-i18n="(\w+)"\]$/);
      return m ? i18nNodes.find((n) => n.attrs["data-i18n"] === m[1]) || null : null;
    };
    document.querySelectorAll = (sel) => (sel === "[data-i18n]" ? i18nNodes : []);
    globalThis.browser.runtime.getPlatformInfo = async () => ({ os: "android" });
    try {
      await import("../popup/welcome.js");
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(keysCardRemoved, true, "shortcuts section hidden");
      assert.equal(i18nNodes[0].attrs["data-i18n"], "step1BodyMobile");
      assert.match(i18nNodes[0].textContent, /phone/);
      assert.equal(i18nNodes[1].attrs["data-i18n"], "step3BodyMobile");
      const labels = grid.children.map((label) => label.children[1].textContent);
      // Every button key except the three that don't exist on mobile
      // (Reorder, Add to Playlist, the channel bar).
      assert.equal(labels.length, window.RYP.Backup.BUTTON_KEYS.length - 3);
      assert.ok(!labels.some((l) => /^Channel/.test(l)), "no channel toggle on mobile");
      assert.ok(!labels.includes("Reorder") && !labels.includes("Add to Playlist"));
      assert.ok(labels.includes("Export list"), "export works on mobile, so it stays");
    } finally {
      document.getElementById = saved.getElementById;
      document.querySelector = saved.querySelector;
      document.querySelectorAll = saved.querySelectorAll;
      document.title = saved.title;
      if (saved.getPlatformInfo === undefined) delete globalThis.browser.runtime.getPlatformInfo;
      else globalThis.browser.runtime.getPlatformInfo = saved.getPlatformInfo;
    }
  });
});
