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

module.exports = { configured, checkPassword, createToken, verifyToken, sessionCookie, isAuthed, tooManyAttempts, recordFailure, clearFailures, COOKIE };
