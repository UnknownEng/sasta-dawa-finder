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
delete process.env.ANTHROPIC_API_KEY;
delete process.env.VERCEL;
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.BLOB_STORE_ID;

const { server } = require('../server');
const dataset = require('../lib/dataset');
const engine = dataset.get().engine;

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
  const r = await call('/api/account?a=signup', { ip, body: { email: `sim${n}-${role}@example.com`, name: `${role} user ${n}`, phone: '0300' + String(1000000 + n), password: 'sim-pass-' + n, role } });
  check(`[${role}] sign up`, r.status === 200 && r.body && r.body.token && r.body.user.role === role, r.text);
  if (r.status !== 200) return null;
  const login = await call('/api/account?a=login', { ip, body: { email: `SIM${n}-${role}@example.com`, password: 'sim-pass-' + n } });
  check(`[${role}] log in (case-insensitive email)`, login.status === 200 && login.body.token, login.text);
  const bad = await call('/api/account?a=login', { ip, body: { email: `sim${n}-${role}@example.com`, password: 'wrong-password' } });
  check('[security] wrong password refused', bad.status === 401, bad.status);
  const me = await call('/api/account?a=me', { headers: bearer(r.body.token) });
  check(`[${role}] profile loads`, me.status === 200 && me.body.user.email === `sim${n}-${role}@example.com`, me.text);
  check(`[${role}] correct starting plan`, role === 'patient' ? me.body.user.plan === 'free' : me.body.user.trial === true && me.body.user.plan !== 'free', JSON.stringify(me.body.user));
  return { token: r.body.token, user: r.body.user, ip, n };
}

async function patient(n) {
  const ip = '10.1.' + ((n >> 8) & 255) + '.' + (n & 255);
  const s = await signup('patient', n, ip);
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
  const pub = await call(`/api/places?a=nearby&med=${items[0].id}&city=${city}`, { ip });
  const mine = (pub.body.pharmacies || []).find((p) => p.id === pid);
  check('[pharmacy] verified listing visible with stock + price', mine && mine.stock === 'in' && mine.price === items[0].price && mine.verified, JSON.stringify(mine));
  if (n % 5 === 0) check('[pharmacy] featured shows as Sponsored', mine && mine.sponsored === true, JSON.stringify(mine));
  pharmacies.push({ id: pid, token: s.token, city, n, ip });
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
  const rep = await call('/api/account?a=report&id=' + p.id, { headers: tk });
  check('[pharmacy] monthly report', rep.status === 200 && rep.body.totals, rep.text);
  const comp = await call('/api/account?a=competitors&id=' + p.id, { headers: tk });
  check('[pharmacy] competitor prices need Premium (Pro refused)', comp.status === 402, comp.status);
  if (p.n % 4 === 0) {
    const pay = await call('/api/account?a=pay', { headers: tk, ip: p.ip, body: { plan: 'pharmacy_premium', method: pick(['jazzcash', 'easypaisa', 'bank'], p.n), txnId: 'TX' + p.n + 'SIM', payerPhone: '03001234567' } });
    if (check('[payments] submit payment with transaction ID', pay.status === 200 && pay.body.payment.status === 'pending', pay.text)) {
      const ap = await call('/api/admin?a=payment-update', { ...admin, body: { key: pay.body.payment.key, status: 'approved' } });
      check('[admin] approve payment', ap.status === 200, ap.text);
      const me = await call('/api/account?a=me', { headers: tk });
      check('[payments] approval upgrades plan', me.body.user.plan === 'pharmacy_premium' && me.body.user.trial === false, JSON.stringify(me.body.user));
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
  const c = await call('/api/account?a=save-clinic', { headers: bearer(s.token), body: { name: 'Sim Clinic ' + n, color: '#12507a', note: 'Ask reception', phone: '0511234567' } });
  check('[clinic] save widget branding', c.status === 200 && c.body.user.clinic.name === 'Sim Clinic ' + n, c.text);
  const w = await call('/api/places?a=widget&c=' + s.user.id, { ip });
  check('[clinic] widget info is public + active', w.status === 200 && w.body.active === true && w.body.color === '#12507a', w.text);
  const page = await call('/widget?c=' + s.user.id, { ip });
  check('[clinic] widget page can be embedded (no X-Frame-Options)', page.status === 200 && !page.headers['x-frame-options'], JSON.stringify(page.headers['x-frame-options']));
  const ev = await call('/api/places?a=event', { ip, body: { type: 'widget', clinic: s.user.id } });
  check('[clinic] widget searches counted', ev.status === 200, ev.text);
  const st = await call('/api/account?a=stats', { headers: bearer(s.token) });
  check('[clinic] widget stats', st.status === 200 && st.body.totals.widget >= 1, st.text);
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
