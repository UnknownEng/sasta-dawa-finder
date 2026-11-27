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
 *   refills/<pid>.json          a pharmacy's refill customers
 *   appcodes/<sha>.json         one-time browser -> app login codes { uid, exp (5 min), app, via }
 *   secrets/session.json        random key that signs login tokens (created on first use)
 */
'use strict';

const crypto = require('crypto');
const store = require('./store');
const dataset = require('./dataset');
const csvLib = require('./csv');

const APP_CODE_MS = 5 * 60 * 1000; // browser -> app login codes live 5 minutes, single use

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
    hasPassword: !!u.passHash,
    google: !!u.googleSub,
    lastLogin: loginView(u.lastLogin),
    prevLogin: loginView(u.prevLogin),
    termsVersion: u.termsVersion || null,
  };
}

// ---------------------------------------------------------------------------
// Last login method + terms
// ---------------------------------------------------------------------------
const TERMS_VERSION = '2026-11-27';
const LOGIN_METHODS = ['password', 'google', 'app'];

function loginView(l) {
  if (!l || !l.method) return null;
  const out = { method: l.method, at: l.at || null, device: l.ua || '' };
  if (l.app) out.app = l.app;
  return out;
}

/** Short device label from the User-Agent, e.g. "Chrome on Android". */
function deviceLabel(ua) {
  const s = String(ua || '');
  const os = /Android/i.test(s) ? 'Android' : /iPhone|iPad|iPod/i.test(s) ? 'iPhone' : /Windows/i.test(s) ? 'Windows' : /CrOS/.test(s) ? 'ChromeOS' : /Mac OS X|Macintosh/i.test(s) ? 'Mac' : /Linux/i.test(s) ? 'Linux' : '';
  const br = /SastaDawa/i.test(s) ? 'Sasta Dawa app' : /Edg\//.test(s) ? 'Edge' : /OPR\//.test(s) ? 'Opera' : /SamsungBrowser/.test(s) ? 'Samsung Internet' : /Firefox\//.test(s) ? 'Firefox' : /; wv\)/.test(s) ? 'App' : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : '';
  if (!br && !os) return 'Unknown device';
  return clean([br, os].filter(Boolean).join(' on '), 40);
}

/** Remember how the user signed in: lastLogin (and the one before it as prevLogin). Saves the user. */
async function recordLogin(u, method, req, extra) {
  const m = LOGIN_METHODS.includes(method) ? method : 'password';
  u.prevLogin = u.lastLogin || null;
  u.lastLogin = { method: m, at: new Date().toISOString(), ua: deviceLabel(req && req.headers && req.headers['user-agent']), ...(extra || {}) };
  await saveUser(u);
  return u;
}

// ---------------------------------------------------------------------------
// Uploaded images (prescription photos): real JPEG / PNG / WEBP only
// ---------------------------------------------------------------------------
const IMAGE_MAX = 4 * 1024 * 1024;
function sniffImage(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}
/**
 * Check a data: URL photo. Returns { mediaType, data } or throws 400. Rejects SVG/HTML, anything
 * whose bytes don't start with a JPEG/PNG/WEBP signature, files over 4 MB decoded, and polyglots
 * (image files carrying HTML/script markup).
 */
function checkImage(dataUrl) {
  const m = /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ''));
  if (!m) throw err(400, 'Please send a JPG, PNG or WEBP photo.');
  const b64 = m[2].replace(/\s/g, '');
  if (b64.length > Math.ceil(IMAGE_MAX / 3) * 4 + 4) throw err(413, 'The photo is larger than 4 MB. Please send a smaller photo.');
  const buf = Buffer.from(b64, 'base64');
  if (buf.length > IMAGE_MAX) throw err(413, 'The photo is larger than 4 MB. Please send a smaller photo.');
  const type = sniffImage(buf);
  if (!type) throw err(400, 'This file is not a real JPG, PNG or WEBP photo.');
  const declared = m[1] === 'image/jpg' ? 'image/jpeg' : m[1];
  if (declared !== type) throw err(400, 'The photo type does not match its contents.');
  if (/<(?:script|html|svg|iframe|body|!doctype)\b|javascript:/i.test(buf.toString('latin1'))) throw err(400, 'This file is not a plain photo.');
  return { mediaType: type, data: buf.toString('base64') };
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
  invalidateDirectory();
  return p;
}

// All listings, cached briefly per server instance (reads are the expensive part of Blob).
// Concurrent callers share one in-flight load (a burst of /nearby requests on a cold instance
// must not each read every listing); any write bumps the generation so nobody gets stale data.
let directoryCache = null;
let directoryGen = 0;
let directoryLoad = null; // { gen, promise }
function invalidateDirectory() {
  directoryCache = null;
  directoryGen++;
}
async function allPharmacies() {
  if (directoryCache && directoryCache.gen === directoryGen && Date.now() - directoryCache.t < 60 * 1000) return directoryCache.list;
  if (directoryLoad && directoryLoad.gen === directoryGen) return directoryLoad.promise;
  const gen = directoryGen;
  const promise = loadDirectory().then(
    (list) => {
      if (gen === directoryGen) directoryCache = { t: Date.now(), list, gen };
      if (directoryLoad && directoryLoad.promise === promise) directoryLoad = null;
      return list;
    },
    (e) => {
      if (directoryLoad && directoryLoad.promise === promise) directoryLoad = null;
      throw e;
    }
  );
  directoryLoad = { gen, promise };
  return promise;
}
async function loadDirectory() {
  const keys = await store.list('pharmacies/');
  const list = (await Promise.all(keys.slice(0, 3000).map((k) => store.get(k.key)))).filter(Boolean);
  const owners = new Map();
  await Promise.all([...new Set(list.map((p) => p.ownerId))].map(async (id) => owners.set(id, await getUser(id))));
  list.forEach((p) => {
    const o = owners.get(p.ownerId);
    p._plan = activePlan(o);
    p._ownerOk = !!o && !o.disabled;
  });
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
    offer: paid && p.offer && p.offer.percent ? { percent: p.offer.percent, note: p.offer.note || '' } : null,
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
const EVENT_TYPES = ['view', 'wa', 'call', 'dir', 'reserve', 'delivery', 'widget', 'saved', 'savedCount'];
async function bump(key, day, field, by) {
  const doc = (await store.get(key)) || {};
  const d = (doc[day] = doc[day] || {});
  d[field] = (d[field] || 0) + (by == null ? 1 : by);
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

/**
 * Company / insurer claims: what staff paid vs the cheapest same-formula price.
 * rows: [{ medicine (name or id), qty (units), paid (Rs, optional) }]
 */
function claimsReport(rows) {
  const e = dataset.get().engine;
  const out = [];
  const unmatched = [];
  let paid = 0;
  let mrp = 0;
  let best = 0;
  const memo = new Map();
  for (const r of (Array.isArray(rows) ? rows : []).slice(0, 5000)) {
    const name = clean(r && (r.medicine || r.id || r.name), 120);
    if (!name) continue;
    const m = (MED_ID.test(name) && e.byId(name)) || resolveMedicine(name, memo);
    const qty = num(r.qty, 0.01, 10000000) || 1;
    if (!m) {
      unmatched.push(name);
      continue;
    }
    const o = optimise([{ id: m.id, qty }]).rows[0];
    const pv = num(r.paid, 0, 1000000000);
    const paidAmt = pv == null ? o.cost_now : Math.round(pv);
    paid += paidAmt;
    mrp += o.cost_now;
    best += o.cost_best;
    out.push({ input: name, medicine: o.medicine.product, qty, paid: paidAmt, mrp: o.cost_now, cheapest: o.cheapest.product, cheapest_cost: o.cost_best, possible_saving: Math.max(0, paidAmt - o.cost_best) });
  }
  out.sort((x, y) => y.possible_saving - x.possible_saving);
  return { rows: out.slice(0, 2000), unmatched: unmatched.slice(0, 200), total_paid: paid, total_mrp: mrp, total_cheapest: best, possible_saving: Math.max(0, paid - best), percent: paid > 0 ? Math.round(((paid - best) / paid) * 100) : 0 };
}

// ---------------------------------------------------------------------------
// Google sign-in (ID token from Google Identity Services, checked with Google)
// ---------------------------------------------------------------------------
function googleClientId() {
  return process.env.GOOGLE_CLIENT_ID || '';
}
let googleVerifier = null; // tests inject a fake
async function verifyGoogleToken(credential) {
  if (!credential || credential.length > 4096) return null;
  let info;
  try {
    if (googleVerifier) info = await googleVerifier(credential);
    else {
      const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
      if (!r.ok) return null;
      info = await r.json();
    }
  } catch (e) {
    return null;
  }
  const iss = info && info.iss;
  const verified = info && (info.email_verified === true || info.email_verified === 'true');
  if (!info || info.aud !== googleClientId() || !['accounts.google.com', 'https://accounts.google.com'].includes(iss)) return null;
  if (!verified || !validEmail(String(info.email || '')) || Number(info.exp) * 1000 < Date.now()) return null;
  return { sub: String(info.sub), email: String(info.email).toLowerCase(), name: info.name || '' };
}

// ---------------------------------------------------------------------------
// JazzCash hosted checkout (page redirection). Needs a JazzCash merchant account:
//   JAZZCASH_MERCHANT_ID, JAZZCASH_PASSWORD, JAZZCASH_INTEGRITY_SALT, and JAZZCASH_SANDBOX=1 while testing.
// The secure hash is HMAC-SHA256(salt, salt & all non-empty pp_ values sorted by field name).
// ---------------------------------------------------------------------------
const jazzcash = {
  configured() {
    return !!(process.env.JAZZCASH_MERCHANT_ID && process.env.JAZZCASH_PASSWORD && process.env.JAZZCASH_INTEGRITY_SALT);
  },
  url() {
    return process.env.JAZZCASH_SANDBOX === '1'
      ? 'https://sandbox.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform/'
      : 'https://payments.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform/';
  },
  hash(fields) {
    const salt = process.env.JAZZCASH_INTEGRITY_SALT || '';
    const parts = Object.keys(fields)
      .filter((k) => k.startsWith('pp_') && k !== 'pp_SecureHash' && fields[k] !== '' && fields[k] != null)
      .sort()
      .map((k) => String(fields[k]));
    return crypto.createHmac('sha256', salt).update([salt, ...parts].join('&')).digest('hex').toUpperCase();
  },
  stamp(d) {
    // yyyyMMddHHmmss in Pakistan time (UTC+5)
    return new Date(d.getTime() + 5 * 3600 * 1000).toISOString().replace(/[-:T]/g, '').slice(0, 14);
  },
  checkoutForm({ ref, amount, description, billRef, returnUrl }) {
    const now = new Date();
    const fields = {
      pp_Version: '1.1',
      pp_TxnType: '',
      pp_Language: 'EN',
      pp_MerchantID: process.env.JAZZCASH_MERCHANT_ID,
      pp_SubMerchantID: '',
      pp_Password: process.env.JAZZCASH_PASSWORD,
      pp_BankID: '',
      pp_ProductID: '',
      pp_TxnRefNo: ref,
      pp_Amount: String(Math.round(amount * 100)), // paisa
      pp_TxnCurrency: 'PKR',
      pp_TxnDateTime: this.stamp(now),
      pp_BillReference: String(billRef).replace(/[^A-Za-z0-9]/g, '').slice(0, 20),
      pp_Description: String(description).replace(/[^A-Za-z0-9 .,x/-]/g, '').slice(0, 100),
      pp_TxnExpiryDateTime: this.stamp(new Date(now.getTime() + DAY)),
      pp_ReturnURL: returnUrl,
      ppmpf_1: '',
    };
    fields.pp_SecureHash = this.hash(fields);
    return { action: this.url(), method: 'POST', fields };
  },
  verify(fields) {
    if (!this.configured() || !fields || typeof fields.pp_SecureHash !== 'string') return false;
    const expected = this.hash(fields);
    const got = fields.pp_SecureHash.toUpperCase();
    return got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
  },
};

function siteOrigin(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'sasta-dawa-finder.vercel.app').split(',')[0].trim();
  const proto = String(req.headers['x-forwarded-proto'] || (process.env.VERCEL ? 'https' : 'http')).split(',')[0].trim();
  return `${proto}://${host}`;
}

/** application/x-www-form-urlencoded (or JSON) body as a plain object. */
function formBody(req) {
  let pre;
  try {
    pre = req.body;
  } catch (e) {
    pre = undefined;
  }
  if (pre && typeof pre === 'object' && !Buffer.isBuffer(pre)) return Promise.resolve(pre);
  const parse = (text) => {
    const t = String(text || '');
    if (t.trim().startsWith('{')) return JSON.parse(t);
    return Object.fromEntries(new URLSearchParams(t));
  };
  if (pre != null) return Promise.resolve(parse(Buffer.isBuffer(pre) ? pre.toString('utf8') : pre));
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 64 * 1024) {
        reject(new Error('too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// "Download my data"
// ---------------------------------------------------------------------------
const PRIVATE_USER_FIELDS = ['passHash', 'passSalt', 'tokenVersion'];
function exportableUser(u) {
  const out = {};
  for (const [k, v] of Object.entries(u)) {
    if (PRIVATE_USER_FIELDS.includes(k) || /2fa|totp|secret|recovery/i.test(k)) continue;
    out[k] = v;
  }
  if (Array.isArray(out.apiKeys)) out.apiKeys = out.apiKeys.map((k) => ({ id: k.id, prefix: k.prefix, createdAt: k.createdAt }));
  return out;
}

async function exportUserData(u) {
  invalidateDirectory();
  const mine = (await allPharmacies()).filter((p) => p.ownerId === u.id);
  const pharmacies = [];
  const reservations = {};
  const refills = {};
  const stats = {};
  for (const p of mine) {
    const { _plan, _ownerOk, ...rest } = p;
    pharmacies.push(rest);
    const keys = (await store.list(`reservations/${p.id}/`)).sort((x, y) => (x.key < y.key ? 1 : -1)).slice(0, 5000);
    reservations[p.id] = (await Promise.all(keys.map((k) => store.get(k.key)))).filter(Boolean);
    refills[p.id] = ((await store.get(`refills/${p.id}.json`)) || { customers: [] }).customers;
    stats[p.id] = (await statsFor(p.id, 365)).days.filter((d) => Object.keys(d).length > 1);
  }
  if (u.role === 'clinic') stats.widget = (await statsFor('w_' + u.id.slice(2), 365)).days.filter((d) => Object.keys(d).length > 1);
  const payKeys = (await store.list('payments/')).slice(-5000);
  const payments = (await Promise.all(payKeys.map((k) => store.get(k.key)))).filter((p) => p && p.uid === u.id);
  let company = null;
  if (u.companyCode) {
    const c = await store.get(`companies/${u.companyCode}.json`);
    if (c && c.ownerId === u.id) company = { code: c.code, name: c.name, members: (c.members || []).length, at: c.at };
  }
  let usage = null;
  if (u.role === 'developer') {
    usage = {};
    for (let i = 0; i < 12; i++) {
      const m = month(Date.now() - i * 31 * DAY);
      const doc = await store.get(`usage/${u.id}/${m}.json`);
      if (doc) usage[m] = doc;
    }
  }
  return {
    exportedAt: new Date().toISOString(),
    site: 'Sasta Dawa Finder',
    note: 'Everything Sasta Dawa stores about your account. Your password is stored only as a one-way hash and is not included.',
    user: exportableUser(u),
    pharmacies,
    reservations,
    refills,
    payments,
    stats,
    company,
    usage,
  };
}

/** Find a medicine by id or by name (best search match). `memo` (a Map) skips repeated names in one import. */
function resolveMedicine(input, memo) {
  const e = dataset.get().engine;
  const s = clean(input, 140);
  if (!s) return null;
  if (MED_ID.test(s) && e.byId(s)) return e.byId(s);
  const k = s.toLowerCase();
  if (memo && memo.has(k)) return memo.get(k);
  const hit = e.search(s, { limit: 1 })[0];
  const m = hit ? hit.med : null;
  if (memo) memo.set(k, m);
  return m;
}
// A name search costs ~10 ms of CPU; one upload may ask for at most this many (one per row for
// stock / list / claims files, but a refill row can name up to 20 medicines).
const MAX_NAME_LOOKUPS = 5000;
function csvNumber(v, min, max, what) {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(/,/g, ''));
  if (!isFinite(n) || n < min || n > max) throw new Error(`${what} must be a number between ${min} and ${max}.`);
  return n;
}
function csvBool(v, what) {
  const s = String(v || '').trim().toLowerCase();
  if (['', 'no', 'n', 'false', '0'].includes(s)) return false;
  if (['yes', 'y', 'true', '1'].includes(s)) return true;
  throw new Error(`${what} must be yes or no.`);
}
function csvDate(v, what) {
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v + 'T00:00:00Z')) || new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) !== v) throw new Error(`${what} must be a date like 2026-11-27.`);
  if (Date.parse(v + 'T00:00:00Z') > Date.now() + DAY) throw new Error(`${what} cannot be in the future.`);
  return new Date(v + 'T00:00:00Z').toISOString();
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
  const appCodeLimited = limiter(30, 15 * 60 * 1000);
  const importLimited = limiter(60, 60 * 60 * 1000);
  // Heavy reads (every payment record, every listing): per account and per address.
  const exportLimited = limiter(10, 60 * 60 * 1000);
  const exportIpLimited = limiter(30, 60 * 60 * 1000);
  const paymentsListLimited = limiter(60, 10 * 60 * 1000);
  const paymentsListIpLimited = limiter(200, 10 * 60 * 1000);

  async function body(req, limit) {
    const b = await readJson(req, limit || 16 * 1024);
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw err(400, 'Bad request');
    return b;
  }

  // CSV import routes: send the row errors / expected header along with the message.
  async function csvRoute(res, fn) {
    try {
      return await fn();
    } catch (e) {
      if (!e || !e.status || e.status >= 500) throw e;
      const out = { error: e.message, imported: 0 };
      if (e.errors) out.errors = e.errors;
      if (e.expected) {
        out.expected = e.expected;
        out.got = e.got;
      }
      return json(res, e.status, out);
    }
  }
  const CSV_BODY = 3 * 1024 * 1024; // 2 MB of CSV plus JSON escaping

  // ---------------------------------------------------------------- account
  async function account(req, res) {
    const a = query(req).get('a') || '';
    const ip = clientIp(req);
    const POST = req.method === 'POST';

    if (a === 'plans') {
      return json(res, 200, { plans: PLANS, trialDays: TRIAL_DAYS, payTo: await payTo(), googleClientId: googleClientId() || null, online: { jazzcash: jazzcash.configured() } });
    }

    // Sign in with Google: the browser sends the ID token from Google Identity Services.
    if (a === 'google') {
      if (!POST) return json(res, 405, { error: 'POST only' });
      if (!googleClientId()) return json(res, 503, { error: 'Google sign-in is not set up yet.' });
      if (loginLimited(ip)) return json(res, 429, { error: 'Too many attempts. Wait 15 minutes.' });
      const b = await body(req, 8 * 1024);
      const g = await verifyGoogleToken(String(b.credential || ''));
      if (!g) return json(res, 401, { error: 'Google sign-in failed. Please try again.' });
      let u = await userByEmail(g.email);
      let created = false;
      let passwordRemoved = false;
      if (u) {
        if (u.disabled) return json(res, 403, { error: 'This account is disabled. Please contact us.' });
        if (!u.googleSub) {
          // First Google sign-in for an existing email account: link it. Email sign-up never proves
          // the address, so whoever set that password may not own the inbox (an attacker can sign up
          // with someone else's email first and wait). Google just proved ownership: drop the
          // unproven password and sign out every other session. The owner can set a new password.
          u.googleSub = g.sub;
          if (u.passHash) {
            delete u.passHash;
            delete u.passSalt;
            passwordRemoved = true;
          }
          u.tokenVersion = (u.tokenVersion || 0) + 1;
          await saveUser(u);
        } else if (u.googleSub !== g.sub) return json(res, 401, { error: 'Google sign-in failed. Please try again.' });
      } else {
        if (b.acceptTerms !== true) return json(res, 400, { needTerms: true, error: 'Please agree to the Terms of Service and Privacy Policy to create your account.' });
        if (signupLimited(ip)) return json(res, 429, { error: 'Too many sign-ups from this network. Try again later.' });
        const role = ROLES.includes(b.role) ? b.role : 'patient';
        const now = new Date();
        u = {
          id: 'u_' + rid(6),
          email: g.email,
          name: clean(g.name, 80) || g.email.split('@')[0],
          phone: '',
          role,
          googleSub: g.sub,
          tokenVersion: 0,
          plan: PAID_FOR_ROLE[role] || 'free',
          planUntil: PAID_FOR_ROLE[role] ? new Date(now.getTime() + TRIAL_DAYS * DAY).toISOString() : null,
          trial: !!PAID_FOR_ROLE[role],
          createdAt: now.toISOString(),
          cabinet: [],
          termsAcceptedAt: now.toISOString(),
          termsVersion: TERMS_VERSION,
        };
        await saveUser(u);
        await store.put(`emails/${sha(g.email)}.json`, { uid: u.id });
        created = true;
      }
      await recordLogin(u, 'google', req);
      return json(res, 200, { ok: true, created, ...(passwordRemoved ? { passwordRemoved } : {}), token: await createToken(u), user: publicUser(u) });
    }

    // Login handoff, step 2 (the app): swap the one-time code from the browser for a token.
    if (a === 'app-exchange') {
      if (!POST) return json(res, 405, { error: 'POST only' });
      if (loginLimited(ip)) return json(res, 429, { error: 'Too many attempts. Wait 15 minutes.' });
      const b = await body(req, 2048);
      const code = String(b.code || '').trim().toLowerCase();
      const bad = () => json(res, 401, { error: 'This sign-in link has expired. Please sign in again.' });
      if (!/^[a-f0-9]{32}$/.test(code)) return bad();
      const key = `appcodes/${sha(code)}.json`;
      const rec = await store.get(key);
      if (!rec) return bad();
      await store.del(key); // single use, even when it turns out to be expired
      if (!rec.exp || rec.exp < Date.now()) return bad();
      const owner = await getUser(rec.uid);
      if (!owner || owner.disabled || (owner.tokenVersion || 0) !== (rec.tv || 0)) return bad();
      await recordLogin(owner, rec.via === 'google' ? 'google' : 'password', req, { app: rec.app });
      return json(res, 200, { ok: true, token: await createToken(owner), user: publicUser(owner) });
    }

    // Exact CSV formats for the account imports (header + 2 example rows). No sign-in needed.
    if (a === 'csv-template') {
      const type = query(req).get('type') || '';
      if (!['stock', 'refills', 'list', 'claims'].includes(type)) return json(res, 400, { error: 'type must be stock, refills, list or claims' });
      return csvLib.send(res, `sasta-dawa-${type}-template.csv`, csvLib.template(type));
    }

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
      if (b.acceptTerms !== true) return json(res, 400, { needTerms: true, error: 'Please agree to the Terms of Service and Privacy Policy to create your account.' });
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
        termsAcceptedAt: now.toISOString(),
        termsVersion: TERMS_VERSION,
        lastLogin: { method: 'password', at: now.toISOString(), ua: deviceLabel(req.headers['user-agent']) },
        prevLogin: null,
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
      await recordLogin(u, 'password', req);
      return json(res, 200, { ok: true, token: await createToken(u), user: publicUser(u) });
    }

    // Everything below needs a signed-in user.
    const u = await authUser(req);
    if (!u) return json(res, 401, { error: 'Please sign in.' });
    if (a === 'me') return json(res, 200, { user: publicUser(u) });
    if (!POST && !['my-pharmacies', 'stats', 'alerts', 'reservations', 'payments', 'company', 'usage', 'competitors', 'report', 'refills', 'partners', 'export', 'export-csv'].includes(a)) {
      return json(res, 405, { error: 'POST only' });
    }

    // Login handoff, step 1 (the browser, after signing in): a one-time code for the app's deep link.
    if (a === 'app-code') {
      if (appCodeLimited(ip)) return json(res, 429, { error: 'Too many requests. Try again later.' });
      const b = await body(req, 1024);
      const app = b.app === 'business' ? 'business' : 'customer';
      const last = u.lastLogin && u.lastLogin.method;
      const via = b.via === 'google' || b.via === 'password' ? b.via : last === 'google' ? 'google' : 'password';
      const code = crypto.randomBytes(16).toString('hex');
      await store.put(`appcodes/${sha(code)}.json`, { uid: u.id, exp: Date.now() + APP_CODE_MS, app, via, tv: u.tokenVersion || 0, at: new Date().toISOString() });
      return json(res, 200, { code, expiresIn: APP_CODE_MS / 1000, redirect: `${app === 'business' ? 'sastadawabiz' : 'sastadawa'}://auth?code=${code}` });
    }

    // Everything the site stores about this account, as a JSON download.
    if (a === 'export') {
      if (exportLimited(u.id) || exportIpLimited(ip)) return json(res, 429, { error: 'Too many downloads. Try again in an hour.' });
      const data = await exportUserData(u);
      const out = JSON.stringify(data, null, 2);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="sasta-dawa-my-data-${today()}.json"`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
        'Content-Length': Buffer.byteLength(out),
      });
      return res.end(out);
    }

    // -- profile
    if (a === 'update-profile') {
      const b = await body(req);
      if (b.name !== undefined) u.name = clean(b.name, 80) || u.name;
      if (b.phone !== undefined) u.phone = phone(b.phone);
      await saveUser(u);
      return json(res, 200, { user: publicUser(u) });
    }
    // A Personal account signed in to the pharmacies app can become a business account (once).
    if (a === 'become-business') {
      const b = await body(req);
      if (u.role !== 'patient') return json(res, 400, { error: 'This is already a business account.' });
      const role = String(b.role || '');
      if (role === 'patient' || !ROLES.includes(role)) return json(res, 400, { error: 'Choose a business type.' });
      const now = Date.now();
      u.role = role;
      if (PAID_FOR_ROLE[role] && !u.trialUsed && activePlan(u) === 'free') {
        u.plan = PAID_FOR_ROLE[role];
        u.planUntil = new Date(now + TRIAL_DAYS * DAY).toISOString();
        u.trial = true;
        u.trialUsed = true;
      }
      u.convertedAt = new Date(now).toISOString();
      await saveUser(u);
      return json(res, 200, { user: publicUser(u) });
    }
    if (a === 'change-password') {
      const b = await body(req);
      if (u.passHash && !passwordMatches(String(b.current || ''), u)) return json(res, 400, { error: 'Current password is wrong.' });
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
      const confirmed = u.passHash ? passwordMatches(String(b.password || ''), u) : String(b.confirm || '').toUpperCase() === 'DELETE';
      if (!confirmed) return json(res, 400, { error: u.passHash ? 'Password is wrong.' : 'Type DELETE to confirm.' });
      // Remove everything of this account from the live store (backups age out within 14 days).
      invalidateDirectory();
      const delPrefix = async (prefix) => {
        for (const k of await store.listDeep(prefix)) await store.del(k.key);
      };
      for (const p of (await allPharmacies()).filter((x) => x.ownerId === u.id)) {
        await store.del(`pharmacies/${p.id}.json`);
        await store.del(`refills/${p.id}.json`);
        await delPrefix(`reservations/${p.id}/`);
        await delPrefix(`stats/${p.id}/`);
      }
      await delPrefix(`stats/w_${u.id.slice(2)}/`);
      await delPrefix(`usage/${u.id}/`);
      for (const k of u.apiKeys || []) await store.del(`apikeys/${k.hash}.json`);
      if (u.joinedCompany && /^[A-Z0-9]{4,12}$/.test(u.joinedCompany.code || '')) {
        const c = await store.get(`companies/${u.joinedCompany.code}.json`);
        if (c && Array.isArray(c.members) && c.members.includes(u.id)) {
          c.members = c.members.filter((m) => m !== u.id);
          await store.put(`companies/${c.code}.json`, c);
        }
      }
      if (u.companyCode) {
        const c = await store.get(`companies/${u.companyCode}.json`);
        if (c && c.ownerId === u.id) await store.del(`companies/${u.companyCode}.json`);
      }
      // Payment records stay for the accounts, without the person's name, email or phone.
      for (const k of await store.list('payments/')) {
        const p = await store.get(k.key);
        if (p && p.uid === u.id) {
          Object.assign(p, { uid: 'deleted', email: '', name: '', payerPhone: '', deletedAccount: true });
          await store.put(k.key, p);
        }
      }
      await store.del(`emails/${sha(u.email)}.json`);
      await store.del(`users/${u.id}.json`);
      invalidateDirectory();
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
    if (a === 'pay-online') {
      if (!jazzcash.configured()) return json(res, 503, { error: 'Online payment is not switched on yet. Please pay by JazzCash/Easypaisa transfer and enter the transaction ID.' });
      if (paymentLimited(ip)) return json(res, 429, { error: 'Too many requests. Try again later.' });
      const b = await body(req);
      const plan = PLANS[b.plan] && b.plan !== 'free' && PLANS[b.plan].roles.includes(u.role) ? b.plan : null;
      if (!plan) return json(res, 400, { error: 'This plan is not available for your account type.' });
      const periods = num(b.periods, 1, 12) || 1;
      const ref = 'T' + Date.now() + rid(2).toUpperCase(); // JazzCash allows up to 20 characters
      const pay = { key: `payments/${Date.now()}-${rid(4)}.json`, uid: u.id, email: u.email, name: u.name, plan, periods, amount: PLANS[plan].price * periods, method: 'jazzcash_online', txnId: ref, status: 'pending', online: true, at: new Date().toISOString() };
      await store.put(pay.key, pay);
      await store.put(`paytxn/${ref}.json`, { key: pay.key });
      const origin = siteOrigin(req);
      return json(res, 200, { ok: true, payment: pay, form: jazzcash.checkoutForm({ ref, amount: pay.amount, description: `${PLANS[plan].name} x${periods}`, billRef: u.id, returnUrl: `${origin}/api/places?a=jazzcash-return` }) });
    }
    if (a === 'payments') {
      if (paymentsListLimited(u.id) || paymentsListIpLimited(ip)) return json(res, 429, { error: 'Too many requests. Try again in a few minutes.' });
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
        const identity = (x) => [x.name, x.address, x.city, x.phone, x.whatsapp].map((v) => String(v || '')).join('\u0001');
        const before = existing ? identity(existing) : null;
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
        // The admin verified this name, address and numbers: changing any of them needs a new check
        // (otherwise a listing could be verified with real details, then switched to another shop's name or a scam number).
        if (existing && p.verified && identity(p) !== before) {
          p.verified = false;
          p.unverifiedAt = new Date().toISOString();
        }
        await savePharmacy(p);
        return json(res, 200, { pharmacy: p });
      }
      if (a === 'delete-pharmacy') {
        const b = await body(req);
        const p = await own(b.id);
        await store.del(`pharmacies/${p.id}.json`);
        // Its customers' names, phones and addresses go with it (delete-account only finds live listings).
        await store.del(`refills/${p.id}.json`);
        for (const prefix of [`reservations/${p.id}/`, `stats/${p.id}/`]) for (const k of await store.listDeep(prefix)) await store.del(k.key);
        invalidateDirectory();
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

      // CSV stock upload: medicine,status,price
      if (a === 'import-stock') {
        return csvRoute(res, async () => {
          needPaid();
          if (importLimited(ip)) return json(res, 429, { error: 'Too many uploads. Try again later.' });
          const b = await body(req, CSV_BODY);
          const p = await own(b.pid || b.id);
          const parsed = csvLib.parseTemplate(b.csv, 'stock');
          const r = csvLib.runImport(
            parsed,
            (d) => {
              if (!d.medicine) throw new Error('medicine is empty.');
              const m = resolveMedicine(d.medicine);
              if (!m) throw new Error(`Medicine not found: ${d.medicine.slice(0, 60)}`);
              const s = d.status.toLowerCase();
              if (s !== 'in' && s !== 'out') throw new Error('status must be in or out.');
              return { id: m.id, product: m.product, s, price: csvNumber(d.price, 0.01, 10000000, 'price') };
            },
            !!b.partial
          );
          if (!isPremium(u) && r.good.length > 50) return json(res, 402, { error: 'Uploading more than 50 medicines at once (bulk upload) needs Pharmacy Premium.', imported: 0 });
          p.stock = p.stock || {};
          const at = new Date().toISOString();
          for (const g of r.good) p.stock[g.value.id] = { s: g.value.s, price: g.value.price || undefined, at };
          if (Object.keys(p.stock).length > 20000) return json(res, 400, { error: 'Too many medicines on one listing.', imported: 0 });
          await savePharmacy(p);
          return json(res, 200, { ok: true, imported: r.good.length, errors: r.errors, rows: r.good.slice(0, 5000).map((g) => ({ row: g.row, id: g.value.id, product: g.value.product, status: g.value.s, price: g.value.price })), stock: p.stock });
        });
      }

      // CSV refill customers: name,phone,medicines,every_days,last_refill_date
      if (a === 'import-refills') {
        return csvRoute(res, async () => {
          needPaid();
          if (importLimited(ip)) return json(res, 429, { error: 'Too many uploads. Try again later.' });
          const b = await body(req, CSV_BODY);
          const p = await own(b.pid || b.id);
          const parsed = csvLib.parseTemplate(b.csv, 'refills');
          const names = parsed.records.reduce((n, rec) => n + Math.min(21, String(rec.data.medicines || '').split(';').filter((x) => x.trim()).length), 0);
          if (names > MAX_NAME_LOOKUPS) return json(res, 413, { error: `Too many medicine names in one file (limit ${MAX_NAME_LOOKUPS}). Split it into smaller files.`, imported: 0 });
          const memo = new Map();
          const r = csvLib.runImport(
            parsed,
            (d) => {
              const name = clean(d.name, 80);
              if (!name) throw new Error('name is empty.');
              const ph = phone(d.phone);
              if (!ph) throw new Error('phone is missing or not a valid number.');
              const names = d.medicines.split(';').map((x) => x.trim()).filter(Boolean);
              if (!names.length) throw new Error('medicines is empty (separate several with ;).');
              if (names.length > 20) throw new Error('Up to 20 medicines per customer.');
              const meds = names.map((n) => {
                const m = resolveMedicine(n, memo);
                if (!m) throw new Error(`Medicine not found: ${n.slice(0, 60)}`);
                return { id: m.id, name: m.product, qty: '' };
              });
              const every = csvNumber(d.every_days, 1, 365, 'every_days');
              if (every == null || !Number.isInteger(every)) throw new Error('every_days must be a whole number of days (1 to 365).');
              return { name, phone: ph, meds, every, lastAt: csvDate(d.last_refill_date, 'last_refill_date') };
            },
            !!b.partial
          );
          const key = `refills/${p.id}.json`;
          const doc = (await store.get(key)) || { customers: [] };
          const now = new Date().toISOString();
          for (const g of r.good) {
            const v = g.value;
            doc.customers = doc.customers.filter((x) => x.phone !== v.phone);
            doc.customers.unshift({ id: 'c_' + rid(4), name: v.name, phone: v.phone, meds: v.meds, every: v.every, note: '', at: now, lastAt: v.lastAt || now });
          }
          if (doc.customers.length > (isPremium(u) ? 5000 : 200)) return json(res, 402, { error: 'More than 200 refill customers needs Pharmacy Premium.', imported: 0 });
          await store.put(key, doc);
          return json(res, 200, { ok: true, imported: r.good.length, errors: r.errors, total: doc.customers.length });
        });
      }

      // CSV downloads in the same format as the imports (safe against spreadsheet formulas).
      if (a === 'export-csv') {
        const q = query(req);
        const type = q.get('type');
        const p = await own(q.get('id'));
        if (type === 'stock') {
          const rows = Object.entries(p.stock || {}).map(([id, st]) => [id, st.s === 'out' ? 'out' : 'in', st.price || '']);
          return csvLib.send(res, `stock-${p.id}.csv`, csvLib.toCsv(csvLib.TEMPLATES.stock.header, rows));
        }
        if (type === 'refills') {
          needPaid();
          const doc = (await store.get(`refills/${p.id}.json`)) || { customers: [] };
          const rows = doc.customers.map((c) => [c.name, c.phone, (c.meds || []).map((m) => m.id).join(';'), c.every || 30, String(c.lastAt || c.at || '').slice(0, 10)]);
          return csvLib.send(res, `refills-${p.id}.csv`, csvLib.toCsv(csvLib.TEMPLATES.refills.header, rows));
        }
        return json(res, 400, { error: 'type must be stock or refills' });
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
        r.status = ['new', 'ready', 'collected', 'out_for_delivery', 'delivered', 'cancelled'].includes(b.status) ? b.status : r.status;
        await store.put(key, r);
        return json(res, 200, { ok: true });
      }

      // Refill lists: the pharmacy's regular customers and when each one's medicine runs out.
      if (a === 'refills') {
        needPaid();
        const p = await own(query(req).get('id'));
        const doc = (await store.get(`refills/${p.id}.json`)) || { customers: [] };
        const now = Date.now();
        const customers = doc.customers.map((c) => {
          const next = Date.parse(c.lastAt || c.at) + (c.every || 30) * DAY;
          return { ...c, nextDue: new Date(next).toISOString(), due: next - now <= 3 * DAY, overdue: next < now };
        });
        customers.sort((x, y) => Date.parse(x.nextDue) - Date.parse(y.nextDue));
        return json(res, 200, { customers });
      }
      if (a === 'save-refill' || a === 'mark-refilled') {
        needPaid();
        const b = await body(req, 16 * 1024);
        const p = await own(b.pid);
        const key = `refills/${p.id}.json`;
        const doc = (await store.get(key)) || { customers: [] };
        if (a === 'mark-refilled') {
          const c = doc.customers.find((x) => x.id === b.id);
          if (!c) return json(res, 404, { error: 'Customer not found' });
          c.lastAt = new Date().toISOString();
        } else {
          doc.customers = doc.customers.filter((x) => x.id !== b.id);
          if (!b.remove) {
            const e = dataset.get().engine;
            const meds = (Array.isArray(b.meds) ? b.meds : []).filter((x) => x && MED_ID.test(x.id || '') && e.byId(x.id)).slice(0, 20).map((x) => ({ id: x.id, name: e.byId(x.id).product, qty: clean(x.qty, 30) }));
            const c = { id: /^c_[a-f0-9]{8}$/.test(b.id || '') ? b.id : 'c_' + rid(4), name: clean(b.name, 80), phone: phone(b.phone), meds, every: num(b.every, 1, 365) || 30, note: clean(b.note, 200), at: new Date().toISOString(), lastAt: clean(b.lastAt, 30) || new Date().toISOString() };
            if (!c.name || !c.phone) return json(res, 400, { error: 'Customer name and phone are required.' });
            doc.customers.unshift(c);
          }
          if (doc.customers.length > (isPremium(u) ? 5000 : 200)) return json(res, 402, { error: 'More than 200 refill customers needs Pharmacy Premium.' });
        }
        await store.put(key, doc);
        return json(res, 200, { ok: true });
      }

      // Discount for company staff (shown on the pharmacy card and to companies).
      if (a === 'save-offer') {
        needPaid();
        const b = await body(req);
        const p = await own(b.id);
        const pct = num(b.percent, 0, 50);
        p.offer = pct ? { percent: Math.round(pct), note: clean(b.note, 120), at: new Date().toISOString() } : null;
        await savePharmacy(p);
        return json(res, 200, { ok: true, offer: p.offer });
      }
    }

    // ---------------------------------------------------------------- clinic
    if (u.role === 'clinic' && a === 'save-clinic') {
      const b = await body(req);
      u.clinic = { name: clean(b.name, 80) || u.name, color: /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : '#0f5c54', note: clean(b.note, 200), phone: phone(b.phone), city: clean(b.city, 40), partners: b.partners !== false };
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
      // CSV medicine list: medicine,quantity. Returns the cheapest options; save:true also saves it as a list.
      if (a === 'import-list') {
        return csvRoute(res, async () => {
          if (importLimited(ip)) return json(res, 429, { error: 'Too many uploads. Try again later.' });
          const b = await body(req, CSV_BODY);
          const parsed = csvLib.parseTemplate(b.csv, 'list');
          const r = csvLib.runImport(
            parsed,
            (d) => {
              if (!d.medicine) throw new Error('medicine is empty.');
              const m = resolveMedicine(d.medicine);
              if (!m) throw new Error(`Medicine not found: ${d.medicine.slice(0, 60)}`);
              const qty = csvNumber(d.quantity, 1, 1000000, 'quantity');
              if (qty == null) throw new Error('quantity is empty.');
              return { id: m.id, product: m.product, qty: Math.round(qty) };
            },
            !!b.partial
          );
          const merged = new Map();
          for (const g of r.good) {
            const x = merged.get(g.value.id);
            if (x) x.qty += g.value.qty;
            else merged.set(g.value.id, { ...g.value });
          }
          const items = [...merged.values()];
          if (items.length > 300) return json(res, 400, { error: 'Up to 300 different medicines per list.', imported: 0 });
          const out = { ok: true, imported: r.good.length, errors: r.errors, items, ...optimise(items) };
          if (b.save) {
            if (!isPaid(u)) return json(res, 402, { error: 'Saving lists needs the NGO plan.', imported: 0 });
            const list = { id: 'l_' + rid(4), name: clean(b.name, 80) || 'Imported list', items: items.map((x) => ({ id: x.id, qty: x.qty })), at: new Date().toISOString() };
            u.lists = [list, ...(u.lists || [])].slice(0, 50);
            await saveUser(u);
            out.list = list;
            out.user = publicUser(u);
          }
          return json(res, 200, out);
        });
      }
      if (a === 'save-list') {
        if (!isPaid(u)) return json(res, 402, { error: 'Saving lists needs the NGO plan.' });
        const b = await body(req, 64 * 1024);
        const old = (u.lists || []).find((l) => l.id === b.id);
        const lists = (u.lists || []).filter((l) => l.id !== b.id);
        if (!b.remove) {
          const items = (Array.isArray(b.items) ? b.items : []).filter((x) => x && MED_ID.test(x.id || '')).slice(0, 300).map((x) => ({ id: x.id, qty: num(x.qty, 1, 1000000) || 1 }));
          const list = { id: /^l_[a-f0-9]{8}$/.test(b.id || '') ? b.id : 'l_' + rid(4), name: clean(b.name, 80) || 'Medicine list', items, at: new Date().toISOString() };
          if (old && old.quotes) list.quotes = old.quotes; // editing the medicines keeps the supplier quotes
          lists.unshift(list);
        }
        u.lists = lists.slice(0, 50);
        await saveUser(u);
        return json(res, 200, { user: publicUser(u) });
      }
      if (a === 'compare-quotes') {
        const b = await body(req, 128 * 1024);
        const base = optimise(b.items);
        const quotes = (Array.isArray(b.quotes) ? b.quotes : []).slice(0, 10).map((q) => {
          let total = 0;
          let missing = 0;
          const lines = base.rows.map((r) => {
            const price = num(q && q.prices && q.prices[r.medicine.id], 0.01, 100000000);
            if (price == null) {
              missing++;
              return { id: r.medicine.id, price: null, total: null };
            }
            const t = Math.round(price * r.qty);
            total += t;
            return { id: r.medicine.id, price, total: t };
          });
          return { supplier: clean(q && q.supplier, 80) || 'Supplier', total, missing, vs_mrp: base.total_now - total, vs_cheapest_mrp: base.total_best - total, lines };
        });
        const complete = quotes.filter((q) => !q.missing).sort((x, y) => x.total - y.total);
        return json(res, 200, { ...base, quotes, best_supplier: complete[0] ? complete[0].supplier : null });
      }
      if (a === 'save-quote') {
        if (!isPaid(u)) return json(res, 402, { error: 'Saving supplier quotes needs the NGO plan.' });
        const b = await body(req, 64 * 1024);
        const list = (u.lists || []).find((l) => l.id === b.listId);
        if (!list) return json(res, 404, { error: 'List not found' });
        const prices = {};
        for (const [id, v] of Object.entries(b.prices || {}).slice(0, 300)) if (MED_ID.test(id) && num(v, 0.01, 100000000) != null) prices[id] = num(v, 0.01, 100000000);
        const supplier = clean(b.supplier, 80) || 'Supplier';
        list.quotes = (list.quotes || []).filter((q) => q.supplier !== supplier);
        if (!b.remove) list.quotes.push({ supplier, prices, at: new Date().toISOString() });
        list.quotes = list.quotes.slice(-10);
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
      if (a === 'claims-report') {
        if (!isPaid(u)) return json(res, 402, { error: 'Claims analysis needs the Corporate plan.' });
        // Up to 5000 name searches per request (~50 s of CPU): same upload limit as the other imports.
        if (importLimited(ip) || importLimited('u:' + u.id)) return json(res, 429, { error: 'Too many uploads. Try again later.' });
        return csvRoute(res, async () => {
          const b = await body(req, CSV_BODY);
          if (typeof b.csv !== 'string') return json(res, 200, claimsReport(b.rows));
          // CSV upload: medicine,quantity,amount_paid (medicines that can't be matched are listed in "unmatched")
          const parsed = csvLib.parseTemplate(b.csv, 'claims');
          const r = csvLib.runImport(
            parsed,
            (d) => {
              if (!d.medicine) throw new Error('medicine is empty.');
              const qty = csvNumber(d.quantity, 0.01, 10000000, 'quantity');
              if (qty == null) throw new Error('quantity is empty.');
              const paid = csvNumber(d.amount_paid, 0, 1000000000, 'amount_paid');
              return { medicine: d.medicine, qty, paid: paid == null ? undefined : paid };
            },
            !!b.partial
          );
          return json(res, 200, { ...claimsReport(r.good.map((g) => g.value)), imported: r.good.length, errors: r.errors });
        });
      }
      if (a === 'partners') {
        const list = (await allPharmacies()).filter((p) => p.verified && p._ownerOk && (p._plan === 'pharmacy_pro' || p._plan === 'pharmacy_premium') && p.offer && p.offer.percent);
        const city = clean(query(req).get('city'), 40);
        const out = list.filter((p) => !city || slug(p.city) === slug(city)).map((p) => publicPharmacy(p)).sort((x, y) => y.offer.percent - x.offer.percent);
        return json(res, 200, { partners: out.slice(0, 200) });
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
      if (!type || ['reserve', 'delivery', 'savedCount'].includes(type)) return json(res, 400, { error: 'Bad event' });
      if (type === 'widget' || type === 'saved') {
        if (!UID.test(b.clinic || '')) return json(res, 400, { error: 'Bad clinic' });
        const k = `stats/w_${b.clinic.slice(2)}/${month()}.json`;
        if (type === 'widget') await bump(k, today(), 'widget');
        else {
          // a patient was shown a cheaper same-formula option: count it and the possible saving (Rs, capped)
          await bump(k, today(), 'saved', Math.round(num(b.amount, 0, 100000) || 0));
          await bump(k, today(), 'savedCount', 1);
        }
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
      const r = { pid: p.id, med: m ? m.id : '', medName: m ? m.product : clean(b.medName, 120), qty: clean(b.qty, 30), name: clean(b.name, 80), phone: phone(b.phone), note: clean(b.note, 300), status: 'new', type: 'pickup', at: new Date().toISOString() };
      if (b.delivery) {
        if (!(p.delivery && activePlan(owner) === 'pharmacy_premium')) return json(res, 400, { error: 'This pharmacy does not deliver. You can reserve and pick up instead.' });
        r.type = 'delivery';
        r.address = clean(b.address, 240);
        if (r.address.length < 8) return json(res, 400, { error: 'Please write your full delivery address.' });
      }
      if (!r.name || !r.phone || !r.medName) return json(res, 400, { error: 'Please add your name, phone and the medicine.' });
      await store.put(`reservations/${p.id}/${Date.now()}-${rid(4)}.json`, r);
      await bump(`stats/${p.id}/${month()}.json`, today(), r.type === 'delivery' ? 'delivery' : 'reserve');
      return json(res, 200, { ok: true, pharmacy: { name: p.name, phone: p.phone, whatsapp: p.whatsapp } });
    }

    if (a === 'widget') {
      const c = q.get('c') || '';
      const u = await getUser(c);
      if (!u || u.role !== 'clinic') return json(res, 404, { error: 'Not found' });
      const active = isPaid(u);
      const cl = u.clinic || { name: u.name, color: '#0f5c54' };
      let partners = [];
      if (active && cl.city && cl.partners !== false) {
        partners = (await allPharmacies())
          .filter((p) => p.verified && p._ownerOk && slug(p.city) === slug(cl.city))
          .map((p) => publicPharmacy(p))
          .sort((x, y) => (y.sponsored ? 1 : 0) - (x.sponsored ? 1 : 0))
          .slice(0, 6)
          .map((p) => ({ id: p.id, name: p.name, area: p.area, address: p.address, phone: p.phone, whatsapp: p.whatsapp, verified: p.verified, delivery: p.delivery }));
      }
      return json(res, 200, { active, name: cl.name || u.name, color: cl.color || '#0f5c54', note: cl.note || '', phone: cl.phone || '', city: cl.city || '', partners }, { 'Cache-Control': 'no-cache', 'Vercel-CDN-Cache-Control': 'max-age=60' });
    }

    if (a === 'company') {
      const code = clean(q.get('code'), 20).toUpperCase();
      const c = /^[A-Z0-9]{4,12}$/.test(code) ? await store.get(`companies/${code}.json`) : null;
      return c ? json(res, 200, { name: c.name }) : json(res, 404, { error: 'Not found' });
    }

    // Prescription photo -> medicine names (uses the same Claude key as the assistant).
    if (a === 'jazzcash-return') {
      const origin = siteOrigin(req);
      const done = (status) => {
        res.writeHead(303, { Location: `${origin}/account#/plan?payment=${status}`, 'Cache-Control': 'no-store' });
        res.end();
      };
      if (req.method !== 'POST') return done('unknown');
      let fields;
      try {
        fields = await formBody(req);
      } catch (e) {
        return done('error');
      }
      const ok = jazzcash.verify(fields);
      const ref = clean(fields.pp_TxnRefNo, 30);
      const idx = /^T[0-9A-F]{14,19}$/i.test(ref) ? await store.get(`paytxn/${ref}.json`) : null;
      const pay = idx && (await store.get(idx.key));
      if (!ok || !pay) {
        console.error('JazzCash return rejected', { ok, ref });
        return done('error');
      }
      if (pay.status !== 'pending') return done(pay.status === 'approved' ? 'success' : 'failed');
      const paidAmount = Number(fields.pp_Amount) / 100;
      if (fields.pp_ResponseCode === '000' && paidAmount === pay.amount) {
        pay.status = 'approved';
        pay.decidedAt = new Date().toISOString();
        pay.gatewayRef = clean(fields.pp_RetreivalReferenceNo || fields.pp_TxnRefNo, 60);
        const buyer = await getUser(pay.uid);
        if (buyer) {
          grant(buyer, pay.plan, (PLANS[pay.plan].period === 'year' ? 365 : 30) * (pay.periods || 1));
          await saveUser(buyer);
          invalidateDirectory();
        }
        await store.put(pay.key, pay);
        return done('success');
      }
      pay.status = 'rejected';
      pay.decidedAt = new Date().toISOString();
      pay.gatewayMessage = clean(fields.pp_ResponseMessage, 200);
      await store.put(pay.key, pay);
      return done('failed');
    }

    if (a === 'rx') {
      if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
      const chatLib = require('./chat');
      if (!rxClient && !chatLib.aiEnabled()) return json(res, 503, { error: 'Prescription reading is not available right now.' });
      if (rxLimited(ip)) return json(res, 429, { error: 'Too many photos. Please wait an hour.' });
      const b = await body(req, 4 * 1024 * 1024 + 512 * 1024); // Vercel functions accept bodies up to 4.5 MB
      const img = checkImage(b.image); // throws 400/413
      try {
        const names = await readPrescription(chatLib, img.mediaType, img.data);
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
    if (a === 'analytics') return json(res, 200, await analytics());
    if (a === 'users') {
      const keys = (await store.list('users/')).slice(0, 3000);
      const users = (await Promise.all(keys.map((k) => store.get(k.key)))).filter(Boolean);
      users.sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1));
      return json(res, 200, { users: users.map((u) => ({ id: u.id, email: u.email, name: u.name, phone: u.phone, role: u.role, plan: activePlan(u), planUntil: u.planUntil, trial: !!u.trial, disabled: !!u.disabled, createdAt: u.createdAt, lastLogin: loginView(u.lastLogin) })) });
    }
    if (a === 'pharmacies') {
      invalidateDirectory();
      const list = await allPharmacies();
      return json(res, 200, { pharmacies: list.map((p) => ({ ...publicPharmacy(p), ownerId: p.ownerId, plan: p._plan, featured: !!p.featured, stockCount: Object.keys(p.stock || {}).length, createdAt: p.createdAt })) });
    }
    if (a === 'payments') {
      const keys = (await store.list('payments/')).sort((x, y) => (x.key < y.key ? 1 : -1)).slice(0, 200);
      return json(res, 200, { payments: (await Promise.all(keys.map((k) => store.get(k.key)))).filter(Boolean) });
    }
    if (req.method !== 'POST') return null;

    // CSV price corrections: medicine_id,price,hide,note (merged into the site settings)
    if (a === 'import-overrides') {
      return csvRoute(res, async () => {
        const b = await body(req, CSV_BODY);
        const config = require('./config');
        const cfg = await config.load({ fresh: true });
        const e = dataset.get().engine;
        const parsed = csvLib.parseTemplate(b.csv, 'overrides');
        const r = csvLib.runImport(
          parsed,
          (d) => {
            const id = d.medicine_id;
            if (!MED_ID.test(id) || !(e.byId(id) || cfg.overrides[id])) throw new Error(`Unknown medicine_id: ${String(id).slice(0, 60)}`);
            const price = csvNumber(d.price, 0.01, 9999999, 'price');
            const hide = csvBool(d.hide, 'hide');
            if (price == null && !hide) throw new Error('Give a price, or hide = yes.');
            const m = e.byId(id);
            return { id, price, hide, note: clean(d.note, 200), name: m ? m.product : (cfg.overrides[id] || {}).name || '' };
          },
          !!b.partial
        );
        const overrides = { ...cfg.overrides };
        const at = new Date().toISOString();
        for (const g of r.good) {
          const v = g.value;
          overrides[v.id] = { ...(v.hide ? { hidden: true } : { price: v.price }), note: v.note, name: v.name, at };
        }
        if (Object.keys(overrides).length > 2000) return json(res, 400, { error: 'Up to 2000 price corrections in total.', imported: 0 });
        const saved = await config.save({ ...cfg, overrides });
        dataset.refresh(saved);
        return json(res, 200, { ok: true, imported: r.good.length, errors: r.errors, corrections: Object.keys(saved.overrides).length, config: saved });
      });
    }

    // CSV pharmacies: name,address,area,city,phone,whatsapp,hours,lat,lng,owner_email (created verified)
    if (a === 'import-pharmacies') {
      return csvRoute(res, async () => {
        const b = await body(req, CSV_BODY);
        const parsed = csvLib.parseTemplate(b.csv, 'pharmacies');
        const emails = [...new Set(parsed.records.map((r) => r.data.owner_email.toLowerCase()))].filter(validEmail);
        const owners = new Map();
        await Promise.all(emails.map(async (em) => owners.set(em, await userByEmail(em))));
        const r = csvLib.runImport(
          parsed,
          (d) => {
            const name = clean(d.name, 100);
            const address = clean(d.address, 200);
            const city = clean(d.city, 40);
            if (name.length < 2) throw new Error('name is missing.');
            if (!address) throw new Error('address is missing.');
            if (!city) throw new Error('city is missing.');
            const ph = phone(d.phone);
            const wa = phone(d.whatsapp);
            if (d.phone && !ph) throw new Error('phone is not a valid number.');
            if (d.whatsapp && !wa) throw new Error('whatsapp is not a valid number.');
            if (!ph && !wa) throw new Error('Add a phone or WhatsApp number.');
            let lat = null;
            let lng = null;
            if (d.lat || d.lng) {
              lat = num(d.lat, 23, 38);
              lng = num(d.lng, 60, 78);
              if (lat == null || lng == null || d.lat === '' || d.lng === '') throw new Error('lat and lng must both be given and inside Pakistan (lat 23-38, lng 60-78), or both left empty.');
            }
            const email = d.owner_email.toLowerCase();
            if (!validEmail(email)) throw new Error('owner_email is not a valid email.');
            const owner = owners.get(email);
            if (!owner) throw new Error(`No account with owner_email ${email.slice(0, 80)}. The owner must sign up first.`);
            if (owner.role !== 'pharmacy') throw new Error('The owner_email account is not a pharmacy account.');
            return { name, address, area: clean(d.area, 60), city, phone: ph, whatsapp: wa, hours: clean(d.hours, 80), lat, lng, ownerId: owner.id, ownerEmail: email };
          },
          !!b.partial
        );
        const created = [];
        const now = new Date().toISOString();
        for (const g of r.good) {
          const { ownerEmail, ...v } = g.value;
          const p = { id: 'p_' + rid(6), ...v, verified: true, stock: {}, createdAt: now, importedAt: now };
          await savePharmacy(p);
          created.push({ id: p.id, name: p.name, city: p.city, ownerEmail });
        }
        return json(res, 200, { ok: true, imported: created.length, errors: r.errors, pharmacies: created });
      });
    }

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
        invalidateDirectory();
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
      invalidateDirectory();
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

  async function analytics() {
    const now = Date.now();
    const userKeys = await store.list('users/');
    const users = (await Promise.all(userKeys.slice(0, 5000).map((k) => store.get(k.key)))).filter(Boolean);
    const byRole = {};
    const byPlan = {};
    let trials = 0;
    let newLast30 = 0;
    const expiringSoon = [];
    for (const u of users) {
      byRole[u.role] = (byRole[u.role] || 0) + 1;
      const plan = activePlan(u, now);
      byPlan[plan] = (byPlan[plan] || 0) + 1;
      if (u.trial && plan !== 'free') trials++;
      if (plan !== 'free' && Date.parse(u.planUntil) - now < 7 * DAY) expiringSoon.push({ id: u.id, name: u.name, email: u.email, phone: u.phone, plan, planUntil: u.planUntil, trial: !!u.trial });
      if (Date.parse(u.createdAt) > now - 30 * DAY) newLast30++;
    }
    const payKeys = await store.list('payments/');
    const pays = (await Promise.all(payKeys.slice(-2000).map((k) => store.get(k.key)))).filter(Boolean);
    const revenue = { approved: 0, pending: 0, last30: 0, byPlan: {}, byMethod: {} };
    for (const p of pays) {
      if (p.status === 'pending') revenue.pending += p.amount || 0;
      if (p.status !== 'approved') continue;
      revenue.approved += p.amount || 0;
      if (Date.parse(p.decidedAt || p.at) > now - 30 * DAY) revenue.last30 += p.amount || 0;
      revenue.byPlan[p.plan] = (revenue.byPlan[p.plan] || 0) + (p.amount || 0);
      revenue.byMethod[p.method] = (revenue.byMethod[p.method] || 0) + (p.amount || 0);
    }
    invalidateDirectory();
    const pharms = await allPharmacies();
    const events = {};
    const daily = {};
    await Promise.all(
      pharms.map(async (p) => {
        const st = await statsFor(p.id, 30);
        for (const [k, v] of Object.entries(st.totals)) events[k] = (events[k] || 0) + v;
        for (const d of st.days) daily[d.day] = (daily[d.day] || 0) + (d.view || 0);
      })
    );
    const demand = {};
    for (const c of [...new Set(pharms.map((p) => slug(p.city)).filter(Boolean))]) {
      for (const d of await demandFor(c, 30)) {
        demand[d.id] = demand[d.id] || { ...d, searches: 0 };
        demand[d.id].searches += d.searches;
      }
    }
    return {
      users: { total: users.length, byRole, byPlan, trials, newLast30 },
      revenue,
      expiringSoon: expiringSoon.sort((x, y) => Date.parse(x.planUntil) - Date.parse(y.planUntil)).slice(0, 100),
      pharmacies: { total: pharms.length, verified: pharms.filter((p) => p.verified).length, pending: pharms.filter((p) => !p.verified).length, cities: [...new Set(pharms.map((p) => p.city).filter(Boolean))] },
      events30: events,
      viewsByDay: Object.entries(daily).sort().map(([day, views]) => ({ day, views })),
      topSearched: Object.values(demand).sort((x, y) => y.searches - x.searches).slice(0, 20),
    };
  }

  function resetCaches() {
    invalidateDirectory();
    secretCache = null;
  }

  return { account, places, v1, adminActions, resetCaches };
};

let rxClient = null; // tests inject a fake client
async function readPrescription(chatLib, mediaType, data) {
  const client = rxClient || new (chatLib.Anthropic())();
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
module.exports._internals = { hashPassword, passwordMatches, activePlan, optimise, haversine, claimsReport, checkImage, sniffImage, deviceLabel, exportableUser };
module.exports.TERMS_VERSION = TERMS_VERSION;
module.exports.APP_CODE_MS = APP_CODE_MS;
module.exports._setRxClient = (c) => (rxClient = c);
module.exports._setGoogleVerifier = (f) => (googleVerifier = f);
module.exports._jazzcash = jazzcash;
