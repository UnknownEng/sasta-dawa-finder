// Clinic widget (widget.html?c=<uid>) in jsdom: partner pharmacies and the "saved" event.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { fixtureJson, fixtureEngine, root } = require('./helpers/fixture');

const CLINIC = 'u_c11c11c11c11';
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 0));

const PARTNERS = [
  { id: 'p_aaaaaaaaaaaa', name: 'Shifa <img src=x onerror=alert(1)> Pharmacy', area: 'G-9', address: 'Markaz', phone: '0511234567', whatsapp: '03001234567', verified: true, delivery: true },
  { id: 'p_bbbbbbbbbbbb', name: 'City Chemist', area: '', address: 'Blue Area', phone: '0517654321', whatsapp: '', verified: false, delivery: false },
];

async function bootWidget(clinic) {
  const html = fs.readFileSync(path.join(root, 'widget.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/widget.html?c=' + CLINIC });
  const w = dom.window;
  const data = fixtureJson();
  w.print = () => {};
  w.__events = [];
  w.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('medicines.json')) return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(data)) };
    if (u.includes('a=widget')) return { ok: true, status: 200, json: async () => clinic };
    if (u.includes('a=event')) {
      w.__events.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  for (const s of ['js/data.js', 'js/search.js', 'js/widget.js']) w.eval(fs.readFileSync(path.join(root, s), 'utf8'));
  await tick(30);
  return w;
}

/** A fixture medicine that has a cheaper same-formula brand, with the widget's expected saving. */
function pickMedicine() {
  const { ds, engine } = fixtureEngine();
  for (const m of ds.items) {
    if (!(m.unitPrice > 0)) continue;
    const alts = engine.alternatives(m, 'unit').filter((x) => x !== m && x.unitPrice > 0 && x.unitPrice < m.unitPrice);
    if (!alts.length) continue;
    const q = `${m.name} ${m.strength || ''}`.trim();
    const idx = engine.suggest(q, 8).findIndex((x) => x.id === m.id);
    if (idx < 0) continue;
    const units = Number(m.units) > 0 ? Number(m.units) : 1;
    return { m, q, idx, amount: Math.max(0, Math.round((m.unitPrice - alts[0].unitPrice) * units)) };
  }
  throw new Error('fixture has no medicine with a cheaper alternative');
}

async function search(w, q, idx) {
  const input = w.document.getElementById('w-q');
  input.value = q;
  input.dispatchEvent(new w.Event('input'));
  await tick(160);
  w.document.querySelector(`#w-suggest button[data-i="${idx}"]`).click();
  await tick(5);
}

test('widget: partner pharmacies in the clinic city, escaped, with WhatsApp / Call / verified / Delivers', async () => {
  const w = await bootWidget({ active: true, name: 'Al-Shifa Clinic', color: '#0f5c54', note: '', phone: '', city: 'Islamabad', partners: PARTNERS });
  const d = w.document;
  const box = d.getElementById('w-partners');
  assert.ok(!box.hidden, 'partners shown as soon as the widget loads');
  assert.match(box.querySelector('h2').textContent, /^Partner pharmacies in Islamabad$/);
  const items = [...box.querySelectorAll('.wp-item')];
  assert.equal(items.length, 2);
  assert.equal(box.querySelectorAll('img').length, 0, 'names are escaped');
  assert.match(items[0].textContent, /Shifa <img/);
  assert.match(items[0].textContent, /✓/);
  assert.match(items[0].textContent, /Delivers/);
  assert.doesNotMatch(items[1].textContent, /✓|Delivers/);
  const wa0 = items[0].querySelector('a[data-wp="wa"]').getAttribute('href');
  assert.ok(wa0.startsWith('https://wa.me/923001234567?text='), wa0);
  assert.equal(items[0].querySelector('a[data-wp="call"]').getAttribute('href'), 'tel:0511234567');
  // no WhatsApp number: falls back to the phone number for WhatsApp
  assert.ok(items[1].querySelector('a[data-wp="wa"]').getAttribute('href').startsWith('https://wa.me/92517654321?text='));

  // after a search, WhatsApp is prefilled with that medicine
  const { m, q, idx } = pickMedicine();
  await search(w, q, idx);
  const wa = d.querySelector('#w-partners a[data-wp="wa"]').getAttribute('href');
  assert.ok(decodeURIComponent(wa).includes(`${m.name} ${m.strength || ''}`.trim()), decodeURIComponent(wa));
  assert.match(decodeURIComponent(wa), /Al-Shifa Clinic/);
});

test('widget: no partners section when the list is empty', async () => {
  const w = await bootWidget({ active: true, name: 'Clinic', color: '#0f5c54', city: '', partners: [] });
  assert.ok(w.document.getElementById('w-partners').hidden);
});

test('widget: "saved" event once per distinct medicine with the per-pack saving, plus one "widget" event', async () => {
  const w = await bootWidget({ active: true, name: 'Clinic', color: '#0f5c54', city: 'Islamabad', partners: PARTNERS });
  const { m, q, idx, amount } = pickMedicine();
  await search(w, q, idx);
  await search(w, q, idx); // same medicine again: not counted twice
  const saved = w.__events.filter((e) => e.type === 'saved');
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0], { type: 'saved', clinic: CLINIC, amount });
  assert.ok(Number.isInteger(amount) && amount >= 0);
  assert.equal(w.__events.filter((e) => e.type === 'widget').length, 1, 'existing widget count still sent once');
  assert.match(w.document.getElementById('w-result').textContent, new RegExp(m.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
