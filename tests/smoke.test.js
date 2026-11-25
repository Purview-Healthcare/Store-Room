const { check, data, open, go, assert } = require('./lib');

check('The page opens with no errors', async () => {
  const { page, errors } = await open();
  assert.ok(await page.locator('.herotitle').isVisible());
  assert.deepStrictEqual(errors, []);
});

check('Every document opens and shows its title', async () => {
  const { page, errors } = await open();
  for (const d of data().SOPS) {
    await go(page, d.id);
    assert.ok((await page.innerText('#main')).includes(d.title), d.id + ' title missing');
  }
  assert.deepStrictEqual(errors, []);
});
