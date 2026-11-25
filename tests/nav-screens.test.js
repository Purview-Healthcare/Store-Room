/* Navigation, screens, keyboard, print and speed checks (plan rows 1, 6, 8, 7-print, 10). */
const { check, data, open, go, assert } = require('./lib');

const D = data();
const SOPS = D.SOPS;
const CATS = ['policy', 'workflow'];
const docsIn = (cat) => SOPS.filter((s) => s.cat === cat);
const strip = (s) => String(s == null ? '' : s).replace(/\*\*/g, '');
const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toLowerCase();
const view = (page) => page.evaluate(() => ({ view: state.view, id: state.id }));
const sleep = (page, ms) => page.waitForTimeout(ms);
/* wait until smooth scrolling has stopped */
async function settle(page) {
  let last = -1;
  for (let i = 0; i < 30; i++) {
    const y = await page.evaluate(() => scrollY);
    if (y === last) return;
    last = y;
    await page.waitForTimeout(120);
  }
}
/* true only if each matching element really accepts keyboard focus (an <a> with no href does not) */
function focusable(page, sel) {
  return page.evaluate((s) => {
    const els = Array.from(document.querySelectorAll(s));
    if (!els.length) return { n: 0, bad: 0 };
    let bad = 0;
    els.forEach((e) => { e.focus(); if (document.activeElement !== e) bad++; });
    return { n: els.length, bad };
  }, sel);
}

/* every piece of text a document holds, grouped by kind */
function parts(doc) {
  const out = { steps: [], sectionTables: [], stepTables: [], lists: [], notes: [], dodont: [], when: [], tableNotes: [] };
  const tbl = (tb, into) => {
    (tb.cols || []).forEach((c) => into.push(strip(c)));
    (tb.rows || []).forEach((r) => r.forEach((c) => into.push(strip(c))));
    if (tb.note) into.push(strip(tb.note));
  };
  doc.sections.forEach((sec) => {
    if (sec.type === 'table') tbl(sec, out.sectionTables);
    (sec.tables || []).forEach((tb) => tbl(tb, out.sectionTables));
    (sec.steps || []).forEach((st) => {
      out.steps.push(strip(st.t), strip(st.d));
      (st.list || []).forEach((x) => out.lists.push(strip(x)));
      (st.tables || []).forEach((tb) => tbl(tb, out.stepTables));
      if (st.note) out.notes.push(strip(st.note.x));
      if (st.when) out.when.push(strip(st.when));
    });
    (sec.dos || []).forEach((x) => out.dodont.push(strip(x)));
    (sec.donts || []).forEach((x) => out.dodont.push(strip(x)));
  });
  return out;
}
async function printText(page, selector) {
  await page.emulateMedia({ media: 'print' });
  const t = await page.evaluate((s) => document.querySelector(s).innerText, selector);
  return norm(t);
}
function missing(text, list) {
  return list.filter((x) => x && !text.includes(norm(x)));
}

/* ---------------- 1. start up and speed ---------------- */
check('The page opens with no errors on all four screen sizes', async () => {
  for (const [w, h] of [[390, 844], [820, 1180], [1366, 900], [1800, 1000]]) {
    const { page, errors, context } = await open({ width: w, height: h });
    assert.ok(await page.locator('.herotitle').isVisible(), 'hero missing at ' + w);
    assert.deepStrictEqual(errors, [], 'errors at ' + w);
    await context.close();
  }
});

check('First screen is drawn quickly (under 3 seconds from navigation)', async () => {
  const { page, context } = await open();
  const nav = await page.evaluate(() => {
    const t = performance.getEntriesByType('navigation')[0];
    const fcp = (performance.getEntriesByName('first-contentful-paint')[0] || {}).startTime;
    return { dcl: t.domContentLoadedEventEnd, load: t.loadEventEnd, fcp };
  });
  console.log('        [info] DOMContentLoaded ' + Math.round(nav.dcl) + ' ms, load ' + Math.round(nav.load) + ' ms, first paint ' + Math.round(nav.fcp || -1) + ' ms');
  assert.ok(nav.dcl < 3000, 'DOMContentLoaded took ' + nav.dcl + ' ms');
  assert.ok(!nav.fcp || nav.fcp < 3000, 'first paint took ' + nav.fcp + ' ms');
  await context.close();
});

check('Typing in the search box answers in under one second per key press', async () => {
  const { page, errors, context } = await open();
  const times = [];
  const word = 'warning';
  await page.focus('#q');
  for (const ch of word) {
    const t0 = Date.now();
    await page.keyboard.press(ch);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
    times.push(Date.now() - t0);
  }
  console.log('        [info] ms per key press: ' + times.join(', '));
  assert.ok(Math.max(...times) < 1000, 'slowest key press ' + Math.max(...times) + ' ms');
  assert.deepStrictEqual(errors, []);
  await context.close();
});

check('Search work per key press is small (render cost under 250 ms even for a common letter pair)', async () => {
  const { page, context } = await open();
  const ms = await page.evaluate(() => {
    const out = [];
    for (const q of ['th', 'the', 'the ', 'the e', 'e', 'ee']) {
      const t0 = performance.now();
      $q.value = q;
      $q.dispatchEvent(new Event('input', { bubbles: true }));
      out.push(Math.round(performance.now() - t0));
    }
    return out;
  });
  console.log('        [info] in-page ms per input event: ' + ms.join(', '));
  assert.ok(Math.max(...ms) < 250, 'slowest ' + Math.max(...ms) + ' ms');
  await context.close();
});

/* ---------------- 2. doors, categories, cards ---------------- */
check('Clicking each door on the home page opens its category (reduced motion)', async () => {
  const { page, errors, context } = await open({ reducedMotion: 'reduce' });
  for (const cat of ['policy', 'workflow', 'apps']) {
    await go(page, 'home');
    await page.locator('.doorwrap[data-door="' + cat + '"] .doorface').click();
    await sleep(page, 150);
    assert.deepStrictEqual(await view(page), { view: 'cat', id: cat }, 'door ' + cat);
  }
  assert.deepStrictEqual(errors, []);
  await context.close();
});

check('With animation on, a door waits for its opening animation (about 1.2 s) and then opens its category', async () => {
  const { page, errors, context } = await open({ reducedMotion: 'no-preference' });
  await page.locator('.doorwrap[data-door="workflow"] .doorface').click();
  await sleep(page, 400);
  assert.strictEqual((await view(page)).view, 'home', 'should still be on home while the door opens');
  await sleep(page, 1500);
  assert.deepStrictEqual(await view(page), { view: 'cat', id: 'workflow' });
  assert.ok((await page.innerText('#main')).includes('WF-01'));
  assert.deepStrictEqual(errors, []);
  await context.close();
});

check('Double-clicking an animated door opens the category once and leaves the page working', async () => {
  const { page, errors, context } = await open({ reducedMotion: 'no-preference' });
  await page.locator('.doorwrap[data-door="policy"] .doorface').dblclick();
  await sleep(page, 2200);
  assert.deepStrictEqual(await view(page), { view: 'cat', id: 'policy' });
  assert.strictEqual(await page.locator('.homecard').count(), docsIn('policy').length);
  await page.locator('.homecard').first().click();
  assert.deepStrictEqual(await view(page), { view: 'doc', id: docsIn('policy')[0].id });
  assert.deepStrictEqual(errors, []);
  await context.close();
});

check('Double-clicking a door with reduced motion ends on the category page with no error', async () => {
  const { page, errors, context } = await open({ reducedMotion: 'reduce' });
  await page.locator('.doorwrap[data-door="apps"] .doorface').dblclick();
  await sleep(page, 200);
  assert.deepStrictEqual(await view(page), { view: 'cat', id: 'apps' });
  assert.deepStrictEqual(errors, []);
  await context.close();
});

check('After an animated door opens and you go home, the door can be opened again', async () => {
  const { page, context } = await open({ reducedMotion: 'no-preference' });
  await page.locator('.doorwrap[data-door="apps"] .doorface').click();
  await sleep(page, 1900);
  await page.locator('.crumb a').first().click();
  assert.strictEqual((await view(page)).view, 'home');
  await page.locator('.doorwrap[data-door="apps"] .doorface').click();
  await sleep(page, 1900);
  assert.deepStrictEqual(await view(page), { view: 'cat', id: 'apps' });
  await context.close();
});

check('A door can be reached with Tab and opened with Enter', async () => {
  const { page, context } = await open({ reducedMotion: 'reduce' });
  await page.locator('.doorwrap[data-door="policy"] .doorface').focus();
  assert.ok(await page.evaluate(() => document.activeElement.classList.contains('doorface')), 'door not focusable');
  await page.keyboard.press('Enter');
  await sleep(page, 200);
  assert.deepStrictEqual(await view(page), { view: 'cat', id: 'policy' }, 'Enter on a focused door did nothing');
  await context.close();
});

check('Tab from the top of the page reaches all three doors in order', async () => {
  const { page, context } = await open();
  const seen = [];
  for (let i = 0; i < 25 && seen.length < 3; i++) {
    await page.keyboard.press('Tab');
    const d = await page.evaluate(() => {
      const e = document.activeElement;
      return e && e.classList.contains('doorface') ? e.closest('.doorwrap').getAttribute('data-door') : null;
    });
    if (d) seen.push(d);
  }
  assert.deepStrictEqual(seen.sort(), ['apps', 'policy', 'workflow']);
  await context.close();
});

check('Each category page shows one card per document and each card opens its document (mouse)', async () => {
  const { page, errors, context } = await open();
  for (const cat of CATS) {
    for (const d of docsIn(cat)) {
      await go(page, 'cat:' + cat);
      assert.strictEqual(await page.locator('.homecard').count(), docsIn(cat).length, cat + ' card count');
      await page.locator('.homecard[data-go="' + d.id + '"]').click();
      assert.deepStrictEqual(await view(page), { view: 'doc', id: d.id });
      assert.ok((await page.innerText('.cvtitle')).includes(d.title));
    }
  }
  assert.deepStrictEqual(errors, []);
  await context.close();
});

check('Document cards open with Tab then Enter', async () => {
  const { page, context } = await open();
  await go(page, 'cat:workflow');
  await page.locator('.homecard').nth(2).focus();
  await page.keyboard.press('Enter');
  assert.deepStrictEqual(await view(page), { view: 'doc', id: docsIn('workflow')[2].id });
  await context.close();
});

check('The applications page lists every application card, and each Edit button opens an editor that Cancel closes', async () => {
  const { page, errors, context } = await open();
  await go(page, 'cat:apps');
  const n = D.APPS.length;
  assert.strictEqual(await page.locator('.appcard').count(), n);
  for (let i = 0; i < n; i++) {
    await page.locator('.editbtn').nth(i).click();
    assert.strictEqual(await page.locator('.appcard.editing').count(), 1, 'editor ' + i);
    await page.locator('[data-act="cancel"]').click();
    assert.strictEqual(await page.locator('.appcard.editing').count(), 0);
  }
  assert.deepStrictEqual(errors, []);
  await context.close();
});

/* ---------------- 3. sidebar, breadcrumbs, prev/next ---------------- */
check('Every sidebar entry opens the right page and is marked as the current one', async () => {
  const { page, errors, context } = await open();
  for (const d of SOPS) {
    await page.locator('#nav [data-go="' + d.id + '"]').click();
    assert.deepStrictEqual(await view(page), { view: 'doc', id: d.id });
    assert.ok((await page.locator('#nav .navitem.active').getAttribute('data-go')) === d.id, 'active mark for ' + d.id);
  }
  await page.locator('#nav [data-go="cat:apps"]').click();
  assert.deepStrictEqual(await view(page), { view: 'cat', id: 'apps' });
  await page.locator('#nav [data-go="home"]').click();
  assert.strictEqual((await view(page)).view, 'home');
  assert.deepStrictEqual(errors, []);
  await context.close();
});

check('Breadcrumbs on a document go to the category and to home', async () => {
  const { page, context } = await open();
  for (const d of [SOPS[0], SOPS[SOPS.length - 1]]) {
    await go(page, d.id);
    await page.locator('.crumb a[data-go="cat:' + d.cat + '"]').click();
    assert.deepStrictEqual(await view(page), { view: 'cat', id: d.cat });
    await go(page, d.id);
    await page.locator('.crumb a[data-go="home"]').click();
    assert.strictEqual((await view(page)).view, 'home');
  }
  await go(page, 'cat:policy');
  await page.locator('.crumb a').click();
  assert.strictEqual((await view(page)).view, 'home', 'Back to Store Room on a category page');
  await context.close();
});

check('Breadcrumb links can be reached with the Tab key', async () => {
  const { page, context } = await open();
  await go(page, 'WF-02');
  const r = await focusable(page, '.crumb a');
  assert.ok(r.n > 0 && r.bad === 0, r.bad + ' of ' + r.n + ' breadcrumb links cannot take keyboard focus');
  await context.close();
});

check('Previous and Next document links walk through each category in order', async () => {
  const { page, errors, context } = await open();
  for (const cat of CATS) {
    const list = docsIn(cat);
    await go(page, list[0].id);
    for (let i = 1; i < list.length; i++) {
      await page.locator('.nextprev a.np-next').click();
      assert.deepStrictEqual(await view(page), { view: 'doc', id: list[i].id }, 'next from ' + list[i - 1].id);
    }
    for (let i = list.length - 2; i >= 0; i--) {
      await page.locator('.nextprev a:not(.np-next)').first().click();
      assert.deepStrictEqual(await view(page), { view: 'doc', id: list[i].id }, 'previous from ' + list[i + 1].id);
    }
  }
  assert.deepStrictEqual(errors, []);
  await context.close();
});

check('The first document of a category has no visible Previous link and the last has no Next link', async () => {
  const { page, context } = await open();
  for (const cat of CATS) {
    const list = docsIn(cat);
    await go(page, list[0].id);
    const prevShown = await page.evaluate(() => Array.from(document.querySelectorAll('.nextprev a:not(.np-next)')).some((a) => a.offsetWidth && getComputedStyle(a).visibility !== 'hidden' && a.textContent.trim()));
    assert.ok(!prevShown, list[0].id + ' shows Previous');
    await go(page, list[list.length - 1].id);
    const nextShown = await page.evaluate(() => Array.from(document.querySelectorAll('.nextprev a.np-next')).some((a) => a.offsetWidth && getComputedStyle(a).visibility !== 'hidden'));
    assert.ok(!nextShown, list[list.length - 1].id + ' shows Next');
  }
  await context.close();
});

check('Previous and Next links and sidebar links can be used from the keyboard', async () => {
  const { page, context } = await open();
  await go(page, 'WF-02');
  const nav = await focusable(page, '#nav .navitem');
  assert.ok(nav.bad === 0, nav.bad + ' of ' + nav.n + ' sidebar entries cannot take keyboard focus');
  const np = await focusable(page, '.nextprev a.np-next, .nextprev a:not([style])');
  assert.ok(np.bad === 0, np.bad + ' of ' + np.n + ' previous/next links cannot take keyboard focus');
  await context.close();
});

/* ---------------- 4. situations and cross references ---------------- */
check('"What do I do when" shows one shortcut per situation, and each lands on its document', async () => {
  const { page, errors, context } = await open();
  await go(page, 'home');
  assert.strictEqual(await page.locator('.sitrow').count(), D.SITUATIONS.length, 'shortcut count');
  for (let i = 0; i < D.SITUATIONS.length; i++) {
    await go(page, 'home');
    await page.locator('.sitrow').nth(i).click();
    const v = await view(page);
    assert.deepStrictEqual(v, { view: 'doc', id: D.SITUATIONS[i].to }, 'shortcut "' + D.SITUATIONS[i].q + '"');
    assert.ok((await page.innerText('.cvtitle')).length > 3);
  }
  assert.deepStrictEqual(errors, []);
  await context.close();
});

check('Shortcuts in "What do I do when" can be reached and opened with the keyboard', async () => {
  const { page, context } = await open();
  await page.locator('.sitrow').first().focus();
  const focused = await page.evaluate(() => document.activeElement.classList.contains('sitrow'));
  assert.ok(focused, 'shortcut rows cannot take keyboard focus');
  await page.keyboard.press('Enter');
  assert.deepStrictEqual(await view(page), { view: 'doc', id: D.SITUATIONS[0].to });
  await context.close();
});

check('Every cross-reference link (PL-xx / WF-xx) in every document opens that document', async () => {
  const { page, errors, context } = await open();
  const bad = [];
  let clicks = 0;
  for (const d of SOPS) {
    await go(page, d.id);
    const texts = await page.evaluate(() => Array.from(new Set(Array.from(document.querySelectorAll('#main a.xref')).map((a) => a.textContent.trim()))));
    for (const t of texts) {
      await go(page, d.id);
      await page.locator('#main a.xref', { hasText: t }).first().click();
      clicks++;
      const v = await view(page);
      if (v.id !== t || v.view !== 'doc') bad.push(d.id + ' -> ' + t + ' landed on ' + JSON.stringify(v));
    }
  }
  console.log('        [info] cross-reference links clicked: ' + clicks);
  assert.ok(clicks > 20, 'expected many cross references, saw ' + clicks);
  assert.ok(bad.length === 0, bad.join(' ;; '));
  assert.deepStrictEqual(errors, []);
  await context.close();
});

check('Every document id mentioned in running text of a document is a working link', async () => {
  const { page, context } = await open();
  const unlinked = [];
  for (const d of SOPS) {
    await go(page, d.id);
    const r = await page.evaluate((self) => {
      const ids = new Set(SOPS.map((s) => s.id));
      const walker = document.createTreeWalker(document.querySelector('#main .doc'), NodeFilter.SHOW_TEXT);
      const out = [];
      let n;
      while ((n = walker.nextNode())) {
        if (n.parentElement.closest('a, .cvghost, .cvchip, .crumb, .nextprev, .stagerail, .docctrl, .dcgrid, .cvtitle, .cvshort')) continue;
        (n.textContent.match(/\b(WF|PL)-\d\d\b/g) || []).forEach((m) => { if (ids.has(m) && m !== self) out.push(m); });
      }
      return out;
    }, d.id);
    if (r.length) unlinked.push(d.id + ': ' + Array.from(new Set(r)).join(','));
  }
  assert.ok(unlinked.length === 0, 'ids in text that are not links: ' + unlinked.join(' ;; '));
  await context.close();
});

check('Cross-reference links can take keyboard focus', async () => {
  const { page, context } = await open();
  let found = null;
  for (const d of SOPS) {
    await go(page, d.id);
    if (await page.locator('#main a.xref').count()) { found = d.id; break; }
  }
  assert.ok(found, 'no cross references at all');
  const r = await focusable(page, '#main a.xref');
  assert.ok(r.n > 0 && r.bad === 0, r.bad + ' of ' + r.n + ' cross-reference links cannot take keyboard focus');
  await context.close();
});

/* ---------------- 5. stage strip, rail, next stage ---------------- */
check('Every stage-strip step and side-rail jump target exists in each document and the numbers agree', async () => {
  const { page, context } = await open({ width: 1800, height: 1000 });
  for (const d of SOPS) {
    await go(page, d.id);
    const r = await page.evaluate(() => {
      const t = (sel) => Array.from(document.querySelectorAll(sel)).map((e) => e.getAttribute('data-jump'));
      const miss = (arr) => arr.filter((id) => !document.getElementById(id));
      return { strip: t('.fstep'), rail: t('.srlink'), next: t('.nextstage[data-jump]'), missing: miss(t('.fstep').concat(t('.srlink'), t('.nextstage[data-jump]'))) };
    });
    assert.strictEqual(r.strip.length, d.sections.length, d.id + ' strip count');
    assert.strictEqual(r.rail.length, d.sections.length, d.id + ' rail count');
    assert.strictEqual(r.next.length, d.sections.length - 1, d.id + ' next-stage count');
    assert.deepStrictEqual(r.missing, [], d.id + ' broken targets');
  }
  await context.close();
});

check('Clicking each step in the stage strip scrolls to that stage (WF-04 and PL-08)', async () => {
  const { page, errors, context } = await open();
  for (const id of ['WF-04', 'PL-08']) {
    await go(page, id);
    const n = await page.locator('.fstep').count();
    for (let i = 1; i < n; i++) {
      const target = await page.locator('.fstep').nth(i).getAttribute('data-jump');
      await page.locator('.fstep').nth(i).scrollIntoViewIfNeeded();
      await page.locator('.fstep').nth(i).click();
      await sleep(page, 150);
      await settle(page);
      const top = await page.evaluate((t) => document.getElementById(t).getBoundingClientRect().top, target);
      const maxScroll = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight - scrollY);
      assert.ok(top < 200 || maxScroll < 5, id + ' step ' + (i + 1) + ' anchor at ' + Math.round(top) + 'px');
      assert.ok(top >= -5 || maxScroll < 5, id + ' step ' + (i + 1) + ' overshot to ' + Math.round(top));
    }
  }
  assert.deepStrictEqual(errors, []);
  await context.close();
});

check('Side-rail links scroll to their stage and mark it as current (wide screen)', async () => {
  const { page, errors, context } = await open({ width: 1800, height: 1000 });
  await go(page, 'WF-04');
  assert.ok(await page.locator('.stagerail').isVisible(), 'rail not shown at 1800px');
  for (const i of [2, 4, 6]) {
    await page.locator('.srlink').nth(i).click();
    await sleep(page, 150);
    await settle(page);
    const cur = await page.evaluate(() => Array.from(document.querySelectorAll('.srlink')).findIndex((l) => l.classList.contains('cur')));
    assert.strictEqual(cur, i, 'current rail item after clicking ' + (i + 1));
    const top = await page.evaluate((id) => document.getElementById(id).getBoundingClientRect().top, 'WF-04-s' + (i + 1));
    assert.ok(top < 200 && top > -10, 'section ' + (i + 1) + ' at ' + Math.round(top));
  }
  assert.deepStrictEqual(errors, []);
  await context.close();
});

check('The side rail is hidden on laptop, tablet and phone widths', async () => {
  for (const w of [390, 820, 1366]) {
    const { page, context } = await open({ width: w, height: 900 });
    await go(page, 'WF-04');
    assert.ok(!(await page.locator('.stagerail').isVisible()), 'rail visible at ' + w);
    await context.close();
  }
});

check('The "Next" link under a stage scrolls to the following stage; the last one says End and does nothing', async () => {
  const { page, errors, context } = await open();
  await go(page, 'WF-01');
  const nexts = page.locator('.nextstage[data-jump]');
  await nexts.first().scrollIntoViewIfNeeded();
  const target = await nexts.first().getAttribute('data-jump');
  await nexts.first().click();
  await sleep(page, 150);
  await settle(page);
  const top = await page.evaluate((t) => document.getElementById(t).getBoundingClientRect().top, target);
  assert.ok(top < 200 && top > -10, 'next stage anchor at ' + Math.round(top));
  const done = page.locator('.nextstage.done');
  assert.strictEqual(await done.count(), 1);
  assert.ok((await done.innerText()).includes('WF-01'));
  await done.click();
  assert.deepStrictEqual(await view(page), { view: 'doc', id: 'WF-01' });
  assert.deepStrictEqual(errors, []);
  await context.close();
});

check('Stage strip and "Next" stage links can be used from the keyboard', async () => {
  const { page, context } = await open();
  await go(page, 'WF-01');
  const r = await focusable(page, '.fstep, .nextstage[data-jump]');
  assert.ok(r.n > 0 && r.bad === 0, r.bad + ' of ' + r.n + ' stage strip / next-stage controls cannot take keyboard focus');
  await context.close();
});

/* ---------------- 6. back/forth, double clicks ---------------- */
check('Going back and forth quickly ends on the last page asked for, with no errors', async () => {
  const { page, errors, context } = await open();
  const seq = ['PL-01', 'WF-03', 'home', 'cat:apps', 'WF-09', 'PL-08', 'cat:policy', 'WF-01', 'PL-05', 'home', 'WF-04'];
  for (const t of seq) {
    await page.evaluate((x) => go(x), t);
  }
  assert.deepStrictEqual(await view(page), { view: 'doc', id: 'WF-04' });
  for (let i = 0; i < 6; i++) {
    await page.locator('#nav [data-go="PL-0' + (1 + (i % 4)) + '"]').click({ delay: 0 });
    await page.locator('#nav [data-go="home"]').click();
  }
  assert.strictEqual((await view(page)).view, 'home');
  assert.deepStrictEqual(errors, []);
  await context.close();
});

check('Double-clicking a document card, a sidebar entry and a cross-reference leaves a normal page', async () => {
  const { page, errors, context } = await open();
  await go(page, 'cat:workflow');
  await page.locator('.homecard[data-go="WF-03"]').dblclick();
  assert.deepStrictEqual(await view(page), { view: 'doc', id: 'WF-03' });
  await page.locator('#nav [data-go="PL-02"]').dblclick();
  assert.deepStrictEqual(await view(page), { view: 'doc', id: 'PL-02' });
  assert.ok((await page.innerText('.cvtitle')).includes(SOPS.find((s) => s.id === 'PL-02').title));
  assert.deepStrictEqual(errors, []);
  await context.close();
});

check('The browser Back button returns to the previous screen instead of leaving the Store Room', async () => {
  const { page, context } = await open();
  await go(page, 'cat:policy');
  await page.locator('.homecard').first().click();
  await page.goBack().catch(() => {});
  await sleep(page, 200);
  const url = page.url();
  assert.ok(url.startsWith('file://') && url.endsWith('index.html') || url.includes('index.html'), 'Back left the app: ' + url);
  assert.strictEqual((await view(page)).view, 'cat', 'Back should show the category page');
  await context.close();
});

/* ---------------- 7. screen sizes ---------------- */
for (const [w, h] of [[390, 844], [820, 1180], [1366, 900], [1800, 1000]]) {
  check('No sideways page scroll at ' + w + 'x' + h + ' on home, categories, every document and search results', async () => {
    const { page, errors, context } = await open({ width: w, height: h });
    const bad = [];
    const screens = ['home', 'cat:policy', 'cat:workflow', 'cat:apps'].concat(SOPS.map((s) => s.id));
    for (const t of screens) {
      await go(page, t);
      const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, bw: document.body.scrollWidth }));
      if (o.sw > o.cw + 1 || o.bw > o.cw + 1) bad.push(t + ' (' + o.sw + '/' + o.bw + ' > ' + o.cw + ')');
    }
    await page.evaluate(() => { $q.value = 'the'; $q.dispatchEvent(new Event('input', { bubbles: true })); });
    const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    if (o.sw > o.cw + 1) bad.push('search results (' + o.sw + ' > ' + o.cw + ')');
    assert.ok(bad.length === 0, bad.join(' ;; '));
    assert.deepStrictEqual(errors, []);
    await context.close();
  });
}

check('Phone: the "Browse everything" list is closed at first, opens and closes with the button', async () => {
  const { page, context } = await open({ width: 390, height: 844 });
  assert.ok(await page.locator('#browsetoggle').isVisible());
  assert.ok(!(await page.locator('#nav').isVisible()), 'list should start closed');
  assert.strictEqual(await page.getAttribute('#browsetoggle', 'aria-expanded'), 'false');
  await page.click('#browsetoggle');
  assert.ok(await page.locator('#nav').isVisible(), 'list should open');
  assert.ok(await page.locator('#q').isVisible(), 'search should be visible in the open list');
  assert.strictEqual(await page.getAttribute('#browsetoggle', 'aria-expanded'), 'true');
  await page.click('#browsetoggle');
  assert.ok(!(await page.locator('#nav').isVisible()), 'list should close');
  assert.strictEqual(await page.getAttribute('#browsetoggle', 'aria-expanded'), 'false');
  await context.close();
});

check('Phone and tablet: choosing a document, home or applications in the list opens it and closes the list', async () => {
  for (const [w, h] of [[390, 844], [820, 1180]]) {
    const { page, errors, context } = await open({ width: w, height: h });
    for (const target of ['PL-03', 'cat:apps', 'home', 'WF-05']) {
      await page.click('#browsetoggle');
      await page.locator('#nav [data-go="' + target + '"]').click();
      assert.ok(!(await page.locator('#nav').isVisible()), w + ': list stayed open after ' + target);
      assert.strictEqual(await page.getAttribute('#browsetoggle', 'aria-expanded'), 'false');
      const v = await view(page);
      const exp = target === 'home' ? { view: 'home', id: null } : target.startsWith('cat:') ? { view: 'cat', id: 'apps' } : { view: 'doc', id: target };
      assert.deepStrictEqual(v, exp);
    }
    assert.deepStrictEqual(errors, []);
    await context.close();
  }
});

check('Laptop and wide: the side list and search are always visible and there is no Browse button', async () => {
  for (const w of [1366, 1800]) {
    const { page, context } = await open({ width: w, height: 900 });
    assert.ok(!(await page.locator('#browsetoggle').isVisible()));
    assert.ok(await page.locator('#nav').isVisible());
    assert.ok(await page.locator('#q').isVisible());
    await context.close();
  }
});

check('Phone: after opening a document the page starts at the top, and the doors are shown before the list on home', async () => {
  const { page, context } = await open({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 400));
  await go(page, 'WF-04');
  await settle(page);
  assert.strictEqual(await page.evaluate(() => scrollY), 0);
  await go(page, 'home');
  const doorTop = await page.locator('.doorwrap').first().evaluate((e) => e.getBoundingClientRect().top);
  const toggleTop = await page.locator('#browsetoggle').evaluate((e) => e.getBoundingClientRect().top + scrollY);
  assert.ok(doorTop + (await page.evaluate(() => scrollY)) < toggleTop, 'doors should come before the browse button');
  await context.close();
});

check('Searching and clicking a result opens that document on every screen size', async () => {
  for (const [w, h] of [[390, 844], [1366, 900]]) {
    const { page, errors, context } = await open({ width: w, height: h });
    if (w < 900) await page.click('#browsetoggle');
    await page.fill('#q', 'warning');
    assert.strictEqual((await view(page)).view, 'search');
    const id = await page.locator('.rcard').first().getAttribute('data-go');
    await page.locator('.rcard').first().click();
    assert.deepStrictEqual(await view(page), { view: 'doc', id });
    assert.deepStrictEqual(errors, []);
    await context.close();
  }
});

check('Search result cards can be reached and opened with the keyboard', async () => {
  const { page, context } = await open();
  await page.fill('#q', 'warning');
  const r = await focusable(page, '.rcard');
  assert.ok(r.n > 0 && r.bad === 0, r.bad + ' of ' + r.n + ' search results cannot take keyboard focus');
  await context.close();
});

/* ---------------- 8. every screen, every button ---------------- */
check('A full tour of every screen (home, categories, 17 documents, search) raises no page errors', async () => {
  for (const motion of ['reduce', 'no-preference']) {
    const { page, errors, context } = await open({ reducedMotion: motion });
    for (const t of ['home', 'cat:policy', 'cat:workflow', 'cat:apps'].concat(SOPS.map((s) => s.id))) {
      await go(page, t);
    }
    await page.fill('#q', 'leave');
    await page.fill('#q', 'zzzz-nothing');
    await page.fill('#q', '');
    await page.waitForTimeout(300);
    assert.deepStrictEqual(errors, [], motion);
    await context.close();
  }
});

check('Every document has a "Print this document" button that asks the browser to print', async () => {
  const { page, errors, context } = await open();
  for (const d of SOPS) {
    await go(page, d.id);
    await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
    const btn = page.locator('button.printbtn', { hasText: 'Print this document' });
    assert.strictEqual(await btn.count(), 1, d.id + ' print button');
    await btn.click();
    assert.strictEqual(await page.evaluate(() => window.__printed), 1, d.id + ' print button did nothing');
  }
  assert.deepStrictEqual(errors, []);
  await context.close();
});

check('Every visible button on every screen does something visible when pressed', async () => {
  const { page, errors, context } = await open();
  await go(page, 'cat:apps');
  // Edit then Status then Save then (nothing changed) back to the card list
  await page.locator('.editbtn').first().click();
  assert.ok(await page.locator('.appcard.editing').count());
  await page.locator('[data-act="status"]').nth(2).click();
  assert.ok(await page.locator('.stbtn.on').innerText().then((t) => /planned/i.test(t)), 'status button should select');
  await page.locator('[data-act="cancel"]').click();
  assert.strictEqual(await page.locator('.appcard.editing').count(), 0);
  // every doc has only the print button (stubbed) and no dead button
  await go(page, 'PL-01');
  const buttons = await page.evaluate(() => Array.from(document.querySelectorAll('#main button')).map((b) => b.className));
  assert.deepStrictEqual(buttons, ['printbtn']);
  // sidebar toggle at phone width
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('#browsetoggle');
  assert.ok(await page.locator('#nav').isVisible());
  assert.deepStrictEqual(errors, []);
  await context.close();
});

check('Home page counts at load time agree with the doors and show after the count-up animation', async () => {
  const { page, context } = await open({ reducedMotion: 'no-preference' });
  await sleep(page, 1300);
  const nums = await page.$$eval('.hsnum', (els) => els.map((e) => e.textContent.trim()));
  const nw = SOPS.filter((s) => s.cat === 'workflow').length, np = SOPS.filter((s) => s.cat === 'policy').length;
  assert.deepStrictEqual(nums.slice(0, 3), [String(nw), String(np), String(D.APPS.length)]);
  await context.close();
});

/* ---------------- 9. print ---------------- */
check('Printing a document hides the side navigation, search, header, breadcrumbs and buttons', async () => {
  const { page, context } = await open({ width: 1366, height: 900 });
  for (const id of ['WF-01', 'PL-05']) {
    await go(page, id);
    await page.emulateMedia({ media: 'print' });
    for (const sel of ['aside', '#q', '#nav', 'header.top', '.crumb', '.printbtn', '.nextprev', '.stagerail', '#progress']) {
      const vis = await page.evaluate((s) => Array.from(document.querySelectorAll(s)).some((e) => { const r = e.getBoundingClientRect(); return getComputedStyle(e).display !== 'none' && r.width > 0 && r.height > 0; }), sel);
      assert.ok(!vis, id + ': ' + sel + ' is still visible in print');
    }
    assert.ok(await page.locator('.docctrl').isVisible(), 'controlled-document box must print');
    await page.emulateMedia({ media: 'screen' });
  }
  await context.close();
});

check('A printed document contains all its text: steps, lists, notes, tables (also those inside steps), do/don\'t, with no raw ** markers', async () => {
  const { page, context } = await open();
  const bad = [];
  for (const d of SOPS) {
    await page.emulateMedia({ media: 'screen' });
    await go(page, d.id);
    const text = await printText(page, '#main');
    const p = parts(d);
    for (const kind of ['steps', 'lists', 'notes', 'sectionTables', 'stepTables', 'dodont', 'when']) {
      const m = missing(text.replace(/\*\*/g, ''), p[kind]);
      if (m.length) bad.push(d.id + ' ' + kind + ': ' + m.slice(0, 2).map((x) => x.slice(0, 40)).join(' | '));
    }
    if (text.includes('**')) bad.push(d.id + ' shows raw ** markers');
  }
  assert.ok(bad.length === 0, bad.join(' ;; '));
  await context.close();
});

check('A document on screen shows no raw ** markers', async () => {
  const { page, context } = await open();
  const bad = [];
  for (const d of SOPS) {
    await go(page, d.id);
    const t = await page.innerText('#main');
    if (t.includes('**')) bad.push(d.id);
  }
  assert.ok(bad.length === 0, bad.join(' ;; '));
  await context.close();
});

check('The category print stack is hidden on screen and holds every document of the category', async () => {
  const { page, context } = await open();
  for (const cat of CATS) {
    await go(page, 'cat:' + cat);
    assert.ok(!(await page.locator('.printstack').isVisible()), 'print stack visible on screen');
    assert.strictEqual(await page.locator('.psdoc').count(), docsIn(cat).length);
    await page.emulateMedia({ media: 'print' });
    assert.ok(await page.locator('.printstack').isVisible(), 'print stack hidden in print');
    assert.ok(!(await page.locator('.catsec').isVisible()), 'card grid should not print');
    const h1 = await page.$$eval('.psdoc h1', (e) => e.map((x) => x.textContent));
    assert.strictEqual(JSON.stringify(h1), JSON.stringify(docsIn(cat).map((d) => d.id + ' — ' + d.title)));
    await page.emulateMedia({ media: 'screen' });
  }
  await context.close();
});

for (const cat of CATS) {
  for (const [kind, label] of [
    ['steps', 'every step title and description'],
    ['lists', 'every checklist inside a step'],
    ['notes', 'every compliance / escalation / tip note'],
    ['sectionTables', 'every table (including their notes)'],
    ['stepTables', 'every table that sits inside a step'],
    ['dodont', 'every Do and Don\'t line'],
    ['when', 'the timing ("when") of each step'],
  ]) {
    check('Printing the ' + cat + ' category includes ' + label, async () => {
      const { page, context } = await open();
      await go(page, 'cat:' + cat);
      const bad = [];
      for (const d of docsIn(cat)) {
        const idx = docsIn(cat).indexOf(d);
        await page.emulateMedia({ media: 'print' });
        const text = norm(await page.evaluate((i) => document.querySelectorAll('.psdoc')[i].innerText, idx)).replace(/\*\*/g, '');
        const p = parts(d);
        const list = p[kind];
        const m = missing(text, list);
        if (m.length) bad.push(d.id + ' lacks ' + m.length + ' item(s), e.g. "' + (m[0] || '').slice(0, 50) + '"');
      }
      assert.ok(bad.length === 0, bad.join(' ;; '));
      await context.close();
    });
  }
  check('Printing the ' + cat + ' category shows no raw ** markers', async () => {
    const { page, context } = await open();
    await go(page, 'cat:' + cat);
    const text = await printText(page, '.printstack');
    const n = (text.match(/\*\*/g) || []).length;
    assert.strictEqual(n, 0, n + ' raw ** markers in the printed ' + cat + ' stack');
    await context.close();
  });
}

check('Printing the applications page still lists the applications', async () => {
  const { page, context } = await open();
  await go(page, 'cat:apps');
  await page.emulateMedia({ media: 'print' });
  const text = await page.evaluate(() => document.querySelector('#main').innerText.toLowerCase());
  const missingApps = D.APPS.filter((a) => !text.includes(a.name.toLowerCase().replace(/’/g, '’')));
  assert.ok(missingApps.length === 0, 'applications missing from the printed page: ' + missingApps.map((a) => a.name).join(', '));
  await context.close();
});

check('Printing a category page shows the category cover but not the home banner, doors or situation shortcuts', async () => {
  const { page, context } = await open();
  await go(page, 'cat:workflow');
  await page.emulateMedia({ media: 'print' });
  for (const sel of ['aside', 'header.top', '.hero', '.sitbox', '.doorwrap']) {
    const vis = await page.evaluate((s) => Array.from(document.querySelectorAll(s)).some((e) => getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0), sel);
    assert.ok(!vis, sel + ' visible in print');
  }
  await context.close();
});
