/*
 * YouTube Playlist Tools — test_growth_features.js
 * Stats tracking, the one-time rating prompt, store links, and the
 * manifest wiring for keyboard shortcuts and the welcome page.
 */
import "./setup.js";
import { test, describe, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const store = () => globalThis.browser.storage.local.data;

describe("Growth features", async () => {
  let ratingShown = 0;

  before(async () => {
    await import("../src/links.js");
    await import("../src/state.js");
    await import("../src/playlist.js");
    await import("../src/stats.js");
    window.RYP.Panel = { showRatingToast: () => ratingShown++ };
  });

  beforeEach(() => {
    globalThis.browser.storage.local.data = {};
    ratingShown = 0;
    location.pathname = "/watch";
    location.search = "?v=abcdefghijk&list=PLtestList";
    location.hash = "";
  });

  test("bump counts actions in storage", async () => {
    const { Stats } = window.RYP;
    await Stats.bump("reverse");
    await Stats.bump("reverse");
    await Stats.bump("sort");
    assert.deepEqual(store().ryp_stats.actions, { reverse: 2, sort: 1 });
    assert.equal(typeof store().ryp_stats.since, "string");
  });

  test("rating is asked exactly once, after the 5th action", async () => {
    const { Stats } = window.RYP;
    for (let i = 0; i < 4; i++) assert.equal(await Stats.bump("shuffle"), false);
    assert.equal(store().ryp_rating, undefined);
    assert.equal(await Stats.bump("shuffle"), true);
    assert.equal(store().ryp_rating.asked, true);
    for (let i = 0; i < 5; i++) assert.equal(await Stats.bump("shuffle"), false);
  });

  test("watch time counts real playback, scales by speed, ignores seeks", async () => {
    const { Stats } = window.RYP;
    const v = { currentTime: 0, paused: false, playbackRate: 2 };
    const tick = (t) => { v.currentTime = t; Stats._onTimeUpdate({ target: v }); };
    tick(10);          // first sight of this video: baseline only
    tick(11);          // +1s content at 2x = 0.5s real
    tick(12);          // +1s
    tick(300);         // seek: ignored
    tick(301);         // +1s
    v.paused = true; tick(302); // paused: ignored
    await Stats.flush();
    assert.equal(store().ryp_stats.contentSeconds, 3);
    assert.equal(store().ryp_stats.realSeconds, 1.5);
  });

  test("watch time is not counted outside playlists", async () => {
    const { Stats } = window.RYP;
    location.search = "?v=zzzzzzzzzzz";
    const v = { currentTime: 0, paused: false, playbackRate: 1 };
    for (const t of [1, 2, 3]) { v.currentTime = t; Stats._onTimeUpdate({ target: v }); }
    await Stats.flush();
    assert.equal(store().ryp_stats, undefined);
  });

  test("merge tolerates missing or corrupt stored stats", () => {
    const { Stats } = window.RYP;
    const out = Stats.merge({ actions: { reverse: "3" }, videosFinished: "x" },
      { actions: { reverse: 1 }, videosFinished: 2, contentSeconds: 5, realSeconds: 4 });
    assert.equal(out.actions.reverse, 4);
    assert.equal(out.videosFinished, 2);
    assert.equal(out.contentSeconds, 5);
  });

  test("store links match the browser", () => {
    const { Links } = window.RYP;
    assert.match(Links.reviewUrl("firefox"), /^https:\/\/addons\.mozilla\.org\/.+\/reviews\/$/);
    assert.match(Links.reviewUrl("chrome"), /^https:\/\/chromewebstore\.google\.com\/detail\/[a-p]{32}\/reviews$/);
    assert.equal(Links.storeUrl("edge"), Links.storeUrl("chrome"));
  });

  test("manifest declares 4 shortcuts with localized names, and the background script", () => {
    const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
    const commands = Object.entries(manifest.commands);
    assert.equal(commands.length, 4, "Chrome allows at most 4 suggested shortcuts");
    for (const lang of ["en", "fr", "ar"]) {
      const msgs = JSON.parse(fs.readFileSync(`_locales/${lang}/messages.json`, "utf8"));
      for (const [, cmd] of commands) {
        const key = cmd.description.replace(/^__MSG_|__$/g, "");
        assert.ok(msgs[key]?.message, `${lang} is missing ${key}`);
      }
    }
    assert.deepEqual(manifest.background.scripts, ["src/background.js"]);
    const js = manifest.content_scripts[0].js;
    assert.ok(js.indexOf("src/links.js") < js.indexOf("src/panel.js"));
    assert.ok(js.indexOf("src/playlist.js") < js.indexOf("src/stats.js"));
    assert.ok(fs.existsSync("popup/welcome.html"));
  });
});
