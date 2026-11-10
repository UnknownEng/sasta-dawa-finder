// Integrity checks on the shipped dataset (data/medicines.json)
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const SDData = require('../js/data');
const SDSearch = require('../js/search');

const json = require(path.join(__dirname, '../data/medicines.json'));
const ds = SDData.expand(json);
const engine = SDSearch.createEngine(ds);

test('dataset metadata & schema', () => {
  assert.match(json.meta.source, /Drug Regulatory Authority of Pakistan/);
  assert.ok(json.meta.synced_at);
  assert.equal(json.meta.products, json.rows.length);
  assert.ok(json.rows.length > 5000, 'expected thousands of DRAP products');
  json.rows.forEach((r) => assert.equal(r.length, json.fields.length));
});

test('every product is usable', () => {
  const ids = new Set();
  for (const m of ds.items) {
    assert.ok(m.product && m.name, 'name');
    assert.ok(m.price > 0, `${m.product} price`);
    assert.ok(m.units > 0, `${m.product} units`);
    assert.ok(Number.isFinite(m.unitPrice));
    assert.ok(!ids.has(m.id), 'unique id ' + m.id);
    ids.add(m.id);
    assert.ok(ds.categories.some((c) => c.id === m.category), 'known category ' + m.category);
  }
});

test('alternative groups are internally consistent', () => {
  for (const [, members] of ds.groups) {
    assert.ok(members.length >= 2);
    const forms = new Set(members.map((m) => m.form));
    const units = new Set(members.map((m) => m.unit));
    assert.equal(forms.size, 1);
    assert.equal(units.size, 1);
  }
});

test('common medicines are searchable', () => {
  for (const q of ['ceftriaxone', 'clarithromycin', 'levofloxacin']) {
    assert.ok(engine.search(q).length > 0, q);
  }
});
