// Admin two-factor sign-in (TOTP / Google Authenticator) with recovery codes and the ADMIN_2FA_RESET switch.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-2fa-'));
process.env.SD_DATA_DIR = DIR;
process.env.ADMIN_PASSWORD = 'admin-pass-2fa-1';
delete process.env.ADMIN_SESSION_SECRET;
delete process.env.ADMIN_2FA_RESET;
delete process.env.VERCEL;
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.BLOB_STORE_ID;

const { server } = require('../server');
const totp = require('../lib/totp');
const { client, adminLogin } = require('./_http');

let port;
const call = client(() => port);
const RECORD = path.join(DIR, 'secrets', 'admin-2fa.json');

test('admin 2FA', async (t) => {
  await new Promise((r) => server.listen(0, r));
  port = server.address().port;
  t.after(() => {
    server.close();
    fs.rmSync(DIR, { recursive: true, force: true });
  });

  let admin = (await adminLogin(call, 'admin-pass-2fa-1')).headers;
  let secret;
  let recovery;

  await t.test('off by default; setup makes a pending secret that is not active yet', async () => {
    let r = await call('/api/admin?a=2fa-status');
    assert.equal(r.status, 401, 'needs the admin session');
    r = await call('/api/admin?a=2fa-status', { headers: admin });
    assert.equal(r.status, 200);
    assert.equal(r.body.enabled, false);
    r = await call('/api/admin?a=2fa-setup', { headers: { Cookie: admin.Cookie }, body: {} });
    assert.equal(r.status, 403, 'POST needs the admin CSRF header');
    r = await call('/api/admin?a=2fa-setup', { headers: admin, body: {} });
    assert.equal(r.status, 200, r.text);
    secret = r.body.secret;
    assert.match(secret, /^[A-Z2-7]{32}$/);
    assert.equal(r.body.otpauth, `otpauth://totp/Sasta%20Dawa%20Admin?secret=${secret}&issuer=Sasta%20Dawa`);
    // not enabled yet: password alone still signs in
    const plain = await adminLogin(call, 'admin-pass-2fa-1');
    assert.equal(plain.r.status, 200);
    assert.equal((await call('/api/admin?a=2fa-status', { headers: admin })).body.enabled, false);
  });

  await t.test('enable needs a correct code and returns 10 recovery codes once', async () => {
    let r = await call('/api/admin?a=2fa-enable', { headers: admin, body: { code: '000000' } });
    assert.equal(r.status, 400);
    r = await call('/api/admin?a=2fa-enable', { headers: admin, body: { code: totp.generate(secret) } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.enabled, true);
    recovery = r.body.recoveryCodes;
    assert.equal(recovery.length, 10);
    assert.equal(new Set(recovery).size, 10);
    recovery.forEach((c) => assert.match(c, /^[A-Z2-7]{5}-[A-Z2-7]{5}$/));
    const stored = fs.readFileSync(RECORD, 'utf8');
    for (const c of recovery) assert.ok(!stored.includes(c) && !stored.includes(c.replace('-', '')), 'only hashes are stored');
    const rec = JSON.parse(stored);
    assert.equal(rec.enabled, true);
    assert.equal(rec.secret, secret);
    assert.equal(rec.recoveryHashes.length, 10);
    r = await call('/api/admin?a=2fa-status', { headers: admin });
    assert.deepEqual([r.body.enabled, r.body.recoveryLeft], [true, 10]);
    r = await call('/api/admin?a=2fa-setup', { headers: admin, body: {} });
    assert.equal(r.status, 400, 'cannot start a new setup while it is on');
  });

  await t.test('sign-in now needs the code; a used code is never accepted again', async () => {
    let r = await call('/api/admin?a=login', { headers: { 'X-SD-Admin': '1' }, body: { password: 'admin-pass-2fa-1' } });
    assert.equal(r.status, 401);
    assert.equal(r.body.need2fa, true);
    assert.equal(r.body.error, 'Enter the 6-digit code from Google Authenticator');
    assert.equal(r.headers['set-cookie'], undefined, 'no session without the code');
    r = await call('/api/admin?a=login', { headers: { 'X-SD-Admin': '1' }, body: { password: 'wrong-password', code: totp.generate(secret) } });
    assert.equal(r.status, 401);
    assert.ok(!r.body.need2fa, 'a wrong password does not reveal that 2FA is on');
    r = await call('/api/admin?a=login', { headers: { 'X-SD-Admin': '1' }, body: { password: 'admin-pass-2fa-1', code: '123456' } });
    assert.equal(r.status, 401);
    assert.equal(r.body.need2fa, true);
    // the code used to enable 2FA was already spent; the next step's code works once
    const next = totp.generate(secret, Date.now() + 30000);
    const login = await adminLogin(call, 'admin-pass-2fa-1', { code: next });
    assert.equal(login.r.status, 200, login.r.text);
    admin = login.headers;
    const replay = await call('/api/admin?a=login', { headers: { 'X-SD-Admin': '1' }, body: { password: 'admin-pass-2fa-1', code: next } });
    assert.equal(replay.status, 401, 'replayed code refused');
    assert.equal(replay.body.need2fa, true);
  });

  await t.test('recovery codes work once each (any case, with or without the dash)', async () => {
    const code = recovery[0].toLowerCase().replace('-', '');
    let r = await call('/api/admin?a=login', { headers: { 'X-SD-Admin': '1' }, body: { password: 'admin-pass-2fa-1', code } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.usedRecoveryCode, true);
    assert.equal(r.body.recoveryLeft, 9);
    r = await call('/api/admin?a=login', { headers: { 'X-SD-Admin': '1' }, body: { password: 'admin-pass-2fa-1', code: recovery[0] } });
    assert.equal(r.status, 401, 'single use');
    assert.equal((await call('/api/admin?a=2fa-status', { headers: admin })).body.recoveryLeft, 9);
  });

  await t.test('failed codes count like failed passwords (lockout)', async () => {
    const ip = '10.200.0.1';
    let last;
    for (let i = 0; i < 9; i++) last = await call('/api/admin?a=login', { ip, headers: { 'X-SD-Admin': '1' }, body: { password: 'admin-pass-2fa-1', code: '99999' + (i % 10) } });
    assert.equal(last.status, 429);
    // asking for the code (right password, no code yet) is not counted as a failure
    const ip2 = '10.200.0.2';
    for (let i = 0; i < 10; i++) last = await call('/api/admin?a=login', { ip: ip2, headers: { 'X-SD-Admin': '1' }, body: { password: 'admin-pass-2fa-1' } });
    assert.equal(last.status, 401);
    assert.equal(last.body.need2fa, true);
  });

  await t.test('changing ADMIN_PASSWORD does not switch 2FA off', async () => {
    process.env.ADMIN_PASSWORD = 'a-brand-new-password';
    const r = await call('/api/admin?a=login', { headers: { 'X-SD-Admin': '1' }, body: { password: 'a-brand-new-password' } });
    assert.equal(r.status, 401);
    assert.equal(r.body.need2fa, true);
    process.env.ADMIN_PASSWORD = 'admin-pass-2fa-1';
    admin = (await adminLogin(call, 'admin-pass-2fa-1', { code: recovery[1] })).headers;
    assert.ok(admin);
  });

  await t.test('disable needs a valid code (TOTP or recovery)', async () => {
    let r = await call('/api/admin?a=2fa-disable', { headers: admin, body: { code: '000000' } });
    assert.equal(r.status, 400);
    r = await call('/api/admin?a=2fa-disable', { headers: admin, body: { code: recovery[2] } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.enabled, false);
    assert.ok(!fs.existsSync(RECORD));
    assert.equal((await adminLogin(call, 'admin-pass-2fa-1')).r.status, 200, 'password alone again');
  });

  await t.test('ADMIN_2FA_RESET=1 ignores and deletes the 2FA record', async () => {
    const s = (await call('/api/admin?a=2fa-setup', { headers: admin, body: {} })).body.secret;
    const en = await call('/api/admin?a=2fa-enable', { headers: admin, body: { code: totp.generate(s) } });
    assert.equal(en.status, 200);
    assert.equal((await adminLogin(call, 'admin-pass-2fa-1')).r.body.need2fa, true);
    process.env.ADMIN_2FA_RESET = '1';
    try {
      const r = await adminLogin(call, 'admin-pass-2fa-1');
      assert.equal(r.r.status, 200, 'signed in with the password only');
      assert.ok(!fs.existsSync(RECORD), 'record deleted');
      assert.equal((await call('/api/admin?a=2fa-status', { headers: r.headers })).body.enabled, false);
    } finally {
      delete process.env.ADMIN_2FA_RESET;
    }
    assert.equal((await adminLogin(call, 'admin-pass-2fa-1')).r.status, 200, 'stays off after the switch is removed');
  });
});
