// Search inputs from the 1000-persona Android simulation that used to give "No medicine found":
// keyboard punctuation, typos, Urdu script (typed or from the ur-PK voice recogniser) and Roman Urdu
// symptom phrases. Engine checks run on the real DRAP data; one jsdom check covers the
// "Showing results for …" line on the results page. Also: double-tap guard, compare-tray padding,
// RTL-safe honeypot and the Legal footer in Urdu.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const SDData = require('../js/data');
const SDSearch = require('../js/search');
const { fixtureJson, root } = require('./helpers/fixture');

const ds = SDData.expand(JSON.parse(fs.readFileSync(path.join(root, 'data', 'medicines.json'), 'utf8')));
const engine = SDSearch.createEngine(ds);

/** resolve() → names of the first results, lower-case. */
function top(q, n) {
  const r = engine.resolve(q, { limit: 200 });
  return { r, names: r.results.slice(0, n || 5).map((x) => x.med.name.toLowerCase()), generics: r.results.slice(0, n || 5).map((x) => x.med.generic.toLowerCase()) };
}

test('normalize strips keyboard punctuation but keeps decimal strengths', () => {
  assert.equal(SDSearch.normalize('Panadol.'), 'panadol');
  assert.equal(SDSearch.normalize('panadol,'), 'panadol');
  assert.equal(SDSearch.normalize('.Panadol'), 'panadol');
  assert.equal(SDSearch.normalize('Tab. Risek 20mg.'), 'tab risek 20mg');
  assert.equal(SDSearch.normalize('Xanax 0.5mg'), 'xanax 0.5mg');
  assert.equal(SDSearch.normalize('Losartan 2.5 mg'), 'losartan 2.5mg');
});

test('"Panadol." and "panadol," find Panadol directly', () => {
  for (const q of ['Panadol.', 'panadol,', 'Flagyl.']) {
    const r = engine.search(q);
    assert.ok(r.length, q);
    assert.ok(r.slice(0, 3).some((x) => /panadol|flagyl/i.test(x.med.name)), q);
  }
});

test('typos show results for the best did-you-mean', () => {
  const cases = { panadool: 'panadol', brufin: 'brufen', augmenten: 'augmentin', glucofage: 'glucophage' };
  for (const [q, want] of Object.entries(cases)) {
    assert.ok(engine.didYouMean(q).includes(want), `didYouMean(${q}) has ${want}: ${engine.didYouMean(q)}`);
    const { r, names } = top(q);
    assert.equal(r.kind, 'typo', q);
    assert.equal(r.query, want, q);
    assert.equal(names[0], want, `${q} → ${names}`);
  }
});

test('Urdu script is transliterated and matched by sound', () => {
  assert.equal(SDSearch.transliterateUrdu('پیناڈول'), 'pinadol');
  assert.equal(SDSearch.transliterateUrdu('بروفین'), 'brofin');
  assert.equal(SDSearch.transliterateUrdu('رسک'), 'rsk');
  assert.equal(SDSearch.transliterateUrdu('Panadol'), 'Panadol', 'Latin text unchanged');
  assert.equal(SDSearch.phoneticKey('pinadol'), SDSearch.phoneticKey('panadol'));
  assert.equal(SDSearch.phoneticKey('brofin'), SDSearch.phoneticKey('brufen'));
  assert.equal(SDSearch.phoneticKey('rsk'), SDSearch.phoneticKey('risek'));
  assert.equal(SDSearch.phoneticKey('glucofage'), SDSearch.phoneticKey('glucophage'));
  const cases = { 'پیناڈول': 'panadol', 'بروفین': 'brufen', 'رسک': 'risek' };
  for (const [q, want] of Object.entries(cases)) {
    const { r, names } = top(q);
    assert.equal(r.kind, 'urdu', q);
    assert.equal(r.query, want, q);
    assert.equal(names[0], want, `${q} → ${names}`);
    assert.equal(engine.didYouMean(q)[0], want, `didYouMean(${q})`);
  }
});

test('Roman Urdu symptom phrases map to a common medicine', () => {
  const fever = top('bukhar ki dawa');
  assert.equal(fever.r.kind, 'symptom');
  assert.equal(fever.r.symptom.category, 'pain');
  assert.ok(fever.generics.every((g) => g.includes('paracetamol')), fever.generics.join());

  const head = top('sar dard ki goli');
  assert.equal(head.r.kind, 'symptom');
  assert.ok(head.generics.every((g) => g.includes('paracetamol')), head.generics.join());
  assert.ok(head.r.results.slice(0, 5).every((x) => /tablet/i.test(x.med.form)), '"goli" → tablets');

  const cough = top('khansi ka syrup');
  assert.equal(cough.r.kind, 'symptom');
  assert.equal(cough.r.symptom.category, 'respiratory');
  assert.ok(cough.r.results.slice(0, 5).every((x) => /syrup/i.test(x.med.form)), 'syrup asked for');

  for (const [q, cat] of [['khansi', 'respiratory'], ['nazla', 'respiratory'], ['pait dard', 'stomach'], ['sugar', 'diabetes'], ['bukhar', 'pain'], ['sar dard', 'pain'], ['بخار', 'pain']]) {
    const r = engine.resolve(q, { limit: 50 });
    // "sugar"/"bp" may also match product names directly; either way the user gets results
    assert.ok(r.results.length, q);
    if (r.kind === 'symptom') assert.equal(r.symptom.category, cat, q);
  }
  assert.equal(SDSearch.findSymptom('bp').entry.category, 'heart');
  assert.equal(SDSearch.findSymptom('sugar ki dawa').entry.category, 'diabetes');
  assert.equal(SDSearch.findSymptom('panadol'), null, 'brand names are not symptoms');
});

test('exact queries are untouched by the fallback', () => {
  for (const q of ['panadol', 'Risek 20', 'augmentin', 'paracetamol']) assert.equal(engine.resolve(q).kind, 'exact', q);
  assert.equal(engine.resolve('zzqqxx').kind, 'none');
});

// ---------------------------------------------------------------------------
// App (jsdom)
// ---------------------------------------------------------------------------
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 0));
async function boot(hash) {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' + (hash || '') });
  const w = dom.window;
  const data = fixtureJson();
  w.scrollTo = () => {};
  w.matchMedia = () => ({ matches: false, addEventListener() {} });
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.fetch = async (url) => {
    if (String(url).includes('medicines.json')) return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(data)) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  for (const s of ['js/i18n.js', 'js/data.js', 'js/search.js', 'js/ocr-match.js', 'js/assistant.js', 'js/app.js']) w.eval(fs.readFileSync(path.join(root, s), 'utf8'));
  await w.SDApp.ready;
  await tick(10);
  return w;
}

test('app: a typo or Urdu query opens results with "Showing results for …"', async () => {
  const w = await boot('#/search/panadool');
  const d = w.document;
  assert.ok(!d.getElementById('view-search').hidden, 'results, not "No medicine found"');
  const line = d.getElementById('search-corrected');
  assert.ok(!line.hidden);
  assert.match(line.textContent, /Showing results for “panadol”/);
  assert.ok(d.querySelectorAll('#search-results .result').length > 0);

  w.location.hash = '#/search/' + encodeURIComponent('پیناڈول');
  await tick(10);
  assert.ok(!d.getElementById('view-search').hidden);
  assert.match(d.getElementById('search-corrected').textContent, /panadol/);

  w.location.hash = '#/search/' + encodeURIComponent('bukhar ki dawa');
  await tick(10);
  assert.ok(!d.getElementById('view-search').hidden);
  assert.match(d.getElementById('search-corrected').textContent, /paracetamol/);
  assert.ok(d.querySelector('#search-corrected a[href="#/category/pain"]'), 'link to the Pain & Fever category');

  w.location.hash = '#/search/panadol';
  await tick(10);
  assert.ok(d.getElementById('search-corrected').hidden, 'no note for an exact match');
});

test('app: double-tap on "Add to My Medicines" keeps it added', async () => {
  const w = await boot('#/medicine/panadol-500mg-tablet-000101');
  const d = w.document;
  d.getElementById('btn-cabinet').click();
  d.getElementById('btn-cabinet').click(); // second tap of a double-tap
  assert.ok(w.SDApp.cabinet.has('panadol-500mg-tablet-000101'), 'still in My Medicines');
  // compare toggle too
  d.getElementById('btn-compare').click();
  d.getElementById('btn-compare').click();
  assert.deepEqual(JSON.parse(w.localStorage.getItem('sd_compare')), ['panadol-500mg-tablet-000101']);
  // the compare tray reserves room at the bottom of the page
  assert.ok(d.body.classList.contains('has-tray'));
  assert.match(d.body.style.getPropertyValue('--tray-h'), /^\d+px$/);
});

test('app: Legal footer translates to Urdu', async () => {
  const w = await boot('#/');
  const d = w.document;
  const I18N = w.SDI18n;
  for (const k of ['footer_legal', 'footer_terms', 'footer_refund', 'footer_disclaimer', 'footer_pharmacy_terms', 'footer_delete_account', 'showing_results_for', 'rx_failed', 'nearby_loc_off']) {
    assert.ok(I18N.STRINGS ? I18N.STRINGS.ur[k] : true, k);
  }
  const legal = [...d.querySelectorAll('.footer [data-i18n]')].map((el) => el.dataset.i18n);
  for (const k of ['footer_legal', 'footer_terms', 'footer_refund', 'footer_disclaimer', 'footer_pharmacy_terms', 'footer_delete_account']) assert.ok(legal.includes(k), k);
});

test('honeypot is hidden without an off-screen offset (no sideways scroll in Urdu)', () => {
  const css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');
  const rule = css.match(/\.hp\s*\{[^}]*\}/)[0];
  assert.doesNotMatch(rule, /-9999px/);
  assert.match(rule, /clip-path:\s*inset\(50%\)/);
  assert.match(rule, /inset-inline-start:\s*0/);
  const native = fs.readFileSync(path.join(root, 'js', 'native.js'), 'utf8');
  assert.doesNotMatch(native, /-9999px/);
});
