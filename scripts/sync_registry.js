#!/usr/bin/env node
/**
 * Sasta Dawa Finder - DRAP registered-drugs sync
 *
 * DRAP's price index (scripts/sync_drap.js) only lists medicines whose price DRAP still sets
 * (mostly the National Essential Medicines List). Since the 2024 deregulation, thousands of
 * common brands (Valtec, Starcox, Diovan, Ponstan...) are not on it at all, so searching them
 * found nothing.
 *
 * DRAP's Registered Drugs Index (https://eapp.dra.gov.pk/WebProductIndex.php) lists every
 * registered product with its composition, but no price. This script reads it and writes
 * data/registry.json: brands that are NOT on the price list, with the same salt keys as
 * data/medicines.json, so the app can show "Valtec 80mg = Valsartan, price not set by DRAP"
 * plus the cheaper priced brands with the same salt.
 *
 * How the index works (the page's own AJAX calls, no login or cookies):
 *   POST productView.php  masterID=<ingredient>  -> JSON list of every product whose
 *        composition contains that text: { registrationNo, approvedName, genericName, companyName }
 *   GET  productView.php?search=<text>&_type=brand name -> { results: [{ id: regNo, text: name }] }
 *   POST productView.php  webRegNo=<regNo>        -> HTML detail card (composition, dosage form)
 *
 * Usage:
 *   node scripts/sync_registry.js               # crawl (polite, ~1 req/sec) then build
 *   node scripts/sync_registry.js --build-only  # rebuild from .cache/registry/raw.json
 *   node scripts/sync_registry.js --max-terms 50   # quick test crawl
 */
'use strict';

const fs = require('fs');
const path = require('path');
const N = require('./drap_normalize');

const ROOT = path.resolve(__dirname, '..');
const BASE_URL = 'https://eapp.dra.gov.pk/productView.php';

// ---------------------------------------------------------------------------
// Ingredient search terms
// ---------------------------------------------------------------------------

// Words that never identify an ingredient on their own (dosage forms, salts, filler words)
const STOP_WORDS = new Set([
  'tablet', 'tablets', 'capsule', 'capsules', 'injection', 'infusion', 'syrup', 'suspension', 'drops', 'cream',
  'ointment', 'lotion', 'sterile', 'oral', 'solution', 'powder', 'vial', 'ampoule', 'sachet', 'spray', 'eye',
  'ear', 'nasal', 'film', 'coated', 'release', 'extended', 'sustained', 'delayed', 'each', 'contains', 'equivalent',
  'water', 'acid', 'sodium', 'potassium', 'calcium', 'magnesium', 'hydrochloride', 'chloride', 'sulphate', 'sulfate',
  'phosphate', 'citrate', 'acetate', 'besylate', 'maleate', 'tartrate', 'fumarate', 'succinate', 'mesylate',
  'trihydrate', 'dihydrate', 'monohydrate', 'anhydrous', 'micronized', 'pellets', 'granules', 'complex', 'extract',
  'human', 'recombinant', 'purified', 'dried', 'vitamin', 'elemental', 'other', 'with', 'without', 'plus', 'forte',
  'blend', 'mixture', 'liquid', 'concentrate', 'protein', 'active', 'activity', 'units', 'international',
]);

/** Core search word of an ingredient name: "Clavulanic Acid" -> "clavulanic". */
function termOf(name) {
  const words = N.normalizeIngredientName(name).split(' ');
  for (const w of words) if (w.length >= 5 && /^[a-z][a-z-]+$/.test(w) && !STOP_WORDS.has(w)) return w;
  return '';
}

/** Split a registry composition ("Amlodipine as Besylate, <br>Valsartan") into ingredient names. */
function splitComposition(text) {
  const s = String(text || '')
    .replace(/<br\s*\/?>/gi, ',')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\d+(?:[.,]\d+)?\s*(mg|mcg|g|gm|iu|ml|%)?/gi, ' ')
    // "Amlodipine besylate eq to amlodipine" -> keep the part after "eq to"
    .replace(/\b[A-Za-z][A-Za-z\s\-]*?\s*\b(?:eq\.?|equivalent|equiv\.?|corresp\.?)\s*(?:to\b)?\.?\s*(?=[A-Za-z])/gi, ' ');
  const out = [];
  for (const part of s.split(/\s*(?:,|\+|\/|;|&|\band\b|\bwith\b)\s*/i)) {
    const name = N.normalizeIngredientName(part);
    if (name && name.length >= 3 && !/^[\d\s.-]+$/.test(name) && !out.includes(name)) out.push(name);
  }
  return out;
}

/** Search terms to start from: every ingredient in the price dataset. */
function seedTerms(medicinesJson) {
  const F = {};
  medicinesJson.fields.forEach((f, i) => (F[f] = i));
  const terms = new Set();
  for (const r of medicinesJson.rows) {
    for (const part of String(r[F.generic]).split(' + ')) {
      const t = termOf(part);
      if (t) terms.add(t);
    }
  }
  return [...terms].sort();
}

// ---------------------------------------------------------------------------
// Detail card (fallback for products the ingredient search didn't reach)
// ---------------------------------------------------------------------------

function htmlText(s) {
  return String(s)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#0*39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Read label -> value pairs from a productView.php detail card. */
function parseDetailHtml(html) {
  const out = {};
  const cells = [...String(html).matchAll(/<(?:td|th|dt|dd|div|span|label|strong|b)[^>]*>([\s\S]*?)<\/(?:td|th|dt|dd|div|span|label|strong|b)>/gi)]
    .map((m) => htmlText(m[1]))
    .filter(Boolean);
  const LABELS = { 'Product Name': 'product', 'Registration No': 'reg', 'Company Name': 'company', 'Dosage Form': 'form', 'Composition': 'composition', 'Used For': 'usedFor', 'Registration Status': 'status' };
  for (let i = 0; i < cells.length - 1; i++) {
    const key = LABELS[cells[i]];
    if (key && !out[key] && !LABELS[cells[i + 1]]) out[key] = cells[i + 1];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Crawl (network access is injected, so the same code runs in Node or a browser page)
// ---------------------------------------------------------------------------

/**
 * @param io { getJson(params), postJson(params), postText(params), sleep(ms), log(msg) }
 * @param opts { seeds: string[], maxTerms, delayMs, brandSweep: string[], maxDetails }
 * @returns { products: { [reg]: [product, composition, company] }, terms: number, brandOnly: number }
 */
async function crawlRegistry(io, opts) {
  const o = Object.assign({ maxTerms: 0, delayMs: 900, brandSweep: ['a', 'e', 'i', 'o', 'u'], maxDetails: 3000 }, opts);
  const products = {};
  const queued = new Set(o.seeds);
  const queue = [...o.seeds];
  const seenTermCount = new Map();
  let done = 0;

  // 1) Ingredient search, discovering new ingredients from the compositions we get back
  while (queue.length && (!o.maxTerms || done < o.maxTerms)) {
    const term = queue.shift();
    let list = [];
    try {
      list = await io.postJson({ masterID: term });
    } catch (e) {
      io.log(`  ! ${term}: ${e.message}`);
    }
    done++;
    if (Array.isArray(list)) {
      for (const p of list) {
        const reg = String(p.registrationNo || '').trim();
        if (!reg || products[reg]) continue;
        products[reg] = [htmlText(p.approvedName), String(p.genericName || '').trim(), htmlText(p.companyName)];
        for (const name of splitComposition(p.genericName)) {
          const t = termOf(name);
          if (!t || queued.has(t)) continue;
          const c = (seenTermCount.get(t) || 0) + 1;
          seenTermCount.set(t, c);
          if (c >= 2) {
            queued.add(t);
            queue.push(t);
          }
        }
      }
    }
    if (done % 100 === 0) io.log(`  ...${done} ingredients searched, ${queue.length} queued, ${Object.keys(products).length} products`);
    await io.sleep(o.delayMs);
  }

  // 2) Brand-name sweep: every registration number, to find what step 1 missed
  const brandNames = {};
  for (const q of o.brandSweep) {
    try {
      const res = await io.getJson({ search: q, _type: 'brand name' });
      for (const r of (res && res.results) || []) {
        const reg = String(r.id || '').trim();
        if (reg && !brandNames[reg]) brandNames[reg] = htmlText(r.text);
      }
    } catch (e) {
      io.log(`  ! brand sweep "${q}": ${e.message}`);
    }
    await io.sleep(o.delayMs);
  }
  const missing = Object.keys(brandNames).filter((reg) => !products[reg]);
  io.log(`  brand sweep: ${Object.keys(brandNames).length} registrations, ${missing.length} not reached by ingredient search`);

  // 3) Detail cards for the missing ones (capped; the rest are stored with their name only)
  let details = 0;
  for (const reg of missing) {
    if (details >= o.maxDetails) {
      products[reg] = [brandNames[reg], '', ''];
      continue;
    }
    try {
      const d = parseDetailHtml(await io.postText({ webRegNo: reg }));
      products[reg] = [d.product || brandNames[reg], d.composition || '', d.company || '', d.form || '', d.usedFor || ''];
    } catch (e) {
      products[reg] = [brandNames[reg], '', ''];
    }
    details++;
    if (details % 200 === 0) io.log(`  ...${details} detail cards`);
    await io.sleep(o.delayMs);
  }

  return { products, terms: done, brandOnly: Math.max(0, missing.length - details) };
}

// ---------------------------------------------------------------------------
// Build data/registry.json
// ---------------------------------------------------------------------------

// Veterinary / non-medicine registrations are not useful to patients
const NOT_HUMAN = /\b(veterinary|vet\b|poultry|cattle|livestock|broiler|layer|canine|feline|bovine|equine|ovine|avian|for animal)/i;

/** Strength from the product name for a single-salt product ("Valtec 80mg Tablets" -> "80mg"). */
function strengthFromName(product) {
  const m = String(product).match(/(\d+(?:\.\d+)?)\s*(mg|mcg|g|gm|iu)\b/i);
  if (!m) return '';
  const a = N.canonicalAmount(m[1], m[2]);
  return a ? N.formatAmount(a) : '';
}

/**
 * @param raw  output of crawlRegistry (or the cached raw.json)
 * @param medicinesJson  data/medicines.json (to skip products that already have a DRAP price
 *                       and to reuse its salt keys)
 */
function buildRegistry(raw, medicinesJson, now) {
  const F = {};
  medicinesJson.fields.forEach((f, i) => (F[f] = i));
  const priced = new Set(medicinesJson.rows.map((r) => String(r[F.reg]).trim()));
  const pricedSalts = new Set(medicinesJson.rows.map((r) => r[F.salt_key]).filter(Boolean));

  const companies = [];
  const companyIdx = new Map();
  const forms = [];
  const formIdx = new Map();
  // generic + salt key repeat thousands of times: store each pair once
  const salts = [];
  const saltIdx = new Map();
  const intern = (list, idx, v) => {
    if (!idx.has(v)) { idx.set(v, list.length); list.push(v); }
    return idx.get(v);
  };

  const seen = new Set();
  const rows = [];
  let skippedPriced = 0;
  let skippedOther = 0;
  for (const [reg, rec] of Object.entries(raw.products || {})) {
    const [productRaw, composition, company, formRaw, usedFor] = rec;
    if (priced.has(reg)) { skippedPriced++; continue; }
    const product = N.slug(productRaw) ? String(productRaw).replace(/\s+/g, ' ').trim() : '';
    if (!product || NOT_HUMAN.test(product + ' ' + (usedFor || '')) || (usedFor && !/human/i.test(usedFor))) { skippedOther++; continue; }

    const names = splitComposition(composition);
    const brandWord = N.shortBrandName(product).split(' ')[0].toLowerCase();
    const ingredients = names.filter((n, i, arr) => arr.length === 1 || n.split(' ')[0] !== brandWord);
    const sorted = [...ingredients].sort();
    const saltKey = N.slug(sorted.join(' + '));
    const generic = ingredients.map((n) => n.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')).join(' + ');
    const { form } = N.detectForm(product, formRaw || '', '');
    const strength = ingredients.length === 1 ? strengthFromName(product) : '';
    // "Valtec320mg Tablet" -> "Valtec" (DRAP sometimes glues the strength to the name)
    const name = N.shortBrandName(product).replace(/^([A-Za-z][A-Za-z\-]{2,}?)\d+(?:\.\d+)?\s*(?:mg|mcg|g|gm|iu|ml)$/i, '$1');

    // one row per brand + strength + form + salt is enough for search
    const key = [name.toLowerCase(), strength, form, saltKey].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    const pairKey = generic + '|' + saltKey;
    if (!saltIdx.has(pairKey)) { saltIdx.set(pairKey, salts.length); salts.push([generic, saltKey, saltKey && pricedSalts.has(saltKey) ? 1 : 0]); }
    rows.push([
      reg,
      product,
      name === product ? '' : name, // empty = same as product (saves space)
      saltIdx.get(pairKey),
      strength,
      intern(forms, formIdx, form),
      intern(companies, companyIdx, String(company || '').trim()),
    ]);
  }
  rows.sort((a, b) => (a[2] || a[1]).localeCompare(b[2] || b[1]) || a[1].localeCompare(b[1]));

  return {
    out: {
      meta: {
        source: 'Drug Regulatory Authority of Pakistan - Registered Drugs Index (provisional)',
        source_url: 'https://eapp.dra.gov.pk/WebProductIndex.php',
        synced_at: (now || new Date()).toISOString(),
        products: rows.length,
        note: 'Registered brands without a DRAP-notified price. DRAP calls this list provisional; it may contain errors or omissions.',
      },
      // salt: index into salts = [generic, salt_key, has_priced_alternatives]
      fields: ['reg', 'product', 'name', 'salt', 'strength', 'form', 'company'],
      salts,
      forms,
      companies,
      rows,
    },
    stats: { skippedPriced, skippedOther },
  };
}

// ---------------------------------------------------------------------------
// Node entry point
// ---------------------------------------------------------------------------

function nodeIo() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const headers = { 'User-Agent': 'SastaDawaFinder-registry-sync/1.0', 'X-Requested-With': 'XMLHttpRequest' };
  async function request(method, params) {
    const body = new URLSearchParams(params).toString();
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = method === 'GET'
          ? await fetch(`${BASE_URL}?${body}`, { headers })
          : await fetch(BASE_URL, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' }, body });
        if (res.ok) return await res.text();
        if (res.status < 500 && res.status !== 429) throw new Error(`HTTP ${res.status}`);
      } catch (e) {
        if (attempt === 3) throw e;
      }
      await sleep(attempt * 5000);
    }
    throw new Error('request failed');
  }
  const json = (t) => (t && t.trim() ? JSON.parse(t) : null);
  return {
    getJson: async (p) => json(await request('GET', p)),
    postJson: async (p) => json(await request('POST', p)),
    postText: (p) => request('POST', p),
    sleep,
    log: (m) => console.log(m),
  };
}

function argValue(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const cacheDir = path.resolve(argValue('--cache', path.join(ROOT, '.cache', 'registry')));
  const rawFile = path.join(cacheDir, 'raw.json');
  const outFile = path.resolve(argValue('--out', path.join(ROOT, 'data', 'registry.json')));
  const medicines = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'medicines.json'), 'utf8'));

  let raw;
  if (process.argv.includes('--build-only')) {
    raw = JSON.parse(fs.readFileSync(rawFile, 'utf8'));
  } else {
    const seeds = seedTerms(medicines);
    console.log(`DRAP registry: searching ${seeds.length} ingredients (more are added as they turn up)`);
    raw = await crawlRegistry(nodeIo(), {
      seeds,
      maxTerms: parseInt(argValue('--max-terms', '0'), 10) || 0,
      delayMs: parseInt(argValue('--delay', '900'), 10),
      maxDetails: parseInt(argValue('--max-details', '3000'), 10),
    });
    raw.crawled_at = new Date().toISOString();
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(rawFile, JSON.stringify(raw));
    console.log(`Crawled ${Object.keys(raw.products).length} registrations (${raw.terms} ingredient searches)`);
  }
  const { out, stats } = buildRegistry(raw, medicines);
  fs.writeFileSync(outFile, JSON.stringify(out));
  const kb = Math.round(fs.statSync(outFile).size / 1024);
  console.log(`Wrote ${out.rows.length} unpriced brands (${stats.skippedPriced} already priced, ${stats.skippedOther} vet/other skipped) -> ${path.relative(ROOT, outFile)} (${kb} KB)`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { termOf, splitComposition, seedTerms, parseDetailHtml, crawlRegistry, buildRegistry, strengthFromName, STOP_WORDS };
