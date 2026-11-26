// v2.4 site features in jsdom: compare tray, pharmacies near you, account sync of My Medicines,
// doctor warning, price freshness, prescription button and the account links.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { fixtureJson, root } = require('./helpers/fixture');

const SCRIPTS = ['js/i18n.js', 'js/data.js', 'js/search.js', 'js/assistant.js', 'js/app.js'];
const PANADOL = 'panadol-500mg-tablet-000101';
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 0));

/**
 * Boot index.html + app.js. `api(url, opts)` answers API calls (return {status, body}) or undefined for 404.
 * Every request and beacon is recorded in w.__calls / w.__beacons.
 */
async function boot(hash, o) {
  const opts = o || {};
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' + (opts.search || '') + (hash || '') });
  const w = dom.window;
  const data = fixtureJson();
  w.scrollTo = () => {};
  w.matchMedia = () => ({ matches: false, addEventListener() {} });
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.__calls = [];
  w.__beacons = [];
  if (opts.beacon !== false) w.navigator.sendBeacon = (url, body) => { w.__beacons.push({ url: String(url), body: JSON.parse(body) }); return true; };
  for (const [k, v] of Object.entries(opts.localStorage || {})) w.localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
  w.fetch = async (url, init) => {
    const u = String(url);
    w.__calls.push({ url: u, init: init || {} });
    if (u.includes('medicines.json')) return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(data)) };
    if (opts.fetchThrows && u.includes('api/')) throw new Error('offline');
    if (u.includes('api/config') && opts.site) return { ok: true, status: 200, json: async () => opts.site };
    const r = opts.api && u.includes('api/') ? await opts.api(u, init || {}) : undefined;
    if (r) return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  for (const s of SCRIPTS) w.eval(fs.readFileSync(path.join(root, s), 'utf8'));
  await w.SDApp.ready;
  await tick(10);
  return w;
}

const PHARMACIES = [
  { id: 'p_aaaaaaaaaaaa', name: 'Shifa <img src=x onerror=alert(1)> Pharmacy', area: 'G-9', address: 'Markaz', city: 'Islamabad', phone: '0511234567', whatsapp: '03001234567', hours: '9am–11pm', verified: true, sponsored: true, reserve: true, stock: 'in', price: 38, km: 1.2, lat: 33.69, lng: 73.03 },
  { id: 'p_bbbbbbbbbbbb', name: 'City Chemist', area: '', address: 'Blue Area', city: 'Islamabad', phone: '0517654321', whatsapp: '', hours: '', verified: true, sponsored: false, reserve: false },
];

function placesApi(list, extra) {
  return async (url, init) => {
    if (url.includes('a=nearby')) return { status: 200, body: { pharmacies: list, cities: url.includes('city=') ? undefined : ['Islamabad', 'Lahore'] } };
    if (url.includes('a=reserve')) { extra && extra.reserves.push(JSON.parse(init.body)); return { status: 200, body: { ok: true } }; }
    return undefined;
  };
}

test('compare: add from the medicine page and results, max 3, side-by-side view', async () => {
  const w = await boot('#/medicine/' + PANADOL);
  const d = w.document;
  assert.ok(d.getElementById('compare-tray').hidden, 'tray hidden while empty');
  d.getElementById('btn-compare').click();
  assert.deepEqual(JSON.parse(w.localStorage.getItem('sd_compare')), [PANADOL]);
  assert.ok(!d.getElementById('compare-tray').hidden);
  assert.match(d.getElementById('compare-tray').textContent, /1 of 3/);
  assert.equal(d.getElementById('btn-compare').getAttribute('aria-pressed'), 'true');

  w.location.hash = '#/search/omeprazole';
  await tick();
  const btns = [...d.querySelectorAll('#search-results .result-wrap > button[data-compare]')];
  assert.ok(btns.length >= 3, 'every result card has a compare button');
  assert.ok(!d.querySelector('#search-results a.result button'), 'button is not nested inside the link');
  btns[0].click();
  btns[1].click();
  btns[2].click(); // 4th medicine: refused
  assert.equal(JSON.parse(w.localStorage.getItem('sd_compare')).length, 3);
  assert.match(d.getElementById('toast').textContent, /up to 3/);

  w.location.hash = '#/compare';
  await tick();
  assert.ok(!d.getElementById('view-compare').hidden);
  assert.ok(d.getElementById('compare-tray').hidden, 'tray hidden on the compare page itself');
  const heads = d.querySelectorAll('.cmp-table thead th');
  assert.equal(heads.length, 4, 'label column + 3 medicines');
  const text = d.querySelector('.cmp-table').textContent;
  for (const k of ['Formula', 'Strength', 'Pack price', 'Price per unit', 'Manufacturer', 'Cheapest same formula']) assert.ok(text.includes(k), k);
  assert.match(d.getElementById('compare-body').textContent, /Consult your doctor or pharmacist/);
  d.querySelector('[data-compare-remove]').click();
  assert.equal(d.querySelectorAll('.cmp-table thead th').length, 3);
  d.querySelector('#compare-body [data-compare-clear]').click();
  assert.equal(JSON.parse(w.localStorage.getItem('sd_compare')).length, 0);
  assert.match(d.getElementById('compare-body').textContent, /Nothing to compare/);
});

test('pharmacies near you: cards, badges, links, one view event per pharmacy, escaping', async () => {
  const w = await boot('#/medicine/' + PANADOL, { api: placesApi(PHARMACIES) });
  const d = w.document;
  const req = w.__calls.find((c) => c.url.includes('a=nearby'));
  assert.ok(req, 'nearby requested');
  assert.match(req.url, new RegExp('med=' + PANADOL));
  const cards = [...d.querySelectorAll('#med-nearby .ph-card')];
  assert.equal(cards.length, 2);
  const [a, b] = cards;
  assert.equal(a.querySelectorAll('img').length, 0, 'pharmacy name is escaped');
  assert.match(a.textContent, /Shifa <img/);
  assert.match(a.textContent, /Verified/);
  assert.match(a.textContent, /Sponsored/);
  assert.match(a.textContent, /1\.2 km/);
  assert.match(a.textContent, /In stock/);
  assert.match(a.textContent, /Pharmacy price: Rs 38/);
  assert.match(a.textContent, /9am–11pm/);
  const wa = a.querySelector('a[data-ev="wa"]').getAttribute('href');
  assert.ok(wa.startsWith('https://wa.me/923001234567?text='), wa);
  assert.match(decodeURIComponent(wa), /Panadol 500mg/);
  assert.equal(a.querySelector('a[data-ev="call"]').getAttribute('href'), 'tel:0511234567');
  assert.match(a.querySelector('a[data-ev="dir"]').getAttribute('href'), /destination=33\.69%2C73\.03/);
  assert.ok(a.querySelector('[data-reserve]'), 'reserve on a paid pharmacy');
  assert.ok(!b.querySelector('[data-reserve]'), 'no reserve when the pharmacy does not take them');
  assert.ok(!b.querySelector('a[data-ev="wa"]') || b.querySelector('a[data-ev="wa"]').getAttribute('href').includes('92517654321'));
  assert.match(b.textContent, /Stock not listed/);
  assert.match(b.querySelector('a[data-ev="dir"]').getAttribute('href'), /Blue%20Area/);
  assert.match(d.getElementById('med-nearby').textContent, /Own a pharmacy\? List it free/);
  // city picker filled from the answer
  const opts = [...d.querySelectorAll('#nearby-city option')].map((o) => o.value);
  assert.ok(opts.includes('Islamabad') && opts.includes('Lahore'));

  const views = () => w.__beacons.filter((x) => x.body.type === 'view');
  assert.deepEqual(views().map((x) => x.body.pid).sort(), ['p_aaaaaaaaaaaa', 'p_bbbbbbbbbbbb']);
  assert.ok(views().every((x) => x.url.includes('api/places?a=event')));
  // re-render on the same page view (add to My Medicines) does not count again
  d.getElementById('btn-cabinet').click();
  await tick(10);
  assert.equal(views().length, 2);
  // taps are counted
  a.ownerDocument.querySelector('#med-nearby .ph-card a[data-ev="call"]').click();
  assert.deepEqual(w.__beacons.pop().body, { pid: 'p_aaaaaaaaaaaa', type: 'call' });
});

test('pharmacies near you: city choice is remembered and sent', async () => {
  const w = await boot('#/medicine/' + PANADOL, { api: placesApi(PHARMACIES) });
  const d = w.document;
  const sel = d.getElementById('nearby-city');
  sel.value = 'Lahore';
  sel.dispatchEvent(new w.Event('change'));
  await tick(10);
  assert.equal(JSON.parse(w.localStorage.getItem('sd_city')), 'Lahore');
  assert.ok(w.__calls.some((c) => c.url.includes('a=nearby') && c.url.includes('city=Lahore')));
});

test('pharmacies near you: reserve form posts the expected fields', async () => {
  const extra = { reserves: [] };
  const w = await boot('#/medicine/' + PANADOL, { api: placesApi(PHARMACIES, extra) });
  const d = w.document;
  d.querySelector('#med-nearby [data-reserve]').click();
  const form = d.querySelector('#med-nearby form[data-rv]');
  assert.ok(form);
  for (const inp of form.querySelectorAll('input:not(.hp)')) assert.ok(inp.closest('label'), 'every field has a label');
  form.elements.name.value = 'Ali';
  form.elements.phone.value = '03001112222';
  form.elements.qty.value = '2 strips';
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await tick(10);
  assert.equal(extra.reserves.length, 1);
  const r = extra.reserves[0];
  assert.equal(r.pid, 'p_aaaaaaaaaaaa');
  assert.equal(r.med, PANADOL);
  assert.match(r.medName, /Panadol/);
  assert.equal(r.name, 'Ali');
  assert.equal(r.phone, '03001112222');
  assert.equal(r.qty, '2 strips');
  assert.ok('note' in r);
  assert.match(d.getElementById('toast').textContent, /Request sent/);
});

test('pharmacies near you: empty list or network failure falls back to Google Maps', async () => {
  let w = await boot('#/medicine/' + PANADOL, { api: placesApi([]) });
  let box = w.document.getElementById('med-nearby');
  assert.ok(box.querySelector('a[href^="https://www.google.com/maps/search/pharmacy"]'));
  assert.match(box.textContent, /List it free/);
  w = await boot('#/medicine/' + PANADOL, { fetchThrows: true });
  box = w.document.getElementById('med-nearby');
  assert.ok(!w.document.getElementById('view-medicine').hidden, 'page still renders');
  assert.ok(box.querySelector('a[href^="https://www.google.com/maps/search/pharmacy"]'));
});

test('medicine page: doctor warning, DRAP effective date, registration number and freshness line', async () => {
  const w = await boot('#/medicine/' + PANADOL);
  const d = w.document;
  assert.match(d.getElementById('med-savings').textContent, /Consult your doctor or pharmacist before switching medicine/);
  assert.match(d.getElementById('alt-list').textContent, /Consult your doctor or pharmacist before switching medicine/);
  assert.match(d.querySelector('.mh-facts').textContent, /DRAP price effective from/);
  assert.match(d.querySelector('.mh-stamp').textContent, /DRAP price list checked up to/);
  w.location.hash = '#/search/omeprazole';
  await tick();
  assert.match(d.getElementById('search-stamp').textContent, /DRAP prices updated to/);
  // Urdu text exists for the new strings
  const i18n = require('../js/i18n.js');
  for (const k of ['consult_doctor', 'nearby_title', 'compare_title', 'rx_btn', 'staff_benefit', 'nav_account', 'nav_business', 'reserve_send']) {
    assert.ok(i18n.STRINGS.en[k] && i18n.STRINGS.ur[k], k);
  }
});

test('My Medicines sync: debounced save sends {id, perDay, days, at}; restore on a new device', async () => {
  const saved = [];
  const user = { id: 'u_000000000001', name: 'Ahmed Khan', role: 'patient', cabinet: [], joinedCompany: { code: 'ACME12', name: 'Acme Textiles' } };
  const api = async (url, init) => {
    if (url.includes('a=me')) return { status: 200, body: { user } };
    if (url.includes('a=save-cabinet')) { saved.push({ body: JSON.parse(init.body), auth: init.headers.Authorization }); return { status: 200, body: { ok: true } }; }
    return undefined;
  };
  const w = await boot('#/medicine/' + PANADOL, { api, localStorage: { sd_user_token: 'tok.abc' } });
  const d = w.document;
  assert.match(d.querySelector('#nav-account .nav-account-label').textContent, /Ahmed/);
  d.getElementById('btn-cabinet').click();
  await w.SDApp.syncCabinetNow();
  const last = saved[saved.length - 1];
  assert.equal(last.auth, 'Bearer tok.abc');
  assert.equal(last.body.cabinet.length, 1);
  const item = last.body.cabinet[0];
  assert.deepEqual(Object.keys(item).sort(), ['at', 'days', 'id', 'perDay']);
  assert.equal(item.id, PANADOL);
  assert.equal(item.perDay, 1);
  assert.equal(item.days, 30);
  assert.ok(!isNaN(Date.parse(item.at)));
  // staff benefit chip
  w.location.hash = '#/my-medicines';
  await tick();
  assert.match(d.getElementById('cabinet-body').textContent, /Staff benefit: Acme Textiles/);

  // new device: empty local list, account has one -> restored
  user.cabinet = [{ id: PANADOL, perDay: 2, days: 30, at: '2026-11-01T00:00:00.000Z' }];
  const w2 = await boot('#/my-medicines', { api, localStorage: { sd_user_token: 'tok.abc' } });
  assert.deepEqual(JSON.parse(w2.localStorage.getItem('sd_cabinet')).map((x) => [x.id, x.qty]), [[PANADOL, 2]]);
  assert.equal(w2.document.getElementById('cabinet-count').textContent, '1');
  assert.ok(w2.document.querySelector('.cab-item'), 'list re-rendered');
});

test('signed out: no account calls, Account / For business links present', async () => {
  const w = await boot('');
  assert.ok(!w.__calls.some((c) => c.url.includes('api/account')));
  const d = w.document;
  assert.equal(d.getElementById('nav-account').getAttribute('href'), '/account');
  assert.equal(d.querySelector('#nav-account .nav-account-label').textContent, 'Account');
  assert.ok(d.querySelector('.topnav a[href="/business"]'));
  assert.ok(d.querySelector('.mobile-nav a[href="/account"]'));
  assert.ok(d.querySelector('.footer a[href="/business"]'));
});

test('prescription button only when the site has AI on, with a camera file input', async () => {
  let w = await boot('', { site: { ai: false, overrides: {}, popular: [], contact: {}, announcement: null } });
  assert.ok(w.document.getElementById('rx-block').hidden);
  w = await boot('', {
    site: { ai: true, overrides: {}, popular: [], contact: {}, announcement: null },
    api: async (url) => (url.includes('a=rx') ? { status: 503, body: { error: 'off' } } : undefined),
  });
  const d = w.document;
  assert.ok(!d.getElementById('rx-block').hidden);
  const file = d.getElementById('rx-file');
  assert.equal(file.getAttribute('accept'), 'image/*');
  assert.equal(file.getAttribute('capture'), 'environment');
  assert.equal(d.getElementById('rx-btn').getAttribute('type'), 'button');
});

test('QR landing /?pharmacy=<id> shows that pharmacy', async () => {
  const w = await boot('', { search: '?pharmacy=p_aaaaaaaaaaaa', api: placesApi(PHARMACIES) });
  const box = w.document.getElementById('pharmacy-banner');
  assert.ok(!box.hidden);
  assert.match(box.textContent, /Welcome to Shifa/);
  assert.equal(box.querySelectorAll('img').length, 0);
  assert.equal(JSON.parse(w.localStorage.getItem('sd_city')), 'Islamabad');
});
