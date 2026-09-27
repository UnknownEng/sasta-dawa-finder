const test = require('node:test');
const assert = require('node:assert/strict');
const medicines = require('../data/medicines.json');
const searchEngine = require('../js/search.js');

test('Alternatives Retrieval and Price Sorting Suite', async (t) => {
  searchEngine.init(medicines);

  await t.test('retrieves alternatives for medicine that HAS alternatives (e.g., Panadol)', () => {
    const res = searchEngine.getAlternatives('panadol-500mg-tablet');
    assert.ok(res.medicine, 'Target medicine must be resolved');
    assert.strictEqual(res.medicine.brand_name, 'Panadol');
    assert.ok(res.alternatives.length > 0, 'Panadol should have alternatives');
    assert.ok(res.totalCount >= 4, `Expected >= 4 alternatives for Paracetamol 500mg, got ${res.totalCount}`);

    // Confirm that the base medicine itself is not included in alternatives
    const selfIncluded = res.alternatives.some(a => a.id === 'panadol-500mg-tablet');
    assert.strictEqual(selfIncluded, false, 'Target medicine must NOT be listed in its own alternatives');

    // Confirm all alternatives have the identical salt_group_id
    res.alternatives.forEach(alt => {
      assert.strictEqual(alt.salt_group_id, res.medicine.salt_group_id);
    });

    // Check cheapest alternative
    assert.ok(res.cheapestAlternative, 'Cheapest alternative should be identified');
    assert.ok(res.cheapestAlternative.unit_price_pkr < res.medicine.unit_price_pkr);
    assert.ok(res.cheapestAlternative.percent_savings > 0);
  });

  await t.test('correctly handles medicine with NO alternatives found (e.g. Spiriva Respimat)', () => {
    const res = searchEngine.getAlternatives('spiriva-respimat-inhaler');
    assert.ok(res.medicine, 'Target medicine should exist');
    assert.strictEqual(res.alternatives.length, 0, 'Should have 0 alternatives');
    assert.strictEqual(res.cheapestAlternative, null, 'Cheapest alternative should be null');
    assert.strictEqual(res.totalCount, 0);
    assert.strictEqual(res.cheaperCount, 0);
  });

  await t.test('default sorting is cheapest first (price_asc)', () => {
    const res = searchEngine.getAlternatives('risek-20mg-capsule', { sortBy: 'price_asc' });
    assert.ok(res.alternatives.length >= 3);

    for (let i = 0; i < res.alternatives.length - 1; i++) {
      assert.ok(
        res.alternatives[i].unit_price_pkr <= res.alternatives[i + 1].unit_price_pkr,
        `Expected ${res.alternatives[i].unit_price_pkr} <= ${res.alternatives[i + 1].unit_price_pkr}`
      );
    }
  });

  await t.test('sorting by price descending (price_desc) works', () => {
    const res = searchEngine.getAlternatives('risek-20mg-capsule', { sortBy: 'price_desc' });
    for (let i = 0; i < res.alternatives.length - 1; i++) {
      assert.ok(
        res.alternatives[i].unit_price_pkr >= res.alternatives[i + 1].unit_price_pkr,
        `Expected ${res.alternatives[i].unit_price_pkr} >= ${res.alternatives[i + 1].unit_price_pkr}`
      );
    }
  });

  await t.test('sorting by highest savings percent (savings_desc) works', () => {
    const res = searchEngine.getAlternatives('augmentin-625mg-tablet', { sortBy: 'savings_desc' });
    for (let i = 0; i < res.alternatives.length - 1; i++) {
      assert.ok(
        res.alternatives[i].percent_savings >= res.alternatives[i + 1].percent_savings,
        `Expected ${res.alternatives[i].percent_savings}% >= ${res.alternatives[i + 1].percent_savings}%`
      );
    }
  });

  await t.test('sorting by brand name (name_asc) works', () => {
    const res = searchEngine.getAlternatives('panadol-500mg-tablet', { sortBy: 'name_asc' });
    for (let i = 0; i < res.alternatives.length - 1; i++) {
      assert.ok(
        res.alternatives[i].brand_name.localeCompare(res.alternatives[i + 1].brand_name) <= 0
      );
    }
  });

  await t.test('calculates accurate savings metrics for expensive brands', () => {
    // Losec 20 is ~38.57 PKR/cap, Risek 20 is ~25.00 PKR/cap, Omeper is ~15.71 PKR/cap
    const res = searchEngine.getAlternatives('losec-20mg-capsule');
    assert.ok(res.cheapestAlternative);
    assert.ok(res.cheaperCount > 0);
    // Cheapest should save > 50%
    assert.ok(res.cheapestAlternative.percent_savings >= 50, `Expected >= 50% savings, got ${res.cheapestAlternative.percent_savings}%`);
    assert.ok(res.cheapestAlternative.unit_difference_pkr > 20);
  });
});
