// Account portal inside the Android apps (jsdom, server and window.SastaNative stubbed):
// downloads and "Print" go through SastaNative.files in the apps, the Back button needs few presses,
// the EN | اردو toggle, the business app's sign-up type, and the tap-target / RTL CSS rules.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { root } = require('./helpers/fixture');

const PLANS = { free: { name: 'Free', price: 0, roles: ['patient'] }, pharmacy_pro: { name: 'Pharmacy Pro', price: 1500, period: 'month', roles: ['pharmacy'] } };
const PHARMACY = { id: 'p1', name: 'Rehman Pharmacy', address: 'Shop 1', city: 'Islamabad', verified: true, stock: {} };
const REPORT = { pharmacy: PHARMACY, period: '30 days', totals: { view: 12, wa: 3, call: 1, dir: 2, reserve: 1, delivery: 0 }, topDemand: [{ name: 'Panadol 500mg', searches: 9 }] };

function pharmacyUser(over) {
  return Object.assign({ id: 'u_1', email: 'owner@example.com', name: 'Rehman Pharmacy', phone: '', role: 'pharmacy', plan: 'pharmacy_pro', planName: 'Pharmacy Pro', paidPlan: 'pharmacy_pro', planUntil: '2026-12-10T00:00:00.000Z', trial: false, hasPassword: true, google: false }, over || {});
}
function patientUser(over) {
  return Object.assign({ id: 'u_2', email: 'ali@example.com', name: 'Ali', phone: '', role: 'patient', plan: 'free', planName: 'Free', hasPassword: true, google: false, cabinet: [] }, over || {});
}

/** A SastaNative stub with a files bridge that records what it was given. */
function nativeStub(app, result) {
  return (w) => {
    w.saved = [];
    w.images = [];
    return {
      app,
      files: {
        save: async (name, mime, data, opts) => {
          w.saved.push({ name, mime, data, opts });
          return result === undefined ? { ok: true, uri: 'content://cache/' + name } : result;
        },
        shareImage: async (name, b64) => {
          w.images.push({ name, b64 });
          return { ok: true };
        },
      },
    };
  };
}

async function boot(opts) {
  const o = Object.assign({ path: '/account', hash: '', user: null, origin: 'http://localhost', routes: {}, lang: null }, opts);
  const html = fs.readFileSync(path.join(root, 'account.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: o.origin + o.path + o.hash, virtualConsole: new VirtualConsole() });
  const w = dom.window;
  w.scrollTo = () => {};
  w.matchMedia = () => ({ matches: false, addEventListener() {} });
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.confirm = () => true;
  w.printed = 0;
  w.print = () => w.printed++;
  w.downloads = [];
  w.URL.createObjectURL = () => 'blob:test/1';
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function () {
    if (this.download) w.downloads.push({ name: this.download });
  };
  // jsdom has no canvas: a recording 2D context is enough to check the sticker is drawn and shared.
  w.drawn = [];
  w.HTMLCanvasElement.prototype.getContext = function () {
    const ctx = { font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, textAlign: '', textBaseline: '' };
    ctx.fillRect = () => w.drawn.push('rect');
    ctx.strokeRect = () => {};
    ctx.fillText = (t) => w.drawn.push('text:' + t);
    ctx.measureText = (t) => ({ width: String(t).length * 20 });
    return ctx;
  };
  w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,iVBORw0KGgoAAAA';
  if (o.user) {
    w.localStorage.setItem('sd_user_token', 'tok');
    w.localStorage.setItem('sd_user', JSON.stringify(o.user));
  }
  if (o.lang) w.localStorage.setItem('sd_lang', o.lang);
  if (o.native) w.SastaNative = o.native(w);
  w.fetch = async (url, init) => {
    const u = new URL(String(url), 'http://localhost');
    const a = u.searchParams.get('a');
    const body = init && init.body ? JSON.parse(init.body) : null;
    let out = [404, { error: 'not found' }];
    if (o.routes[a]) out = o.routes[a](body, u);
    else if (a === 'plans') out = [200, { plans: PLANS, trialDays: 30, payTo: {}, googleClientId: null, online: {} }];
    else if (a === 'me') out = [200, { user: o.user }];
    else if (a === 'my-pharmacies') out = [200, { pharmacies: [JSON.parse(JSON.stringify(PHARMACY))] }];
    else if (a === 'payments') out = [200, { payments: [] }];
    else if (a === 'stats') out = [200, { totals: {}, days: [] }];
    else if (a === 'report') out = [200, REPORT];
    else if (a === 'export') out = [200, { user: { email: 'x@example.com' }, pharmacies: [] }];
    const [status, payload] = out;
    return { ok: status >= 200 && status < 300, status, headers: { get: () => 'application/json' }, json: async () => JSON.parse(JSON.stringify(payload)), text: async () => JSON.stringify(payload) };
  };
  for (const s of ['js/data.js', 'js/search.js', 'js/qr.js', 'js/csvkit.js', 'js/account.js']) w.eval(fs.readFileSync(path.join(root, s), 'utf8'));
  await settle();
  return w;
}
const settle = (ms) => new Promise((r) => setTimeout(r, ms || 30));
async function until(fn, label) {
  for (let i = 0; i < 200; i++) {
    if (fn()) return;
    await settle(10);
  }
  assert.fail('timed out waiting for ' + label);
}
const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
const tabLink = (w, name) => Array.from(w.document.querySelectorAll('.tabs a')).find((a) => a.textContent.trim() === name);

// ---------------------------------------------------------------------------
// 1. Downloads
// ---------------------------------------------------------------------------
test('website: "Download my data" is a normal browser download and says Downloaded', async () => {
  const w = await boot({ user: patientUser(), hash: '#/profile' });
  await until(() => w.document.querySelector('#export-data'), 'profile');
  assert.equal(w.document.querySelector('#export-data').textContent, 'Download my data');
  click(w, w.document.querySelector('#export-data'));
  await until(() => /Downloaded/.test(w.document.querySelector('#export-msg').textContent), 'downloaded message');
  assert.equal(w.downloads.length, 1);
  assert.match(w.downloads[0].name, /^sasta-dawa-my-data-\d{4}-\d{2}-\d{2}\.json$/);
});

test('app: "Download my data" goes through SastaNative.files.save (no blob link) and never claims a failed save', async () => {
  const w = await boot({ user: patientUser(), hash: '#/profile', native: nativeStub('customer') });
  await until(() => w.document.querySelector('#export-data'), 'profile');
  assert.equal(w.document.querySelector('#export-data').textContent, 'Save or share my data');
  click(w, w.document.querySelector('#export-data'));
  await until(() => w.saved.length === 1, 'native save');
  assert.equal(w.downloads.length, 0, 'no <a download> inside the app');
  assert.match(w.saved[0].name, /\.json$/);
  assert.equal(w.saved[0].mime, 'application/json');
  assert.equal(JSON.parse(w.saved[0].data).user.email, 'x@example.com');
  await until(() => /File ready/.test(w.document.querySelector('#export-msg').textContent), 'ready message');
  assert.doesNotMatch(w.document.querySelector('#export-msg').textContent, /Downloaded/);

  const w2 = await boot({ user: patientUser(), hash: '#/profile', native: nativeStub('customer', { ok: false, error: 'No space left on the phone.' }) });
  await until(() => w2.document.querySelector('#export-data'), 'profile');
  click(w2, w2.document.querySelector('#export-data'));
  await until(() => w2.saved.length === 1, 'native save attempt');
  await until(() => /No space left/.test(w2.document.querySelector('#export-msg').textContent), 'error message');
  assert.equal(w2.document.querySelector('#export-msg').className, 'form-msg bad');
  assert.doesNotMatch(w2.document.querySelector('#export-msg').textContent, /Downloaded|File ready/);
});

test('app: CSV templates are saved through the files bridge', async () => {
  const w = await boot({ user: pharmacyUser(), hash: '#/branch/p1/bulk', native: nativeStub('business') });
  await until(() => w.document.querySelector('[data-tpl]'), 'import card');
  click(w, w.document.querySelector('[data-tpl]'));
  await until(() => w.saved.length === 1, 'template saved');
  assert.equal(w.saved[0].name, 'sasta-dawa-stock-template.csv');
  assert.equal(w.saved[0].mime, 'text/csv');
  assert.equal(w.downloads.length, 0);
});

// ---------------------------------------------------------------------------
// 2. Print -> Share
// ---------------------------------------------------------------------------
test('website: monthly report keeps "Print / save as PDF" (window.print)', async () => {
  const w = await boot({ user: pharmacyUser(), hash: '#/branch/p1/report' });
  await until(() => w.document.querySelector('#print-btn'), 'report');
  assert.equal(w.document.querySelector('#print-btn').textContent, 'Print / save as PDF');
  click(w, w.document.querySelector('#print-btn'));
  assert.equal(w.printed, 1);
});

test('app: monthly report "Share report" saves a clean HTML file; WhatsApp text stays', async () => {
  const w = await boot({ user: pharmacyUser(), hash: '#/branch/p1/report', native: nativeStub('business') });
  await until(() => w.document.querySelector('#print-btn'), 'report');
  assert.equal(w.document.querySelector('#print-btn').textContent, 'Share report');
  assert.ok(w.document.querySelector('#report-copy'), 'copy-as-text is still there');
  click(w, w.document.querySelector('#print-btn'));
  await until(() => w.saved.length === 1, 'report saved');
  assert.equal(w.printed, 0, 'window.print is not used in the app');
  const f = w.saved[0];
  assert.equal(f.mime, 'text/html');
  assert.match(f.name, /^sasta-dawa-report-rehman-pharmacy-\d{4}-\d{2}-\d{2}\.html$/);
  assert.match(f.data, /^<!DOCTYPE html>/);
  assert.match(f.data, /Monthly report: Rehman Pharmacy/);
  assert.match(f.data, /Profile views/);
  assert.match(f.data, /Panadol 500mg/);
  assert.doesNotMatch(f.data, /<button|<script|<form/);
});

test('app: QR sticker "Share sticker" draws the sticker and shares it as a PNG', async () => {
  const w = await boot({ user: pharmacyUser(), hash: '#/branch/p1/qr', native: nativeStub('business') });
  await until(() => w.document.querySelector('#qr-print'), 'qr');
  assert.equal(w.document.querySelector('#qr-print').textContent, 'Share sticker');
  click(w, w.document.querySelector('#qr-print'));
  await until(() => w.images.length === 1, 'image shared');
  assert.equal(w.printed, 0);
  assert.equal(w.images[0].name, 'sasta-dawa-qr-rehman-pharmacy.png');
  assert.equal(w.images[0].b64, 'iVBORw0KGgoAAAA');
  assert.ok(w.drawn.includes('text:Rehman Pharmacy'), 'pharmacy name is on the sticker');
  assert.ok(w.drawn.filter((x) => x === 'rect').length > 50, 'QR modules are drawn');

  const web = await boot({ user: pharmacyUser(), hash: '#/branch/p1/qr' });
  await until(() => web.document.querySelector('#qr-print'), 'qr web');
  assert.equal(web.document.querySelector('#qr-print').textContent, 'Print sticker');
  click(web, web.document.querySelector('#qr-print'));
  assert.equal(web.printed, 1);
});

test('no Print button in the account code calls window.print() directly any more', () => {
  const src = fs.readFileSync(path.join(root, 'js/account.js'), 'utf8');
  assert.doesNotMatch(src, /addEventListener\('click', \(\) => window\.print\(\)\)/);
  for (const id of ['print-btn', 'qr-print', 'donor-print', 'quote-print', 'claims-print']) assert.match(src, new RegExp(`id="${id}">\\$\\{esc\\(printLabel\\(`), id + ' uses printLabel');
});

// ---------------------------------------------------------------------------
// 3. Back button: history entries
// ---------------------------------------------------------------------------
test('switching dashboard tabs replaces the history entry (customer: 1 Back press leaves Account)', async () => {
  const w = await boot({ user: patientUser(), hash: '#/medicines' });
  await until(() => tabLink(w, 'Plan & billing'), 'tabs');
  const start = w.history.length;
  for (const name of ['Plan & billing', 'Profile', 'My Medicines', 'Profile', 'Plan & billing']) {
    click(w, tabLink(w, name));
    await settle(20);
  }
  assert.equal(w.location.hash, '#/plan');
  assert.equal(w.history.length, start, 'no new entries for tab switches');
  // The Account link in the header, and Sign in <-> Create account, do not add entries either.
  click(w, w.document.querySelector('#nav-account'));
  await settle(20);
  assert.equal(w.history.length, start);
});

test('sign in <-> create account switches replace the entry', async () => {
  const w = await boot({ hash: '#/signin' });
  const start = w.history.length;
  for (let i = 0; i < 3; i++) {
    click(w, w.document.querySelector('.auth-switch a[href="#/signup"]'));
    await settle(10);
    click(w, w.document.querySelector('.auth-switch a[href="#/signin"]'));
    await settle(10);
  }
  assert.equal(w.history.length, start);
  assert.ok(w.document.querySelector('#signin-form'));
});

test('pharmacy: opening a branch adds one entry, its sections do not, and "All branches" goes back', async () => {
  const w = await boot({ user: pharmacyUser(), hash: '#/branches' });
  await until(() => w.document.querySelector('a[href="#/branch/p1/dashboard"]'), 'branch list');
  const start = w.history.length;
  click(w, w.document.querySelector('a[href="#/branch/p1/dashboard"]'));
  await until(() => w.document.querySelector('.tabs.sub'), 'branch view');
  assert.equal(w.history.length, start + 1, 'drill-down adds one entry');
  for (const sub of ['stock', 'report', 'qr', 'alerts']) {
    click(w, w.document.querySelector(`.tabs.sub a[href="#/branch/p1/${sub}"]`));
    await settle(20);
  }
  assert.equal(w.location.hash, '#/branch/p1/alerts');
  assert.equal(w.history.length, start + 1, 'branch sections replace the entry');
  // Main tabs from inside a branch: still no new entry.
  click(w, tabLink(w, 'Plan & billing'));
  await settle(20);
  assert.equal(w.history.length, start + 1);
  click(w, tabLink(w, 'My pharmacy'));
  await until(() => w.location.hash === '#/branches', 'back to branches');
  assert.equal(w.history.length, start + 1);
});

test('"← All branches" pops the branch entry instead of stacking another one', async () => {
  const w = await boot({ user: pharmacyUser(), hash: '#/branches' });
  await until(() => w.document.querySelector('a[href="#/branch/p1/dashboard"]'), 'branch list');
  const start = w.history.length;
  click(w, w.document.querySelector('a[href="#/branch/p1/dashboard"]'));
  await until(() => w.document.querySelector('.back-link'), 'branch view');
  click(w, w.document.querySelector('.tabs.sub a[href="#/branch/p1/stock"]'));
  await until(() => w.location.hash === '#/branch/p1/stock', 'stock');
  click(w, w.document.querySelector('.back-link'));
  await until(() => w.location.hash === '#/branches', 'popped to branches');
  await until(() => w.document.querySelector('a[href="#/branch/p1/dashboard"]'), 'list re-rendered');
  assert.equal(w.history.length, start + 1, 'history.back() was used (length unchanged, entry is forward)');
  // Back from here leaves Account in one press: the list entry is the first account entry.
  assert.equal(w.history.state, null);
});

test('Back (popstate) re-renders the previous screen once', async () => {
  const w = await boot({ user: pharmacyUser(), hash: '#/branches' });
  await until(() => w.document.querySelector('a[href="#/branch/p1/dashboard"]'), 'branch list');
  click(w, w.document.querySelector('a[href="#/branch/p1/report"]') || w.document.querySelector('a[href="#/branch/p1/dashboard"]'));
  await until(() => w.document.querySelector('.tabs.sub'), 'branch view');
  w.history.back();
  await until(() => w.location.hash === '#/branches' && !w.document.querySelector('.tabs.sub'), 'list after Back');
  assert.ok(w.document.querySelector('a[href="#/branch/p1/dashboard"]'));
});

// ---------------------------------------------------------------------------
// 4. Urdu
// ---------------------------------------------------------------------------
test('EN | اردو toggle: switches labels, dir=rtl, lang=ur and remembers sd_lang (shared with the main site)', async () => {
  const w = await boot({ hash: '#/signup', native: nativeStub('customer') });
  const d = w.document;
  assert.equal(d.documentElement.dir, 'ltr');
  assert.equal(d.querySelector('h1').textContent, 'Create your account');
  const ur = d.querySelector('[data-acc-lang="ur"]');
  assert.ok(ur, 'toggle in the header');
  assert.ok(ur.closest('header'));
  click(w, ur);
  await settle();
  assert.equal(d.documentElement.dir, 'rtl');
  assert.equal(d.documentElement.lang, 'ur');
  assert.equal(w.localStorage.getItem('sd_lang'), 'ur');
  assert.equal(ur.getAttribute('aria-pressed'), 'true');
  assert.equal(d.querySelector('h1').textContent, 'اپنا اکاؤنٹ بنائیں');
  assert.match(d.querySelector('.terms-check').textContent, /شرائط و ضوابط/);
  assert.equal(d.querySelector('.auth-switch a[href="#/signin"]').textContent, 'سائن اِن');
  assert.equal(d.querySelector('#nav-account').textContent, 'اکاؤنٹ');
  assert.match(d.querySelector('.type-opt').textContent, /ذاتی/);
  // Errors are in Urdu too.
  d.querySelector('#signup-form').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await settle();
  assert.equal(d.querySelector('#signup-form > .form-msg').textContent, 'براہ کرم اپنا نام (یا کاروبار کا نام) لکھیں۔');
  // and back to English
  click(w, d.querySelector('[data-acc-lang="en"]'));
  await settle();
  assert.equal(d.documentElement.dir, 'ltr');
  assert.equal(d.querySelector('h1').textContent, 'Create your account');
  assert.equal(w.localStorage.getItem('sd_lang'), 'en');
});

test('Urdu chosen on the main site opens Account in Urdu: dashboard, profile, delete account', async () => {
  const user = patientUser({ prevLogin: { method: 'google', at: '2026-11-20T10:00:00Z', device: 'Chrome on Android' }, lastLogin: { method: 'password', at: '2026-11-26T10:00:00Z' } });
  const w = await boot({ user, hash: '#/profile', lang: 'ur' });
  const d = w.document;
  await until(() => d.querySelector('#export-data'), 'profile');
  assert.equal(d.documentElement.dir, 'rtl');
  assert.equal(d.querySelector('.dash-head h1').textContent, 'السلام علیکم، Ali');
  assert.equal(tabLink(w, 'میری دوائیں').getAttribute('href'), '#/medicines');
  assert.ok(tabLink(w, 'پروفائل'));
  assert.match(d.querySelector('#last-login').textContent, /پچھلی بار سائن اِن: گوگل/);
  assert.equal(d.querySelector('#export-data').textContent, 'میرا ڈیٹا ڈاؤن لوڈ کریں');
  assert.ok(Array.from(d.querySelectorAll('.card h2')).some((h) => h.textContent === 'اکاؤنٹ ختم کریں'));
  assert.ok(Array.from(d.querySelectorAll('button')).some((b) => b.textContent === 'میرا اکاؤنٹ ختم کریں'));
  assert.equal(d.querySelector('.brand-sub').textContent, 'اکاؤنٹ');
  click(w, tabLink(w, 'پلان اور ادائیگی'));
  await until(() => d.querySelector('#join-form'), 'plan tab');
  assert.ok(Array.from(d.querySelectorAll('.card h2')).some((h) => h.textContent === 'کمپنی کی سہولت میں شامل ہوں'));
});

// ---------------------------------------------------------------------------
// 5. Which account types the sign-up offers
// ---------------------------------------------------------------------------
const roles = (w) => Array.from(w.document.querySelectorAll('#signup-form input[name="role"]')).map((i) => i.value);
const checked = (w) => (w.document.querySelector('#signup-form input[name="role"]:checked') || {}).value;

test('browser opened by the business app (?app=business): pharmacy preselected, no Personal', async () => {
  const w = await boot({ path: '/account?app=business', hash: '#/signup' });
  assert.ok(!roles(w).includes('patient'));
  assert.equal(checked(w), 'pharmacy');
  const w2 = await boot({ path: '/account?app=business&type=pharmacy', hash: '#/signup' });
  assert.equal(checked(w2), 'pharmacy');
  const w3 = await boot({ path: '/account?app=business&type=patient', hash: '#/signup' });
  assert.equal(checked(w3), 'pharmacy', 'a personal type is never preselected for the business app');
  const w4 = await boot({ path: '/account?app=business&type=clinic', hash: '#/signup' });
  assert.equal(checked(w4), 'clinic');
});

test('browser opened by the customer app (?app=customer): Personal only; plain website: all types', async () => {
  const w = await boot({ path: '/account?app=customer', hash: '#/signup' });
  assert.deepEqual(roles(w), ['patient']);
  assert.equal(checked(w), 'patient');
  const web = await boot({ hash: '#/signup' });
  assert.ok(roles(web).includes('patient') && roles(web).includes('pharmacy'));
  assert.equal(checked(web), 'patient');
});

// ---------------------------------------------------------------------------
// 6. CSS: tap targets and RTL-safe honeypot
// ---------------------------------------------------------------------------
test('account.css: 32px checkboxes in 48px rows, 48px brand link, honeypot without offsets', () => {
  const css = fs.readFileSync(path.join(root, 'css/account.css'), 'utf8');
  assert.match(css, /\.check \{[^}]*min-height: 48px/);
  assert.match(css, /\.check input \{[^}]*inline-size: 32px; block-size: 32px/);
  assert.match(css, /\.acc-top \.brand \{[^}]*min-block-size: 48px/);
  const hp = css.match(/\n\.hp \{([^}]*)\}/);
  assert.ok(hp, '.hp rule');
  assert.match(hp[1], /clip-path: inset\(50%\)/);
  assert.match(hp[1], /left: auto/);
  assert.doesNotMatch(css, /-9999px/);
});

test('signup form: honeypot is still there and the terms checkbox is inside its clickable label', async () => {
  const w = await boot({ hash: '#/signup' });
  const hp = w.document.querySelector('#signup-form .hp input[name="website"]');
  assert.ok(hp);
  assert.equal(hp.tabIndex, -1);
  const box = w.document.querySelector('#accept-terms');
  assert.ok(box.closest('label.check'));
  click(w, box.closest('label.check').querySelector('span'));
  assert.equal(box.checked, true, 'tapping the text ticks the box');
});

test('pharmacies app + Personal account: shows "Make this a business account" and converts', async () => {
  let sent = null;
  const w = await boot({ user: patientUser(), native: nativeStub('business'), routes: { 'become-business': (b) => { sent = b; return [200, { user: pharmacyUser({ name: 'Ali' }) }]; } } });
  await until(() => w.document.querySelector('#convert-form'), 'convert card');
  assert.equal(w.document.querySelector('#convert-form select').value, 'pharmacy');
  w.document.querySelector('#convert-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => sent && !w.document.querySelector('#convert-form'), 'converted');
  assert.deepEqual(sent, { role: 'pharmacy' });
  assert.equal(JSON.parse(w.localStorage.getItem('sd_user')).role, 'pharmacy');
});

test('customer app + Personal account: no convert card', async () => {
  const w = await boot({ user: patientUser(), native: nativeStub('customer') });
  await settle(80);
  assert.equal(w.document.querySelector('#convert-form'), null);
});
