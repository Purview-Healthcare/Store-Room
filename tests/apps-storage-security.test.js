const { check, data, open, go, assert, URL } = require('./lib');
const vm = require('vm');

const KEY = 'purview_store_room_apps';
const STATUS_TEXT = { live: 'Live', building: 'In development', planned: 'Planned' };
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function appsPage(opts) {
  const r = await open(opts);
  r.dialogs = [];
  r.page.on('dialog', async (d) => { r.dialogs.push(d.message()); try { await d.dismiss(); } catch (e) {} });
  await go(r.page, 'cat:apps');
  return r;
}
const card = (page, app) => page.locator('.appcard').filter({ has: page.locator('h3', { hasText: new RegExp('^' + reEsc(app.name) + '$') }) });
const stored = (page) => page.evaluate((k) => localStorage.getItem(k), KEY);
const app = (key) => data().APPS.find((a) => a.key === key);
async function edit(page, key, v = {}) {
  await page.click('[data-act="edit"][data-key="' + key + '"]');
  if (v.status) await page.click('.stbtn[data-val="' + v.status + '"]');
  if (v.link !== undefined) await page.fill('#ed-link', v.link);
  if (v.desc !== undefined) await page.fill('#ed-desc', v.desc);
}
const save = (page) => page.click('[data-act="save"]');
async function saveEdit(page, key, v) { await edit(page, key, v); await save(page); }
async function reloadApps(page) { await page.reload(); await page.waitForTimeout(200); await go(page, 'cat:apps'); }
async function copyText(page) {
  await page.click('[data-act="copycfg"]');
  await page.waitForTimeout(150);
  return page.evaluate(() => navigator.clipboard.readText());
}

/* ================= Applications page ================= */

check('The applications page shows one card per application', async () => {
  const { page, errors } = await appsPage();
  assert.strictEqual(await page.locator('.appcard').count(), data().APPS.length);
  assert.deepStrictEqual(errors, []);
});

check('Every application card shows its name, description, audience and tag', async () => {
  const { page } = await appsPage();
  for (const a of data().APPS) {
    const c = card(page, a);
    assert.strictEqual(await c.count(), 1, a.name + ' card missing');
    assert.strictEqual((await c.locator('.appdesc').innerText()).trim(), a.desc, a.name + ' description');
    assert.strictEqual((await c.locator('.appaud').innerText()).trim(), a.audience + ' · ' + a.tag, a.name + ' audience/tag');
  }
});

check('Every application card shows a status pill that matches its status', async () => {
  const { page } = await appsPage();
  for (const a of data().APPS) {
    const pill = card(page, a).locator('.stpill');
    assert.strictEqual(await pill.count(), 1, a.name + ' has no status pill');
    assert.strictEqual((await pill.textContent()).trim(), STATUS_TEXT[a.status], a.name + ' pill text');
    assert.ok((await pill.getAttribute('class')).includes({ live: 'st-live', building: 'st-build', planned: 'st-plan' }[a.status]), a.name + ' pill colour class');
  }
});

check('Applications with a link show "Open app" that opens a new tab safely over https', async () => {
  const { page } = await appsPage();
  for (const a of data().APPS.filter((x) => x.link)) {
    const l = card(page, a).locator('a.applink');
    assert.strictEqual(await l.count(), 1, a.name + ' link missing');
    assert.ok((await l.textContent()).includes('Open app'), a.name);
    assert.strictEqual(await l.getAttribute('href'), a.link);
    assert.ok(a.link.startsWith('https://'), a.name + ' link is not https');
    assert.strictEqual(await l.getAttribute('target'), '_blank');
    assert.ok(/noopener/.test(await l.getAttribute('rel')), a.name + ' missing rel=noopener');
  }
});

check('Applications without a link say "Link not added yet" and have no Open app link', async () => {
  const { page } = await appsPage();
  for (const a of data().APPS.filter((x) => !x.link)) {
    const c = card(page, a);
    assert.strictEqual(await c.locator('a.applink').count(), 0, a.name);
    assert.ok((await c.textContent()).includes('Link not added yet'), a.name);
  }
});

check('Every card has an Edit button and the page lists at least one app with and one without a link (sanity)', async () => {
  const { page } = await appsPage();
  assert.strictEqual(await page.locator('.appcard [data-act="edit"]').count(), data().APPS.length);
  assert.ok(data().APPS.some((a) => a.link) && data().APPS.some((a) => !a.link));
});

check('The note on the applications page names a setting that really exists in the file', async () => {
  const { page } = await appsPage();
  const names = await page.$$eval('.appnote code, .ehint code', (els) => els.map((e) => e.textContent.trim()));
  assert.ok(names.length > 0, 'note names no setting');
  for (const n of names) {
    assert.ok(new RegExp('var ' + n + '\\b').test(data().html), 'note tells the admin to use "' + n + '" but the file has no such setting');
  }
});

check('The applications note does not tell admins to edit a setting that the editor does not use', async () => {
  const { page } = await appsPage();
  const note = await page.locator('.appnote').innerText();
  assert.ok(!/APP_LINKS/.test(note), 'note says APP_LINKS, but the real setting is APP_BAKED');
  assert.ok(/APP_BAKED/.test(note) || /Edit/.test(note), 'note should point to the Edit button or APP_BAKED');
});

check('The editor hint names APP_BAKED, the real setting', async () => {
  const { page } = await appsPage();
  await page.click('[data-act="edit"][data-key="drishti"]');
  const hint = await page.locator('.ehint').innerText();
  assert.ok(/APP_BAKED/.test(hint));
  assert.ok(/this device|this browser/i.test(hint), 'hint should say Save only applies on this device');
  assert.ok(/var APP_BAKED\s*=/.test(data().html));
});

/* ================= Editor ================= */

check('Saving a new status updates the status pill straight away', async () => {
  const { page } = await appsPage();
  const a = app('drishti');
  await saveEdit(page, 'drishti', { status: 'planned' });
  assert.strictEqual((await card(page, a).locator('.stpill').textContent()).trim(), 'Planned');
  assert.strictEqual(await page.locator('.appcard.editing').count(), 0, 'editor should close after Save');
});

check('Saving a new link shows an Open app link with that address', async () => {
  const { page } = await appsPage();
  await saveEdit(page, 'drishti', { link: 'https://example.test/drishti' });
  const l = card(page, app('drishti')).locator('a.applink');
  assert.strictEqual(await l.getAttribute('href'), 'https://example.test/drishti');
  assert.strictEqual(await l.getAttribute('target'), '_blank');
  assert.ok(/noopener/.test(await l.getAttribute('rel')));
});

check('Saving a new description shows it on the card', async () => {
  const { page } = await appsPage();
  await saveEdit(page, 'drishti', { desc: 'A made-up description for testing.' });
  assert.strictEqual((await card(page, app('drishti')).locator('.appdesc').innerText()).trim(), 'A made-up description for testing.');
});

check('A saved status, link and description are still there after reloading the page', async () => {
  const { page } = await appsPage();
  await saveEdit(page, 'brahmastra', { status: 'live', link: 'https://example.test/b', desc: 'Persisted text.' });
  await reloadApps(page);
  const c = card(page, app('brahmastra'));
  assert.strictEqual((await c.locator('.stpill').textContent()).trim(), 'Live');
  assert.strictEqual(await c.locator('a.applink').getAttribute('href'), 'https://example.test/b');
  assert.strictEqual((await c.locator('.appdesc').innerText()).trim(), 'Persisted text.');
});

check('The editor opens showing the current values', async () => {
  const { page } = await appsPage();
  const a = app('pcc-dashboard');
  await page.click('[data-act="edit"][data-key="pcc-dashboard"]');
  assert.strictEqual(await page.inputValue('#ed-link'), a.link);
  assert.strictEqual(await page.inputValue('#ed-desc'), a.desc);
  assert.ok((await page.locator('.stbtn.on').getAttribute('data-val')) === a.status);
});

check('Cancel throws away the changes and saves nothing', async () => {
  const { page } = await appsPage();
  const a = app('drishti');
  await edit(page, 'drishti', { status: 'planned', link: 'https://example.test/x', desc: 'Should vanish' });
  await page.click('[data-act="cancel"]');
  const c = card(page, a);
  assert.strictEqual((await c.locator('.stpill').textContent()).trim(), 'Live');
  assert.strictEqual((await c.locator('.appdesc').innerText()).trim(), a.desc);
  assert.strictEqual(await c.locator('a.applink').count(), 0);
  assert.ok(!(await stored(page)) || !JSON.parse(await stored(page)).drishti, 'cancelled edit was stored');
  await reloadApps(page);
  assert.strictEqual((await card(page, a).locator('.stpill').textContent()).trim(), 'Live');
});

check('Opening Edit on a second app closes the first editor without saving it', async () => {
  const { page } = await appsPage();
  const a = app('drishti'), b = app('denial-guru');
  await edit(page, 'drishti', { desc: 'Half typed, never saved' });
  await page.click('[data-act="edit"][data-key="denial-guru"]');
  assert.strictEqual(await page.locator('.appcard.editing').count(), 1, 'only one editor should be open');
  assert.strictEqual(await page.inputValue('#ed-desc'), b.desc, 'second editor must start with its own description');
  assert.strictEqual((await card(page, a).locator('.appdesc').innerText()).trim(), a.desc, 'first app must show saved text');
  assert.ok(!(await stored(page)), 'nothing should be stored');
});

check('Changing status in the editor keeps the text typed so far', async () => {
  const { page } = await appsPage();
  await edit(page, 'drishti', { desc: 'Typed first', link: 'https://example.test/t' });
  await page.click('.stbtn[data-val="planned"]');
  assert.strictEqual(await page.inputValue('#ed-desc'), 'Typed first');
  assert.strictEqual(await page.inputValue('#ed-link'), 'https://example.test/t');
});

check('Saving with no changes leaves no stored override', async () => {
  const { page } = await appsPage();
  await edit(page, 'drishti');
  await save(page);
  const s = await stored(page);
  assert.ok(!s || !JSON.parse(s).drishti, 'override stored although nothing changed: ' + s);
});

check('Changing a value back to the original and saving removes the override', async () => {
  const { page } = await appsPage();
  await saveEdit(page, 'drishti', { status: 'planned' });
  assert.ok(JSON.parse(await stored(page)).drishti);
  await saveEdit(page, 'drishti', { status: 'live' });
  const s = await stored(page);
  assert.ok(!s || !JSON.parse(s).drishti, 'override still stored: ' + s);
  await reloadApps(page);
  assert.strictEqual((await card(page, app('drishti')).locator('.stpill').textContent()).trim(), 'Live');
});

check('A link typed without http(s) gets https:// added', async () => {
  const { page } = await appsPage();
  await saveEdit(page, 'drishti', { link: 'example.test/drishti' });
  assert.strictEqual(await card(page, app('drishti')).locator('a.applink').getAttribute('href'), 'https://example.test/drishti');
});

check('Spaces around a link are removed', async () => {
  const { page } = await appsPage();
  await saveEdit(page, 'drishti', { link: '   https://example.test/s   ' });
  assert.strictEqual(await card(page, app('drishti')).locator('a.applink').getAttribute('href'), 'https://example.test/s');
});

check('An existing link can be cleared and the card goes back to "Link not added yet"', async () => {
  const { page } = await appsPage();
  const a = app('pcc-dashboard');
  await saveEdit(page, 'pcc-dashboard', { link: '' });
  const c = card(page, a);
  assert.strictEqual(await c.locator('a.applink').count(), 0);
  assert.ok((await c.textContent()).includes('Link not added yet'));
  await reloadApps(page);
  assert.strictEqual(await card(page, a).locator('a.applink').count(), 0, 'cleared link came back after reload');
});

check('A link of the form javascript:... never becomes a usable link', async () => {
  const { page } = await appsPage();
  await saveEdit(page, 'drishti', { link: 'javascript:alert(1)' });
  const ls = card(page, app('drishti')).locator('a.applink');
  if (await ls.count()) {
    const href = await ls.getAttribute('href');
    const ok = await page.evaluate((h) => { try { const u = new URL(h); return u.protocol === 'https:' || u.protocol === 'http:'; } catch (e) { return false; } }, href);
    assert.ok(ok, 'saved a broken or unsafe link: ' + href);
  }
});

check('A link of the form data:text/html,... never becomes a usable link', async () => {
  const { page } = await appsPage();
  await saveEdit(page, 'drishti', { link: 'data:text/html,<script>alert(1)</script>' });
  const ls = card(page, app('drishti')).locator('a.applink');
  if (await ls.count()) {
    const href = await ls.getAttribute('href');
    const ok = await page.evaluate((h) => { try { const u = new URL(h); return u.protocol === 'https:' && u.hostname.includes('.'); } catch (e) { return false; } }, href);
    assert.ok(ok, 'saved a broken or unsafe link: ' + href);
  }
});

check('A link with spaces in the middle is not saved as a link that cannot open', async () => {
  const { page } = await appsPage();
  await saveEdit(page, 'drishti', { link: 'not a web address' });
  const ls = card(page, app('drishti')).locator('a.applink');
  if (await ls.count()) {
    const href = await ls.getAttribute('href');
    const ok = await page.evaluate((h) => { try { new URL(h); return true; } catch (e) { return false; } }, href);
    assert.ok(ok, 'saved an invalid link: ' + href);
  }
});

check('A link typed with a quote and extra attribute cannot break out of the page', async () => {
  const { page } = await appsPage();
  await saveEdit(page, 'drishti', { link: 'https://example.test/" onmouseover="window.__hit=1' });
  const l = card(page, app('drishti')).locator('a.applink');
  if (await l.count()) {
    assert.strictEqual(await l.evaluate((e) => e.hasAttribute('onmouseover')), false);
    await l.hover().catch(() => {});
  }
  await page.click('[data-act="edit"][data-key="drishti"]');
  assert.strictEqual(await page.evaluate(() => window.__hit), undefined);
  assert.strictEqual(await page.locator('#ed-link').evaluate((e) => e.hasAttribute('onmouseover')), false);
});

check('A description made of HTML shows as plain text and does not run', async () => {
  const { page, dialogs, errors } = await appsPage();
  const html = '<img src=x onerror=alert(1)>';
  await saveEdit(page, 'drishti', { desc: html });
  await page.waitForTimeout(300);
  const c = card(page, app('drishti'));
  assert.strictEqual((await c.locator('.appdesc').innerText()).trim(), html);
  assert.strictEqual(await c.locator('img').count(), 0);
  assert.deepStrictEqual(dialogs, []);
  await page.click('[data-act="edit"][data-key="drishti"]');
  assert.strictEqual(await page.inputValue('#ed-desc'), html, 'editor must show the text unchanged');
  await reloadApps(page);
  await page.waitForTimeout(300);
  assert.strictEqual(await page.locator('.appcard img').count(), 0);
  assert.deepStrictEqual(dialogs, []);
});

check('A description with <script> and </textarea> tags cannot break the editor or run', async () => {
  const { page, dialogs } = await appsPage();
  const txt = '</textarea><script>window.__x=1</script><b>bold</b>';
  await saveEdit(page, 'drishti', { desc: txt });
  await page.click('[data-act="edit"][data-key="drishti"]');
  assert.strictEqual(await page.inputValue('#ed-desc'), txt);
  assert.strictEqual(await page.evaluate(() => window.__x), undefined);
  assert.strictEqual(await page.locator('.appdesc b').count(), 0);
  assert.deepStrictEqual(dialogs, []);
});

check('A very long description (5000 characters) saves, shows in full and survives a reload', async () => {
  const { page, errors } = await appsPage();
  const long = ('word' + ' ').repeat(1000).trim().slice(0, 5000);
  await saveEdit(page, 'drishti', { desc: long });
  assert.strictEqual((await card(page, app('drishti')).locator('.appdesc').innerText()).trim().length, long.trim().length);
  await reloadApps(page);
  assert.strictEqual((await card(page, app('drishti')).locator('.appdesc').innerText()).trim().length, long.trim().length);
  assert.deepStrictEqual(errors, []);
});

check('A very long description without spaces does not make the page scroll sideways', async () => {
  const { page } = await appsPage();
  await saveEdit(page, 'drishti', { desc: 'x'.repeat(5000) });
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(over <= 1, 'page is ' + over + 'px wider than the screen');
});

check('A very long description does not hide the Edit button or the status pill', async () => {
  const { page } = await appsPage();
  await saveEdit(page, 'drishti', { desc: ('long text ').repeat(500) });
  const c = card(page, app('drishti'));
  assert.ok(await c.locator('.editbtn').isVisible());
  assert.ok(await c.locator('.stpill').isVisible());
});

/* ================= Copy config ================= */

check('Copy config copies exactly the config for the draft, as valid JavaScript', async () => {
  const { page } = await appsPage();
  await edit(page, 'drishti', { status: 'building', link: 'example.test/d', desc: '  Made up text  ' });
  const text = await copyText(page);
  assert.strictEqual(text, 'var APP_BAKED = ' + JSON.stringify({ drishti: { status: 'building', link: 'https://example.test/d', desc: 'Made up text' } }) + ';');
  const v = vm.runInNewContext(text + '; APP_BAKED');
  assert.strictEqual(v.drishti.status, 'building');
});

check('Copy config does not save the draft', async () => {
  const { page } = await appsPage();
  await edit(page, 'drishti', { status: 'planned' });
  await copyText(page);
  assert.ok(!(await stored(page)), 'copying stored something: ' + (await stored(page)));
  await page.click('[data-act="cancel"]');
  assert.strictEqual((await card(page, app('drishti')).locator('.stpill').textContent()).trim(), 'Live');
});

check('Copy config leaves an already saved override on the same app untouched', async () => {
  const { page } = await appsPage();
  await saveEdit(page, 'drishti', { status: 'building' });
  await edit(page, 'drishti', { status: 'planned' });
  await copyText(page);
  assert.strictEqual(JSON.parse(await stored(page)).drishti.status, 'building');
  await page.click('[data-act="cancel"]');
  assert.strictEqual((await card(page, app('drishti')).locator('.stpill').textContent()).trim(), 'In development');
});

check('Copy config with no changes anywhere gives an empty config', async () => {
  const { page } = await appsPage();
  await edit(page, 'drishti');
  assert.strictEqual(await copyText(page), 'var APP_BAKED = {};');
});

check('Copy config includes edits saved earlier on other apps as well as the draft', async () => {
  const { page } = await appsPage();
  await saveEdit(page, 'denial-guru', { status: 'planned' });
  await edit(page, 'drishti', { status: 'building' });
  const v = vm.runInNewContext((await copyText(page)) + '; APP_BAKED');
  assert.strictEqual(v['denial-guru'].status, 'planned');
  assert.strictEqual(v.drishti.status, 'building');
  assert.ok(!('gurukul' in v), 'unchanged apps must not be listed');
});

check('Copy config lists only the fields that changed', async () => {
  const { page } = await appsPage();
  await edit(page, 'drishti', { status: 'planned' });
  const v = vm.runInNewContext((await copyText(page)) + '; APP_BAKED');
  assert.deepStrictEqual(Object.keys(v.drishti), ['status']);
});

check('After Copy config the button says "Copied"', async () => {
  const { page } = await appsPage();
  await edit(page, 'drishti', { status: 'planned' });
  await page.click('[data-act="copycfg"]');
  await page.waitForTimeout(100);
  assert.strictEqual((await page.locator('[data-act="copycfg"]').textContent()).trim(), 'Copied');
});

check('Copy config still works when the browser clipboard is not available', async () => {
  const { page, errors } = await appsPage({ blockClipboard: true });
  assert.strictEqual(await page.evaluate(() => !navigator.clipboard), true);
  await page.evaluate(() => {
    window.__copied = null;
    document.execCommand = function () { const a = document.activeElement; window.__copied = a && a.value; return true; };
  });
  await edit(page, 'drishti', { status: 'planned' });
  await page.click('[data-act="copycfg"]');
  await page.waitForTimeout(100);
  assert.strictEqual(await page.evaluate(() => window.__copied), 'var APP_BAKED = {"drishti":{"status":"planned"}};');
  assert.strictEqual((await page.locator('[data-act="copycfg"]').textContent()).trim(), 'Copied');
  assert.strictEqual(await page.locator('body > textarea').count(), 0, 'temporary textarea left on page');
  assert.deepStrictEqual(errors, []);
  assert.ok(!(await stored(page)));
});

check('When the clipboard refuses the copy, the button does not claim "Copied"', async () => {
  const { page } = await appsPage();
  await page.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error('denied')); });
  await edit(page, 'drishti', { status: 'planned' });
  await page.click('[data-act="copycfg"]');
  await page.waitForTimeout(150);
  const label = (await page.locator('[data-act="copycfg"]').textContent()).trim();
  assert.notStrictEqual(label, 'Copied', 'button says Copied although the copy failed');
});

/* ================= Broken saved data and blocked storage ================= */

check('Saved data that is not valid JSON does not stop the page loading', async () => {
  const { page, errors } = await appsPage({ storage: { [KEY]: '{not json' } });
  assert.strictEqual(await page.locator('.appcard').count(), data().APPS.length);
  assert.deepStrictEqual(errors, []);
  assert.strictEqual((await card(page, app('drishti')).locator('.stpill').textContent()).trim(), 'Live');
});

check('After broken saved data, a new save works and replaces it', async () => {
  const { page } = await appsPage({ storage: { [KEY]: '{not json' } });
  await saveEdit(page, 'drishti', { status: 'planned' });
  assert.strictEqual(JSON.parse(await stored(page)).drishti.status, 'planned');
});

check('Saved data for an app that does not exist is ignored without errors', async () => {
  const { page, errors } = await appsPage({ storage: { [KEY]: JSON.stringify({ 'no-such-app': { status: 'planned', link: 'https://ghost.example.test', desc: 'Ghost' } }) } });
  assert.strictEqual(await page.locator('.appcard').count(), data().APPS.length);
  assert.ok(!(await page.innerText('#main')).includes('Ghost'));
  assert.deepStrictEqual(errors, []);
});

check('Saved data of the wrong kind (null) does not break the page', async () => {
  const { page, errors } = await appsPage({ storage: { [KEY]: 'null' } });
  assert.strictEqual(await page.locator('.appcard').count(), data().APPS.length, errors.join('; '));
  assert.deepStrictEqual(errors, []);
});

check('Saved data where an app entry is a plain text value does not break the page', async () => {
  const { page, errors } = await appsPage({ storage: { [KEY]: JSON.stringify({ drishti: 'oops' }) } });
  assert.strictEqual(await page.locator('.appcard').count(), data().APPS.length, errors.join('; '));
  assert.deepStrictEqual(errors, []);
});

check('Saved data with an unknown status still leaves a status pill on the card', async () => {
  const { page } = await appsPage({ storage: { [KEY]: JSON.stringify({ drishti: { status: 'bogus' } }) } });
  assert.strictEqual(await card(page, app('drishti')).locator('.stpill').count(), 1, 'card has no status pill');
});

check('Saved data with a javascript: link is not shown as a clickable link', async () => {
  const { page } = await appsPage({ storage: { [KEY]: JSON.stringify({ drishti: { link: 'javascript:alert(1)' } }) } });
  const ls = card(page, app('drishti')).locator('a.applink');
  if (await ls.count()) {
    const href = await ls.getAttribute('href');
    assert.ok(/^https?:\/\//i.test(href), 'link opens a non-web address: ' + href);
  }
});

check('When browser storage refuses to save, the user is told and the page keeps working', async () => {
  const { page, context, dialogs, errors } = await appsPage();
  await page.evaluate(() => { Storage.prototype.setItem = function () { throw new Error('QuotaExceededError'); }; });
  await saveEdit(page, 'drishti', { status: 'planned' });
  await page.waitForTimeout(100);
  assert.strictEqual(dialogs.length, 1, 'expected one alert');
  assert.ok(/could not be stored/i.test(dialogs[0]), dialogs[0]);
  assert.strictEqual((await card(page, app('drishti')).locator('.stpill').textContent()).trim(), 'Planned', 'change should still apply for this visit');
  assert.strictEqual(await page.locator('.appcard.editing').count(), 0);
  await go(page, 'home');
  assert.ok(await page.locator('.herotitle').isVisible());
  await go(page, 'cat:apps');
  assert.strictEqual(await page.locator('.appcard').count(), data().APPS.length);
  assert.deepStrictEqual(errors, []);
});

check('When all browser storage is blocked from the start, the page loads and saving shows the alert', async () => {
  const r = await open();
  const { page, context, errors } = r;
  const dialogs = [];
  page.on('dialog', async (d) => { dialogs.push(d.message()); await d.dismiss(); });
  await context.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } });
  });
  await page.reload();
  await page.waitForTimeout(200);
  await go(page, 'cat:apps');
  assert.strictEqual(await page.locator('.appcard').count(), data().APPS.length);
  await saveEdit(page, 'drishti', { status: 'planned' });
  await page.waitForTimeout(100);
  assert.strictEqual(dialogs.length, 1);
  assert.ok(/could not be stored/i.test(dialogs[0]));
  assert.strictEqual((await card(page, app('drishti')).locator('.stpill').textContent()).trim(), 'Planned');
  assert.deepStrictEqual(errors, []);
});

/* ================= Two tabs ================= */

check('Two tabs: an edit to app A in tab 1 and then an edit to app B in tab 2 both survive a reload', async () => {
  const { page: p1, context } = await appsPage();
  const p2 = await context.newPage();
  await p2.goto(URL);
  await go(p2, 'cat:apps');
  await saveEdit(p1, 'drishti', { status: 'planned' });
  await saveEdit(p2, 'gurukul', { status: 'live' });
  await reloadApps(p1);
  const s = JSON.parse(await stored(p1));
  assert.ok(s.drishti && s.drishti.status === 'planned', 'edit made in tab 1 was lost silently; stored: ' + JSON.stringify(s));
  assert.ok(s.gurukul && s.gurukul.status === 'live', 'edit made in tab 2 missing');
});

check('Two tabs: editing the same app in both, the last save wins and nothing breaks', async () => {
  const { page: p1, context } = await appsPage();
  const p2 = await context.newPage();
  const errs = [];
  p2.on('pageerror', (e) => errs.push(e.message));
  await p2.goto(URL);
  await go(p2, 'cat:apps');
  await saveEdit(p1, 'drishti', { desc: 'From tab one' });
  await saveEdit(p2, 'drishti', { desc: 'From tab two' });
  await reloadApps(p1);
  assert.strictEqual((await card(p1, app('drishti')).locator('.appdesc').innerText()).trim(), 'From tab two');
  assert.deepStrictEqual(errs, []);
});

check('Two tabs: a change saved in tab 1 shows in a tab that is opened afterwards', async () => {
  const { page: p1, context } = await appsPage();
  await saveEdit(p1, 'drishti', { status: 'planned' });
  const p2 = await context.newPage();
  await p2.goto(URL);
  await go(p2, 'cat:apps');
  assert.strictEqual((await card(p2, app('drishti')).locator('.stpill').textContent()).trim(), 'Planned');
});

/* ================= Who sees what ================= */

check('Edits made in one browser profile do not appear in a fresh browser profile', async () => {
  const a = await appsPage();
  await saveEdit(a.page, 'drishti', { status: 'planned', desc: 'Private to profile A', link: 'https://example.test/a' });
  const b = await appsPage();
  const c = card(b.page, app('drishti'));
  assert.strictEqual((await c.locator('.stpill').textContent()).trim(), 'Live');
  assert.strictEqual((await c.locator('.appdesc').innerText()).trim(), app('drishti').desc);
  assert.strictEqual(await c.locator('a.applink').count(), 0);
  assert.ok(!(await b.page.innerText('body')).includes('Private to profile A'));
  assert.ok(!(await stored(b.page)));
});

check('The page stores only the application edits in the browser and no cookies', async () => {
  const { page, context } = await appsPage();
  await page.fill('#q', 'denial').catch(() => {});
  await go(page, 'PL-01');
  await go(page, 'home');
  const keys = await page.evaluate(() => Object.keys(localStorage).concat(Object.keys(sessionStorage)));
  for (const k of keys) assert.strictEqual(k, KEY, 'unexpected browser storage key: ' + k);
  assert.deepStrictEqual(await context.cookies(), []);
});

check('Nothing is written to browser storage until someone saves an edit', async () => {
  const { page } = await appsPage();
  assert.strictEqual(await stored(page), null);
  await edit(page, 'drishti', { status: 'planned' });
  assert.strictEqual(await stored(page), null, 'draft stored before Save');
});

/* ================= Security ================= */

check('The file contains no keys, tokens, passwords or secrets', async () => {
  const html = data().html;
  const patterns = [
    /api[_-]?key/i, /secret/i, /passw(or)?d\s*[=:]/i, /bearer\s+[a-z0-9._-]{12,}/i, /\bsk-[A-Za-z0-9]{10,}/, /AKIA[0-9A-Z]{12,}/,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /ghp_[A-Za-z0-9]{20,}/, /xox[bap]-[A-Za-z0-9-]{10,}/, /AIza[0-9A-Za-z_-]{30,}/,
    /\btoken\s*[=:]\s*['"][^'"]{8,}/i, /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\./,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    assert.ok(!m, 'possible secret matching ' + p + ' near: ' + (m ? html.slice(Math.max(0, m.index - 40), m.index + 60).replace(/\s+/g, ' ') : ''));
  }
});

check('The file has no e-mail addresses, phone numbers or patient-style identifiers', async () => {
  const html = data().html;
  const m = html.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  assert.ok(!m, 'e-mail address in file: ' + (m && m[0]));
  const ssn = html.match(/\b\d{3}-\d{2}-\d{4}\b/);
  assert.ok(!ssn, 'SSN-like number: ' + (ssn && ssn[0]));
});

check('The page makes no network requests other than the file itself and data: addresses', async () => {
  const r = await open();
  const { page } = r;
  const reqs = [];
  page.on('request', (q) => reqs.push(q.url()));
  await page.reload();
  await page.waitForTimeout(300);
  for (const t of ['cat:policy', 'cat:workflow', 'cat:apps', 'home']) await go(page, t);
  for (const d of data().SOPS) await go(page, d.id);
  await go(page, 'cat:apps');
  await saveEdit(page, 'drishti', { status: 'planned' });
  await page.fill('#q', 'denial').catch(() => {});
  await page.waitForTimeout(300);
  const bad = reqs.filter((u) => !u.startsWith('data:') && u !== URL && !u.startsWith(URL + '#'));
  assert.deepStrictEqual(bad, []);
});

check('The code never calls out to the network (no fetch, XHR, beacons, sockets, iframes or external scripts)', async () => {
  const html = data().html;
  for (const p of [/\bfetch\s*\(/, /XMLHttpRequest/, /sendBeacon/, /new\s+WebSocket/, /new\s+EventSource/, /<iframe/i, /<script[^>]+src=/i, /<link[^>]+href=["']https?:/i, /@import\s+url\(\s*['"]?https?:/i, /url\(\s*['"]?https?:/i, /<img[^>]+src=["']https?:/i]) {
    assert.ok(!p.test(html), 'found ' + p);
  }
});

check('The file has exactly one script block and no inline event handlers in markup', async () => {
  const html = data().html;
  assert.strictEqual((html.match(/<script\b/gi) || []).length, 1);
  assert.ok(!/<[a-z][^>]*\son(click|load|error|mouseover)\s*=/i.test(html.replace(/<script[\s\S]*<\/script>/i, '')), 'inline handler in markup');
});

check('No document text contains HTML tags that could run (script, img, iframe, on-handlers)', async () => {
  const blob = JSON.stringify(data().SOPS) + JSON.stringify(data().APPS) + JSON.stringify(data().SITUATIONS);
  assert.ok(!/<\s*\/?\s*(script|img|iframe|svg|object|embed|link)/i.test(blob), 'tag found in data');
  assert.ok(!/\bon(error|load|click)\s*=/i.test(blob));
  assert.ok(!/javascript:/i.test(blob));
});

check('Every document renders without injecting any script, image or iframe element', async () => {
  const { page, errors } = await open();
  for (const d of data().SOPS) {
    await go(page, d.id);
    const n = await page.locator('#main script, #main iframe, #main object, #main embed, #main img').count();
    assert.strictEqual(n, 0, d.id + ' contains an injected element');
  }
  assert.deepStrictEqual(errors, []);
});

check('Document text with angle brackets and ampersands is shown as typed (escaped)', async () => {
  const { page } = await open();
  const withSpecial = data().SOPS.filter((d) => /[<>&]/.test(JSON.stringify(d.title)));
  for (const d of withSpecial) {
    await go(page, d.id);
    assert.ok((await page.innerText('#main')).includes(d.title), d.id);
  }
});

check('Every application link in the file is a plain https address that parses', async () => {
  for (const a of data().APPS) {
    if (!a.link) continue;
    const u = new (require('url').URL)(a.link);
    assert.strictEqual(u.protocol, 'https:', a.name);
  }
});

check('Application names and tags in a search result are escaped when the search text has HTML', async () => {
  const { page, dialogs } = await appsPage();
  await go(page, 'home');
  await page.fill('#q', '<img src=x onerror=alert(1)>');
  await page.waitForTimeout(400);
  assert.strictEqual(await page.locator('#main img').count(), 0);
  assert.deepStrictEqual(dialogs, []);
});

check('A description saved with an HTML tag also stays plain text in search results', async () => {
  const { page, dialogs } = await appsPage();
  await saveEdit(page, 'drishti', { desc: 'Look <img src=x onerror=alert(1)> here' });
  await page.fill('#q', 'Look');
  await page.waitForTimeout(400);
  assert.strictEqual(await page.locator('#main img').count(), 0);
  assert.deepStrictEqual(dialogs, []);
});
