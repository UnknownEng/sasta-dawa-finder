const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { validateAndSync, normalizeSlug } = require('../scripts/sync_drug_data.js');

test('DRAP & Drug Data Ingestion Pipeline Suite', async (t) => {
  await t.test('normalizeSlug creates clean URL/ID friendly strings', () => {
    assert.strictEqual(normalizeSlug('Panadol 500mg Tablet'), 'panadol-500mg-tablet');
    assert.strictEqual(normalizeSlug('Co-Amoxiclav 156.25mg/5ml'), 'co-amoxiclav-15625mg5ml');
  });

  await t.test('validateAndSync validates schema, generates statistics, and syncs embed bundle', () => {
    const result = validateAndSync();

    assert.strictEqual(result.status, 'SUCCESS');
    assert.ok(result.totalMedicines >= 300, `Expected >= 300 medicines, got ${result.totalMedicines}`);
    assert.ok(result.totalSaltGroups >= 80, `Expected >= 80 salt groups, got ${result.totalSaltGroups}`);
    assert.ok(result.totalCategories >= 20);

    const embedPath = path.join(__dirname, '../js/medicines_data_embed.js');
    const embedContent = fs.readFileSync(embedPath, 'utf8');
    assert.ok(embedContent.includes('window.__EMBEDDED_MEDICINES_DATA__'));
    assert.ok(embedContent.includes('window.__EMBEDDED_MEDICINES__'));
    assert.ok(embedContent.includes('panadol-500mg-tablet'));
  });

  await t.test('validateAndSync detects duplicate IDs and rejects bad data', () => {
    const invalidBatch = [
      {
        id: 'dup-1',
        brand_name: 'Med A',
        generic_name: 'Salt A',
        strength: '10mg',
        dosage_form: 'Tablet',
        salt_group_id: 'salt-a-10mg-tablet',
        pack_size: 10,
        pack_price_pkr: 100,
        manufacturer: 'Pharma A',
      },
      {
        id: 'dup-1', // Duplicate ID
        brand_name: 'Med B',
        generic_name: 'Salt A',
        strength: '10mg',
        dosage_form: 'Tablet',
        salt_group_id: 'salt-a-10mg-tablet',
        pack_size: 10,
        pack_price_pkr: 80,
        manufacturer: 'Pharma B',
      },
    ];

    assert.throws(
      () => validateAndSync(invalidBatch),
      /Duplicate medicine ID found/
    );
  });

  await t.test('validateAndSync detects negative/invalid prices', () => {
    const invalidBatch = [
      {
        id: 'neg-1',
        brand_name: 'Med A',
        generic_name: 'Salt A',
        strength: '10mg',
        dosage_form: 'Tablet',
        salt_group_id: 'salt-a-10mg-tablet',
        pack_size: 10,
        pack_price_pkr: -50, // Invalid negative price
        manufacturer: 'Pharma A',
      },
    ];

    assert.throws(
      () => validateAndSync(invalidBatch),
      /Invalid pack_price_pkr/
    );
  });
});
