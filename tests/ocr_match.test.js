// Matching medicine names in text read from a photo (js/ocr-match.js, on-device OCR path).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { fixtureEngine } = require('./helpers/fixture');
const SDSearch = require('../js/search');
const SDData = require('../js/data');
const OCR = require('../js/ocr-match');

const { ds, engine } = fixtureEngine();
const ctx = { ds, engine, normalize: SDSearch.normalize, editDistance: SDSearch.editDistance };
const names = (text, c) => OCR.match(text, c || ctx).map((r) => r.med.name);

test('clean prescription: every medicine, in reading order', () => {
  const r = OCR.match('Tab. Panadol 500mg 1+1+1\nAugmentin 625mg BD\nRisek 20mg OD', ctx);
  assert.deepEqual(r.map((x) => x.med.name), ['Panadol', 'Augmentin', 'Risek']);
  assert.equal(r[0].med.strength, '500mg');
  assert.equal(r[2].med.strength, '20mg');
  assert.ok(r.every((x) => x.exact));
});

test('messy OCR: look-alike digits, split strengths, capitals', () => {
  const r = OCR.match('Panad0l 500 mg\nAUGMENTIN 625', ctx);
  assert.deepEqual(r.map((x) => x.med.name), ['Panadol', 'Augmentin']);
  assert.equal(r[0].med.strength, '500mg');
});

test('a strength on the same line picks the matching product', () => {
  assert.equal(OCR.match('Risek 40mg', ctx)[0].med.strength, '40mg');
  assert.equal(OCR.match('Risek 20mg', ctx)[0].med.strength, '20mg');
});

test('two-word brand names win over the first word', () => {
  assert.deepEqual(names('Panadol Extra tablets'), ['Panadol Extra']);
});

test('one-letter OCR slip in a long name is forgiven, with a strength', () => {
  assert.deepEqual(names('Tab Glucophaqe 500mg'), ['Glucophage']);
  assert.deepEqual(names('Augmentn 625mg'), ['Augmentin']);
});

test('noise lines give nothing', () => {
  for (const s of [
    'Dr. Ahmed MBBS Clinic Road',
    'Cell 0300-1234567  Date 12/11/2026',
    'Name: Fatima Bibi  Age 54 years\nAdvice: plenty of fluids, rest for 3 days\nFollow up after one week',
    '',
  ]) assert.deepEqual(names(s), [], s);
});

test('noise around real names does not add false positives', () => {
  const text = 'Dr. Ahmed MBBS Clinic Road\nRx\nTab. Panadol 500mg 1+1+1\nCap. Risek 20mg OD\nSignature';
  assert.deepEqual(names(text), ['Panadol', 'Risek']);
});

test('deduplicates by brand and caps the list', () => {
  assert.deepEqual(names('Panadol 500mg\nPanadol 500mg\nPANADOL'), ['Panadol']);
  const many = Array.from({ length: 30 }, () => 'Panadol 500mg\nRisek 20mg\nBrufen 400mg\nCalpol 500mg').join('\n');
  assert.ok(OCR.match(many, ctx).length <= OCR.MAX_RESULTS);
});

test('bad input never throws', () => {
  assert.deepEqual(OCR.match(null, ctx), []);
  assert.deepEqual(OCR.match('Panadol', {}), []);
  assert.deepEqual(OCR.match('<script>alert(1)</script> ||| ~~~ 000', ctx), []);
});

test('parseLine reads strengths and words', () => {
  const p = OCR.parseLine('Tab. Panad0l 500 mg 1+1+1');
  assert.deepEqual(p.words.map((w) => w.w), ['tab', 'panadol']);
  assert.deepEqual(p.nums, [500]);
  assert.deepEqual(OCR.parseLine('Augmentin625').words.map((w) => w.w), ['augmentin']);
  assert.deepEqual(OCR.parseLine('Augmentin625').nums, [625]);
  // letters read for digits in a dose (seen in the real browser run): "Glucophage SOO mg"
  assert.deepEqual(OCR.parseLine('Glucophage SOO mg BD').nums, [500]);
  assert.deepEqual(OCR.parseLine('Risek 2O mg').nums, [20]);
  // phone numbers and dates are not doses
  assert.deepEqual(OCR.parseLine('Cell 0300-1234567 Date 12/11/2026').nums, [12, 11]);
});

test('a salt name alone is kept (flagged generic) only when no brand was read', () => {
  const r = OCR.match('Paracetamol 500mg\n20 Tablets', ctxReal());
  assert.ok(r.length >= 1 && r.every((x) => x.generic));
  assert.ok(OCR.match('Panadol\nParacetamol 500mg', ctxReal()).every((x) => !x.generic));
});

let realCtx = null;
function ctxReal() {
  if (!realCtx) {
    const full = SDData.expand(require(path.join(__dirname, '..', 'data', 'medicines.json')));
    realCtx = { ds: full, engine: SDSearch.createEngine(full), normalize: SDSearch.normalize, editDistance: SDSearch.editDistance };
  }
  return realCtx;
}

test('real dataset: prescription + pack text, no noise matches', () => {
  const full = SDData.expand(require(path.join(__dirname, '..', 'data', 'medicines.json')));
  const c = { ds: full, engine: SDSearch.createEngine(full), normalize: SDSearch.normalize, editDistance: SDSearch.editDistance };
  assert.deepEqual(names('Tab. Panadol 500mg 1+1+1\nAugmentin 625mg BD\nRisek 20mg OD', c), ['Panadol', 'Augmentin', 'Risek']);
  assert.deepEqual(names('Panad0l 500 mg\nAUGMENTIN 625', c), ['Panadol', 'Augmentin']);
  // a pack: the salt name under the brand is not listed separately
  assert.deepEqual(names('Panadol\nParacetamol 500mg\nGSK Pakistan Limited\n20 tablets', c), ['Panadol']);
  for (const s of [
    'Dr. Ahmed MBBS Clinic Road',
    'Dr Muhammad Ali Khan FCPS Consultant Physician\nCity Hospital Lahore\nDiagnosis: Fever, cough',
    'The quick brown fox jumps over the lazy dog\nMeeting at seven tomorrow evening',
  ]) assert.deepEqual(names(s, c), [], s);
});
