#!/usr/bin/env node
/**
 * Sasta Dawa Finder - DRAP price sync
 *
 * Downloads the public Pharmaceutical Product Price Index published by the
 * Drug Regulatory Authority of Pakistan (https://e.dra.gov.pk/public/price),
 * normalizes every product and writes data/medicines.json.
 *
 * Usage:
 *   node scripts/sync_drap.js                 # fetch all pages (polite, ~1 req/sec) then build
 *   node scripts/sync_drap.js --build-only    # rebuild from cached pages in .cache/drap
 *   node scripts/sync_drap.js --cache DIR     # use another cache directory
 *   node scripts/sync_drap.js --max-pages 20  # limit pages (testing)
 *
 * Cached HTML pages are kept in .cache/drap/ (git-ignored) so re-runs only
 * download what is missing. Delete that folder to force a full refresh.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeRecord, CATEGORIES } = require('./drap_normalize');
const { editDistance } = require('../js/search');

const ROOT = path.resolve(__dirname, '..');
const BASE_URL = 'https://e.dra.gov.pk/public/price';

function argValue(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const CACHE_DIR = path.resolve(argValue('--cache', path.join(ROOT, '.cache', 'drap')));
const BUILD_ONLY = process.argv.includes('--build-only');
const MAX_PAGES = parseInt(argValue('--max-pages', '0'), 10) || 0;
const DELAY_MS = parseInt(argValue('--delay', '900'), 10);
const OUT_FILE = path.resolve(argValue('--out', path.join(ROOT, 'data', 'medicines.json')));

// ---------------------------------------------------------------------------
// HTML parsing (DRAP page structure: one <tr> per product, 7 <td> columns)
// ---------------------------------------------------------------------------

function decodeEntities(s) {
  return String(s)
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&amp;/g, '&');
}

function text(html) {
  return decodeEntities(String(html).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function parsePage(html) {
  const start = html.indexOf('<tbody');
  const end = html.indexOf('</tbody>', start);
  if (start < 0 || end < 0) return [];
  const body = html.slice(start, end);
  const rows = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = rowRe.exec(body))) {
    const tds = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((x) => x[1]);
    if (tds.length < 7) continue;
    const nameDivs = [...tds[0].matchAll(/<div class="(?:text-sm|max-w)[^"]*"[^>]*>([\s\S]*?)<\/div>/g)].map((x) => text(x[1]));
    const mfrDivs = [...tds[2].matchAll(/<div[^>]*>([\s\S]*?)<\/div>/g)].map((x) => text(x[1]));
    const priceSpans = [...tds[5].matchAll(/<span>([^<]*)<\/span>/g)].map((x) => text(x[1]));
    rows.push({
      product: nameDivs[0] || text(tds[0]),
      composition: nameDivs[1] || '',
      reg: text(tds[1]),
      manufacturer: mfrDivs[0] || text(tds[2]),
      category: text(tds[3]),
      pack: text(tds[4]),
      price: priceSpans.length ? priceSpans[priceSpans.length - 1] : text(tds[5]),
      effective: text(tds[6]),
    });
  }
  return rows;
}

function lastPageNumber(html) {
  const nums = [...html.matchAll(/[?&]page=(\d+)/g)].map((x) => parseInt(x[1], 10));
  return nums.length ? Math.max(...nums) : 1;
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(page) {
  const file = path.join(CACHE_DIR, `p${page}.html`);
  if (fs.existsSync(file)) {
    const cached = fs.readFileSync(file, 'utf8');
    if (cached.includes('</tbody>')) return { html: cached, cached: true };
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}?page=${page}`, {
        headers: { 'User-Agent': 'SastaDawaFinder-data-sync/2.0' },
      });
      if (res.ok) {
        const html = await res.text();
        if (html.includes('</tbody>')) {
          fs.writeFileSync(file, html);
          return { html, cached: false };
        }
      }
    } catch (e) {
      if (attempt === 3) throw e;
    }
    await sleep(attempt * 5000);
  }
  throw new Error(`Failed to download page ${page}`);
}

async function crawl() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const first = await fetchPage(1);
  let last = lastPageNumber(first.html);
  if (MAX_PAGES) last = Math.min(last, MAX_PAGES);
  console.log(`DRAP price index: ${last} pages`);
  for (let p = 2; p <= last; p++) {
    const { cached } = await fetchPage(p);
    if (!cached) await sleep(DELAY_MS);
    if (p % 50 === 0) console.log(`  ...page ${p}/${last}`);
  }
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function loadCuratedHints() {
  // Popular brands + synonyms from the original hand-curated list (v1 dataset).
  const file = path.join(__dirname, 'curated_hints.json');
  if (!fs.existsSync(file)) return { popular: [], synonyms: {} };
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function build() {
  const files = fs.readdirSync(CACHE_DIR).filter((f) => /^p\d+\.html$/.test(f));
  files.sort((a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10));
  const raw = [];
  for (const f of files) raw.push(...parsePage(fs.readFileSync(path.join(CACHE_DIR, f), 'utf8')));
  console.log(`Parsed ${raw.length} raw rows from ${files.length} pages`);
  const { out, skipped } = buildFromRaw(raw, loadCuratedHints());
  const target = OUT_FILE;
  fs.writeFileSync(target, JSON.stringify(out));
  const kb = Math.round(fs.statSync(target).size / 1024);
  console.log(`Wrote ${out.rows.length} products (${out.groups.length} alternative groups, ${skipped} skipped) -> ${path.relative(ROOT, target)} (${kb} KB)`);
  return out;
}

// Real, distinct drug names that look like misspellings of each other. These are
// never renamed (plus every keyword in the category lists).
const KNOWN_DRUGS = new Set([
  'folinic', 'folic', 'prednisone', 'prednisolone', 'methylprednisolone', 'hydroxyzine', 'hydralazine', 'clonidine',
  'clozapine', 'clonazepam', 'lorazepam', 'cefuroxime', 'cefoxitin', 'ceftizoxime', 'cefotaxime', 'ceftazidime',
  'chlorpromazine', 'chlorpropamide', 'glipizide', 'glimepiride', 'sulfasalazine', 'sulfadiazine', 'tramadol',
  'trazodone', 'acyclovir', 'aciclovir', 'valacyclovir', 'famciclovir', 'ganciclovir', 'oxcarbazepine',
  'carbamazepine', 'metronidazole', 'tinidazole', 'secnidazole', 'ornidazole', 'fluconazole', 'itraconazole',
  'clotrimazole', 'miconazole', 'econazole', 'ketoconazole', 'norfloxacin', 'ofloxacin', 'levofloxacin',
  'dexamethasone', 'betamethasone', 'amiloride', 'amlodipine', 'nifedipine', 'nimodipine', 'felodipine',
  'losartan', 'valsartan', 'irbesartan', 'telmisartan', 'candesartan', 'olmesartan', 'ethinylestradiol',
  'estradiol', 'norethisterone', 'levonorgestrel', 'desogestrel', 'thiamine', 'thiamazole', 'mesalamine',
  'mesalazine', 'ranitidine', 'nizatidine', 'famotidine', 'cimetidine', 'esomeprazole', 'omeprazole',
  'rabeprazole', 'lansoprazole', 'pantoprazole', 'cefixime', 'cefepime', 'cefdinir', 'cefadroxil', 'cefaclor',
  'sertraline', 'sertaconazole', 'dopamine', 'dobutamine', 'quinine', 'quinidine', 'atenolol', 'timolol',
  'propranolol', 'metoprolol', 'bisoprolol', 'carvedilol', 'labetalol', 'nebivolol', 'lamivudine', 'zidovudine',
].concat(CATEGORIES.flatMap((c) => c.keys.map((k) => k.replace(/\+$/, ''))))); 

/** Map rare misspellings of ingredient names to a much more common close spelling. */
function spellingFixes(raw) {
  const freq = new Map();
  for (const r of raw) {
    const rec = normalizeRecord(r);
    if (!rec) continue;
    for (const n of rec.ingredient_names) freq.set(n, (freq.get(n) || 0) + 1);
  }
  const common = [...freq.entries()].filter(([n, c]) => c >= 8 && n.length >= 6);
  const renames = new Map();
  for (const [name, count] of freq) {
    if (count >= 5 || name.length < 6) continue;
    if (/^vitamin\b/.test(name) || KNOWN_DRUGS.has(name) || KNOWN_DRUGS.has(name.split(' ')[0])) continue;
    const max = name.length >= 9 ? 2 : 1;
    let best = null;
    for (const [cand, cc] of common) {
      if (cand === name || cc < count * 10 || cand[0] !== name[0] || Math.abs(cand.length - name.length) > max) continue;
      const d = editDistance(name, cand, max);
      if (d <= max && (!best || d < best.d || (d === best.d && cc > best.cc))) best = { cand, d, cc };
    }
    if (best) renames.set(name, best.cand);
  }
  return renames;
}

/** Normalize raw DRAP rows into the compact dataset format. Pure (no I/O). */
function buildFromRaw(raw, hints, now) {

  // Pass 1: find misspelled ingredient names (e.g. "ceftrixone") and map them to the
  // common spelling, so those products join the right alternative group.
  const renames = spellingFixes(raw);

  // Pass 2: normalize + de-duplicate (same registration + pack -> keep latest effective price)
  const byKey = new Map();
  let skipped = 0;
  for (const r of raw) {
    const rec = normalizeRecord(r, renames);
    if (!rec) { skipped++; continue; }
    const key = `${rec.reg}|${rec.product.toLowerCase()}|${rec.pack.toLowerCase()}`;
    const prev = byKey.get(key);
    if (!prev || (rec.effective || '') > (prev.effective || '')) byKey.set(key, rec);
  }
  let records = [...byKey.values()];

  // Hints: popular brands & synonyms
  hints = hints || { popular: [], synonyms: {} };
  const popularSet = new Set(hints.popular.map((s) => s.toLowerCase()));

  // Drop pack-size parsing outliers from groups (a "1/10th price" is almost always a
  // mis-read pack, and would show a misleading saving).
  const members = new Map();
  records.forEach((r) => r.group && (members.get(r.group) || members.set(r.group, []).get(r.group)).push(r));
  let outliers = 0;
  for (const list of members.values()) {
    if (list.length < 3) continue;
    const prices = list.map((r) => r.unit_price).sort((a, b) => a - b);
    const med = prices[Math.floor(prices.length / 2)];
    for (const r of list) {
      if (r.unit_price < med / 6 || r.unit_price > med * 6) {
        r.group = '';
        outliers++;
      }
    }
  }
  if (outliers) console.log(`Ungrouped ${outliers} price outliers`);

  // Group sizes -> only keep group ids that actually have >1 product
  const groupCounts = new Map();
  records.forEach((r) => r.group && groupCounts.set(r.group, (groupCounts.get(r.group) || 0) + 1));

  records.sort((a, b) => a.name.localeCompare(b.name) || a.unit_price - b.unit_price);

  // Compact, columnar output keeps the download small (~gzip friendly)
  const groupIds = [];
  const groupIndex = new Map();
  const mfrs = [];
  const mfrIndex = new Map();
  const forms = [];
  const formIndex = new Map();
  const intern = (list, index, v) => {
    if (!index.has(v)) { index.set(v, list.length); list.push(v); }
    return index.get(v);
  };

  const rows = records.map((r, i) => {
    const g = r.group && groupCounts.get(r.group) > 1 ? intern(groupIds, groupIndex, r.group) : -1;
    const popular = popularSet.has(r.name.toLowerCase()) || popularSet.has(r.name.split(' ')[0].toLowerCase()) ? 1 : 0;
    return [
      r.reg || String(i),
      r.product,
      r.name,
      r.generic,
      r.strength,
      intern(forms, formIndex, r.form),
      r.pack,
      r.units,
      r.unit,
      r.price,
      intern(mfrs, mfrIndex, r.manufacturer),
      r.category,
      r.effective,
      g,
      popular,
      r.salt_key,
    ];
  });

  const syncedAt = (now || new Date()).toISOString();
  const today = syncedAt.slice(0, 10);
  // Some DRAP prices are notified ahead of time; "latest" = most recent date not in the future
  const effectiveDates = records.map((r) => r.effective).filter((d) => d && d <= today).sort();
  const out = {
    meta: {
      source: 'Drug Regulatory Authority of Pakistan - Pharmaceutical Product Price Index',
      source_url: BASE_URL,
      synced_at: syncedAt,
      products: rows.length,
      alternative_groups: groupIds.length,
      latest_price_date: effectiveDates[effectiveDates.length - 1] || '',
      note: 'Prices are DRAP-notified maximum retail prices (MRP) in PKR. Always confirm with a pharmacist.',
    },
    categories: CATEGORIES.map((c) => ({ id: c.id, en: c.en, ur: c.ur, icon: c.icon })).concat([{ id: 'other', en: 'Other', ur: 'دیگر', icon: 'pill' }]),
    synonyms: hints.synonyms,
    fields: ['reg', 'product', 'name', 'generic', 'strength', 'form', 'pack', 'units', 'unit', 'price', 'manufacturer', 'category', 'effective', 'group', 'popular', 'salt_key'],
    forms,
    manufacturers: mfrs,
    groups: groupIds,
    rows,
  };

  return { out, skipped };
}

async function main() {
  if (!BUILD_ONLY) await crawl();
  build();
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { parsePage, lastPageNumber, build, buildFromRaw };
