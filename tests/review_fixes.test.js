// Regression tests for problems found in the pre-launch review (2026-11-10).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const SDData = require('../js/data');
const SDSearch = require('../js/search');
const { fixtureJson, root } = require('./helpers/fixture');

const real = JSON.parse(fs.readFileSync(path.join(root, 'data', 'medicines.json'), 'utf8'));

test('savings never compare different uncounted packs (e.g. 5 ampoules vs 1)', () => {
  const ds = SDData.expand(real);
  const e = SDSearch.createEngine(ds);
  const key = (p) => String(p || '').toLowerCase().replace(/[\s'’`´"]/g, '').replace(/x/g, '*');
  let checked = 0;
  for (const m of ds.items) {
    const s = e.savings(m);
    if (!s) continue;
    assert.equal(s.cheapest.unit, m.unit, `${m.id}: ${m.unit} vs ${s.cheapest.unit}`);
    if (m.unit === 'pack') {
      assert.equal(key(s.cheapest.pack), key(m.pack), `${m.id}: ${m.pack} vs ${s.cheapest.pack}`);
      checked++;
    }
  }
  assert.ok(checked > 10, 'whole-pack comparisons still exist where the pack is identical');
  const ado = ds.items.find((m) => m.name === 'Adosetron' && m.pack === '5*4ml');
  if (ado) {
    const s = e.savings(ado);
    assert.ok(!s || s.percent < 50, 'no false 80% saving against a 1-ampoule pack');
  }
});

test('product ids do not depend on row order (price fixes stay on the right pack)', () => {
  const a = SDData.expand(real);
  const b = SDData.expand({ ...real, rows: [...real.rows].reverse() });
  assert.equal(new Set(a.items.map((m) => m.id)).size, a.items.length, 'ids are unique');
  for (const m of a.items) {
    const o = b.byId.get(m.id);
    assert.ok(o && o.pack === m.pack && o.price === m.price, m.id);
  }
});

test('old order-based ids still open a medicine (links shared before the change)', () => {
  const ds = SDData.expand(real);
  const e = SDSearch.createEngine(ds);
  assert.ok(ds.aliases.size > 0);
  const [old, med] = ds.aliases.entries().next().value;
  assert.equal(e.byId(old), med);
});

async function boot(hash, site) {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' + (hash || '') });
  const w = dom.window;
  const data = fixtureJson();
  w.scrollTo = () => {};
  w.matchMedia = () => ({ matches: false, addEventListener() {} });
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.__calls = [];
  w.fetch = async (url) => {
    w.__calls.push(String(url));
    if (String(url).includes('medicines.json')) return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(data)) };
    if (String(url).includes('api/config') && site) return { ok: true, status: 200, json: async () => site };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  for (const s of ['js/i18n.js', 'js/data.js', 'js/search.js', 'js/assistant.js', 'js/app.js']) w.eval(fs.readFileSync(path.join(root, s), 'utf8'));
  await w.SDApp.ready;
  return w;
}

test('a stray % in the address does not break the page', async () => {
  const w = await boot('#/search/50%');
  assert.ok(w.document.getElementById('loading').hidden);
  const shown = ['view-search', 'view-empty', 'view-home'].some((id) => !w.document.getElementById(id).hidden);
  assert.ok(shown, 'a view is rendered');
});

test('the assistant takes the AI flag from site settings, without calling /api/health', async () => {
  const w = await boot('', { ai: false, overrides: {}, popular: [], contact: {}, announcement: null });
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(!w.__calls.some((u) => u.includes('api/health')), w.__calls.join(', '));
});

test('settings fall back to the last copy this browser saw when the network fails', async () => {
  const site = { ai: false, overrides: {}, popular: ['Panadol'], contact: {}, announcement: { on: true, tone: 'info', en: 'Saved banner', ur: '' } };
  const first = await boot('', site);
  const saved = first.localStorage.getItem('sd_site');
  assert.match(saved, /Saved banner/);
  // second visit: same browser storage, config request fails
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
  const w = dom.window;
  w.localStorage.setItem('sd_site', saved);
  w.scrollTo = () => {};
  w.matchMedia = () => ({ matches: false, addEventListener() {} });
  const data = fixtureJson();
  w.fetch = async (url) => (String(url).includes('medicines.json') ? { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(data)) } : Promise.reject(new Error('offline')));
  for (const s of ['js/i18n.js', 'js/data.js', 'js/search.js', 'js/assistant.js', 'js/app.js']) w.eval(fs.readFileSync(path.join(root, s), 'utf8'));
  await w.SDApp.ready;
  assert.match(w.document.getElementById('announce').textContent, /Saved banner/);
});
