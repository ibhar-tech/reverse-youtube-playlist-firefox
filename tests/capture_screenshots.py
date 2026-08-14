#!/usr/bin/env python3
"""
Capture the store screenshots from a real Firefox running the working tree.

    tests/capture_screenshots.py [--out store] [--headed]

Writes 1280x800 PNGs — the size the Chrome Web Store requires and the size
the existing Edge assets use, so one set serves every store. Filenames are
screenshot-1-… through screenshot-N-…, because upload-screenshots.sh derives
the listing position from the glob order.

Everything shown is produced by the extension against live YouTube: the
script drives the same flows tests/firefox_e2e.py asserts on, then shoots.
"""
import argparse
import base64
import io
import json
import os
import subprocess
import sys
import time
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from firefox_e2e import WebDriver, settle, REPO, WATCH_URL, OVERVIEW_URL, STANDALONE_URL

from PIL import Image

ADDON_ID = "reverse-playlist@benmoussa"
# Firefox assigns each extension a random moz-extension:// origin per profile.
# Pinning it here is the only way to reach popup/popup.html by URL.
EXT_UUID = str(uuid.UUID("6a1e4c7d-9b32-4f58-a0d1-2e7c5b8f3a46"))
POPUP_URL = f"moz-extension://{EXT_UUID}/popup/popup.html"

WIDTH, HEIGHT = 1280, 800
LOCAL_NAME = "Weekend Mix"
SNAPSHOT_NAME = "Course — oldest first"


class Shooter(WebDriver):
    def set_viewport(self, target_w, target_h):
        """Ask for an outer size, then correct for the chrome around it."""
        w, h = target_w, target_h
        for _ in range(4):
            self._req("POST", f"/session/{self.session}/window/rect",
                      {"x": 0, "y": 0, "width": w, "height": h})
            iw, ih = self.js("return [window.innerWidth, window.innerHeight];")
            if (iw, ih) == (target_w, target_h):
                return True
            w += target_w - iw
            h += target_h - ih
        return False

    def shot(self):
        b64 = self._req("GET", f"/session/{self.session}/screenshot")
        return Image.open(io.BytesIO(base64.b64decode(b64)))

    def context(self, name):
        self._req("POST", f"/session/{self.session}/moz/context", {"context": name})

    def go_privileged(self, url):
        """WebDriver refuses to navigate a content tab to moz-extension://.
        Load it from the parent process instead, then drop back to content so
        screenshots and execute/sync behave normally."""
        self.context("chrome")
        try:
            self.js(f"""const win =
                    Services.wm.getMostRecentWindow('navigator:browser');
                win.gBrowser.loadURI(Services.io.newURI({json.dumps(url)}), {{
                  triggeringPrincipal:
                    Services.scriptSecurityManager.getSystemPrincipal(),
                }});
                return true;""")
        finally:
            self.context("content")


def save(img, out_dir, name):
    """Write exactly WIDTHxHEIGHT — crop or letterbox rather than rescale."""
    if img.size != (WIDTH, HEIGHT):
        canvas = Image.new("RGB", (WIDTH, HEIGHT), (15, 15, 15))
        canvas.paste(img.convert("RGB"), (0, 0))
        img = canvas
    path = os.path.join(out_dir, name)
    img.convert("RGB").save(path, "PNG", optimize=True)
    print(f"  wrote {name}  {img.size[0]}x{img.size[1]}  {os.path.getsize(path)//1024}KB")


def click(d, selector):
    return d.js(f"const e=document.querySelector({json.dumps(selector)});"
                "if(!e) return false; e.click(); return true;")


def seed(d):
    """Create one snapshot of a real playlist and one local playlist, so the
    LOCAL vs YOUTUBE badges have something to distinguish."""
    d.go(WATCH_URL)
    if not settle(d, "#ryp-toolbar", 40):
        raise RuntimeError("toolbar never appeared on the watch page")
    time.sleep(6)

    print("  seeding: snapshot of the real playlist")
    click(d, "#ryp-btn-save")
    time.sleep(1.5)
    d.js(f"""const m=document.querySelector('#ryp-custom-modal');
        m.querySelector('.ryp-modal-input').value={json.dumps(SNAPSHOT_NAME)};
        m.querySelector('.ryp-modal-btn-confirm').click();""")
    time.sleep(2.5)

    print("  seeding: local playlist + first video")
    click(d, "#ryp-add-video-btn")
    time.sleep(1.5)
    d.js(f"""const m=document.querySelector('#ryp-custom-modal');
        m.querySelector('.ryp-modal-input').value={json.dumps(LOCAL_NAME)};
        m.querySelector('.ryp-modal-btn-confirm').click();""")
    time.sleep(2.5)

    print("  seeding: second video from a standalone page")
    d.go(STANDALONE_URL)
    settle(d, "#ryp-add-video-btn", 40)
    time.sleep(3)
    click(d, "#ryp-add-video-btn")
    time.sleep(1.5)
    d.js("""const m=document.querySelector('#ryp-custom-modal');
        [...m.querySelectorAll('.ryp-playlist-select-item')]
          .find(r=>r.textContent.includes(%s))?.querySelector('.ryp-btn-add')?.click();"""
         % json.dumps(LOCAL_NAME))
    time.sleep(2.5)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(REPO, "store"))
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--geckodriver", default="geckodriver")
    ap.add_argument("--port", type=int, default=4445)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    # --allow-system-access is what lets the chrome-context escape hatch in
    # go_privileged() run; it cannot be requested through capabilities.
    proc = subprocess.Popen(
        [args.geckodriver, "--port", str(args.port), "--allow-system-access"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2)
    d = Shooter(args.port, args.headed)
    popup_img = None
    try:
        d.start({"extensions.webextensions.uuids": json.dumps({ADDON_ID: EXT_UUID})})
        d.install_addon(REPO)
        d.set_viewport(WIDTH, HEIGHT)
        print(f"viewport {d.js('return [innerWidth, innerHeight];')}")

        # The pinned-UUID trick has to be proven before anything depends on it.
        try:
            d.go_privileged(POPUP_URL)
            time.sleep(3)
            popup_ok = bool(d.js("return !!document.getElementById('playlist-list');"))
        except RuntimeError as e:
            popup_ok = False
            print(f"  {e}")
        print(f"popup reachable at a pinned UUID: {popup_ok}")

        seed(d)

        # ── 1. Reverse on a watch page ───────────────────────────────────────
        print("\n1. reverse")
        d.go(WATCH_URL)
        settle(d, "#ryp-toolbar", 40)
        time.sleep(6)
        click(d, "#ryp-btn-reverse")
        time.sleep(4)
        d.js("window.scrollTo(0, 0);")
        save(d.shot(), args.out, "screenshot-1-reverse.png")

        # ── 2. Sort presets ──────────────────────────────────────────────────
        print("2. sort dropdown")
        click(d, "#ryp-btn-sort")
        time.sleep(1)
        save(d.shot(), args.out, "screenshot-2-sort.png")
        d.js("document.body.click();")
        time.sleep(1)

        # ── 3. Watch-time breakdown ──────────────────────────────────────────
        # The tooltip is a :hover rule; forcing it shows exactly what a hover
        # shows, without driving a synthetic pointer across the page.
        print("3. watch time")
        d.js("""const s=document.createElement('style'); s.id='ryp-shot-style';
            s.textContent='.ryp-duration-tooltip{display:flex!important;'
                        + 'flex-direction:column;gap:6px;}';
            document.head.appendChild(s);""")
        time.sleep(1)
        save(d.shot(), args.out, "screenshot-3-watch-time.png")
        d.js("document.getElementById('ryp-shot-style')?.remove();")

        # ── 4. My Lists: LOCAL vs YOUTUBE ────────────────────────────────────
        print("4. my lists")
        click(d, "#ryp-btn-playlists")
        time.sleep(2.5)
        badges = d.js("""return [...document.querySelectorAll('.ryp-saved-card')]
            .map(c=>c.querySelector('.ryp-kind-badge')?.textContent);""")
        print(f"   badges on the cards: {badges}")
        save(d.shot(), args.out, "screenshot-4-my-lists.png")

        # ── 5. A local playlist actually playing ─────────────────────────────
        print("5. local playlist")
        d.js("""const c=[...document.querySelectorAll('.ryp-saved-card')]
            .find(x=>x.textContent.includes(%s));
            c?.querySelector('.ryp-action-play')?.click();""" % json.dumps(LOCAL_NAME))
        time.sleep(12)
        rows = d.js("""return [...document.querySelectorAll(
            '#ryp-virtual-playlist-panel .ryp-custom-playlist-item')]
            .map(r=>Math.round(r.getBoundingClientRect().height));""")
        print(f"   virtual rows (px tall): {rows}")
        d.js("window.scrollTo(0, 0);")
        time.sleep(1)
        save(d.shot(), args.out, "screenshot-5-local-playlist.png")

        # ── 6. Playlist overview page ────────────────────────────────────────
        print("6. overview page")
        d.go(OVERVIEW_URL)
        settle(d, "#ryp-overview-toolbar", 40)
        time.sleep(7)
        rect = d.js("""const b=document.querySelector('#ryp-overview-toolbar');
            if(!b) return null; const r=b.getBoundingClientRect();
            b.scrollIntoView({block:'center'});
            const a=b.getBoundingClientRect();
            return {before:[Math.round(r.x),Math.round(r.y)],
                    after:[Math.round(a.x),Math.round(a.y)],
                    parent:b.parentElement?.tagName.toLowerCase()};""")
        print(f"   overview toolbar {rect}")
        time.sleep(2)
        save(d.shot(), args.out, "screenshot-6-overview.png")

        # ── 7. The popup, over a real page ───────────────────────────────────
        if popup_ok:
            print("7. popup")
            backdrop = d.shot()
            d.set_viewport(420, 640)
            d.go_privileged(POPUP_URL)
            time.sleep(3)
            # Trim the window to the content so the shot is not mostly padding.
            tall = d.js("return Math.ceil(document.body.getBoundingClientRect().height);")
            d.set_viewport(420, max(360, min(int(tall) + 8, HEIGHT - 80)))
            time.sleep(1)
            popup_img = d.shot()
            d.set_viewport(WIDTH, HEIGHT)
        else:
            print("7. popup SKIPPED — moz-extension:// URL did not resolve")
    finally:
        d.quit()
        proc.terminate()

    if popup_img is not None:
        # Composite where a real popup appears: anchored under the toolbar,
        # top right, with a hairline so it reads as a separate surface.
        canvas = backdrop.convert("RGB").resize((WIDTH, HEIGHT))
        shade = Image.new("RGB", canvas.size, (0, 0, 0))
        canvas = Image.blend(canvas, shade, 0.45)
        p = popup_img.convert("RGB")
        x, y = WIDTH - p.width - 40, max(24, (HEIGHT - p.height) // 2)
        canvas.paste(Image.new("RGB", (p.width + 2, p.height + 2), (60, 60, 60)), (x - 1, y - 1))
        canvas.paste(p, (x, y))
        save(canvas, args.out, "screenshot-7-popup.png")

    print("\nDone. Review every file before uploading — these go on a public listing.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
