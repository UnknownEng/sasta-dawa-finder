/**
 * Sasta Dawa Finder - search & comparison engine.
 * Pure logic over the expanded dataset (see js/data.js). Shared by the browser
 * app, the offline assistant and the server-side AI chat tools.
 */
(function (root, factory) {
  const lib = factory();
  if (typeof module === 'object' && module.exports) module.exports = lib;
  if (typeof window !== 'undefined') window.SDSearch = lib;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CONSUMER_FORMS = /tablet|capsule|syrup|suspension|drops|sachet|cream|ointment|gel|inhaler/i;

  function normalize(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9؀-ۿ%.+\s-]/g, ' ')
      .replace(/(\d)\s+(mg|mcg|g|ml|iu)\b/g, '$1$2')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function tokens(s) {
    return normalize(s).split(/[\s+\-]+/).filter(Boolean);
  }

  // Bounded Levenshtein distance (returns max+1 when exceeded)
  function editDistance(a, b, max) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      let rowMin = i;
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (cur[j] < rowMin) rowMin = cur[j];
      }
      if (rowMin > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  }

  function median(nums) {
    if (!nums.length) return 0;
    const s = [...nums].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function createEngine(dataset) {
    const items = dataset.items;

    // --- Synonyms: alias -> canonical generic word(s)
    const alias = new Map();
    Object.entries(dataset.synonyms || {}).forEach(([generic, list]) => {
      (list || []).forEach((a) => {
        const k = normalize(a);
        if (k && k !== normalize(generic)) alias.set(k, normalize(generic));
      });
    });
    [['acetaminophen', 'paracetamol'], ['apap', 'paracetamol'], ['albuterol', 'salbutamol'], ['dipyrone', 'metamizole'],
      ['novaminsulfon', 'metamizole'], ['analgin', 'metamizole'], ['asa', 'aspirin'], ['co-amoxiclav', 'amoxicillin clavulanic'],
      ['coamoxiclav', 'amoxicillin clavulanic'], ['scopolamine', 'hyoscine'], ['vit', 'vitamin'], ['frusemide', 'furosemide'],
      ['amoxycillin', 'amoxicillin'], ['lignocaine', 'lidocaine'], ['paracetamole', 'paracetamol']]
      .forEach(([a, c]) => alias.set(a, c));

    // --- Precomputed haystacks
    const hay = items.map((m) => ({
      name: normalize(m.name),
      product: normalize(m.product),
      generic: normalize(m.generic),
      strength: normalize(m.strength).replace(/\s/g, ''),
      form: normalize(m.form),
      mfr: normalize(m.manufacturer),
    }));

    // name / generic indexes for entity extraction (assistant)
    const nameIndex = new Map();
    const genericIndex = new Map();
    items.forEach((m, i) => {
      const n = hay[i].name;
      if (n.length >= 3) {
        if (!nameIndex.has(n)) nameIndex.set(n, []);
        nameIndex.get(n).push(m);
        const first = n.split(' ')[0];
        if (first.length >= 4 && first !== n) {
          if (!nameIndex.has(first)) nameIndex.set(first, []);
          nameIndex.get(first).push(m);
        }
      }
      hay[i].generic.split(/\s*\+\s*/).forEach((g) => {
        const key = g.trim();
        if (key.length < 4) return;
        if (!genericIndex.has(key)) genericIndex.set(key, []);
        genericIndex.get(key).push(m);
        const first = key.split(' ')[0];
        if (first.length >= 5 && first !== key) {
          if (!genericIndex.has(first)) genericIndex.set(first, []);
          genericIndex.get(first).push(m);
        }
      });
    });
    const nameKeys = [...nameIndex.keys()];
    const genericKeys = [...genericIndex.keys()];

    function expandToken(t) {
      const out = [t];
      if (alias.has(t)) out.push(...alias.get(t).split(' '));
      return out;
    }

    function scoreToken(h, t) {
      // returns best score for a single token against one item
      if (/^\d+(\.\d+)?(mg|mcg|g|ml|iu|%)?$/.test(t)) {
        if (h.strength === t || h.strength.startsWith(t + '+') || new RegExp('(^|\\+)' + t.replace('.', '\\.') + '(mg|mcg|g|ml|iu|%)?(\\b|\\+|/|$)').test(h.strength)) return 25;
        if (h.product.includes(t)) return 15;
        return 0;
      }
      if (h.name === t) return 100;
      if (h.name.startsWith(t)) return 85 - Math.min(10, h.name.length - t.length);
      if ((' ' + h.name).includes(' ' + t)) return 70;
      if ((' ' + h.generic).includes(' ' + t)) return h.generic.startsWith(t) ? 60 : 52;
      if (h.product.includes(t)) return 45;
      if (t.length >= 4 && h.generic.includes(t)) return 40;
      if (t.length >= 3 && h.form.startsWith(t)) return 12;
      if (t.length >= 4 && h.mfr.includes(t)) return 10;
      return 0;
    }

    /**
     * Search medicines. Returns [{ med, score }] sorted best-first.
     */
    function search(query, opts) {
      const o = opts || {};
      const limit = o.limit || 50;
      const qt = tokens(query);
      if (!qt.length) return [];
      const expanded = qt.map(expandToken);
      const res = [];
      for (let i = 0; i < items.length; i++) {
        const m = items[i];
        if (o.category && m.category !== o.category) continue;
        const h = hay[i];
        let total = 0;
        let ok = true;
        for (const variants of expanded) {
          let best = 0;
          for (const v of variants) best = Math.max(best, scoreToken(h, v));
          if (best === 0) { ok = false; break; }
          total += best;
        }
        if (!ok) continue;
        if (m.popular) total += 14;
        if (CONSUMER_FORMS.test(m.form)) total += 4;
        res.push({ med: m, score: total });
      }
      res.sort((a, b) => b.score - a.score || a.med.name.localeCompare(b.med.name) || a.med.unitPrice - b.med.unitPrice);
      return res.slice(0, limit);
    }

    /** Autocomplete suggestions: distinct products, compact. */
    function suggest(query, limit) {
      const results = search(query, { limit: 60 });
      const out = [];
      const seen = new Set();
      for (const r of results) {
        const key = r.med.name + '|' + r.med.strength + '|' + r.med.form;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(r.med);
        if (out.length >= (limit || 8)) break;
      }
      return out;
    }

    /** "Did you mean" for misspelled queries. */
    function didYouMean(query, limit) {
      const q = normalize(query).split(' ')[0] || '';
      if (q.length < 4) return [];
      const max = q.length >= 8 ? 2 : 1;
      const found = [];
      const consider = (keys, kind) => {
        for (const k of keys) {
          const head = k.slice(0, q.length + max);
          const d = Math.min(editDistance(q, k, max), editDistance(q, head, max));
          if (d <= max) found.push({ term: k, d, kind });
        }
      };
      consider(nameKeys, 'brand');
      consider(genericKeys, 'generic');
      found.sort((a, b) => a.d - b.d || a.term.length - b.term.length);
      const uniq = [];
      const seen = new Set();
      for (const f of found) {
        if (seen.has(f.term)) continue;
        seen.add(f.term);
        uniq.push(f.term);
        if (uniq.length >= (limit || 5)) break;
      }
      return uniq;
    }

    function byId(id) {
      return dataset.byId.get(id) || (dataset.aliases && dataset.aliases.get(id)) || null;
    }

    /** "5'sx4ml", "5 's x 4 ml" and "5S X4ML" are the same pack. */
    function packKey(p) {
      return String(p || '').toLowerCase().replace(/[\s'’`´"]/g, '').replace(/x/g, '*');
    }

    /**
     * Can `a` and `b` be compared on price? Counted packs (tablets, ml, doses) compare per unit.
     * When a pack couldn't be counted (unit 'pack', e.g. "5*4ml" ampoules or an inhaler), the
     * "unit price" is the whole pack, so it only compares with exactly the same pack.
     */
    function comparable(a, b) {
      if (a.unit === 'pack' || b.unit === 'pack') return a.unit === b.unit && packKey(a.pack) === packKey(b.pack);
      return a.unit === b.unit;
    }

    /** Same formula (ingredients, strength, form) and a comparable pack. Includes `med`. */
    function alternatives(med, sort) {
      if (!med || !med.group) return med ? [med] : [];
      const list = (dataset.groups.get(med.group) || [med]).filter((m) => m === med || comparable(m, med));
      const s = sort || 'unit';
      list.sort((a, b) => {
        if (s === 'pack') return a.price - b.price;
        if (s === 'name') return a.name.localeCompare(b.name);
        if (s === 'recent') return String(b.effective).localeCompare(String(a.effective));
        return a.unitPrice - b.unitPrice || a.price - b.price;
      });
      return list;
    }

    function cheapest(med) {
      const alts = alternatives(med, 'unit');
      return alts[0] || med;
    }

    function savings(med) {
      const c = cheapest(med);
      if (!c || c === med || c.unitPrice >= med.unitPrice) return null;
      const perUnit = med.unitPrice - c.unitPrice;
      return {
        cheapest: c,
        perUnit,
        percent: Math.round((perUnit / med.unitPrice) * 100),
        perPack: perUnit * med.units,
      };
    }

    /** Other strengths / forms of the same salt combination. */
    function strengths(med) {
      if (!med || !med.saltKey) return [];
      const list = dataset.bySalt.get(med.saltKey) || [];
      const map = new Map();
      for (const m of list) {
        if (m.group && m.group === med.group) continue;
        if (!m.group && m.id === med.id) continue;
        const key = m.group || m.strength + '|' + m.form;
        const prev = map.get(key);
        if (!prev || m.unitPrice < prev.med.unitPrice) map.set(key, { med: m, count: (prev ? prev.count : 0) + 1 });
        else prev.count++;
      }
      return [...map.values()]
        .sort((a, b) => String(a.med.form).localeCompare(String(b.med.form)) || parseFloat(a.med.strength) - parseFloat(b.med.strength))
        .slice(0, 16);
    }

    function groupSummary(med) {
      const alts = alternatives(med, 'unit');
      const prices = alts.map((a) => a.unitPrice);
      return {
        count: alts.length,
        min: prices.length ? Math.min(...prices) : med.unitPrice,
        max: prices.length ? Math.max(...prices) : med.unitPrice,
        median: median(prices),
        cheapest: alts[0] || med,
      };
    }

    /** Medicine "families" (same formula) in a category. */
    function categoryFamilies(catId, opts) {
      const o = opts || {};
      const filter = normalize(o.filter || '');
      const fam = new Map();
      for (const m of items) {
        if (m.category !== catId) continue;
        if (o.form && m.form !== o.form) continue;
        if (filter && !normalize(m.generic + ' ' + m.name).includes(filter)) continue;
        const key = m.group || 'solo:' + m.id;
        let f = fam.get(key);
        if (!f) {
          f = { key, generic: m.generic, strength: m.strength, form: m.form, unit: m.unit, members: [], popular: false };
          fam.set(key, f);
        }
        f.members.push(m);
        if (m.popular) f.popular = true;
      }
      const out = [...fam.values()].map((f) => {
        f.members.sort((a, b) => a.unitPrice - b.unitPrice);
        f.cheapest = f.members[0];
        f.min = f.members[0].unitPrice;
        f.max = f.members[f.members.length - 1].unitPrice;
        f.count = f.members.length;
        f.consumer = CONSUMER_FORMS.test(f.form);
        return f;
      });
      out.sort((a, b) => (b.popular - a.popular) || (b.consumer - a.consumer) || b.count - a.count || a.generic.localeCompare(b.generic));
      return out;
    }

    function categoryForms(catId) {
      const counts = new Map();
      for (const m of items) if (m.category === catId) counts.set(m.form, (counts.get(m.form) || 0) + 1);
      return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([form, count]) => ({ form, count }));
    }

    function categoryCounts() {
      const counts = new Map();
      for (const m of items) counts.set(m.category, (counts.get(m.category) || 0) + 1);
      return counts;
    }

    /** Popular medicines with the biggest same-formula savings. */
    function topSavings(limit) {
      const seenGroups = new Set();
      const out = [];
      const candidates = items.filter((m) => m.popular && m.group && CONSUMER_FORMS.test(m.form));
      for (const m of candidates) {
        const s = savings(m);
        if (!s || s.percent < 15) continue;
        out.push({ med: m, s });
      }
      out.sort((a, b) => b.s.percent - a.s.percent);
      const res = [];
      for (const x of out) {
        if (seenGroups.has(x.med.group)) continue;
        seenGroups.add(x.med.group);
        res.push(x);
        if (res.length >= (limit || 8)) break;
      }
      return res;
    }

    function popular(limit) {
      const seen = new Set();
      const out = [];
      for (const m of items) {
        if (!m.popular || !CONSUMER_FORMS.test(m.form)) continue;
        if (seen.has(m.name)) continue;
        seen.add(m.name);
        out.push(m);
      }
      out.sort((a, b) => (dataset.groups.get(b.group) || []).length - (dataset.groups.get(a.group) || []).length);
      return out.slice(0, limit || 10);
    }

    /**
     * Pick the best product for a set of candidates, using hints from the text
     * (e.g. "panadol 500", "augmentin syrup").
     */
    function pickBest(cands, text) {
      if (!cands || !cands.length) return null;
      const t = normalize(text || '');
      const nums = (t.match(/\d+(\.\d+)?/g) || []).map(Number);
      const formHint = /syrup|syp|sharbat|شربت/.test(t) ? 'syrup' : /susp/.test(t) ? 'suspension' : /drop/.test(t) ? 'drops' : /inj|teeka|injection/.test(t) ? 'injection' : /cream|ointment|gel|marham/.test(t) ? 'cream' : /cap/.test(t) ? 'capsule' : /tab|goli/.test(t) ? 'tablet' : '';
      let best = null;
      let bestScore = -Infinity;
      for (const m of cands) {
        let s = 0;
        const sv = parseFloat(m.strength);
        if (nums.length && nums.some((n) => n === sv || m.strength.includes(String(n)))) s += 30;
        if (formHint && m.form.toLowerCase().includes(formHint)) s += 25;
        if (!formHint && /tablet|capsule/i.test(m.form)) s += 8;
        if (CONSUMER_FORMS.test(m.form)) s += 5;
        if (m.popular) s += 6;
        s += Math.min(10, (dataset.groups.get(m.group) || []).length / 3);
        if (s > bestScore) { bestScore = s; best = m; }
      }
      return best;
    }

    /**
     * Find medicine mentions in free text. Returns
     * [{ term, kind: 'brand'|'generic', items, best }] in order of appearance.
     */
    function findInText(text) {
      const raw = normalize(text);
      const words = raw.split(' ').filter(Boolean);
      const STOP = new Set(['the', 'and', 'for', 'price', 'cost', 'what', 'is', 'of', 'me', 'my', 'a', 'an', 'to', 'in', 'ki', 'ka', 'ke', 'kya', 'hai', 'he', 'tablet', 'tablets', 'tab', 'syrup', 'capsule', 'injection', 'medicine', 'dawa', 'dawai', 'goli', 'cheaper', 'cheap', 'sasta', 'sasti', 'alternative', 'alternatives', 'generic', 'compare', 'vs', 'or', 'ya', 'with', 'than', 'instead', 'formula', 'salt', 'price', 'qeemat', 'kitne', 'kitna', 'kitni', 'add', 'list', 'show', 'tell', 'about', 'please', 'plz', 'mujhe', 'batao', 'bataen', 'chahiye', 'option', 'options', 'brand', 'brands', 'same', 'other', 'any', 'how', 'much', 'rs', 'rupees', 'pkr', 'mg', 'ml', 'per', 'pack', 'box', 'need', 'want', 'buy', 'find', 'search', 'better', 'best', 'which', 'where', 'can', 'i', 'get', 'use', 'used', 'uses', 'doctor', 'prescribed', 'wala', 'wali', 'walay', 'se', 'sy', 'aur', 'or', 'bhi', 'koi', 'hain', 'hy', 'available', 'pakistan', 'tell', 'mein', 'main', 'mai', 'k', 'liye', 'liay', 'lye',
        'dose', 'doses', 'dosage', 'unit', 'units', 'side', 'effect', 'effects', 'safe', 'take', 'taking', 'child', 'children', 'baby', 'kids',
        'day', 'daily', 'time', 'times', 'morning', 'night', 'water', 'food', 'after', 'before', 'pregnancy', 'women', 'woman', 'adult',
        'this', 'that', 'it', 'are', 'was', 'should', 'would', 'could', 'will', 'have', 'has', 'had', 'been', 'do', 'does', 'did', 'give',
        'also', 'very', 'many', 'more', 'less', 'then', 'when', 'who', 'why', 'ilaj', 'bimari', 'salam', 'salaam', 'assalam', 'hello', 'thanks',
        'thank', 'shukriya', 'please', 'mera', 'meri', 'mere', 'hum', 'aap', 'ap', 'yeh', 'ye', 'woh', 'wo', 'kaise', 'kaisa', 'kab', 'kahan',
        'pain', 'dard', 'fever', 'bukhar', 'cough', 'cold', 'sugar', 'acidity', 'virus', 'antigen', 'vaccine', 'strain', 'oral', 'solution',
        'powder', 'cream', 'drops', 'injection', 'infusion', 'suspension', 'sachet', 'gel', 'ointment', 'lotion', 'spray', 'plus', 'forte', 'extra']);
      const found = [];
      const used = new Array(words.length).fill(false);
      for (let n = 3; n >= 1; n--) {
        for (let i = 0; i + n <= words.length; i++) {
          if (used.slice(i, i + n).some(Boolean)) continue;
          const phrase = words.slice(i, i + n).join(' ');
          if (n === 1 && (STOP.has(phrase) || phrase.length < 3 || /^\d/.test(phrase))) continue;
          const canonical = alias.get(phrase) || phrase;
          let hit = null;
          if (n === 1 && STOP.has(canonical)) continue;
          if (genericIndex.has(canonical)) hit = { kind: 'generic', items: genericIndex.get(canonical) };
          else if (nameIndex.has(canonical)) hit = { kind: 'brand', items: nameIndex.get(canonical) };
          if (hit) {
            for (let k = i; k < i + n; k++) used[k] = true;
            found.push({ term: phrase, pos: i, ...hit });
          }
        }
      }
      // Fuzzy pass for leftover longer words (typos like "panadool", "augmentn")
      words.forEach((w, i) => {
        if (used[i] || STOP.has(w) || w.length < 6 || /\d/.test(w)) return;
        const max = w.length >= 8 ? 2 : 1;
        let best = null;
        for (const k of nameKeys) {
          if (Math.abs(k.length - w.length) > max || k[0] !== w[0]) continue;
          const d = editDistance(w, k, max);
          if (d <= max && (!best || d < best.d)) best = { k, d, kind: 'brand' };
        }
        if (!best) {
          for (const k of genericKeys) {
            if (Math.abs(k.length - w.length) > max || k[0] !== w[0]) continue;
            const d = editDistance(w, k, max);
            if (d <= max && (!best || d < best.d)) best = { k, d, kind: 'generic' };
          }
        }
        if (best) {
          used[i] = true;
          found.push({ term: best.k, pos: i, kind: best.kind, fuzzy: true, items: (best.kind === 'brand' ? nameIndex : genericIndex).get(best.k) });
        }
      });
      found.sort((a, b) => a.pos - b.pos);
      // Pick a best product per mention using nearby words as hints
      return found.map((f) => {
        const ctx = words.slice(Math.max(0, f.pos - 1), f.pos + 4).join(' ');
        return { term: f.term, kind: f.kind, fuzzy: !!f.fuzzy, items: f.items, best: pickBest(f.items, ctx) };
      });
    }

    function stats() {
      return {
        products: items.length,
        groups: dataset.groups.size,
        manufacturers: new Set(items.map((m) => m.manufacturer)).size,
      };
    }

    return {
      search,
      suggest,
      didYouMean,
      byId,
      alternatives,
      cheapest,
      savings,
      strengths,
      groupSummary,
      categoryFamilies,
      categoryForms,
      categoryCounts,
      topSavings,
      popular,
      pickBest,
      findInText,
      stats,
      normalize,
    };
  }

  return { createEngine, normalize, editDistance };
});
