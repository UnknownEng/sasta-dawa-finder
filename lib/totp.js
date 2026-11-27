/**
 * Time-based one-time passwords (RFC 6238 on top of RFC 4226 HOTP), the codes Google
 * Authenticator shows: HMAC-SHA1, 30-second steps, 6 digits. Secrets are base32 (RFC 4648).
 */
'use strict';

const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP = 30;
const DIGITS = 6;

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const s = String(str || '').toUpperCase().replace(/[\s=-]/g, '');
  if (!/^[A-Z2-7]*$/.test(s)) throw new Error('bad base32');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of s) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** RFC 4226 HOTP. `key` is a Buffer; `algo` sha1 (default), sha256 or sha512 for the RFC vectors. */
function hotp(key, counter, digits, algo) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac(algo || 'sha1', key).update(msg).digest();
  const off = h[h.length - 1] & 0x0f;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  const d = digits || DIGITS;
  return String(bin % 10 ** d).padStart(d, '0');
}

function counterAt(ms) {
  return Math.floor((ms == null ? Date.now() : ms) / 1000 / STEP);
}

/** The current code for a base32 secret. */
function generate(secretB32, ms) {
  return hotp(base32Decode(secretB32), counterAt(ms));
}

/**
 * Check a 6-digit code within ±`window` steps. Returns the matching counter (so the caller can
 * remember it and refuse a replay), or -1. A code whose counter is <= `lastCounter` is refused.
 */
function verify(secretB32, code, { ms, window = 1, lastCounter = -1 } = {}) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return -1;
  const key = base32Decode(secretB32);
  const now = counterAt(ms);
  for (let i = -window; i <= window; i++) {
    const ctr = now + i;
    if (ctr <= lastCounter) continue;
    const exp = hotp(key, ctr);
    if (crypto.timingSafeEqual(Buffer.from(exp), Buffer.from(c))) return ctr;
  }
  return -1;
}

function newSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function otpauthUrl(secretB32, label, issuer) {
  return `otpauth://totp/${encodeURIComponent(label)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}`;
}

module.exports = { base32Encode, base32Decode, hotp, generate, verify, newSecret, otpauthUrl, counterAt, STEP };
