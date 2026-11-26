/**
 * Accounts and paid plans (Pharmacy Pro/Premium, Clinic, NGO, Company, API).
 *
 *   /api/account?a=<action>   signed-in user actions (Bearer token from signup/login)
 *   /api/places?a=<action>    public pharmacy directory: nearby, events, reservations, widget info
 *   /api/v1?a=<action>        developer API (X-API-Key header)
 *   Admin actions are added to /api/admin (see adminActions below).
 *
 * Storage: the same private JSON store as the rest of the site (lib/store.js).
 *   users/<uid>.json            account (password stored as scrypt hash, never in plain text)
 *   emails/<sha>.json           email -> uid index
 *   pharmacies/<pid>.json       pharmacy listing (one per branch)
 *   stats/<pid>/<yyyy-mm>.json  daily counters per pharmacy: views, WhatsApp/call/directions taps
 *   demand/<city>/<yyyy-mm>.json  what people near a city searched for (request alerts)
 *   reservations/<pid>/<ts>-<rand>.json
 *   payments/<ts>-<rand>.json   manual JazzCash / Easypaisa / bank payments waiting for admin approval
 *   companies/<CODE>.json       company staff-benefit codes
 *   apikeys/<sha>.json          API key -> uid (only a hash of the key is stored)
 *   usage/<uid>/<yyyy-mm>.json  API calls per day
 *   secrets/session.json        random key that signs login tokens (created on first use)
 */
'use strict';

const crypto = require('crypto');
const store = require('./store');
const dataset = require('./dataset');

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------
const PLANS = {
  free: { name: 'Free', price: 0, roles: ['patient', 'pharmacy', 'clinic', 'ngo', 'company', 'developer'] },
  pharmacy_pro: { name: 'Pharmacy Pro', price: 1500, period: 'month', roles: ['pharmacy'] },
  pharmacy_premium: { name: 'Pharmacy Premium', price: 5000, period: 'month', roles: ['pharmacy'] },
  clinic: { name: 'Clinic / Hospital', price: 5000, period: 'month', roles: ['clinic'] },
  ngo: { name: 'NGO / Welfare Trust', price: 30000, period: 'year', roles: ['ngo'] },
  company: { name: 'Corporate / Insurer', price: 10000, period: 'month', roles: ['company'] },
  api: { name: 'API', price: 3000, period: 'month', roles: ['developer'] },
};
const ROLES = ['patient', 'pharmacy', 'clinic', 'ngo', 'company', 'developer'];
const PAID_FOR_ROLE = { pharmacy: 'pharmacy_pro', clinic: 'clinic', ngo: 'ngo', company: 'company', developer: 'api' };
const TRIAL_DAYS = 30; // founding offer: every business account starts with 30 days of its paid plan
const DAY = 24 * 60 * 60 * 1000;
const API_FREE_PER_DAY = 100;
const API_PAID_PER_DAY = 20000;

function activePlan(user, now) {
  if (!user) return 'free';
  if (user.plan && user.plan !== 'free' && user.planUntil && Date.parse(user.planUntil) > (now || Date.now())) return user.plan;
  return 'free';
}
function isPaid(user) {
  return activePlan(user) !== 'free';
}
function isPremium(user) {
  return activePlan(user) === 'pharmacy_premium';
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const rid = (n) => crypto.randomBytes(n || 6).toString('hex');
const today = (d) => (d ? new Date(d) : new Date()).toISOString().slice(0, 10);
const month = (d) => today(d).slice(0, 7);

function clean(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}
function slug(v) {
  return clean(v, 60).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
}
function phone(v) {
  const p = clean(v, 30).replace(/[^\d+]/g, '');
  return p.length >= 7 ? p : '';
}
function num(v, min, max) {
  const n = Number(v);
  return isFinite(n) && n >= min && n <= max ? n : null;
}
function validEmail(e) {
  return /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i.test(e);
}
const MED_ID = /^[a-z0-9-]{1,140}$/;
const err = (status, message) => Object.assign(new Error(message), { status });

// Passwords: scrypt with a per-user salt.
function hashPassword(pw, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(String(pw), s, 32, { N: 1 << 14, r: 8, p: 1 }).toString('hex');
  return { salt: s, hash: h };
}
function passwordMatches(pw, user) {
  if (!user || !user.passSalt || !user.passHash) return false;
  const { hash } = hashPassword(pw, user.passSalt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.passHash, 'hex'));
}

// Login tokens: base64url({uid, exp, v}).hmac  (v = token version; bump to sign out everywhere)
let secretCache = null;
async function secret() {
  if (process.env.USER_SESSION_SECRET) return process.env.USER_SESSION_SECRET;
  if (secretCache) return secretCache;
  let s = await store.get('secrets/session.json');
  if (!s || !s.key) {
    s = { key: crypto.randomBytes(32).toString('hex'), at: new Date().toISOString() };
    await store.put('secrets/session.json', s);
  }
  secretCache = s.key;
  return secretCache;
}
const TOKEN_DAYS = 60;
async function createToken(user) {
  const body = Buffer.from(JSON.stringify({ uid: user.id, v: user.tokenVersion || 0, exp: Date.now() + TOKEN_DAYS * DAY })).toString('base64url');
  return body + '.' + crypto.createHmac('sha256', await secret()).update(body).digest('base64url');
}
async function readToken(token) {
  if (typeof token !== 'string' || !token.includes('.') || token.length > 400) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', await secret()).update(body).digest('base64url');
  if (!sig || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const t = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return t && typeof t.uid === 'string' && t.exp > Date.now() ? t : null;
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
const UID = /^u_[a-f0-9]{12}$/;
const PID = /^p_[a-f0-9]{12}$/;
async function getUser(uid) {
  return UID.test(uid || '') ? store.get(`users/${uid}.json`) : null;
}
async function saveUser(u) {
  u.updatedAt = new Date().toISOString();
  await store.put(`users/${u.id}.json`, u);
  return u;
}
async function userByEmail(email) {
  const idx = await store.get(`emails/${sha(String(email).toLowerCase())}.json`);
  return idx ? getUser(idx.uid) : null;
}

/** What the browser sees about the signed-in user (no password hash). */
function publicUser(u) {
  const plan = activePlan(u);
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    phone: u.phone,
    role: u.role,
    plan,
    planName: PLANS[plan].name,
    planUntil: plan === 'free' ? null : u.planUntil,
    trial: !!u.trial && plan !== 'free',
    paidPlan: PAID_FOR_ROLE[u.role] || null,
    createdAt: u.createdAt,
    cabinet: u.cabinet || [],
    clinic: u.clinic || null,
    patients: u.patients || [],
    lists: u.lists || [],
    companyCode: u.companyCode || null,
    joinedCompany: u.joinedCompany || null,
    apiKeys: (u.apiKeys || []).map((k) => ({ id: k.id, prefix: k.prefix, createdAt: k.createdAt })),
  };
}

async function authUser(req) {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (!m) return null;
  const t = await readToken(m[1].trim());
  if (!t) return null;
  const u = await getUser(t.uid);
  if (!u || (u.tokenVersion || 0) !== t.v || u.disabled) return null;
  return u;
}

// ---------------------------------------------------------------------------
// Pharmacies
// ---------------------------------------------------------------------------
async function getPharmacy(pid) {
  return PID.test(pid || '') ? store.get(`pharmacies/${pid}.json`) : null;
}
async function savePharmacy(p) {
  p.updatedAt = new Date().toISOString();
  await store.put(`pharmacies/${p.id}.json`, p);
  directoryCache = null;
  return p;
}

// All listings, cached briefly per server instance (reads are the expensive part of Blob).
let directoryCache = null;
async function allPharmacies() {
  if (directoryCache && Date.now() - directoryCache.t < 60 * 1000) return directoryCache.list;
  const keys = await store.list('pharmacies/');
  const list = (await Promise.all(keys.slice(0, 3000).map((k) => store.get(k.key)))).filter(Boolean);
  const owners = new Map();
  await Promise.all([...new Set(list.map((p) => p.ownerId))].map(async (id) => owners.set(id, await getUser(id))));
  list.forEach((p) => {
    const o = owners.get(p.ownerId);
    p._plan = activePlan(o);
    p._ownerOk = !!o && !o.disabled;
  });
  directoryCache = { t: Date.now(), list };
  return list;
}

function publicPharmacy(p, medId, from) {
  const st = medId && p.stock && p.stock[medId];
  const paid = p._plan === 'pharmacy_pro' || p._plan === 'pharmacy_premium';
  const out = {
    id: p.id,
    name: p.name,
    address: p.address,
    area: p.area,
    city: p.city,
    phone: p.phone,
    whatsapp: p.whatsapp,
    hours: p.hours,
    verified: !!p.verified,
    sponsored: !!(paid && p.featured),
    delivery: !!(p.delivery && p._plan === 'pharmacy_premium'),
    reserve: paid,
    lat: p.lat,
    lng: p.lng,
  };
  if (st) {
    out.stock = st.s === 'out' ? 'out' : 'in';
    if (paid && st.price) out.price = st.price;
    out.stockAt = st.at || null;
  }
  if (from && p.lat != null && p.lng != null) out.km = Math.round(haversine(from, p) * 10) / 10;
  return out;
}

function haversine(a, b) {
  const R = 6371;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Counters are stored one file per pharmacy per month: { "2026-11-27": { views: 3, wa: 1 } }
const EVENT_TYPES = ['view', 'wa', 'call', 'dir', 'reserve', 'widget'];
async function bump(key, day, field, by) {
  const doc = (await store.get(key)) || {};
  const d = (doc[day] = doc[day] || {});
  d[field] = (d[field] || 0) + (by || 1);
  await store.put(key, doc);
}
async function statsFor(pid, days) {
  const now = Date.now();
  const months = new Set();
  for (let i = 0; i < days; i++) months.add(month(now - i * DAY));
  const docs = await Promise.all([...months].map((m) => store.get(`stats/${pid}/${m}.json`)));
  const merged = Object.assign({}, ...docs.filter(Boolean));
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = today(now - i * DAY);
    out.push({ day: d, ...(merged[d] || {}) });
  }
  const totals = {};
  out.forEach((r) => EVENT_TYPES.forEach((t) => (totals[t] = (totals[t] || 0) + (r[t] || 0))));
  return { days: out, totals };
}

async function demandFor(city, days) {
  const now = Date.now();
  const c = slug(city);
  const months = new Set();
  for (let i = 0; i < days; i++) months.add(month(now - i * DAY));
  const docs = (await Promise.all([...months].map((m) => store.get(`demand/${c}/${m}.json`)))).filter(Boolean);
  const counts = {};
  for (const doc of docs) {
    for (const [day, meds] of Object.entries(doc)) {
      if (Date.parse(day) < now - days * DAY) continue;
      for (const [id, n] of Object.entries(meds)) counts[id] = (counts[id] || 0) + n;
    }
  }
  const e = dataset.get().engine;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([id, n]) => {
      const m = e.byId(id);
      return { id, name: m ? m.product : id, generic: m ? m.generic : '', searches: n };
    });
}

// ---------------------------------------------------------------------------
// Medicine summaries (API + NGO optimiser)
// ---------------------------------------------------------------------------
function brief(m) {
  return {
    id: m.id,
    brand: m.name,
    product: m.product,
    formula: m.generic,
    strength: m.strength,
    form: m.form,
    pack: m.pack,
    pack_price_rs: m.price,
    unit_price_rs: Math.round(m.unitPrice * 100) / 100,
    manufacturer: m.manufacturer,
    drap_reg_no: m.reg || null,
    price_effective_from: m.effective,
  };
}

/** Cheapest same-formula option for each item: [{id, qty}] -> rows + totals. */
function optimise(items) {
  const e = dataset.get().engine;
  const rows = [];
  let now = 0;
  let best = 0;
  for (const it of (Array.isArray(items) ? items : []).slice(0, 300)) {
    const m = e.byId(String(it.id || ''));
    const qty = num(it.qty, 0, 1000000) || 1;
    if (!m) continue;
    const alts = e.alternatives(m, 'unit') || [];
    const cheapest = [m, ...alts].filter((x) => x.unitPrice > 0).sort((a, b) => a.unitPrice - b.unitPrice)[0] || m;
    const costNow = m.unitPrice * qty;
    const costBest = cheapest.unitPrice * qty;
    now += costNow;
    best += costBest;
    rows.push({ medicine: brief(m), qty, cheapest: brief(cheapest), cost_now: Math.round(costNow), cost_best: Math.round(costBest), saving: Math.round(costNow - costBest) });
  }
  return { rows, total_now: Math.round(now), total_best: Math.round(best), saving: Math.round(now - best), percent: now > 0 ? Math.round(((now - best) / now) * 100) : 0 };
}

// ---------------------------------------------------------------------------
// Route factory (gets the shared HTTP helpers from lib/api.js)
// ---------------------------------------------------------------------------
module.exports = function makePlatform(h) {
  const { json, readJson, clientIp, limiter, query } = h;
  const signupLimited = limiter(5, 60 * 60 * 1000);
  const loginLimited = limiter(10, 15 * 60 * 1000);
  const eventLimited = limiter(120, 10 * 60 * 1000);
  const reserveLimited = limiter(5, 60 * 60 * 1000);
  const rxLimited = limiter(10, 60 * 60 * 1000);
  const paymentLimited = limiter(10, 60 * 60 * 1000);

  async function body(req, limit) {
    const b = await readJson(req, limit || 16 * 1024);
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw err(400, 'Bad request');
    return b;
  }

  // ---------------------------------------------------------------- account
  async function account(req, res) {
    const a = query(req).get('a') || '';
    const ip = clientIp(req);
    const POST = req.method === 'POST';

    if (a === 'plans') return json(res, 200, { plans: PLANS, trialDays: TRIAL_DAYS, payTo: await payTo() });

    if (a === 'signup') {
      if (!POST) return json(res, 405, { error: 'POST only' });
      const b = await body(req);
      if (b.website) return json(res, 200, { ok: true }); // honeypot
      if (signupLimited(ip)) return json(res, 429, { error: 'Too many sign-ups from this network. Try again later.' });
      const email = clean(b.email, 200).toLowerCase();
      const name = clean(b.name, 80);
      const role = ROLES.includes(b.role) ? b.role : 'patient';
      const password = String(b.password || '');
      if (!validEmail(email)) return json(res, 400, { error: 'Please enter a valid email address.' });
      if (name.length < 2) return json(res, 400, { error: 'Please enter your name (or your business name).' });
      if (password.length < 8 || password.length > 200) return json(res, 400, { error: 'Password must be at least 8 characters.' });
      if (await userByEmail(email)) return json(res, 409, { error: 'An account with this email already exists. Please sign in.' });
      const { salt, hash } = hashPassword(password);
      const now = new Date();
      const u = {
        id: 'u_' + rid(6),
        email,
        name,
        phone: phone(b.phone),
        role,
        passSalt: salt,
        passHash: hash,
        tokenVersion: 0,
        plan: PAID_FOR_ROLE[role] || 'free',
        planUntil: PAID_FOR_ROLE[role] ? new Date(now.getTime() + TRIAL_DAYS * DAY).toISOString() : null,
        trial: !!PAID_FOR_ROLE[role],
        createdAt: now.toISOString(),
        cabinet: [],
      };
      await saveUser(u);
      await store.put(`emails/${sha(email)}.json`, { uid: u.id });
      return json(res, 200, { ok: true, token: await createToken(u), user: publicUser(u) });
    }

    if (a === 'login') {
      if (!POST) return json(res, 405, { error: 'POST only' });
      if (loginLimited(ip)) return json(res, 429, { error: 'Too many attempts. Wait 15 minutes.' });
      const b = await body(req);
      const u = await userByEmail(clean(b.email, 200).toLowerCase());
      if (!u || u.disabled || !passwordMatches(String(b.password || ''), u)) {
        await new Promise((r) => setTimeout(r, 300));
        return json(res, 401, { error: 'Wrong email or password.' });
      }
      return json(res, 200, { ok: true, token: await createToken(u), user: publicUser(u) });
    }

    // Everything below needs a signed-in user.
    const u = await authUser(req);
    if (!u) return json(res, 401, { error: 'Please sign in.' });
    if (a === 'me') return json(res, 200, { user: publicUser(u) });
    if (!POST && !['my-pharmacies', 'stats', 'alerts', 'reservations', 'payments', 'company', 'usage', 'competitors', 'report'].includes(a)) {
      return json(res, 405, { error: 'POST only' });
    }

    // -- profile
    if (a === 'update-profile') {
      const b = await body(req);
      if (b.name !== undefined) u.name = clean(b.name, 80) || u.name;
      if (b.phone !== undefined) u.phone = phone(b.phone);
      await saveUser(u);
      return json(res, 200, { user: publicUser(u) });
    }
    if (a === 'change-password') {
      const b = await body(req);
      if (!passwordMatches(String(b.current || ''), u)) return json(res, 400, { error: 'Current password is wrong.' });
      const pw = String(b.password || '');
      if (pw.length < 8) return json(res, 400, { error: 'New password must be at least 8 characters.' });
      const { salt, hash } = hashPassword(pw);
      Object.assign(u, { passSalt: salt, passHash: hash, tokenVersion: (u.tokenVersion || 0) + 1 });
      await saveUser(u);
      return json(res, 200, { ok: true, token: await createToken(u) });
    }
    if (a === 'logout-all') {
      u.tokenVersion = (u.tokenVersion || 0) + 1;
      await saveUser(u);
      return json(res, 200, { ok: true });
    }
    if (a === 'delete-account') {
      const b = await body(req);
      if (!passwordMatches(String(b.password || ''), u)) return json(res, 400, { error: 'Password is wrong.' });
      for (const p of (await allPharmacies()).filter((x) => x.ownerId === u.id)) await store.del(`pharmacies/${p.id}.json`);
      for (const k of u.apiKeys || []) await store.del(`apikeys/${k.hash}.json`);
      await store.del(`emails/${sha(u.email)}.json`);
      await store.del(`users/${u.id}.json`);
      directoryCache = null;
      return json(res, 200, { ok: true });
    }

    // -- patient: My Medicines synced to the account
    if (a === 'save-cabinet') {
      const b = await body(req, 64 * 1024);
      const list = (Array.isArray(b.cabinet) ? b.cabinet : [])
        .filter((x) => x && MED_ID.test(x.id || ''))
        .slice(0, 100)
        .map((x) => ({ id: x.id, perDay: num(x.perDay, 0, 50) || 1, days: num(x.days, 1, 365) || 30, at: clean(x.at, 30) }));
      u.cabinet = list;
      await saveUser(u);
      return json(res, 200, { ok: true, cabinet: list });
    }

    // -- company code (any account can join a company as staff)
    if (a === 'join-company') {
      const b = await body(req);
      const code = clean(b.code, 20).toUpperCase();
      const c = /^[A-Z0-9]{4,12}$/.test(code) ? await store.get(`companies/${code}.json`) : null;
      if (!c) return json(res, 404, { error: 'Company code not found.' });
      const owner = await getUser(c.ownerId);
      if (!isPaid(owner)) return json(res, 403, { error: 'This company benefit is not active right now.' });
      if (!c.members.includes(u.id)) c.members.push(u.id);
      await store.put(`companies/${code}.json`, c);
      u.joinedCompany = { code, name: c.name };
      await saveUser(u);
      return json(res, 200, { user: publicUser(u) });
    }

    // -- payments (manual: JazzCash / Easypaisa / bank transfer, approved by the admin)
    if (a === 'pay') {
      if (paymentLimited(ip)) return json(res, 429, { error: 'Too many requests. Try again later.' });
      const b = await body(req);
      const plan = PLANS[b.plan] && b.plan !== 'free' && PLANS[b.plan].roles.includes(u.role) ? b.plan : null;
      if (!plan) return json(res, 400, { error: 'This plan is not available for your account type.' });
      const method = ['jazzcash', 'easypaisa', 'bank'].includes(b.method) ? b.method : null;
      const txn = clean(b.txnId, 60);
      if (!method || txn.length < 4) return json(res, 400, { error: 'Choose how you paid and enter the transaction ID.' });
      const periods = num(b.periods, 1, 12) || 1;
      const p = { key: '', uid: u.id, email: u.email, name: u.name, plan, periods, amount: PLANS[plan].price * periods, method, txnId: txn, payerPhone: phone(b.payerPhone), status: 'pending', at: new Date().toISOString() };
      p.key = `payments/${Date.now()}-${rid(4)}.json`;
      await store.put(p.key, p);
      return json(res, 200, { ok: true, payment: p });
    }
    if (a === 'payments') {
      const keys = (await store.list('payments/')).sort((x, y) => (x.key < y.key ? 1 : -1)).slice(0, 400);
      const all = await Promise.all(keys.map((k) => store.get(k.key)));
      return json(res, 200, { payments: all.filter((p) => p && p.uid === u.id).slice(0, 50) });
    }

    // -------------------------------------------------------------- pharmacy
    if (u.role === 'pharmacy') {
      const mine = async () => (await allPharmacies()).filter((p) => p.ownerId === u.id);
      const own = async (pid) => {
        const p = await getPharmacy(pid);
        if (!p || p.ownerId !== u.id) throw err(404, 'Pharmacy not found.');
        return p;
      };
      const needPaid = () => {
        if (!isPaid(u)) throw err(402, 'This needs Pharmacy Pro. Your plan has ended: renew it from the Plan tab.');
      };

      if (a === 'my-pharmacies') {
        const list = await mine();
        return json(res, 200, { pharmacies: list.map((p) => ({ ...publicPharmacy(p), stock: p.stock || {}, featured: !!p.featured, delivery: !!p.delivery })) });
      }
      if (a === 'save-pharmacy') {
        const b = await body(req);
        const existing = b.id ? await own(b.id) : null;
        if (!existing) {
          const count = (await mine()).length;
          if (count >= 1 && !isPremium(u)) return json(res, 402, { error: 'More than one branch needs Pharmacy Premium.' });
          if (count >= 25) return json(res, 400, { error: 'Up to 25 branches per account.' });
        }
        const p = existing || { id: 'p_' + rid(6), ownerId: u.id, verified: false, stock: {}, createdAt: new Date().toISOString() };
        p.name = clean(b.name, 100);
        p.address = clean(b.address, 200);
        p.area = clean(b.area, 60);
        p.city = clean(b.city, 40);
        p.phone = phone(b.phone);
        p.whatsapp = phone(b.whatsapp);
        p.hours = clean(b.hours, 80);
        const lat = num(b.lat, 23, 38);
        const lng = num(b.lng, 60, 78);
        p.lat = lat != null && lng != null ? lat : null;
        p.lng = lat != null && lng != null ? lng : null;
        if (isPaid(u)) p.featured = !!b.featured;
        if (isPremium(u)) p.delivery = !!b.delivery;
        if (p.name.length < 2 || !p.city || !p.address) return json(res, 400, { error: 'Name, address and city are required.' });
        if (!p.phone && !p.whatsapp) return json(res, 400, { error: 'Add a phone or WhatsApp number so customers can reach you.' });
        await savePharmacy(p);
        return json(res, 200, { pharmacy: p });
      }
      if (a === 'delete-pharmacy') {
        const b = await body(req);
        const p = await own(b.id);
        await store.del(`pharmacies/${p.id}.json`);
        directoryCache = null;
        return json(res, 200, { ok: true });
      }
      if (a === 'set-stock') {
        needPaid();
        const b = await body(req, 512 * 1024);
        const p = await own(b.id);
        const e = dataset.get().engine;
        const items = Array.isArray(b.items) ? b.items.slice(0, 5000) : [];
        if (!isPremium(u) && items.length > 50) return json(res, 402, { error: 'Updating more than 50 medicines at once (bulk upload) needs Pharmacy Premium.' });
        let changed = 0;
        const unknown = [];
        p.stock = p.stock || {};
        for (const it of items) {
          const id = String((it && it.id) || '');
          if (!MED_ID.test(id) || !e.byId(id)) {
            if (it && it.id) unknown.push(String(it.id).slice(0, 60));
            continue;
          }
          if (it.remove) delete p.stock[id];
          else p.stock[id] = { s: it.s === 'out' ? 'out' : 'in', price: num(it.price, 0.01, 10000000) || undefined, at: new Date().toISOString() };
          changed++;
        }
        if (Object.keys(p.stock).length > 20000) return json(res, 400, { error: 'Too many medicines on one listing.' });
        await savePharmacy(p);
        return json(res, 200, { ok: true, changed, unknown: unknown.slice(0, 50), stock: p.stock });
      }
      if (a === 'stats') {
        needPaid();
        const p = await own(query(req).get('id'));
        return json(res, 200, await statsFor(p.id, 30));
      }
      if (a === 'report') {
        needPaid();
        const p = await own(query(req).get('id'));
        const s = await statsFor(p.id, 30);
        const demand = await demandFor(p.city, 30);
        const resv = await store.list(`reservations/${p.id}/`);
        return json(res, 200, { pharmacy: publicPharmacy(p), period: '30 days', totals: s.totals, reservations: resv.length, topDemand: demand.slice(0, 10) });
      }
      if (a === 'alerts') {
        needPaid();
        const p = await own(query(req).get('id'));
        const demand = await demandFor(p.city, 7);
        return json(res, 200, { city: p.city, demand: demand.map((d) => ({ ...d, inStock: !!(p.stock && p.stock[d.id] && p.stock[d.id].s !== 'out') })) });
      }
      if (a === 'competitors') {
        needPaid();
        if (!isPremium(u)) return json(res, 402, { error: 'Competitor prices need Pharmacy Premium.' });
        const p = await own(query(req).get('id'));
        const others = (await allPharmacies()).filter((x) => x.ownerId !== u.id && slug(x.city) === slug(p.city));
        const e = dataset.get().engine;
        const rows = [];
        for (const [id, st] of Object.entries(p.stock || {})) {
          const prices = others.map((o) => o.stock && o.stock[id] && o.stock[id].price).filter(Boolean);
          if (!prices.length) continue;
          const m = e.byId(id);
          rows.push({ id, name: m ? m.product : id, yours: st.price || null, avg: Math.round((prices.reduce((x, y) => x + y, 0) / prices.length) * 100) / 100, min: Math.min(...prices), pharmacies: prices.length, mrp: m ? m.price : null });
        }
        return json(res, 200, { city: p.city, rows: rows.slice(0, 500) });
      }
      if (a === 'reservations') {
        needPaid();
        const p = await own(query(req).get('id'));
        const keys = (await store.list(`reservations/${p.id}/`)).sort((x, y) => (x.key < y.key ? 1 : -1)).slice(0, 100);
        const items = (await Promise.all(keys.map(async (k) => ({ key: k.key, ...((await store.get(k.key)) || {}) })))).filter((r) => r.at);
        return json(res, 200, { reservations: items });
      }
      if (a === 'reservation-update') {
        const b = await body(req);
        const key = String(b.key || '');
        const m = /^reservations\/(p_[a-f0-9]{12})\/[0-9]+-[a-f0-9]+\.json$/.exec(key);
        if (!m) return json(res, 400, { error: 'Bad key' });
        await own(m[1]);
        const r = await store.get(key);
        if (!r) return json(res, 404, { error: 'Not found' });
        r.status = ['new', 'ready', 'collected', 'cancelled'].includes(b.status) ? b.status : r.status;
        await store.put(key, r);
        return json(res, 200, { ok: true });
      }
    }

    // ---------------------------------------------------------------- clinic
    if (u.role === 'clinic' && a === 'save-clinic') {
      const b = await body(req);
      u.clinic = { name: clean(b.name, 80) || u.name, color: /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : '#0f5c54', note: clean(b.note, 200), phone: phone(b.phone) };
      await saveUser(u);
      return json(res, 200, { user: publicUser(u) });
    }
    if (u.role === 'clinic' && a === 'stats') {
      return json(res, 200, await statsFor('w_' + u.id.slice(2), 30));
    }

    // ------------------------------------------------------------------- NGO
    if (u.role === 'ngo') {
      if (a === 'optimise') {
        const b = await body(req, 64 * 1024);
        return json(res, 200, optimise(b.items));
      }
      if (a === 'save-list') {
        if (!isPaid(u)) return json(res, 402, { error: 'Saving lists needs the NGO plan.' });
        const b = await body(req, 64 * 1024);
        const lists = (u.lists || []).filter((l) => l.id !== b.id);
        if (!b.remove) {
          const items = (Array.isArray(b.items) ? b.items : []).filter((x) => x && MED_ID.test(x.id || '')).slice(0, 300).map((x) => ({ id: x.id, qty: num(x.qty, 1, 1000000) || 1 }));
          lists.unshift({ id: /^l_[a-f0-9]{8}$/.test(b.id || '') ? b.id : 'l_' + rid(4), name: clean(b.name, 80) || 'Medicine list', items, at: new Date().toISOString() });
        }
        u.lists = lists.slice(0, 50);
        await saveUser(u);
        return json(res, 200, { user: publicUser(u) });
      }
      if (a === 'save-patient') {
        if (!isPaid(u)) return json(res, 402, { error: 'Patient tracking needs the NGO plan.' });
        const b = await body(req, 32 * 1024);
        const pts = (u.patients || []).filter((x) => x.id !== b.id);
        if (!b.remove) {
          const meds = (Array.isArray(b.meds) ? b.meds : []).filter((x) => x && MED_ID.test(x.id || '')).slice(0, 40).map((x) => ({ id: x.id, qty: num(x.qty, 1, 100000) || 30 }));
          pts.unshift({ id: /^pt_[a-f0-9]{8}$/.test(b.id || '') ? b.id : 'pt_' + rid(4), name: clean(b.name, 80), ref: clean(b.ref, 40), note: clean(b.note, 300), meds, at: new Date().toISOString() });
        }
        if (pts.length > 2000) return json(res, 400, { error: 'Up to 2000 patients per account.' });
        u.patients = pts;
        await saveUser(u);
        return json(res, 200, { user: publicUser(u) });
      }
    }

    // --------------------------------------------------------------- company
    if (u.role === 'company') {
      if (a === 'create-company') {
        const b = await body(req);
        if (u.companyCode) return json(res, 400, { error: 'Your company already has a code.' });
        const code = (slug(b.name || u.name).replace(/-/g, '').toUpperCase().slice(0, 5) || 'CO') + rid(2).toUpperCase();
        await store.put(`companies/${code}.json`, { code, ownerId: u.id, name: clean(b.name, 80) || u.name, members: [], at: new Date().toISOString() });
        u.companyCode = code;
        await saveUser(u);
        return json(res, 200, { user: publicUser(u) });
      }
      if (a === 'company') {
        if (!u.companyCode) return json(res, 200, { company: null });
        const c = await store.get(`companies/${u.companyCode}.json`);
        const members = (await Promise.all((c.members || []).slice(0, 2000).map(getUser))).filter(Boolean);
        let now = 0;
        let best = 0;
        for (const m of members) {
          // My Medicines stores tablets per day for tablets/capsules and packs per month for everything else.
          const e = dataset.get().engine;
          const r = optimise((m.cabinet || []).map((x) => {
            const med = e.byId(x.id);
            return { id: x.id, qty: med && med.unit === 'unit' ? (x.perDay || 1) * 30 : (x.perDay || 1) * ((med && med.units) || 1) };
          }));
          now += r.total_now;
          best += r.total_best;
        }
        return json(res, 200, { company: { code: c.code, name: c.name, members: members.length, active: isPaid(u), monthly_now: now, monthly_best: best, monthly_saving: now - best } });
      }
    }

    // ------------------------------------------------------------- developer
    if (u.role === 'developer') {
      if (a === 'create-key') {
        if ((u.apiKeys || []).length >= 5) return json(res, 400, { error: 'Up to 5 keys. Revoke one first.' });
        const key = 'sdk_' + crypto.randomBytes(20).toString('hex');
        const entry = { id: rid(4), prefix: key.slice(0, 10), hash: sha(key), createdAt: new Date().toISOString() };
        u.apiKeys = [...(u.apiKeys || []), entry];
        await store.put(`apikeys/${entry.hash}.json`, { uid: u.id, id: entry.id });
        await saveUser(u);
        return json(res, 200, { key, user: publicUser(u) }); // the full key is shown once only
      }
      if (a === 'revoke-key') {
        const b = await body(req);
        const k = (u.apiKeys || []).find((x) => x.id === b.id);
        if (!k) return json(res, 404, { error: 'Key not found' });
        await store.del(`apikeys/${k.hash}.json`);
        u.apiKeys = u.apiKeys.filter((x) => x.id !== b.id);
        await saveUser(u);
        return json(res, 200, { user: publicUser(u) });
      }
      if (a === 'usage') {
        const doc = (await store.get(`usage/${u.id}/${month()}.json`)) || {};
        return json(res, 200, { today: (doc[today()] || {}).n || 0, limit: isPaid(u) ? API_PAID_PER_DAY : API_FREE_PER_DAY, month: doc });
      }
    }

    return json(res, 404, { error: 'Unknown action for this account type.' });
  }

  async function payTo() {
    const cfg = await require('./config').load();
    return cfg.payments || {};
  }

  // ----------------------------------------------------------- public places
  async function places(req, res) {
    const a = query(req).get('a') || '';
    const ip = clientIp(req);
    const q = query(req);

    if (a === 'nearby') {
      const med = MED_ID.test(q.get('med') || '') ? q.get('med') : '';
      const city = clean(q.get('city'), 40);
      // A missing lat/lng must not become 0,0 (Number(null) === 0), or the 50 km filter hides everyone.
      const lat = q.get('lat') ? num(q.get('lat'), -90, 90) : null;
      const lng = q.get('lng') ? num(q.get('lng'), -180, 180) : null;
      const from = lat != null && lng != null ? { lat, lng } : null;
      let list = (await allPharmacies()).filter((p) => p.verified && p._ownerOk);
      if (city) list = list.filter((p) => slug(p.city) === slug(city));
      let out = list.map((p) => publicPharmacy(p, med, from));
      if (from) out = out.filter((p) => p.km == null || p.km <= 50);
      out.sort((x, y) => (y.sponsored ? 1 : 0) - (x.sponsored ? 1 : 0) || (x.stock === 'in' ? 0 : 1) - (y.stock === 'in' ? 0 : 1) || (x.km == null ? 999 : x.km) - (y.km == null ? 999 : y.km));
      // Remember what people near this city looked for (no personal data: medicine + city + day).
      if (med && (city || out[0]) && !eventLimited(ip)) {
        const c = slug(city || out[0].city);
        bump(`demand/${c}/${month()}.json`, today(), med).catch(() => {});
      }
      const cities = [...new Set(list.map((p) => p.city).filter(Boolean))].sort();
      return json(res, 200, { pharmacies: out.slice(0, 30), cities: city ? undefined : cities }, { 'Cache-Control': 'no-store' });
    }

    if (a === 'cities') {
      const list = (await allPharmacies()).filter((p) => p.verified && p._ownerOk);
      return json(res, 200, { cities: [...new Set(list.map((p) => p.city).filter(Boolean))].sort() });
    }

    if (a === 'event') {
      if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
      const b = await body(req, 2048);
      if (eventLimited(ip)) return json(res, 200, { ok: true });
      const type = EVENT_TYPES.includes(b.type) ? b.type : null;
      if (!type || type === 'reserve') return json(res, 400, { error: 'Bad event' });
      if (type === 'widget') {
        if (!UID.test(b.clinic || '')) return json(res, 400, { error: 'Bad clinic' });
        await bump(`stats/w_${b.clinic.slice(2)}/${month()}.json`, today(), 'widget');
        return json(res, 200, { ok: true });
      }
      const p = await getPharmacy(b.pid);
      if (!p) return json(res, 404, { error: 'Not found' });
      await bump(`stats/${p.id}/${month()}.json`, today(), type);
      return json(res, 200, { ok: true });
    }

    if (a === 'reserve') {
      if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
      const b = await body(req, 4096);
      if (b.website) return json(res, 200, { ok: true });
      if (reserveLimited(ip)) return json(res, 429, { error: 'Too many requests. Please call the pharmacy instead.' });
      const p = await getPharmacy(b.pid);
      if (!p || !p.verified) return json(res, 404, { error: 'Pharmacy not found' });
      const owner = await getUser(p.ownerId);
      if (!isPaid(owner)) return json(res, 403, { error: 'This pharmacy does not take online reservations. Please call them.' });
      const m = MED_ID.test(b.med || '') ? dataset.get().engine.byId(b.med) : null;
      const r = { pid: p.id, med: m ? m.id : '', medName: m ? m.product : clean(b.medName, 120), qty: clean(b.qty, 30), name: clean(b.name, 80), phone: phone(b.phone), note: clean(b.note, 300), status: 'new', at: new Date().toISOString() };
      if (!r.name || !r.phone || !r.medName) return json(res, 400, { error: 'Please add your name, phone and the medicine.' });
      await store.put(`reservations/${p.id}/${Date.now()}-${rid(4)}.json`, r);
      await bump(`stats/${p.id}/${month()}.json`, today(), 'reserve');
      return json(res, 200, { ok: true, pharmacy: { name: p.name, phone: p.phone, whatsapp: p.whatsapp } });
    }

    if (a === 'widget') {
      const c = q.get('c') || '';
      const u = await getUser(c);
      if (!u || u.role !== 'clinic') return json(res, 404, { error: 'Not found' });
      const active = isPaid(u);
      const cl = u.clinic || { name: u.name, color: '#0f5c54' };
      return json(res, 200, { active, name: cl.name || u.name, color: cl.color || '#0f5c54', note: cl.note || '', phone: cl.phone || '' }, { 'Cache-Control': 'no-cache', 'Vercel-CDN-Cache-Control': 'max-age=60' });
    }

    if (a === 'company') {
      const code = clean(q.get('code'), 20).toUpperCase();
      const c = /^[A-Z0-9]{4,12}$/.test(code) ? await store.get(`companies/${code}.json`) : null;
      return c ? json(res, 200, { name: c.name }) : json(res, 404, { error: 'Not found' });
    }

    // Prescription photo -> medicine names (uses the same Claude key as the assistant).
    if (a === 'rx') {
      if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
      const chatLib = require('./chat');
      if (!chatLib.aiEnabled()) return json(res, 503, { error: 'Prescription reading is not available right now.' });
      if (rxLimited(ip)) return json(res, 429, { error: 'Too many photos. Please wait an hour.' });
      const b = await body(req, 4 * 1024 * 1024); // Vercel functions accept bodies up to 4.5 MB
      const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(String(b.image || ''));
      if (!m) return json(res, 400, { error: 'Please send a JPG or PNG photo.' });
            try {
        const names = await readPrescription(chatLib, m[1], m[2]);
        const e = dataset.get().engine;
        const items = names.slice(0, 12).map((n) => {
          const hit = e.search(n.name + (n.strength ? ' ' + n.strength : ''), { limit: 1 })[0] || e.search(n.name, { limit: 1 })[0];
          return { read: n.name, strength: n.strength || '', match: hit ? { id: hit.med.id, product: hit.med.product, generic: hit.med.generic, strength: hit.med.strength, price: hit.med.price } : null };
        });
        return json(res, 200, { items });
      } catch (e) {
        console.error('Rx read failed:', e && e.message);
        return json(res, 502, { error: 'Could not read this photo. Try a clearer, well-lit photo.' });
      }
    }

    return json(res, 404, { error: 'Unknown action' });
  }

  // ------------------------------------------------------------ developer API
  async function v1(req, res) {
    const q = query(req);
    const key = String(req.headers['x-api-key'] || q.get('key') || '');
    if (!/^sdk_[a-f0-9]{40}$/.test(key)) return json(res, 401, { error: 'Missing or invalid API key. Send it in the X-API-Key header.' });
    const k = await store.get(`apikeys/${sha(key)}.json`);
    const u = k && (await getUser(k.uid));
    if (!u || u.disabled) return json(res, 401, { error: 'Invalid API key.' });
    const limit = isPaid(u) ? API_PAID_PER_DAY : API_FREE_PER_DAY;
    const ukey = `usage/${u.id}/${month()}.json`;
    const doc = (await store.get(ukey)) || {};
    const used = (doc[today()] || {}).n || 0;
    const headers = { 'X-RateLimit-Limit': String(limit), 'X-RateLimit-Remaining': String(Math.max(0, limit - used - 1)), 'Access-Control-Allow-Origin': '*' };
    if (used >= limit) return json(res, 429, { error: `Daily limit of ${limit} calls reached. Upgrade to the API plan for more.` }, headers);
    (doc[today()] = doc[today()] || {}).n = used + 1;
    store.put(ukey, doc).catch(() => {});

    const a = q.get('a') || '';
    const e = dataset.get().engine;
    if (a === 'search') {
      const term = clean(q.get('q'), 120);
      if (!term) return json(res, 400, { error: 'Add ?q=' }, headers);
      return json(res, 200, { query: term, results: e.search(term, { limit: num(q.get('limit'), 1, 50) || 10 }).map((r) => brief(r.med)) }, headers);
    }
    if (a === 'medicine' || a === 'alternatives') {
      const m = e.byId(clean(q.get('id'), 140));
      if (!m) return json(res, 404, { error: 'Unknown medicine id' }, headers);
      if (a === 'medicine') return json(res, 200, { medicine: brief(m) }, headers);
      const alts = (e.alternatives(m, 'unit') || []).slice(0, 30);
      return json(res, 200, { medicine: brief(m), alternatives: alts.map((x) => ({ ...brief(x), percent_vs_selected: m.unitPrice > 0 ? Math.round(((x.unitPrice - m.unitPrice) / m.unitPrice) * 100) : 0 })) }, headers);
    }
    if (a === 'optimise' && req.method === 'POST') {
      const b = await body(req, 64 * 1024);
      return json(res, 200, optimise(b.items), headers);
    }
    return json(res, 404, { error: 'Unknown action. Use a=search, a=medicine, a=alternatives or POST a=optimise.' }, headers);
  }

  // ------------------------------------------------------------- admin extras
  async function adminActions(a, req, res) {
    if (a === 'users') {
      const keys = (await store.list('users/')).slice(0, 3000);
      const users = (await Promise.all(keys.map((k) => store.get(k.key)))).filter(Boolean);
      users.sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1));
      return json(res, 200, { users: users.map((u) => ({ id: u.id, email: u.email, name: u.name, phone: u.phone, role: u.role, plan: activePlan(u), planUntil: u.planUntil, trial: !!u.trial, disabled: !!u.disabled, createdAt: u.createdAt })) });
    }
    if (a === 'pharmacies') {
      directoryCache = null;
      const list = await allPharmacies();
      return json(res, 200, { pharmacies: list.map((p) => ({ ...publicPharmacy(p), ownerId: p.ownerId, plan: p._plan, featured: !!p.featured, stockCount: Object.keys(p.stock || {}).length, createdAt: p.createdAt })) });
    }
    if (a === 'payments') {
      const keys = (await store.list('payments/')).sort((x, y) => (x.key < y.key ? 1 : -1)).slice(0, 200);
      return json(res, 200, { payments: (await Promise.all(keys.map((k) => store.get(k.key)))).filter(Boolean) });
    }
    if (req.method !== 'POST') return null;
    const b = await body(req);
    if (a === 'pharmacy-update') {
      const p = await getPharmacy(b.id);
      if (!p) return json(res, 404, { error: 'Not found' });
      if ('verified' in b) p.verified = !!b.verified;
      if ('featured' in b) p.featured = !!b.featured;
      await savePharmacy(p);
      return json(res, 200, { ok: true });
    }
    if (a === 'payment-update') {
      const key = String(b.key || '');
      if (!/^payments\/[0-9]+-[a-f0-9]+\.json$/.test(key)) return json(res, 400, { error: 'Bad key' });
      const p = await store.get(key);
      if (!p) return json(res, 404, { error: 'Not found' });
      if (p.status !== 'pending') return json(res, 400, { error: 'Already ' + p.status });
      p.status = b.status === 'approved' ? 'approved' : 'rejected';
      p.decidedAt = new Date().toISOString();
      if (p.status === 'approved') {
        const u = await getUser(p.uid);
        if (!u) return json(res, 404, { error: 'User is gone' });
        grant(u, p.plan, (PLANS[p.plan].period === 'year' ? 365 : 30) * (p.periods || 1));
        await saveUser(u);
        directoryCache = null;
      }
      await store.put(key, p);
      return json(res, 200, { ok: true });
    }
    if (a === 'user-update') {
      const u = await getUser(b.id);
      if (!u) return json(res, 404, { error: 'Not found' });
      if ('disabled' in b) u.disabled = !!b.disabled;
      if (b.grantPlan && PLANS[b.grantPlan]) grant(u, b.grantPlan, num(b.days, 1, 3650) || 30);
      await saveUser(u);
      directoryCache = null;
      return json(res, 200, { ok: true });
    }
    return null;
  }

  function grant(u, plan, days) {
    if (plan === 'free') {
      u.plan = 'free';
      u.planUntil = null;
      return;
    }
    const base = u.plan === plan && !u.trial && u.planUntil && Date.parse(u.planUntil) > Date.now() ? Date.parse(u.planUntil) : Date.now();
    u.plan = plan;
    u.planUntil = new Date(base + days * DAY).toISOString();
    u.trial = false;
  }

  return { account, places, v1, adminActions };
};

async function readPrescription(chatLib, mediaType, data) {
  const A = chatLib.Anthropic();
  const client = new A();
  const r = await client.messages.create({
    model: chatLib.CHAT_MODEL,
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
          {
            type: 'text',
            text: 'This is a photo of a medical prescription or medicine pack from Pakistan. List every medicine name you can read, with strength if written. Reply with JSON only: {"medicines":[{"name":"...","strength":"..."}]}. If you cannot read any, reply {"medicines":[]}.',
          },
        ],
      },
    ],
  });
  const text = (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  const m = /\{[\s\S]*\}/.exec(text);
  const parsed = m ? JSON.parse(m[0]) : { medicines: [] };
  return (parsed.medicines || []).filter((x) => x && x.name).map((x) => ({ name: String(x.name).slice(0, 80), strength: String(x.strength || '').slice(0, 30) }));
}

module.exports.PLANS = PLANS;
module.exports._internals = { hashPassword, passwordMatches, activePlan, optimise, haversine };
