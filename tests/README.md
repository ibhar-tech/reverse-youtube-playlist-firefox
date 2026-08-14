# Tests

## Unit / logic — `npm test`

Node's built-in runner over the real `src/` modules with a minimal DOM+storage
mock (`tests/setup.js`). No dependencies, no framework.

Suites that stub a `Playlist` method must restore it in an `after()` hook — the
modules are shared across the whole run, and a leaked stub silently changes what
later suites are testing.

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
