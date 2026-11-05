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

  check('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
  fs.rmSync(S, { recursive: true, force: true });
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
