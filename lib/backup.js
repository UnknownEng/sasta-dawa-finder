/**
 * Backups of the JSON store.
 *
 *   build()            -> { format, version, createdAt, count, keys: { "<store key>": <json> } }
 *                         every known prefix; never secrets/ (login signing keys, admin 2FA),
 *                         backups/ (no backups inside backups) or appcodes/ (5-minute login codes).
 *   validate(backup)   -> list of [key, value] to write, or throws 400
 *   restore(backup, mode)  mode 'merge' = only write keys that don't exist yet;
 *                          'replace-keys' = overwrite every key in the backup. Neither deletes anything.
 *   daily()            -> writes backups/<yyyy-mm-dd>.json and keeps the newest 14 (Vercel Cron)
 */
'use strict';

const store = require('./store');

const FORMAT = 'sasta-dawa-backup';
const PREFIXES = ['config/', 'users/', 'emails/', 'pharmacies/', 'stats/', 'demand/', 'reservations/', 'payments/', 'paytxn/', 'companies/', 'apikeys/', 'usage/', 'refills/', 'feedback/', 'feedback-done/'];
const NEVER = ['secrets/', 'backups/', 'appcodes/'];
const KEEP = 14;
const MAX_KEYS = 200000;

const bad = (message) => Object.assign(new Error(message), { status: 400 });

function allowedKey(k) {
  try {
    store.safeKey(k);
  } catch (e) {
    return false;
  }
  return k.endsWith('.json') && PREFIXES.some((p) => k.startsWith(p)) && !NEVER.some((p) => k.startsWith(p));
}

async function build() {
  const keys = {};
  let count = 0;
  for (const p of PREFIXES) {
    const items = await store.listDeep(p);
    const values = await Promise.all(items.map((i) => store.get(i.key)));
    items.forEach((i, n) => {
      if (values[n] != null && allowedKey(i.key)) {
        keys[i.key] = values[n];
        count++;
      }
    });
  }
  return { format: FORMAT, version: 1, createdAt: new Date().toISOString(), count, keys };
}

function validate(backup) {
  if (!backup || typeof backup !== 'object' || Array.isArray(backup)) throw bad('This is not a Sasta Dawa backup file.');
  if (backup.format !== FORMAT || backup.version !== 1) throw bad('This is not a Sasta Dawa backup file (format/version missing).');
  const k = backup.keys;
  if (!k || typeof k !== 'object' || Array.isArray(k)) throw bad('The backup has no "keys" object.');
  const entries = Object.entries(k);
  if (entries.length > MAX_KEYS) throw bad('The backup has too many keys.');
  const badKeys = [];
  for (const [key, value] of entries) {
    if (!allowedKey(key)) badKeys.push(key);
    else if (value === null || typeof value !== 'object') badKeys.push(key);
  }
  if (badKeys.length) {
    throw Object.assign(bad(`The backup contains ${badKeys.length} key(s) that are not allowed (only ${PREFIXES.join(' ')}). Nothing was restored.`), { badKeys: badKeys.slice(0, 50) });
  }
  return entries;
}

async function restore(backup, mode) {
  if (mode !== 'merge' && mode !== 'replace-keys') throw bad('mode must be "merge" or "replace-keys".');
  const entries = validate(backup);
  let written = 0;
  let skipped = 0;
  let existing = null;
  if (mode === 'merge') {
    existing = new Set();
    for (const p of PREFIXES) (await store.listDeep(p)).forEach((i) => existing.add(i.key));
  }
  for (const [key, value] of entries) {
    if (existing && existing.has(key)) {
      skipped++;
      continue;
    }
    await store.put(key, value);
    written++;
  }
  return { mode, total: entries.length, written, restored: written, skipped };
}

function dateKey(d) {
  return `backups/${(d || new Date()).toISOString().slice(0, 10)}.json`;
}

async function list() {
  const items = (await store.list('backups/')).filter((i) => /^backups\/\d{4}-\d{2}-\d{2}\.json$/.test(i.key));
  items.sort((a, b) => (a.key < b.key ? 1 : -1));
  return items.map((i) => ({ key: i.key, date: i.key.slice(8, 18), name: i.key.slice(8), size: i.size == null ? null : i.size, at: i.uploadedAt, uploadedAt: i.uploadedAt }));
}

async function daily(now) {
  const b = await build();
  const key = dateKey(now);
  await store.put(key, b);
  const all = await list();
  const old = all.slice(KEEP);
  for (const o of old) await store.del(o.key);
  return { key, count: b.count, kept: Math.min(all.length, KEEP), deleted: old.map((o) => o.key) };
}

module.exports = { build, validate, restore, daily, list, allowedKey, PREFIXES, NEVER, KEEP, FORMAT };
