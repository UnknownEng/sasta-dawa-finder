const test = require('node:test');
const assert = require('node:assert/strict');
const medicines = require('../data/medicines.json');
const searchEngine = require('../js/search.js');

test('Pediatric & Topical/Dermatological Formulations Suite', async (t) => {
  searchEngine.init(medicines);

  await t.test('Pediatric Paracetamol Syrup finds cheaper alternatives', () => {
    const results = searchEngine.search('Panadol Syrup');
    assert.ok(results.length > 0, 'Must find Panadol Syrup');

    const panadolSyrup = results[0];
    assert.strictEqual(panadolSyrup.dosage_form, 'Syrup');
    assert.strictEqual(panadolSyrup.pack_unit, 'bottle');

    const altsResult = searchEngine.getAlternatives(panadolSyrup);
    const alts = altsResult.alternatives;
    assert.ok(alts.length >= 3, `Expected at least 3 alternatives, got ${alts.length}`);

    // Verify cheaper alternatives exist (e.g., Febrol Syrup at PKR 72 vs Panadol at PKR 115)
    const cheapest = altsResult.cheapestAlternative;
    assert.ok(cheapest.is_cheaper, 'Should find a cheaper syrup');
    assert.ok(cheapest.percent_savings >= 25, `Expected >= 25% savings, got ${cheapest.percent_savings}%`);
    assert.ok(cheapest.brand_name.includes('Febrol') || cheapest.brand_name.includes('Paramol'));
  });

  await t.test('Pediatric Ibuprofen Suspension finds cheaper alternatives', () => {
    const results = searchEngine.search('Brufen Suspension');
    assert.ok(results.length > 0, 'Must find Brufen Suspension');

    const brufen = results[0];
    const altsResult = searchEngine.getAlternatives(brufen);
    assert.ok(altsResult.alternatives.length >= 1);

    const profen = altsResult.alternatives.find(a => a.brand_name.includes('Profen'));
    assert.ok(profen, 'Profen Suspension must be an alternative to Brufen Suspension');
    assert.ok(profen.unit_price_pkr < brufen.unit_price_pkr);
  });

  await t.test('Topical Betamethasone Valerate Cream finds cheaper alternatives', () => {
    const results = searchEngine.search('Betnovate Cream');
    assert.ok(results.length > 0, 'Must find Betnovate Cream');

    const betnovate = results[0];
    assert.strictEqual(betnovate.dosage_form, 'Cream');
    assert.strictEqual(betnovate.pack_unit, 'tube');

    const altsResult = searchEngine.getAlternatives(betnovate);
    assert.ok(altsResult.alternatives.length >= 2);

    const cheapest = altsResult.cheapestAlternative;
    assert.ok(cheapest.is_cheaper);
    assert.ok(cheapest.brand_name.includes('Cortival') || cheapest.brand_name.includes('Betaval'));
    assert.ok(cheapest.percent_savings >= 30);
  });

  await t.test('Topical Fusidic Acid Cream finds alternatives', () => {
    const fucidin = searchEngine.getById('fucidin-2-cream');
    assert.ok(fucidin, 'Must find Fucidin Cream');

    const altsResult = searchEngine.getAlternatives(fucidin);
    assert.ok(altsResult.alternatives.length >= 2);

    const hasFuson = altsResult.alternatives.some(a => a.brand_name.includes('Fuson'));
    assert.ok(hasFuson, 'Fuson Cream should be an alternative');

    const cheapest = altsResult.cheapestAlternative;
    assert.ok(cheapest.is_cheaper);
    assert.ok(cheapest.percent_savings >= 35);
  });

  await t.test('Category definitions include Skin & Ointments and Kids & Syrups', () => {
    const categories = searchEngine.getCategories();
    const skinCat = categories.find(c => c.id === 'skin');
    const pedCat = categories.find(c => c.id === 'pediatric');

    assert.ok(skinCat, 'Skin & Ointments category must exist');
    assert.ok(skinCat.count > 0, `Skin category count should be > 0, got ${skinCat.count}`);

    assert.ok(pedCat, 'Kids & Syrups category must exist');
    assert.ok(pedCat.count > 0, `Pediatric category count should be > 0, got ${pedCat.count}`);
  });
});
