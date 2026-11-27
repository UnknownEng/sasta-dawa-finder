// v2.4 site features in jsdom: compare tray, pharmacies near you, account sync of My Medicines,
// doctor warning, price freshness, prescription button and the account links.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { fixtureJson, root } = require('./helpers/fixture');

const SCRIPTS = ['js/i18n.js', 'js/data.js', 'js/search.js', 'js/ocr-match.js', 'js/assistant.js', 'js/app.js'];
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

const SITE_NO_AI = { ai: false, overrides: {}, popular: [], contact: {}, announcement: null };
const SITE_AI = { ...SITE_NO_AI, ai: true };
/** Stand-in for Tesseract.js (the real one runs in the browser, see BUILD_LOG / verification). */
function fakeOcr(w, text, opts) {
  const o = opts || {};
  w.Worker = function () {};
  w.__ocr = { created: 0, terminated: 0, options: null };
  w.Tesseract = {
    createWorker: async (lang, oem, options) => {
      w.__ocr.created++;
      w.__ocr.options = { lang, oem, ...options };
      options.logger({ status: 'recognizing text', progress: 0.5 });
      return {
        recognize: async () => { if (o.fail) throw new Error('boom'); return { data: { text } }; },
        terminate: async () => { w.__ocr.terminated++; },
      };
    },
  };
}

test('scan button always shows (free, on the phone), camera input, nothing OCR loaded up front', async () => {
  for (const site of [SITE_NO_AI, SITE_AI]) {
    const w = await boot('', { site });
    const d = w.document;
    assert.ok(!d.getElementById('rx-block').hidden);
    const file = d.getElementById('rx-file');
    assert.equal(file.getAttribute('accept'), 'image/*');
    assert.equal(file.getAttribute('capture'), 'environment');
    assert.equal(d.getElementById('rx-btn').getAttribute('type'), 'button');
    assert.equal(d.getElementById('rx-btn').textContent.trim(), 'Scan medicine or prescription');
    assert.match(d.querySelector('.rx-privacy').textContent, /stays on your phone/);
    // lazy: no OCR script or file requested before the user scans
    assert.ok(![...d.scripts].some((s) => /vendor\/ocr/.test(s.src)));
    assert.ok(!w.__calls.some((c) => /vendor\/ocr|a=rx/.test(c.url)));
  }
});

test('scan: on-device text -> big rows from our data, Add / Add all, no server call', async () => {
  const w = await boot('', { site: SITE_AI, api: async (url) => (url.includes('a=rx') ? { status: 200, body: { items: [] } } : undefined) });
  fakeOcr(w, 'Dr. Ahmed MBBS Clinic Road\nTab. Panadol 500mg 1+1+1\nRisek 20mg OD');
  await w.SDApp.scanImage('data:image/jpeg;base64,AAAA');
  const d = w.document;
  const box = d.getElementById('rx-result');
  assert.ok(!box.hidden);
  const rows = [...box.querySelectorAll('.rx-row')];
  assert.deepEqual(rows.map((r) => r.querySelector('.rx-name').textContent), ['Panadol 500mg', 'Risek 20mg']);
  assert.ok(rows[0].querySelector('a[href^="#/medicine/"]'));
  assert.match(rows[0].querySelector('.rx-price').textContent, /Rs/);
  assert.ok(!w.__calls.some((c) => c.url.includes('a=rx')), 'AI server not called when the phone found medicines');
  // same-origin OCR files, LSTM only, gzipped model, worker not a blob
  const o = w.__ocr.options;
  assert.equal(o.lang, 'eng');
  assert.equal(o.oem, 1);
  assert.equal(o.gzip, true);
  assert.equal(o.workerBlobURL, false);
  for (const k of ['workerPath', 'corePath', 'langPath']) assert.match(o[k], /^http:\/\/localhost\/vendor\/ocr/, k);
  assert.equal(w.__ocr.terminated, 1);
  // add one, then all
  rows[0].querySelector('[data-rx-add]').click();
  assert.equal(JSON.parse(w.localStorage.getItem('sd_cabinet')).length, 1);
  assert.ok(rows[0].querySelector('[data-rx-add]').disabled);
  box.querySelector('.rx-all').click();
  assert.equal(JSON.parse(w.localStorage.getItem('sd_cabinet')).length, 2);
});

test('scan: nothing read and AI off -> friendly message, never calls the server', async () => {
  const w = await boot('', { site: SITE_NO_AI });
  fakeOcr(w, 'Dr. Ahmed MBBS Clinic Road\nCell 0300-1234567');
  await w.SDApp.scanImage('data:image/jpeg;base64,AAAA');
  const box = w.document.getElementById('rx-result');
  assert.match(box.textContent, /Could not read medicine names/);
  assert.ok(!w.__calls.some((c) => c.url.includes('a=rx')));
  box.querySelector('[data-rx-type]').click();
  assert.ok(box.hidden);
  assert.equal(w.document.activeElement.id, 'search-input');
});

test('scan: nothing read on the phone and AI on -> server fallback results', async () => {
  const { fixtureEngine } = require('./helpers/fixture');
  const id = fixtureEngine().ds.items.find((m) => m.name === 'Brufen').id;
  const w = await boot('', { site: SITE_AI, api: async (url) => (url.includes('a=rx') ? { status: 200, body: { items: [{ read: 'brufen', match: { id } }] } } : undefined) });
  fakeOcr(w, '', { fail: true });
  await w.SDApp.scanImage('data:image/jpeg;base64,AAAA');
  const call = w.__calls.find((c) => c.url.includes('a=rx'));
  assert.ok(call);
  assert.equal(JSON.parse(call.init.body).image, 'data:image/jpeg;base64,AAAA');
  const box = w.document.getElementById('rx-result');
  assert.deepEqual([...box.querySelectorAll('.rx-name')].map((n) => n.textContent.replace(/ .*/, '')), ['Brufen']);
  assert.match(box.textContent, /read by our server/);
});

test('QR landing /?pharmacy=<id> shows that pharmacy', async () => {
  const w = await boot('', { search: '?pharmacy=p_aaaaaaaaaaaa', api: placesApi(PHARMACIES) });
  const box = w.document.getElementById('pharmacy-banner');
  assert.ok(!box.hidden);
  assert.match(box.textContent, /Welcome to Shifa/);
  assert.equal(box.querySelectorAll('img').length, 0);
  assert.equal(JSON.parse(w.localStorage.getItem('sd_city')), 'Islamabad');
});

// ---------------------------------------------------------------------------
// v2.5: delivery orders, staff discounts on pharmacy cards, admin analytics
// ---------------------------------------------------------------------------
const DELIVERY_LIST = [
  { ...PHARMACIES[0], delivery: true, offer: { percent: 10, note: 'Show staff card <b>now</b>' } },
  { ...PHARMACIES[1], reserve: true, delivery: false, offer: null },
];

test('delivery: button and "Delivers" chip only when delivery is true; order posts delivery + address', async () => {
  const extra = { reserves: [] };
  const w = await boot('#/medicine/' + PANADOL, { api: placesApi(DELIVERY_LIST, extra) });
  const d = w.document;
  const [a, b] = [...d.querySelectorAll('#med-nearby .ph-card')];
  assert.ok(a.querySelector('[data-delivery]'), 'delivery button on a delivering pharmacy');
  assert.match(a.querySelector('[data-delivery]').textContent, /Order delivery/);
  assert.ok(a.querySelector('[data-reserve]'), 'reserve stays next to it');
  assert.match(a.querySelector('.ph-delivers').textContent, /Delivers/);
  assert.ok(!b.querySelector('[data-delivery]'), 'no delivery button when delivery is false');
  assert.ok(!b.querySelector('.ph-delivers'));

  // reserve form has no address; delivery form adds a required, labelled address
  a.querySelector('[data-reserve]').click();
  assert.equal(a.querySelector('form[data-rv]').dataset.mode, 'pickup');
  assert.ok(!a.querySelector('textarea[name="address"]'));
  a.querySelector('[data-delivery]').click();
  const form = a.querySelector('form[data-rv]');
  assert.equal(form.dataset.mode, 'delivery');
  assert.ok(!a.querySelector('.ph-reserve').hidden);
  assert.equal(a.querySelector('[data-delivery]').getAttribute('aria-expanded'), 'true');
  assert.equal(a.querySelector('[data-reserve]').getAttribute('aria-expanded'), 'false');
  const addr = form.querySelector('textarea[name="address"]');
  assert.ok(addr && addr.required);
  assert.match(addr.closest('label').textContent, /Delivery address/);

  form.elements.name.value = 'Ali';
  form.elements.phone.value = '03001112222';
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await tick(10);
  assert.equal(extra.reserves.length, 0, 'address is required');
  assert.match(form.querySelector('.fb-status').textContent, /delivery address/);

  form.elements.address.value = 'House 12, Street 4, G-9/3, Islamabad';
  form.elements.qty.value = '2';
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await tick(10);
  assert.equal(extra.reserves.length, 1);
  const r = extra.reserves[0];
  assert.equal(r.pid, 'p_aaaaaaaaaaaa');
  assert.equal(r.med, PANADOL);
  assert.match(r.medName, /Panadol/);
  assert.equal(r.delivery, true);
  assert.equal(r.address, 'House 12, Street 4, G-9/3, Islamabad');
  assert.equal(r.name, 'Ali');
  assert.equal(r.phone, '03001112222');
  assert.equal(r.qty, '2');
  assert.ok('note' in r);
  assert.match(d.getElementById('toast').textContent, /Order sent\. The pharmacy will call you to confirm the price and delivery\./);
  assert.ok(a.querySelector('.ph-reserve').hidden);

  // a plain reservation still carries no delivery flag
  a.querySelector('[data-reserve]').click();
  const f2 = a.querySelector('form[data-rv]');
  f2.elements.name.value = 'Sara';
  f2.elements.phone.value = '03004445555';
  f2.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await tick(10);
  assert.equal(extra.reserves.length, 2);
  assert.ok(!('delivery' in extra.reserves[1]) && !('address' in extra.reserves[1]));
  assert.match(d.getElementById('toast').textContent, /Request sent/);

  // Urdu strings exist
  const i18n = require('../js/i18n.js');
  for (const k of ['delivers', 'btn_delivery', 'delivery_address', 'delivery_send', 'delivery_ok', 'delivery_missing', 'offer_staff', 'offer_mine']) {
    assert.ok(i18n.STRINGS.en[k] && i18n.STRINGS.ur[k], k);
  }
});

test('staff discount: chip for everyone, prominent line for signed-in company staff', async () => {
  let w = await boot('#/medicine/' + PANADOL, { api: placesApi(DELIVERY_LIST) });
  let [a, b] = [...w.document.querySelectorAll('#med-nearby .ph-card')];
  const chip = a.querySelector('.tag.offer');
  assert.ok(chip, 'offer chip');
  assert.match(chip.textContent, /10% off for company staff/);
  assert.match(chip.textContent, /Show staff card <b>now<\/b>/, 'note shown as text');
  assert.equal(chip.querySelectorAll('b').length, 0, 'note is escaped');
  assert.equal(chip.getAttribute('title'), 'Show staff card <b>now</b>');
  assert.ok(!a.querySelector('.ph-offer.mine'));
  assert.ok(!b.querySelector('.ph-offer'), 'no chip without an offer');

  const user = { id: 'u_000000000001', name: 'Ahmed Khan', role: 'patient', cabinet: [], joinedCompany: { code: 'ACME12', name: 'Acme <Textiles>' } };
  w = await boot('#/medicine/' + PANADOL, { api: placesApi(DELIVERY_LIST), localStorage: { sd_user_token: 'tok.abc', sd_user: user } });
  [a, b] = [...w.document.querySelectorAll('#med-nearby .ph-card')];
  const mine = a.querySelector('.ph-offer.mine');
  assert.ok(mine, 'prominent staff line');
  assert.match(mine.textContent, /Your staff discount: 10% — show your company name \(Acme <Textiles>\)/);
  assert.match(mine.textContent, /Show staff card/);
  assert.ok(!a.querySelector('.tag.offer'), 'small chip replaced');
  assert.ok(!b.querySelector('.ph-offer'));

  // signed out (no token): stored user is ignored
  w = await boot('#/medicine/' + PANADOL, { api: placesApi(DELIVERY_LIST), localStorage: { sd_user: user } });
  a = w.document.querySelector('#med-nearby .ph-card');
  assert.ok(a.querySelector('.tag.offer') && !a.querySelector('.ph-offer.mine'));
});

// --- admin panel analytics (jsdom boot of unonenginerrunon/index.html + admin.js) ---
const DAY_MS = 86400000;
const ANALYTICS = {
  users: { total: 42, byRole: { patient: 30, pharmacy: 8, clinic: 4 }, byPlan: { free: 33, pharmacy_pro: 3, pharmacy_premium: 2, clinic: 4 }, trials: 4, newLast30: 9 },
  revenue: { approved: 25000, pending: 3000, last30: 12000, byPlan: { pharmacy_premium: 15000, pharmacy_pro: 10000 }, byMethod: { jazzcash: 20000, bank: 5000 } },
  expiringSoon: [
    { id: 'u_aaaaaaaaaaaa', name: 'Shifa <script>x</script> Owner', email: 'shifa@example.pk', phone: '0300-1234567', plan: 'pharmacy_premium', planUntil: new Date(Date.now() + 3 * DAY_MS).toISOString(), trial: true },
    { id: 'u_bbbbbbbbbbbb', name: 'No Phone Clinic', email: 'clinic@example.pk', phone: '', plan: 'clinic', planUntil: new Date(Date.now() + 6 * DAY_MS).toISOString(), trial: false },
  ],
  pharmacies: { total: 10, verified: 7, pending: 3, cities: ['Islamabad', 'Lahore'] },
  events30: { view: 120, wa: 14, call: 9, dir: 5, reserve: 3, delivery: 2 },
  viewsByDay: Array.from({ length: 30 }, (_, i) => ({ day: new Date(Date.now() - (29 - i) * DAY_MS).toISOString().slice(0, 10), views: i % 7 })),
  topSearched: [{ id: 'panadol-500mg-tablet-000101', name: 'Panadol <i>500</i>', generic: 'Paracetamol', searches: 17 }],
};

async function bootAdmin(analytics) {
  const html = fs.readFileSync(path.join(root, 'unonenginerrunon', 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/unonenginerrunon' });
  const w = dom.window;
  w.scrollTo = () => {};
  w.matchMedia = () => ({ matches: false, addEventListener() {} });
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.__calls = [];
  const overview = {
    data: { products: 100, formulas: 20, latest_price_date: '2026-11-10', synced_at: '2026-11-10T00:00:00Z' },
    feedback: { open: 0, total: 0, max: 500 },
    ai: { keySet: false, enabled: false },
    storage: 'local',
    storageOk: true,
    config: { announcement: { on: false, tone: 'info', en: '', ur: '' }, ai: { enabled: false }, popular: [], contact: { phone: '', email: '', whatsapp: '' }, overrides: {}, payments: {} },
  };
  w.fetch = async (url, init) => {
    const u = String(url);
    w.__calls.push({ url: u, init: init || {} });
    const a = new URL(u, 'http://localhost').searchParams.get('a');
    const body = { me: { configured: true, authed: true }, overview, feedback: { items: [] }, analytics, pharmacies: { pharmacies: [] }, payments: { payments: [] } }[a];
    return body ? { ok: true, status: 200, json: async () => body } : { ok: false, status: 404, json: async () => ({}) };
  };
  w.eval(fs.readFileSync(path.join(root, 'js/data.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(root, 'js/search.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(root, 'unonenginerrunon/admin.js'), 'utf8'));
  await tick(20);
  return w;
}

test('admin analytics tab: stats, tables, chart, top searched and renewal reminders (escaped)', async () => {
  const w = await bootAdmin(ANALYTICS);
  const d = w.document;
  const tabs = [...d.querySelectorAll('.ad-tabs [role="tab"]')].map((b) => b.dataset.tab);
  assert.deepEqual(tabs.slice(0, 2), ['overview', 'analytics'], 'Analytics sits next to Overview');
  d.querySelector('[data-tab="analytics"]').click();
  await tick(10);
  const call = w.__calls.find((c) => c.url.includes('a=analytics'));
  assert.ok(call, 'analytics requested');
  assert.equal(call.init.headers['X-SD-Admin'], '1');
  assert.ok(!d.querySelector('[data-pane="analytics"]').hidden);
  const body = d.getElementById('ana-body');
  const stats = [...body.querySelectorAll('.ad-stat')].map((s) => [...s.children].map((c) => c.textContent).join(' | '));
  const stat = (k) => stats.find((s) => s.startsWith(k)) || '';
  assert.match(stat('Accounts'), /42/);
  assert.match(stat('Accounts'), /9 new/);
  assert.match(stat('Paying accounts'), /\| 5 \|/, '9 on paid plans minus 4 trials');
  assert.match(stat('On free trial'), /\| 4 \|/);
  assert.match(stat('Revenue approved'), /Rs 25,000/);
  assert.match(stat('Revenue, last 30 days'), /Rs 12,000/);
  assert.match(stat('Waiting for approval'), /Rs 3,000/);
  assert.match(stat('Pharmacies verified'), /\| 7 \| of 10/);
  assert.match(stat('Pharmacies waiting'), /\| 3 \|/);
  const text = body.textContent;
  for (const k of ['Accounts by type', 'Accounts by plan', 'Revenue by method', 'Pharmacy Premium', 'JazzCash', 'Bank transfer', 'Profile views', 'Delivery orders', 'Islamabad']) assert.ok(text.includes(k), k);
  // bar chart: one bar per day
  assert.equal(body.querySelectorAll('svg.ad-chart rect.ad-bar').length, 30);
  assert.match(body.querySelector('svg.ad-chart').getAttribute('aria-label'), /views per day/);
  // top searched: escaped and linked
  const topLink = [...body.querySelectorAll('a')].find((x) => x.getAttribute('href') === '/#/medicine/panadol-500mg-tablet-000101');
  assert.ok(topLink);
  assert.equal(topLink.textContent, 'Panadol <i>500</i>');
  assert.equal(body.querySelectorAll('i, script').length, 0, 'all text escaped');
  // renewals: WhatsApp link with a polite reminder; no phone -> no WhatsApp, email instead
  const items = [...body.querySelectorAll('.ad-renew-item')];
  assert.equal(items.length, 2);
  assert.match(items[0].textContent, /Shifa <script>x<\/script> Owner/);
  assert.match(items[0].textContent, /\(trial\)/);
  const wa = items[0].querySelector('a[data-renew="wa"]').getAttribute('href');
  assert.ok(wa.startsWith('https://wa.me/923001234567?text='), wa);
  const msg = decodeURIComponent(wa.split('?text=')[1]);
  assert.match(msg, /Assalam o Alaikum Shifa/);
  assert.match(msg, /free trial of Pharmacy Premium ends on/);
  assert.match(msg, /renew/);
  assert.ok(!items[1].querySelector('a[data-renew="wa"]'));
  assert.ok(items[1].querySelector('a[data-renew="email"]').getAttribute('href').startsWith('mailto:clinic@example.pk'));
});

test('admin analytics tab copes with an empty site', async () => {
  const w = await bootAdmin({ users: { total: 0, byRole: {}, byPlan: {}, trials: 0, newLast30: 0 }, revenue: { approved: 0, pending: 0, last30: 0, byPlan: {}, byMethod: {} }, expiringSoon: [], pharmacies: { total: 0, verified: 0, pending: 0, cities: [] }, events30: {}, viewsByDay: [], topSearched: [] });
  w.document.querySelector('[data-tab="analytics"]').click();
  await tick(10);
  const t = w.document.getElementById('ana-body').textContent;
  assert.match(t, /No plan ends in the next 7 days/);
  assert.match(t, /No views recorded yet/);
});
