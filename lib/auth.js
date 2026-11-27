/**
 * Admin sign-in: one password from the ADMIN_PASSWORD environment variable.
 * Sessions are HMAC-signed cookies (HttpOnly, SameSite=Strict, 12 hours).
 * Changing ADMIN_PASSWORD signs everyone out.
 */
'use strict';

const crypto = require('crypto');

const COOKIE = 'sd_admin';
const SESSION_SECONDS = 12 * 60 * 60;

function configured() {
  return typeof process.env.ADMIN_PASSWORD === 'string' && process.env.ADMIN_PASSWORD.length >= 8;
}

// Session signing key. Derived with scrypt (deliberately slow, computed once per server
// instance), so someone holding a stolen cookie can't cheaply brute-force the password offline.
// Set ADMIN_SESSION_SECRET to a long random value to make that impossible altogether.
let secretCache = { pw: null, key: null };
function secret() {
  if (process.env.ADMIN_SESSION_SECRET) return process.env.ADMIN_SESSION_SECRET;
  const pw = process.env.ADMIN_PASSWORD;
  if (secretCache.pw !== pw) {
    secretCache = { pw, key: crypto.scryptSync(pw, 'sasta-dawa-admin-session-v2', 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }) };
  }
  return secretCache.key;
}

function sha(s) {
  return crypto.createHash('sha256').update(String(s)).digest();
}

function checkPassword(given) {
  if (!configured()) return false;
  return crypto.timingSafeEqual(sha(given), sha(process.env.ADMIN_PASSWORD));
}

function sign(data) {
  return crypto.createHmac('sha256', secret()).update(data).digest('base64url');
}

function createToken(now) {
  const exp = Math.floor((now || Date.now()) / 1000) + SESSION_SECONDS;
  const body = Buffer.from(JSON.stringify({ exp })).toString('base64url');
  return body + '.' + sign(body);
}

function verifyToken(token, now) {
  if (!configured() || typeof token !== 'string' || !token.includes('.')) return false;
  const [body, sig] = token.split('.');
  const expected = sign(body);
  if (!sig || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return typeof exp === 'number' && exp * 1000 > (now || Date.now());
  } catch (e) {
    return false;
  }
}

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch (e) {
        return null; // malformed cookie: treat as signed out, never crash
      }
    }
  }
  return null;
}

function isSecure(req) {
  return !!process.env.VERCEL || req.headers['x-forwarded-proto'] === 'https';
}

function sessionCookie(req, token) {
  const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${token ? SESSION_SECONDS : 0}`];
  if (isSecure(req)) parts.push('Secure');
  return parts.join('; ');
}

function isAuthed(req) {
  return verifyToken(readCookie(req, COOKIE));
}

// Login attempts: 8 per 15 minutes per IP, and 60 per 15 minutes across all IPs (per server
// instance) so a botnet rotating addresses is slowed too. A long random password is the real
// protection; Vercel Firewall rate limiting on /api/admin adds a shared limit.
const WINDOW = 15 * 60 * 1000;
const attempts = new Map();
let allAttempts = [];
function tooManyAttempts(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < WINDOW);
  attempts.set(ip, list);
  allAttempts = allAttempts.filter((t) => now - t < WINDOW);
  if (attempts.size > 5000) for (const [k, v] of attempts) if (!v.length) attempts.delete(k);
  return list.length >= 8 || allAttempts.length >= 60;
}
function recordFailure(ip) {
  const list = attempts.get(ip) || [];
  list.push(Date.now());
  attempts.set(ip, list);
  allAttempts.push(Date.now());
}
function clearFailures(ip) {
  attempts.delete(ip);
  allAttempts.pop(); // the successful attempt was counted up front
}
/**
 * Un-count only this one attempt (the password was right, the 2FA code is still to come).
 * Unlike clearFailures it keeps earlier failures, so wrong 2FA codes can't be wiped by sending
 * the password alone in between (which would allow unlimited code guesses).
 */
function undoAttempt(ip) {
  const list = attempts.get(ip);
  if (list && list.length) list.pop();
  allAttempts.pop();
}

// ---------------------------------------------------------------------------
// Two-factor sign-in (TOTP, Google Authenticator) for the admin.
// Stored at secrets/admin-2fa.json: { enabled, secret, recoveryHashes: [sha256 hex], enabledAt,
// lastCounter, pendingSecret, pendingAt }. Changing ADMIN_PASSWORD does not touch it.
// Emergency off switch: ADMIN_2FA_RESET=1 makes the server ignore and delete the record.
// ---------------------------------------------------------------------------
const TFA_KEY = 'secrets/admin-2fa.json';
const RECOVERY_COUNT = 10;

function store() {
  return require('./store');
}
function totp() {
  return require('./totp');
}
const shaHex = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const normRecovery = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

async function load2fa() {
  if (process.env.ADMIN_2FA_RESET === '1') {
    try {
      await store().del(TFA_KEY);
    } catch (e) {
      /* nothing stored */
    }
    return null;
  }
  try {
    return await store().get(TFA_KEY);
  } catch (e) {
    return null;
  }
}
async function save2fa(rec) {
  await store().put(TFA_KEY, rec);
}
async function twoFactorEnabled() {
  const r = await load2fa();
  return !!(r && r.enabled && r.secret);
}

/** New pending secret (not active until confirmed with a code). */
async function setup2fa() {
  const rec = (await load2fa()) || {};
  if (rec.enabled) throw Object.assign(new Error('Two-factor sign-in is already on. Turn it off first to set up a new phone.'), { status: 400 });
  const secret = totp().newSecret();
  await save2fa({ ...rec, enabled: false, pendingSecret: secret, pendingAt: new Date().toISOString() });
  return { secret, otpauth: totp().otpauthUrl(secret, 'Sasta Dawa Admin', 'Sasta Dawa') };
}

function newRecoveryCodes() {
  const codes = [];
  for (let i = 0; i < RECOVERY_COUNT; i++) {
    const raw = totp().base32Encode(crypto.randomBytes(7)).slice(0, 10);
    codes.push(raw.slice(0, 5) + '-' + raw.slice(5));
  }
  return codes;
}

/** Confirm the pending secret with a code from the app. Returns the 10 recovery codes (shown once). */
async function enable2fa(code) {
  const rec = await load2fa();
  if (!rec || !rec.pendingSecret) throw Object.assign(new Error('Start the setup first.'), { status: 400 });
  if (rec.enabled) throw Object.assign(new Error('Two-factor sign-in is already on.'), { status: 400 });
  const ctr = totp().verify(rec.pendingSecret, code);
  if (ctr < 0) throw Object.assign(new Error('That code is not right. Check the time on your phone and try the newest code.'), { status: 400 });
  const recoveryCodes = newRecoveryCodes();
  await save2fa({ enabled: true, secret: rec.pendingSecret, recoveryHashes: recoveryCodes.map((c) => shaHex(normRecovery(c))), enabledAt: new Date().toISOString(), lastCounter: ctr });
  return recoveryCodes;
}

/**
 * Check a 6-digit TOTP code (±1 step, never the same step twice) or, unless totpOnly, a recovery
 * code (each works once). Returns 'totp', 'recovery' or null. Updates the stored record.
 */
async function check2faCode(code, { totpOnly } = {}) {
  const rec = await load2fa();
  if (!rec || !rec.enabled || !rec.secret) return null;
  const c = String(code || '').replace(/\s/g, '');
  if (/^\d{6}$/.test(c)) {
    const ctr = totp().verify(rec.secret, c, { lastCounter: typeof rec.lastCounter === 'number' ? rec.lastCounter : -1 });
    if (ctr < 0) return null;
    rec.lastCounter = ctr;
    await save2fa(rec);
    return 'totp';
  }
  if (totpOnly) return null;
  const n = normRecovery(c);
  if (n.length !== 10) return null;
  const h = shaHex(n);
  const list = rec.recoveryHashes || [];
  const idx = list.findIndex((x) => x.length === h.length && crypto.timingSafeEqual(Buffer.from(x), Buffer.from(h)));
  if (idx < 0) return null;
  rec.recoveryHashes = list.filter((_, i) => i !== idx);
  await save2fa(rec);
  return 'recovery';
}

async function disable2fa(code) {
  const ok = await check2faCode(code);
  if (!ok) throw Object.assign(new Error('That code is not right.'), { status: 400 });
  await store().del(TFA_KEY);
}

async function status2fa() {
  const r = await load2fa();
  const enabled = !!(r && r.enabled && r.secret);
  return { enabled, recoveryLeft: enabled ? (r.recoveryHashes || []).length : 0, enabledAt: enabled ? r.enabledAt || null : null };
}

module.exports = {
  configured,
  checkPassword,
  createToken,
  verifyToken,
  sessionCookie,
  isAuthed,
  tooManyAttempts,
  recordFailure,
  clearFailures,
  undoAttempt,
  COOKIE,
  twoFactorEnabled,
  setup2fa,
  enable2fa,
  check2faCode,
  disable2fa,
  status2fa,
  TFA_KEY,
};
