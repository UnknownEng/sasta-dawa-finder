const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parsePage, lastPageNumber } = require('../scripts/sync_drap');
const { fixtureJson } = require('./helpers/fixture');

test('parses DRAP price index HTML', () => {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures/drap_page.html'), 'utf8');
  const rows = parsePage(html);
  assert.equal(rows.length, 3);
  for (const r of rows) {
    assert.ok(r.product, 'product');
    assert.ok(r.reg, 'registration number');
    assert.ok(r.manufacturer, 'manufacturer');
    assert.match(r.price, /^[\d,]+(\.\d+)?$/);
    assert.match(r.effective, /\d{1,2} \w{3}, \d{4}/);
  }
  assert.equal(lastPageNumber(html), 1096);
  assert.deepEqual(parsePage('<html>no table</html>'), []);
});

test('buildFromRaw produces a compact, valid dataset', () => {
  const out = fixtureJson();
  assert.equal(out.rows.length, 19, 'row with invalid price is skipped');
  assert.ok(out.fields.includes('group'));
  assert.equal(out.meta.latest_price_date, '2026-08-20', 'future-dated prices are not used as "latest"');
  for (const r of out.rows) {
    assert.equal(r.length, out.fields.length);
    const g = r[out.fields.indexOf('group')];
    assert.ok(g === -1 || (g >= 0 && g < out.groups.length));
  }
  assert.ok(out.categories.some((c) => c.id === 'other'));
});
