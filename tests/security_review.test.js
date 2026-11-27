// Regression tests for the pre-launch security review (one block per fixed finding).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-secreview-'));
process.env.SD_DATA_DIR = DIR;
process.env.ADMIN_PASSWORD = 'admin-pass-review';
process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
delete process.env.ADMIN_2FA_RESET;
delete process.env.ADMIN_SESSION_SECRET;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.VERCEL;
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.BLOB_STORE_ID;

const { server } = require('../server');
const platform = require('../lib/platform');
const store = require('../lib/store');
const totp = require('../lib/totp');
const dataset = require('../lib/dataset');
const { client, bearer, adminLogin, signup } = require('./_http');

let port;
const call = client(() => port);
const med = dataset.get().engine.search('panadol', { limit: 1 })[0].med;

platform._setGoogleVerifier(async (cred) => {
  const [kind, sub, email, name] = cred.split(':');
  if (kind !== 'good') throw new Error('invalid token');
  return { iss: 'https://accounts.google.com', aud: process.env.GOOGLE_CLIENT_ID, sub, email, name, email_verified: 'true', exp: String(Math.floor(Date.now() / 1000) + 600) };
});

test('security review fixes', async (t) => {
  await new Promise((r) => server.listen(0, r));
  port = server.address().port;
  t.after(() => {
    server.close();
    fs.rmSync(DIR, { recursive: true, force: true });
  });
  const admin = (await adminLogin(call, 'admin-pass-review')).headers;
  assert.ok(admin, 'admin signed in');

  await t.test('Google sign-in on an email someone pre-registered drops their password and sessions (pre-account hijack)', async () => {
    // Attacker signs up first with the victim's address (sign-up never proves the email).
    const att = await signup(call, 'pharmacy', 'victim@gmail.com', { password: 'attacker-pass-1' });
    assert.equal((await call('/api/account?a=me', { headers: att.h })).status, 200);
    // The real owner later uses "Continue with Google".
    const r = await call('/api/account?a=google', { body: { credential: 'good:g-victim:victim@gmail.com:Victim' } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.created, false);
    assert.equal(r.body.user.hasPassword, false);
    assert.equal((await call('/api/account?a=me', { headers: att.h })).status, 401, "attacker's old session is signed out");
    const pw = await call('/api/account?a=login', { body: { email: 'victim@gmail.com', password: 'attacker-pass-1' } });
    assert.equal(pw.status, 401, "attacker's password no longer opens the account");
    assert.equal((await call('/api/account?a=me', { headers: bearer(r.body.token) })).status, 200, 'the Google session works');
    // A second Google sign-in is a normal sign-in (nothing more is reset).
    const again = await call('/api/account?a=google', { body: { credential: 'good:g-victim:victim@gmail.com:Victim' } });
    assert.equal(again.status, 200);
    assert.equal((await call('/api/account?a=me', { headers: bearer(r.body.token) })).status, 200);
  });

  await t.test('a verified listing goes back to review when its name, address or numbers change', async () => {
    const ph = await signup(call, 'pharmacy', 'switch@example.com');
    const base = { name: 'Honest Pharmacy', address: '5 Mall Road', city: 'Sialkot', phone: '03001234567', hours: '9-5' };
    const pid = (await call('/api/account?a=save-pharmacy', { headers: ph.h, body: base })).body.pharmacy.id;
    await call('/api/admin?a=pharmacy-update', { headers: admin, body: { id: pid, verified: true } });
    const listed = async () => (await call('/api/places?a=nearby&city=Sialkot')).body.pharmacies.some((p) => p.id === pid);
    assert.ok(await listed());
    // Hours only: stays verified.
    let r = await call('/api/account?a=save-pharmacy', { headers: ph.h, body: { ...base, id: pid, hours: '24 hours' } });
    assert.equal(r.body.pharmacy.verified, true);
    assert.ok(await listed());
    // New phone number: back to review, hidden from the public directory.
    r = await call('/api/account?a=save-pharmacy', { headers: ph.h, body: { ...base, id: pid, phone: '03009999999' } });
    assert.equal(r.status, 200);
    assert.equal(r.body.pharmacy.verified, false);
    assert.ok(!(await listed()), 'the switched listing is not shown until the admin checks it again');
    // Name change after re-verification: same.
    await call('/api/admin?a=pharmacy-update', { headers: admin, body: { id: pid, verified: true } });
    r = await call('/api/account?a=save-pharmacy', { headers: ph.h, body: { ...base, id: pid, phone: '03009999999', name: 'Shifa International' } });
    assert.equal(r.body.pharmacy.verified, false);
  });

  await t.test('deleting a branch also deletes its refill customers, reservations and stats', async () => {
    const ph = await signup(call, 'pharmacy', 'closing@example.com');
    const pid = (await call('/api/account?a=save-pharmacy', { headers: ph.h, body: { name: 'Closing Shop', address: '9 Road', city: 'Gujrat', phone: '03001234567' } })).body.pharmacy.id;
    await call('/api/admin?a=pharmacy-update', { headers: admin, body: { id: pid, verified: true } });
    assert.equal((await call('/api/account?a=save-refill', { headers: ph.h, body: { pid, name: 'Regular Customer', phone: '03111234567', meds: [{ id: med.id }], every: 30 } })).status, 200);
    assert.equal((await call('/api/places?a=reserve', { body: { pid, med: med.id, name: 'Walk In', phone: '03221234567', qty: '1' } })).status, 200);
    await call('/api/places?a=event', { body: { pid, type: 'view' } });
    const exists = (p) => fs.existsSync(path.join(DIR, p));
    const left = (d) => (exists(d) ? fs.readdirSync(path.join(DIR, d)).length : 0);
    assert.ok(exists(`refills/${pid}.json`));
    assert.equal(left(`reservations/${pid}`), 1);
    const r = await call('/api/account?a=delete-pharmacy', { headers: ph.h, body: { id: pid } });
    assert.equal(r.status, 200);
    assert.ok(!exists(`pharmacies/${pid}.json`));
    assert.ok(!exists(`refills/${pid}.json`), 'customer names and phones are gone');
    assert.equal(left(`reservations/${pid}`), 0);
    assert.equal(left(`stats/${pid}`), 0);
  });

  await t.test('concurrent directory requests on a cold cache share one load (Blob read amplification)', async () => {
    const ph = await signup(call, 'pharmacy', 'cold@example.com');
    await call('/api/account?a=save-pharmacy', { headers: ph.h, body: { name: 'Cold Cache', address: '1 Road', city: 'Jhelum', phone: '03001234567' } }); // invalidates the cache
    const total = fs.readdirSync(path.join(DIR, 'pharmacies')).length;
    const orig = store.get;
    let reads = 0;
    store.get = (k) => {
      if (/^pharmacies\//.test(k)) reads++;
      return orig(k);
    };
    try {
      const rs = await Promise.all(Array.from({ length: 12 }, () => call('/api/places?a=nearby&city=Jhelum')));
      rs.forEach((r) => assert.equal(r.status, 200));
    } finally {
      store.get = orig;
    }
    assert.ok(reads <= total, `${reads} listing reads for 12 requests (one load reads ${total})`);
  });

  await t.test('"Download my data" and the payments list are rate limited (each reads every payment record)', async () => {
    const u = await signup(call, 'patient', 'heavy@example.com');
    let last;
    for (let i = 0; i < 11; i++) last = await call('/api/account?a=export', { headers: u.h });
    assert.equal(last.status, 429);
    for (let i = 0; i < 61; i++) last = await call('/api/account?a=payments', { headers: u.h });
    assert.equal(last.status, 429);
    const other = await signup(call, 'patient', 'light@example.com');
    assert.equal((await call('/api/account?a=export', { headers: other.h })).status, 200, 'other accounts are not affected');
  });

  await t.test('claims analysis is rate limited and refill imports cap the number of medicine-name searches (CPU)', async () => {
    const co = await signup(call, 'company', 'claims@example.com'); // the 30-day trial is enough
    let last;
    for (let i = 0; i < 61; i++) last = await call('/api/account?a=claims-report', { headers: co.h, body: { rows: [{ medicine: med.id, qty: 1 }] } });
    assert.equal(last.status, 429);

    const ph = await signup(call, 'pharmacy', 'bigrefill@example.com');
    const pid = (await call('/api/account?a=save-pharmacy', { headers: ph.h, body: { name: 'Refill Shop', address: '3 Road', city: 'Kasur', phone: '03001234567' } })).body.pharmacy.id;
    const meds = Array.from({ length: 20 }, (_, i) => 'unknownmed' + i).join(';');
    const rows = Array.from({ length: 300 }, (_, i) => `Name ${i},0300${String(1000000 + i)},${meds},30,`);
    const csv = ['name,phone,medicines,every_days,last_refill_date', ...rows].join('\n');
    const t0 = Date.now();
    const r = await call('/api/account?a=import-refills', { headers: ph.h, body: { pid, csv, partial: true } });
    assert.equal(r.status, 413, r.text);
    assert.match(r.body.error, /Too many medicine names/);
    assert.ok(Date.now() - t0 < 5000, 'refused before searching 6000 names');
    // A normal file still imports.
    const ok = await call('/api/account?a=import-refills', { headers: ph.h, body: { pid, csv: `name,phone,medicines,every_days,last_refill_date\nAli,03001112222,${med.id},30,` } });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.body.imported, 1);
  });

  await t.test('admin 2FA: sending the password alone does not wipe earlier wrong-code attempts', async () => {
    const setup = await call('/api/admin?a=2fa-setup', { headers: admin, body: {} });
    assert.equal(setup.status, 200, setup.text);
    const en = await call('/api/admin?a=2fa-enable', { headers: admin, body: { code: totp.generate(setup.body.secret) } });
    assert.equal(en.status, 200, en.text);
    const ip = '10.250.0.1';
    const login = (extra) => call('/api/admin?a=login', { ip, headers: { 'X-SD-Admin': '1' }, body: { password: 'admin-pass-review', ...(extra || {}) } });
    for (let i = 0; i < 7; i++) assert.equal((await login({ code: '000000' })).status, 401);
    // Password only: "need2fa", and (before the fix) this reset the per-address counter.
    const p = await login();
    assert.equal(p.status, 401);
    assert.equal(p.body.need2fa, true);
    assert.equal((await login({ code: '000000' })).status, 401); // 8th wrong code
    assert.equal((await login({ code: '000000' })).status, 429, 'the address is locked out after 8 wrong codes');
    assert.equal((await login()).status, 429, 'a password-only request does not unlock it');
  });
});
