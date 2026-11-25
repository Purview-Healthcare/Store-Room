/* Store Room test kit: plain-English checks run in a real Chromium browser.
   Usage in a *.test.js file:
     const { check, data, open, go } = require('./lib');
     check('Home page shows 9 applications', async () => { ... });            */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const FILE = path.resolve(__dirname, '..', 'index.html');
const URL = 'file://' + FILE;
const checks = [];
let currentFile = '';

function check(name, fn) { checks.push({ name, fn, file: currentFile }); }
/* A check that is waiting for an owner decision: listed, not run. */
function pending(name, reason) { checks.push({ name, reason, pending: true, file: currentFile }); }

/* The app's own data (SOPS, APPS, SITUATIONS, CATS, STORE_VERSION...),
   read straight from index.html without a browser. */
let _data = null;
function data() {
  if (_data) return _data;
  const html = fs.readFileSync(FILE, 'utf8');
  const pick = (name) => {
    const m = html.match(new RegExp('var ' + name + ' = ([\\s\\S]*?\\n\\]);'));
    return m ? vm.runInNewContext('(' + m[1].replace(/;$/, '') + ')') : undefined;
  };
  const one = (name) => { const m = html.match(new RegExp("var " + name + " = '([^']*)';")); return m ? m[1] : undefined; };
  _data = { html, SOPS: pick('SOPS'), APPS: pick('APPS'), SITUATIONS: pick('SITUATIONS'),
            STORE_VERSION: one('STORE_VERSION'), STORE_UPDATED: one('STORE_UPDATED') };
  return _data;
}

/* Opens the app in a fresh browser page. Options:
   width/height, reducedMotion ('reduce' | 'no-preference'), storage (object put in localStorage first),
   blockClipboard (true: navigator.clipboard missing). Returns { page, errors, context }. */
let browser = null;
async function open(opts = {}) {
  const { chromium } = require('playwright');
  if (!browser) browser = await chromium.launch({ args: ['--font-render-hinting=none'] });
  const context = await browser.newContext({
    viewport: { width: opts.width || 1366, height: opts.height || 900 },
    reducedMotion: opts.reducedMotion || 'reduce',
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(({ storage, blockClipboard }) => {
    if (storage) for (const k of Object.keys(storage)) localStorage.setItem(k, storage[k]);
    if (blockClipboard) { try { Object.defineProperty(navigator, 'clipboard', { value: undefined }); } catch (e) {} }
  }, { storage: opts.storage || null, blockClipboard: !!opts.blockClipboard });
  await page.goto(URL);
  await page.waitForTimeout(300);
  return { page, errors, context };
}

/* Navigate the way a user's click would: 'home', 'cat:policy', 'PL-03'... */
async function go(page, target) {
  await page.evaluate((t) => go(t), target);
  await page.waitForTimeout(100);
}

async function run() {
  const dir = __dirname;
  const only = process.argv[2];
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.test.js')).sort()) {
    if (only && !f.includes(only)) continue;
    currentFile = f;
    require(path.join(dir, f));
  }
  let pass = 0, fail = 0, wait = 0;
  const failed = [];
  for (const c of checks) {
    if (c.pending) { wait++; console.log('  WAIT  ' + c.name + '  (needs owner: ' + c.reason + ')'); continue; }
    try { await c.fn(); pass++; console.log('  PASS  ' + c.name); }
    catch (e) { fail++; failed.push(c); console.log('  FAIL  ' + c.name + '\n        ' + String(e && e.message || e).split('\n')[0]); }
  }
  if (browser) await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed, ' + wait + ' waiting for owner, ' + checks.length + ' checks');
  if (failed.length) { console.log('Failed:'); failed.forEach((c) => console.log('  - [' + c.file + '] ' + c.name)); }
  process.exitCode = fail ? 1 : 0;
}

module.exports = { check, pending, data, open, go, run, assert, URL };
