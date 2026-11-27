// Browser -> app login handoff (app-code / app-exchange), last login method, and terms acceptance.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-handoff-'));
process.env.SD_DATA_DIR = DIR;
process.env.ADMIN_PASSWORD = 'admin-pass-123';
process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
delete process.env.VERCEL;
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.BLOB_STORE_ID;

const { server } = require('../server');
const platform = require('../lib/platform');
const { client, bearer } = require('./_http');

platform._setGoogleVerifier(async (cred) => {
  const [, sub, email, name] = cred.split(':');
  return { iss: 'https://accounts.google.com', aud: process.env.GOOGLE_CLIENT_ID, sub, email, name, email_verified: true, exp: String(Math.floor(Date.now() / 1000) + 600) };
});

let port;
const call = client(() => port);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36';
const WINDOWS_FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0';

test('app handoff, last login, terms', async (t) => {
  await new Promise((r) => server.listen(0, r));
  port = server.address().port;
  t.after(() => {
    server.close();
    fs.rmSync(DIR, { recursive: true, force: true });
  });

  let token;
  let uid;

  await t.test('sign-up requires acceptTerms and stores the terms version', async () => {
    let r = await call('/api/account?a=signup', { body: { email: 'amna@example.com', name: 'Amna', password: 'amna-pass-1' } });
    assert.equal(r.status, 400);
    assert.equal(r.body.needTerms, true);
    r = await call('/api/account?a=signup', { body: { email: 'amna@example.com', name: 'Amna', password: 'amna-pass-1', acceptTerms: 'yes' } });
    assert.equal(r.status, 400, 'must be literally true');
    r = await call('/api/account?a=signup', { headers: { 'User-Agent': WINDOWS_FIREFOX }, body: { email: 'amna@example.com', name: 'Amna', password: 'amna-pass-1', acceptTerms: true } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.user.termsVersion, '2026-11-27');
    assert.deepEqual([r.body.user.lastLogin.method, r.body.user.lastLogin.device], ['password', 'Firefox on Windows']);
    assert.equal(r.body.user.prevLogin, null);
    token = r.body.token;
    uid = r.body.user.id;
    const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'users', uid + '.json'), 'utf8'));
    assert.equal(raw.termsVersion, '2026-11-27');
    assert.ok(Date.parse(raw.termsAcceptedAt) > Date.now() - 60000);
  });

  await t.test('Google sign-up requires acceptTerms; later Google sign-ins do not', async () => {
    let r = await call('/api/account?a=google', { body: { credential: 'x:g-1:bano@gmail.com:Bano' } });
    assert.equal(r.status, 400);
    assert.equal(r.body.needTerms, true);
    assert.ok(!fs.existsSync(path.join(DIR, 'emails', sha('bano@gmail.com') + '.json')), 'no account made');
    r = await call('/api/account?a=google', { body: { credential: 'x:g-1:bano@gmail.com:Bano', acceptTerms: true } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.created, true);
    assert.equal(r.body.user.termsVersion, '2026-11-27');
    assert.equal(r.body.user.lastLogin.method, 'google');
    r = await call('/api/account?a=google', { body: { credential: 'x:g-1:bano@gmail.com:Bano' } });
    assert.equal(r.status, 200);
    assert.equal(r.body.created, false);
    // linking Google to an existing email account needs no new acceptance either
    r = await call('/api/account?a=google', { body: { credential: 'x:g-2:amna@example.com:Amna' } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.user.id, uid);
    // Linking drops the unproven email-signup password (tests/security_review.test.js); set one again.
    assert.equal(r.body.passwordRemoved, true);
    const rp = await call('/api/account?a=change-password', { headers: bearer(r.body.token), body: { password: 'amna-pass-1' } });
    assert.equal(rp.status, 200, rp.text);
  });

  await t.test('lastLogin / prevLogin follow password and Google sign-ins', async () => {
    let r = await call('/api/account?a=login', { headers: { 'User-Agent': CHROME_ANDROID }, body: { email: 'amna@example.com', password: 'amna-pass-1' } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.user.lastLogin && [r.body.user.lastLogin.method, r.body.user.lastLogin.device], ['password', 'Chrome on Android']);
    assert.equal(r.body.user.prevLogin.method, 'google', 'the Google link sign-in before');
    token = r.body.token;
    r = await call('/api/account?a=google', { headers: { 'User-Agent': CHROME_ANDROID }, body: { credential: 'x:g-2:amna@example.com:Amna' } });
    assert.equal(r.body.user.lastLogin.method, 'google');
    assert.equal(r.body.user.prevLogin.method, 'password');
    assert.ok(Date.parse(r.body.user.lastLogin.at) >= Date.parse(r.body.user.prevLogin.at));
    r = await call('/api/account?a=me', { headers: bearer(token) });
    assert.equal(r.body.user.lastLogin.method, 'google', 'me shows it too');
    const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'users', uid + '.json'), 'utf8'));
    assert.deepEqual(Object.keys(raw.lastLogin).sort(), ['at', 'method', 'ua']);
  });

  await t.test('app-code: signed in only, 32 hex characters, stored hashed for 5 minutes', async () => {
    let r = await call('/api/account?a=app-code', { body: {} });
    assert.equal(r.status, 401);
    r = await call('/api/account?a=app-code', { headers: bearer(token), body: { app: 'customer' } });
    assert.equal(r.status, 200, r.text);
    assert.match(r.body.code, /^[a-f0-9]{32}$/);
    assert.equal(r.body.redirect, 'sastadawa://auth?code=' + r.body.code);
    assert.equal(r.body.expiresIn, 300);
    const file = path.join(DIR, 'appcodes', sha(r.body.code) + '.json');
    const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(rec.uid, uid);
    assert.equal(rec.app, 'customer');
    assert.equal(rec.via, 'google', 'the browser sign-in was Google');
    assert.ok(Math.abs(rec.exp - (Date.now() + 5 * 60 * 1000)) < 10000);
    assert.ok(!fs.readdirSync(path.join(DIR, 'appcodes')).some((n) => n.includes(r.body.code)), 'the code itself is never stored');
    r = await call('/api/account?a=app-code', { headers: bearer(token), body: { app: 'business', via: 'password' } });
    assert.equal(r.body.redirect, 'sastadawabiz://auth?code=' + r.body.code);
  });

  await t.test('app-exchange: single use, signs the app in, records the method used in the browser', async () => {
    const code = (await call('/api/account?a=app-code', { headers: bearer(token), body: { app: 'business' } })).body.code;
    const ua = 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36 SastaDawa';
    let r = await call('/api/account?a=app-exchange', { headers: { 'User-Agent': ua, Origin: 'https://localhost' }, body: { code } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.headers['access-control-allow-origin'], 'https://localhost', 'the app calls it cross-origin');
    assert.equal(r.body.user.id, uid);
    assert.equal(r.body.user.lastLogin.method, 'google');
    assert.equal(r.body.user.lastLogin.app, 'business');
    assert.equal(r.body.user.lastLogin.device, 'Sasta Dawa app on Android');
    assert.equal(r.body.user.prevLogin.method, 'google');
    const me = await call('/api/account?a=me', { headers: bearer(r.body.token) });
    assert.equal(me.status, 200, 'the new token works');
    r = await call('/api/account?a=app-exchange', { body: { code } });
    assert.equal(r.status, 401, 'second use refused');
    assert.ok(!fs.existsSync(path.join(DIR, 'appcodes', sha(code) + '.json')));
    r = await call('/api/account?a=app-exchange', { body: { code: 'not-a-code' } });
    assert.equal(r.status, 401);
    r = await call('/api/account?a=app-exchange', { body: { code: crypto.randomBytes(16).toString('hex') } });
    assert.equal(r.status, 401, 'unknown code');
    // via:'password' is kept
    const c2 = (await call('/api/account?a=app-code', { headers: bearer(token), body: { via: 'password' } })).body.code;
    r = await call('/api/account?a=app-exchange', { body: { code: c2 } });
    assert.equal(r.body.user.lastLogin.method, 'password');
    assert.equal(r.body.user.lastLogin.app, 'customer');
  });

  await t.test('codes expire after 5 minutes and die when the user signs out everywhere', async () => {
    const code = (await call('/api/account?a=app-code', { headers: bearer(token), body: {} })).body.code;
    const file = path.join(DIR, 'appcodes', sha(code) + '.json');
    const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
    rec.exp = Date.now() - 1;
    fs.writeFileSync(file, JSON.stringify(rec));
    let r = await call('/api/account?a=app-exchange', { body: { code } });
    assert.equal(r.status, 401);
    assert.ok(!fs.existsSync(file), 'expired code removed');
    const code2 = (await call('/api/account?a=app-code', { headers: bearer(token), body: {} })).body.code;
    assert.equal((await call('/api/account?a=logout-all', { headers: bearer(token), body: {} })).status, 200);
    r = await call('/api/account?a=app-exchange', { body: { code: code2 } });
    assert.equal(r.status, 401, 'signed out everywhere: pending codes are void');
  });
});
