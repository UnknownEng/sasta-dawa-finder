const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('Medicine database schema and integrity tests', async (t) => {
  const dataFilePath = path.join(__dirname, '../data/medicines.json');
  assert.ok(fs.existsSync(dataFilePath), 'medicines.json file must exist');

  const raw = fs.readFileSync(dataFilePath, 'utf8');
  let medicines;
  assert.doesNotThrow(() => {
    medicines = JSON.parse(raw);
  }, 'medicines.json must be valid JSON');

  await t.test('has at least 100 entries', () => {
    assert.ok(medicines.length >= 100, `Expected >= 100 medicines, found ${medicines.length}`);
  });

  await t.test('validates schema and fields for every item', () => {
    const seenIds = new Set();
    medicines.forEach((med, idx) => {
      assert.ok(med.id && typeof med.id === 'string', `Item ${idx} has invalid id`);
      assert.ok(!seenIds.has(med.id), `Duplicate ID found: ${med.id}`);
      seenIds.add(med.id);

      assert.ok(med.brand_name && typeof med.brand_name === 'string', `Item ${med.id} missing brand_name`);
      assert.ok(med.generic_name && typeof med.generic_name === 'string', `Item ${med.id} missing generic_name`);
      assert.ok(med.strength && typeof med.strength === 'string', `Item ${med.id} missing strength`);
      assert.ok(med.dosage_form && typeof med.dosage_form === 'string', `Item ${med.id} missing dosage_form`);
      assert.ok(med.salt_group_id && typeof med.salt_group_id === 'string', `Item ${med.id} missing salt_group_id`);
      assert.ok(typeof med.pack_price_pkr === 'number' && med.pack_price_pkr > 0, `Item ${med.id} invalid pack_price_pkr`);
      assert.ok(typeof med.unit_price_pkr === 'number' && med.unit_price_pkr > 0, `Item ${med.id} invalid unit_price_pkr`);
      assert.ok(med.manufacturer && typeof med.manufacturer === 'string', `Item ${med.id} missing manufacturer`);
      assert.ok(med.category && typeof med.category === 'string', `Item ${med.id} missing category`);
      assert.strictEqual(typeof med.verified, 'boolean', `Item ${med.id} missing boolean verified`);
      assert.strictEqual(typeof med.price_is_estimate, 'boolean', `Item ${med.id} missing boolean price_is_estimate`);
    });
  });

  await t.test('spot-check at least 10 entries for medical & pricing accuracy', () => {
    const spotChecks = [
      { id: 'panadol-500mg-tablet', brand: 'Panadol', generic: 'Paracetamol', strength: '500mg' },
      { id: 'brufen-400mg-tablet', brand: 'Brufen 400', generic: 'Ibuprofen', strength: '400mg' },
      { id: 'risek-20mg-capsule', brand: 'Risek 20', generic: 'Omeprazole', strength: '20mg' },
      { id: 'augmentin-625mg-tablet', brand: 'Augmentin 625', generic: 'Co-Amoxiclav (Amoxicillin + Clavulanic Acid)', strength: '625mg (500mg+125mg)' },
      { id: 'leflox-500mg-tablet', brand: 'Leflox 500', generic: 'Levofloxacin', strength: '500mg' },
      { id: 'flagyl-400mg-tablet', brand: 'Flagyl 400', generic: 'Metronidazole', strength: '400mg' },
      { id: 'softin-10mg-tablet', brand: 'Softin 10', generic: 'Loratadine', strength: '10mg' },
      { id: 'glucophage-500mg-tablet', brand: 'Glucophage 500', generic: 'Metformin HCl', strength: '500mg' },
      { id: 'lipitor-20mg-tablet', brand: 'Lipitor 20', generic: 'Atorvastatin', strength: '20mg' },
      { id: 'concor-5mg-tablet', brand: 'Concor 5', generic: 'Bisoprolol Fumarate', strength: '5mg' },
      { id: 'spiriva-respimat-inhaler', brand: 'Spiriva Respimat', generic: 'Tiotropium Bromide', strength: '2.5mcg/puff' }
    ];

    spotChecks.forEach(check => {
      const found = medicines.find(m => m.id === check.id);
      assert.ok(found, `Expected to find ${check.id}`);
      assert.strictEqual(found.brand_name, check.brand);
      assert.strictEqual(found.generic_name, check.generic);
      assert.strictEqual(found.strength, check.strength);
      assert.ok(found.unit_price_pkr > 0);
    });
  });

  await t.test('has medicines with multiple alternatives AND at least one with zero alternatives', () => {
    const saltCounts = {};
    medicines.forEach(m => {
      saltCounts[m.salt_group_id] = (saltCounts[m.salt_group_id] || 0) + 1;
    });

    const multipleAlts = Object.values(saltCounts).some(count => count > 3);
    const zeroAlts = Object.values(saltCounts).some(count => count === 1);

    assert.ok(multipleAlts, 'Should have multiple salt groups with >3 alternatives');
    assert.ok(zeroAlts, 'Should have at least one salt group with 1 brand (no alternatives) for edge testing');
  });
});
