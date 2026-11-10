/**
 * Server-side copy of the medicine dataset (used by the AI chat tools and admin stats),
 * with the admin's price corrections applied.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const SDData = require('../js/data.js');
const SDSearch = require('../js/search.js');

const DATA_FILE = path.join(__dirname, '..', 'data', 'medicines.json');

let rawJson = null;
let current = null; // { key, ds, engine, applied }

function raw() {
  if (!rawJson) rawJson = fs.readFileSync(DATA_FILE, 'utf8');
  return rawJson;
}

function build(overrides, key) {
  const ds = SDData.expand(JSON.parse(raw()));
  const applied = SDData.applyOverrides(ds, overrides || {});
  current = { key, ds, engine: SDSearch.createEngine(ds), applied };
  return current;
}

/** Synchronous access: the last built dataset (without corrections on first use). */
function get() {
  return current || build({}, 'base');
}

/** Rebuild if the admin settings changed since the last build. */
function refresh(cfg) {
  const key = (cfg && cfg.updatedAt) || 'base';
  if (current && current.key === key) return current;
  return build(cfg ? cfg.overrides : {}, key);
}

let metaCache = null;
/** Product count and price date without building the search index (cheap for /api/health). */
function meta() {
  if (!metaCache) {
    const j = JSON.parse(raw());
    metaCache = { products: j.rows.length, latest_price_date: (j.meta || {}).latest_price_date || null };
  }
  return metaCache;
}

module.exports = { get, refresh, meta };
