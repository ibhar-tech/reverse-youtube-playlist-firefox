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

    def start(self):
        args = [] if self.headed else ["-headless"]
        caps = {"capabilities": {"alwaysMatch": {
            "browserName": "firefox",
            "moz:firefoxOptions": {"args": args, "prefs": {
                # Keep the run deterministic and quiet.
                "datareporting.policy.firstRunURL": "",
                "browser.shell.checkDefaultBrowser": False,
            }},
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
                    items: [...(p?.querySelectorAll('ytd-playlist-panel-video-renderer')||[])]
                             .map(i=>i.querySelector('#video-title')?.textContent),
                    bg: p ? getComputedStyle(p).backgroundColor : null};""")
        check("hash param survives navigation", "#ryp_list=" in r["url"], r["url"][-60:])
        check("virtual panel renders", r["panel"])
        check("panel titled with the playlist name", r.get("header") == "FF Local Mix", r.get("header"))
        check("both added videos are shown", len(r.get("items") or []) == 2,
              " | ".join(i or "?" for i in (r.get("items") or [])))
        check("panel has a solid background", r.get("bg") not in (None, "rgba(0, 0, 0, 0)"), r.get("bg"))

        # click the second item — the round trip
        if r.get("panel") and len(r.get("items") or []) == 2:
            d.js("""document.querySelectorAll('#ryp-virtual-playlist-panel ytd-playlist-panel-video-renderer')[1]
                    .querySelector('a').click();""")
            time.sleep(8)
            r2 = d.js("""const p=document.querySelector('#ryp-virtual-playlist-panel');
                return {url: location.href, panel: !!p,
                        selected: p?.querySelector('[selected] #video-title')?.textContent};""")
            check("clicking item 2 keeps the virtual playlist", r2["panel"] and "ryp_index=2" in r2["url"])
            check("item 2 is the selected row", bool(r2.get("selected")), r2.get("selected"))

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

    finally:
        d.quit()
        proc.terminate()

    print()
    failed = [n for n, ok, _ in RESULTS if not ok]
    print(f"{len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed")
    if failed:
        print("FAILED: " + "; ".join(failed))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
