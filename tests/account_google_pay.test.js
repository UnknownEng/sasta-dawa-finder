// Account portal (account.html + js/account.js) in jsdom: Sign in with Google, Google-only profile,
// Pay online with JazzCash and the payment return banner. Google and the server are stubbed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { root } = require('./helpers/fixture');

const PLANS = {
  free: { name: 'Free', price: 0, roles: ['patient'] },
  pharmacy_pro: { name: 'Pharmacy Pro', price: 1500, period: 'month', roles: ['pharmacy'] },
  pharmacy_premium: { name: 'Pharmacy Premium', price: 4000, period: 'month', roles: ['pharmacy'] },
};
const CLIENT_ID = 'test-client.apps.googleusercontent.com';

function makeUser(over) {
  return Object.assign({ id: 'u_1', email: 'owner@example.com', name: 'Rehman Pharmacy', phone: '', role: 'pharmacy', plan: 'pharmacy_pro', planName: 'Pharmacy Pro', paidPlan: 'pharmacy_pro', planUntil: '2026-12-10T00:00:00.000Z', trial: true, hasPassword: true, google: false }, over || {});
}

/**
 * Boots the portal. opts: url hash, googleClientId, jazzcash, user (signed in when set), gsi (stub google), routes {action: fn(body) -> [status, json]}.
 */
async function boot(opts) {
  const o = Object.assign({ hash: '', googleClientId: CLIENT_ID, jazzcash: false, user: null, gsi: true, origin: 'http://localhost', routes: {} }, opts);
  const html = fs.readFileSync(path.join(root, 'account.html'), 'utf8');
  const vc = new VirtualConsole(); // keep jsdom "not implemented" noise out of the test output
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: o.origin + '/account' + o.hash, virtualConsole: vc });
  const w = dom.window;
  w.scrollTo = () => {};
  w.matchMedia = () => ({ matches: false, addEventListener() {} });
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.calls = [];
  w.submitted = [];
  w.HTMLFormElement.prototype.submit = function () {
    w.submitted.push(this);
  };
  if (o.user) {
    w.localStorage.setItem('sd_user_token', 'tok-old');
    w.localStorage.setItem('sd_user', JSON.stringify(o.user));
  }
  w.gsi = { init: [], render: [] };
  if (o.gsi) {
    w.google = {
      accounts: {
        id: {
          initialize(cfg) {
            w.gsi.init.push(cfg);
          },
          renderButton(el, cfg) {
            w.gsi.render.push({ el, cfg });
            el.innerHTML = '<div class="gsi-stub">Sign in with Google</div>';
          },
        },
      },
    };
  }
  w.fetch = async (url, init) => {
    const u = new URL(String(url), 'http://localhost');
    const a = u.searchParams.get('a');
    const body = init && init.body ? JSON.parse(init.body) : null;
    w.calls.push({ a, body, auth: init && init.headers && init.headers.Authorization });
    let out = [404, { error: 'not found' }];
    if (o.routes[a]) out = o.routes[a](body);
    else if (a === 'plans') out = [200, { plans: PLANS, trialDays: 30, payTo: { title: 'Maverick', jazzcash: '0300 0000000' }, googleClientId: o.googleClientId, online: { jazzcash: o.jazzcash } }];
    else if (a === 'me') out = [200, { user: o.user }];
    else if (a === 'payments') out = [200, { payments: [] }];
    return { ok: out[0] >= 200 && out[0] < 300, status: out[0], json: async () => JSON.parse(JSON.stringify(out[1])) };
  };
  for (const s of ['js/data.js', 'js/search.js', 'js/account.js']) w.eval(fs.readFileSync(path.join(root, s), 'utf8'));
  await settle();
  return w;
}
const settle = (ms) => new Promise((r) => setTimeout(r, ms || 30));
async function until(fn, label) {
  for (let i = 0; i < 100; i++) {
    if (fn()) return;
    await settle(10);
  }
  assert.fail('timed out waiting for ' + label);
}

test('sign in: Google button is rendered with the client id, outline/large/signin_with, plus an "or" divider', async () => {
  const w = await boot({ hash: '#/signin' });
  const d = w.document;
  await until(() => !d.getElementById('google-box').hidden, 'google box');
  assert.equal(d.getElementById('google-btn').getAttribute('data-client-id'), CLIENT_ID);
  assert.equal(w.gsi.init.length, 1);
  assert.equal(w.gsi.init[0].client_id, CLIENT_ID);
  assert.equal(typeof w.gsi.init[0].callback, 'function');
  const r = w.gsi.render[0];
  assert.equal(r.el.id, 'google-btn');
  assert.equal(r.cfg.theme, 'outline');
  assert.equal(r.cfg.size, 'large');
  assert.equal(r.cfg.text, 'signin_with');
  assert.ok(r.cfg.width >= 200 && r.cfg.width <= 400);
  assert.match(d.querySelector('#google-box .or-divider').textContent, /or/);
  assert.ok(d.getElementById('signin-form'), 'email form still there');
});

test('no googleClientId: nothing Google is shown and the script is never loaded', async () => {
  const w = await boot({ hash: '#/signin', googleClientId: null, gsi: false });
  const d = w.document;
  await settle(50);
  assert.ok(d.getElementById('google-box').hidden);
  assert.equal(d.querySelector('#google-btn').innerHTML, '');
  assert.ok(!d.querySelector('script[src*="accounts.google.com"]'));
});

test('client id but GSI not yet on the page: loads https://accounts.google.com/gsi/client once, async', async () => {
  const w = await boot({ hash: '#/signin', gsi: false });
  const d = w.document;
  await settle(50);
  const scripts = d.querySelectorAll('script[src="https://accounts.google.com/gsi/client"]');
  assert.equal(scripts.length, 1);
  assert.ok(scripts[0].async);
  assert.ok(d.getElementById('google-box').hidden, 'stays hidden until the script loads');
  w.location.hash = '#/signup';
  await settle(50);
  assert.equal(d.querySelectorAll('script[src="https://accounts.google.com/gsi/client"]').length, 1, 'not loaded twice');
});

test('inside the Capacitor app (https://localhost) the Google button is hidden', async () => {
  const w = await boot({ hash: '#/signin', origin: 'https://localhost' });
  await settle(50);
  assert.ok(w.document.getElementById('google-box').hidden);
  assert.equal(w.gsi.render.length, 0);
});

test('create account with Google: sends credential + chosen account type, stores the session, shows the dashboard', async () => {
  const user = makeUser({ hasPassword: false, google: true });
  const w = await boot({
    hash: '#/signup',
    routes: { google: () => [200, { ok: true, created: true, token: 'tok-google', user }] },
  });
  const d = w.document;
  await until(() => w.gsi.render.length, 'render');
  assert.equal(w.gsi.render[0].cfg.text, 'signup_with');
  d.querySelector('#signup-form input[name="role"][value="pharmacy"]').checked = true;
  await w.gsi.init[0].callback({ credential: 'fake.id.token' });
  await settle();
  const call = w.calls.find((c) => c.a === 'google');
  assert.deepEqual(call.body, { credential: 'fake.id.token', role: 'pharmacy' });
  assert.equal(w.localStorage.getItem('sd_user_token'), 'tok-google');
  assert.equal(JSON.parse(w.localStorage.getItem('sd_user')).email, 'owner@example.com');
  await until(() => d.querySelector('.dash-head'), 'dashboard');
  assert.match(d.querySelector('.dash-head h1').textContent, /Rehman Pharmacy/);
});

test('sign in with Google: no role is sent; a failure shows a friendly message and stays signed out', async () => {
  const w = await boot({ hash: '#/signin', routes: { google: () => [401, { error: 'Google sign-in failed. Please try again.' }] } });
  const d = w.document;
  await until(() => w.gsi.render.length, 'render');
  await w.gsi.init[0].callback({ credential: 'bad' });
  await settle();
  assert.deepEqual(w.calls.find((c) => c.a === 'google').body, { credential: 'bad' });
  assert.match(d.getElementById('google-msg').textContent, /Google sign-in failed/);
  assert.equal(w.localStorage.getItem('sd_user_token'), null);
  assert.ok(d.getElementById('signin-form'));
  await w.gsi.init[0].callback({});
  assert.match(d.getElementById('google-msg').textContent, /cancelled/);
});

test('signup form errors still appear in the signup form message, not the Google one', async () => {
  const w = await boot({ hash: '#/signup' });
  const d = w.document;
  await until(() => w.gsi.render.length, 'render');
  d.getElementById('signup-form').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await settle();
  assert.match(d.querySelector('#signup-form > .form-msg').textContent, /name/);
  assert.equal(d.getElementById('google-msg').textContent, '');
});

test('Google-only profile: "You sign in with Google", Set a password (no current field), delete asks for DELETE', async () => {
  const user = makeUser({ hasPassword: false, google: true });
  const w = await boot({
    hash: '#/profile',
    user,
    routes: { 'change-password': () => [200, { ok: true, token: 'tok-new' }], 'delete-account': () => [200, { ok: true }] },
  });
  const d = w.document;
  await until(() => d.getElementById('password-form'), 'profile');
  const tab = d.getElementById('tab');
  assert.match(tab.textContent, /You sign in with Google/);
  assert.match(tab.textContent, /Google connected/);
  const pf = d.getElementById('password-form');
  assert.equal(pf.closest('.card').querySelector('h2').textContent, 'Set a password');
  assert.ok(!pf.querySelector('input[name="current"]'));
  pf.querySelector('input[name="password"]').value = 'newpassword1';
  pf.dispatchEvent(new w.Event('submit', { cancelable: true }));
  await settle();
  assert.deepEqual(w.calls.find((c) => c.a === 'change-password').body, { password: 'newpassword1' });
  assert.equal(w.localStorage.getItem('sd_user_token'), 'tok-new');
  // after setting a password the form becomes "Change password" with a current field
  assert.ok(d.querySelector('#password-form input[name="current"]'));
  assert.ok(d.querySelector('#delete-form input[name="password"]'));
});

test('Google-only delete: wrong word is refused, DELETE posts {confirm:"DELETE"}', async () => {
  const user = makeUser({ hasPassword: false, google: true });
  const w = await boot({ hash: '#/profile', user, routes: { 'delete-account': () => [200, { ok: true }] } });
  const d = w.document;
  await until(() => d.getElementById('delete-form'), 'profile');
  const f = d.getElementById('delete-form');
  assert.ok(!f.querySelector('input[name="password"]'));
  const box = f.querySelector('input[name="confirm"]');
  assert.ok(box.closest('label').textContent.includes('Type DELETE'));
  box.value = 'yes';
  f.querySelector('input[name="sure"]').checked = true;
  f.dispatchEvent(new w.Event('submit', { cancelable: true }));
  await settle();
  assert.ok(!w.calls.some((c) => c.a === 'delete-account'));
  assert.match(f.querySelector('.form-msg').textContent, /DELETE/);
  box.value = 'delete';
  f.dispatchEvent(new w.Event('submit', { cancelable: true }));
  await settle();
  assert.deepEqual(w.calls.find((c) => c.a === 'delete-account').body, { confirm: 'DELETE' });
  assert.equal(w.localStorage.getItem('sd_user_token'), null);
});

test('password account: profile keeps Change password and password-confirmed delete; no Google lines', async () => {
  const w = await boot({ hash: '#/profile', user: makeUser() });
  const d = w.document;
  await until(() => d.getElementById('password-form'), 'profile');
  assert.ok(d.querySelector('#password-form input[name="current"]'));
  assert.ok(d.querySelector('#delete-form input[name="password"]'));
  assert.ok(!/Google/.test(d.getElementById('tab').textContent));
});

test('Pay online with JazzCash: posts plan + periods, then submits a hidden POST form with exactly the API fields', async () => {
  const fields = { pp_Version: '1.1', pp_TxnType: 'MWALLET', pp_MerchantID: 'MC1', pp_TxnRefNo: 'T1764200000000AB', pp_Amount: '300000', pp_SecureHash: 'ABC"<x>' };
  const w = await boot({
    hash: '#/plan',
    user: makeUser(),
    jazzcash: true,
    routes: { 'pay-online': () => [200, { ok: true, payment: { status: 'pending' }, form: { action: 'https://sandbox.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform/', method: 'POST', fields } }] },
  });
  const d = w.document;
  await until(() => d.getElementById('pay-online'), 'plan view');
  const btn = d.getElementById('pay-online');
  assert.equal(btn.textContent, 'Pay online with JazzCash');
  assert.ok(btn.compareDocumentPosition(d.getElementById('pay-form')) & w.Node.DOCUMENT_POSITION_FOLLOWING, 'online option is above the manual form');
  assert.match(d.querySelector('.pay-or').textContent, /Or pay by transfer and enter the transaction ID/);
  d.getElementById('pay-plan').value = 'pharmacy_premium';
  d.getElementById('pay-periods').value = '3';
  d.getElementById('pay-periods').dispatchEvent(new w.Event('change'));
  assert.match(d.getElementById('pay-amount').textContent, /12,000/);
  btn.click();
  await settle();
  assert.deepEqual(w.calls.find((c) => c.a === 'pay-online').body, { plan: 'pharmacy_premium', periods: 3 });
  assert.equal(w.submitted.length, 1);
  const f = w.submitted[0];
  assert.equal(f.getAttribute('action'), 'https://sandbox.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform/');
  assert.equal(f.method.toLowerCase(), 'post');
  const inputs = Array.from(f.querySelectorAll('input'));
  assert.ok(inputs.every((i) => i.type === 'hidden'));
  assert.deepEqual(Object.fromEntries(inputs.map((i) => [i.name, i.value])), fields);
  assert.ok(f.isConnected);
});

test('pay-online error (503) shows the message and re-enables the button', async () => {
  const w = await boot({ hash: '#/plan', user: makeUser(), jazzcash: true, routes: { 'pay-online': () => [503, { error: 'Online payment is not switched on yet.' }] } });
  const d = w.document;
  await until(() => d.getElementById('pay-online'), 'plan view');
  d.getElementById('pay-online').click();
  await settle();
  assert.match(d.getElementById('pay-online-msg').textContent, /not switched on/);
  assert.equal(d.getElementById('pay-online').disabled, false);
  assert.equal(w.submitted.length, 0);
});

test('online.jazzcash false: only the manual transfer form (as before)', async () => {
  const w = await boot({ hash: '#/plan', user: makeUser(), jazzcash: false });
  const d = w.document;
  await until(() => d.getElementById('pay-form'), 'plan view');
  assert.ok(!d.getElementById('pay-online'));
  assert.ok(!d.querySelector('.pay-or'));
  assert.ok(d.getElementById('pay-plan') && d.getElementById('pay-periods'));
});

test('return with ?payment=success: refreshes the account, shows "active until <date>", cleans the URL', async () => {
  const before = makeUser({ trial: true, planUntil: '2026-12-10T00:00:00.000Z' });
  const after = makeUser({ trial: false, planUntil: '2027-01-26T00:00:00.000Z' });
  let meCalls = 0;
  const w = await boot({
    hash: '#/plan?payment=success',
    user: before,
    routes: {
      me: () => {
        meCalls++;
        return [200, { user: after }];
      },
    },
  });
  const d = w.document;
  await until(() => d.getElementById('pay-result'), 'banner');
  assert.ok(meCalls >= 1);
  const b = d.getElementById('pay-result');
  assert.match(b.textContent, /Payment received/);
  assert.match(b.textContent, /active until 26 Jan 2027/);
  assert.equal(w.location.hash, '#/plan');
  assert.ok(!w.location.href.includes('payment='));
  // leaving the tab drops the banner
  w.location.hash = '#/profile';
  await settle();
  w.location.hash = '#/plan';
  await until(() => d.getElementById('pay-form'), 'plan again');
  assert.ok(!d.getElementById('pay-result'));
});

test('return with ?payment=failed / error: "did not go through" banner, URL cleaned', async () => {
  const w = await boot({ hash: '#/plan?payment=failed', user: makeUser() });
  const d = w.document;
  await until(() => d.getElementById('pay-result'), 'banner');
  assert.match(d.getElementById('pay-result').textContent, /Payment did not go through\. You were not charged\./);
  assert.match(d.getElementById('pay-result').textContent, /pay by transfer/);
  assert.equal(w.location.hash, '#/plan');

  const w2 = await boot({ hash: '#/plan?payment=error', user: makeUser() });
  await until(() => w2.document.getElementById('pay-result'), 'banner 2');
  assert.match(w2.document.getElementById('pay-result').textContent, /did not go through/);
  assert.ok(w2.document.querySelector('#pay-result a[href^="https://wa.me/"]'));
  assert.equal(w2.location.hash, '#/plan');
});
