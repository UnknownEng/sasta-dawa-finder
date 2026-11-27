// Google sign-in and JazzCash online payment (lib/platform.js). No real Google or JazzCash calls:
// the Google check is replaced by a fake, and JazzCash replies are built with the same secure hash.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-authpay-'));
process.env.SD_DATA_DIR = DIR;
process.env.ADMIN_PASSWORD = 'admin-pass-123';
process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
process.env.JAZZCASH_MERCHANT_ID = 'MC12345';
process.env.JAZZCASH_PASSWORD = 'jc-pass';
process.env.JAZZCASH_INTEGRITY_SALT = 'salt123';
process.env.JAZZCASH_SANDBOX = '1';
delete process.env.ANTHROPIC_API_KEY;
delete process.env.VERCEL;
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.BLOB_STORE_ID;

const { server } = require('../server');
const platform = require('../lib/platform');

let port;
let ip = 0;
function call(p, { method, body, headers, raw } = {}) {
  return new Promise((resolve, reject) => {
    const data = raw !== undefined ? raw : body === undefined ? null : JSON.stringify(body);
    const ctype = raw !== undefined ? 'application/x-www-form-urlencoded' : 'application/json';
    const req = http.request({ port, path: p, method: method || (data ? 'POST' : 'GET'), headers: { 'X-Forwarded-For': '10.8.0.' + ++ip, ...(data ? { 'Content-Type': ctype } : {}), ...(headers || {}) } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        let j = null;
        try { j = JSON.parse(text); } catch (e) { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, body: j, text });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
const B = (t) => ({ Authorization: 'Bearer ' + t });

// Fake Google: token "good:<sub>:<email>:<name>" is valid for our client id.
platform._setGoogleVerifier(async (cred) => {
  const [kind, sub, email, name] = cred.split(':');
  const base = { iss: 'https://accounts.google.com', aud: process.env.GOOGLE_CLIENT_ID, sub, email, name, email_verified: 'true', exp: String(Math.floor(Date.now() / 1000) + 600) };
  if (kind === 'good') return base;
  if (kind === 'otheraud') return { ...base, aud: 'someone-else' };
  if (kind === 'unverified') return { ...base, email_verified: 'false' };
  if (kind === 'expired') return { ...base, exp: '1000' };
  throw new Error('invalid token');
});

test('Google sign-in and JazzCash online payments', async (t) => {
  await new Promise((r) => server.listen(0, r));
  port = server.address().port;
  t.after(() => { server.close(); fs.rmSync(DIR, { recursive: true, force: true }); });

  await t.test('plans tell the browser what is switched on', async () => {
    const r = await call('/api/account?a=plans');
    assert.equal(r.body.googleClientId, process.env.GOOGLE_CLIENT_ID);
    assert.equal(r.body.online.jazzcash, true);
  });

  let gToken;
  await t.test('Google sign-in creates an account, then signs the same person in', async () => {
    let r = await call('/api/account?a=google', { body: { credential: 'good:g-111:ayesha@gmail.com:Ayesha Khan', role: 'pharmacy' } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.created, true);
    assert.equal(r.body.user.role, 'pharmacy');
    assert.equal(r.body.user.trial, true);
    assert.equal(r.body.user.google, true);
    assert.equal(r.body.user.hasPassword, false);
    gToken = r.body.token;
    r = await call('/api/account?a=google', { body: { credential: 'good:g-111:ayesha@gmail.com:Ayesha Khan' } });
    assert.equal(r.body.created, false);
    assert.equal(r.body.user.role, 'pharmacy', 'role is kept on later sign-ins');
    r = await call('/api/account?a=me', { headers: B(r.body.token) });
    assert.equal(r.body.user.email, 'ayesha@gmail.com');
  });

  await t.test('bad Google tokens are refused', async () => {
    for (const cred of ['otheraud:x:a@b.com:A', 'unverified:x:c@d.com:C', 'expired:x:e@f.com:E', 'garbage', '']) {
      const r = await call('/api/account?a=google', { body: { credential: cred } });
      assert.equal(r.status, 401, cred);
    }
    // same email, different Google account: refused
    const r = await call('/api/account?a=google', { body: { credential: 'good:g-999:ayesha@gmail.com:Imposter' } });
    assert.equal(r.status, 401);
  });

  await t.test('existing email account gets linked to Google', async () => {
    let r = await call('/api/account?a=signup', { body: { email: 'bilal@gmail.com', name: 'Bilal', password: 'bilal-pass-1' } });
    assert.equal(r.status, 200);
    r = await call('/api/account?a=google', { body: { credential: 'good:g-222:bilal@gmail.com:Bilal' } });
    assert.equal(r.body.created, false);
    assert.equal(r.body.user.google, true);
    assert.equal(r.body.user.hasPassword, true);
    r = await call('/api/account?a=login', { body: { email: 'bilal@gmail.com', password: 'bilal-pass-1' } });
    assert.equal(r.status, 200, 'password still works');
  });

  await t.test('Google-only account can set a password and delete with DELETE', async () => {
    let r = await call('/api/account?a=change-password', { headers: B(gToken), body: { password: 'new-pass-123' } });
    assert.equal(r.status, 200, r.text);
    r = await call('/api/account?a=login', { body: { email: 'ayesha@gmail.com', password: 'new-pass-123' } });
    assert.equal(r.status, 200);
    const g2 = (await call('/api/account?a=google', { body: { credential: 'good:g-333:sara@gmail.com:Sara' } })).body.token;
    r = await call('/api/account?a=delete-account', { headers: B(g2), body: { confirm: 'nope' } });
    assert.equal(r.status, 400);
    r = await call('/api/account?a=delete-account', { headers: B(g2), body: { confirm: 'delete' } });
    assert.equal(r.status, 200);
  });

  await t.test('JazzCash: checkout form, successful payment upgrades the plan', async () => {
    const login = await call('/api/account?a=google', { body: { credential: 'good:g-111:ayesha@gmail.com:Ayesha Khan' } });
    const tk = B(login.body.token);
    let r = await call('/api/account?a=pay-online', { headers: tk, body: { plan: 'api' } });
    assert.equal(r.status, 400, 'pharmacy cannot buy API plan');
    r = await call('/api/account?a=pay-online', { headers: tk, body: { plan: 'pharmacy_premium', periods: 2 } });
    assert.equal(r.status, 200, r.text);
    const { form, payment } = r.body;
    assert.match(form.action, /sandbox\.jazzcash\.com\.pk/);
    assert.equal(form.fields.pp_Amount, '1000000', 'Rs 10,000 in paisa');
    assert.equal(form.fields.pp_MerchantID, 'MC12345');
    assert.match(form.fields.pp_ReturnURL, /\/api\/places\?a=jazzcash-return$/);
    assert.equal(form.fields.pp_SecureHash, platform._jazzcash.hash(form.fields));
    assert.equal(payment.status, 'pending');

    // JazzCash posts the result back to the return URL
    const reply = { pp_ResponseCode: '000', pp_ResponseMessage: 'Thank you', pp_TxnRefNo: form.fields.pp_TxnRefNo, pp_Amount: form.fields.pp_Amount, pp_MerchantID: 'MC12345', pp_RetreivalReferenceNo: '123456789' };
    reply.pp_SecureHash = platform._jazzcash.hash(reply);
    r = await call('/api/places?a=jazzcash-return', { raw: new URLSearchParams(reply).toString() });
    assert.equal(r.status, 303);
    assert.match(r.headers.location, /payment=success/);
    r = await call('/api/account?a=me', { headers: tk });
    assert.equal(r.body.user.plan, 'pharmacy_premium');
    assert.equal(r.body.user.trial, false);
    assert.ok(Date.parse(r.body.user.planUntil) > Date.now() + 55 * 864e5);
    // replaying the same reply does not add more time
    const until = r.body.user.planUntil;
    await call('/api/places?a=jazzcash-return', { raw: new URLSearchParams(reply).toString() });
    r = await call('/api/account?a=me', { headers: tk });
    assert.equal(r.body.user.planUntil, until);
    r = await call('/api/account?a=payments', { headers: tk });
    assert.equal(r.body.payments[0].status, 'approved');
  });

  await t.test('JazzCash: forged, tampered or failed replies never upgrade', async () => {
    const login = await call('/api/account?a=signup', { body: { email: 'clinic@gmail.com', name: 'Clinic', password: 'clinic-pass-1', role: 'clinic' } });
    const tk = B(login.body.token);
    const start = async () => (await call('/api/account?a=pay-online', { headers: tk, body: { plan: 'clinic' } })).body.form.fields;
    // forged hash
    let f = await start();
    let reply = { pp_ResponseCode: '000', pp_TxnRefNo: f.pp_TxnRefNo, pp_Amount: f.pp_Amount, pp_SecureHash: 'ABC' };
    let r = await call('/api/places?a=jazzcash-return', { raw: new URLSearchParams(reply).toString() });
    assert.match(r.headers.location, /payment=error/);
    // amount changed after signing -> hash no longer matches
    reply = { pp_ResponseCode: '000', pp_TxnRefNo: f.pp_TxnRefNo, pp_Amount: f.pp_Amount };
    reply.pp_SecureHash = platform._jazzcash.hash(reply);
    reply.pp_Amount = '100';
    r = await call('/api/places?a=jazzcash-return', { raw: new URLSearchParams(reply).toString() });
    assert.match(r.headers.location, /payment=error/);
    // correctly signed but less money than the plan costs
    f = await start();
    reply = { pp_ResponseCode: '000', pp_TxnRefNo: f.pp_TxnRefNo, pp_Amount: '100' };
    reply.pp_SecureHash = platform._jazzcash.hash(reply);
    r = await call('/api/places?a=jazzcash-return', { raw: new URLSearchParams(reply).toString() });
    assert.match(r.headers.location, /payment=failed/);
    // declined by JazzCash
    f = await start();
    reply = { pp_ResponseCode: '124', pp_ResponseMessage: 'Declined', pp_TxnRefNo: f.pp_TxnRefNo, pp_Amount: f.pp_Amount };
    reply.pp_SecureHash = platform._jazzcash.hash(reply);
    r = await call('/api/places?a=jazzcash-return', { raw: new URLSearchParams(reply).toString() });
    assert.match(r.headers.location, /payment=failed/);
    r = await call('/api/account?a=me', { headers: tk });
    assert.equal(r.body.user.trial, true, 'still on the free trial, nothing granted');
  });

  await t.test('switched off without keys', async () => {
    const saved = { g: process.env.GOOGLE_CLIENT_ID, m: process.env.JAZZCASH_MERCHANT_ID };
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.JAZZCASH_MERCHANT_ID;
    let r = await call('/api/account?a=plans');
    assert.equal(r.body.googleClientId, null);
    assert.equal(r.body.online.jazzcash, false);
    r = await call('/api/account?a=google', { body: { credential: 'good:g-1:x@y.com:X' } });
    assert.equal(r.status, 503);
    process.env.GOOGLE_CLIENT_ID = saved.g;
    process.env.JAZZCASH_MERCHANT_ID = saved.m;
  });
});
