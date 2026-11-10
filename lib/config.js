/**
 * Site settings edited from the admin panel and read by every visitor via /api/config.
 */
'use strict';

const store = require('./store');

const KEY = 'config/site.json';
const CACHE_MS = 15 * 1000;

const DEFAULTS = Object.freeze({
  announcement: { on: false, tone: 'info', en: '', ur: '' },
  ai: { enabled: true },
  popular: [],
  contact: { phone: '+92 327 3202419', email: 'ahmedmansoorrind1210@gmail.com', whatsapp: '' },
  overrides: {},
  updatedAt: null,
});

function str(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

/** Validate and normalise settings coming from the admin panel (or storage). */
function sanitize(input) {
  const i = input && typeof input === 'object' ? input : {};
  const a = i.announcement || {};
  const c = i.contact || {};
  const out = {
    announcement: {
      on: !!a.on,
      tone: ['info', 'warn', 'success'].includes(a.tone) ? a.tone : 'info',
      en: str(a.en, 280),
      ur: str(a.ur, 280),
    },
    ai: { enabled: !(i.ai && i.ai.enabled === false) },
    popular: (Array.isArray(i.popular) ? i.popular : String(i.popular || '').split(','))
      .map((p) => str(p, 40))
      .filter(Boolean)
      .slice(0, 16),
    contact: {
      phone: str(c.phone, 40),
      email: str(c.email, 120),
      whatsapp: str(c.whatsapp, 40).replace(/[^\d+]/g, ''),
    },
    overrides: {},
    updatedAt: i.updatedAt || null,
  };
  const ov = i.overrides && typeof i.overrides === 'object' ? i.overrides : {};
  for (const [id, o] of Object.entries(ov).slice(0, 2000)) {
    if (!/^[a-z0-9-]{1,140}$/.test(id) || !o || typeof o !== 'object') continue;
    const entry = {};
    const price = Number(o.price);
    if (isFinite(price) && price > 0 && price < 10000000) entry.price = Math.round(price * 100) / 100;
    if (o.hidden) entry.hidden = true;
    if (o.note) entry.note = str(o.note, 200);
    if (o.name) entry.name = str(o.name, 140);
    entry.at = str(o.at, 30) || new Date().toISOString();
    if (entry.price || entry.hidden) out.overrides[id] = entry;
  }
  return out;
}

let cache = null;

async function load({ fresh } = {}) {
  if (!fresh && cache && Date.now() - cache.t < CACHE_MS) return cache.v;
  let v;
  try {
    v = sanitize({ ...DEFAULTS, ...((await store.get(KEY)) || {}) });
  } catch (e) {
    console.error('Settings unavailable, using defaults:', e && e.message);
    v = sanitize(DEFAULTS);
  }
  cache = { t: Date.now(), v };
  return v;
}

async function save(input) {
  const v = sanitize(input);
  v.updatedAt = new Date().toISOString();
  await store.put(KEY, v);
  cache = { t: Date.now(), v };
  return v;
}

/** What visitors get: no admin notes. */
function publicView(cfg, aiAvailable) {
  const overrides = {};
  for (const [id, o] of Object.entries(cfg.overrides)) {
    overrides[id] = o.hidden ? { hidden: true } : { price: o.price };
  }
  return {
    announcement: cfg.announcement.on && (cfg.announcement.en || cfg.announcement.ur) ? cfg.announcement : null,
    ai: !!(aiAvailable && cfg.ai.enabled),
    popular: cfg.popular,
    contact: cfg.contact,
    overrides,
    updatedAt: cfg.updatedAt,
  };
}

function _resetCache() {
  cache = null;
}

module.exports = { load, save, sanitize, publicView, DEFAULTS, _resetCache };
