const test = require('node:test');
const assert = require('node:assert/strict');
const medicines = require('../data/medicines.json');
const searchEngine = require('../js/search.js');

test('Category Priority & Filtering Test Suite', async (t) => {
  searchEngine.init(medicines);

  await t.test('retrieves standard category definitions with counts', () => {
    const cats = searchEngine.getCategories();
    assert.ok(Array.isArray(cats));
    assert.ok(cats.length >= 7, `Expected >= 7 categories, got ${cats.length}`);

    const allCat = cats.find(c => c.id === 'all');
    assert.ok(allCat, 'Should have All Medicines category');
    assert.strictEqual(allCat.count, medicines.length);

    // Verify key categories exist
    const expectedIds = ['pain', 'stomach', 'antibiotics', 'cardiac', 'diabetes', 'allergy'];
    expectedIds.forEach(id => {
      const found = cats.find(c => c.id === id);
      assert.ok(found, `Category ${id} must exist`);
      assert.ok(found.count > 0, `Category ${id} count should be > 0, got ${found.count}`);
      assert.ok(found.name_en, `Category ${id} must have English name`);
      assert.ok(found.name_ur, `Category ${id} must have Urdu name`);
      assert.ok(found.icon, `Category ${id} must have icon`);
    });
  });

  await t.test('matchesCategory maps clinical categories accurately', () => {
    const panadol = searchEngine.getById('panadol-500mg-tablet');
    const risek = searchEngine.getById('risek-20mg-capsule');
    const augmentin = searchEngine.getById('augmentin-625mg-tablet');
    const glucophage = searchEngine.getById('glucophage-500mg-tablet');
    const norvasc = searchEngine.getById('norvasc-5mg-tablet');
    const softin = searchEngine.getById('softin-10mg-tablet');

    assert.ok(searchEngine.matchesCategory(panadol, 'pain'));
    assert.ok(searchEngine.matchesCategory(risek, 'stomach'));
    assert.ok(searchEngine.matchesCategory(augmentin, 'antibiotics'));
    assert.ok(searchEngine.matchesCategory(glucophage, 'diabetes'));
    assert.ok(searchEngine.matchesCategory(norvasc, 'cardiac'));
    assert.ok(searchEngine.matchesCategory(softin, 'allergy'));

    // Cross-category negative checks
    assert.strictEqual(searchEngine.matchesCategory(panadol, 'antibiotics'), false);
    assert.strictEqual(searchEngine.matchesCategory(glucophage, 'stomach'), false);
  });

  await t.test('search filters by category priority when specified', () => {
    // Search with category constraint
    const painResults = searchEngine.search('pan', { category: 'pain' });
    assert.ok(painResults.length > 0);
    assert.ok(painResults.every(m => searchEngine.matchesCategory(m, 'pain')));

    // Search with antibiotics category should not include Panadol
    const antibioticResults = searchEngine.search('pan', { category: 'antibiotics' });
    const hasPanadol = antibioticResults.some(m => m.brand_name.toLowerCase().includes('panadol'));
    assert.strictEqual(hasPanadol, false, 'Panadol should not be in antibiotics category');
  });

  await t.test('getPopularMedicines returns category-specific popular list', () => {
    const diabetesPop = searchEngine.getPopularMedicines(5, 'diabetes');
    assert.ok(diabetesPop.length > 0);
    assert.ok(diabetesPop.every(m => searchEngine.matchesCategory(m, 'diabetes')));
  });
});
