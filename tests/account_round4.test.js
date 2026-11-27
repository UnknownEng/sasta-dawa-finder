// Account portal, round 4 (jsdom, server stubbed): terms checkbox, last sign-in, browser -> app handoff,
// "Download my data", strict CSV imports with previews, and the shared upload checks in js/csvkit.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { root } = require('./helpers/fixture');
const SDCsv = require('../js/csvkit.js');
const SDQR = require('../js/qr.js');

const PLANS = { free: { name: 'Free', price: 0, roles: ['patient'] }, pharmacy_pro: { name: 'Pharmacy Pro', price: 1500, period: 'month', roles: ['pharmacy'] } };

function makeUser(over) {
  return Object.assign({ id: 'u_1', email: 'owner@example.com', name: 'Rehman Pharmacy', phone: '', role: 'pharmacy', plan: 'pharmacy_pro', planName: 'Pharmacy Pro', paidPlan: 'pharmacy_pro', planUntil: '2026-12-10T00:00:00.000Z', trial: false, hasPassword: true, google: false }, over || {});
}
const PHARMACY = { id: 'p1', name: 'Rehman Pharmacy', address: 'Shop 1', city: 'Islamabad', verified: true, stock: {} };

async function boot(opts) {
  const o = Object.assign({ path: '/account', hash: '', user: null, origin: 'http://localhost', routes: {}, googleClientId: null, lastMethod: null }, opts);
  const html = fs.readFileSync(path.join(root, 'account.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: o.origin + o.path + o.hash, virtualConsole: new VirtualConsole() });
  const w = dom.window;
  w.scrollTo = () => {};
  w.matchMedia = () => ({ matches: false, addEventListener() {} });
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.confirm = () => true;
  w.calls = [];
  w.opened = [];
  w.downloads = [];
  w.__sdOpenUrl = (u) => w.opened.push(u);
  const blobs = new Map();
  w.URL.createObjectURL = (b) => {
    const id = 'blob:test/' + blobs.size;
    blobs.set(id, b);
    return id;
  };
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function () {
    if (this.download) w.downloads.push({ name: this.download, blob: blobs.get(this.href) });
  };
  if (o.user) {
    w.localStorage.setItem('sd_user_token', 'tok-old');
    w.localStorage.setItem('sd_user', JSON.stringify(o.user));
  }
  if (o.lastMethod) w.localStorage.setItem('sd_last_method', o.lastMethod);
  if (o.native) w.SastaNative = o.native(w);
  if (o.gsiInits) w.google = { accounts: { id: { initialize: (c) => o.gsiInits.push(c), renderButton: () => {} } } };
  w.fetch = async (url, init) => {
    const u = new URL(String(url), 'http://localhost');
    const a = u.searchParams.get('a');
    const body = init && init.body ? JSON.parse(init.body) : null;
    w.calls.push({ a, body, url: String(url), auth: init && init.headers && init.headers.Authorization });
    let out = [404, { error: 'not found' }];
    if (o.routes[a]) out = o.routes[a](body, u);
    else if (a === 'plans') out = [200, { plans: PLANS, trialDays: 30, payTo: {}, googleClientId: o.googleClientId, online: {} }];
    else if (a === 'me') out = [200, { user: o.user }];
    else if (a === 'my-pharmacies') out = [200, { pharmacies: [JSON.parse(JSON.stringify(PHARMACY))] }];
    else if (a === 'payments') out = [200, { payments: [] }];
    const [status, payload, ctype] = out;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (k) => (/content-type/i.test(k) ? ctype || 'application/json' : null) },
      json: async () => JSON.parse(JSON.stringify(payload)),
      text: async () => (typeof payload === 'string' ? payload : JSON.stringify(payload)),
    };
  };
  for (const s of ['js/data.js', 'js/search.js', 'js/qr.js', 'js/csvkit.js', 'js/account.js']) w.eval(fs.readFileSync(path.join(root, s), 'utf8'));
  await settle();
  return w;
}
const settle = (ms) => new Promise((r) => setTimeout(r, ms || 30));
async function until(fn, label) {
  for (let i = 0; i < 150; i++) {
    if (fn()) return;
    await settle(10);
  }
  assert.fail('timed out waiting for ' + label);
}
function chooseFile(w, input, text, name, type) {
  const file = new w.File([text], name || 'data.csv', { type: type == null ? 'text/csv' : type });
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  input.dispatchEvent(new w.Event('change', { bubbles: true }));
}
const submit = (w, form) => form.dispatchEvent(new w.Event('submit', { cancelable: true }));

// ---------------------------------------------------------------------------
// Terms of Service checkbox
// ---------------------------------------------------------------------------
test('signup needs "I agree to the Terms of Service and Privacy Policy" and sends acceptTerms:true', async () => {
  const user = makeUser({ role: 'patient', plan: 'free' });
  const w = await boot({ hash: '#/signup', routes: { signup: () => [200, { token: 't1', user }] } });
  const d = w.document;
  const box = d.getElementById('accept-terms');
  assert.ok(box, 'checkbox exists');
  const label = box.closest('label');
  assert.match(label.textContent, /I agree to the Terms of Service and Privacy Policy/);
  const links = [...label.querySelectorAll('a')].map((a) => [a.getAttribute('href'), a.getAttribute('target')]);
  assert.deepEqual(links, [['terms.html', '_blank'], ['privacy.html', '_blank']], 'relative links work on the site and inside the apps');

  const f = d.getElementById('signup-form');
  f.querySelector('[name="name"]').value = 'Ali Khan';
  f.querySelector('[name="email"]').value = 'ali@example.com';
  f.querySelector('[name="password"]').value = 'password123';
  submit(w, f);
  await settle();
  assert.ok(!w.calls.some((c) => c.a === 'signup'), 'not sent without the tick');
  assert.match(f.querySelector(':scope > .form-msg').textContent, /Terms of Service/);

  box.checked = true;
  submit(w, f);
  await settle();
  const call = w.calls.find((c) => c.a === 'signup');
  assert.equal(call.body.acceptTerms, true);
  assert.equal(w.localStorage.getItem('sd_last_method'), 'password');
});

test('Google signup without the tick is stopped; Google sign-in of a new account explains how to sign up', async () => {
  const inits = [];
  const w = await boot({ hash: '#/signup', googleClientId: 'cid', gsiInits: inits });
  const d = w.document;
  await until(() => inits.length, 'gsi init');
  await inits[0].callback({ credential: 'tok' });
  assert.ok(!w.calls.some((c) => c.a === 'google'));
  assert.match(d.getElementById('google-msg').textContent, /tick/i);

  // Sign in screen, new Google account: server needs acceptTerms -> friendly pointer to Create account
  const inits2 = [];
  const w2 = await boot({ hash: '#/signin', googleClientId: 'cid', gsiInits: inits2, routes: { google: () => [400, { error: 'Please accept the Terms of Service' }] } });
  await until(() => inits2.length, 'gsi init 2');
  await inits2[0].callback({ credential: 'tok' });
  await settle();
  const m = w2.document.getElementById('google-msg');
  assert.match(m.textContent, /Create an account/);
  assert.ok(m.querySelector('a[href="#/signup"]'));
});

// ---------------------------------------------------------------------------
// Last sign-in
// ---------------------------------------------------------------------------
test('sign-in screen hint from localStorage sd_last_method; successful password login stores it', async () => {
  const w = await boot({ hash: '#/signin', lastMethod: 'google', routes: { login: () => [200, { token: 't', user: makeUser() }] } });
  const d = w.document;
  assert.match(d.getElementById('last-hint').textContent, /Last time you used Google/);
  const f = d.getElementById('signin-form');
  f.querySelector('[name="email"]').value = 'owner@example.com';
  f.querySelector('[name="password"]').value = 'password123';
  submit(w, f);
  await settle();
  assert.equal(w.localStorage.getItem('sd_last_method'), 'password');

  const w2 = await boot({ hash: '#/signin', lastMethod: 'password' });
  assert.match(w2.document.getElementById('last-hint').textContent, /your email and password/);
  const w3 = await boot({ hash: '#/signin' });
  assert.ok(!w3.document.getElementById('last-hint'), 'no hint the first time');
});

test('dashboard header shows the PREVIOUS sign-in; Profile shows This time / Last time with an explanation', async () => {
  const user = makeUser({
    lastLogin: { method: 'password', at: '2026-11-27T09:00:00.000Z', device: 'Chrome on Windows' },
    prevLogin: { method: 'google', at: '2026-11-25T14:05:00.000Z', device: 'Sasta Dawa app on Android' },
  });
  const w = await boot({ hash: '#/profile', user });
  const d = w.document;
  await until(() => d.getElementById('signin-activity'), 'profile');
  const head = d.getElementById('last-login').textContent;
  assert.match(head, /Last signed in with Google · 25 Nov 2026/);
  assert.match(head, /on Sasta Dawa app on Android/);
  assert.match(d.getElementById('login-now').textContent, /^email and password · 27 Nov 2026.* on Chrome on Windows$/);
  assert.match(d.getElementById('login-prev').textContent, /^Google · 25 Nov 2026/);
  assert.match(d.getElementById('signin-activity').textContent, /“Last time” is the one before it/);

  const first = makeUser({ lastLogin: { method: 'app', at: '2026-11-27T09:00:00.000Z', device: 'Android' } });
  const w2 = await boot({ hash: '#/profile', user: first });
  await until(() => w2.document.getElementById('signin-activity'), 'profile 2');
  assert.match(w2.document.getElementById('last-login').textContent, /first sign-in/);
  assert.match(w2.document.getElementById('login-prev').textContent, /No earlier sign-in/);
});

test('user-supplied device labels are escaped', async () => {
  const user = makeUser({ prevLogin: { method: 'password', at: '2026-11-25T14:05:00.000Z', device: '<img src=x onerror=alert(1)>' } });
  const w = await boot({ hash: '#/profile', user });
  await until(() => w.document.getElementById('last-login'), 'header');
  assert.ok(!w.document.querySelector('#last-login img'));
  assert.match(w.document.getElementById('last-login').textContent, /<img src=x/);
});

// ---------------------------------------------------------------------------
// Browser -> app handoff
// ---------------------------------------------------------------------------
test('?app=business and already signed in: gets an app code and opens sastadawabiz://auth?code=…, with a fallback button', async () => {
  const code = 'a'.repeat(32);
  const w = await boot({ path: '/account?app=business', user: makeUser(), routes: { 'app-code': () => [200, { code }] } });
  const d = w.document;
  await until(() => d.getElementById('handoff-open'), 'handoff button');
  const call = w.calls.find((c) => c.a === 'app-code');
  assert.equal(call.auth, 'Bearer tok-old');
  assert.deepEqual(call.body, { app: 'business' });
  assert.deepEqual(w.opened, ['sastadawabiz://auth?code=' + code]);
  const btn = d.getElementById('handoff-open');
  assert.equal(btn.getAttribute('href'), 'sastadawabiz://auth?code=' + code);
  assert.equal(btn.textContent, 'Return to the app');
  assert.match(d.querySelector('.handoff').textContent, /Signed in as Rehman Pharmacy/);
  assert.equal(w.sessionStorage.getItem('sd_app_handoff'), null, 'single use: a reload does not loop back');
});

test('?app=customer and signed out: after password sign-in it hands off to sastadawa://', async () => {
  const code = '0123456789abcdef0123456789abcdef';
  const w = await boot({ path: '/account?app=customer', routes: { login: () => [200, { token: 'tnew', user: makeUser({ role: 'patient', plan: 'free' }) }], 'app-code': () => [200, { code }] } });
  const d = w.document;
  assert.match(d.querySelector('.handoff-note').textContent, /back to the Sasta Dawa app/);
  const f = d.getElementById('signin-form');
  f.querySelector('[name="email"]').value = 'a@b.pk';
  f.querySelector('[name="password"]').value = 'password123';
  submit(w, f);
  await until(() => w.opened.length, 'deep link');
  assert.deepEqual(w.opened, ['sastadawa://auth?code=' + code]);
  assert.equal(w.calls.find((c) => c.a === 'app-code').auth, 'Bearer tnew');
  assert.ok(!w.location.search.includes('app='), 'address cleaned after sign-in');
});

test('handoff: a bad code from the server is never put in a link; error offers Try again; ignored inside the app', async () => {
  const w = await boot({ path: '/account?app=customer', user: makeUser(), routes: { 'app-code': () => [200, { code: 'javascript:alert(1)' }] } });
  await until(() => w.document.getElementById('handoff-retry'), 'retry');
  assert.equal(w.opened.length, 0);
  assert.ok(!w.document.getElementById('handoff-open'));

  const w2 = await boot({ origin: 'https://localhost', path: '/account.html?app=customer', user: makeUser() });
  await until(() => w2.document.querySelector('.dash-head'), 'dashboard in app');
  assert.ok(!w2.calls.some((c) => c.a === 'app-code'));
});

// ---------------------------------------------------------------------------
// Download my data
// ---------------------------------------------------------------------------
test('Profile → Download my data saves the a=export JSON and does not overwrite the signed-in user', async () => {
  const user = makeUser();
  const exportData = { exportedAt: '2026-11-27T00:00:00Z', user: { id: 'u_1', email: 'owner@example.com', name: 'RAW RECORD' }, pharmacies: [{ id: 'p1' }] };
  const w = await boot({ hash: '#/profile', user, routes: { export: () => [200, exportData] } });
  const d = w.document;
  await until(() => d.getElementById('export-data'), 'profile');
  d.getElementById('export-data').click();
  await until(() => w.downloads.length, 'download');
  assert.match(w.downloads[0].name, /^sasta-dawa-my-data-\d{4}-\d{2}-\d{2}\.json$/);
  assert.deepEqual(JSON.parse(await w.downloads[0].blob.text()), exportData);
  assert.equal(JSON.parse(w.localStorage.getItem('sd_user')).name, 'Rehman Pharmacy');
  assert.match(d.getElementById('export-msg').textContent, /Downloaded/);
});

// ---------------------------------------------------------------------------
// CSV imports
// ---------------------------------------------------------------------------
test('pharmacy stock import: template, strict header, preview with row errors, all-or-nothing vs "only valid rows"', async () => {
  let reply = [200, { imported: 2, errors: [{ row: 4, error: 'medicine not found: Xyz' }] }];
  const w = await boot({
    hash: '#/branch/p1/bulk',
    user: makeUser(),
    routes: {
      'import-stock': () => reply,
      'csv-template': (b, u) => [200, u.searchParams.get('type') === 'stock' ? 'medicine,status,price\r\nPanadol 500mg,in,35\r\n' : '', 'text/csv'],
    },
  });
  const d = w.document;
  await until(() => d.querySelector('[data-import="stock"]'), 'importer');
  const card = d.querySelector('[data-import="stock"]');
  assert.match(card.textContent, /medicine,status,price/);

  card.querySelector('[data-tpl]').click();
  await until(() => w.downloads.length, 'template');
  assert.equal(w.downloads[0].name, 'sasta-dawa-stock-template.csv');
  assert.match(await w.downloads[0].blob.text(), /^medicine,status,price/);

  // wrong header
  chooseFile(w, card.querySelector('[data-file]'), 'Medicine,Stock\nPanadol,in\n');
  await until(() => card.querySelector('.notice.bad'), 'header error');
  assert.match(card.querySelector('.notice.bad').textContent, /must be exactly: medicine,status,price/);

  // one bad row: import button disabled until "only valid rows" is ticked
  chooseFile(w, card.querySelector('[data-file]'), 'medicine,status,price\nPanadol 500mg,in,35\nRisek 20mg,maybe,480\n"Augmentin 625mg",out,\n');
  await until(() => card.querySelector('[data-go]'), 'preview');
  assert.match(card.querySelector('.import-preview h4').textContent, /3 rows found · 1 with problems/);
  assert.equal(card.querySelectorAll('.import-preview tbody tr').length, 3);
  assert.ok(card.querySelector('tr.row-bad'));
  assert.match(card.querySelector('.row-errors').textContent, /Row 3: status must be "in" or "out"/);
  const go = card.querySelector('[data-go]');
  assert.ok(go.disabled, 'all-or-nothing by default');
  const partial = card.querySelector('[data-partial]');
  partial.checked = true;
  partial.dispatchEvent(new w.Event('change'));
  assert.equal(go.disabled, false);
  assert.match(go.textContent, /Import 2 rows/);
  go.click();
  await settle();
  const call = w.calls.find((c) => c.a === 'import-stock');
  assert.equal(call.body.pid, 'p1');
  assert.equal(call.body.partial, true);
  assert.match(call.body.csv, /^medicine,status,price\nPanadol 500mg,in,35/);
  assert.match(card.querySelector('[data-go-msg]').textContent, /Imported 2 rows/);
  assert.match(card.querySelector('[data-result]').textContent, /Row 4: medicine not found: Xyz/);

  // server refuses the whole file (400 + row errors): nothing imported, errors listed
  reply = [400, { error: 'Fix the rows below', errors: [{ row: 2, error: 'medicine not found: Panadol 500mg' }] }];
  chooseFile(w, card.querySelector('[data-file]'), 'medicine,status,price\nPanadol 500mg,in,35\n');
  await until(() => card.querySelector('[data-go]') && !card.querySelector('[data-go]').disabled, 'clean preview');
  card.querySelector('[data-go]').click();
  await settle();
  assert.equal(w.calls.filter((c) => c.a === 'import-stock').pop().body.partial, false);
  assert.match(card.querySelector('[data-go-msg]').textContent, /Nothing was imported/);
  assert.match(card.querySelector('[data-result]').textContent, /Row 2: medicine not found/);
  assert.equal(card.querySelector('[data-go]').disabled, false);
});

test('file checks before upload: not CSV, too big, binary bytes, Excel renamed .csv', async () => {
  const w = await boot({ hash: '#/branch/p1/bulk', user: makeUser() });
  const d = w.document;
  await until(() => d.querySelector('[data-import="stock"]'), 'importer');
  const card = d.querySelector('[data-import="stock"]');
  const input = card.querySelector('[data-file]');
  const msgText = () => card.querySelector('[data-msg]').textContent;
  chooseFile(w, input, 'x', 'stock.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  await until(() => msgText(), 'xlsx');
  assert.match(msgText(), /not a CSV file/);
  chooseFile(w, input, 'a'.repeat(2 * 1024 * 1024 + 10), 'big.csv');
  await until(() => /too large/.test(msgText()), 'big');
  chooseFile(w, input, 'medicine,status,price\nA\u0000B,in,1\n', 'bin.csv');
  await until(() => /binary/.test(msgText()), 'binary');
  chooseFile(w, input, 'PK\u0003\u0004rest', 'renamed.csv');
  await until(() => /Excel\/zip/.test(msgText()), 'zip');
  chooseFile(w, input, 'medicine,status,price\n', 'photo.png', 'image/png');
  await until(() => /\.csv file/.test(msgText()), 'png');
  assert.ok(!w.calls.some((c) => c.a === 'import-stock'));
});

test('refill customers, NGO list and company claims imports send {csv, partial} to their endpoints', async () => {
  // refills
  const w = await boot({ hash: '#/branch/p1/refills', user: makeUser(), routes: { refills: () => [200, { customers: [] }], 'import-refills': () => [200, { imported: 1 }] } });
  let d = w.document;
  await until(() => d.querySelector('a[href="#/branch/p1/refills/import"]'), 'import link');
  w.location.hash = '#/branch/p1/refills/import';
  await until(() => d.querySelector('[data-import="refills"]'), 'refill importer');
  let card = d.querySelector('[data-import="refills"]');
  card.sdLoad('name,phone,medicines,every_days,last_refill_date\nAhmed,03001234567,Glucophage 500mg;Concor 5mg,30,2026-11-01\nBilal,123,X,0,2026-02-30\n');
  assert.match(card.querySelector('.row-errors').textContent, /Row 3: phone must be a mobile number/);
  card.sdLoad('name,phone,medicines,every_days,last_refill_date\nAhmed,03001234567,Glucophage 500mg;Concor 5mg,30,\n');
  card.querySelector('[data-go]').click();
  await settle();
  let call = w.calls.find((c) => c.a === 'import-refills');
  assert.equal(call.body.pid, 'p1');
  assert.equal(call.body.partial, false);
  assert.ok(card.querySelector('a[href="#/branch/p1/refills"]'), 'link back to the list');

  // NGO list: rows the server matched are added to the list being built
  const ngo = makeUser({ role: 'ngo', plan: 'ngo', planName: 'NGO', lists: [] });
  const w2 = await boot({ hash: '#/optimiser', user: ngo, routes: { 'import-list': () => [200, { imported: 2, items: [{ id: 'med-1', qty: 200 }, { id: 'med-2', qty: 60 }] }] } });
  d = w2.document;
  await until(() => d.querySelector('[data-import="list"]'), 'list importer');
  card = d.querySelector('[data-import="list"]');
  card.sdLoad('medicine,quantity\nPanadol 500mg,200\nGlucophage 500mg,60\n');
  card.querySelector('[data-go]').click();
  await settle(60);
  call = w2.calls.find((c) => c.a === 'import-list');
  assert.deepEqual(Object.keys(call.body).sort(), ['csv', 'partial']);
  assert.match(d.getElementById('toast').textContent, /Medicines added to your list/);

  // company claims: {csv} goes to the claims report and the analysis is drawn
  const co = makeUser({ role: 'company', plan: 'company', planName: 'Corporate' });
  const report = { rows: [{ input: 'Augmentin 625mg', medicine: 'Augmentin 625mg', qty: 14, paid: 1150, mrp: 1100, cheapest: 'Amclav 625mg', cheapest_cost: 600, possible_saving: 550 }], unmatched: [], total_paid: 1150, total_cheapest: 600, total_mrp: 1100, possible_saving: 550, percent: 48 };
  const w3 = await boot({ hash: '#/claims', user: co, routes: { 'claims-report': () => [200, report] } });
  d = w3.document;
  await until(() => d.querySelector('[data-import="claims"]'), 'claims importer');
  card = d.querySelector('[data-import="claims"]');
  card.sdLoad('medicine,quantity,amount_paid\nAugmentin 625mg,14,1150\n');
  card.querySelector('[data-go]').click();
  await until(() => d.querySelector('#claims-result .report'), 'claims result');
  call = w3.calls.find((c) => c.a === 'claims-report');
  assert.deepEqual(call.body, { csv: 'medicine,quantity,amount_paid\nAugmentin 625mg,14,1150\n', partial: false });
  assert.match(d.getElementById('claims-result').textContent, /Amclav 625mg/);
});

test('pharmacy QR sticker still works with the shared js/qr.js', async () => {
  const w = await boot({ hash: '#/branch/p1/qr', user: makeUser() });
  await until(() => w.document.querySelector('.sticker'), 'sticker');
  assert.ok(w.document.querySelector('.sticker svg path'));
});

// ---------------------------------------------------------------------------
// js/csvkit.js and js/qr.js on their own
// ---------------------------------------------------------------------------
test('csvkit: RFC 4180 parsing, strict headers, row numbers, limits', () => {
  assert.deepEqual(SDCsv.parse('a,b\r\n"x, y","say ""hi"""\n').rows, [['a', 'b'], ['x, y', 'say "hi"']]);
  assert.match(SDCsv.parse('a,b\n"open,1\n').error, /never closed/);
  assert.match(SDCsv.parse('a,b\nx"y,1\n').error, /quote/);
  assert.equal(SDCsv.parse('﻿medicine,quantity\n').rows[0][0], 'medicine', 'BOM removed');
  const c = SDCsv.check('list', 'medicine,quantity\nPanadol,10\n\nRisek,abc\n');
  assert.equal(c.total, 2);
  assert.deepEqual(c.errors, [{ row: 4, error: 'quantity must be a whole number from 1 to 1,000,000' }]);
  assert.match(SDCsv.check('list', 'medicine,qty\nx,1\n').headerError, /medicine,quantity/);
  assert.match(SDCsv.check('list', 'medicine,quantity\n').headerError, /only has the header/);
  const many = 'medicine,quantity\n' + 'x,1\n'.repeat(5001);
  assert.match(SDCsv.check('list', many).headerError, /Too many rows/);
  assert.equal(SDCsv.check('stock', 'medicine,status,price\nA,in\n').errors[0].error, 'has 2 cells, expected 3');
  for (const type of Object.keys(SDCsv.TEMPLATES)) {
    const t = SDCsv.check(type, SDCsv.templateCsv(type));
    assert.equal(t.headerError, '', type);
    if (type !== 'overrides') assert.deepEqual(t.errors, [], type + ' example rows are valid');
  }
  assert.deepEqual(SDCsv.TEMPLATES.pharmacies.headers, ['name', 'address', 'area', 'city', 'phone', 'whatsapp', 'hours', 'lat', 'lng', 'owner_email']);
  assert.deepEqual(SDCsv.TEMPLATES.overrides.headers, ['medicine_id', 'price', 'hide', 'note']);
  assert.deepEqual(SDCsv.TEMPLATES.claims.headers, ['medicine', 'quantity', 'amount_paid']);
});

test('csvkit: images are checked by their first bytes (JPEG / PNG / WEBP only)', async () => {
  assert.equal(SDCsv.sniffImage([0xff, 0xd8, 0xff, 0xe0]), 'jpeg');
  assert.equal(SDCsv.sniffImage([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]), 'png');
  assert.equal(SDCsv.sniffImage([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]), 'webp');
  assert.equal(SDCsv.sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">')), null);
  assert.equal(SDCsv.sniffImage(Buffer.from('<html><script>')), null);
  const fake = new File(['<html>not a photo</html>'], 'photo.jpg', { type: 'image/jpeg' });
  await assert.rejects(SDCsv.checkImageFile(fake), /Only JPEG, PNG or WEBP/);
  const real = new File([Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0, 0])], 'p.jpg', { type: 'image/jpeg' });
  assert.equal(await SDCsv.checkImageFile(real), 'jpeg');
  const huge = new File([Buffer.alloc(4 * 1024 * 1024 + 1)], 'big.jpg');
  await assert.rejects(SDCsv.checkImageFile(huge), /too large/);
});

test('qr.js: shared encoder fits the 2-step login otpauth URL', () => {
  const url = 'otpauth://totp/Sasta%20Dawa%20Admin?secret=' + 'A'.repeat(32) + '&issuer=Sasta%20Dawa';
  const m = SDQR.qrMatrix(url);
  assert.equal(m.length, 41, 'version 6');
  assert.match(SDQR.qrSvg(url), /^<svg[^>]+viewBox="0 0 49 49"/);
  assert.throws(() => SDQR.qrMatrix('x'.repeat(120)), /too long/);
});

// ---------------------------------------------------------------------------
// Inside the apps (window.SastaNative from js/native.js)
// ---------------------------------------------------------------------------
test('app: Google button opens the browser via SastaNative.auth.startBrowserLogin; sd-native-login signs in', async () => {
  let started = 0;
  const user = makeUser({ role: 'patient', plan: 'free', name: 'Ayesha' });
  const w = await boot({ origin: 'https://localhost', path: '/account.html', hash: '#/signin', googleClientId: 'cid', native: () => ({ app: 'customer', auth: { startBrowserLogin: async (...args) => { started++; assert.equal(args.length, 0); } } }) });
  const d = w.document;
  await until(() => !d.getElementById('google-box').hidden, 'native google box');
  const btn = d.getElementById('native-google');
  assert.equal(btn.textContent, 'Continue with Google (opens browser)');
  assert.ok(!d.querySelector('script[src*="accounts.google.com"]'), 'GSI never loaded in the app');
  btn.click();
  await settle();
  assert.equal(started, 1);
  assert.match(d.getElementById('google-msg').textContent, /Opening your browser/);

  // failure from the app
  w.dispatchEvent(new w.CustomEvent('sd-native-login', { detail: { ok: false, error: 'The sign-in link expired.' } }));
  assert.match(d.getElementById('google-msg').textContent, /expired/);
  // success: the app already stored the token
  w.localStorage.setItem('sd_user_token', 'tok-app');
  w.localStorage.setItem('sd_user', JSON.stringify(user));
  w.dispatchEvent(new w.CustomEvent('sd-native-login', { detail: { ok: true, user } }));
  await until(() => d.querySelector('.dash-head'), 'dashboard');
  assert.match(d.querySelector('.dash-head h1').textContent, /Ayesha/);
  assert.equal(w.localStorage.getItem('sd_last_method'), 'google');
});

test('app: business app shows only business account types; customer app only Personal plus a link to the pharmacies app', async () => {
  const nat = (app) => () => ({ app, auth: { startBrowserLogin: async () => {} } });
  const w = await boot({ origin: 'https://localhost', path: '/account.html?type=pharmacy', hash: '#/signup', native: nat('business') });
  let vals = [...w.document.querySelectorAll('#signup-form input[name="role"]')].map((i) => i.value);
  assert.deepEqual(vals, ['pharmacy', 'clinic', 'ngo', 'company', 'developer']);
  assert.equal(w.document.querySelector('#signup-form input[name="role"]:checked').value, 'pharmacy');
  assert.ok(!w.document.getElementById('biz-app-link'));

  const w2 = await boot({ origin: 'https://localhost', path: '/account.html', hash: '#/signup', native: nat('customer') });
  vals = [...w2.document.querySelectorAll('#signup-form input[name="role"]')].map((i) => i.value);
  assert.deepEqual(vals, ['patient']);
  const link = w2.document.querySelector('#biz-app-link a');
  assert.match(link.getAttribute('href'), /\/download\?app=business$/);
  assert.match(link.textContent, /Sasta Dawa for Pharmacies app/);

  // the website (no SastaNative) still offers every type
  const w3 = await boot({ hash: '#/signup' });
  assert.equal(w3.document.querySelectorAll('#signup-form input[name="role"]').length, 6);
});
