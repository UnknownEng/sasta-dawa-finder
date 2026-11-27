/**
 * Sasta Dawa Finder - find medicines in text read from a photo (on-device OCR).
 * Pure logic: takes the OCR text and our dataset + search engine (js/data.js, js/search.js)
 * and returns only high-confidence brand matches. Works in the browser (window.SDOcrMatch)
 * and in Node (require), like js/search.js.
 *
 *   SDOcrMatch.match(text, { ds, engine, normalize, editDistance }) -> [{ med, read, strength, score, exact, line, generic }]
 */
(function (root, factory) {
  const lib = factory();
  if (typeof module === 'object' && module.exports) module.exports = lib;
  if (typeof window !== 'undefined') window.SDOcrMatch = lib;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_RESULTS = 12;
  const STRENGTH = /^(\d+(?:\.\d+)?)(mg|mcg|g|ml|iu|%)?$/;
  // Words that appear on prescriptions and packs but are never what the user is looking for,
  // even when some product happens to carry that name.
  const STOP = new Set(('tab tabs tablet tablets cap caps capsule capsules syp syrup susp suspension inj injection drops drop cream gel ' +
    'ointment sachet oral film coated water daily once twice after before meal meals food morning night evening days week weeks ' +
    'month continue review follow visit next doctor clinic hospital medical centre center road street phone cell mobile date name ' +
    'patient signature sign stamp diagnosis advice rest fluids plenty avoid male female years weight pulse temp mbbs fcps frcs mrcp ' +
    'consultant physician general surgeon specialist pharmacy pharma pharmaceutical pharmaceuticals laboratories limited private ' +
    'pakistan karachi lahore islamabad rawalpindi peshawar quetta multan faisalabad batch expiry price retail registered reg ' +
    'manufactured marketed store keep reach children directions dosage warning only prescription each contains spoon teaspoon ' +
    'plus forte extra total paid cash').split(' '));
  const FORM_HINT = /\b(tab|tabs|tablet|tablets|cap|caps|capsule|capsules|syp|syrup|susp|suspension|inj|injection|drops?|cream|gel|sachet)\b/;

  // Per-dataset name index, built once (the dataset has ~22k products, ~10k brand names).
  const cache = typeof WeakMap === 'function' ? new WeakMap() : null;

  function defaultNormalize(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9.%+\s-]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function buildIndex(ds, norm) {
    if (cache && cache.has(ds)) return cache.get(ds);
    const full = new Map(); // "panadol extra" -> [meds]
    const first = new Map(); // "abhayrab" -> [meds] (first word of multi-word names only)
    const generics = new Set();
    for (const m of ds.items) {
      const n = norm(m.name).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
      if (n.length >= 4 && /^[a-z]/.test(n)) {
        if (!full.has(n)) full.set(n, []);
        full.get(n).push(m);
        const w = n.split(' ');
        if (w.length > 1 && w[0].length >= 5) {
          if (!first.has(w[0])) first.set(w[0], []);
          first.get(w[0]).push(m);
        }
      }
      String(m.generic || '').split('+').forEach((g) => {
        const k = norm(g).split(' ')[0];
        if (k && k.length >= 5) generics.add(k);
      });
    }
    // single-word keys for the fuzzy pass, bucketed by length
    const byLen = new Map();
    for (const k of new Set([...full.keys(), ...first.keys()])) {
      if (k.includes(' ') || k.length < 6) continue;
      if (!byLen.has(k.length)) byLen.set(k.length, []);
      byLen.get(k.length).push(k);
    }
    const idx = { full, first, generics, byLen };
    if (cache) cache.set(ds, idx);
    return idx;
  }

  /** One OCR line -> { words: [{ w, raw }], nums: [500, 625] } */
  function parseLine(line) {
    const s = String(line || '')
      .toLowerCase()
      .replace(/[|]/g, ' ')
      // OCR reads digits in a dose as letters: "SOO mg" -> "500mg", "2O mg" -> "20mg"
      .replace(/\b([0-9osilz]{2,5})(\s*)(mg|mcg|ml)\b/g, (all, n, sp, u) => (/^[0-9]/.test(n) || /^[os]/.test(n) ? n.replace(/o/g, '0').replace(/s/g, '5').replace(/[il]/g, '1').replace(/z/g, '2') + u : all))
      .replace(/(\d)\s+(mg|mcg|ml|iu)\b/g, '$1$2')
      .replace(/[^a-z0-9.%+/\s]/g, ' ');
    const words = [];
    const nums = [];
    for (let tok of s.split(/[\s/+]+/)) {
      tok = tok.replace(/^\.+|\.+$/g, '');
      if (!tok) continue;
      // "augmentin625" / "risek20mg"
      const glued = /^([a-z]{4,})(\d+(?:\.\d+)?(?:mg|mcg|ml|iu)?)$/.exec(tok);
      if (glued) {
        words.push({ w: glued[1], raw: glued[1] });
        tok = glued[2];
      }
      const sm = STRENGTH.exec(tok);
      if (sm) {
        const v = parseFloat(sm[1]);
        // bare numbers count only when they look like a dose (not "1", "2" from 1+1+1 or "3 days")
        // and not phone numbers / dates ("0300", "2026")
        if (sm[2] || (v >= 10 && v <= 2000 && !/^0/.test(sm[1]))) nums.push(v);
        continue;
      }
      let w = tok;
      const letters = (w.match(/[a-z]/g) || []).length;
      // OCR mixes up look-alike characters inside words: "panad0l", "ri5ek", "f1agyl"
      if (letters >= 3 && /\d/.test(w)) w = w.replace(/0/g, 'o').replace(/1/g, 'l').replace(/5/g, 's').replace(/8/g, 'b');
      w = w.replace(/[^a-z]/g, '');
      if (w) words.push({ w, raw: tok });
    }
    return { words, nums };
  }

  /** Numbers in a product strength: "500mg + 125mg" -> [500, 125, 625] */
  function strengthNums(med) {
    const n = (String(med.strength || '').match(/\d+(\.\d+)?/g) || []).map(Number);
    if (n.length > 1) n.push(n.reduce((a, b) => a + b, 0));
    return n;
  }

  function agrees(med, nums) {
    if (!nums.length) return false;
    const sn = strengthNums(med);
    return nums.some((v) => sn.some((x) => Math.abs(x - v) < 0.001));
  }

  /** Best product for a brand on this line: strength that agrees first, then the engine's own pick. */
  function pickProduct(cands, nums, lineText, engine) {
    const ok = cands.filter((m) => agrees(m, nums));
    let pool = ok.length ? ok : cands;
    const want = /\b(syp|syrup|susp|suspension)\b/.test(lineText) ? /syrup|suspension|solution|elixir/i
      : /\b(cap|caps|capsules?)\b/.test(lineText) ? /capsule/i
        : /\b(tab|tabs|tablets?)\b/.test(lineText) ? /tablet/i
          : /\b(inj|injection)\b/.test(lineText) ? /injection|infusion/i : null;
    if (want && pool.some((m) => want.test(m.form))) pool = pool.filter((m) => want.test(m.form));
    let best = (engine && engine.pickBest ? engine.pickBest(pool, lineText) : pool[0]) || pool[0];
    // several pack sizes of the same product: show the everyday (lowest-priced) pack
    for (const m of pool) {
      if (m.strength === best.strength && m.form === best.form && typeof m.price === 'number' && m.price < best.price) best = m;
    }
    return { med: best, strengthOk: ok.length > 0 };
  }

  function fuzzyKey(w, idx, editDistance) {
    if (w.length < 6 || !editDistance) return null;
    let best = null;
    for (let len = w.length - 1; len <= w.length + 1; len++) {
      for (const k of idx.byLen.get(len) || []) {
        const d = editDistance(w, k, 1);
        if (d <= 1 && (!best || d < best.d || (d === best.d && k[0] === w[0] && best.k[0] !== w[0]))) best = { k, d };
      }
    }
    return best && best.d === 1 ? best.k : null;
  }

  /**
   * Find medicines from our dataset in OCR text.
   * ctx: { ds, engine, normalize?, editDistance?, limit? }
   */
  function match(text, ctx) {
    const c = ctx || {};
    if (!c.ds || !Array.isArray(c.ds.items) || !text) return [];
    const norm = c.normalize || defaultNormalize;
    const idx = buildIndex(c.ds, norm);
    const found = [];
    const lines = String(text).split(/\r?\n/);
    const parsed = lines.map(parseLine);
    // a strength or a form word ("tab", "syrup") on this line or the next/previous one
    const hint = lines.map((l, i) => parsed[i].nums.length > 0 || FORM_HINT.test(l.toLowerCase()));
    lines.forEach((line, li) => {
      const { words } = parsed[li];
      // on a pack the strength is often printed on the line under the name
      const nums = parsed[li].nums.length ? parsed[li].nums : parsed[li + 1] ? parsed[li + 1].nums : [];
      const lineText = line.toLowerCase();
      const hasForm = hint[li] || !!hint[li - 1] || !!hint[li + 1];
      const used = new Array(words.length).fill(false);
      const take = (i, n, key, cands, kind, read) => {
        const p = pickProduct(cands, nums, lineText, c.engine);
        const len = key.replace(/ /g, '').length;
        // High-confidence rule:
        //  - exact name of 6+ letters; shorter names (and the first word of a longer name) need a
        //    strength or form word on the same / next line, or a well-known brand
        //  - one-letter OCR slip only for 6+ letter words, and 8+ letters or a matching strength
        const known = cands.some((m) => m.popular);
        if (kind === 'exact' && len < 6 && !(p.strengthOk || hasForm || known)) return false;
        if (kind === 'first' && !(p.strengthOk || hasForm)) return false;
        if (kind === 'fuzzy' && !(len >= 8 || p.strengthOk)) return false;
        let score = kind === 'exact' ? 100 : kind === 'first' ? 90 : 75;
        if (p.strengthOk) score += 25;
        if (n > 1) score += 5;
        for (let k = i; k < i + n; k++) used[k] = true;
        found.push({ med: p.med, key, read, strength: nums.length ? String(nums[0]) : '', score, exact: kind !== 'fuzzy', strengthOk: p.strengthOk, line: li, pos: i, generic: idx.generics.has(key) && !key.includes(' ') });
        return true;
      };
      // 1) two-word names ("panadol extra", "glucophage xr"), and words split by OCR ("augm entin")
      for (let i = 0; i + 1 < words.length; i++) {
        if (used[i] || used[i + 1]) continue;
        const a = words[i].w;
        const b = words[i + 1].w;
        const pair = a + ' ' + b;
        if (a.length >= 3 && !STOP.has(a) && idx.full.has(pair)) take(i, 2, pair, idx.full.get(pair), 'exact', words[i].raw + ' ' + words[i + 1].raw);
        else if (a.length >= 2 && b.length >= 2 && !STOP.has(a) && !STOP.has(b) && (a + b).length >= 6 && idx.full.has(a + b)) {
          take(i, 2, a + b, idx.full.get(a + b), 'exact', words[i].raw + ' ' + words[i + 1].raw);
        }
      }
      // 2) single words: exact name, then first word of a longer name, then a one-letter OCR slip
      words.forEach((x, i) => {
        if (used[i] || x.w.length < 4 || STOP.has(x.w)) return;
        if (idx.full.has(x.w) && take(i, 1, x.w, idx.full.get(x.w), 'exact', x.raw)) return;
        if (idx.first.has(x.w) && take(i, 1, x.w, idx.first.get(x.w), 'first', x.raw)) return;
        const k = fuzzyKey(x.w, idx, c.editDistance);
        if (k && !STOP.has(k)) take(i, 1, k, idx.full.get(k) || idx.first.get(k), 'fuzzy', x.raw);
      });
    });
    // A word that is also a salt name ("Paracetamol" under "Panadol" on a pack) is only kept
    // when nothing else was found.
    let list = found.some((f) => !f.generic) ? found.filter((f) => !f.generic) : found;
    // One row per brand name, best-scoring first; then in reading order
    const byName = new Map();
    for (const f of list) {
      const k = norm(f.med.name);
      const prev = byName.get(k);
      if (!prev || f.score > prev.score) byName.set(k, f);
    }
    list = [...byName.values()].sort((a, b) => b.score - a.score || a.line - b.line || a.pos - b.pos).slice(0, c.limit || MAX_RESULTS);
    list.sort((a, b) => a.line - b.line || a.pos - b.pos);
    // generic: true = only a salt name was read ("Paracetamol"), no brand
    return list.map((f) => ({ med: f.med, read: f.read, strength: f.strength, score: f.score, exact: f.exact, line: f.line, generic: !!f.generic }));
  }

  return { match, parseLine, MAX_RESULTS };
});
