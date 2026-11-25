const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../scripts/sync_registry');
const SDData = require('../js/data');
const SDSearch = require('../js/search');
const { fixtureJson } = require('./helpers/fixture');

// Shapes copied from real eapp.dra.gov.pk/productView.php responses (Nov 2026)
const LISTS = {
  metformin: [
    { registrationNo: '000401', approvedName: 'Glucophage 500mg Tablets', genericName: 'Metformin HCl', companyName: 'Martin Dow' },
    { registrationNo: '120001', approvedName: '  Metfo-X 500mg Tablet', genericName: 'Metformin Hydrochloride, <br>Sitagliptin', companyName: 'X Pharma' },
    { registrationNo: '120002', approvedName: 'Diabex 500mg Tablet', genericName: 'Metformin Hydrochloride', companyName: 'Y Pharma' },
    { registrationNo: '120004', approvedName: 'Sitamet 50/1000 Tablet', genericName: 'Sitagliptin (as phosphate), <br>Metformin HCl', companyName: 'Z Pharma' },
  ],
  sitagliptin: [
    { registrationNo: '120001', approvedName: 'Metfo-X 500mg Tablet', genericName: 'Metformin Hydrochloride, <br>Sitagliptin', companyName: 'X Pharma' },
    { registrationNo: '120003', approvedName: 'Januvia 100mg Tablet', genericName: 'Sitagliptin (as phosphate monohydrate)', companyName: 'MSD' },
  ],
};

function fakeIo(calls) {
  return {
    postJson: async (p) => { calls.push(p); return LISTS[p.masterID] || []; },
    getJson: async (p) => { calls.push(p); return { results: [{ id: '120003', text: 'Januvia 100mg Tablet' }, { id: '130009', text: 'Valtec 80mg Tablets' }] }; },
    postText: async (p) => {
      calls.push(p);
      if (p.webRegNo !== '130009') return '';
      return '<div class="row"><div class="label">Product Name</div><div class="value">Valtec 80mg Tablets</div></div>' +
        '<div class="row"><div class="label">Company Name</div><div class="value">TABROS PHARMA (PVT). LTD.</div></div>' +
        '<div class="row"><div class="label">Used For</div><div class="value">Human</div></div>' +
        '<div class="row"><div class="label">Dosage Form</div><div class="value">Film-coated tablet</div></div>' +
        '<div class="row"><div class="label">Composition</div><div class="value">Valsartan ...... 80 mg</div></div>';
    },
    sleep: async () => {},
    log: () => {},
  };
}

test('splits registry compositions into clean ingredient names', () => {
  assert.deepEqual(R.splitComposition('Amlodipine as Besylate, <br>Valsartan'), ['amlodipine', 'valsartan']);
  assert.deepEqual(R.splitComposition('Amlodipine besylate eq to amlodipine, <br>Hydrochlorothiazide, <br>Valsartan'), ['amlodipine', 'hydrochlorothiazide', 'valsartan']);
  assert.deepEqual(R.splitComposition('Amoxicillin (as trihydrate), <br>Clavulanic Acid (as potassium clavulanate)'), ['amoxicillin', 'clavulanic acid']);
  assert.deepEqual(R.splitComposition('Amlodipine as besylate .....10mg and Valsartan ......160mg'), ['amlodipine', 'valsartan']);
  assert.deepEqual(R.splitComposition('Valsartan ...... 80 mg'), ['valsartan']);
  assert.deepEqual(R.splitComposition(''), []);
});

test('search terms are core ingredient words', () => {
  assert.equal(R.termOf('Clavulanic Acid'), 'clavulanic');
  assert.equal(R.termOf('Metformin Hydrochloride'), 'metformin');
  assert.equal(R.termOf('Tablet'), '');
  const seeds = R.seedTerms(fixtureJson());
  ['paracetamol', 'metformin', 'omeprazole', 'clavulanic'].forEach((t) => assert.ok(seeds.includes(t), t));
});

test('reads the detail card', () => {
  const d = R.parseDetailHtml('<table><tr><td>Product Name</td><td>Starcox Tablets 60mg</td></tr><tr><td>Composition</td><td>Etoricoxib ...... 60 mg</td></tr><tr><td>Used For</td><td>Human</td></tr></table>');
  assert.equal(d.product, 'Starcox Tablets 60mg');
  assert.equal(d.composition, 'Etoricoxib ...... 60 mg');
  assert.equal(d.usedFor, 'Human');
});

test('crawl follows new ingredients and fills gaps from the brand sweep', async () => {
  const calls = [];
  const raw = await R.crawlRegistry(fakeIo(calls), { seeds: ['metformin'], delayMs: 0, brandSweep: ['a'] });
  // sitagliptin was discovered from the compositions (seen in two products) and searched too
  assert.ok(calls.some((c) => c.masterID === 'sitagliptin'));
  assert.deepEqual(Object.keys(raw.products).sort(), ['000401', '120001', '120002', '120003', '120004', '130009']);
  // 130009 was only in the brand sweep, so its detail card was read
  assert.equal(raw.products['130009'][1], 'Valsartan ...... 80 mg');
  assert.ok(!calls.some((c) => c.webRegNo === '120003'), 'products found by ingredient search need no detail card');
  assert.equal(raw.brandOnly, 0);
});

test('buildRegistry keeps only unpriced brands, with salt keys matching the price list', async () => {
  const raw = await R.crawlRegistry(fakeIo([]), { seeds: ['metformin'], delayMs: 0, brandSweep: ['a'] });
  const { out, stats } = R.buildRegistry(raw, fixtureJson(), new Date('2026-11-25T00:00:00Z'));
  assert.equal(stats.skippedPriced, 1, 'Glucophage 000401 already has a DRAP price');
  const F = {};
  out.fields.forEach((f, i) => (F[f] = i));
  const byName = Object.fromEntries(out.rows.map((r) => [r[F.name] || r[F.product], r]));
  const salt = (r) => out.salts[r[F.salt]]; // [generic, salt_key, has_priced_alternatives]
  assert.ok(!byName.Glucophage);
  assert.deepEqual(salt(byName.Diabex), ['Metformin', 'metformin', 1]);
  assert.equal(byName.Diabex[F.strength], '500mg');
  assert.deepEqual(salt(byName.Valtec), ['Valsartan', 'valsartan', 0]);
  assert.equal(byName.Valtec[F.strength], '80mg');
  assert.equal(out.companies[byName.Valtec[F.company]], 'TABROS PHARMA (PVT). LTD.');
  assert.equal(salt(byName['Metfo-X'])[1], 'metformin-sitagliptin');
  assert.equal(byName['Metfo-X'][F.strength], '', 'no strength guess for combinations');
  assert.equal(new Set(out.salts.map((x) => x.join('|'))).size, out.salts.length, 'each generic + salt pair stored once');
  for (const r of out.rows) assert.equal(r.length, out.fields.length);
});

test('registry search finds unpriced brands and their priced alternatives', async () => {
  const raw = await R.crawlRegistry(fakeIo([]), { seeds: ['metformin'], delayMs: 0, brandSweep: ['a'] });
  const ds = SDData.expand(fixtureJson());
  const registry = SDData.expandRegistry(R.buildRegistry(raw, fixtureJson()).out);
  const idx = SDSearch.createRegistryIndex(registry, ds);

  const hit = idx.search('diabex')[0];
  assert.equal(hit.med.name, 'Diabex');
  assert.equal(hit.med.unpriced, true);
  assert.equal(idx.search('valtec 80')[0].med.reg, '130009');
  assert.deepEqual(idx.search('<script>'), []);
  assert.equal(idx.byReg('130009').name, 'Valtec');

  const alts = idx.pricedAlternatives(hit.med);
  // Glucophage / Neodipar 500mg tablets are exact matches, cheapest first; XR tablet is a different form
  assert.equal(alts[0].med.name, 'Neodipar');
  assert.ok(alts[0].exact);
  assert.ok(alts.some((a) => a.med.name === 'Glucophage' && a.exact));
  assert.equal(idx.pricedAlternatives(idx.byReg('130009')).length, 0, 'no priced valsartan in the fixture');
  // Metfo-X and Sitamet share a salt: each lists the other as an unpriced alternative
  const metfox = idx.search('metfo-x')[0].med;
  assert.deepEqual(idx.unpricedAlternatives(metfox).map((a) => a.med.name), ['Sitamet']);
});

test('expandRegistry tolerates a missing or broken file', () => {
  assert.deepEqual(SDData.expandRegistry(null).items, []);
  assert.equal(SDSearch.createRegistryIndex(SDData.expandRegistry({}), null).search('x').length, 0);
});
