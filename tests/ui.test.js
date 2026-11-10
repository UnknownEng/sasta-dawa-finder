const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { fixtureJson, root } = require('./helpers/fixture');

const SCRIPTS = ['js/i18n.js', 'js/data.js', 'js/search.js', 'js/assistant.js', 'js/app.js'];

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
  w.open = (url) => { w.__opened = url; };
  for (const s of SCRIPTS) w.eval(fs.readFileSync(path.join(root, s), 'utf8'));
  await w.SDApp.ready;
  return dom;
}

const visible = (doc, id) => !doc.getElementById(id).hidden;
const nav = async (w, hash) => {
  w.location.hash = hash;
  await new Promise((r) => setTimeout(r, 0));
};

test('home renders categories, savings and data stamp', async () => {
  const { window: w } = await boot();
  const d = w.document;
  assert.ok(visible(d, 'view-home'));
  assert.ok(d.getElementById('loading').hidden);
  assert.ok(d.querySelectorAll('#cat-grid .cat-card').length >= 4);
  assert.ok(d.querySelectorAll('#deal-grid .deal').length >= 1);
  assert.match(d.getElementById('data-stamp').textContent, /DRAP-registered products/);
  assert.ok(d.querySelector('meta[name="viewport"]'));
});

test('autocomplete + keyboard selection opens the medicine page', async () => {
  const { window: w } = await boot();
  const d = w.document;
  const input = d.getElementById('search-input');
  input.value = 'pana';
  input.dispatchEvent(new w.Event('input'));
  await new Promise((r) => setTimeout(r, 100));
  const items = d.querySelectorAll('#suggest li[role="option"]');
  assert.ok(items.length >= 2);
  assert.equal(input.getAttribute('aria-expanded'), 'true');
  input.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowDown' }));
  input.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter' }));
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(visible(d, 'view-medicine'));
  assert.match(d.querySelector('.mh-name').textContent, /Panadol/);
});

test('medicine page shows formula, savings and sorted alternatives', async () => {
  const { window: w } = await boot('#/medicine/panadol-500mg-tablet-000101');
  const d = w.document;
  assert.ok(visible(d, 'view-medicine'));
  assert.match(d.querySelector('.mh-formula').textContent, /Paracetamol — 500mg/);
  assert.match(d.querySelector('#med-hero .savings').textContent, /Febrol/);
  const alts = [...d.querySelectorAll('#alt-list .alt')];
  assert.equal(alts.length, 3);
  assert.match(alts[0].textContent, /Febrol/);
  assert.match(alts[0].textContent, /Cheapest/);
  assert.ok(alts.some((a) => a.classList.contains('current')));
});

test('narrow-therapeutic medicines show a switch warning', async () => {
  const { window: w } = await boot('#/medicine/euthyrox-50mcg-tablet-000702');
  assert.match(w.document.getElementById('med-savings').textContent, /doctor/);
});

test('My Medicines: add, monthly cost, switch to cheapest', async () => {
  const { window: w } = await boot('#/medicine/panadol-500mg-tablet-000101');
  const d = w.document;
  d.getElementById('btn-cabinet').click();
  assert.equal(d.getElementById('cabinet-count').textContent, '1');
  await nav(w, '#/my-medicines');
  assert.ok(visible(d, 'view-cabinet'));
  const stats = [...d.querySelectorAll('.stat b')].map((b) => b.textContent);
  assert.deepEqual(stats, ['Rs 158', 'Rs 78.00', 'Rs 79.50']); // 5.25*30, 2.60*30
  d.querySelector('[data-act="inc"]').click();
  assert.equal(d.querySelector('.cab-item input').value, '1.5');
  d.querySelector('[data-act="switch"]').click();
  assert.match(d.querySelector('.cab-name').textContent, /Febrol/);
  assert.ok(!d.querySelector('[data-act="switch"]'));
});

test('search results, not-found with suggestions', async () => {
  const { window: w } = await boot('#/search/omeprazole');
  const d = w.document;
  assert.ok(visible(d, 'view-search'));
  assert.ok(d.querySelectorAll('#search-results .result').length >= 3);
  await nav(w, '#/search/panadool');
  assert.ok(visible(d, 'view-empty'));
  assert.match(d.getElementById('empty-suggest').textContent, /panadol/);
});

test('category page lists formulas and filters', async () => {
  const { window: w } = await boot('#/category/pain');
  const d = w.document;
  assert.ok(visible(d, 'view-category'));
  const before = d.querySelectorAll('#category-list .group-row').length;
  assert.ok(before >= 2);
  const f = d.getElementById('category-filter');
  f.value = 'ibuprofen';
  f.dispatchEvent(new w.Event('input'));
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(d.querySelectorAll('#category-list .group-row').length, 1);
});

test('Urdu mode switches direction and text', async () => {
  const { window: w } = await boot();
  const d = w.document;
  d.querySelector('[data-lang="ur"]').click();
  assert.equal(d.documentElement.getAttribute('dir'), 'rtl');
  assert.equal(d.documentElement.getAttribute('lang'), 'ur');
  assert.match(d.getElementById('hero-title').textContent, /دوا/);
  d.querySelector('[data-lang="en"]').click();
  assert.equal(d.documentElement.getAttribute('dir'), 'ltr');
});

test('assistant answers offline and renders medicine cards', async () => {
  const { window: w } = await boot();
  const d = w.document;
  d.getElementById('assistant-fab').click();
  assert.ok(visible(d, 'assistant'));
  await w.SDAssistantUI.send('panadol ka sasta option');
  const last = [...d.querySelectorAll('#assistant-log .msg.bot')].pop();
  assert.match(last.textContent, /Febrol/);
  assert.ok(last.querySelectorAll('.mcard').length >= 2);
  assert.match(d.getElementById('assistant-mode').textContent, /offline/i);
});

test('untrusted text from the data is escaped', async () => {
  const { window: w } = await boot('#/search/loratadine');
  const d = w.document;
  assert.equal(d.querySelectorAll('#search-results img').length, 0);
  const link = d.querySelector('#search-results a[href*="onerror"]');
  await nav(w, link.getAttribute('href'));
  assert.equal(d.querySelectorAll('#view-medicine img, #view-medicine b b').length, 0);
  assert.match(d.querySelector('.mh-product').innerHTML, /onerror=alert\(1\)&gt;/);
  assert.match(d.querySelector('.mh-facts').innerHTML, /Bad &lt;b&gt;Actor&lt;\/b&gt;/);
});
