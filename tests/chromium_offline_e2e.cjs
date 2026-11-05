/*
 * YouTube Playlist Tools — chromium_offline_e2e.cjs
 *
 * Loads the real extension (Chrome build) into Chromium and serves a fake
 * youtube.com/watch page through Playwright routing, so the content scripts
 * inject exactly as on YouTube — but nothing touches the network and no
 * YouTube A/B test can break it. The fake panel renders 4 of 6 rows and the
 * rest on scroll, like a long playlist.
 *
 * Covers the 3.6 design fixes end to end: id-keyed orders (incl. legacy
 * migration), next-button navigation, the URL fallback for unrendered rows,
 * and Shuffle loading the whole playlist first. Then the list export: CSV
 * and clipboard text from the toolbar in the order shown (custom, reverse),
 * a saved list's CSV from My Lists, and the overview page's .txt.
 *
 * Then the same for the mobile site Firefox for Android is served, on a fake
 * m.youtube.com page built from the live mobile DOM (see mobilePage()):
 * toolbar placement, Reverse at a real video's end, the player's next
 * button, a closed playlist sheet, and Shuffle.
 *
 *   npm run test:chromium        (needs `playwright` + its Chromium)
 */
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const S = fs.mkdtempSync(path.join(os.tmpdir(), 'ryp-e2e-'));
// Chrome build: same transform as build-chrome.sh, without needing jq.
const ext = path.join(S, 'chrome-ext');
fs.mkdirSync(ext);
for (const dir of ['src', 'popup', 'icons', '_locales']) {
  fs.cpSync(path.join(ROOT, dir), path.join(ext, dir), { recursive: true });
}
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
delete manifest.browser_specific_settings;
manifest.background = { service_worker: 'src/background.js' };
fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(manifest));
let failures = 0;
const TOTAL = 6, FIRST = 4;
function overviewPage() {
  let rows = '';
  for (let i = 1; i <= TOTAL; i++) {
    rows += `<ytd-playlist-video-renderer><a id="video-title" href="/watch?v=v${i}&list=PLfake&index=${i}">Video ${i}</a>
      <span id="byline">Chan ${i}</span><span id="time-status">${i}:00</span></ytd-playlist-video-renderer>`;
  }
  return `<!doctype html><html><head><title>Fake Mix - YouTube</title></head><body>
  <style>ytd-playlist-header-renderer,ytd-playlist-video-renderer{display:block}</style>
  <ytd-browse page-subtype="playlist">
    <ytd-playlist-header-renderer><h1 class="yt-dynamic-sizing-formatted-string">Fake Mix</h1>
      <div class="metadata-stats"><span>${TOTAL} videos</span></div><div id="action-buttons" style="min-height:40px"></div>
    </ytd-playlist-header-renderer>
    <ytd-playlist-video-list-renderer><div id="contents">${rows}</div></ytd-playlist-video-list-renderer>
  </ytd-browse></body></html>`;
}
function page(url) {
  const u = new URL(url);
  if (u.pathname === '/playlist') return overviewPage();
  const cur = u.searchParams.get('v');
  const row = (i) => `<ytd-playlist-panel-video-renderer ${'v' + i === cur ? 'selected' : ''}>
      <a id="wc-endpoint" href="/watch?v=v${i}&list=PLfake&index=${i}"><span id="video-title">Video ${i}</span>
      <span id="byline">Chan ${i}</span><span id="time-status">${i}:00</span></a></ytd-playlist-panel-video-renderer>`;
  let rows = ''; for (let i = 1; i <= FIRST; i++) rows += row(i);
  return `<!doctype html><html><body><style>ytd-playlist-panel-video-renderer{display:block;height:64px}</style>
  <div id="movie_player" class="html5-video-player"><video></video><button class="ytp-next-button">next</button></div>
  <div id="secondary"><ytd-playlist-panel-renderer>
    <div id="header"><h3 class="title">Fake Mix</h3><div id="header-contents"></div><div id="publisher-container"><span>${u.searchParams.get('index') || 1} / ${TOTAL}</span></div></div>
    <div id="scroller" style="height:150px;overflow-y:auto"><div id="items">${rows}</div></div>
  </ytd-playlist-panel-renderer></div>
  <script>
    // Lazy rendering, like YouTube: the rest of the rows appear on scroll.
    let n = ${FIRST};
    document.getElementById('scroller').addEventListener('scroll', () => {
      if (n >= ${TOTAL}) return;
      setTimeout(() => { while (n < ${TOTAL}) { n++; document.getElementById('items').insertAdjacentHTML('beforeend', ${JSON.stringify(row('__I__'))}.replaceAll('__I__', n)); } }, 150);
    });
  </script></body></html>`;
}
// ── Fake m.youtube.com (Firefox for Android gets the mobile site) ───────────
// Mirrors the mobile DOM as rendered live on 2026-11-05: ytm-* rows in a
// bottom sheet whose rows vanish when it is closed, a collapsed bar keeping
// "N / M", the player's prev/next buttons around play/pause, state-navigate*
// events on window instead of yt-navigate-*, and the URL index rewritten to
// N+1 on a fresh load. A 3 s silent WAV lets a real <video> reach its end.
const MTOTAL = 6;
function silentWav(seconds) {
  const rate = 8000, n = rate * seconds, b = Buffer.alloc(44 + n, 128);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40);
  return b;
}
function mobilePage() {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body>
  <div id="player-container-id"><div id="movie_player" class="html5-video-player ytp-mweb-player">
    <video src="/fake-media.wav" muted playsinline preload="auto"></video></div></div>
  <div id="player-control-container"><ytm-custom-control><ytm-watch-player-controls>
    <player-middle-controls class="player-controls-middle"><div class="player-controls-middle-core-buttons">
      <div><button class="icon-button player-middle-controls-prev-next-button" aria-label="Previous video">prev</button></div>
      <div><button class="icon-button player-control-play-pause-icon">play</button></div>
      <div><button class="icon-button player-middle-controls-prev-next-button" aria-label="Next video">next</button></div>
    </div></player-middle-controls></ytm-watch-player-controls></ytm-custom-control></div>
  <ytm-app><ytm-watch><ytm-single-column-watch-next-results-renderer>
    <ytm-playlist-engagement-panel><ytm-playlist-panel-entry-point>
      <div class="playlist-panel-subhead"><span class="playlist-panel-list-title">Fake 24/7 list</span> • <span id="entry-count"></span></div>
      <button class="icon-button playlist-panel-right-icon" aria-label="Show playlist videos">open</button>
    </ytm-playlist-panel-entry-point></ytm-playlist-engagement-panel>
  </ytm-single-column-watch-next-results-renderer></ytm-watch></ytm-app>
  <div id="sheet-host"></div>
  <script>
    const LIST = new URLSearchParams(location.search).get('list');
    const cur = () => new URLSearchParams(location.search).get('v');
    let sheetOpen = true;
    function row(i) {
      const href = '/watch?v=v' + i + '&list=' + LIST + '&index=' + i + '&pp=x';
      return '<ytm-playlist-panel-video-renderer class="playlist-panel-video-renderer" aria-selected="false" style="display:block;height:60px">' +
        '<div class="YtmCompactMediaItemHost"><a class="YtmCompactMediaItemImage" href="' + href + '"><ytm-thumbnail-overlay-time-status-renderer>' +
        '<badge-shape><div class="ytBadgeShapeText">' + i + ':00</div></badge-shape></ytm-thumbnail-overlay-time-status-renderer></a>' +
        '<div class="YtmCompactMediaItemMetadata"><a class="YtmCompactMediaItemMetadataContent" href="' + href + '">' +
        '<h4 class="YtmCompactMediaItemHeadline"><span>Video ' + i + '</span></h4>' +
        '<div class="YtmCompactMediaItemByline"><span>Channel ' + i + '</span></div></a></div></div></ytm-playlist-panel-video-renderer>';
    }
    function sheet() {
      let rows = ''; for (let i = 1; i <= ${MTOTAL}; i++) rows += row(i);
      return '<ytm-engagement-panel><ytm-engagement-panel-section-list-renderer class="engagement-panel-playlist">' +
        '<div class="engagement-panel-container"><div class="engagement-panel-section-list-header-wrapper">' +
        '<div class="engagement-panel-section-list-header"><ytm-playlist-engagement-panel-header>' +
        '<span class="playlist-engagement-panel-list-count"></span>' +
        '<button aria-label="Hide playlist videos" id="close-sheet">close</button></ytm-playlist-engagement-panel-header></div></div>' +
        '<div class="engagement-panel-content-wrapper" style="height:300px;overflow-y:auto"><ytm-playlist-panel-renderer>' +
        '<div class="ytm-playlist-panel-renderer-v2"><lazy-list>' + rows + '</lazy-list></div></ytm-playlist-panel-renderer></div>' +
        '</div></ytm-engagement-panel-section-list-renderer></ytm-engagement-panel>';
    }
    function render() {
      const n = Number(String(cur()).slice(1));
      document.getElementById('entry-count').textContent = n + ' / ${MTOTAL}';
      const host = document.getElementById('sheet-host');
      if (!sheetOpen) { host.replaceChildren(); return; }
      if (!host.firstChild) host.innerHTML = sheet();
      host.querySelector('.playlist-engagement-panel-list-count').textContent = n + ' / ${MTOTAL}';
      host.querySelectorAll('ytm-playlist-panel-video-renderer').forEach((r, i) => {
        const on = i + 1 === n;
        r.setAttribute('aria-selected', String(on));
        r.classList.toggle('ytmPlaylistPanelVideoRendererV2Selected', on);
      });
    }
    // In-app navigation, as m.youtube.com does it: events on window.
    function navigate(href) {
      dispatchEvent(new Event('state-navigatestart'));
      const v = document.querySelector('video'); v.pause(); v.currentTime = 0; // a new video loads
      history.pushState({}, '', href.replace(/&pp=[^&]*/, ''));
      render();
      setTimeout(() => dispatchEvent(new Event('state-navigateend')), 30);
    }
    document.addEventListener('click', (e) => {
      const a = e.target.closest('ytm-playlist-panel-video-renderer a');
      if (a) { e.preventDefault(); navigate(a.getAttribute('href')); return; }
      if (e.target.id === 'close-sheet') { sheetOpen = false; render(); }
      if (e.target.closest('.playlist-panel-right-icon')) { sheetOpen = true; render(); }
      // YouTube's own next: index + 1 (prev: index - 1).
      const step = e.target.closest('.player-middle-controls-prev-next-button');
      if (step) {
        const n = Number(String(cur()).slice(1)) + (step.textContent === 'next' ? 1 : -1);
        if (n >= 1 && n <= ${MTOTAL}) navigate('/watch?v=v' + n + '&list=' + LIST + '&index=' + n);
      }
    });
    // YouTube's own autoplay-forward when a video ends.
    document.querySelector('video').addEventListener('ended', () => {
      const n = Number(String(cur()).slice(1)) + 1;
      if (n <= ${MTOTAL}) navigate('/watch?v=v' + n + '&list=' + LIST + '&index=' + n);
    });
    // Fresh load: YouTube rewrites the URL index to N+1 (seen live).
    const u = new URL(location.href); const idx = Number(u.searchParams.get('index'));
    if (idx) { u.searchParams.set('index', String(idx + 1)); history.replaceState({}, '', u); }
    render();
  </script></body></html>`;
}

(async () => {
  const ctx = await chromium.launchPersistentContext(S + '/e2eprof', { headless: true, channel: 'chromium', acceptDownloads: true,
    // Chromium on Linux maps download names through the locale; under a bare
    // C locale (CI containers) any non-ASCII name falls back to "download".
    env: { ...process.env, LANG: process.env.LANG || 'C.UTF-8' },
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
  await ctx.route('https://www.youtube.com/**', (r) => r.request().resourceType() === 'document'
    ? r.fulfill({ contentType: 'text/html', body: page(r.request().url()) }) : r.abort());
  await ctx.route('https://i.ytimg.com/**', (r) => r.abort());
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const store = (o) => sw.evaluate((o) => chrome.storage.local.set(o), o);
  const read = (k) => sw.evaluate((k) => chrome.storage.local.get(k).then((r) => r[k]), k);
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', (e) => errors.push(e.message));
  const check = (name, ok, extra = '') => (ok || failures++, console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`));

  // 1. Legacy position order is migrated to ids on load.
  await store({ ryp_settings: { lang: 'en' }, 'customOrder:PLfake': [3, 1, 6, 2] });
  await p.goto('https://www.youtube.com/watch?v=v3&list=PLfake&index=3');
  await p.waitForSelector('#ryp-toolbar', { timeout: 8000 });
  await p.waitForTimeout(500);
  const migrated = await read('customOrder:PLfake');
  check('legacy order migrated to ids (6 → v6 once its row rendered)', JSON.stringify(migrated) === '["v3","v1","v6","v2"]', JSON.stringify(migrated));
  const cssOrder = await p.$$eval('ytd-playlist-panel-video-renderer', (els) => els.map((e) => e.style.order));
  check('sidebar shows the custom order', JSON.stringify(cssOrder) === '["1","3","0","9999","9999","2"]', JSON.stringify(cssOrder));

  // 2. Next button follows the order: v3 → v1 (rendered row, clicked).
  await Promise.all([p.waitForURL(/v=v1/), p.click('.ytp-next-button')]);
  check('next follows the id order (v3 → v1)', /v=v1&list=PLfake&index=1/.test(p.url()), p.url());

  // 3. Next: entry 6 is a legacy position whose row is not rendered → stays a
  //    position, so the step can't resolve; skip to an id that isn't rendered.
  await store({ 'customOrder:PLfake': ['v1', 'v6', 'v2'] });
  await p.reload(); await p.waitForSelector('#ryp-toolbar');
  await Promise.all([p.waitForURL(/v=v6/), p.click('.ytp-next-button')]);
  check('unrendered next video reached through its URL', /\/watch\?v=v6&list=PLfake$/.test(p.url()), p.url());

  // 4. Shuffle on a partially rendered playlist loads every row first.
  await store({ 'customOrder:PLfake': null, 'shuffle:PLfake': false });
  await p.goto('https://www.youtube.com/watch?v=v1&list=PLfake&index=1');
  await p.waitForSelector('#ryp-btn-shuffle');
  await p.waitForTimeout(400);
  const before = await p.$$eval('ytd-playlist-panel-video-renderer', (e) => e.length);
  await p.click('#ryp-btn-shuffle');
  let shuffled = null;
  for (let i = 0; i < 40 && !(shuffled && shuffled.length); i++) { await p.waitForTimeout(250); shuffled = await read('customOrder:PLfake').catch(() => null); }
  check('shuffle covers all 6 videos, not just the 4 rendered', before === 4 && shuffled && [...shuffled].sort().join() === 'v1,v2,v3,v4,v5,v6', `rendered before: ${before}, order: ${JSON.stringify(shuffled)}`);

  // 5. Export ▾ → CSV from the toolbar on a partially rendered playlist:
  //    every row is loaded first. (No mode, so nothing scrolls the sidebar
  //    and renders the rest before the click.)
  const downloadOf = async (selector) => {
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), p.click(selector)]);
    return { name: dl.suggestedFilename(), text: fs.readFileSync(await dl.path(), 'utf8') };
  };
  const idsIn = (text) => [...text.matchAll(/watch\?v=(v\d)/g)].map((m) => m[1]).join();
  await store({ 'shuffle:PLfake': false, 'reverse:PLfake': false, 'customOrder:PLfake': null });
  await p.goto('https://www.youtube.com/watch?v=v1&list=PLfake&index=1');
  await p.waitForSelector('#ryp-btn-export');
  await p.waitForTimeout(400);
  const widths = await p.evaluate(() => ['#ryp-btn-export', '#ryp-btn-save'].map((s) => Math.round(document.querySelector(s).getBoundingClientRect().width)));
  check('export is a compact icon button (narrower than Save)', widths[0] > 0 && widths[0] < widths[1], `export ${widths[0]}px, save ${widths[1]}px`);
  const rendered = await p.$$eval('ytd-playlist-panel-video-renderer', (e) => e.length);
  await p.click('#ryp-btn-export');
  check('export menu opens with 3 actions', await p.$$eval('#ryp-export-menu.ryp-menu-show .ryp-dropdown-item', (e) => e.length) === 3);
  const csv = await downloadOf('#ryp-export-menu [data-export-kind="csv"]');
  const csvLines = csv.text.split('\r\n');
  check('toolbar CSV: BOM + header + CRLF', csv.text.startsWith('﻿position,title,channel,duration,url\r\n'), JSON.stringify(csvLines[0]));
  check('toolbar CSV loads and covers all 6 rows', rendered === 4 && idsIn(csv.text) === 'v1,v2,v3,v4,v5,v6', `rendered before: ${rendered}, ids: ${idsIn(csv.text)}`);
  check('toolbar CSV row content', csvLines[1] === '1,Video 1,Chan 1,1:00,https://www.youtube.com/watch?v=v1', JSON.stringify(csvLines[1]));
  check('CSV named after the playlist', /^Fake Mix-\d{4}-\d\d-\d\d\.csv$/.test(csv.name), csv.name);

  // 5b. A custom order: rows the order doesn't mention follow it, as in the sidebar.
  await store({ 'customOrder:PLfake': ['v3', 'v1', 'v6', 'v2'] });
  await p.reload(); await p.waitForSelector('#ryp-btn-export'); await p.waitForTimeout(400);
  await p.click('#ryp-btn-export');
  const txt = await downloadOf('#ryp-export-menu [data-export-kind="txt"]');
  check('toolbar .txt follows the custom order shown', idsIn(txt.text) === 'v3,v1,v6,v2,v4,v5' && txt.text.startsWith('Fake Mix\n\n1. Video 3 — Chan 3 (3:00)\n'), `ids: ${idsIn(txt.text)}`);

  // 6. Reverse + Copy as text; keyboard open/close of the menu.
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://www.youtube.com' });
  await store({ 'customOrder:PLfake': null, 'reverse:PLfake': true });
  await p.reload(); await p.waitForSelector('#ryp-btn-export'); await p.waitForTimeout(400);
  await p.focus('#ryp-btn-export'); await p.keyboard.press('Enter');
  const kbd = await p.evaluate(() => ({ open: !!document.querySelector('#ryp-export-menu.ryp-menu-show'), focus: document.activeElement?.dataset?.exportKind }));
  await p.keyboard.press('Escape');
  const esc = await p.evaluate(() => ({ open: !!document.querySelector('#ryp-export-menu.ryp-menu-show'), focus: document.activeElement?.id }));
  check('keyboard: Enter opens on the first item, Escape closes back to the button', kbd.open && kbd.focus === 'copy' && !esc.open && esc.focus === 'ryp-btn-export', JSON.stringify({ kbd, esc }));
  await p.click('#ryp-btn-export');
  await p.click('#ryp-export-menu [data-export-kind="copy"]');
  await p.waitForSelector('#ryp-toast, #ryp-export-text-modal', { timeout: 15000 });
  const copied = await p.evaluate(() => navigator.clipboard.readText());
  check('copy: reversed text list on the clipboard', copied.startsWith('Fake Mix\n\n1. Video 6 — Chan 6 (6:00)\n   https://www.youtube.com/watch?v=v6\n') && idsIn(copied) === 'v6,v5,v4,v3,v2,v1', JSON.stringify(copied.slice(0, 80)) + ` ids: ${idsIn(copied)}`);

  // 7. My Lists → a saved list's export row → CSV, in the list's saved order.
  await store({ savedPlaylists: [{ id: 'snapE2E', name: 'قائمتي', tags: [], sourceListId: '', order: [2, 1], savedAt: new Date().toISOString(),
    videos: [{ index: 1, videoId: 'v1', title: 'Video 1', channel: 'Chan 1', durationStr: '1:00' },
             { index: 2, videoId: 'v5', title: 'درس, "أول"', channel: 'قناة', durationStr: '5:00' }] }] });
  await p.click('#ryp-btn-playlists');
  await p.waitForSelector('.ryp-saved-card .ryp-action-export');
  await p.click('.ryp-saved-card .ryp-action-export');
  const cardCsv = await downloadOf('.ryp-card-export-choice[data-export-kind="csv"]');
  check('My Lists CSV: saved order, Arabic quoted, BOM',
    cardCsv.text === '﻿position,title,channel,duration,url\r\n1,"درس, ""أول""",قناة,5:00,https://www.youtube.com/watch?v=v5\r\n2,Video 1,Chan 1,1:00,https://www.youtube.com/watch?v=v1\r\n',
    JSON.stringify(cardCsv.text));
  check('My Lists CSV named after the list', /^قائمتي-\d{4}-\d\d-\d\d\.csv$/.test(cardCsv.name), cardCsv.name);
  check('panel stays open after exporting', await p.$eval('#ryp-saved-panel', (e) => e.classList.contains('ryp-panel-visible')));

  // 8. Overview page (/playlist): .txt in YouTube's order, whatever mode the
  //    watch page left stored.
  await p.goto('https://www.youtube.com/playlist?list=PLfake');
  await p.waitForSelector('#ryp-ov-export', { timeout: 8000 });
  await p.click('#ryp-ov-export');
  const ovTxt = await downloadOf('#ryp-ov-export-menu [data-export-kind="txt"]');
  check('overview .txt: playlist order, all rows', ovTxt.text.startsWith('Fake Mix\n\n1. Video 1 — Chan 1 (1:00)\n') && idsIn(ovTxt.text) === 'v1,v2,v3,v4,v5,v6', JSON.stringify(ovTxt.text.slice(0, 60)) + ` ids: ${idsIn(ovTxt.text)}`);

  // ── Mobile site (Firefox for Android) ────────────────────────────────
  const wav = silentWav(3);
  await ctx.route('https://m.youtube.com/**', (r) => {
    if (r.request().url().endsWith('/fake-media.wav')) return r.fulfill({ contentType: 'audio/wav', body: wav });
    return r.request().resourceType() === 'document'
      ? r.fulfill({ contentType: 'text/html', body: mobilePage() }) : r.abort();
  });
  const m = await ctx.newPage();
  await m.setViewportSize({ width: 412, height: 915 });
  await m.setExtraHTTPHeaders({ 'User-Agent': 'Mozilla/5.0 (Android 14; Mobile; rv:144.0) Gecko/144.0 Firefox/144.0' });
  m.on('pageerror', (e) => errors.push('mobile: ' + e.message));
  await store({ 'reverse:PLmob': false, 'shuffle:PLmob': false, 'customOrder:PLmob': null });
  await m.goto('https://m.youtube.com/watch?v=v3&list=PLmob&index=3');
  await m.waitForSelector('#ryp-toolbar', { timeout: 8000 });
  const bar = await m.evaluate(() => ({
    inSheetHeader: !!document.querySelector('.engagement-panel-section-list-header-wrapper > #ryp-toolbar'),
    reorder: !!document.getElementById('ryp-btn-reorder'),
    reverse: !!document.getElementById('ryp-btn-reverse'),
    shuffle: !!document.getElementById('ryp-btn-shuffle'),
    mobileClass: document.documentElement.classList.contains('ryp-mobile'),
    url: location.href,
  }));
  check('mobile: compact toolbar in the playlist sheet, no Reorder', bar.inSheetHeader && bar.reverse && bar.shuffle && !bar.reorder && bar.mobileClass, JSON.stringify(bar));

  // Reverse from item 3 (URL says index=4) jumps to the last item, v6.
  await Promise.all([m.waitForURL(/v=v6/), m.click('#ryp-btn-reverse')]);
  check('mobile: Reverse starts from the last item', /v=v6&list=PLmob/.test(m.url()) && (await read('reverse:PLmob')) === true, m.url());

  // A real video reaching its end: the engine steps to v5 before YouTube's
  // own autoplay-forward (which would go nowhere past v6) can run.
  await m.waitForTimeout(300);
  await Promise.all([m.waitForURL(/v=v5/, { timeout: 10000 }), m.evaluate(() => document.querySelector('video').play())]);
  check('mobile: end of video → previous item in Reverse (v6 → v5)', /v=v5&list=PLmob/.test(m.url()), m.url());

  // The player's next button follows Reverse too (YouTube's own would go to v6).
  await m.waitForTimeout(300);
  await Promise.all([m.waitForURL(/v=v4/), m.click('.player-middle-controls-prev-next-button >> text=next')]);
  check('mobile: player next button follows Reverse (v5 → v4)', /v=v4&list=PLmob/.test(m.url()), m.url());

  // Sheet closed — its rows leave the DOM — and the order still resolves,
  // from the rows remembered while it was open (here by loading the URL).
  await m.waitForTimeout(300);
  await m.click('#close-sheet');
  const rowsLeft = await m.$$eval('ytm-playlist-panel-video-renderer', (e) => e.length);
  await Promise.all([m.waitForURL(/v=v3/), m.click('.player-middle-controls-prev-next-button >> text=next')]);
  check('mobile: sheet closed, Reverse still steps (v4 → v3)', rowsLeft === 0 && /v=v3&list=PLmob/.test(m.url()), `rows left: ${rowsLeft}, ${m.url()}`);

  // Shuffle reads every mobile row into a video-id order and starts it.
  await m.waitForSelector('#ryp-btn-shuffle');
  await m.waitForTimeout(400);
  await store({ 'customOrder:PLmob': null });
  await m.click('#ryp-btn-shuffle');
  let mShuffled = null;
  for (let i = 0; i < 40 && !(mShuffled && mShuffled.length); i++) { await m.waitForTimeout(250); mShuffled = await read('customOrder:PLmob').catch(() => null); }
  await m.waitForTimeout(500);
  const startedAt = new URL(m.url()).searchParams.get('v');
  check('mobile: Shuffle covers all 6 and starts at its first entry', mShuffled && [...mShuffled].sort().join() === 'v1,v2,v3,v4,v5,v6' && startedAt === mShuffled[0], `order: ${JSON.stringify(mShuffled)}, at ${startedAt}`);

  check('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
  fs.rmSync(S, { recursive: true, force: true });
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
