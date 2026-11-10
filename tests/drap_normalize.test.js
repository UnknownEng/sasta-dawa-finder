const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../scripts/drap_normalize');

test('composition parsing', async (t) => {
  await t.test('strips "Each tablet contains", dot leaders and pharmacopoeia tags', () => {
    const ing = N.parseComposition('Each tablet contains:Levofloxacin hemihydrate eq. to Levofloxacin ………. 500 mg', 'Spectrix 500mg Tablet');
    assert.deepEqual(ing.map((i) => [i.name, N.formatAmount(i.amount)]), [['levofloxacin', '500mg']]);
  });

  await t.test('keeps both ingredients of a combination with "eq. to"', () => {
    const ing = N.parseComposition('Each Vial Contains:-Pipracillin Sodium (USP) eq. toPipracillin…4.000gmTazobactam Sodium (USP) eq. toTazobactum…0.500gm', 'Talzon 4.5gm Inj.');
    assert.deepEqual(ing.map((i) => [i.name, N.formatAmount(i.amount)]), [['piperacillin', '4g'], ['tazobactam', '500mg']]);
  });

  await t.test('normalizes spelling variants and salts', () => {
    assert.equal(N.normalizeIngredientName('Amoxycillin (as trihydrate)'), 'amoxicillin');
    assert.equal(N.normalizeIngredientName('Metformin HCl'), 'metformin');
    assert.equal(N.normalizeIngredientName('Magnesium Sulphate'), 'magnesium sulfate');
    assert.equal(N.normalizeIngredientName('Betamethasone valerate'), 'betamethasone valerate');
    assert.equal(N.normalizeIngredientName('Acetaminophen'), 'paracetamol');
  });

  await t.test('per-volume strengths for liquids', () => {
    const ing = N.parseComposition('Each 5ml contains: Paracetamol 120mg', 'Panadol Suspension');
    assert.equal(ing[0].per, '/5ml');
  });

  await t.test('falls back to product name for strength', () => {
    const ing = N.parseComposition('Ceftazidime (as pentahydrate)', 'Valozid 250mg Injection');
    assert.equal(ing[0].name, 'ceftazidime');
    assert.equal(N.formatAmount(ing[0].amount), '250mg');
  });

  await t.test('unit conversion', () => {
    assert.deepEqual(N.canonicalAmount('1', 'gm'), { value: 1000, unit: 'mg' });
    assert.deepEqual(N.canonicalAmount('50', 'µg'), { value: 50, unit: 'mcg' });
    assert.equal(N.formatAmount(N.canonicalAmount('1.2', 'g')), '1200mg');
  });
});

test('dosage forms', () => {
  assert.equal(N.detectForm('Risek 20mg Capsule', '', '14s').form, 'Capsule');
  assert.equal(N.detectForm('Ceftrax 1g Injection IV', '', '1 vial').form, 'Injection');
  assert.equal(N.detectForm('Panadol Suspension 120mg/5ml', '', '60ml').form, 'Suspension');
  assert.equal(N.detectForm('Betnovate Cream', '', '15g').form, 'Cream');
  assert.equal(N.detectForm('Glucophage XR 500mg Tablet', '', '').release, 'MR');
  assert.equal(N.detectForm('OD-Cef Injection 500 mg', '', '').release, '', 'MR only applies to oral tablets/capsules');
});

test('pack parsing', () => {
  assert.equal(N.parsePack("20x10's", 'Tablet').units, 200);
  assert.equal(N.parsePack("1 x 10's", 'Tablet').units, 10);
  assert.equal(N.parsePack("100's", 'Tablet').units, 100);
  assert.equal(N.parsePack('(1X50)Vial', 'Injection').units, 50);
  const syrup = N.parsePack('60ml', 'Suspension');
  assert.equal(syrup.unit, 'ml');
  assert.equal(syrup.units, 60);
  const cream = N.parsePack('15g', 'Cream');
  assert.equal(cream.unit, 'g');
  assert.equal(N.parsePack('', 'Tablet').unit, 'pack');
});

test('names, dates, prices, categories', () => {
  assert.equal(N.shortBrandName('Claritek Tablets 500mg'), 'Claritek');
  assert.equal(N.shortBrandName('*Avazin 10mg Tablet'), 'Avazin');
  assert.equal(N.shortBrandName('ZATRON 500mg INJECTION IM/IV'), 'Zatron');
  assert.equal(N.shortBrandName('Panadol Extra Tablet'), 'Panadol Extra');
  assert.equal(N.parseEffectiveDate('23 Jul, 2026'), '2026-07-23');
  assert.equal(N.parsePrice('1,354,005.54'), 1354005.54);
  assert.equal(N.categorize(['omeprazole'], 'Capsule'), 'stomach');
  assert.equal(N.categorize(['amoxicillin', 'clavulanic acid'], 'Tablet'), 'antibiotics');
  assert.equal(N.categorize(['clotrimazole'], 'Cream'), 'skin');
  assert.equal(N.categorize(['metformin'], 'Tablet'), 'diabetes');
});

test('normalizeRecord builds conservative alternative groups', () => {
  const a = N.normalizeRecord({ product: 'Panadol 500mg Tablet', composition: 'Paracetamol 500mg', reg: '1', manufacturer: 'GSK', pack: "20x10's", price: '1,050', effective: '23 Jul, 2026' });
  const b = N.normalizeRecord({ product: 'Febrol 500mg Tab', composition: 'Each tablet contains:Paracetamol (USP)……500mg', reg: '2', manufacturer: 'Sami', pack: "100's", price: '260', effective: '01 Aug, 2026' });
  const xr = N.normalizeRecord({ product: 'Glucophage XR 500mg Tablet', composition: 'Metformin 500mg', reg: '3', manufacturer: 'Merck', pack: "30's", price: '400', effective: '' });
  const ir = N.normalizeRecord({ product: 'Glucophage 500mg Tablet', composition: 'Metformin 500mg', reg: '4', manufacturer: 'Merck', pack: "50's", price: '250', effective: '' });
  assert.equal(a.group, b.group);
  assert.equal(a.unit_price, 5.25);
  assert.notEqual(xr.group, ir.group, 'extended-release must not be grouped with immediate-release');
  assert.equal(N.normalizeRecord({ product: 'X', composition: '', price: 'N/A' }), null);
});

// Real DRAP strings that used to produce doubled names ("Loratadine Loratadine"), 2026-11-10 review.
test('no doubled ingredient names from titles, salt forms or misspellings', async (t) => {
  const names = (comp, product) => N.parseComposition(comp, product || '').map((i) => [i.name, i.amount ? N.formatAmount(i.amount) : null]);
  await t.test('title glued to "Each tablet contains"', () => {
    assert.deepEqual(names('LoratadineEach tablet contains:Loratadine….10mg'), [['loratadine', '10mg']]);
    assert.deepEqual(names('LevetiracetamEach film coated tablet containsLevetiracetam………….1000mg'), [['levetiracetam', '1g']]);
  });
  await t.test('combination title with salt + "eq." keeps both ingredients once', () => {
    assert.deepEqual(names('Telmisartan + Amlodipine BesylateEach uncoated bi-layered Tablet contains:Telmisartan…..40mgAmlodipine Besylate eq. Amlodipine……10mg'), [['telmisartan', '40mg'], ['amlodipine', '10mg']]);
    assert.deepEqual(names('Piperacillin + TazobactamEach vial contains:Piperacillin as sodium…..2gTazobactam as sodium……0.25g'), [['piperacillin', '2g'], ['tazobactam', '250mg']]);
  });
  await t.test('salt form written out, and misspelt "Equalent to"', () => {
    assert.deepEqual(names('Each vial contains:Ceftazidime Pentahydrate Ceftazidime ……….250mg'), [['ceftazidime', '250mg']]);
    assert.deepEqual(names('Each Vial contains: Sterile pipracillin sodium Equalent to pipracillin ………..4.0gm Sterile Tazobactam Sodium eq to Tazobactam …….500mg'), [['piperacillin', '4g'], ['tazobactam', '500mg']]);
  });
  await t.test('a title with its own amounts is kept, and "water for injection" survives', () => {
    assert.equal(N.normalizeIngredientName('Water for Injection'), 'water for injection');
    assert.equal(N.normalizeIngredientName('Injection Cefazolin'), 'cefazolin');
  });
});
