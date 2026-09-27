const test = require('node:test');
const assert = require('node:assert/strict');
const medicines = require('../data/medicines.json');
const searchEngine = require('../js/search.js');

test('Synonym Matching & Rivotril/Clonazepam Suite', async (t) => {
  searchEngine.init(medicines);

  await t.test('Metamizole and Novaminsulfon return the exact same generic alternatives', () => {
    const metaRes = searchEngine.search('Metamizole');
    const novaRes = searchEngine.search('Novaminsulfon');

    assert.ok(metaRes.length >= 2, 'Metamizole search should return results');
    assert.ok(novaRes.length >= 2, 'Novaminsulfon search should return results');

    const metaIds = metaRes.map(m => m.id).sort();
    const novaIds = novaRes.map(m => m.id).sort();

    assert.deepStrictEqual(metaIds, novaIds, 'Metamizole and Novaminsulfon must find the same medicines');

    const hasNovalgin = metaRes.some(m => m.brand_name.toLowerCase().includes('novalgin'));
    assert.ok(hasNovalgin, 'Should find Novalgin when searching Metamizole');
  });

  await t.test('Rivotril and Clonazepam resolve correctly and find cheaper alternatives', () => {
    // 1. Search brand Rivotril
    const rivotrilRes = searchEngine.search('Rivotril');
    assert.ok(rivotrilRes.length > 0, 'Should find Rivotril');
    const rivotril05 = rivotrilRes.find(m => m.id === 'rivotril-0-5mg-tablet');
    assert.ok(rivotril05, 'Rivotril 0.5mg must exist');

    // 2. Search chemical salt Clonazepam
    const clonazRes = searchEngine.search('Clonazepam');
    assert.ok(clonazRes.length >= 4, 'Should find multiple brands for Clonazepam');

    // 3. Alternatives for Rivotril 0.5mg
    const alts = searchEngine.getAlternatives('rivotril-0-5mg-tablet');
    assert.ok(alts.alternatives.length >= 3, 'Rivotril 0.5 should have at least 3 generic alternatives');
    assert.ok(alts.cheapestAlternative, 'Should have a cheapest alternative');
    assert.ok(alts.cheapestAlternative.unit_price_pkr < rivotril05.unit_price_pkr, 'Cheapest should be lower price');
    assert.ok(alts.cheapestAlternative.percent_savings > 25, 'Should offer > 25% savings');

    // Expected cheaper alternatives: Epitril or Zapiz or Clonatril
    const altBrands = alts.alternatives.map(a => a.brand_name);
    assert.ok(altBrands.includes('Clonatril 0.5'));
    assert.ok(altBrands.includes('Epitril 0.5'));
  });

  await t.test('Unverified entry is explicitly flagged with confidence="unverified" and verified=false', () => {
    const unverified = medicines.filter(m => !m.verified || m.confidence === 'unverified');
    assert.ok(unverified.length > 0, 'Should have at least 1 flagged unverified item for testing');
    const sample = unverified[0];
    assert.strictEqual(sample.verified, false);
    assert.strictEqual(sample.confidence, 'unverified');
    assert.strictEqual(sample.price_is_estimate, true);
  });
});
