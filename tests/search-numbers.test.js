const { check, data, open, go, assert: nodeAssert } = require('./lib');
/* arrays from the data come from another JS context, so compare them as JSON */
const assert = Object.assign((...a) => nodeAssert(...a), nodeAssert, {
  deepStrictEqual: (a, b, m) => nodeAssert.strictEqual(JSON.stringify(a), JSON.stringify(b), m || ('got ' + JSON.stringify(a).slice(0, 400))),
});

/* ---------- helpers ---------- */
const D = data();
const strip = (s) => String(s).replace(/\*\*/g, '');

/* every string in the data with a label for where it lives */
function walk(o, path, out) {
  if (typeof o === 'string') out.push({ path, s: o });
  else if (Array.isArray(o)) o.forEach((x, i) => walk(x, path + '[' + i + ']', out));
  else if (o && typeof o === 'object') for (const k of Object.keys(o)) walk(o[k], path + '.' + k, out);
  return out;
}
function allStrings() {
  const out = [];
  D.SOPS.forEach((d) => walk(d, d.id, out));
  D.APPS.forEach((a) => walk(a, 'APP:' + a.key, out));
  D.SITUATIONS.forEach((x, i) => walk(x, 'SIT[' + i + ']', out));
  return out;
}

/* a findable chunk of visible text: the longest piece with no ** marker, trimmed, max 28 chars */
function chunk(s) {
  const parts = String(s).split('**').map((x) => x.replace(/\s+/g, ' ').trim()).filter((x) => x.length >= 3);
  if (!parts.length) return null;
  parts.sort((a, b) => b.length - a.length);
  let c = parts[0].slice(0, 28).trim();
  return c.length >= 3 ? c : null;
}

/* every visible string of a document, tagged by the kind of place it lives in */
function docFields(doc) {
  const f = [];
  const add = (kind, s) => { if (typeof s === 'string' && s.trim()) f.push({ kind, s, id: doc.id }); };
  add('title', doc.title); add('short', doc.short); add('purpose', doc.purpose);
  const addTable = (kind, tb) => {
    add(kind + ' title', tb.title);
    (tb.cols || []).forEach((c) => add(kind + ' header', c));
    (tb.rows || []).forEach((r) => r.forEach((c) => add(kind + ' cell', c)));
    add(kind + ' note', tb.note);
  };
  doc.sections.forEach((sec) => {
    add('section name', sec.name); add('section time', sec.time);
    (sec.steps || []).forEach((st) => {
      add('step title', st.t); add('step text', st.d); add('step who', st.who); add('step when', st.when);
      (st.list || []).forEach((x) => add('step list', x));
      (st.tables || []).forEach((tb) => addTable('step table', tb));
      if (st.note) { add('note body', st.note.x); add('note heading', st.note.h); }
    });
    (sec.tables || []).forEach((tb) => addTable('section table(inner)', tb));
    if (sec.cols) { sec.cols.forEach((c) => add('section table header', c)); }
    (sec.rows || []).forEach((r) => r.forEach((c) => add('section table cell', c)));
    add('section table note', sec.note);
    add('template body', sec.body);
    (sec.dos || []).forEach((x) => add('do item', x));
    (sec.donts || []).forEach((x) => add("don't item", x));
  });
  return f;
}

/* run a search through the real search box and return what the user sees */
async function search(page, q) {
  await page.fill('#q', q);
  await page.waitForTimeout(30);
}
async function resultIds(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('.results .rcard')).map((c) => {
    const r = c.querySelector('.rid'); return r ? r.textContent.trim() : '';
  }));
}
async function resultCount(page) {
  return page.evaluate(() => document.querySelectorAll('.results .rcard').length);
}
/* quick bulk lookup using the app's own search function (state.q is set the same way the box sets it) */
async function bulkFind(page, queries) {
  return page.evaluate((qs) => qs.map((q) => {
    state.q = q;
    const r = searchHits();
    return { q, docs: r.docs.map((h) => h.doc.id), apps: r.apps.map((a) => a.name) };
  }), queries);
}
function monthIndex(m) { return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(m); }
function parseDate(s) {
  const m = /^(\d{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})$/.exec(s || '');
  if (!m) return null;
  const d = new Date(Date.UTC(+m[3], monthIndex(m[2]), +m[1]));
  if (d.getUTCDate() !== +m[1] || d.getUTCMonth() !== monthIndex(m[2])) return null;
  return { y: +m[3], m: monthIndex(m[2]), d: +m[1], t: d.getTime() };
}
const nonRef = (doc) => doc.sections.filter((s) => !s.ref);

/* ================= SEARCH: every visible word must be findable ================= */
function findabilityCheck(label, kinds) {
  check('Search finds words that appear only in ' + label, async () => {
    const { page, errors } = await open();
    const fields = [];
    D.SOPS.forEach((d) => docFields(d).forEach((x) => { if (kinds.includes(x.kind)) fields.push(x); }));
    assert.ok(fields.length > 0, 'test found no ' + label + ' to try');
    const qs = []; const idx = [];
    fields.forEach((x) => { const c = chunk(x.s); if (c) { qs.push(c); idx.push(x); } });
    const res = await bulkFind(page, qs);
    const missing = [];
    res.forEach((r, i) => { if (!r.docs.includes(idx[i].id)) missing.push(idx[i].id + ' [' + idx[i].kind + '] "' + qs[i] + '"'); });
    assert.deepStrictEqual(missing.slice(0, 6), [], missing.length + ' of ' + qs.length + ' visible phrases not found; first: ' + missing.slice(0, 4).join(' | '));
    assert.deepStrictEqual(errors, []);
  });
}
findabilityCheck('titles, short lines and purpose', ['title', 'short', 'purpose']);
findabilityCheck('step titles and step text', ['step title', 'step text', 'section name']);
findabilityCheck('step "who" and "when" labels', ['step who', 'step when']);
findabilityCheck('step bullet lists', ['step list']);
findabilityCheck('tables inside steps (title, header, cell, note)', ['step table title', 'step table header', 'step table cell', 'step table note']);
findabilityCheck('section tables (header, cell, note)', ['section table header', 'section table cell', 'section table note']);
findabilityCheck('note bodies', ['note body']);
findabilityCheck('note headings (the bold label of a callout)', ['note heading']);
findabilityCheck('do and do-not lists', ['do item', "don't item"]);

check('Search finds the phrase "45 days" that lives only in a table inside a PL-02 step', async () => {
  const { page } = await open();
  await search(page, '45 days');
  const ids = await resultIds(page);
  assert.ok(ids.some((x) => x.startsWith('PL-02')), 'PL-02 not in results: ' + ids.join(', '));
});

check('Search finds "Mithilesh" (PL-07)', async () => {
  const { page } = await open();
  await search(page, 'Mithilesh');
  const ids = await resultIds(page);
  assert.ok(ids.some((x) => x.startsWith('PL-07')), 'PL-07 not in results: ' + ids.join(', '));
});

check('Search finds every application by name, description, tag and audience', async () => {
  const { page } = await open();
  const qs = [], idx = [];
  D.APPS.forEach((a) => ['name', 'desc', 'tag', 'audience'].forEach((k) => { const c = chunk(a[k]); if (c) { qs.push(c); idx.push(a.name + ' [' + k + ']'); } }));
  const res = await bulkFind(page, qs);
  const missing = [];
  res.forEach((r, i) => { const nm = idx[i].split(' [')[0]; if (!r.apps.includes(nm)) missing.push(idx[i] + ' "' + qs[i] + '"'); });
  assert.deepStrictEqual(missing, [], 'not found: ' + missing.join(' | '));
});

check('Search is not case sensitive', async () => {
  const { page } = await open();
  await search(page, 'mithilesh');
  const a = await resultCount(page);
  await search(page, 'MITHILESH');
  const b = await resultCount(page);
  await search(page, 'MiThIlEsH');
  const c = await resultCount(page);
  assert.ok(a > 0 && a === b && b === c, 'counts ' + [a, b, c]);
});

check('Typing one letter does not open the results page', async () => {
  const { page } = await open();
  await search(page, 'a');
  assert.strictEqual(await page.locator('.results').count(), 0);
  assert.ok(await page.locator('.hero').isVisible());
});

check('Two letters open the results page, and a result count is shown', async () => {
  const { page } = await open();
  await search(page, 'wf');
  assert.strictEqual(await page.locator('.results').count(), 1);
  assert.match(await page.innerText('.rcount'), /^\d+ results? for/);
});

check('The result count equals the number of result cards, and "1 result" is singular', async () => {
  const { page } = await open();
  await search(page, 'Mithilesh');
  const n = await resultCount(page);
  const txt = await page.innerText('.rcount');
  assert.ok(txt.startsWith(n + ' result' + (n === 1 ? ' ' : 's ')), txt + ' vs ' + n + ' cards');
});

check('Typing then deleting the text returns to the home page', async () => {
  const { page } = await open();
  await search(page, 'leave');
  assert.strictEqual(await page.locator('.results').count(), 1);
  await search(page, '');
  assert.strictEqual(await page.locator('.results').count(), 0);
  assert.ok(await page.locator('.hero').isVisible());
  assert.strictEqual(await page.locator('mark').count(), 0, 'highlights left behind after deleting');
});

check('Backspacing from 2 letters to 1 returns to the home page', async () => {
  const { page } = await open();
  await page.click('#q');
  await page.keyboard.type('le');
  assert.strictEqual(await page.locator('.results').count(), 1);
  await page.keyboard.press('Backspace');
  assert.strictEqual(await page.locator('.results').count(), 0);
  assert.ok(await page.locator('.hero').isVisible());
});

check('Spaces only do not open the results page', async () => {
  const { page, errors } = await open();
  await search(page, '      ');
  assert.strictEqual(await page.locator('.results').count(), 0);
  assert.deepStrictEqual(errors, []);
});

check('Spaces around a word are ignored (" Mithilesh " finds the same as "Mithilesh")', async () => {
  const { page } = await open();
  await search(page, 'Mithilesh');
  const a = await resultCount(page);
  await search(page, '   Mithilesh   ');
  assert.strictEqual(await resultCount(page), a);
  assert.ok(a > 0);
});

/* ================= odd input ================= */
for (const w of ['zzqqxx', 'undefined', 'null', 'NaN', 'true', '[object Object]']) {
  const present = JSON.stringify([D.SOPS, D.APPS, D.SITUATIONS]).toLowerCase().includes(w.toLowerCase());
  if (present) continue;
  check('A word that is not in the app ("' + w + '") returns 0 results', async () => {
    const { page, errors } = await open();
    await search(page, w);
    const n = await resultCount(page);
    assert.strictEqual(n, 0, n + ' results shown for "' + w + '": ' + (await resultIds(page)).join(', '));
    assert.match(await page.innerText('.rcount'), /^0 results/);
    assert.strictEqual(await page.locator('.noresults').count(), 1);
    assert.deepStrictEqual(errors, []);
  });
}

check('Searching a word that is not in the app shows the "Nothing in the store room" message', async () => {
  const { page } = await open();
  await search(page, 'zzqqxx');
  assert.ok((await page.innerText('.noresults')).includes('Nothing in the store room'));
});

for (const q of ['(a', '.*', '[a', 'a)', '\\a', '^$', '+?', '{2}', '|a', 'a|b', '$&', '(?<']) {
  check('Regex symbols "' + q + '" are searched as plain text and do not crash', async () => {
    const { page, errors } = await open();
    await search(page, q);
    const expected = JSON.stringify([D.SOPS, D.APPS]).toLowerCase().includes(JSON.stringify(q.toLowerCase()).slice(1, -1)) ? null : 0;
    assert.strictEqual(await page.locator('.results').count(), 1, 'results page not shown');
    if (expected === 0) assert.strictEqual(await resultCount(page), 0, 'regex acted as a pattern');
    assert.deepStrictEqual(errors, []);
    assert.ok(await page.locator('#q').isVisible());
  });
}

check('A very long search (2000 characters) does not crash and returns 0 results', async () => {
  const { page, errors } = await open();
  await search(page, 'ab'.repeat(1000));
  assert.strictEqual(await resultCount(page), 0);
  assert.deepStrictEqual(errors, []);
});

check('A very long search does not push the page wider than the screen', async () => {
  const { page } = await open({ width: 1366 });
  await search(page, 'ab'.repeat(1000));
  const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  assert.ok(w.sw <= w.cw + 1, 'page scrolls sideways: ' + w.sw + ' > ' + w.cw);
});

check('A very long search with spaces does not push the page wider on a phone', async () => {
  const { page } = await open({ width: 390, height: 800 });
  const base = await page.evaluate(() => document.documentElement.scrollWidth);
  await page.click('#browsetoggle');
  await search(page, ('x'.repeat(30) + ' ').repeat(60));
  const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  assert.ok(w.sw <= base, 'search made the page wider: ' + w.sw + ' > ' + base + ' (screen ' + w.cw + ')');
});

check('Searching <b> shows the letters as text and does not create bold text or tags', async () => {
  const { page, errors } = await open();
  await search(page, '<b>');
  assert.ok((await page.innerText('.rcount')).includes('<b>'));
  assert.strictEqual(await page.locator('.rcount b').count(), 0);
  assert.deepStrictEqual(errors, []);
});

check('Searching <img src=x onerror=window.__x=1> does not run anything', async () => {
  const { page, errors } = await open();
  await search(page, '<img src=x onerror=window.__x=1>');
  await page.waitForTimeout(100);
  assert.strictEqual(await page.evaluate(() => window.__x), undefined);
  assert.strictEqual(await page.locator('.results img').count(), 0);
  assert.deepStrictEqual(errors, []);
});

check('A quote mark in the search box is handled ("a\\"b" and a lone quote)', async () => {
  const { page, errors } = await open();
  await search(page, 'a"b');
  assert.ok((await page.innerText('.rcount')).includes('a"b'));
  await search(page, '"');
  assert.strictEqual(await page.locator('.results').count(), 0, 'one character should not open results');
  assert.deepStrictEqual(errors, []);
});

check('A lone "&" or "(" or "[" (one character) leaves the home page showing', async () => {
  const { page, errors } = await open();
  for (const ch of ['&', '(', '[', '.', '*', '<']) {
    await search(page, ch);
    assert.strictEqual(await page.locator('.results').count(), 0, ch + ' opened results');
  }
  assert.deepStrictEqual(errors, []);
});

for (const q of ['amp', 'quot', 'lt', 'gt', 'nbsp', '#39']) {
  check('Searching "' + q + '" never shows broken entity text such as "&amp;" in the results', async () => {
    const { page, errors } = await open();
    await search(page, q);
    const txt = await page.innerText('.results');
    const bad = txt.match(/&(amp|quot|lt|gt|#39|nbsp);?/g);
    assert.strictEqual(bad, null, 'broken text in results: ' + (bad || []).slice(0, 5).join(' '));
    assert.deepStrictEqual(errors, []);
  });
}

check('Searching "amp" then opening a document does not show broken "&amp;" text on the document', async () => {
  const { page } = await open();
  await search(page, 'amp');
  // pick every document that has an ampersand somewhere and open it
  const docsWithAmp = D.SOPS.filter((d) => JSON.stringify(d).includes('&')).map((d) => d.id);
  assert.ok(docsWithAmp.length > 0);
  for (const id of docsWithAmp) {
    await go(page, id);
    const txt = await page.innerText('#main');
    const bad = txt.match(/&(amp|quot|lt|gt|#39);/g);
    assert.strictEqual(bad, null, id + ' shows ' + (bad || []).slice(0, 3).join(' '));
  }
});

check('Searching "amp" then viewing the applications page does not show broken "&amp;" text', async () => {
  const { page } = await open();
  await search(page, 'amp');
  await go(page, 'cat:apps');
  const txt = await page.innerText('#main');
  assert.strictEqual(txt.match(/&(amp|quot|lt|gt|#39);/g), null, 'broken entity text on applications page');
});

check('Search results never show raw ** markers', async () => {
  const { page } = await open();
  const bad = [];
  for (const q of ['leave', 'days', 'supervisor', 'written warning', 'WFH', 'probation', 'email', 'the']) {
    await search(page, q);
    const txt = await page.innerText('.results');
    if (txt.includes('**')) bad.push(q);
  }
  assert.deepStrictEqual(bad, [], 'raw ** shown for queries: ' + bad.join(', '));
});

check('Searching "**" finds nothing (the markers are formatting, not visible words)', async () => {
  const { page } = await open();
  await search(page, '**');
  assert.strictEqual(await resultCount(page), 0);
});

check('Search result text never contains "undefined"', async () => {
  const { page } = await open();
  for (const q of ['leave', 'the', 'Drishti', 'dashboard']) {
    await search(page, q);
    assert.ok(!(await page.innerText('.results')).includes('undefined'), 'undefined shown for ' + q);
  }
});

check('Result snippets contain the searched word', async () => {
  const { page } = await open();
  await search(page, 'Mithilesh');
  const cards = await page.evaluate(() => Array.from(document.querySelectorAll('.results .rcard')).map((c) => c.innerText.toLowerCase()));
  assert.ok(cards.length > 0);
  cards.forEach((t) => assert.ok(t.includes('mithilesh')));
});

check('Search matches in the applications list show an APPLICATION card that opens the applications page', async () => {
  const { page } = await open();
  await search(page, 'Drishti');
  const ids = await resultIds(page);
  assert.ok(ids.includes('APPLICATION'), ids.join(','));
  await page.click('.rcard:has(.rid:text("APPLICATION"))');
  assert.ok((await page.innerText('#main')).includes('Drishti'));
  assert.strictEqual(await page.locator('.appcard').count(), D.APPS.length);
});

check('A saved description edit on an application is searchable', async () => {
  const over = JSON.stringify({ drishti: { desc: 'Zyxwvut tracker for the quarterly review.' } });
  const { page } = await open({ storage: { purview_store_room_apps: over } });
  await search(page, 'Zyxwvut');
  assert.strictEqual(await resultCount(page), 1, 'edited description cannot be found');
});

/* ================= highlights ================= */
check('Highlights: searching "PL" then opening a document keeps PL-xx cross-references as links', async () => {
  const { page } = await open();
  await search(page, 'PL');
  // WF-05 mentions PL-02 / PL-04 etc: open it from the real result card
  const card = page.locator('.rcard[data-go="WF-08"]');
  assert.ok(await card.count() > 0, 'WF-08 not in PL results');
  await card.first().click();
  const links = await page.locator('#main a.xref[data-go^="PL-"]').count();
  assert.ok(links > 0, 'no PL- cross-reference is still a link (they were broken by the highlight)');
});

check('Highlights never remove a cross-reference link (WF/PL queries, every document)', async () => {
  const { page } = await open();
  const base = {};
  for (const d of D.SOPS) { await go(page, d.id); base[d.id] = await page.locator('#main a.xref').count(); }
  const broken = [];
  for (const q of ['PL', 'WF', '-0', 'L-', 'F-0', 'W']) {
    await search(page, q.length < 2 ? q + q : q);
    for (const d of D.SOPS) {
      if (!base[d.id]) continue;
      await go(page, d.id);
      const n = await page.locator('#main a.xref').count();
      if (n !== base[d.id]) broken.push(q + ' on ' + d.id + ': ' + n + ' links, normally ' + base[d.id]);
    }
  }
  assert.deepStrictEqual(broken.slice(0, 5), [], broken.length + ' broken: ' + broken.slice(0, 3).join(' | '));
});

check('Highlights: a query that matches a cross-reference id exactly ("PL-02") still leaves it clickable', async () => {
  const { page } = await open();
  await search(page, 'PL-02');
  await go(page, 'WF-08');
  const n = await page.locator('#main a.xref[data-go="PL-02"]').count();
  assert.ok(n > 0, 'PL-02 link lost on WF-08');
  await page.locator('#main a.xref[data-go="PL-02"]').first().click();
  assert.ok((await page.innerText('#main')).includes('Leave Policy'));
});

check('Highlights: opened document highlights the searched word with <mark>', async () => {
  const { page } = await open();
  await search(page, 'Mithilesh');
  await page.locator('.rcard').first().click();
  assert.ok(await page.locator('#main mark').count() > 0);
});

check('Highlights: marks only wrap the searched text (case-insensitive)', async () => {
  const { page } = await open();
  await search(page, 'sUpErViSoR');
  await go(page, 'PL-02');
  const texts = await page.evaluate(() => Array.from(document.querySelectorAll('#main mark')).map((m) => m.textContent.toLowerCase()));
  assert.ok(texts.length > 0);
  texts.forEach((t) => assert.strictEqual(t, 'supervisor'));
});

check('Highlights: bold text stays bold when a highlight is active', async () => {
  const { page } = await open();
  const base = await (async () => { await go(page, 'PL-02'); return page.locator('#main b').count(); })();
  await search(page, 'leave');
  await go(page, 'PL-02');
  assert.strictEqual(await page.locator('#main b').count(), base, 'bold markers changed while highlighting');
  assert.ok(!(await page.innerText('#main')).includes('**'));
});

check('Highlights: searching a word that sits next to ** markers leaves no raw ** on the document', async () => {
  const { page } = await open();
  for (const q of ['45 days', 'written warning', 'cannot be', 'one of the four']) {
    await search(page, q);
    for (const id of ['PL-02', 'WF-05', 'PL-03']) {
      await go(page, id);
      assert.ok(!(await page.innerText('#main')).includes('**'), '** visible on ' + id + ' after searching "' + q + '"');
    }
  }
});

check('Highlights: no page errors while opening every document with a search active', async () => {
  const { page, errors } = await open();
  await search(page, 'the');
  for (const d of D.SOPS) await go(page, d.id);
  assert.deepStrictEqual(errors, []);
});

/* ================= numbers ================= */
const nDocs = D.SOPS.length, nWf = D.SOPS.filter((d) => d.cat === 'workflow').length, nPl = D.SOPS.filter((d) => d.cat === 'policy').length, nApps = D.APPS.length;

check('Data sanity: the counts used by the other checks add up (workflows + policies = all documents)', async () => {
  assert.strictEqual(nWf + nPl, nDocs);
  assert.ok(nApps > 0);
});

check('Home banner shows the real counts (reduced motion)', async () => {
  const { page } = await open({ reducedMotion: 'reduce' });
  const nums = await page.$$eval('.hsnum', (e) => e.map((x) => x.textContent.trim()));
  assert.deepStrictEqual(nums.slice(0, 3), [String(nWf), String(nPl), String(nApps)]);
  assert.strictEqual(nums[3], 'v' + D.STORE_VERSION);
});

check('Home banner counts end on the real numbers after the count-up animation', async () => {
  const { page } = await open({ reducedMotion: 'no-preference' });
  await page.waitForTimeout(1500);
  const nums = await page.$$eval('.hsnum', (e) => e.map((x) => x.textContent.trim()));
  assert.deepStrictEqual(nums.slice(0, 3), [String(nWf), String(nPl), String(nApps)]);
});

check('Home banner labels say Workflows, Policies, Applications and the updated date', async () => {
  const { page } = await open();
  const labs = await page.$$eval('.hslab', (e) => e.map((x) => x.textContent.trim()));
  assert.deepStrictEqual(labs, ['Workflows', 'Policies', 'Applications', 'Updated ' + D.STORE_UPDATED]);
});

check('Doors on the home page show the real counts', async () => {
  const { page } = await open();
  const doors = await page.$$eval('.doorwrap', (e) => e.map((x) => [x.getAttribute('data-door'), x.querySelector('.doorcount').textContent.trim()]));
  const m = Object.fromEntries(doors);
  assert.strictEqual(m.policy, nPl + ' documents');
  assert.strictEqual(m.workflow, nWf + ' documents');
  assert.strictEqual(m.apps, nApps + ' tools');
});

check('Footer stamp states the real document and application counts, version and date', async () => {
  const { page } = await open();
  const t = await page.innerText('.stamp');
  assert.ok(t.includes(nDocs + ' controlled documents'), t);
  assert.ok(t.includes(nApps + ' applications'), t);
  assert.ok(t.includes('v' + D.STORE_VERSION), t);
  assert.ok(t.includes(D.STORE_UPDATED), t);
});

check('Side navigation lists every document once and the applications entry', async () => {
  const { page } = await open();
  const ids = await page.$$eval('#nav .navitem .nchip', (e) => e.map((x) => x.textContent.trim()));
  const docIds = ids.filter((x) => /^(WF|PL)-\d\d$/.test(x));
  assert.deepStrictEqual(docIds.sort(), D.SOPS.map((d) => d.id).sort());
  assert.strictEqual(await page.locator('#nav [data-go="cat:apps"]').count(), 1);
  assert.strictEqual(await page.locator('#nav [data-go="home"]').count(), 1);
});

check('Side navigation groups: workflows under Workflows, policies under Policies', async () => {
  const { page } = await open();
  const g = await page.evaluate(() => {
    const out = {}; let cur = null;
    Array.from(document.querySelectorAll('#nav > *')).forEach((el) => {
      if (el.classList.contains('navhead')) { cur = el.textContent.trim(); out[cur] = []; }
      else if (cur) { const c = el.querySelector('.nchip'); if (c) out[cur].push(c.textContent.trim()); }
    });
    return out;
  });
  assert.strictEqual(g.Workflows.length, nWf);
  assert.strictEqual(g.Policies.length, nPl);
  g.Workflows.forEach((x) => assert.ok(x.startsWith('WF-')));
  g.Policies.forEach((x) => assert.ok(x.startsWith('PL-')));
});

for (const cat of ['policy', 'workflow', 'apps']) {
  check('Category page "' + cat + '": cover count, cards and big-card numbers agree', async () => {
    const { page } = await open();
    await go(page, 'cat:' + cat);
    const n = cat === 'apps' ? nApps : D.SOPS.filter((d) => d.cat === cat).length;
    const cover = await page.innerText('.cover');
    assert.ok(new RegExp((cat === 'apps' ? 'Tools' : 'Documents') + '\\s+' + n + '\\b').test(cover.replace(/\n/g, ' ')), 'cover says: ' + cover.replace(/\n/g, ' | '));
    const cards = await page.locator(cat === 'apps' ? '.appcard' : '.catsec .homecard').count();
    assert.strictEqual(cards, n, 'cards shown');
    const ghost = (await page.innerText('.cvghost')).trim();
    assert.strictEqual(ghost, (n < 10 ? '0' : '') + n);
    if (cat !== 'apps') assert.strictEqual(await page.locator('.psdoc').count(), n, 'print stack documents');
  });
}

check('Big category cards (if shown anywhere) show the real counts', async () => {
  const { page } = await open();
  const html = await page.evaluate(() => ['policy', 'workflow', 'apps'].map((c) => bigCatCard(c)));
  const txt = html.map((h) => h.replace(/<[^>]+>/g, ' '));
  assert.ok(txt[0].includes(nPl + ' documents'), txt[0]);
  assert.ok(txt[1].includes(nWf + ' documents'), txt[1]);
  assert.ok(txt[2].includes(nApps + ' applications'), txt[2]);
});

check('Category cover shows the store version and updated date', async () => {
  const { page } = await open();
  await go(page, 'cat:policy');
  const c = (await page.innerText('.cover')).replace(/\n/g, ' ');
  assert.ok(c.includes('v' + D.STORE_VERSION) && c.includes(D.STORE_UPDATED), c);
});

check('Every situation on the home page is shown (none silently dropped)', async () => {
  const { page } = await open();
  assert.strictEqual(await page.locator('.sitrow').count(), D.SITUATIONS.length);
});

check('Every situation link opens the document it names', async () => {
  const { page } = await open();
  const bad = [];
  for (let i = 0; i < D.SITUATIONS.length; i++) {
    await go(page, 'home');
    await page.locator('.sitrow').nth(i).click();
    const crumb = await page.innerText('.crumb');
    if (!crumb.includes(D.SITUATIONS[i].to)) bad.push(D.SITUATIONS[i].q + ' -> ' + D.SITUATIONS[i].to + ' (opened ' + crumb + ')');
  }
  assert.deepStrictEqual(bad, []);
});

check('Every document cover: "Stages" equals the number of non-reference sections', async () => {
  const { page } = await open();
  const bad = [];
  for (const d of D.SOPS) {
    await go(page, d.id);
    const meta = await page.$$eval('.cvmeta', (e) => e.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
    const st = meta.find((m) => m.startsWith('Stages'));
    if (st !== 'Stages ' + nonRef(d).length) bad.push(d.id + ': "' + st + '" expected ' + nonRef(d).length);
  }
  assert.deepStrictEqual(bad, []);
});

check('Every document: stage tags run "Stage 1 of N" to "Stage N of N" and reference sections say Reference', async () => {
  const { page } = await open();
  const bad = [];
  for (const d of D.SOPS) {
    await go(page, d.id);
    const tags = await page.$$eval('.stagetag', (e) => e.map((x) => x.textContent.trim()));
    const t = nonRef(d).length;
    const exp = d.sections.map((s, i) => s.ref ? 'Reference' : 'Stage ' + (d.sections.slice(0, i).filter((x) => !x.ref).length + 1) + ' of ' + t);
    if (JSON.stringify(tags) !== JSON.stringify(exp)) bad.push(d.id + ': ' + tags.join('/') + ' expected ' + exp.join('/'));
  }
  assert.deepStrictEqual(bad, []);
});

check('Every document: the stage rail and the stage strip list every section', async () => {
  const { page } = await open();
  const bad = [];
  for (const d of D.SOPS) {
    await go(page, d.id);
    const rail = await page.locator('.stagerail .srlink').count();
    const strip = await page.locator('.fstep').count();
    if (rail !== d.sections.length || strip !== d.sections.length) bad.push(d.id + ': rail ' + rail + ', strip ' + strip + ', sections ' + d.sections.length);
  }
  assert.deepStrictEqual(bad, []);
});

check('Step numbers restart at 1 in each stage and count up by one', async () => {
  const { page } = await open();
  const bad = [];
  for (const d of D.SOPS) {
    await go(page, d.id);
    const lists = await page.$$eval('ol.steps', (ols) => ols.map((ol) => Array.from(ol.children).map((li) => li.querySelector('.snum').textContent.trim())));
    const exp = d.sections.filter((s) => s.steps).map((s) => s.steps.map((_, i) => String(i + 1)));
    if (JSON.stringify(lists) !== JSON.stringify(exp)) bad.push(d.id);
  }
  assert.deepStrictEqual(bad, []);
});

check('Read minutes on every document are whole numbers of at least 1 and not absurd', async () => {
  const { page } = await open();
  const bad = [];
  for (const d of D.SOPS) {
    await go(page, d.id);
    const meta = await page.$$eval('.cvmeta', (e) => e.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
    const r = meta.find((m) => m.startsWith('Read'));
    const m = /^Read (\d+) min$/.exec(r || '');
    if (!m || +m[1] < 1 || +m[1] > 40) bad.push(d.id + ': ' + r);
  }
  assert.deepStrictEqual(bad, []);
});

check('Read minutes roughly match the amount of text actually on the page (words / 210, within 25%)', async () => {
  const { page } = await open();
  const bad = [];
  for (const d of D.SOPS) {
    await go(page, d.id);
    const info = await page.evaluate(() => {
      const meta = Array.from(document.querySelectorAll('.cvmeta')).map((x) => x.textContent.replace(/\s+/g, ' ').trim()).find((m) => m.startsWith('Read'));
      const sel = '.sec, .purpose';
      let words = 0;
      document.querySelectorAll(sel).forEach((el) => {
        words += el.innerText.replace(/Stage \d+ of \d+|Reference/g, ' ').split(/\s+/).filter(Boolean).length;
      });
      return { meta, words };
    });
    const shown = +/(\d+)/.exec(info.meta)[1];
    const exp = info.words / 210;
    if (shown < exp * 0.75 - 0.5 || shown > exp * 1.25 + 0.5) bad.push(d.id + ': shows ' + shown + ' min, page has ' + info.words + ' words (about ' + exp.toFixed(1) + ')');
  }
  assert.deepStrictEqual(bad.slice(0, 8), [], bad.length + ' documents off: ' + bad.slice(0, 4).join(' | '));
});

check('Document control box on every document matches the data (version, dates, owner, applies to)', async () => {
  const { page } = await open();
  const bad = [];
  for (const d of D.SOPS) {
    await go(page, d.id);
    const v = await page.$$eval('.dcgrid > div', (e) => e.map((x) => [x.querySelector('.k').textContent.trim(), x.querySelector('.v').textContent.trim()]));
    const m = Object.fromEntries(v);
    const exp = { 'Doc No.': d.id, Version: d.version, Effective: d.effective, 'Review due': d.review, 'Process owner': d.owner, 'Applies to': d.applies };
    for (const k of Object.keys(exp)) if (m[k] !== exp[k]) bad.push(d.id + ' ' + k + ': "' + m[k] + '" vs "' + exp[k] + '"');
  }
  assert.deepStrictEqual(bad, []);
});

check('Document cards on category pages show the right version, effective date and owner', async () => {
  const { page } = await open();
  const bad = [];
  for (const cat of ['policy', 'workflow']) {
    await go(page, 'cat:' + cat);
    const cards = await page.$$eval('.catsec .homecard', (e) => e.map((x) => [x.querySelector('.hcid').textContent.trim(), x.querySelector('.hcmeta').textContent.trim()]));
    cards.forEach(([id, meta]) => {
      const d = D.SOPS.find((x) => x.id === id);
      if (meta !== 'v' + d.version + ' · effective ' + d.effective + ' · owner: ' + d.owner) bad.push(id + ': ' + meta);
    });
  }
  assert.deepStrictEqual(bad, []);
});

/* ================= data integrity ================= */
check('Document ids are unique and use the WF-nn / PL-nn pattern matching their category', async () => {
  const ids = D.SOPS.map((d) => d.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'duplicate ids');
  D.SOPS.forEach((d) => {
    assert.match(d.id, /^(WF|PL)-\d\d$/);
    assert.strictEqual(d.id.startsWith('WF') ? 'workflow' : 'policy', d.cat, d.id + ' is in the wrong category');
  });
});

check('Document ids run without gaps (WF-01.. and PL-01..)', async () => {
  for (const [p, n] of [['WF', nWf], ['PL', nPl]]) {
    const exp = Array.from({ length: n }, (_, i) => p + '-' + String(i + 1).padStart(2, '0'));
    assert.deepStrictEqual(D.SOPS.filter((d) => d.id.startsWith(p)).map((d) => d.id), exp);
  }
});

check('Application keys and names are unique, and each application has name, tag, status, audience and description', async () => {
  assert.strictEqual(new Set(D.APPS.map((a) => a.key)).size, nApps);
  assert.strictEqual(new Set(D.APPS.map((a) => a.name)).size, nApps);
  D.APPS.forEach((a) => {
    ['name', 'tag', 'status', 'audience', 'desc'].forEach((k) => assert.ok(a[k] && String(a[k]).trim(), a.key + ' missing ' + k));
    assert.ok(['live', 'building', 'soon', 'planned', 'beta'].includes(a.status) || typeof a.status === 'string');
  });
});

check('Every situation points to an existing document and has a question', async () => {
  const ids = new Set(D.SOPS.map((d) => d.id));
  const bad = D.SITUATIONS.filter((x) => !x.q || !x.q.trim() || !ids.has(x.to)).map((x) => JSON.stringify(x));
  assert.deepStrictEqual(bad, []);
});

check('Situation questions are unique', async () => {
  const qs = D.SITUATIONS.map((x) => x.q.trim().toLowerCase());
  const dup = qs.filter((q, i) => qs.indexOf(q) !== i);
  assert.deepStrictEqual(dup, []);
});

check('Every WF-xx / PL-xx mentioned anywhere in the text exists', async () => {
  const ids = new Set(D.SOPS.map((d) => d.id));
  const bad = [];
  allStrings().forEach(({ path, s }) => { (s.match(/\b(WF|PL)-\d+\b/g) || []).forEach((m) => { if (!ids.has(m)) bad.push(path + ' mentions ' + m); }); });
  assert.deepStrictEqual(bad, []);
});

check('No document refers to a "WF"/"PL" number in a way the page cannot turn into a link (every mention is two digits)', async () => {
  const bad = [];
  allStrings().forEach(({ path, s }) => { (s.match(/\b(WF|PL)-\d{1}\b|\b(WF|PL)-\d{3,}\b/g) || []).forEach((m) => bad.push(path + ' ' + m)); });
  assert.deepStrictEqual(bad, []);
});

check('Every document has version, effective, review, owner, applies and purpose filled in', async () => {
  const bad = [];
  D.SOPS.forEach((d) => ['title', 'short', 'version', 'effective', 'review', 'owner', 'applies', 'purpose'].forEach((k) => { if (!d[k] || !String(d[k]).trim()) bad.push(d.id + ' missing ' + k); }));
  assert.deepStrictEqual(bad, []);
});

check('Document versions look like "1.2" and the store version like "7.0"', async () => {
  D.SOPS.forEach((d) => assert.match(d.version, /^\d+\.\d+$/, d.id));
  assert.match(D.STORE_VERSION, /^\d+\.\d+$/);
});

check('Effective and review dates are real dates in "DD Mon YYYY" format', async () => {
  const bad = [];
  D.SOPS.forEach((d) => ['effective', 'review'].forEach((k) => { if (!parseDate(d[k])) bad.push(d.id + ' ' + k + ' = "' + d[k] + '"'); }));
  if (!parseDate(D.STORE_UPDATED)) bad.push('STORE_UPDATED = "' + D.STORE_UPDATED + '"');
  assert.deepStrictEqual(bad, []);
});

check('Review date is six months after the effective date on every document', async () => {
  const bad = [];
  D.SOPS.forEach((d) => {
    const e = parseDate(d.effective), r = parseDate(d.review);
    if (!e || !r) return;
    let m = e.m + 6, y = e.y; if (m > 11) { m -= 12; y += 1; }
    if (!(r.y === y && r.m === m && r.d === e.d)) bad.push(d.id + ': effective ' + d.effective + ', review ' + d.review);
  });
  assert.deepStrictEqual(bad, [], 'documents where review is not +6 months: ' + bad.join(' | '));
});

check('Review date is after the effective date', async () => {
  const bad = D.SOPS.filter((d) => parseDate(d.effective) && parseDate(d.review) && parseDate(d.review).t <= parseDate(d.effective).t).map((d) => d.id);
  assert.deepStrictEqual(bad, []);
});

check('The store "updated" date is not older than any document\'s effective date', async () => {
  const u = parseDate(D.STORE_UPDATED);
  assert.ok(u, 'bad updated date');
  const bad = D.SOPS.filter((d) => parseDate(d.effective) && parseDate(d.effective).t > u.t).map((d) => d.id + ' effective ' + d.effective);
  assert.deepStrictEqual(bad, [], 'store says updated ' + D.STORE_UPDATED + ' but: ' + bad.join(', '));
});

check('No "**" is left unbalanced in any text', async () => {
  const bad = [];
  allStrings().forEach(({ path, s }) => { const n = (s.match(/\*\*/g) || []).length; if (n % 2) bad.push(path + ': ' + s.slice(0, 60)); });
  assert.deepStrictEqual(bad, []);
});

check('No stray single "*" or empty "****" bold markers in any text', async () => {
  const bad = [];
  allStrings().forEach(({ path, s }) => { if (/\*\*\*\*/.test(s) || /(^|[^*])\*([^*]|$)/.test(s)) bad.push(path + ': ' + s.slice(0, 60)); });
  assert.deepStrictEqual(bad, []);
});

check('Bold text pairs on the page: no "**" is visible on any document, category page or home page', async () => {
  const { page } = await open();
  const bad = [];
  for (const t of ['home', 'cat:policy', 'cat:workflow', 'cat:apps', ...D.SOPS.map((d) => d.id)]) {
    await go(page, t);
    if ((await page.innerText('#main')).includes('**')) bad.push(t);
  }
  assert.deepStrictEqual(bad, []);
});

check('Every section of every document has a known type and the data it needs', async () => {
  const bad = [];
  D.SOPS.forEach((d) => {
    assert.ok(d.sections.length > 0, d.id + ' has no sections');
    d.sections.forEach((s, i) => {
      const w = d.id + ' section ' + (i + 1);
      if (!s.name) bad.push(w + ' has no name');
      if (s.type === 'steps' && !(s.steps && s.steps.length)) bad.push(w + ' has no steps');
      else if (s.type === 'table' && !(s.cols && s.rows && s.rows.every((r) => r.length === s.cols.length))) bad.push(w + ' table rows do not match columns');
      else if (s.type === 'dodont' && !(s.dos && s.donts)) bad.push(w + ' missing do/donts');
      else if (s.type === 'template' && !s.body) bad.push(w + ' empty template');
      else if (!['steps', 'table', 'dodont', 'template'].includes(s.type)) bad.push(w + ' unknown type ' + s.type);
    });
  });
  assert.deepStrictEqual(bad, []);
});

check('Tables inside steps have rows that match their column count', async () => {
  const bad = [];
  D.SOPS.forEach((d) => d.sections.forEach((s, i) => (s.steps || []).forEach((st, j) => (st.tables || []).forEach((tb, k) => {
    if (!tb.rows.every((r) => r.length === tb.cols.length)) bad.push(d.id + ' s' + (i + 1) + ' step ' + (j + 1) + ' table ' + (k + 1));
  }))));
  assert.deepStrictEqual(bad, []);
});

check('Whole app opens and searches with no console errors', async () => {
  const { page, errors } = await open();
  for (const q of ['leave', 'zz', 'PL-0', '&amp;', 'a b']) await search(page, q);
  await search(page, '');
  assert.deepStrictEqual(errors, []);
});
