const test = require('node:test');
const assert = require('node:assert/strict');
const medicines = require('../data/medicines.json');
const searchEngine = require('../js/search.js');

test('Search Functionality Suite', async (t) => {
  searchEngine.init(medicines);

  await t.test('exact brand match returns target medicine first', () => {
    const results = searchEngine.search('Panadol');
    assert.ok(results.length > 0, 'Should return results for Panadol');
    assert.strictEqual(results[0].brand_name, 'Panadol');
    assert.strictEqual(results[0].generic_name, 'Paracetamol');
  });

  await t.test('exact brand match with strength', () => {
    const results = searchEngine.search('Risek 20');
    assert.ok(results.length > 0, 'Should find Risek 20');
    assert.strictEqual(results[0].id, 'risek-20mg-capsule');
  });

  await t.test('partial prefix match works', () => {
    const results = searchEngine.search('pana');
    assert.ok(results.length > 0, 'Should find results starting with pana');
    const hasPanadol = results.some(r => r.brand_name.toLowerCase().startsWith('panadol'));
    assert.ok(hasPanadol, 'Expected Panadol in partial prefix search');
  });

  await t.test('case insensitivity works uniformly', () => {
    const lowercase = searchEngine.search('augmentin');
    const uppercase = searchEngine.search('AUGMENTIN');
    const mixedCase = searchEngine.search('AuGmEnTiN');

    assert.ok(lowercase.length > 0);
    assert.strictEqual(lowercase.length, uppercase.length);
    assert.strictEqual(lowercase[0].id, uppercase[0].id);
    assert.strictEqual(lowercase[0].id, mixedCase[0].id);
  });

  await t.test('generic / salt formula search matches medicines', () => {
    const results = searchEngine.search('Paracetamol');
    assert.ok(results.length >= 5, 'Should find multiple paracetamol medicines');
    const allParacetamol = results.every(r => r.generic_name.toLowerCase().includes('paracetamol'));
    assert.ok(allParacetamol, 'All matched results should contain paracetamol');
  });

  await t.test('no match returns empty array cleanly', () => {
    const results = searchEngine.search('xylophonicmedicinethatdoesnotexist');
    assert.ok(Array.isArray(results));
    assert.strictEqual(results.length, 0);
  });

  await t.test('empty input and whitespace handling', () => {
    assert.deepStrictEqual(searchEngine.search(''), []);
    assert.deepStrictEqual(searchEngine.search('   '), []);
    assert.deepStrictEqual(searchEngine.search('\t\n  \t'), []);
    assert.deepStrictEqual(searchEngine.search(null), []);
    assert.deepStrictEqual(searchEngine.search(undefined), []);
  });

  await t.test('special characters and XSS attempts do not break search', () => {
    assert.doesNotThrow(() => {
      const xssRes = searchEngine.search('<script>alert("xss")</script>');
      assert.ok(Array.isArray(xssRes));

      const punctuationRes = searchEngine.search('!@#$%^&*()_+={}:"|<>?');
      assert.ok(Array.isArray(punctuationRes));

      // With parenthesis as in clinical names
      const parenRes = searchEngine.search('Augmentin (625mg)');
      assert.ok(parenRes.length > 0);
      assert.strictEqual(parenRes[0].brand_name, 'Augmentin 625');
    });
  });

  await t.test('very long query strings do not crash or freeze', () => {
    const longString = 'a'.repeat(2000);
    const start = Date.now();
    const results = searchEngine.search(longString);
    const duration = Date.now() - start;

    assert.ok(Array.isArray(results));
    assert.strictEqual(results.length, 0);
    assert.ok(duration < 100, `Search should finish swiftly, took ${duration}ms`);
  });
});
