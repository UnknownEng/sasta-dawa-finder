/**
 * Central input guard for every JSON body (applied in lib/api.js readJson).
 *
 *  - Rejects keys that can pollute object prototypes (__proto__, constructor, prototype) at any depth.
 *  - Normalises every string: Unicode NFC, control characters removed (tab, newline and carriage
 *    return are kept), bidi override / isolate characters (U+202A-U+202E, U+2066-U+2069) removed.
 *  - Enforces structural limits: nesting depth, key length, number of keys / items.
 *
 * Field lengths are still enforced by each route (clean(v, max)); this is the shared safety net.
 */
'use strict';

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
// C0 controls except \t \n \r, DEL, C1 controls, bidi embedding/override (202A-202E) and isolates (2066-2069)
const STRIP = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;

const LIMITS = { depth: 32, keyLength: 256, nodes: 5000000 };

const bad = (message) => Object.assign(new Error(message), { status: 400 });

function cleanString(s) {
  let out = s;
  try {
    out = out.normalize('NFC');
  } catch (e) {
    /* lone surrogates: keep as is */
  }
  return out.replace(STRIP, '');
}

/**
 * Returns a cleaned deep copy of `value`. Throws a 400 error for forbidden keys or when limits are exceeded.
 */
function sanitize(value, limits) {
  const lim = { ...LIMITS, ...(limits || {}) };
  let nodes = 0;
  const walk = (v, depth) => {
    if (++nodes > lim.nodes) throw bad('Request is too complex.');
    if (typeof v === 'string') return cleanString(v);
    if (v === null || typeof v !== 'object') return v;
    if (depth > lim.depth) throw bad('Request is nested too deeply.');
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
    const out = {};
    for (const k of Object.keys(v)) {
      if (FORBIDDEN_KEYS.has(k)) throw bad('Request contains a forbidden field name.');
      if (k.length > lim.keyLength) throw bad('Request contains a field name that is too long.');
      const ck = cleanString(k);
      if (FORBIDDEN_KEYS.has(ck)) throw bad('Request contains a forbidden field name.');
      out[ck] = walk(v[k], depth + 1);
    }
    return out;
  };
  return walk(value, 0);
}

/** Quick check used by tests and other callers: does the object contain a forbidden key anywhere? */
function hasForbiddenKey(value) {
  try {
    sanitize(value);
    return false;
  } catch (e) {
    return /forbidden/.test(e.message);
  }
}

module.exports = { sanitize, cleanString, hasForbiddenKey, FORBIDDEN_KEYS, LIMITS };
