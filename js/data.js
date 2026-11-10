/**
 * Sasta Dawa Finder - dataset loader.
 * Expands the compact columnar data/medicines.json into medicine objects.
 * Works in the browser (window.SDData) and in Node (require).
 */
(function (root, factory) {
  const lib = factory();
  if (typeof module === 'object' && module.exports) module.exports = lib;
  if (typeof window !== 'undefined') window.SDData = lib;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function slug(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
  }

  /** Expand compact JSON into a ready-to-use dataset. */
  function expand(json) {
    if (!json || !Array.isArray(json.rows) || !Array.isArray(json.fields)) {
      throw new Error('Invalid medicines dataset');
    }
    const F = {};
    json.fields.forEach((f, i) => (F[f] = i));
    const items = new Array(json.rows.length);
    const groups = new Map();
    const bySalt = new Map();
    const byId = new Map();

    // Ids must not depend on row order, or a price fix / saved medicine could move to another
    // pack after a data update. One registration number can cover several packs, so those
    // ids also include the pack (e.g. "...-023533-60ml"); a counter is only the last resort.
    // (each slug is computed once: this runs for ~22k rows on every page load)
    const n = json.rows.length;
    const bases = new Array(n);
    const baseCount = new Map();
    for (let i = 0; i < n; i++) {
      const r = json.rows[i];
      const b = slug(r[F.product]) + '-' + slug(r[F.reg] || String(i));
      bases[i] = b;
      baseCount.set(b, (baseCount.get(b) || 0) + 1);
    }
    const packIds = new Array(n);
    const packIdCount = new Map();
    for (let i = 0; i < n; i++) {
      const p = baseCount.get(bases[i]) > 1 ? bases[i] + '-' + (slug(json.rows[i][F.pack]) || 'pack') : bases[i];
      packIds[i] = p;
      packIdCount.set(p, (packIdCount.get(p) || 0) + 1);
    }
    const taken = new Map();
    const legacy = new Map(); // old order-based ids ("-2", "-3") -> medicine, for links shared before
    const legacySeen = new Map();

    json.rows.forEach((r, idx) => {
      const groupIdx = r[F.group];
      const product = r[F.product];
      const base = bases[idx];
      let id = packIds[idx];
      // DRAP occasionally lists the same registration + pack twice at different prices
      if (packIdCount.get(id) > 1) id = id + '-rs' + slug(String(r[F.price]));
      if (taken.has(id)) {
        const n = taken.get(id) + 1;
        taken.set(id, n);
        id = id + '-' + n;
      } else {
        taken.set(id, 1);
      }
      const nLegacy = (legacySeen.get(base) || 0) + 1;
      legacySeen.set(base, nLegacy);
      const legacyId = nLegacy === 1 ? base : base + '-' + nLegacy;
      const units = Number(r[F.units]) || 1;
      const price = Number(r[F.price]) || 0;
      const med = {
        id,
        idx,
        reg: r[F.reg],
        product,
        name: r[F.name],
        generic: r[F.generic],
        strength: r[F.strength],
        form: json.forms[r[F.form]] || '',
        pack: r[F.pack],
        units,
        unit: r[F.unit],
        price,
        unitPrice: units > 0 ? price / units : price,
        manufacturer: json.manufacturers[r[F.manufacturer]] || '',
        category: r[F.category],
        effective: r[F.effective],
        group: groupIdx >= 0 ? json.groups[groupIdx] : '',
        popular: r[F.popular] === 1,
        saltKey: r[F.salt_key] || '',
      };
      items[idx] = med;
      byId.set(id, med);
      if (legacyId !== id) legacy.set(legacyId, med);
      if (med.group) {
        if (!groups.has(med.group)) groups.set(med.group, []);
        groups.get(med.group).push(med);
      }
      if (med.saltKey) {
        if (!bySalt.has(med.saltKey)) bySalt.set(med.saltKey, []);
        bySalt.get(med.saltKey).push(med);
      }
    });

    // keep old ids working only where they don't clash with a current id
    const aliases = new Map();
    for (const [old, med] of legacy) if (!byId.has(old)) aliases.set(old, med);

    return {
      meta: json.meta || {},
      categories: json.categories || [],
      synonyms: json.synonyms || {},
      items,
      byId,
      aliases,
      groups,
      bySalt,
    };
  }

  /**
   * Apply admin price corrections: { id: { price } } sets a new pack price,
   * { id: { hidden: true } } removes the product. Returns how many were applied.
   * Call before creating the search engine.
   */
  function applyOverrides(ds, overrides) {
    if (!ds || !overrides || typeof overrides !== 'object') return 0;
    let applied = 0;
    for (const [id, o] of Object.entries(overrides)) {
      const med = ds.byId.get(id) || (ds.aliases && ds.aliases.get(id));
      if (!med || !o) continue;
      if (o.hidden) {
        med._hidden = true;
        applied++;
      } else if (typeof o.price === 'number' && o.price > 0) {
        med.drapPrice = med.price;
        med.price = o.price;
        med.unitPrice = med.units > 0 ? o.price / med.units : o.price;
        med.corrected = true;
        applied++;
      }
    }
    if (ds.items.some((m) => m._hidden)) {
      ds.items = ds.items.filter((m) => !m._hidden);
      for (const [id, m] of [...ds.byId]) if (m._hidden) ds.byId.delete(id);
      if (ds.aliases) for (const [id, m] of [...ds.aliases]) if (m._hidden) ds.aliases.delete(id);
      for (const map of [ds.groups, ds.bySalt]) {
        for (const [k, list] of [...map]) {
          const kept = list.filter((m) => !m._hidden);
          if (kept.length) map.set(k, kept);
          else map.delete(k);
        }
      }
    }
    return applied;
  }

  async function load(url) {
    const res = await fetch(url || 'data/medicines.json');
    if (!res.ok) throw new Error('Could not load medicine data (' + res.status + ')');
    const json = await res.json();
    // let the browser paint (spinner, taps) between parsing and building the list
    await new Promise((resolve) => setTimeout(resolve, 0));
    return expand(json);
  }

  return { expand, load, slug, applyOverrides };
});
