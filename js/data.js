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
    const seen = new Map();
    const items = new Array(json.rows.length);
    const groups = new Map();
    const bySalt = new Map();
    const byId = new Map();

    json.rows.forEach((r, idx) => {
      const groupIdx = r[F.group];
      const product = r[F.product];
      let id = slug(product) + '-' + slug(r[F.reg] || String(idx));
      if (seen.has(id)) {
        const n = seen.get(id) + 1;
        seen.set(id, n);
        id = id + '-' + n;
      } else {
        seen.set(id, 1);
      }
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
      if (med.group) {
        if (!groups.has(med.group)) groups.set(med.group, []);
        groups.get(med.group).push(med);
      }
      if (med.saltKey) {
        if (!bySalt.has(med.saltKey)) bySalt.set(med.saltKey, []);
        bySalt.get(med.saltKey).push(med);
      }
    });

    return {
      meta: json.meta || {},
      categories: json.categories || [],
      synonyms: json.synonyms || {},
      items,
      byId,
      groups,
      bySalt,
    };
  }

  async function load(url) {
    const res = await fetch(url || 'data/medicines.json');
    if (!res.ok) throw new Error('Could not load medicine data (' + res.status + ')');
    return expand(await res.json());
  }

  return { expand, load, slug };
});
