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
 * and Shuffle loading the whole playlist first.
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
function page(url) {
  const u = new URL(url);
  const cur = u.searchParams.get('v');
  const row = (i) => `<ytd-playlist-panel-video-renderer ${'v' + i === cur ? 'selected' : ''}>
      <a id="wc-endpoint" href="/watch?v=v${i}&list=PLfake&index=${i}"><span id="video-title">Video ${i}</span>
      <span id="time-status">${i}:00</span></a></ytd-playlist-panel-video-renderer>`;
  let rows = ''; for (let i = 1; i <= FIRST; i++) rows += row(i);
  return `<!doctype html><html><body><style>ytd-playlist-panel-video-renderer{display:block;height:64px}</style>
  <div id="movie_player" class="html5-video-player"><video></video><button class="ytp-next-button">next</button></div>
  <div id="secondary"><ytd-playlist-panel-renderer>
    <div id="header"><div id="header-contents"></div><div id="publisher-container"><span>${u.searchParams.get('index') || 1} / ${TOTAL}</span></div></div>
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
  const ctx = await chromium.launchPersistentContext(S + '/e2eprof', { headless: true, channel: 'chromium',
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

  check('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
  fs.rmSync(S, { recursive: true, force: true });
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
