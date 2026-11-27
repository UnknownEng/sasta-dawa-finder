// "Download my data", admin backup / restore (needs 2FA) and the daily Vercel Cron backup.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-backup-'));
process.env.SD_DATA_DIR = DIR;
process.env.ADMIN_PASSWORD = 'admin-pass-backup';
delete process.env.ADMIN_2FA_RESET;
delete process.env.CRON_SECRET;
delete process.env.VERCEL;
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.BLOB_STORE_ID;

const { server } = require('../server');
const totp = require('../lib/totp');
const dataset = require('../lib/dataset');
const { client, adminLogin, signup } = require('./_http');

let port;
const call = client(() => port);
const med = dataset.get().engine.search('panadol', { limit: 1 })[0].med;
const RECORD = path.join(DIR, 'secrets', 'admin-2fa.json');
let secret;
/** A code the server has not seen yet (tests reset the replay counter instead of waiting 30 s). */
function freshCode() {
  const rec = JSON.parse(fs.readFileSync(RECORD, 'utf8'));
  rec.lastCounter = -1;
  fs.writeFileSync(RECORD, JSON.stringify(rec));
  return totp.generate(secret);
}

test('backups', async (t) => {
  await new Promise((r) => server.listen(0, r));
  port = server.address().port;
  t.after(() => {
    server.close();
    fs.rmSync(DIR, { recursive: true, force: true });
  });

  const ph = await signup(call, 'pharmacy', 'owner@example.com', { password: 'owner-secret-pass' });
  const pid = (await call('/api/account?a=save-pharmacy', { headers: ph.h, body: { name: 'Shifa', address: '1 Mall Road', city: 'Lahore', phone: '03001234567' } })).body.pharmacy.id;
  await call('/api/account?a=set-stock', { headers: ph.h, body: { id: pid, items: [{ id: med.id, s: 'in', price: 20 }] } });
  await call('/api/account?a=save-refill', { headers: ph.h, body: { pid, name: 'Regular', phone: '03111234567', meds: [{ id: med.id }], every: 30 } });
  await call('/api/account?a=pay', { headers: ph.h, body: { plan: 'pharmacy_premium', method: 'jazzcash', txnId: 'TXN12345' } });
  await call('/api/places?a=event', { body: { pid, type: 'view' } });
  let admin = (await adminLogin(call, 'admin-pass-backup')).headers;
  await call('/api/admin?a=pharmacy-update', { headers: admin, body: { id: pid, verified: true } });
  await call('/api/places?a=reserve', { body: { pid, med: med.id, name: 'Buyer', phone: '03221234567', qty: '1' } });

  await t.test('download my data: everything about me, no password hash / salt / token version', async () => {
    assert.equal((await call('/api/account?a=export')).status, 401);
    const r = await call('/api/account?a=export', { headers: ph.h });
    assert.equal(r.status, 200, r.text);
    assert.match(r.headers['content-type'], /application\/json/);
    assert.match(r.headers['content-disposition'], /attachment; filename="sasta-dawa-my-data-\d{4}-\d{2}-\d{2}\.json"/);
    const d = r.body;
    assert.equal(d.user.email, 'owner@example.com');
    for (const k of ['passHash', 'passSalt', 'tokenVersion']) assert.ok(!(k in d.user), k);
    assert.doesNotMatch(r.text, /passHash|passSalt|owner-secret-pass/);
    const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'users', ph.user.id + '.json'), 'utf8'));
    assert.ok(!r.text.includes(raw.passHash), 'hash value never leaves the server');
    assert.equal(d.pharmacies.length, 1);
    assert.equal(d.pharmacies[0].stock[med.id].price, 20);
    assert.equal(d.reservations[pid].length, 1);
    assert.equal(d.refills[pid][0].name, 'Regular');
    assert.equal(d.payments.length, 1);
    assert.ok(d.stats[pid].some((day) => day.view >= 1));
    assert.equal(d.user.lastLogin.method, 'password');
    // a company owner gets their company
    const co = await signup(call, 'company', 'hr@example.com');
    await call('/api/account?a=create-company', { headers: co.h, body: { name: 'Acme' } });
    const c = (await call('/api/account?a=export', { headers: co.h })).body;
    assert.equal(c.company.name, 'Acme');
    assert.equal(c.company.members, 0);
    // a developer's API key hashes are not exported
    const dev = await signup(call, 'developer', 'dev@example.com');
    await call('/api/account?a=create-key', { headers: dev.h, body: {} });
    const dx = await call('/api/account?a=export', { headers: dev.h });
    assert.equal(dx.body.user.apiKeys.length, 1);
    assert.equal(dx.body.user.apiKeys[0].hash, undefined);
  });

  let full;
  await t.test('admin backup: all store keys except secrets/, backups/ and appcodes/', async () => {
    await call('/api/account?a=app-code', { headers: ph.h, body: {} }); // creates an appcodes/ entry
    assert.ok(fs.existsSync(path.join(DIR, 'secrets', 'session.json')));
    assert.equal((await call('/api/admin?a=backup')).status, 401);
    const r = await call('/api/admin?a=backup', { headers: admin });
    assert.equal(r.status, 200);
    assert.match(r.headers['content-disposition'], /sasta-dawa-backup-/);
    full = r.body;
    assert.equal(full.format, 'sasta-dawa-backup');
    assert.equal(full.version, 1);
    const keys = Object.keys(full.keys);
    assert.equal(full.count, keys.length);
    assert.ok(keys.includes(`users/${ph.user.id}.json`));
    assert.ok(keys.includes(`pharmacies/${pid}.json`));
    assert.ok(keys.some((k) => k.startsWith(`stats/${pid}/`)), 'nested keys included');
    assert.ok(keys.some((k) => k.startsWith(`reservations/${pid}/`)));
    assert.ok(keys.includes(`refills/${pid}.json`));
    assert.ok(!keys.some((k) => /^(secrets|backups|appcodes)\//.test(k)), 'no secrets');
    const sessionKey = JSON.parse(fs.readFileSync(path.join(DIR, 'secrets', 'session.json'), 'utf8')).key;
    assert.ok(!r.text.includes(sessionKey), 'the token signing key is not in the backup');
  });

  await t.test('restore: needs 2FA on and a fresh code; validates structure and prefixes', async () => {
    let r = await call('/api/admin?a=restore', { headers: admin, body: { backup: full, mode: 'merge', code: '123456' } });
    assert.equal(r.status, 403, 'refused while 2FA is off');
    secret = (await call('/api/admin?a=2fa-setup', { headers: admin, body: {} })).body.secret;
    const en = await call('/api/admin?a=2fa-enable', { headers: admin, body: { code: totp.generate(secret) } });
    assert.equal(en.status, 200);
    const recovery = en.body.recoveryCodes;
    r = await call('/api/admin?a=restore', { headers: admin, body: { backup: full, mode: 'merge' } });
    assert.equal(r.status, 401);
    assert.equal(r.body.need2fa, true);
    r = await call('/api/admin?a=restore', { headers: admin, body: { backup: full, mode: 'merge', code: recovery[0] } });
    assert.equal(r.status, 401, 'recovery codes do not authorise a restore');
    r = await call('/api/admin?a=restore', { headers: { Cookie: admin.Cookie }, body: { backup: full, mode: 'merge', code: freshCode() } });
    assert.equal(r.status, 403, 'CSRF header needed');
    r = await call('/api/admin?a=restore', { headers: admin, body: { backup: { format: 'something-else', keys: {} }, mode: 'merge', code: freshCode() } });
    assert.equal(r.status, 400);
    r = await call('/api/admin?a=restore', { headers: admin, body: { backup: full, mode: 'wipe-everything', code: freshCode() } });
    assert.equal(r.status, 400);
    for (const evil of ['secrets/session.json', 'secrets/admin-2fa.json', 'backups/2026-01-01.json', 'appcodes/x.json', 'unknown/x.json', 'users/../secrets/session.json', 'users/u_1.txt']) {
      r = await call('/api/admin?a=restore', { headers: admin, body: { backup: { format: 'sasta-dawa-backup', version: 1, keys: { [evil]: { key: 'attacker' }, [`users/${ph.user.id}.json`]: {} } }, mode: 'replace-keys', code: freshCode() } });
      assert.equal(r.status, 400, evil);
      assert.ok(r.body.badKeys.includes(evil), evil);
    }
    assert.notEqual(JSON.parse(fs.readFileSync(path.join(DIR, 'secrets', 'session.json'), 'utf8')).key, 'attacker');
    assert.ok(JSON.parse(fs.readFileSync(path.join(DIR, 'users', ph.user.id + '.json'), 'utf8')).email, 'nothing written when any key is bad');
    r = await call('/api/admin?a=restore', { headers: admin, body: { backup: { format: 'sasta-dawa-backup', version: 1, keys: { 'users/u_aaaaaaaaaaaa.json': 'not an object' } }, mode: 'merge', code: freshCode() } });
    assert.equal(r.status, 400);
    r = await call('/api/admin?a=restore', { headers: admin, raw: `{"backup":{"format":"sasta-dawa-backup","version":1,"keys":{"__proto__":{"x":1}}},"mode":"merge","code":"${freshCode()}"}` });
    assert.equal(r.status, 400, 'prototype keys refused by the guard');
  });

  await t.test('restore merge adds missing keys only; replace-keys overwrites; nothing is deleted', async () => {
    // lose a pharmacy and change a user
    fs.unlinkSync(path.join(DIR, 'pharmacies', pid + '.json'));
    const userFile = path.join(DIR, 'users', ph.user.id + '.json');
    const u = JSON.parse(fs.readFileSync(userFile, 'utf8'));
    u.name = 'Changed after backup';
    fs.writeFileSync(userFile, JSON.stringify(u));
    const extra = path.join(DIR, 'feedback', '1-abcd.json');
    fs.mkdirSync(path.dirname(extra), { recursive: true });
    fs.writeFileSync(extra, JSON.stringify({ message: 'kept', at: new Date().toISOString() }));

    let r = await call('/api/admin?a=restore', { headers: admin, body: { backup: full, mode: 'merge', code: freshCode() } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.written, 1);
    assert.equal(r.body.skipped, full.count - 1);
    assert.ok(fs.existsSync(path.join(DIR, 'pharmacies', pid + '.json')), 'missing pharmacy back');
    assert.equal(JSON.parse(fs.readFileSync(userFile, 'utf8')).name, 'Changed after backup', 'merge keeps newer data');
    const near = (await call('/api/places?a=nearby&city=Lahore')).body.pharmacies;
    assert.ok(near.some((p) => p.id === pid), 'directory cache refreshed');

    r = await call('/api/admin?a=restore', { headers: admin, body: { backup: full, mode: 'replace-keys', code: freshCode() } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.written, full.count);
    assert.equal(JSON.parse(fs.readFileSync(userFile, 'utf8')).name, 'pharmacy tester');
    assert.ok(fs.existsSync(extra), 'keys not in the backup are kept');
    assert.equal((await call('/api/account?a=me', { headers: ph.h })).status, 200, 'logins still work after restore');
  });

  await t.test('cron backup: only with CRON_SECRET; writes backups/<date>.json; keeps 14', async () => {
    let r = await call('/api/backup');
    assert.equal(r.status, 503, 'off without CRON_SECRET');
    process.env.CRON_SECRET = 'cron-secret-value-123';
    try {
      r = await call('/api/backup');
      assert.equal(r.status, 401);
      r = await call('/api/backup', { headers: { Authorization: 'Bearer wrong' } });
      assert.equal(r.status, 401);
      r = await call('/api/backup', { headers: { Authorization: 'cron-secret-value-123' } });
      assert.equal(r.status, 401, 'needs the Bearer form');
      // 16 older backups already there
      fs.mkdirSync(path.join(DIR, 'backups'), { recursive: true });
      for (let d = 1; d <= 16; d++) fs.writeFileSync(path.join(DIR, 'backups', `2026-10-${String(d).padStart(2, '0')}.json`), '{"format":"sasta-dawa-backup","version":1,"keys":{}}');
      r = await call('/api/backup', { headers: { Authorization: 'Bearer cron-secret-value-123' } });
      assert.equal(r.status, 200, r.text);
      const todayKey = `backups/${new Date().toISOString().slice(0, 10)}.json`;
      assert.equal(r.body.key, todayKey);
      assert.equal(r.body.kept, 14);
      assert.equal(r.body.deleted.length, 3);
      const files = fs.readdirSync(path.join(DIR, 'backups')).sort();
      assert.equal(files.length, 14);
      assert.ok(!files.includes('2026-10-01.json') && !files.includes('2026-10-03.json'), 'oldest removed');
      assert.ok(files.includes(todayKey.slice(8)));
      const saved = JSON.parse(fs.readFileSync(path.join(DIR, todayKey), 'utf8'));
      assert.ok(saved.count > 0);
      assert.ok(!Object.keys(saved.keys).some((k) => /^(secrets|backups|appcodes)\//.test(k)));
      // admin can list and download them
      const list = await call('/api/admin?a=backups', { headers: admin });
      assert.equal(list.status, 200);
      assert.equal(list.body.backups.length, 14);
      assert.equal(list.body.backups[0].key, todayKey, 'newest first');
      assert.equal(list.body.keep, 14);
      assert.equal(list.body.cron, true);
      const one = await call('/api/admin?a=backup&date=' + todayKey.slice(8, 18), { headers: admin });
      assert.equal(one.status, 200);
      assert.equal(one.body.count, saved.count);
      assert.equal((await call('/api/admin?a=backup&date=../../x', { headers: admin })).status, 400);
    } finally {
      delete process.env.CRON_SECRET;
    }
  });

  await t.test('delete-account removes everything of the user from the live store', async () => {
    const co = await signup(call, 'company', 'boss@example.com');
    const code = (await call('/api/account?a=create-company', { headers: co.h, body: { name: 'Boss Co' } })).body.user.companyCode;
    const shop = await signup(call, 'pharmacy', 'gone@example.com');
    const gpid = (await call('/api/account?a=save-pharmacy', { headers: shop.h, body: { name: 'Gone', address: '2 Road', city: 'Karachi', phone: '03001234567' } })).body.pharmacy.id;
    await call('/api/account?a=save-refill', { headers: shop.h, body: { pid: gpid, name: 'R', phone: '03111234567', meds: [{ id: med.id }], every: 30 } });
    await call('/api/admin?a=pharmacy-update', { headers: admin, body: { id: gpid, verified: true } });
    await call('/api/places?a=reserve', { body: { pid: gpid, med: med.id, name: 'B', phone: '03221234567', qty: '1' } });
    await call('/api/places?a=event', { body: { pid: gpid, type: 'view' } });
    await call('/api/account?a=join-company', { headers: shop.h, body: { code } });
    await call('/api/account?a=pay', { headers: shop.h, body: { plan: 'pharmacy_premium', method: 'bank', txnId: 'GONE1234' } });
    assert.ok(JSON.parse(fs.readFileSync(path.join(DIR, 'companies', code + '.json'), 'utf8')).members.includes(shop.user.id));
    const r = await call('/api/account?a=delete-account', { headers: shop.h, body: { password: 'password-123' } });
    assert.equal(r.status, 200, r.text);
    const exists = (p) => fs.existsSync(path.join(DIR, p));
    assert.ok(!exists(`users/${shop.user.id}.json`));
    assert.ok(!exists(`pharmacies/${gpid}.json`));
    assert.ok(!exists(`refills/${gpid}.json`));
    const left = (d) => (exists(d) ? fs.readdirSync(path.join(DIR, d)).length : 0);
    assert.equal(left(`reservations/${gpid}`), 0);
    assert.equal(left(`stats/${gpid}`), 0);
    assert.ok(!JSON.parse(fs.readFileSync(path.join(DIR, 'companies', code + '.json'), 'utf8')).members.includes(shop.user.id), 'removed from company members');
    const pays = fs.readdirSync(path.join(DIR, 'payments')).map((f) => fs.readFileSync(path.join(DIR, 'payments', f), 'utf8'));
    assert.ok(!pays.some((p) => p.includes('gone@example.com') || p.includes(shop.user.id)), 'payments anonymised');
    const all = JSON.stringify((await call('/api/admin?a=backup', { headers: admin })).body);
    assert.ok(!all.includes('gone@example.com') && !all.includes(shop.user.id), 'a new backup has nothing of them');
  });

  await t.test('vercel.json schedules the cron at 02:00 PKT (21:00 UTC)', () => {
    const v = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
    assert.deepEqual(v.crons, [{ path: '/api/backup', schedule: '0 21 * * *' }]);
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'api', 'backup.js')));
  });
});
