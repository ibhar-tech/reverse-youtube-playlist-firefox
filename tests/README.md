# Tests

## Unit / logic — `npm test`

Node's built-in runner over the real `src/` modules with a minimal DOM+storage
mock (`tests/setup.js`). No dependencies, no framework.

Suites that stub a `Playlist` method must restore it in an `after()` hook — the
modules are shared across the whole run, and a leaked stub silently changes what
later suites are testing.

## Offline browser check — `npm run test:chromium`

Loads the real extension into Chromium (Playwright) and serves a fake
`youtube.com/watch` page through request routing, so the content scripts run
as on YouTube without any network. The fake panel renders 4 of 6 rows and the
rest on scroll. Checks id-keyed orders and legacy migration, next-button
navigation, the URL fallback for unrendered rows, and Shuffle loading the
whole playlist first. Needs `playwright` and its Chromium installed.

It then does the same on a fake `m.youtube.com` (the site Firefox for Android
gets), built from the mobile DOM as rendered live: ytm-* rows in a bottom sheet
that drops them when closed, `state-navigate*` events on `window`, the URL
index rewritten to N+1 on load, and a 3 s silent WAV so a real `<video>` can
reach its end. `tests/test_android.js` covers the same paths as unit tests.
Neither replaces a run on a real Android device (`web-ext run -t firefox-android`).

## End-to-end — `npm run test:e2e`

Drives **real Firefox** against **real YouTube**, with the working tree installed
as a temporary add-on. Standard library only; geckodriver is the sole dependency:

    curl -sL -o gd.tar.gz https://github.com/mozilla/geckodriver/releases/latest/download/geckodriver-v0.37.1-linux64.tar.gz
    tar xzf gd.tar.gz && mv geckodriver ~/.local/bin/   # already installed on this machine

Runs headless by default; `npm run test:e2e:headed` shows the window. Point at a
driver elsewhere with `python3 tests/firefox_e2e.py --geckodriver /path/to/geckodriver`.

It asserts on the DOM the content script produced: no per-card pills, the toolbar
and its duration pill, the sort dropdown, the local-playlist add flow end to end
(create → add a second video → play → both rendered → click item 2), and the
overview page including "Play Reverse" landing on the genuine last video.

Because it talks to live YouTube it can fail for reasons unrelated to the code —
a changed playlist, an A/B tested DOM, or network trouble. Read the failing check
before assuming a regression. The fixed playlist it uses (`PLBlnK6f…`) is public
and had 119 videos when written; if that changes, update `PLAYLIST`.

## Two traps this suite exists to catch

**Assert on layout, not presence.** An earlier version of the e2e checked
`querySelector('#video-title').textContent` and passed while the local-playlist
panel was visibly blank — the rows had been gutted by Polymer and measured 0px.
Check `getBoundingClientRect().height` and `img.complete && img.naturalWidth`.

**Never build injected rows from YouTube's own element names.** Creating a
`ytd-playlist-panel-video-renderer` gets it upgraded by Polymer, which replaces
your children with its empty template. Use plain divs.

Headless Firefox blocks autoplay and stalls short of the end of a video, so
end-of-playback behaviour cannot be verified here. That check reports SKIP and
the arithmetic is covered by `tests/test_add_to_playlist.js` instead.
