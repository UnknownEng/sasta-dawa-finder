const test = require('node:test');
const assert = require('node:assert/strict');
const { fixtureEngine, find } = require('./helpers/fixture');

const { ds, engine } = fixtureEngine();

test('search', async (t) => {
  await t.test('brand prefix, case-insensitive', () => {
    const r = engine.search('PANA');
    assert.ok(r.length >= 3);
    assert.ok(r.every((x) => x.med.name.toLowerCase().startsWith('panadol')));
  });

  await t.test('generic name finds every brand', () => {
    const names = new Set(engine.search('paracetamol').map((r) => r.med.name));
    ['Panadol', 'Calpol', 'Febrol'].forEach((n) => assert.ok(names.has(n), n));
  });

  await t.test('synonyms', () => {
    assert.ok(engine.search('acetaminophen').some((r) => r.med.name === 'Calpol'));
  });

  await t.test('strength narrows results', () => {
    const r = engine.search('risek 40');
    assert.equal(r[0].med.strength, '40mg');
  });

  await t.test('special characters do not crash and return nothing', () => {
    assert.deepEqual(engine.search('<script>'), []);
    assert.deepEqual(engine.search('   '), []);
  });

  await t.test('did you mean', () => {
    assert.ok(engine.didYouMean('panadool').includes('panadol'));
    assert.ok(engine.didYouMean('omeprazol').includes('omeprazole'));
  });

  await t.test('suggest returns distinct products', () => {
    const s = engine.suggest('panadol', 8);
    const keys = s.map((m) => m.name + m.strength + m.form);
    assert.equal(new Set(keys).size, keys.length);
  });
});

test('alternatives & savings', async (t) => {
  const panadol = find(ds, 'Panadol 500mg Tablet');
  const calpol = find(ds, 'Calpol Tablets 500mg');
  const febrol = find(ds, 'Febrol 500mg Tab');

  await t.test('same formula, strength and form are grouped; combos are not', () => {
    const alts = engine.alternatives(panadol).map((m) => m.name);
    assert.deepEqual(alts.sort(), ['Calpol', 'Febrol', 'Panadol']);
    assert.ok(!alts.includes('Panadol Extra'));
  });

  await t.test('sorted by price per tablet, not pack price', () => {
    const alts = engine.alternatives(panadol, 'unit');
    assert.equal(alts[0].id, febrol.id); // 2.60 per tablet
    assert.equal(alts[alts.length - 1].id, panadol.id); // 5.25 per tablet, despite the 200-tablet pack
    assert.equal(engine.alternatives(panadol, 'pack')[0].id, calpol.id); // smallest pack price, Rs 5.20/tablet
  });

  await t.test('savings vs cheapest', () => {
    const s = engine.savings(panadol);
    assert.equal(s.cheapest.id, febrol.id);
    assert.equal(s.percent, 50); // 5.25 -> 2.60
    assert.equal(engine.savings(febrol), null);
  });

  await t.test('combination products with "eq. to" are grouped', () => {
    const aug = find(ds, 'Augmentin 625mg Tablet');
    assert.deepEqual(engine.alternatives(aug).map((m) => m.name).sort(), ['Amclav', 'Augmentin']);
  });

  await t.test('extended release is kept separate', () => {
    const xr = find(ds, 'Glucophage XR 500mg Tablet');
    assert.equal(engine.alternatives(xr).length, 1);
    const ir = find(ds, 'Glucophage 500mg Tablet');
    assert.ok(engine.strengths(ir).some((s) => s.med.id === xr.id));
  });

  await t.test('other strengths of the same salt', () => {
    const r20 = find(ds, 'Risek 20mg Capsule');
    assert.ok(engine.strengths(r20).some((s) => s.med.strength === '40mg'));
  });
});

test('categories & home sections', () => {
  const fams = engine.categoryFamilies('stomach');
  assert.ok(fams.length >= 2);
  assert.ok(fams[0].count >= 1);
  assert.ok(engine.categoryCounts().get('pain') >= 3);
  const deals = engine.topSavings(5);
  assert.ok(deals.length >= 1);
  assert.ok(deals.every((d) => d.s.percent >= 15 && d.med.popular));
});

test('findInText understands Roman Urdu and typos', () => {
  const f = engine.findInText('panadol ka sasta option batao');
  assert.equal(f[0].best.name, 'Panadol');
  const typo = engine.findInText('augmentn price');
  assert.equal(typo[0].best.name, 'Augmentin');
  assert.ok(typo[0].fuzzy);
  const two = engine.findInText('risek vs omega');
  assert.deepEqual(two.map((x) => x.best.name), ['Risek', 'Omega']);
  assert.deepEqual(engine.findInText('salam, how are you'), []);
});
