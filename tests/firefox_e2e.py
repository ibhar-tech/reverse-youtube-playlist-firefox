#!/usr/bin/env python3
"""
End-to-end test of the extension in real Firefox, via geckodriver's WebDriver
HTTP API. Uses only the standard library — geckodriver is the sole dependency.

    tests/firefox_e2e.py [--headed] [--geckodriver PATH]

Installs the working tree as a temporary add-on, drives youtube.com, and
asserts on the DOM the content script produced. Exits non-zero on failure.
"""
import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLAYLIST = "PLBlnK6fEyqRiueC_HzwFallNO76hfXBB7"  # public, 119 videos
WATCH_URL = f"https://www.youtube.com/watch?v=4EaYeZyzIB0&list={PLAYLIST}"
SEARCH_URL = "https://www.youtube.com/results?search_query=python+full+course&sp=EgIQAw%253D%253D"
OVERVIEW_URL = f"https://www.youtube.com/playlist?list={PLAYLIST}"
STANDALONE_URL = "https://www.youtube.com/watch?v=wdp7smAtqZI"


class WebDriver:
    def __init__(self, port, headed):
        self.base = f"http://127.0.0.1:{port}"
        self.headed = headed
        self.session = None

    def _req(self, method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(
            self.base + path, data=data, method=method,
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.loads(r.read() or "{}").get("value")
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"{method} {path} -> {e.code}: {e.read().decode()[:400]}")

    def start(self, extra_prefs=None, extra_args=()):
        args = ([] if self.headed else ["-headless"]) + list(extra_args)
        prefs = {
            # Keep the run deterministic and quiet.
            "datareporting.policy.firstRunURL": "",
            "browser.shell.checkDefaultBrowser": False,
        }
        prefs.update(extra_prefs or {})
        caps = {"capabilities": {"alwaysMatch": {
            "browserName": "firefox",
            "moz:firefoxOptions": {"args": args, "prefs": prefs},
        }}}
        self.session = self._req("POST", "/session", caps)["sessionId"]

    def install_addon(self, path):
        return self._req("POST", f"/session/{self.session}/moz/addon/install",
                         {"path": path, "temporary": True})

    def go(self, url):
        self._req("POST", f"/session/{self.session}/url", {"url": url})

    def url(self):
        return self._req("GET", f"/session/{self.session}/url")

    def js(self, script):
        return self._req("POST", f"/session/{self.session}/execute/sync",
                         {"script": script, "args": []})

    def quit(self):
        if self.session:
            try:
                self._req("DELETE", f"/session/{self.session}")
            except Exception:
                pass


RESULTS = []


def check(name, condition, detail=""):
    RESULTS.append((name, bool(condition), detail))
    print(f"  {'PASS' if condition else 'FAIL'}  {name}" + (f"  [{detail}]" if detail else ""))
    return bool(condition)


SKIPPED = []


def inconclusive(name, why):
    """The environment could not exercise this — never silently a pass."""
    SKIPPED.append(name)
    print(f"  SKIP  {name}  [{why}]")


def settle(d, selector, timeout=25):
    """Wait until a selector appears (the content script runs at document_idle)."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if d.js(f"return !!document.querySelector({json.dumps(selector)});"):
            return True
        time.sleep(0.5)
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--geckodriver", default="geckodriver")
    ap.add_argument("--port", type=int, default=4444)
    args = ap.parse_args()

    proc = subprocess.Popen(
        [args.geckodriver, "--port", str(args.port)],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    time.sleep(2)
    d = WebDriver(args.port, args.headed)
    try:
        d.start()
        addon = d.install_addon(REPO)
        print(f"Installed add-on: {addon}\n")

        # ── 1. Search results: no per-card pills ─────────────────────────────
        print("Search results page")
        d.go(SEARCH_URL)
        settle(d, "ytd-app")
        time.sleep(4)
        r = d.js("""return {
            pills: document.querySelectorAll('.ryp-card-add-pill').length,
            lockups: document.querySelectorAll('yt-lockup-view-model').length,
            panel: !!document.querySelector('#ryp-saved-panel')
        };""")
        check("extension is live on search", r["panel"])
        check("no add pills on cards", r["pills"] == 0, f"{r['lockups']} cards, {r['pills']} pills")

        # ── 2. Watch page with playlist ──────────────────────────────────────
        print("\nWatch page with playlist")
        d.go(WATCH_URL)
        check("toolbar injected", settle(d, "#ryp-toolbar"))
        time.sleep(5)
        r = d.js("""return {
            buttons: [...document.querySelectorAll('#ryp-toolbar .ryp-btn .ryp-label')].map(e=>e.textContent),
            duration: document.querySelector('#ryp-duration-pill .ryp-duration-text')?.textContent || null,
            addBtn: !!document.querySelector('#ryp-add-video-btn'),
            sidebarItems: document.querySelectorAll('ytd-playlist-panel-video-renderer').length,
            pillsInSidebar: document.querySelectorAll('ytd-playlist-panel-video-renderer .ryp-card-add-pill').length,
            fakeRows: document.querySelectorAll('.ryp-custom-playlist-item').length
        };""")
        check("all toolbar buttons present", len(r["buttons"]) >= 7, ", ".join(r["buttons"]))
        check("duration pill computed", bool(r["duration"]) and r["duration"] != "0s (0s)", r["duration"])
        check("add-to-playlist button present", r["addBtn"])
        check("sidebar items read", r["sidebarItems"] > 0, f"{r['sidebarItems']} items")
        check("no pills in sidebar", r["pillsInSidebar"] == 0)
        check("no fake injected rows", r["fakeRows"] == 0)

        # ── 3. Sort dropdown opens on first click ────────────────────────────
        r = d.js("""document.querySelector('#ryp-btn-sort').click();
            return {open: !!document.querySelector('#ryp-sort-menu.ryp-menu-show'),
                    options: document.querySelectorAll('.ryp-dropdown-item').length};""")
        check("sort opens on first click", r["open"], f"{r['options']} presets")
        d.js("document.body.click();")

        # ── 4. Create a local playlist from inside a playlist page ───────────
        print("\nAdd to local playlist")
        d.js("document.querySelector('#ryp-add-video-btn').click();")
        time.sleep(1.5)
        r = d.js("""const m=document.querySelector('#ryp-custom-modal'); if(!m) return {modal:false};
            return {modal:true, subhead: m.querySelector('.ryp-modal-subhead')?.textContent,
                    targets: [...m.querySelectorAll('.ryp-playlist-select-item')].length,
                    preview: m.querySelector('.ryp-preview-title')?.textContent};""")
        check("add modal opens", r["modal"])
        check("modal previews the current video", bool(r.get("preview")), r.get("preview"))
        check("local-playlist heading shown", r.get("subhead") == "Your local playlists", r.get("subhead"))
        check("no playlist snapshots offered as targets", r.get("targets") == 0)

        d.js("""const m=document.querySelector('#ryp-custom-modal');
            m.querySelector('.ryp-modal-input').value='FF Local Mix';
            m.querySelector('.ryp-modal-btn-confirm').click();""")
        time.sleep(2)
        check("creating a local playlist confirms",
              "FF Local Mix" in (d.js("return document.querySelector('#ryp-toast')?.textContent || '';") or ""))

        # ── 5. Add a second video from a standalone page ─────────────────────
        d.go(STANDALONE_URL)
        check("add button on standalone watch page", settle(d, "#ryp-add-video-btn"))
        time.sleep(3)
        d.js("document.querySelector('#ryp-add-video-btn').click();")
        time.sleep(1.5)
        r = d.js("""const m=document.querySelector('#ryp-custom-modal');
            const row=m?.querySelector('.ryp-playlist-select-item');
            const label=row?.textContent; row?.querySelector('.ryp-btn-add')?.click();
            return {label};""")
        check("local playlist listed as a target", "FF Local Mix" in (r.get("label") or ""), r.get("label"))
        time.sleep(2)

        # ── 6. Play the local playlist: the whole point ──────────────────────
        print("\nPlaying the local playlist")
        d.go(WATCH_URL)
        settle(d, "#ryp-btn-playlists")
        time.sleep(4)
        d.js("document.querySelector('#ryp-btn-playlists').click();")
        time.sleep(2)
        r = d.js("""const c=[...document.querySelectorAll('.ryp-saved-card')];
            const card=c.find(x=>x.textContent.includes('FF Local Mix'));
            const meta=card?.querySelector('.ryp-saved-meta')?.textContent;
            card?.querySelector('.ryp-action-play')?.click();
            return {found: !!card, meta};""")
        check("local playlist in My Lists", r["found"], r.get("meta"))
        check("count reflects both videos", "2 " in (r.get("meta") or ""), r.get("meta"))
        time.sleep(8)

        r = d.js("""const p=document.querySelector('#ryp-virtual-playlist-panel');
            return {url: location.href, panel: !!p,
                    header: p?.querySelector('.ryp-virtual-title')?.textContent,
                    count: p?.querySelector('#ryp-virtual-count')?.textContent,
                    items: [...(p?.querySelectorAll('.ryp-custom-playlist-item')||[])]
                             .map(i=>i.querySelector('#video-title')?.textContent),
                    bg: p ? getComputedStyle(p).backgroundColor : null};""")
        check("hash param survives navigation", "#ryp_list=" in r["url"], r["url"][-60:])
        check("virtual panel renders", r["panel"])
        check("panel titled with the playlist name", r.get("header") == "FF Local Mix", r.get("header"))
        check("both added videos are shown", len(r.get("items") or []) == 2,
              " | ".join(i or "?" for i in (r.get("items") or [])))
        check("panel has a solid background", r.get("bg") not in (None, "rgba(0, 0, 0, 0)"), r.get("bg"))

        # Rows must actually RENDER. Reading textContent is not enough: when the
        # rows were <ytd-playlist-panel-video-renderer>, Polymer upgraded them
        # and stamped an empty template over our children, so the panel showed
        # blank boxes while a textContent-only assertion still passed.
        rows = d.js("""const rows=[...document.querySelectorAll('#ryp-virtual-playlist-panel .ryp-custom-playlist-item')];
            return rows.map(row => {
              const t=row.querySelector('#video-title'), i=row.querySelector('img');
              const rb=row.getBoundingClientRect(), tb=t?.getBoundingClientRect();
              return {rowH: Math.round(rb.height), titleText: t?.textContent || '',
                      titleH: tb ? Math.round(tb.height) : 0,
                      imgLoaded: !!i && i.complete && i.naturalWidth > 0,
                      duration: row.querySelector('[class*="badge-shape-wiz__text"]')?.textContent || ''};
            });""")
        check("rows have real height", bool(rows) and all(x["rowH"] > 20 for x in rows),
              ", ".join(str(x["rowH"]) + "px" for x in rows) or "no rows")
        check("titles are laid out, not just present",
              bool(rows) and all(x["titleText"].strip() and x["titleH"] > 0 for x in rows),
              ", ".join(f'{x["titleH"]}px "{x["titleText"][:22]}"' for x in rows))
        check("thumbnails load", bool(rows) and all(x["imgLoaded"] for x in rows))
        check("rows carry a duration", bool(rows) and all(x["duration"].strip() for x in rows),
              ", ".join(x["duration"] for x in rows))

        stats = d.js("""return document.querySelector('#ryp-duration-pill .ryp-duration-text')?.textContent || '';""")
        check("virtual playlist reports watch-time stats",
              bool(stats) and stats != "0s (0s)", stats or "(no pill)")

        # Auto-advance: seek to the end and confirm playback moves to item 2 on
        # its own. A local playlist that cannot advance is not a playlist.
        # Seek to the final fraction of a second rather than trying to play
        # through several seconds — headless Firefox stalls on sustained
        # playback, but the near-end trigger fires straight after this seek.
        seeked = d.js("""const p=document.getElementById('movie_player');
            if (!p || !p.seekTo) return false;
            p.mute(); const dur=p.getDuration();
            if (!dur || dur < 5) return false;
            p.seekTo(dur - 0.2, true); p.playVideo(); return true;""")
        moved = False
        if seeked:
            deadline = time.time() + 60
            while time.time() < deadline:
                if "ryp_index=2" in d.url():
                    moved = True
                    break
                time.sleep(2)
        if moved:
            check("auto-advances to the next video at end of playback", True, d.url()[-46:])
            time.sleep(6)
            r2 = d.js("""const p=document.querySelector('#ryp-virtual-playlist-panel');
                return {panel: !!p, selected: p?.querySelector('.selected #video-title')?.textContent};""")
            check("panel survives the auto-advance", r2["panel"])
        else:
            reached = d.js("""const v=document.querySelector('video');
                return v && isFinite(v.duration) ? Math.round(v.duration - v.currentTime) : null;""")
            inconclusive("auto-advances at end of playback",
                         f"playback stalled {reached}s from the end" if reached is not None
                         else "player never reported a duration")

        # ...and manual navigation back to item 1 still works.
        d.js("""document.querySelectorAll('#ryp-virtual-playlist-panel .ryp-custom-playlist-item')[0]
                .querySelector('a').click();""")
        time.sleep(8)
        r3 = d.js("""return {url: location.href,
                    panel: !!document.querySelector('#ryp-virtual-playlist-panel')};""")
        check("clicking a row navigates within the playlist",
              r3["panel"] and "ryp_index=1" in r3["url"], r3["url"][-46:])

        # ── 7. Overview page ─────────────────────────────────────────────────
        print("\nPlaylist overview page")
        d.go(OVERVIEW_URL)
        check("overview toolbar injected", settle(d, "#ryp-overview-toolbar"))
        time.sleep(5)
        r = d.js("""const bar=document.querySelector('#ryp-overview-toolbar');
            const LID=%s;
            const all=[...document.querySelectorAll('yt-lockup-view-model')];
            const mine=all.filter(l=>{const a=l.querySelector('a[href*="/watch?v="]');
                return a && new URL(a.getAttribute('href'),location.origin).searchParams.get('list')===LID;});
            return {buttons: [...(bar?.querySelectorAll('.ryp-btn .ryp-label')||[])].map(e=>e.textContent),
                    duration: bar?.querySelector('#ryp-overview-duration-pill .ryp-duration-text')?.textContent,
                    lockups: all.length, mine: mine.length};""" % json.dumps(PLAYLIST))
        check("overview buttons present", len(r["buttons"]) >= 3, ", ".join(r["buttons"]))
        # Presence is not enough. The header keeps a display:none legacy
        # ytd-menu-renderer whose #top-level-buttons-computed matched our
        # container search, so the toolbar existed and read fine while
        # rendering nowhere at all.
        box = d.js("""const b=document.querySelector('#ryp-overview-toolbar');
            if(!b) return null; const r=b.getBoundingClientRect();
            return [Math.round(r.width), Math.round(r.height)];""")
        check("overview toolbar is actually laid out",
              bool(box) and box[0] > 0 and box[1] > 0,
              f"{box[0]}x{box[1]}" if box else "no toolbar")
        check("overview reads playlist items", r["mine"] > 0, f"{r['mine']} of {r['lockups']} lockups")
        check("overview duration computed", bool(r["duration"]) and r["duration"] != "0s (0s)", r["duration"])

        # ── 8. Play Reverse must resolve the full list first ─────────────────
        # Recommendation shelves load on scroll and are built from the same
        # element, so a wrong count here sends YouTube to a bogus position.
        print("\nOverview -> Play Reverse")
        d.js("document.querySelector('#ryp-ov-reverse').click();")
        deadline = time.time() + 120
        while time.time() < deadline and "/playlist" in d.url():
            time.sleep(2)
        time.sleep(8)
        # YouTube renders the "n / total" counter twice inside #publisher-container,
        # so read the first span rather than regexing the concatenated text.
        r = d.js("""const p=document.querySelector('ytd-playlist-panel-renderer');
            const spans=[...(p?.querySelectorAll('#publisher-container span')||[])].map(s=>s.textContent.trim());
            const counter=spans.find(t=>/^\\d+\\s*\\/\\s*\\d+$/.test(t)) || '';
            const m=counter.match(/^(\\d+)\\s*\\/\\s*(\\d+)$/);
            return {url: location.href, counter,
                    position: m ? Number(m[1]) : null, total: m ? Number(m[2]) : null,
                    reverseOn: !!document.querySelector('#ryp-btn-reverse.ryp-active')};""")
        check("Play Reverse leaves the overview page", "/watch" in r["url"])
        check("lands on the LAST video of the playlist",
              r["position"] is not None and r["position"] == r["total"],
              f"position {r['position']} of {r['total']}")
        check("reverse mode is armed on arrival", r["reverseOn"])

        # ── 9. YouTube In-Page Panel Export & Import Controls ─────────────────
        print("\nYouTube In-Page Panel Export & Import Controls")
        settle(d, "#ryp-btn-playlists")
        d.js("const btn=document.querySelector('#ryp-btn-playlists'); if(btn) btn.click();")
        time.sleep(1.5)
        r_panel = d.js("""
            const panel = document.querySelector('#ryp-saved-panel');
            return {
                panelVisible: !!panel && !panel.classList.contains('ryp-hidden'),
                exportBtn: !!document.querySelector('#ryp-export-btn'),
                importBtn: !!document.querySelector('#ryp-import-btn'),
                importInput: !!document.querySelector('#ryp-import-input')
            };
        """)
        check("My Lists panel opens on YouTube", r_panel["panelVisible"])
        check("Export button present in YouTube panel", r_panel["exportBtn"])
        check("Import button present in YouTube panel", r_panel["importBtn"])
        check("Import file input present in YouTube panel", r_panel["importInput"])
        d.js("const btn=document.querySelector('#ryp-btn-playlists'); if(btn) btn.click();")
        time.sleep(0.5)

        # ── 10. UI Test Harness: Button Visibility, Autoplay & Backup ─────────
        print("\nUI Test Harness (Toolbar Visibility, Autoplay & Backup)")
        harness_path = os.path.join(REPO, "tests", "ui_test_harness.html")
        d.go(f"file://{harness_path}")
        settle(d, "#ryp-toolbar")
        time.sleep(2)

        # A. Button Visibility Control
        r_vis = d.js("""
            if (!window.RYP || !window.RYP.Toolbar) return { ok: false, why: "no Toolbar" };
            window.RYP.Toolbar.setButtonVisibility({ reverse: false, shuffle: false, sort: true });
            const rev = document.querySelector('#ryp-btn-reverse');
            const shuf = document.querySelector('#ryp-btn-shuffle');
            const sort = document.querySelector('#ryp-btn-sort');
            return {
                ok: true,
                revHidden: rev ? rev.classList.contains('ryp-hidden') : false,
                revDisplay: rev ? getComputedStyle(rev).display : null,
                shufHidden: shuf ? shuf.classList.contains('ryp-hidden') : false,
                shufDisplay: shuf ? getComputedStyle(shuf).display : null,
                sortHidden: sort ? sort.classList.contains('ryp-hidden') : false,
                sortDisplay: sort ? getComputedStyle(sort).display : null,
            };
        """)
        check("button visibility toggles work", r_vis["ok"], r_vis.get("why", ""))
        check("reverse button is hidden with ryp-hidden", r_vis.get("revHidden") and r_vis.get("revDisplay") == "none",
              f"class={r_vis.get('revHidden')}, display={r_vis.get('revDisplay')}")
        check("shuffle button is hidden with ryp-hidden", r_vis.get("shufHidden") and r_vis.get("shufDisplay") == "none",
              f"class={r_vis.get('shufHidden')}, display={r_vis.get('shufDisplay')}")
        check("sort button remains visible", not r_vis.get("sortHidden") and r_vis.get("sortDisplay") != "none",
              f"display={r_vis.get('sortDisplay')}")

        # Restore button visibility
        d.js("window.RYP.Toolbar.setButtonVisibility({ reverse: true, shuffle: true, sort: true });")
        time.sleep(0.5)
        r_vis_restored = d.js("""
            const rev = document.querySelector('#ryp-btn-reverse');
            return rev ? !rev.classList.contains('ryp-hidden') && getComputedStyle(rev).display !== 'none' : false;
        """)
        check("buttons re-appear when visibility is restored", r_vis_restored)

        # B. Autoplay Control Settings
        r_ap = d.js("""
            if (!window.RYP || !window.RYP.Playback) return { ok: false };
            const isOff = window.RYP.Playback.isAutoplayDisabled();
            return {
                ok: true,
                isOffDetected: typeof isOff === 'boolean',
                hasCancelAutonav: typeof window.RYP.Playback.cancelYouTubeAutonav === 'function'
            };
        """)
        check("autoplay detection helper available in page", r_ap["ok"] and r_ap["isOffDetected"])
        check("autonav cancellation helper present", r_ap.get("hasCancelAutonav", False))

        # C. Export & Import Round-trip with Settings
        r_backup = d.js("""
            if (!window.RYP || !window.RYP.Backup) return { ok: false, why: "no Backup" };
            const Backup = window.RYP.Backup;

            // Create a test playlist and custom settings
            const testSnapshot = {
                id: "e2e-imported-list",
                name: "E2E Exported Mix",
                tags: ["test", "e2e"],
                sourceListId: "",
                order: [1],
                videos: [{ index: 1, videoId: "4EaYeZyzIB0", title: "Python intro", durationStr: "7:28" }],
                savedAt: new Date().toISOString()
            };
            const testSettings = {
                lang: "fr",
                disableAutoplay: true,
                compact: true,
                buttonVisibility: { reverse: false, shuffle: true }
            };

            // Test parsing a full backup payload with playlists + settings
            const payload = {
                schema: "ryp-saved-playlists",
                schemaVersion: 2,
                exportedAt: new Date().toISOString(),
                settings: testSettings,
                playlists: [testSnapshot]
            };
            const jsonText = JSON.stringify(payload);
            const parsed = Backup.parseBackup(jsonText);
            const importArray = Backup.parseImport(jsonText);

            // Test snapshot merge
            const existing = [];
            const { merged, added } = Backup.mergeSnapshots(existing, importArray);

            // Test settings merge
            const baseSettings = { lang: "en", disableAutoplay: false };
            const mergedSettings = Backup.mergeSettings(baseSettings, importArray.settings);

            return {
                ok: true,
                parsedPlaylistsCount: parsed.playlists.length,
                parsedSettingsDisableAutoplay: parsed.settings?.disableAutoplay,
                parsedSettingsLang: parsed.settings?.lang,
                importArrayCount: importArray.length,
                importArraySettingsAttached: !!importArray.settings,
                mergeAdded: added,
                mergedSnapshotName: merged[0]?.name,
                mergedSettingsDisableAutoplay: mergedSettings.disableAutoplay,
                mergedSettingsLang: mergedSettings.lang
            };
        """)
        check("backup parse and import functional", r_backup["ok"], r_backup.get("why", ""))
        check("export payload includes playlist and settings",
              r_backup.get("parsedPlaylistsCount") == 1 and r_backup.get("parsedSettingsDisableAutoplay") is True)
        check("parseImport attaches normalized settings to array",
              r_backup.get("importArrayCount") == 1 and r_backup.get("importArraySettingsAttached") is True)
        check("merged snapshots preserve playlist data",
              r_backup.get("mergeAdded") == 1 and r_backup.get("mergedSnapshotName") == "E2E Exported Mix")
        check("merged settings update disableAutoplay and lang",
              r_backup.get("mergedSettingsDisableAutoplay") is True and r_backup.get("mergedSettingsLang") == "fr")



    finally:
        d.quit()
        proc.terminate()

    print()
    failed = [n for n, ok, _ in RESULTS if not ok]
    print(f"{len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed"
          + (f", {len(SKIPPED)} inconclusive" if SKIPPED else ""))
    for name in SKIPPED:
        print(f"  inconclusive: {name}")
    if failed:
        print("FAILED: " + "; ".join(failed))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
