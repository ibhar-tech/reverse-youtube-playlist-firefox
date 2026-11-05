/*
 * YouTube Playlist Tools — test_channel.js
 * "Play a channel oldest first": channel-id extraction (and the SPA staleness
 * guard that keeps it from naming the wrong channel), uploads-playlist URL
 * building, the hash marker, the one-reload pending play, and the wiring of
 * the new `channelPlay` button key.
 */
import "./setup.js";
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const GOOGLE_DEV = "UC_x5XG1OV2P6uZZ5FSM9Ttw"; // @GoogleDevelopers
const VERITASIUM = "UCHnyfMqiRRG1u-2MsSQLbXA"; // @veritasium

/** A document holding the server-rendered microformat YouTube ships. */
function fakeDoc({ identifier, canonical = [], ogUrl, handheld } = {}) {
  const attrs = (map) => ({ getAttribute: (k) => map[k] ?? null });
  return {
    querySelector(sel) {
      if (sel === 'meta[itemprop="identifier"]') return identifier ? attrs({ content: identifier }) : null;
      if (sel === 'meta[property="og:url"]') return ogUrl ? attrs({ content: ogUrl }) : null;
      if (sel === 'link[rel="alternate"][media="handheld"]') return handheld ? attrs({ href: handheld }) : null;
      return null;
    },
    querySelectorAll(sel) {
      if (sel === 'link[rel="canonical"]') return canonical.map((href) => attrs({ href }));
      return [];
    },
  };
}

/** performance stub: the URL the document was loaded from. */
const loadedFrom = (url) => ({ getEntriesByType: (t) => (t === "navigation" ? [{ name: url, type: "navigate" }] : []) });
const noPerf = { getEntriesByType: () => [] };

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    size: () => data.size,
  };
}

describe("Channel: play oldest first", async () => {
  let originalRatingToast;

  before(async () => {
    await import("../src/backup.js");
    await import("../src/state.js");
    await import("../src/playlist.js");
    await import("../src/stats.js");
    await import("../src/channel.js");
    window.RYP.Panel = window.RYP.Panel || {};
    originalRatingToast = window.RYP.Panel.showRatingToast;
    window.RYP.Panel.showRatingToast = () => {};
  });

  after(() => {
    window.RYP.Panel.showRatingToast = originalRatingToast;
    globalThis.browser.storage.local.data = {};
  });

  describe("channel pages", () => {
    test("recognises every channel URL form, with or without a tab", () => {
      const { Channel } = window.RYP;
      for (const path of [
        "/@veritasium", "/@veritasium/", "/@veritasium/videos", "/@veritasium/featured",
        "/@veritasium/streams", "/@veritasium/shorts", `/channel/${VERITASIUM}`,
        `/channel/${VERITASIUM}/videos`, "/c/veritasium", "/user/1veritasium/videos",
        "/@%D8%A7%D9%84%D8%AC%D8%B2%D9%8A%D8%B1%D8%A9",
      ]) {
        assert.ok(Channel.isChannelPath(path), path);
      }
    });

    test("ignores pages that are not a channel's uploads", () => {
      const { Channel } = window.RYP;
      for (const path of [
        "/", "/watch", "/playlist", "/results", "/feed/subscriptions", "/@veritasium/community",
        "/@veritasium/playlists", "/@veritasium/search", "/channel/UCshort", "/c/", "/shorts/abc",
      ]) {
        assert.equal(Channel.isChannelPath(path), false, path);
        assert.equal(Channel.channelRoot(path), null, path);
      }
    });

    test("channel root ignores the tab and handle case, keeps channel-id case", () => {
      const { Channel } = window.RYP;
      assert.equal(Channel.channelRoot("/@Veritasium/videos"), "/@veritasium");
      assert.equal(Channel.channelRoot("/@veritasium"), "/@veritasium");
      assert.equal(Channel.channelRoot(`/channel/${VERITASIUM}/streams`), `/channel/${VERITASIUM}`);
      // Percent-encoded and raw non-Latin handles are the same channel.
      assert.equal(
        Channel.channelRoot("/@%D8%A7%D9%84%D8%AC%D8%B2%D9%8A%D8%B1%D8%A9"),
        Channel.channelRoot("/@الجزيرة/videos")
      );
    });
  });

  describe("channel id", () => {
    test("reads <meta itemprop=identifier>, else the /channel/ canonical or og:url", () => {
      const { Channel } = window.RYP;
      assert.equal(Channel.readDocumentChannelId(fakeDoc({ identifier: GOOGLE_DEV })), GOOGLE_DEV);
      assert.equal(
        Channel.readDocumentChannelId(fakeDoc({
          canonical: ["https://www.youtube.com/@veritasium", `https://www.youtube.com/channel/${VERITASIUM}`],
        })),
        VERITASIUM
      );
      assert.equal(
        Channel.readDocumentChannelId(fakeDoc({ ogUrl: `https://www.youtube.com/channel/${VERITASIUM}` })),
        VERITASIUM
      );
    });

    test("rejects anything that is not UC + 22 characters", () => {
      const { Channel } = window.RYP;
      // Watch pages put the *video* id in itemprop=identifier.
      assert.equal(Channel.readDocumentChannelId(fakeDoc({ identifier: "dQw4w9WgXcQ" })), null);
      assert.equal(Channel.readDocumentChannelId(fakeDoc({ identifier: "UU_x5XG1OV2P6uZZ5FSM9Ttw" })), null);
      assert.equal(Channel.readDocumentChannelId(fakeDoc({ ogUrl: "https://www.youtube.com/channel/UCtooShort" })), null);
      assert.equal(Channel.readDocumentChannelId(fakeDoc({})), null);
    });

    test("a /channel/UC… URL is its own answer, whatever the document says", () => {
      const { Channel } = window.RYP;
      const r = Channel.resolveChannelId({
        pathname: `/channel/${VERITASIUM}/videos`,
        doc: fakeDoc({ identifier: GOOGLE_DEV }),
        perf: loadedFrom("https://www.youtube.com/@GoogleDevelopers"),
      });
      assert.deepEqual(r, { id: VERITASIUM, fresh: true });
    });

    test("trusts the document's id on the channel it was loaded for, under any tab", () => {
      const { Channel } = window.RYP;
      const doc = fakeDoc({ identifier: GOOGLE_DEV });
      const perf = loadedFrom("https://www.youtube.com/@GoogleDevelopers/videos?app=desktop");
      // SPA-navigating between tabs of the same channel keeps the id valid.
      for (const pathname of ["/@GoogleDevelopers/videos", "/@googledevelopers", "/@GoogleDevelopers/streams"]) {
        assert.deepEqual(Channel.resolveChannelId({ pathname, doc, perf }), { id: GOOGLE_DEV, fresh: true }, pathname);
      }
    });

    test("after SPA navigation to another channel the stale id is never used", () => {
      const { Channel } = window.RYP;
      // Exactly what live YouTube showed: @GoogleDevelopers → (SPA) → @veritasium
      // leaves the microformat naming Google for Developers.
      const r = Channel.resolveChannelId({
        pathname: "/@veritasium",
        doc: fakeDoc({
          identifier: GOOGLE_DEV,
          canonical: ["https://www.youtube.com/@veritasium", `https://www.youtube.com/channel/${GOOGLE_DEV}`],
          handheld: "https://m.youtube.com/@GoogleDevelopers/videos",
        }),
        perf: loadedFrom("https://www.youtube.com/@GoogleDevelopers/videos"),
      });
      assert.deepEqual(r, { id: null, fresh: false });
    });

    test("SPA arrival from a page with no channel id still offers the (reload) path", () => {
      const { Channel } = window.RYP;
      const r = Channel.resolveChannelId({
        pathname: "/@veritasium/videos",
        doc: fakeDoc({ identifier: "dQw4w9WgXcQ" }),
        perf: loadedFrom("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
      });
      assert.deepEqual(r, { id: null, fresh: false });
    });

    test("loaded for this channel but no id served: null, so the button hides", () => {
      const { Channel } = window.RYP;
      const r = Channel.resolveChannelId({
        pathname: "/@veritasium",
        doc: fakeDoc({}),
        perf: loadedFrom("https://www.youtube.com/@veritasium"),
      });
      assert.equal(r, null);
    });

    test("falls back to the handheld alternate link when navigation timing is unavailable", () => {
      const { Channel } = window.RYP;
      const doc = fakeDoc({ identifier: VERITASIUM, handheld: "https://m.youtube.com/@veritasium/videos" });
      assert.deepEqual(
        Channel.resolveChannelId({ pathname: "/@veritasium", doc, perf: noPerf }),
        { id: VERITASIUM, fresh: true }
      );
      assert.deepEqual(
        Channel.resolveChannelId({ pathname: "/@someoneelse", doc, perf: noPerf }),
        { id: null, fresh: false }
      );
    });

    test("not a channel page: null", () => {
      const { Channel } = window.RYP;
      const doc = fakeDoc({ identifier: VERITASIUM });
      assert.equal(Channel.resolveChannelId({ pathname: "/watch", doc, perf: noPerf }), null);
      assert.equal(Channel.resolveChannelId({ pathname: "/playlist", doc, perf: noPerf }), null);
    });
  });

  describe("uploads playlist URLs", () => {
    test("UC → UULF (videos only) by default, UU for every upload", () => {
      const { Channel } = window.RYP;
      assert.equal(Channel.uploadsPlaylistId(GOOGLE_DEV), "UULF_x5XG1OV2P6uZZ5FSM9Ttw");
      assert.equal(Channel.uploadsPlaylistId(GOOGLE_DEV, "all"), "UU_x5XG1OV2P6uZZ5FSM9Ttw");
      assert.equal(Channel.uploadsPlaylistId("UCtooShort"), null);
      assert.equal(Channel.uploadsPlaylistId(undefined), null);
    });

    test("an empty videos-only playlist falls back to all uploads, once", () => {
      const { Channel } = window.RYP;
      assert.equal(Channel.fallbackListId("UULFHnyfMqiRRG1u-2MsSQLbXA"), "UUHnyfMqiRRG1u-2MsSQLbXA");
      assert.equal(Channel.fallbackListId("UUHnyfMqiRRG1u-2MsSQLbXA"), null);
      assert.equal(Channel.fallbackListId("PLabcdefghijklmnopqrstuv"), null);
    });

    test("playlist URL carries the play marker in the hash, and nothing unknown", () => {
      const { Channel } = window.RYP;
      const url = Channel.playlistUrl("UULF_x5XG1OV2P6uZZ5FSM9Ttw", "oldest");
      assert.equal(url, "https://www.youtube.com/playlist?list=UULF_x5XG1OV2P6uZZ5FSM9Ttw#ryp_play=oldest");
      const parsed = new URL(url);
      assert.equal(parsed.searchParams.get("list"), "UULF_x5XG1OV2P6uZZ5FSM9Ttw");
      assert.equal(Channel.readPlayMarker(parsed.hash), "oldest");
      assert.equal(Channel.readPlayMarker("#ryp_play=newest"), "newest");
      assert.equal(Channel.playlistUrl("UULF_x5XG1OV2P6uZZ5FSM9Ttw", "sideways"), null);
      assert.equal(Channel.playlistUrl(null, "oldest"), null);
    });

    test("marker reading rejects junk and stripping keeps other fragment params", () => {
      const { Channel } = window.RYP;
      assert.equal(Channel.readPlayMarker(""), null);
      assert.equal(Channel.readPlayMarker("#ryp_play=random"), null);
      assert.equal(Channel.stripPlayMarker("#ryp_play=oldest"), "");
      assert.equal(Channel.stripPlayMarker("#ryp_play=oldest&t=10"), "#t=10");
      assert.equal(Channel.stripPlayMarker(""), "");
    });
  });

  describe("pending play across one reload", () => {
    test("round-trips once, for the same channel only", () => {
      const { Channel } = window.RYP;
      const s = memoryStorage();
      assert.ok(Channel.savePending(s, "oldest", "/@veritasium", 1000));
      assert.equal(Channel.takePending(s, "/@veritasium", 2000), "oldest");
      assert.equal(Channel.takePending(s, "/@veritasium", 2001), null, "one-shot");

      Channel.savePending(s, "newest", "/@veritasium", 1000);
      assert.equal(Channel.takePending(s, "/@other", 2000), null, "another channel never inherits it");
      assert.equal(s.size(), 0, "and it is cleared anyway");
    });

    test("expires, and ignores corrupt or missing storage", () => {
      const { Channel } = window.RYP;
      const s = memoryStorage();
      Channel.savePending(s, "oldest", "/@veritasium", 1000);
      assert.equal(Channel.takePending(s, "/@veritasium", 1000 + 31000), null);
      s.setItem(Channel.PENDING_KEY, "{not json");
      assert.equal(Channel.takePending(s, "/@veritasium"), null);
      s.setItem(Channel.PENDING_KEY, JSON.stringify({ mode: "evil", root: "/@veritasium", at: Date.now() }));
      assert.equal(Channel.takePending(s, "/@veritasium"), null);
      assert.equal(Channel.savePending(null, "oldest", "/@veritasium"), false);
      assert.equal(Channel.takePending(null, "/@veritasium"), null);
    });
  });

  describe("wiring", () => {
    test("counting a channel play before leaving the page never spends the rating ask", async () => {
      const { Stats } = window.RYP;
      globalThis.browser.storage.local.data = {};
      for (let i = 0; i < Stats.RATING_AFTER_ACTIONS + 1; i++) {
        assert.equal(await Stats.bump("channel", { quiet: true }), false);
      }
      const data = globalThis.browser.storage.local.data;
      assert.equal(data.ryp_stats.actions.channel, Stats.RATING_AFTER_ACTIONS + 1);
      assert.equal(data.ryp_rating, undefined);
    });

    test("channelPlay is a button key everywhere settings are read or written", () => {
      const { Backup } = window.RYP;
      assert.ok(Backup.BUTTON_KEYS.includes("channelPlay"));
      assert.deepEqual(
        Backup.normalizeSettings({ buttonVisibility: { channelPlay: false } }),
        { buttonVisibility: { channelPlay: false } }
      );
      const popupHtml = fs.readFileSync("popup/popup.html", "utf8");
      const popupJs = fs.readFileSync("popup/popup.js", "utf8");
      const welcomeJs = fs.readFileSync("popup/welcome.js", "utf8");
      const toolbarJs = fs.readFileSync("src/toolbar.js", "utf8");
      for (const key of Backup.BUTTON_KEYS) {
        assert.match(popupHtml, new RegExp(`data-btn-key="${key}"`), `popup.html checkbox for ${key}`);
        assert.match(popupJs, new RegExp(`\\n\\s+${key}: true,`), `DEFAULT_BUTTON_VISIBILITY.${key}`);
        assert.match(welcomeJs, new RegExp(`"${key}"`), `welcome.js BUTTON_KEYS has ${key}`);
      }
      assert.match(toolbarJs, /channelPlay: \["#ryp-channel-bar"\]/);
    });

    test("manifest loads channel.js before the toolbar that uses it", () => {
      const js = JSON.parse(fs.readFileSync("manifest.json", "utf8")).content_scripts[0].js;
      assert.ok(js.includes("src/channel.js"));
      assert.ok(js.indexOf("src/channel.js") < js.indexOf("src/toolbar.js"));
      assert.ok(js.indexOf("src/stats.js") < js.indexOf("src/channel.js"));
    });
  });
});
