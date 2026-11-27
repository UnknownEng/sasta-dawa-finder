// Accounts, paid plans, pharmacy directory, developer API and admin extras (lib/platform.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-platform-'));
process.env.SD_DATA_DIR = DIR;
process.env.ADMIN_PASSWORD = 'admin-pass-123';
delete process.env.ANTHROPIC_API_KEY;
delete process.env.VERCEL;
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.BLOB_STORE_ID;

const { server } = require('../server');
const dataset = require('../lib/dataset');

let port;
function call(p, { method, body, headers } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request({ port, path: p, method: method || (data ? 'POST' : 'GET'), headers: { ...(data ? { 'Content-Type': 'application/json' } : {}), ...(headers || {}) } }, (res) => {
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
const bearer = (t) => ({ Authorization: 'Bearer ' + t });
let ip = 0;
const fresh = () => ({ 'X-Forwarded-For': '10.0.0.' + ++ip }); // separate rate-limit buckets

test('platform', async (t) => {
  await new Promise((r) => server.listen(0, r));
  port = server.address().port;
  t.after(() => { server.close(); fs.rmSync(DIR, { recursive: true, force: true }); });

  const med = dataset.get().engine.search('panadol', { limit: 1 })[0].med;
  let pharmToken, pharmUser, pharmacy, patientToken, adminCookie;

  await t.test('signup validates input and never stores the password', async () => {
    let r = await call('/api/account?a=signup', { body: { acceptTerms: true, email: 'bad', name: 'X', password: 'short' }, headers: fresh() });
    assert.equal(r.status, 400);
    r = await call('/api/account?a=signup', { body: { acceptTerms: true, email: 'shop@example.com', name: 'Shifa Pharmacy', password: 'pharmacy-123', role: 'pharmacy', phone: '0300 1234567' }, headers: fresh() });
    assert.equal(r.status, 200);
    assert.ok(r.body.token);
    pharmToken = r.body.token;
    pharmUser = r.body.user;
    assert.equal(pharmUser.role, 'pharmacy');
    assert.equal(pharmUser.plan, 'pharmacy_pro', 'business accounts start with a free trial of their plan');
    assert.equal(pharmUser.trial, true);
    assert.equal(pharmUser.passHash, undefined);
    const raw = fs.readFileSync(path.join(DIR, 'users', pharmUser.id + '.json'), 'utf8');
    assert.ok(!raw.includes('pharmacy-123'));
    r = await call('/api/account?a=signup', { body: { acceptTerms: true, email: 'SHOP@example.com', name: 'Dup', password: 'whatever-123' }, headers: fresh() });
    assert.equal(r.status, 409);
  });

  await t.test('login, me, bad token', async () => {
    let r = await call('/api/account?a=login', { body: { email: 'shop@example.com', password: 'wrong-pass' }, headers: fresh() });
    assert.equal(r.status, 401);
    r = await call('/api/account?a=login', { body: { email: 'Shop@Example.com', password: 'pharmacy-123' }, headers: fresh() });
    assert.equal(r.status, 200);
    r = await call('/api/account?a=me', { headers: bearer(pharmToken) });
    assert.equal(r.body.user.email, 'shop@example.com');
    r = await call('/api/account?a=me', { headers: bearer(pharmToken.slice(0, -2) + 'xx') });
    assert.equal(r.status, 401);
  });

  await t.test('pharmacy listing is hidden until the admin verifies it', async () => {
    let r = await call('/api/account?a=save-pharmacy', { headers: bearer(pharmToken), body: { name: 'Shifa Pharmacy', address: 'Main Market', area: 'G-9', city: 'Islamabad', phone: '0300 1234567', whatsapp: '+923001234567', hours: '9am-11pm', lat: 33.69, lng: 73.03, featured: true } });
    assert.equal(r.status, 200, r.text);
    pharmacy = r.body.pharmacy;
    assert.equal(pharmacy.verified, false);
    r = await call('/api/account?a=save-pharmacy', { headers: bearer(pharmToken), body: { name: 'Branch 2', address: 'x', city: 'Islamabad', phone: '0300 7654321' } });
    assert.equal(r.status, 402, 'a second branch needs Premium');
    r = await call('/api/places?a=nearby&city=Islamabad');
    assert.equal(r.body.pharmacies.length, 0);

    r = await call('/api/admin?a=login', { body: { password: 'admin-pass-123' }, headers: { 'X-SD-Admin': '1', ...fresh() } });
    assert.equal(r.status, 200);
    adminCookie = r.headers['set-cookie'][0].split(';')[0];
    const admin = { Cookie: adminCookie, 'X-SD-Admin': '1' };
    r = await call('/api/admin?a=pharmacies', { headers: admin });
    assert.equal(r.body.pharmacies.length, 1);
    r = await call('/api/admin?a=pharmacy-update', { headers: admin, body: { id: pharmacy.id, verified: true } });
    assert.equal(r.status, 200);
    r = await call('/api/admin?a=pharmacies', { headers: { 'X-SD-Admin': '1' } });
    assert.equal(r.status, 401, 'admin extras need the admin sign-in');
  });

  await t.test('stock, nearby search, events and stats', async () => {
    let r = await call('/api/account?a=set-stock', { headers: bearer(pharmToken), body: { id: pharmacy.id, items: [{ id: med.id, s: 'in', price: 700 }, { id: 'no-such-medicine' }] } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.changed, 1);
    assert.deepEqual(r.body.unknown, ['no-such-medicine']);
    r = await call(`/api/places?a=nearby&med=${med.id}&lat=33.7&lng=73.05`, { headers: fresh() });
    assert.equal(r.body.pharmacies.length, 1);
    const p = r.body.pharmacies[0];
    assert.equal(p.stock, 'in');
    assert.equal(p.price, 700);
    assert.equal(p.verified, true);
    assert.equal(p.sponsored, true);
    assert.ok(p.km < 5);
    assert.equal(p.ownerId, undefined, 'no internal ids leak to visitors');
    for (const type of ['view', 'view', 'wa', 'call', 'dir']) {
      r = await call('/api/places?a=event', { body: { pid: pharmacy.id, type }, headers: fresh() });
      assert.equal(r.status, 200);
    }
    r = await call('/api/account?a=stats&id=' + pharmacy.id, { headers: bearer(pharmToken) });
    assert.equal(r.body.totals.view, 2);
    assert.equal(r.body.totals.wa, 1);
    assert.equal(r.body.days.length, 30);
    r = await call('/api/account?a=alerts&id=' + pharmacy.id, { headers: bearer(pharmToken) });
    assert.equal(r.body.demand[0].id, med.id, 'a search near Islamabad shows up as a request alert');
    assert.equal(r.body.demand[0].inStock, true);
  });

  await t.test('reservations reach the pharmacy', async () => {
    let r = await call('/api/places?a=reserve', { body: { pid: pharmacy.id, med: med.id, name: 'Ali', phone: '03111234567', qty: '2 packs' }, headers: fresh() });
    assert.equal(r.status, 200, r.text);
    r = await call('/api/account?a=reservations&id=' + pharmacy.id, { headers: bearer(pharmToken) });
    assert.equal(r.body.reservations.length, 1);
    const key = r.body.reservations[0].key;
    r = await call('/api/account?a=reservation-update', { headers: bearer(pharmToken), body: { key, status: 'ready' } });
    assert.equal(r.status, 200);
    r = await call('/api/account?a=report&id=' + pharmacy.id, { headers: bearer(pharmToken) });
    assert.equal(r.body.reservations, 1);
  });

  await t.test('patients cannot use pharmacy actions or see other users data', async () => {
    let r = await call('/api/account?a=signup', { body: { acceptTerms: true, email: 'ayesha@example.com', name: 'Ayesha', password: 'patient-123' }, headers: fresh() });
    patientToken = r.body.token;
    assert.equal(r.body.user.plan, 'free');
    r = await call('/api/account?a=stats&id=' + pharmacy.id, { headers: bearer(patientToken) });
    assert.equal(r.status, 404);
    r = await call('/api/account?a=save-cabinet', { headers: bearer(patientToken), body: { cabinet: [{ id: med.id, perDay: 2 }, { id: '<script>' }] } });
    assert.equal(r.body.cabinet.length, 1);
    r = await call('/api/account?a=me', { headers: bearer(patientToken) });
    assert.equal(r.body.user.cabinet[0].id, med.id);
  });

  await t.test('expired plan locks paid features, payment approval unlocks them', async () => {
    const f = path.join(DIR, 'users', pharmUser.id + '.json');
    const u = JSON.parse(fs.readFileSync(f, 'utf8'));
    u.planUntil = new Date(Date.now() - 1000).toISOString();
    fs.writeFileSync(f, JSON.stringify(u));
    let r = await call('/api/account?a=stats&id=' + pharmacy.id, { headers: bearer(pharmToken) });
    assert.equal(r.status, 402);
    r = await call('/api/account?a=pay', { headers: bearer(pharmToken), body: { plan: 'api', method: 'jazzcash', txnId: '123456' } });
    assert.equal(r.status, 400, 'pharmacies cannot buy the API plan');
    r = await call('/api/account?a=pay', { headers: bearer(pharmToken), body: { plan: 'pharmacy_premium', method: 'jazzcash', txnId: 'TX998877', periods: 2 } });
    assert.equal(r.status, 200);
    assert.equal(r.body.payment.amount, 10000);
    const admin = { Cookie: adminCookie, 'X-SD-Admin': '1' };
    r = await call('/api/admin?a=payments', { headers: admin });
    const pay = r.body.payments[0];
    assert.equal(pay.status, 'pending');
    r = await call('/api/admin?a=payment-update', { headers: admin, body: { key: pay.key, status: 'approved' } });
    assert.equal(r.status, 200);
    r = await call('/api/account?a=me', { headers: bearer(pharmToken) });
    assert.equal(r.body.user.plan, 'pharmacy_premium');
    assert.ok(Date.parse(r.body.user.planUntil) > Date.now() + 55 * 864e5);
    r = await call('/api/account?a=save-pharmacy', { headers: bearer(pharmToken), body: { name: 'Branch 2', address: 'Blue Area', city: 'Islamabad', phone: '0300 7654321' } });
    assert.equal(r.status, 200, 'Premium allows branches');
    r = await call('/api/account?a=competitors&id=' + pharmacy.id, { headers: bearer(pharmToken) });
    assert.equal(r.status, 200);
  });

  await t.test('NGO optimiser, company code, developer API', async () => {
    let r = await call('/api/account?a=signup', { body: { acceptTerms: true, email: 'ngo@example.com', name: 'Help Trust', password: 'ngo-pass-123', role: 'ngo' }, headers: fresh() });
    const ngo = r.body.token;
    const alts = dataset.get().engine.alternatives(med, 'unit');
    r = await call('/api/account?a=optimise', { headers: bearer(ngo), body: { items: [{ id: med.id, qty: 100 }] } });
    assert.equal(r.status, 200);
    assert.equal(r.body.rows.length, 1);
    assert.ok(r.body.total_best <= r.body.total_now);
    if (alts.length) assert.ok(r.body.saving >= 0);
    r = await call('/api/account?a=save-patient', { headers: bearer(ngo), body: { name: 'Patient A', meds: [{ id: med.id, qty: 30 }] } });
    assert.equal(r.body.user.patients.length, 1);

    r = await call('/api/account?a=signup', { body: { acceptTerms: true, email: 'hr@example.com', name: 'Acme Ltd', password: 'company-123', role: 'company' }, headers: fresh() });
    const co = r.body.token;
    r = await call('/api/account?a=create-company', { headers: bearer(co), body: { name: 'Acme Ltd' } });
    const code = r.body.user.companyCode;
    assert.match(code, /^[A-Z0-9]{4,12}$/);
    r = await call('/api/account?a=join-company', { headers: bearer(patientToken), body: { code } });
    assert.equal(r.body.user.joinedCompany.name, 'Acme Ltd');
    r = await call('/api/account?a=company', { headers: bearer(co) });
    assert.equal(r.body.company.members, 1);

    r = await call('/api/account?a=signup', { body: { acceptTerms: true, email: 'dev@example.com', name: 'Dev', password: 'developer-123', role: 'developer' }, headers: fresh() });
    const dev = r.body.token;
    r = await call('/api/account?a=create-key', { headers: bearer(dev), body: {} });
    const key = r.body.key;
    assert.match(key, /^sdk_[a-f0-9]{40}$/);
    assert.equal(JSON.stringify(r.body.user).includes(key), false, 'the full key is only returned once');
    r = await call('/api/v1?a=search&q=panadol');
    assert.equal(r.status, 401);
    r = await call('/api/v1?a=search&q=panadol', { headers: { 'X-API-Key': key } });
    assert.equal(r.status, 200);
    assert.ok(r.body.results.length > 0);
    r = await call('/api/v1?a=alternatives&id=' + med.id, { headers: { 'X-API-Key': key } });
    assert.equal(r.body.medicine.id, med.id);
    r = await call('/api/account?a=usage', { headers: bearer(dev) });
    assert.equal(r.body.today, 2);
    const keyId = (await call('/api/account?a=me', { headers: bearer(dev) })).body.user.apiKeys[0].id;
    await call('/api/account?a=revoke-key', { headers: bearer(dev), body: { id: keyId } });
    r = await call('/api/v1?a=search&q=panadol', { headers: { 'X-API-Key': key } });
    assert.equal(r.status, 401);
  });

  await t.test('change password signs out old tokens; delete account', async () => {
    let r = await call('/api/account?a=change-password', { headers: bearer(patientToken), body: { current: 'patient-123', password: 'patient-456' } });
    assert.equal(r.status, 200);
    const newToken = r.body.token;
    r = await call('/api/account?a=me', { headers: bearer(patientToken) });
    assert.equal(r.status, 401);
    r = await call('/api/account?a=delete-account', { headers: bearer(newToken), body: { password: 'patient-456' } });
    assert.equal(r.status, 200);
    r = await call('/api/account?a=login', { body: { email: 'ayesha@example.com', password: 'patient-456' }, headers: fresh() });
    assert.equal(r.status, 401);
  });

  await t.test('CORS for the mobile app allows the Authorization header', async () => {
    const r = await call('/api/account?a=me', { method: 'OPTIONS', headers: { Origin: 'https://localhost' } });
    assert.equal(r.status, 204);
    assert.match(r.headers['access-control-allow-headers'], /Authorization/);
  });
});
