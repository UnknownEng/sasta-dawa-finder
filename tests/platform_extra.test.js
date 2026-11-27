// Refill lists, delivery orders, staff discounts, clinic partners + savings, NGO supplier quotes,
// company claims analysis, admin analytics and prescription reading (lib/platform.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-platform2-'));
process.env.SD_DATA_DIR = DIR;
process.env.ADMIN_PASSWORD = 'admin-pass-123';
delete process.env.ANTHROPIC_API_KEY;
delete process.env.VERCEL;
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.BLOB_STORE_ID;

const { server } = require('../server');
const dataset = require('../lib/dataset');
const platform = require('../lib/platform');

let port;
let ip = 0;
function call(p, { method, body, headers } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request({ port, path: p, method: method || (data ? 'POST' : 'GET'), headers: { 'X-Forwarded-For': '10.7.0.' + ++ip, ...(data ? { 'Content-Type': 'application/json' } : {}), ...(headers || {}) } }, (res) => {
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
async function signup(role, email) {
  const r = await call('/api/account?a=signup', { body: { acceptTerms: true, email, name: role + ' test', password: 'password-123', role } });
  assert.equal(r.status, 200, r.text);
  return r.body;
}

test('platform extras', async (t) => {
  await new Promise((r) => server.listen(0, r));
  port = server.address().port;
  t.after(() => { server.close(); fs.rmSync(DIR, { recursive: true, force: true }); });

  const e = dataset.get().engine;
  const med = e.search('panadol', { limit: 1 })[0].med;
  const med2 = e.search('augmentin', { limit: 1 })[0].med;
  const lg = await call('/api/admin?a=login', { body: { password: 'admin-pass-123' }, headers: { 'X-SD-Admin': '1' } });
  const admin = { Cookie: lg.headers['set-cookie'][0].split(';')[0], 'X-SD-Admin': '1' };

  const ph = await signup('pharmacy', 'ph@example.com');
  const tk = B(ph.token);
  const sp = await call('/api/account?a=save-pharmacy', { headers: tk, body: { name: 'Care Pharmacy', address: 'Blue Area', city: 'Islamabad', phone: '03001234567', whatsapp: '03001234567' } });
  const pid = sp.body.pharmacy.id;
  await call('/api/admin?a=pharmacy-update', { headers: admin, body: { id: pid, verified: true } });

  await t.test('refill customer list: add, due date, mark refilled, delete', async () => {
    let r = await call('/api/account?a=save-refill', { headers: tk, body: { pid, name: 'Bilal', phone: '03211234567', meds: [{ id: med.id, qty: '2 packs' }, { id: 'nope' }], every: 30, lastAt: new Date(Date.now() - 29 * 864e5).toISOString() } });
    assert.equal(r.status, 200, r.text);
    r = await call('/api/account?a=refills&id=' + pid, { headers: tk });
    const c = r.body.customers[0];
    assert.equal(c.meds.length, 1);
    assert.equal(c.meds[0].name, med.product);
    assert.equal(c.due, true, 'due within 3 days');
    assert.equal(c.overdue, false);
    r = await call('/api/account?a=mark-refilled', { headers: tk, body: { pid, id: c.id } });
    r = await call('/api/account?a=refills&id=' + pid, { headers: tk });
    assert.equal(r.body.customers[0].due, false);
    r = await call('/api/account?a=save-refill', { headers: tk, body: { pid, name: '', phone: '' } });
    assert.equal(r.status, 400);
    await call('/api/account?a=save-refill', { headers: tk, body: { pid, id: c.id, remove: true } });
    r = await call('/api/account?a=refills&id=' + pid, { headers: tk });
    assert.equal(r.body.customers.length, 0);
  });

  await t.test('staff discount offer shows on the public card and to companies', async () => {
    let r = await call('/api/account?a=save-offer', { headers: tk, body: { id: pid, percent: 12, note: 'on all medicines' } });
    assert.equal(r.body.offer.percent, 12);
    r = await call('/api/places?a=nearby&city=Islamabad');
    assert.deepEqual(r.body.pharmacies[0].offer, { percent: 12, note: 'on all medicines' });
    const co = await signup('company', 'co@example.com');
    r = await call('/api/account?a=partners&city=Islamabad', { headers: B(co.token) });
    assert.equal(r.body.partners[0].id, pid);
    r = await call('/api/account?a=save-offer', { headers: tk, body: { id: pid, percent: 90 } });
    assert.equal(r.body.offer, null, 'above 50% is refused (treated as no offer)');
  });

  await t.test('delivery orders only for Premium pharmacies that deliver', async () => {
    let r = await call('/api/places?a=reserve', { body: { pid, med: med.id, name: 'Sara', phone: '03331234567', delivery: true, address: 'House 1, Street 2, G-9/1' } });
    assert.equal(r.status, 400, 'Pro pharmacy does not deliver');
    const pay = await call('/api/account?a=pay', { headers: tk, body: { plan: 'pharmacy_premium', method: 'easypaisa', txnId: 'EP12345' } });
    await call('/api/admin?a=payment-update', { headers: admin, body: { key: pay.body.payment.key, status: 'approved' } });
    await call('/api/account?a=save-pharmacy', { headers: tk, body: { id: pid, name: 'Care Pharmacy', address: 'Blue Area', city: 'Islamabad', phone: '03001234567', whatsapp: '03001234567', delivery: true } });
    r = await call('/api/places?a=nearby&city=Islamabad');
    assert.equal(r.body.pharmacies[0].delivery, true);
    r = await call('/api/places?a=reserve', { body: { pid, med: med.id, name: 'Sara', phone: '03331234567', delivery: true, address: 'short' } });
    assert.equal(r.status, 400, 'needs a full address');
    r = await call('/api/places?a=reserve', { body: { pid, med: med.id, name: 'Sara', phone: '03331234567', delivery: true, address: 'House 1, Street 2, G-9/1' } });
    assert.equal(r.status, 200, r.text);
    r = await call('/api/account?a=reservations&id=' + pid, { headers: tk });
    const order = r.body.reservations[0];
    assert.equal(order.type, 'delivery');
    assert.equal(order.address, 'House 1, Street 2, G-9/1');
    r = await call('/api/account?a=reservation-update', { headers: tk, body: { key: order.key, status: 'out_for_delivery' } });
    r = await call('/api/account?a=reservations&id=' + pid, { headers: tk });
    assert.equal(r.body.reservations[0].status, 'out_for_delivery');
    r = await call('/api/account?a=stats&id=' + pid, { headers: tk });
    assert.equal(r.body.totals.delivery, 1);
  });

  await t.test('clinic widget: partner pharmacies in its city and savings shown', async () => {
    const cl = await signup('clinic', 'clinic@example.com');
    await call('/api/account?a=save-clinic', { headers: B(cl.token), body: { name: 'City Clinic', city: 'islamabad', color: '#123456' } });
    let r = await call('/api/places?a=widget&c=' + cl.user.id);
    assert.equal(r.body.partners.length, 1);
    assert.equal(r.body.partners[0].name, 'Care Pharmacy');
    assert.equal(r.body.partners[0].ownerId, undefined);
    await call('/api/places?a=event', { body: { type: 'saved', clinic: cl.user.id, amount: 250 } });
    await call('/api/places?a=event', { body: { type: 'saved', clinic: cl.user.id, amount: 0 } });
    r = await call('/api/places?a=event', { body: { type: 'savedCount', clinic: cl.user.id } });
    assert.equal(r.status, 400, 'counters cannot be bumped directly');
    r = await call('/api/account?a=stats', { headers: B(cl.token) });
    assert.equal(r.body.totals.saved, 250);
    assert.equal(r.body.totals.savedCount, 2);
    await call('/api/account?a=save-clinic', { headers: B(cl.token), body: { name: 'City Clinic', city: 'Islamabad', partners: false } });
    r = await call('/api/places?a=widget&c=' + cl.user.id);
    assert.equal(r.body.partners.length, 0, 'clinic can switch partners off');
  });

  await t.test('NGO supplier quotes: save and compare', async () => {
    const ngo = await signup('ngo', 'ngo@example.com');
    const items = [{ id: med.id, qty: 100 }, { id: med2.id, qty: 10 }];
    let r = await call('/api/account?a=save-list', { headers: B(ngo.token), body: { name: 'Camp', items } });
    const list = r.body.user.lists[0];
    r = await call('/api/account?a=save-quote', { headers: B(ngo.token), body: { listId: list.id, supplier: 'Supplier A', prices: { [med.id]: 2, [med2.id]: 20 } } });
    r = await call('/api/account?a=save-quote', { headers: B(ngo.token), body: { listId: list.id, supplier: 'Supplier B', prices: { [med.id]: 1.5 } } });
    const saved = r.body.user.lists[0];
    assert.equal(saved.quotes.length, 2);
    r = await call('/api/account?a=compare-quotes', { headers: B(ngo.token), body: { items, quotes: saved.quotes } });
    assert.equal(r.status, 200, r.text);
    const a = r.body.quotes.find((q) => q.supplier === 'Supplier A');
    assert.equal(a.total, 400);
    assert.equal(a.missing, 0);
    assert.equal(r.body.quotes.find((q) => q.supplier === 'Supplier B').missing, 1);
    assert.equal(r.body.best_supplier, 'Supplier A', 'incomplete quotes cannot win');
    r = await call('/api/account?a=save-list', { headers: B(ngo.token), body: { id: list.id, name: 'Camp (edited)', items: items.slice(0, 1) } });
    assert.equal(r.body.user.lists[0].quotes.length, 2, 'editing a list keeps its supplier quotes');
  });

  await t.test('company claims analysis', async () => {
    const co = await signup('company', 'claims@example.com');
    const rows = [{ medicine: 'Panadol', qty: 200, paid: 900 }, { medicine: med2.id, qty: 14 }, { medicine: 'zzzz not a medicine' }];
    const r = await call('/api/account?a=claims-report', { headers: B(co.token), body: { rows } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.rows.length, 2);
    assert.deepEqual(r.body.unmatched, ['zzzz not a medicine']);
    assert.ok(r.body.total_paid >= 900);
    assert.ok(r.body.total_cheapest <= r.body.total_paid);
    assert.equal(r.body.possible_saving, r.body.total_paid - r.body.total_cheapest);
    const pat = await signup('patient', 'pat@example.com');
    const x = await call('/api/account?a=claims-report', { headers: B(pat.token), body: { rows } });
    assert.equal(x.status, 404, 'only company accounts');
  });

  await t.test('admin analytics', async () => {
    const r = await call('/api/admin?a=analytics', { headers: admin });
    assert.equal(r.status, 200, r.text);
    assert.ok(r.body.users.total >= 5);
    assert.equal(r.body.users.byRole.pharmacy, 1);
    assert.equal(r.body.revenue.approved, 5000);
    assert.equal(r.body.pharmacies.verified, 1);
    assert.ok(r.body.events30.delivery >= 1);
    assert.equal(r.body.viewsByDay.length, 30);
    assert.ok(Array.isArray(r.body.expiringSoon));
    const no = await call('/api/admin?a=analytics', { headers: { 'X-SD-Admin': '1' } });
    assert.equal(no.status, 401);
  });

  await t.test('prescription photo is read and matched to medicines', async () => {
    platform._setRxClient({ messages: { create: async () => ({ content: [{ type: 'text', text: '{"medicines":[{"name":"Panadol","strength":"500mg"},{"name":"Augmentin","strength":""}]}' }] }) } });
    let r = await call('/api/places?a=rx', { body: { image: 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('fake jpeg body')]).toString('base64') } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.items.length, 2);
    assert.match(r.body.items[0].match.product, /Panadol/i);
    r = await call('/api/places?a=rx', { body: { image: 'not an image' } });
    assert.equal(r.status, 400);
    platform._setRxClient(null);
    r = await call('/api/places?a=rx', { body: { image: 'data:image/jpeg;base64,AAAA' } });
    assert.equal(r.status, 503, 'switched off without an AI key');
  });
});
