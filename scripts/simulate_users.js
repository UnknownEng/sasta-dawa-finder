/**
 * Simulates many different people using the site end to end (accounts, all 8 plans, admin),
 * against a fresh local server with its own temporary storage. Never touches production.
 *
 *   node scripts/simulate_users.js [count=1000] [concurrency=25]
 *
 * Prints a pass/fail table per feature and writes sim-report.json.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const COUNT = Number(process.argv[2]) || 1000;
const CONC = Number(process.argv[3]) || 25;
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-sim-'));
process.env.SD_DATA_DIR = DIR;
process.env.ADMIN_PASSWORD = 'sim-admin-password';
// Google sign-in and JazzCash are simulated: fake Google check, JazzCash replies signed with a test salt.
process.env.GOOGLE_CLIENT_ID = 'sim-client.apps.googleusercontent.com';
process.env.JAZZCASH_MERCHANT_ID = 'SIM001';
process.env.JAZZCASH_PASSWORD = 'sim-pass';
process.env.JAZZCASH_INTEGRITY_SALT = 'sim-salt';
process.env.JAZZCASH_SANDBOX = '1';
delete process.env.ANTHROPIC_API_KEY;
delete process.env.VERCEL;
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.BLOB_STORE_ID;

const { server } = require('../server');
const dataset = require('../lib/dataset');
const engine = dataset.get().engine;
const platform = require('../lib/platform');
platform._setGoogleVerifier(async (cred) => {
  const [, sub, email, name] = cred.split('|');
  return { iss: 'https://accounts.google.com', aud: process.env.GOOGLE_CLIENT_ID, sub, email, name, email_verified: 'true', exp: String(Math.floor(Date.now() / 1000) + 600) };
});
async function jazzcashPay(token, plan, ip) {
  const st = await call('/api/account?a=pay-online', { headers: { Authorization: 'Bearer ' + token }, ip, body: { plan } });
  if (st.status !== 200) return { ok: false, text: st.text };
  const f = st.body.form.fields;
  const reply = { pp_ResponseCode: '000', pp_ResponseMessage: 'Thank you', pp_TxnRefNo: f.pp_TxnRefNo, pp_Amount: f.pp_Amount, pp_MerchantID: f.pp_MerchantID };
  reply.pp_SecureHash = platform._jazzcash.hash(reply);
  const back = await callForm('/api/places?a=jazzcash-return', reply, ip);
  return { ok: back.status === 303 && /payment=success/.test(back.headers.location || ''), text: back.headers.location };
}
function callForm(p, fields, ip) {
  return new Promise((resolve) => {
    const data = new URLSearchParams(fields).toString();
    const req = http.request({ port, path: p, method: 'POST', headers: { 'X-Forwarded-For': ip, 'Content-Type': 'application/x-www-form-urlencoded' } }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
    });
    req.on('error', () => resolve({ status: 0, headers: {} }));
    req.write(data);
    req.end();
  });
}

// ---------------------------------------------------------------------------
let port;
let ipSeq = 0;
function call(p, { method, body, headers, ip } = {}) {
  return new Promise((resolve) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request(
      { port, path: p, method: method || (data ? 'POST' : 'GET'), headers: { 'X-Forwarded-For': ip || '10.9.9.9', ...(data ? { 'Content-Type': 'application/json' } : {}), ...(headers || {}) } },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString();
          let j = null;
          try { j = JSON.parse(text); } catch (e) { /* html */ }
          resolve({ status: res.statusCode, body: j, text, headers: res.headers });
        });
      }
    );
    req.on('error', (e) => resolve({ status: 0, body: null, text: e.message }));
    if (data) req.write(data);
    req.end();
  });
}

const results = new Map(); // feature -> {pass, fail, errors:Set}
function check(feature, ok, detail) {
  const r = results.get(feature) || { pass: 0, fail: 0, errors: new Set() };
  if (ok) r.pass++;
  else {
    r.fail++;
    if (r.errors.size < 5) r.errors.add(String(detail).slice(0, 200));
  }
  results.set(feature, r);
  return ok;
}

const pick = (arr, i) => arr[i % arr.length];
const CITIES = ['Islamabad', 'Rawalpindi', 'Lahore', 'Karachi', 'Peshawar', 'Multan', 'Quetta', 'Faisalabad'];
const COORDS = { Islamabad: [33.69, 73.05], Rawalpindi: [33.6, 73.04], Lahore: [31.52, 74.35], Karachi: [24.86, 67.0], Peshawar: [34.01, 71.52], Multan: [30.16, 71.52], Quetta: [30.18, 66.98], Faisalabad: [31.42, 73.08] };
const QUERIES = ['panadol', 'augmentin', 'risek', 'brufen', 'flagyl', 'glucophage', 'disprin', 'arinac', 'calpol', 'amoxil', 'nexum', 'ponstan', 'motilium', 'zyrtec', 'ventolin'].filter((q) => engine.search(q, { limit: 1 }).length);
const MEDS = QUERIES.map((q) => (engine.search(q, { limit: 1 })[0] || {}).med).filter(Boolean);

const admin = { headers: { 'X-SD-Admin': '1' } };
const pharmacies = []; // {id, token, city, uid}
const companies = []; // codes
const bearer = (t) => ({ Authorization: 'Bearer ' + t });

// ---------------------------------------------------------------------------
async function signup(role, n, ip) {
  const r = await call('/api/account?a=signup', { ip, body: { email: `sim${n}-${role}@example.com`, name: `${role} user ${n}`, phone: '0300' + String(1000000 + n), password: 'sim-pass-' + n, role, acceptTerms: true } });
  check(`[${role}] sign up`, r.status === 200 && r.body && r.body.token && r.body.user.role === role, r.text);
  if (r.status !== 200) return null;
  const login = await call('/api/account?a=login', { ip, body: { email: `SIM${n}-${role}@example.com`, password: 'sim-pass-' + n } });
  check(`[${role}] log in (case-insensitive email)`, login.status === 200 && login.body.token, login.text);
  const bad = await call('/api/account?a=login', { ip, body: { email: `sim${n}-${role}@example.com`, password: 'wrong-password' } });
  check('[security] wrong password refused', bad.status === 401, bad.status);
  const me = await call('/api/account?a=me', { headers: bearer(r.body.token) });
  check(`[${role}] profile loads`, me.status === 200 && me.body.user.email === `sim${n}-${role}@example.com`, me.text);
  check(`[${role}] correct starting plan`, role === 'patient' ? me.body.user.plan === 'free' : me.body.user.trial === true && me.body.user.plan !== 'free', JSON.stringify(me.body.user));
  check('[last login] method + previous login remembered', me.body.user.lastLogin && me.body.user.lastLogin.method === 'password' && me.body.user.prevLogin && me.body.user.prevLogin.method === 'password', JSON.stringify(me.body.user.lastLogin));
  check('[terms] terms version stored at sign-up', me.body.user.termsVersion === '2026-11-27', me.body.user.termsVersion);
  if (n % 25 === 0) {
    const noTerms = await call('/api/account?a=signup', { ip, body: { email: `noterms${n}-${role}@example.com`, name: 'No Terms', password: 'sim-pass-' + n, role } });
    check('[terms] sign-up without accepting terms refused', noTerms.status === 400, noTerms.status);
  }
  return { token: r.body.token, user: r.body.user, ip, n };
}

async function patient(n) {
  const ip = '10.1.' + ((n >> 8) & 255) + '.' + (n & 255);
  let s;
  if (n % 5 === 2) {
    const g = await call('/api/account?a=google', { ip, body: { acceptTerms: true, credential: `fake|g-${n}|sim${n}-google@gmail.com|Google Person ${n}` } });
    check('[google] sign up with Google', g.status === 200 && g.body.created === true && g.body.user.google === true, g.text);
    const g2 = await call('/api/account?a=google', { ip, body: { credential: `fake|g-${n}|sim${n}-google@gmail.com|Google Person ${n}` } });
    check('[google] sign in again with Google', g2.status === 200 && g2.body.created === false && g2.body.user.id === g.body.user.id, g2.text);
    check('[last login] Google sign-in remembered', g2.body && g2.body.user.lastLogin && g2.body.user.lastLogin.method === 'google' && g2.body.user.prevLogin.method === 'google', JSON.stringify(g2.body && g2.body.user.lastLogin));
    const bad = await call('/api/account?a=google', { ip, body: { credential: `fake|g-other-${n}|sim${n}-google@gmail.com|Imposter` } });
    check('[security] different Google account with same email refused', bad.status === 401, bad.status);
    s = g.status === 200 ? { token: g2.body.token, user: g2.body.user, ip, n } : null;
  } else s = await signup('patient', n, ip);
  if (!s) return;
  const med = pick(MEDS, n);
  const city = pick(CITIES, n);
  // search via API is public data; simulate the medicine page's nearby request
  const near = await call(`/api/places?a=nearby&med=${med.id}&city=${city}`, { ip });
  check('[patient] pharmacies near you (by city)', near.status === 200 && Array.isArray(near.body.pharmacies), near.text);
  const [lat, lng] = COORDS[city];
  const near2 = await call(`/api/places?a=nearby&med=${med.id}&lat=${lat}&lng=${lng}`, { ip });
  check('[patient] pharmacies near you (by location)', near2.status === 200 && near2.body.pharmacies.every((p) => p.km == null || p.km <= 50), near2.text);
  const list = near.body.pharmacies || [];
  if (list.length) {
    const p = list[0];
    check('[patient] only verified pharmacies shown', list.every((x) => x.verified), JSON.stringify(list[0]));
    check('[patient] WhatsApp / call details present', !!(p.whatsapp || p.phone), JSON.stringify(p));
    for (const type of ['view', 'wa', 'call', 'dir']) {
      const e = await call('/api/places?a=event', { ip, body: { pid: p.id, type } });
      check(`[patient] tap counted (${type})`, e.status === 200, e.text);
    }
    if (p.reserve && n % 3 === 0) {
      const rv = await call('/api/places?a=reserve', { ip, body: { pid: p.id, med: med.id, name: 'Patient ' + n, phone: '0311' + String(1000000 + n), qty: '1 pack' } });
      check('[patient] reserve medicine at pharmacy', rv.status === 200, rv.text);
    }
    const withOffer = list.find((x) => x.offer);
    if (withOffer) check('[patient] staff discount shown on pharmacy card', withOffer.offer.percent > 0 && withOffer.offer.percent <= 50, JSON.stringify(withOffer.offer));
    const deliverer = list.find((x) => x.delivery);
    if (deliverer && n % 3 === 1) {
      const dv = await call('/api/places?a=reserve', { ip, body: { pid: deliverer.id, med: med.id, name: 'Patient ' + n, phone: '0312' + String(1000000 + n), qty: '2 packs', delivery: true, address: `House ${n}, Street ${n % 30}, ${city}` } });
      check('[patient] order medicine delivery', dv.status === 200, dv.text);
    }
    const notDeliverer = list.find((x) => !x.delivery && x.reserve);
    if (notDeliverer && n % 7 === 0) {
      const nd = await call('/api/places?a=reserve', { ip, body: { pid: notDeliverer.id, med: med.id, name: 'P', phone: '03121234567', delivery: true, address: 'House 1, Street 1' } });
      check('[security] delivery refused when pharmacy does not deliver', nd.status === 400, nd.status);
    }
  }
  const cab = [{ id: med.id, perDay: 2, days: 30 }, { id: pick(MEDS, n + 3).id, perDay: 1, days: 30 }];
  const sc = await call('/api/account?a=save-cabinet', { headers: bearer(s.token), body: { cabinet: cab } });
  check('[patient] My Medicines saved to account', sc.status === 200 && sc.body.cabinet.length === 2, sc.text);
  const me = await call('/api/account?a=me', { headers: bearer(s.token) });
  check('[patient] My Medicines restored on another device', me.body.user.cabinet.length === 2, me.text);
  if (companies.length && n % 4 === 0) {
    const j = await call('/api/account?a=join-company', { headers: bearer(s.token), body: { code: pick(companies, n) } });
    check('[patient] join company staff benefit', j.status === 200 && j.body.user.joinedCompany, j.text);
  }
  // security: patient must not reach business actions
  if (pharmacies.length) {
    const x = await call('/api/account?a=stats&id=' + pick(pharmacies, n).id, { headers: bearer(s.token) });
    check('[security] patient cannot open a pharmacy dashboard', x.status === 404, x.status);
  }
  const tampered = await call('/api/account?a=me', { headers: bearer(s.token.slice(0, -3) + 'abc') });
  check('[security] tampered login token refused', tampered.status === 401, tampered.status);
  if (n % 6 === 1) {
    const ex = await call('/api/account?a=export', { headers: bearer(s.token), ip });
    check('[patient] download my data', ex.status === 200 && ex.body && ex.body.user.id === s.user.id && ex.body.user.cabinet.length === 2 && /attachment/.test(ex.headers['content-disposition'] || ''), ex.text.slice(0, 200));
    check('[security] my-data download has no password hash', !/passHash|passSalt|tokenVersion/.test(ex.text), 'secret field in export');
  }
  if (n % 9 === 0) {
    const ac = await call('/api/account?a=app-code', { headers: bearer(s.token), ip, body: { app: 'customer' } });
    const ok = check('[app login] browser makes a one-time app code', ac.status === 200 && /^[a-f0-9]{32}$/.test(ac.body.code), ac.text);
    if (ok) {
      const x = await call('/api/account?a=app-exchange', { ip, headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14; wv) SastaDawa/2.9' }, body: { code: ac.body.code } });
      check('[app login] app swaps the code for a login', x.status === 200 && x.body.token && x.body.user.id === s.user.id && x.body.user.lastLogin.app === 'customer', x.text);
      const again = await call('/api/account?a=app-exchange', { ip, body: { code: ac.body.code } });
      check('[security] app code works only once', again.status === 401, again.status);
    }
  }
  if (n % 10 === 0) {
    const cp = await call('/api/account?a=change-password', { headers: bearer(s.token), body: { current: 'sim-pass-' + n, password: 'new-pass-' + n } });
    check('[patient] change password', cp.status === 200, cp.text);
    const old = await call('/api/account?a=me', { headers: bearer(s.token) });
    check('[security] old sessions signed out after password change', old.status === 401, old.status);
    if (n % 20 === 0) {
      const d = await call('/api/account?a=delete-account', { headers: bearer(cp.body.token), body: { password: 'new-pass-' + n } });
      check('[patient] delete account', d.status === 200, d.text);
    }
  }
}

async function pharmacy(n) {
  const ip = '10.2.' + ((n >> 8) & 255) + '.' + (n & 255);
  const s = await signup('pharmacy', n, ip);
  if (!s) return;
  const city = pick(CITIES, n);
  const [lat, lng] = COORDS[city];
  const sp = await call('/api/account?a=save-pharmacy', { headers: bearer(s.token), body: { name: `Sim Pharmacy ${n}`, address: `Shop ${n}, Main Market`, area: 'Sector ' + (n % 12), city, phone: '0300' + String(2000000 + n), whatsapp: '+92300' + String(2000000 + n), hours: '9am - 11pm', lat: lat + (n % 10) / 1000, lng: lng + (n % 7) / 1000, featured: n % 5 === 0 } });
  if (!check('[pharmacy] create listing', sp.status === 200 && sp.body.pharmacy.verified === false, sp.text)) return;
  const pid = sp.body.pharmacy.id;
  const hidden = await call(`/api/places?a=nearby&city=${city}`, { ip });
  check('[pharmacy] unverified listing hidden from public', !hidden.body.pharmacies.some((p) => p.id === pid), hidden.text);
  const v = await call('/api/admin?a=pharmacy-update', { ...admin, body: { id: pid, verified: true } });
  check('[admin] verify pharmacy', v.status === 200, v.text);
  const two = await call('/api/account?a=save-pharmacy', { headers: bearer(s.token), body: { name: 'Branch 2', address: 'x road', city, phone: '03001112233' } });
  check('[pharmacy] 2nd branch needs Premium', two.status === 402, two.status);
  const items = [pick(MEDS, n), pick(MEDS, n + 1), pick(MEDS, n + 2)].map((m, i) => ({ id: m.id, s: i === 2 ? 'out' : 'in', price: Math.round(m.price * 0.95) }));
  const st = await call('/api/account?a=set-stock', { headers: bearer(s.token), body: { id: pid, items } });
  check('[pharmacy] stock & own prices', st.status === 200 && st.body.changed === 3, st.text);
  const bulk = await call('/api/account?a=set-stock', { headers: bearer(s.token), body: { id: pid, items: Array.from({ length: 60 }, (_, i) => ({ id: pick(MEDS, i).id, s: 'in' })) } });
  check('[pharmacy] bulk upload needs Premium (Pro refused)', bulk.status === 402, bulk.status);
  if (n % 3 === 1) {
    const rowsCsv = ['medicine,status,price', ...[pick(MEDS, n + 5), pick(MEDS, n + 6)].map((m, i) => `${i ? m.id : '"' + m.product + '"'},${i ? 'out' : 'in'},${i ? '' : Math.round(m.price * 0.9)}`)].join('\r\n');
    const ci = await call('/api/account?a=import-stock', { headers: bearer(s.token), ip, body: { pid, csv: rowsCsv } });
    check('[pharmacy] CSV stock import', ci.status === 200 && ci.body.imported === 2 && ci.body.errors.length === 0, ci.text.slice(0, 200));
    const badCsv = await call('/api/account?a=import-stock', { headers: bearer(s.token), ip, body: { pid, csv: 'medicine,status,price\r\n' + pick(MEDS, n).id + ',maybe,\r\n' } });
    check('[pharmacy] CSV with bad rows imports nothing', badCsv.status === 400 && badCsv.body.errors.length === 1 && badCsv.body.errors[0].row === 2, badCsv.text.slice(0, 200));
  }
  const pub = await call(`/api/places?a=nearby&med=${items[0].id}&city=${city}`, { ip });
  const mine = (pub.body.pharmacies || []).find((p) => p.id === pid);
  check('[pharmacy] verified listing visible with stock + price', mine && mine.stock === 'in' && mine.price === items[0].price && mine.verified, JSON.stringify(mine));
  if (n % 5 === 0) check('[pharmacy] featured shows as Sponsored', mine && mine.sponsored === true, JSON.stringify(mine));
  if (n % 3 === 0) {
    const of = await call('/api/account?a=save-offer', { headers: bearer(s.token), body: { id: pid, percent: 5 + (n % 15), note: 'Show company card' } });
    check('[pharmacy] staff discount offer', of.status === 200 && of.body.offer && of.body.offer.percent === 5 + (n % 15), of.text);
  }
  let premium = false;
  if (n % 8 === 4) {
    const jc = await jazzcashPay(s.token, 'pharmacy_premium', ip);
    check('[jazzcash] pay online and get upgraded', jc.ok, jc.text);
    const me = await call('/api/account?a=me', { headers: bearer(s.token) });
    premium = check('[jazzcash] plan active right after online payment', me.body.user.plan === 'pharmacy_premium' && me.body.user.trial === false, JSON.stringify(me.body.user));
    if (premium) {
      const dl = await call('/api/account?a=save-pharmacy', { headers: bearer(s.token), body: { id: pid, name: `Sim Pharmacy ${n}`, address: `Shop ${n}, Main Market`, city, phone: '0300' + String(2000000 + n), whatsapp: '+92300' + String(2000000 + n), lat, lng, delivery: true } });
      check('[premium] switch on home delivery', dl.status === 200 && dl.body.pharmacy.delivery === true, dl.text);
    }
  } else if (n % 4 === 0) {
    const tk = bearer(s.token);
    const pay = await call('/api/account?a=pay', { headers: tk, ip, body: { plan: 'pharmacy_premium', method: pick(['jazzcash', 'easypaisa', 'bank'], n), txnId: 'TX' + n + 'SIM', payerPhone: '03001234567' } });
    if (check('[payments] submit payment with transaction ID', pay.status === 200 && pay.body.payment.status === 'pending', pay.text)) {
      const ap = await call('/api/admin?a=payment-update', { ...admin, body: { key: pay.body.payment.key, status: 'approved' } });
      check('[admin] approve payment', ap.status === 200, ap.text);
      const me = await call('/api/account?a=me', { headers: tk });
      premium = check('[payments] approval upgrades plan', me.body.user.plan === 'pharmacy_premium' && me.body.user.trial === false, JSON.stringify(me.body.user));
      const dl = await call('/api/account?a=save-pharmacy', { headers: tk, body: { id: pid, name: `Sim Pharmacy ${n}`, address: `Shop ${n}, Main Market`, city, phone: '0300' + String(2000000 + n), whatsapp: '+92300' + String(2000000 + n), lat, lng, delivery: true } });
      check('[premium] switch on home delivery', dl.status === 200 && dl.body.pharmacy.delivery === true, dl.text);
    }
  }
  pharmacies.push({ id: pid, token: s.token, city, n, ip, premium });
  return { pid, s, city, ip };
}

async function pharmacyFollowUp(p) {
  const tk = bearer(p.token);
  const stats = await call('/api/account?a=stats&id=' + p.id, { headers: tk });
  check('[pharmacy] dashboard stats (30 days)', stats.status === 200 && stats.body.days.length === 30, stats.text);
  const alerts = await call('/api/account?a=alerts&id=' + p.id, { headers: tk });
  check('[pharmacy] request alerts', alerts.status === 200 && Array.isArray(alerts.body.demand), alerts.text);
  const rs = await call('/api/account?a=reservations&id=' + p.id, { headers: tk });
  check('[pharmacy] reservations list', rs.status === 200, rs.text);
  if (rs.body && rs.body.reservations && rs.body.reservations[0]) {
    const u = await call('/api/account?a=reservation-update', { headers: tk, body: { key: rs.body.reservations[0].key, status: 'ready' } });
    check('[pharmacy] mark reservation ready', u.status === 200, u.text);
  }
  const orders = (rs.body && rs.body.reservations) || [];
  const delivery = orders.find((o) => o.type === 'delivery');
  if (delivery) {
    check('[pharmacy] delivery order has address', !!delivery.address, JSON.stringify(delivery));
    const du = await call('/api/account?a=reservation-update', { headers: tk, body: { key: delivery.key, status: 'out_for_delivery' } });
    check('[pharmacy] mark order out for delivery', du.status === 200, du.text);
  }
  const first = orders[0];
  const sr = await call('/api/account?a=save-refill', { headers: tk, body: { pid: p.id, name: first ? first.name : 'Walk-in ' + p.n, phone: first ? first.phone : '0300' + String(3000000 + p.n), meds: [{ id: pick(MEDS, p.n).id, qty: '1 pack' }], every: 30, lastAt: new Date(Date.now() - 28 * 864e5).toISOString() } });
  check('[pharmacy] add refill customer', sr.status === 200, sr.text);
  const rf = await call('/api/account?a=refills&id=' + p.id, { headers: tk });
  check('[pharmacy] refill list shows who is due', rf.status === 200 && rf.body.customers.length === 1 && rf.body.customers[0].due === true, rf.text);
  const mr = await call('/api/account?a=mark-refilled', { headers: tk, body: { pid: p.id, id: rf.body.customers[0].id } });
  const rf2 = await call('/api/account?a=refills&id=' + p.id, { headers: tk });
  check('[pharmacy] mark customer refilled', mr.status === 200 && rf2.body.customers[0].due === false, rf2.text);
  const rep = await call('/api/account?a=report&id=' + p.id, { headers: tk });
  check('[pharmacy] monthly report', rep.status === 200 && rep.body.totals, rep.text);
  const comp = await call('/api/account?a=competitors&id=' + p.id, { headers: tk });
  if (!p.premium) check('[pharmacy] competitor prices need Premium (Pro refused)', comp.status === 402, comp.status);
  if (p.premium) {
    {
      const b2 = await call('/api/account?a=save-pharmacy', { headers: tk, body: { name: 'Branch 2', address: 'Blue Area', city: p.city, phone: '03001112233', delivery: true } });
      check('[premium] multiple branches', b2.status === 200, b2.text);
      const bulk = await call('/api/account?a=set-stock', { headers: tk, body: { id: p.id, items: Array.from({ length: 60 }, (_, i) => ({ id: pick(MEDS, i).id, s: 'in', price: 10 + i })) } });
      check('[premium] bulk stock upload (60 items)', bulk.status === 200, bulk.text);
      const c2 = await call('/api/account?a=competitors&id=' + p.id, { headers: tk });
      check('[premium] competitor prices', c2.status === 200 && Array.isArray(c2.body.rows), c2.text);
    }
  }
}

async function clinic(n) {
  const ip = '10.3.' + ((n >> 8) & 255) + '.' + (n & 255);
  const s = await signup('clinic', n, ip);
  if (!s) return;
  const c = await call('/api/account?a=save-clinic', { headers: bearer(s.token), body: { name: 'Sim Clinic ' + n, color: '#12507a', note: 'Ask reception', phone: '0511234567', city: pick(CITIES, n) } });
  check('[clinic] save widget branding', c.status === 200 && c.body.user.clinic.name === 'Sim Clinic ' + n, c.text);
  const w = await call('/api/places?a=widget&c=' + s.user.id, { ip });
  check('[clinic] widget info is public + active', w.status === 200 && w.body.active === true && w.body.color === '#12507a', w.text);
  const page = await call('/widget?c=' + s.user.id, { ip });
  check('[clinic] widget page can be embedded (no X-Frame-Options)', page.status === 200 && !page.headers['x-frame-options'], JSON.stringify(page.headers['x-frame-options']));
  const ev = await call('/api/places?a=event', { ip, body: { type: 'widget', clinic: s.user.id } });
  check('[clinic] widget searches counted', ev.status === 200, ev.text);
  check('[clinic] partner pharmacies in widget', Array.isArray(w.body.partners) && w.body.partners.length > 0 && w.body.partners.every((x) => x.verified), JSON.stringify(w.body.partners && w.body.partners[0]));
  const sv = await call('/api/places?a=event', { ip, body: { type: 'saved', clinic: s.user.id, amount: 100 + n } });
  check('[clinic] cheaper option shown is counted', sv.status === 200, sv.text);
  const st = await call('/api/account?a=stats', { headers: bearer(s.token) });
  check('[clinic] widget stats', st.status === 200 && st.body.totals.widget >= 1, st.text);
  check('[clinic] possible savings stats', st.body.totals.saved === 100 + n && st.body.totals.savedCount === 1, JSON.stringify(st.body.totals));
}

async function ngo(n) {
  const ip = '10.4.' + ((n >> 8) & 255) + '.' + (n & 255);
  const s = await signup('ngo', n, ip);
  if (!s) return;
  const items = [pick(MEDS, n), pick(MEDS, n + 4), pick(MEDS, n + 7)].map((m, i) => ({ id: m.id, qty: 100 * (i + 1) }));
  const o = await call('/api/account?a=optimise', { headers: bearer(s.token), body: { items } });
  check('[ngo] budget optimiser', o.status === 200 && o.body.rows.length === 3 && o.body.total_best <= o.body.total_now, o.text);
  const l = await call('/api/account?a=save-list', { headers: bearer(s.token), body: { name: 'Monthly camp', items } });
  check('[ngo] save medicine list', l.status === 200 && l.body.user.lists.length === 1, l.text);
  const pt = await call('/api/account?a=save-patient', { headers: bearer(s.token), body: { name: 'Patient ' + n, ref: 'R-' + n, meds: items.slice(0, 2) } });
  check('[ngo] patient tracking', pt.status === 200 && pt.body.user.patients.length === 1, pt.text);
  const list = l.body.user.lists[0];
  const qa = await call('/api/account?a=save-quote', { headers: bearer(s.token), body: { listId: list.id, supplier: 'Supplier A', prices: Object.fromEntries(items.map((x) => [x.id, 1 + (n % 5)])) } });
  check('[ngo] save supplier quote', qa.status === 200 && qa.body.user.lists[0].quotes.length === 1, qa.text);
  await call('/api/account?a=save-quote', { headers: bearer(s.token), body: { listId: list.id, supplier: 'Supplier B', prices: Object.fromEntries(items.map((x) => [x.id, 2 + (n % 5)])) } });
  const cq = await call('/api/account?a=compare-quotes', { headers: bearer(s.token), body: { items, quotes: [{ supplier: 'Supplier A', prices: Object.fromEntries(items.map((x) => [x.id, 1 + (n % 5)])) }, { supplier: 'Supplier B', prices: Object.fromEntries(items.map((x) => [x.id, 2 + (n % 5)])) }] } });
  check('[ngo] compare supplier quotes', cq.status === 200 && cq.body.best_supplier === 'Supplier A' && cq.body.quotes.length === 2, cq.text);
}

async function company(n) {
  const ip = '10.5.' + ((n >> 8) & 255) + '.' + (n & 255);
  const s = await signup('company', n, ip);
  if (!s) return;
  const c = await call('/api/account?a=create-company', { headers: bearer(s.token), body: { name: 'Sim Company ' + n } });
  if (check('[company] create staff code', c.status === 200 && /^[A-Z0-9]{4,12}$/.test(c.body.user.companyCode), c.text)) companies.push(c.body.user.companyCode);
  return s;
}
async function companyFollowUp(s) {
  const r = await call('/api/account?a=company', { headers: bearer(s.token) });
  check('[company] staff count + savings report', r.status === 200 && r.body.company && typeof r.body.company.monthly_saving === 'number', r.text);
  const rows = MEDS.slice(0, 5).map((m, i) => ({ medicine: i % 2 ? m.id : m.name, qty: 30 * (i + 1), paid: Math.round(m.unitPrice * 30 * (i + 1)) }));
  rows.push({ medicine: 'not a real medicine xyz' });
  const cr = await call('/api/account?a=claims-report', { headers: bearer(s.token), ip: s.ip, body: { rows } });
  check('[company] claims analysis', cr.status === 200 && cr.body.rows.length === 5 && cr.body.unmatched.length === 1 && cr.body.total_cheapest <= cr.body.total_paid, cr.text);
  const pr = await call('/api/account?a=partners', { headers: bearer(s.token) });
  check('[company] partner pharmacies with staff discounts', pr.status === 200 && pr.body.partners.length > 0 && pr.body.partners.every((x) => x.offer && x.offer.percent > 0), pr.text.slice(0, 200));
}

async function developer(n) {
  const ip = '10.6.' + ((n >> 8) & 255) + '.' + (n & 255);
  const s = await signup('developer', n, ip);
  if (!s) return;
  const k = await call('/api/account?a=create-key', { headers: bearer(s.token), body: {} });
  if (!check('[developer] create API key', k.status === 200 && /^sdk_/.test(k.body.key), k.text)) return;
  const H = { 'X-API-Key': k.body.key };
  const q = pick(QUERIES, n);
  const sr = await call('/api/v1?a=search&q=' + q, { headers: H, ip });
  check('[api] search', sr.status === 200 && sr.body.results.length > 0, sr.text);
  const id = sr.body.results[0].id;
  const md = await call('/api/v1?a=medicine&id=' + id, { headers: H, ip });
  check('[api] medicine details incl. DRAP reg no', md.status === 200 && 'drap_reg_no' in md.body.medicine, md.text);
  const al = await call('/api/v1?a=alternatives&id=' + id, { headers: H, ip });
  check('[api] cheaper alternatives', al.status === 200 && Array.isArray(al.body.alternatives), al.text);
  const op = await call('/api/v1?a=optimise', { headers: H, ip, body: { items: [{ id, qty: 30 }] } });
  check('[api] optimise a list', op.status === 200 && op.body.rows.length === 1, op.text);
  check('[api] rate-limit headers', !!sr.headers['x-ratelimit-limit'], JSON.stringify(sr.headers));
  const u = await call('/api/account?a=usage', { headers: bearer(s.token) });
  check('[developer] usage counter', u.status === 200 && u.body.today === 4, u.text);
  const nokey = await call('/api/v1?a=search&q=panadol', { ip });
  check('[security] API without key refused', nokey.status === 401, nokey.status);
  if (n % 5 === 0) {
    const kid = (await call('/api/account?a=me', { headers: bearer(s.token) })).body.user.apiKeys[0].id;
    await call('/api/account?a=revoke-key', { headers: bearer(s.token), body: { id: kid } });
    const after = await call('/api/v1?a=search&q=panadol', { headers: H, ip });
    check('[developer] revoked key stops working', after.status === 401, after.status);
  }
}

// ---------------------------------------------------------------------------
async function pool(n, fn) {
  let i = 0;
  const workers = Array.from({ length: CONC }, async () => {
    while (i < n) {
      const k = i++;
      try {
        await fn(k);
      } catch (e) {
        check('[crash] unexpected error', false, e && e.stack);
      }
    }
  });
  await Promise.all(workers);
}

(async () => {
  await new Promise((r) => server.listen(0, r));
  port = server.address().port;
  const t0 = Date.now();
  const lg = await call('/api/admin?a=login', { headers: { 'X-SD-Admin': '1' }, body: { password: 'sim-admin-password' } });
  admin.headers.Cookie = lg.headers['set-cookie'][0].split(';')[0];
  check('[admin] sign in', lg.status === 200, lg.text);

  // public pages
  for (const p of ['/', '/account', '/business', '/developers', '/widget', '/unonenginerrunon']) {
    const r = await call(p);
    check('[pages] ' + p + ' loads', r.status === 200 && /<html/i.test(r.text), r.status);
  }

  const mix = { pharmacy: Math.round(COUNT * 0.2), company: Math.round(COUNT * 0.05), clinic: Math.round(COUNT * 0.08), ngo: Math.round(COUNT * 0.07), developer: Math.round(COUNT * 0.1) };
  mix.patient = COUNT - Object.values(mix).reduce((a, b) => a + b, 0);
  console.log(`Simulating ${COUNT} people:`, mix);

  // Businesses first, so patients find pharmacies and companies to join.
  const companyUsers = [];
  await pool(mix.pharmacy, (i) => pharmacy(i));
  await pool(mix.company, async (i) => companyUsers.push(await company(i)));
  await pool(mix.clinic, (i) => clinic(i));
  await pool(mix.ngo, (i) => ngo(i));
  await pool(mix.developer, (i) => developer(i));
  await pool(mix.patient, (i) => patient(i));
  await pool(pharmacies.length, (i) => pharmacyFollowUp(pharmacies[i]));
  await pool(companyUsers.filter(Boolean).length, (i) => companyFollowUp(companyUsers.filter(Boolean)[i]));

  // admin views
  const an = await call('/api/admin?a=analytics', admin);
  check('[admin] analytics dashboard', an.status === 200 && an.body.users.total > 0 && an.body.revenue.approved > 0 && an.body.pharmacies.verified > 0 && an.body.events30.view > 0, an.text.slice(0, 200));
  for (const a of ['users', 'pharmacies', 'payments']) {
    const r = await call('/api/admin?a=' + a, admin);
    check('[admin] list ' + a, r.status === 200, r.text);
    if (a === 'users') check('[admin] all sign-ups visible', r.body.users.length >= COUNT - Math.floor(mix.patient / 20) - 2, r.body.users.length);
  }

  // expired plan
  const u0 = JSON.parse(fs.readFileSync(path.join(DIR, 'users', fs.readdirSync(path.join(DIR, 'users'))[0]), 'utf8'));
  void u0;

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const rows = [...results.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  let totalPass = 0;
  let totalFail = 0;
  console.log('\nFeature'.padEnd(62) + 'Pass'.padStart(7) + 'Fail'.padStart(7));
  for (const [f, r] of rows) {
    totalPass += r.pass;
    totalFail += r.fail;
    console.log(f.padEnd(61) + String(r.pass).padStart(7) + String(r.fail).padStart(7) + (r.fail ? '   <-- ' + [...r.errors][0] : ''));
  }
  console.log(`\n${COUNT} simulated people, ${totalPass + totalFail} checks: ${totalPass} passed, ${totalFail} failed, in ${secs}s`);
  fs.writeFileSync(path.join(__dirname, '..', 'sim-report.json'), JSON.stringify({ count: COUNT, mix, seconds: Number(secs), totalPass, totalFail, features: Object.fromEntries(rows.map(([f, r]) => [f, { pass: r.pass, fail: r.fail, errors: [...r.errors] }])) }, null, 2));
  server.close();
  fs.rmSync(DIR, { recursive: true, force: true });
  process.exit(totalFail ? 1 : 0);
})();
