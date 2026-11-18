#!/usr/bin/env node
// Real-browser build verification (task 9.1).
//
// Usage:
//   npm run verify:build                      build + `vite preview` + headless Chrome
//   node scripts/verify-build.mjs --no-build  reuse existing dist/
//   VERIFY_URL=http://localhost:5173 node scripts/verify-build.mjs --no-build
//                                             target an already running dev server
//                                             (no build, no preview; it is never stopped)
//
// Browser: uses playwright-core with a system Chromium-based browser (no download).
// Set CHROME_PATH to override. Detected: macOS Google Chrome, common Linux paths.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { chromium } from 'playwright-core';
import { checkBundleGraph } from './check-bundle.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const VERIFY_URL = process.env.VERIFY_URL || '';
const skipBuild = args.has('--no-build') || Boolean(VERIFY_URL);
const RUN_TIMEOUT_MS = 3000;
const logDir = mkdtempSync(join(tmpdir(), 'dla-verify-'));

const results = []; // { step, name, ok, detail }
let currentStep = 'setup';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CheckError extends Error {}
function check(name, cond, detail = '') {
  results.push({ step: currentStep, name, ok: Boolean(cond), detail: String(detail) });
  if (!cond) throw new CheckError(`[${currentStep}] ${name} ${detail}`);
}
const step = (name) => {
  currentStep = name;
};

// ---------- child process management ----------
let preview = null;
function stopPreview() {
  if (preview && !preview.killed) {
    try {
      preview.kill('SIGTERM');
    } catch {}
  }
  preview = null;
}
process.on('exit', stopPreview);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    stopPreview();
    process.exit(130);
  });
}

function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p)) ?? null;
}

async function waitForServer(url, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await sleep(200);
  }
  throw new Error(`server did not become ready at ${url}`);
}

// ---------- build asset checks ----------
function checkDistAssets() {
  const assets = join(root, 'dist', 'assets');
  check('dist/assets exists', existsSync(assets), assets);
  const files = readdirSync(assets);
  const worker = files.filter((f) => /^execution\.worker.*\.js$/.test(f));
  check('worker script emitted in dist/assets', worker.length === 1, worker.join(',') || 'none');
  check('worker script non-empty', statSync(join(assets, worker[0])).size > 0);
  const mains = files.filter((f) => /^index.*\.js$/.test(f));
  const referenced = mains.some((f) => readFileSync(join(assets, f), 'utf8').includes(worker[0]));
  check('main bundle references worker script', referenced, worker[0]);
}

// ---------- page helpers ----------
const WRONG_CODE = 'function brightestCandle(c) { while (true) {} }';
const FIXED_CODE = `function brightestCandle(candles) {
  let best = -1;
  for (let i = 0; i < candles.length; i++) {
    if (best === -1 || candles[i] > candles[best]) {
      best = i;
    }
  }
  return best;
}
`;

const INIT_SCRIPT = () => {
  const stats = { created: 0, terminated: 0, live: 0 };
  window.__workers = stats;
  const Orig = window.Worker;
  window.Worker = class extends Orig {
    constructor(...a) {
      super(...a);
      stats.created++;
      stats.live++;
      this.__done = false;
    }
    terminate() {
      if (!this.__done) {
        this.__done = true;
        stats.terminated++;
        stats.live--;
      }
      super.terminate();
    }
  };
  window.__raf = 0;
  const tick = () => {
    window.__raf++;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  window.__maxPass = 0;
  const scan = () => {
    const n = [...document.querySelectorAll('.test-panel__status')].filter((e) => e.textContent.includes('pass')).length;
    if (n > window.__maxPass) window.__maxPass = n;
  };
  const start = () => new MutationObserver(scan).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded', start);
};

const workers = (page) => page.evaluate(() => ({ ...window.__workers }));
const statuses = (page) => page.$$eval('.test-panel__status', (els) => els.map((e) => e.textContent.trim()));
const sanity = (page) => page.$eval('[role="meter"]', (e) => Number(e.getAttribute('aria-valuenow')));
const rects = (page, sel) =>
  page.$$eval(sel, (els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: r.width, h: r.height };
    }),
  );
const overflowX = (page) =>
  page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, bsw: document.body.scrollWidth }));

async function waitLive0(page, ms = 1500) {
  const end = Date.now() + ms;
  let w;
  while (Date.now() < end) {
    w = await workers(page);
    if (w.live === 0) return w;
    await sleep(50);
  }
  return w;
}

async function replaceCode(page, code) {
  await page.focus('.cm-content');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.insertText(code);
  await sleep(100);
}

const intersects = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom && a.w > 0 && a.h > 0 && b.w > 0 && b.h > 0;

async function main() {
  // ---- Step: production import graph ----
  step('import-graph');
  const g = await checkBundleGraph();
  check('bundle graph has modules', g.bundledModuleCount > 0 && g.srcModulesBundled > 0, `${g.bundledModuleCount} modules, ${g.srcModulesBundled} from src`);
  check('no /tests/ or referenceSolution module in production bundle', g.forbiddenInBundle.length === 0, g.forbiddenInBundle.join(','));
  check('no /tests/ or referenceSolution module in module graph', g.forbiddenInGraph.length === 0, g.forbiddenInGraph.join(','));
  check('no src module imports from tests/', g.badEdges.length === 0 && g.scanHits.length === 0, [...g.badEdges, ...g.scanHits].join(','));

  // ---- Step: build ----
  let baseUrl = VERIFY_URL;
  if (!VERIFY_URL) {
    if (!skipBuild) {
      step('build');
      const b = spawnSync(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build'], { cwd: root, stdio: 'inherit' });
      check('vite build succeeded', b.status === 0, `exit ${b.status}`);
    }
    step('dist-assets');
    checkDistAssets();
    step('preview');
    const port = await freePort();
    preview = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    preview.stdout.on('data', (d) => process.env.VERIFY_DEBUG && process.stdout.write(d));
    preview.stderr.on('data', (d) => process.stderr.write(d));
    baseUrl = `http://127.0.0.1:${port}/`;
    await waitForServer(baseUrl);
    check('vite preview started', true, baseUrl);
  } else {
    step('dev-server');
    await waitForServer(VERIFY_URL);
    check('target server reachable', true, VERIFY_URL);
  }
  const origin = new URL(baseUrl).origin;

  // ---- Launch browser ----
  step('browser');
  const exe = findChrome();
  check('Chrome/Chromium found', exe, exe ?? 'none; set CHROME_PATH to a Chrome/Chromium binary');
  const browser = await chromium.launch({ executablePath: exe, headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
    const page = await context.newPage();
    await page.addInitScript(INIT_SCRIPT);
    const requests = [];
    const workerResponses = [];
    const pageErrors = [];
    page.on('request', (r) => requests.push(r.url()));
    page.on('response', (r) => {
      if (/execution\.worker/.test(r.url())) workerResponses.push({ url: r.url(), status: r.status() });
    });
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    await page.goto(baseUrl, { waitUntil: 'load' });

    // ---- Step 1: Start screen ----
    step('start-screen');
    await page.waitForSelector('.start-screen h1');
    let ox = await overflowX(page);
    check('no horizontal overflow at 1024x768', ox.sw <= ox.cw && ox.bsw <= ox.cw, JSON.stringify(ox));
    const parts = {
      title: 'h1',
      rules: '.start-rules',
      sound: '.start-sound',
      summary: '.start-technical summary',
      begin: '.begin-button',
    };
    for (const [name, sel] of Object.entries(parts)) {
      const [r] = await rects(page, sel);
      check(`${name} within 1024x768 viewport`, r && r.top >= 0 && r.bottom <= 768 && r.right <= 1024 && r.h > 0, r ? `bottom=${r.bottom.toFixed(0)}` : 'missing');
    }
    const fit = await page.evaluate(() => ({ sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight, bodySh: document.body.scrollHeight, vh: window.innerHeight }));
    check('collapsed Start fits without vertical scrolling (strict, no tolerance)', fit.sh <= 768 && fit.ch === 768 && fit.bodySh <= 768, JSON.stringify(fit));
    {
      const [bb] = await rects(page, '.begin-button');
      const [sm] = await rects(page, '.start-technical summary');
      check('collapsed: Begin bottom <= 768 (strict)', bb.bottom <= 768, `begin bottom=${bb.bottom}, summary bottom=${sm.bottom}`);
    }
    for (const vw of [1024, 3840]) {
      await page.setViewportSize({ width: vw, height: vw === 1024 ? 768 : 2160 });
      await sleep(200);
      const o = await overflowX(page);
      check(`Start: no horizontal overflow at ${vw}`, o.sw <= o.cw && o.bsw <= o.cw, JSON.stringify(o));
    }
    await page.setViewportSize({ width: 1024, height: 768 });
    await sleep(200);
    const rulesCount = await page.$$eval('.start-rules li', (e) => e.length);
    check('three rules shown', rulesCount === 3, rulesCount);
    const isOpen = () => page.$eval('.start-technical', (d) => d.open);
    check('Technical details collapsed by default', (await isOpen()) === false);
    await page.focus('.start-technical summary');
    for (const [key, expected] of [['Enter', true], ['Enter', false], ['Space', true], ['Space', false]]) {
      await page.keyboard.press(key);
      await sleep(50);
      check(`summary ${key} -> ${expected ? 'open' : 'closed'}`, (await isOpen()) === expected);
    }
    await page.keyboard.press('Enter');
    check('details open for layout check', await isOpen());
    ox = await overflowX(page);
    check('expanded: no horizontal overflow', ox.sw <= ox.cw && ox.bsw <= ox.cw, JSON.stringify(ox));
    const vscroll = await page.evaluate(() => {
      window.__preScroll = { sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight };
      const items = [...document.querySelectorAll('.start-technical__list li')];
      const last = items[items.length - 1];
      last.scrollIntoView({ block: 'end' });
      const r = last.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, vh: window.innerHeight, docH: document.documentElement.scrollHeight };
    });
    check('expanded: last disclosure line reachable within viewport', vscroll.top >= 0 && vscroll.bottom <= vscroll.vh + 1, JSON.stringify(vscroll));
    const sc = await page.evaluate(() => ({ ...window.__preScroll, scrollY: window.scrollY }));
    check('expanded: content scrolls vertically (scrollHeight > clientHeight, scrollY > 0)', sc.sh > sc.ch && sc.scrollY > 0, JSON.stringify(sc));
    ox = await overflowX(page);
    check('expanded: no horizontal overflow after scrolling', ox.sw <= ox.cw && ox.bsw <= ox.cw, JSON.stringify(ox));
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.focus('.start-technical summary');
    await page.keyboard.press('Enter');
    check('details closed again', (await isOpen()) === false);

    // ---- Step 2: starter run against the real worker ----
    step('starter-run');
    await page.click('.begin-button');
    await page.waitForSelector('.play-screen__run');
    await page.waitForSelector('.cm-content');
    const before2 = await workers(page);
    let t0 = Date.now();
    await page.click('.play-screen__run');
    await page.waitForFunction(
      () => {
        const s = [...document.querySelectorAll('.test-panel__status')].map((e) => e.textContent);
        return s.length === 5 && s.every((t) => /pass|fail|error|timeout/.test(t));
      },
      null,
      { timeout: RUN_TIMEOUT_MS + 2000 },
    );
    const starterMs = Date.now() - t0;
    const st = await statuses(page);
    check('4 passing tests', st.filter((s) => s.includes('pass')).length === 4, st.join(' | '));
    check('1 failing test', st.filter((s) => s.includes('fail')).length === 1, st.join(' | '));
    check('starter run finished within Run_Timeout', starterMs <= RUN_TIMEOUT_MS, `${starterMs} ms`);
    check('worker asset request returned 200', workerResponses.length > 0 && workerResponses.every((r) => r.status === 200), JSON.stringify(workerResponses));
    const w2 = await waitLive0(page);
    check('a real worker was created for the run', w2.created > before2.created, JSON.stringify(w2));
    check('worker released after completion', w2.live === 0, JSON.stringify(w2));

    // ---- Step 3: infinite loop ----
    step('infinite-loop-run');
    await replaceCode(page, WRONG_CODE);
    const sanityBefore = await sanity(page);
    const w3a = await workers(page);
    const samples = [sanityBefore];
    const rafBefore = await page.evaluate(() => window.__raf);
    t0 = Date.now();
    await page.click('.play-screen__run');
    await page.waitForFunction(() => /Running/.test(document.querySelector('.play-screen__run')?.textContent ?? ''), null, { timeout: 1000 }).catch(() => {});
    let midRaf = rafBefore;
    let timedOutAt = null;
    while (Date.now() - t0 < 6000) {
      samples.push(await sanity(page));
      midRaf = await page.evaluate(() => window.__raf);
      if (await page.$('.test-panel__notice')) {
        timedOutAt = Date.now() - t0;
        break;
      }
      await sleep(100);
    }
    check('"Run timed out" shown', timedOutAt !== null && (await page.textContent('.test-panel__notice')).includes('Run timed out'), `${timedOutAt} ms`);
    check('timeout fires near 3000 ms (2800..4500)', timedOutAt >= 2800 && timedOutAt <= 4500, `${timedOutAt} ms`);
    check('requestAnimationFrame kept advancing during the run', midRaf - rafBefore > 30, `+${midRaf - rafBefore} frames`);
    const sanityAfter = await sanity(page);
    check('sanity meter kept updating (dropped >= 1)', sanityBefore - sanityAfter >= 1, `${sanityBefore} -> ${sanityAfter}`);
    const st3 = await statuses(page);
    check('every test shows timeout', st3.length === 5 && st3.every((s) => s.includes('timeout')), st3.join(' | '));
    check('Run Tests re-enabled', await page.$eval('.play-screen__run', (b) => !b.disabled && b.textContent.trim() === 'Run Tests'));
    const w3 = await waitLive0(page);
    check('fresh worker created for the loop run', w3.created > w3a.created, JSON.stringify(w3));
    check('no worker alive after timeout', w3.live === 0, JSON.stringify(w3));
    const measuredTimeout = timedOutAt;

    // ---- Step 5: layout (before winning) ----
    step('layout');
    for (const [vw, vh] of [[1024, 768], [3840, 2160]]) {
      await page.setViewportSize({ width: vw, height: vh });
      await sleep(250);
      const o = await overflowX(page);
      check(`Play: no horizontal overflow at ${vw}x${vh}`, o.sw <= o.cw && o.bsw <= o.cw, JSON.stringify(o));
      const [wr] = await rects(page, '.play-screen__watcher');
      check(`Play: Watcher rendered at ${vw}x${vh}`, wr && wr.w > 0 && wr.h > 0, JSON.stringify(wr));
      const others = {
        editor: '.play-screen__editor',
        'cm-editor': '.cm-editor',
        'test results': '.test-panel',
        'Run Tests': '.play-screen__run',
        'sanity meter': '.sanity-meter',
        'mute control': '.mute-control',
      };
      for (const [name, sel] of Object.entries(others)) {
        const rs = await rects(page, sel);
        check(`Play: ${name} found at ${vw}x${vh}`, rs.length > 0);
        check(`Play: Watcher does not overlap ${name} at ${vw}x${vh}`, rs.every((r) => !intersects(wr, r)), JSON.stringify({ watcher: wr, [name]: rs[0] }));
      }
    }
    await page.setViewportSize({ width: 1024, height: 768 });

    // ---- Step 4: correct fix wins ----
    step('winning-run');
    await replaceCode(page, FIXED_CODE);
    const w4a = await workers(page);
    await page.click('.play-screen__run');
    await page.waitForSelector('h1.results-heading', { timeout: RUN_TIMEOUT_MS + 3000 });
    const heading = await page.textContent('h1.results-heading');
    check('Results screen shows "You won"', heading.trim() === 'You won', heading);
    const w4 = await waitLive0(page);
    const maxPass = await page.evaluate(() => window.__maxPass);
    check('a fresh worker was created', w4.created > w4a.created, JSON.stringify(w4));
    check('five passes streamed', maxPass === 5, `max passes seen ${maxPass}`);
    check('no worker alive after the win', w4.live === 0, JSON.stringify(w4));
    check('worker asset responses all 200', workerResponses.every((r) => r.status === 200), JSON.stringify(workerResponses));
    for (const [vw, vh] of [[1024, 768], [3840, 2160]]) {
      await page.setViewportSize({ width: vw, height: vh });
      await sleep(250);
      const o = await overflowX(page);
      check(`Results: no horizontal overflow at ${vw}x${vh}`, o.sw <= o.cw && o.bsw <= o.cw, JSON.stringify(o));
    }

    // ---- Step 6: network ----
    step('network');
    writeFileSync(join(logDir, 'requests.json'), JSON.stringify(requests, null, 2));
    const external = requests.filter((u) => {
      if (/^(data|blob|about):/.test(u)) return false;
      return new URL(u).origin !== origin;
    });
    check(`zero requests to other origins (${requests.length} total recorded)`, external.length === 0, external.join(','));
    check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
    return { measuredTimeout, starterMs, requestCount: requests.length };
  } finally {
    await browser.close();
  }
}

function printSummary(extra) {
  console.log('\n=== verify:build summary ===');
  const w = Math.max(...results.map((r) => r.step.length), 4);
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.step.padEnd(w)}  ${r.name}${r.detail && (!r.ok || r.detail.length < 80) ? `  [${r.detail}]` : ''}`);
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  if (extra) console.log(`Measured infinite-loop timeout: ${extra.measuredTimeout} ms (configured ${RUN_TIMEOUT_MS} ms); starter run ${extra.starterMs} ms; ${extra.requestCount} requests (log: ${logDir}/requests.json)`);
}

let extra;
let failure = null;
try {
  extra = await main();
} catch (e) {
  failure = e;
} finally {
  stopPreview();
}
printSummary(extra);
if (failure) {
  console.error(`\nVERIFY FAILED at step "${currentStep}": ${failure.message}`);
  process.exit(1);
}
console.log('\nVERIFY OK');
process.exit(0);
