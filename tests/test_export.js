/*
 * YouTube Playlist Tools — test_export.js
 *
 * The text / CSV list export: formatting (quoting, formula-injection guard,
 * BOM), order resolution (what the sidebar shows vs. a snapshot's saved
 * order), file names, the shared Panel.exportVideos entry point, and the
 * wiring of the new `export` button-visibility key.
 */
import "./setup.js";
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const item = (index, videoId, title = `Video ${index}`, channel = "", durationStr = "") =>
  ({ index, videoId, title, channel, durationStr });

describe("List export (text / CSV)", async () => {
  let Export;
  let originalCreateElement;

  before(async () => {
    await import("../src/backup.js");
    await import("../src/export.js");
    await import("../src/state.js");
    await import("../src/playlist.js");
    await import("../src/playback.js");
    await import("../src/panel.js");
    Export = window.RYP.Export;
    originalCreateElement = document.createElement;
    // The setup.js mock elements have no remove() or style; copyText's
    // textarea and showToast's node both need them.
    document.createElement = (tag) => {
      const node = originalCreateElement(tag);
      node.remove = () => {};
      node.style = {};
      return node;
    };
  });

  after(() => {
    document.createElement = originalCreateElement;
  });

  describe("csvCell", () => {
    test("leaves plain values alone and writes numbers as they are", () => {
      assert.equal(Export.csvCell("Lofi beats"), "Lofi beats");
      assert.equal(Export.csvCell(12), "12");
      assert.equal(Export.csvCell(""), "");
      assert.equal(Export.csvCell(null), "");
      assert.equal(Export.csvCell(undefined), "");
    });

    test("quotes commas, quotes and line breaks (RFC 4180)", () => {
      assert.equal(Export.csvCell("Rock, Paper"), '"Rock, Paper"');
      assert.equal(Export.csvCell('He said "hi"'), '"He said ""hi"""');
      assert.equal(Export.csvCell("two\nlines"), '"two\nlines"');
      assert.equal(Export.csvCell("cr\r\nlf"), '"cr\r\nlf"');
    });

    test("defuses cells a spreadsheet would run as a formula", () => {
      assert.equal(Export.csvCell("=HYPERLINK(\"x\")"), '"\'=HYPERLINK(""x"")"');
      assert.equal(Export.csvCell("+1 trick"), "'+1 trick");
      assert.equal(Export.csvCell("-5 kg"), "'-5 kg");
      assert.equal(Export.csvCell("@channel"), "'@channel");
      assert.equal(Export.csvCell("\tcmd"), "'\tcmd");
      assert.equal(Export.csvCell("=1+1,2"), "\"'=1+1,2\"", "guard first, then quote");
      // Only the first character matters.
      assert.equal(Export.csvCell("a=b"), "a=b");
    });
  });

  describe("formatCsv", () => {
    const rows = () => Export.toRows([
      item(1, "abcDEF12345", "Intro, part 1", "Chan \"A\"", "1:02"),
      item(2, "xyz_-987654", "=cmd|' /C calc'!A0", "@evil", "10:00"),
      item(3, "arabic00001", "درس البرمجة الأول", "قناة التعليم", "1:02:03"),
    ]);

    test("starts with a UTF-8 BOM and the header, with CRLF line ends", () => {
      const csv = Export.formatCsv(rows());
      assert.ok(csv.startsWith("﻿position,title,channel,duration,url\r\n"));
      assert.ok(csv.endsWith("\r\n"));
      const lines = csv.slice(1).split("\r\n");
      assert.equal(lines.length, 5, "header + 3 rows + trailing empty");
      assert.equal(lines[4], "");
    });

    test("writes each row in order, quoted and guarded", () => {
      const lines = Export.formatCsv(rows()).slice(1).split("\r\n");
      assert.equal(lines[1], '1,"Intro, part 1","Chan ""A""",1:02,https://www.youtube.com/watch?v=abcDEF12345');
      assert.equal(lines[2], "2,'=cmd|' /C calc'!A0,'@evil,10:00,https://www.youtube.com/watch?v=xyz_-987654");
      assert.equal(lines[3], "3,درس البرمجة الأول,قناة التعليم,1:02:03,https://www.youtube.com/watch?v=arabic00001");
    });

    test("encodes Arabic as UTF-8 with the EF BB BF marker Excel looks for", () => {
      const bytes = Buffer.from(Export.formatCsv(rows()), "utf8");
      assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
      assert.ok(bytes.toString("utf8").includes("درس البرمجة الأول"));
    });

    test("bom: false drops the marker; an empty list is just the header", () => {
      assert.equal(Export.formatCsv([], { bom: false }), "position,title,channel,duration,url\r\n");
    });
  });

  describe("formatText", () => {
    test("one numbered line per video, URL underneath", () => {
      const text = Export.formatText(Export.toRows([
        item(1, "vid00000001", "First", "Chan", "3:15"),
        item(2, "vid00000002", "Second", "", ""),
      ]));
      assert.equal(
        text,
        "1. First — Chan (3:15)\n   https://www.youtube.com/watch?v=vid00000001\n" +
        "2. Second\n   https://www.youtube.com/watch?v=vid00000002\n"
      );
    });

    test("adds the playlist name as a heading and folds stray line breaks", () => {
      const text = Export.formatText(
        Export.toRows([item(1, "vid00000001", "Multi\n  line   title", "  Chan  ", "1:00")]),
        { title: "  My   course " }
      );
      assert.equal(text, "My course\n\n1. Multi line title — Chan (1:00)\n   https://www.youtube.com/watch?v=vid00000001\n");
    });

    test("falls back to the video id when a row has no title", () => {
      const text = Export.formatText(Export.toRows([item(1, "noTitle0001", "")]));
      assert.ok(text.startsWith("1. noTitle0001\n"));
    });

    test("nothing to list gives an empty string", () => {
      assert.equal(Export.formatText([]), "");
    });
  });

  describe("toRows", () => {
    test("numbers rows in the given order and drops rows without a video id", () => {
      const rows = Export.toRows([item(7, "b0000000002"), item(3, ""), item(1, "a0000000001")]);
      assert.deepEqual(rows.map((r) => [r.position, r.videoId]), [[1, "b0000000002"], [2, "a0000000001"]]);
      assert.equal(rows[0].url, "https://www.youtube.com/watch?v=b0000000002");
    });
  });

  describe("orderItems — the order the sidebar shows", () => {
    const items = [item(1, "v1"), item(2, "v2"), item(3, "v3"), item(4, "v4")];
    const ids = (list) => list.map((it) => it.videoId);

    test("no order keeps playlist order", () => {
      assert.deepEqual(ids(Export.orderItems(items, null)), ["v1", "v2", "v3", "v4"]);
      assert.deepEqual(ids(Export.orderItems(items, [])), ["v1", "v2", "v3", "v4"]);
    });

    test("reverse (visibleOrderKeys of a reversed list)", () => {
      assert.deepEqual(ids(Export.orderItems(items, ["v4", "v3", "v2", "v1"])), ["v4", "v3", "v2", "v1"]);
    });

    test("id-keyed custom order, with legacy positions mixed in", () => {
      assert.deepEqual(ids(Export.orderItems(items, ["v3", 1, "v4", 2])), ["v3", "v1", "v4", "v2"]);
    });

    test("rows the order does not mention sink to the end, like CSS order 9999", () => {
      assert.deepEqual(ids(Export.orderItems(items, ["v3", "gone", "v1"])), ["v3", "v1", "v2", "v4"]);
    });

    test("does not mutate its input", () => {
      const copy = items.slice();
      Export.orderItems(items, ["v4", "v1"]);
      assert.deepEqual(items, copy);
    });
  });

  describe("snapshotItems — a saved list's own order", () => {
    const snapshot = {
      order: [3, 1, 2],
      videos: [
        { index: 1, videoId: "s1", title: "One", channel: "A", durationStr: "1:00" },
        { index: 2, videoId: "s2", title: "Two" },
        { index: 3, videoId: "s3", title: "Three" },
      ],
    };

    test("follows `order`, keeping each video's metadata", () => {
      const out = Export.snapshotItems(snapshot);
      assert.deepEqual(out.map((v) => v.videoId), ["s3", "s1", "s2"]);
      assert.equal(out[1].channel, "A");
      assert.deepEqual(
        out.map((v) => v.videoId),
        window.RYP.Backup.orderVideoIds(snapshot),
        "agrees with the order snapshots replay in"
      );
    });

    test("skips stale positions and falls back to the video list without an order", () => {
      assert.deepEqual(Export.snapshotItems({ ...snapshot, order: [9, 2] }).map((v) => v.videoId), ["s2"]);
      assert.deepEqual(Export.snapshotItems({ ...snapshot, order: [] }).map((v) => v.videoId), ["s1", "s2", "s3"]);
      assert.deepEqual(Export.snapshotItems(null), []);
    });
  });

  describe("fileName", () => {
    const day = new Date("2026-11-05T12:00:00Z");

    test("playlist name plus date, with forbidden characters removed", () => {
      assert.equal(Export.fileName("My: Mix / 2026?", "csv", day), "My Mix 2026-2026-11-05.csv");
      assert.equal(Export.fileName('a<b>"c"|d*', "txt", day), "a b c d-2026-11-05.txt");
      assert.equal(Export.fileName("..hidden..", "txt", day), "hidden-2026-11-05.txt");
    });

    test("keeps Arabic names, and names an unnamed list 'playlist'", () => {
      assert.equal(Export.fileName("قائمتي المفضلة", "csv", day), "قائمتي المفضلة-2026-11-05.csv");
      assert.equal(Export.fileName("", "csv", day), "playlist-2026-11-05.csv");
      assert.equal(Export.fileName("   ", "txt", day), "playlist-2026-11-05.txt");
      assert.equal(Export.fileName("x".repeat(200), "csv", day).length, 80 + "-2026-11-05.csv".length);
    });
  });

  describe("copyText", () => {
    test("uses the async clipboard when the page has one", async () => {
      let written = null;
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: async (t) => { written = t; } },
        configurable: true,
      });
      try {
        assert.equal(await Export.copyText("hello"), true);
        assert.equal(written, "hello");
      } finally {
        delete navigator.clipboard;
      }
    });

    test("reports failure instead of throwing when every route is blocked", async () => {
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: async () => { throw new Error("NotAllowedError"); } },
        configurable: true,
      });
      try {
        // The test DOM has no execCommand, so the legacy route fails too.
        assert.equal(await Export.copyText("hello"), false);
      } finally {
        delete navigator.clipboard;
      }
    });
  });

  describe("Panel.exportVideos", () => {
    let originalDownload;
    let originalCopy;
    let downloads;

    before(() => {
      originalDownload = Export.download;
      originalCopy = Export.copyText;
    });

    after(() => {
      Export.download = originalDownload;
      Export.copyText = originalCopy;
    });

    const videos = [item(1, "vid00000001", "Alpha", "Chan", "1:00"), item(2, "vid00000002", "Beta")];

    test("csv downloads a BOM-prefixed file named after the list", async () => {
      downloads = [];
      Export.download = (content, name, mime) => downloads.push({ content, name, mime });
      assert.equal(await window.RYP.Panel.exportVideos("csv", videos, "Course"), true);
      assert.equal(downloads.length, 1);
      assert.match(downloads[0].name, /^Course-\d{4}-\d{2}-\d{2}\.csv$/);
      assert.equal(downloads[0].mime, "text/csv;charset=utf-8");
      assert.ok(downloads[0].content.startsWith("﻿position,title,channel,duration,url\r\n1,Alpha,Chan,1:00,"));
    });

    test("txt downloads the plain list", async () => {
      downloads = [];
      Export.download = (content, name, mime) => downloads.push({ content, name, mime });
      await window.RYP.Panel.exportVideos("txt", videos, "Course");
      assert.match(downloads[0].name, /\.txt$/);
      assert.equal(downloads[0].mime, "text/plain;charset=utf-8");
      assert.ok(downloads[0].content.startsWith("Course\n\n1. Alpha — Chan (1:00)\n"));
    });

    test("copy hands the text list to the clipboard", async () => {
      let copied = null;
      Export.copyText = async (t) => { copied = t; return true; };
      assert.equal(await window.RYP.Panel.exportVideos("copy", videos, ""), true);
      assert.ok(copied.startsWith("1. Alpha — Chan (1:00)\n   https://www.youtube.com/watch?v=vid00000001\n2. Beta\n"));
    });

    test("an empty list exports nothing", async () => {
      downloads = [];
      Export.download = (content, name, mime) => downloads.push({ content, name, mime });
      assert.equal(await window.RYP.Panel.exportVideos("csv", [], "Empty"), false);
      assert.equal(downloads.length, 0);
    });
  });

  describe("wiring", () => {
    test("`export` is in every button-visibility list", () => {
      const keys = window.RYP.Backup.BUTTON_KEYS;
      assert.ok(keys.includes("export"));

      const popupHtml = fs.readFileSync("popup/popup.html", "utf8");
      const popupJs = fs.readFileSync("popup/popup.js", "utf8");
      const welcomeJs = fs.readFileSync("popup/welcome.js", "utf8");
      const toolbarJs = fs.readFileSync("src/toolbar.js", "utf8");
      const welcomeKeys = JSON.parse(welcomeJs.match(/const BUTTON_KEYS = (\[[^\]]*\])/)[1]);
      assert.deepEqual(welcomeKeys, keys, "welcome.js BUTTON_KEYS matches backup.js");
      for (const key of keys) {
        assert.ok(popupHtml.includes(`data-btn-key="${key}"`), `popup.html has a ${key} checkbox`);
        assert.match(popupJs, new RegExp(`\\n\\s+${key}: true,`), `popup.js defaults ${key} to visible`);
      }
      assert.match(toolbarJs, /export: \["#ryp-export-wrapper", "#ryp-ov-export-wrapper"\]/);
    });

    test("export.js loads before the panel and toolbar that use it", () => {
      const js = JSON.parse(fs.readFileSync("manifest.json", "utf8")).content_scripts[0].js;
      assert.ok(js.includes("src/export.js"));
      assert.ok(js.indexOf("src/export.js") < js.indexOf("src/panel.js"));
      assert.ok(js.indexOf("src/export.js") < js.indexOf("src/toolbar.js"));
    });
  });
});
