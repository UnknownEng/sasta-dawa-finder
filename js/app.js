/**
 * Sasta Dawa Finder - application controller (routing, rendering, My Medicines).
 */
(function () {
  'use strict';

  const I18N = window.SDI18n;
  const t = I18N.t;
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => [...(el || document).querySelectorAll(sel)];

  // Inside the Android/iOS app (js/native.js) pages come from the phone, so API calls and
  // share links point at the live site. On the website NATIVE is null and nothing changes.
  const NATIVE = window.SDNative || null;
  const apiUrl = (p) => (NATIVE ? NATIVE.apiUrl(p) : p);
  const canUseApi = () => !!NATIVE || location.protocol.startsWith('http');

  const state = {
    ds: null,
    engine: null,
    reg: null, // registered brands without a DRAP price (data/registry.json), loaded after start-up
    route: { name: 'home' },
    lastQuery: '',
    suggestions: [],
    activeSuggestion: -1,
    categoryLimit: 30,
    altSort: 'unit',
  };

  // ------------------------------------------------------------------------
  // Storage helpers (never throw)
  // ------------------------------------------------------------------------
  function store(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
  }

  // ------------------------------------------------------------------------
  // Signed-in account (shared with the account portal at /account):
  //   localStorage "sd_user_token" = login token, "sd_user" = user JSON.
  // Nothing here ever blocks the page: every call is fire-and-forget and fails quietly.
  // ------------------------------------------------------------------------
  function userToken() {
    let raw = null;
    try { raw = localStorage.getItem('sd_user_token'); } catch (e) { return ''; }
    if (!raw) return '';
    if (raw.charAt(0) === '"') {
      try { raw = JSON.parse(raw); } catch (e) { /* use as-is */ }
    }
    return typeof raw === 'string' && raw.length < 400 ? raw : '';
  }
  function storedUser() {
    const u = store('sd_user', null);
    return u && typeof u === 'object' ? u : null;
  }
  /** Link to a page that lives on the website (/account, /business); inside the app it opens the live site. */
  function siteLink(page) {
    return NATIVE ? NATIVE.webUrl(page) : '/' + page;
  }
  /** fetch() that never throws: resolves to { ok, status, data } (status 0 = no network / no fetch). */
  async function apiCall(path, opts) {
    if (!canUseApi() || typeof fetch !== 'function') return { ok: false, status: 0, data: {} };
    try {
      const res = await fetch(apiUrl(path), opts || {});
      let data = {};
      try { data = (await res.json()) || {}; } catch (e) { /* empty body */ }
      return { ok: !!res.ok, status: res.status || 0, data };
    } catch (e) {
      return { ok: false, status: 0, data: {} };
    }
  }
  /** Analytics-style POST that must not slow anything down (pharmacy view / tap counters). */
  function beacon(path, body) {
    if (!canUseApi()) return;
    const url = apiUrl(path);
    const payload = JSON.stringify(body);
    try {
      // text/plain keeps it a "simple" request (no CORS preflight from the app); the server parses JSON anyway
      if (navigator.sendBeacon && navigator.sendBeacon(url, payload)) return;
    } catch (e) { /* fall through */ }
    try {
      if (typeof fetch === 'function') {
        const p = fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: payload, keepalive: true });
        if (p && p.catch) p.catch(() => {});
      }
    } catch (e) { /* ignore */ }
  }

  // ------------------------------------------------------------------------
  // Formatting
  // ------------------------------------------------------------------------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function rs(v) {
    if (typeof v !== 'number' || !isFinite(v)) return 'Rs —';
    const digits = v >= 1000 ? 0 : v >= 100 ? 0 : 2;
    return 'Rs ' + v.toLocaleString('en-PK', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  function unitWord(med) {
    if (!med) return t('unit_pack');
    if (med.unit === 'unit') {
      if (/capsule/i.test(med.form)) return t('unit_capsule');
      if (/sachet/i.test(med.form)) return I18N.getLang() === 'ur' ? 'ساشے' : 'sachet';
      if (/suppositor/i.test(med.form)) return I18N.getLang() === 'ur' ? 'سپوزیٹری' : 'suppository';
      return t('unit_unit');
    }
    return t('unit_' + med.unit) || med.unit;
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso + 'T00:00:00Z');
    if (isNaN(d)) return iso;
    return d.toLocaleDateString(I18N.getLang() === 'ur' ? 'ur-PK' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }

  function medTitle(med) {
    const s = med.strength && !med.name.includes(med.strength) ? ' ' + med.strength : '';
    return med.name + s;
  }

  function medMeta(med) {
    return [med.form, med.pack, med.manufacturer].filter(Boolean).join(' · ');
  }

  function catIcon(icon) {
    return `<svg class="ic"><use href="#c-${esc(icon || 'pill')}"/></svg>`;
  }

  function catName(cat) {
    return I18N.getLang() === 'ur' ? cat.ur : cat.en;
  }

  function highlight(text, q) {
    const s = esc(text);
    const qq = String(q || '').trim();
    if (qq.length < 2) return s;
    const i = s.toLowerCase().indexOf(qq.toLowerCase());
    if (i < 0) return s;
    return s.slice(0, i) + '<mark>' + s.slice(i, i + qq.length) + '</mark>' + s.slice(i + qq.length);
  }

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  // ------------------------------------------------------------------------
  // My Medicines (cabinet) & recents
  // ------------------------------------------------------------------------
  const cabinet = {
    list() {
      return store('sd_cabinet', []).filter((x) => state.engine && state.engine.byId(x.id));
    },
    has(id) {
      return store('sd_cabinet', []).some((x) => x.id === id);
    },
    add(id) {
      const list = store('sd_cabinet', []);
      if (list.some((x) => x.id === id)) return false;
      const med = state.engine.byId(id);
      list.push({ id, qty: med && med.unit === 'unit' ? 1 : 1, at: new Date().toISOString() });
      save('sd_cabinet', list);
      updateCabinetBadge();
      cabinetChanged();
      return true;
    },
    remove(id) {
      save('sd_cabinet', store('sd_cabinet', []).filter((x) => x.id !== id));
      updateCabinetBadge();
      cabinetChanged();
    },
    replace(oldId, newId) {
      const list = store('sd_cabinet', []);
      const item = list.find((x) => x.id === oldId);
      if (!item) return;
      if (list.some((x) => x.id === newId)) {
        save('sd_cabinet', list.filter((x) => x.id !== oldId));
      } else {
        item.id = newId;
        save('sd_cabinet', list);
      }
      updateCabinetBadge();
      cabinetChanged();
    },
    setQty(id, qty) {
      const list = store('sd_cabinet', []);
      const item = list.find((x) => x.id === id);
      if (item) item.qty = Math.max(0, Math.min(99, qty));
      save('sd_cabinet', list);
      cabinetChanged();
    },
  };

  // ------------------------------------------------------------------------
  // My Medicines <-> account sync (only when signed in; never blocks the UI)
  // Local item {id, qty, at}  ->  account item {id, perDay, days, at}
  // qty is units per day for tablets/capsules and packs per month otherwise; it is stored as perDay
  // (the server accepts 0-50) and read back the same way.
  // ------------------------------------------------------------------------
  function cabinetPayload(list) {
    return {
      cabinet: (list || store('sd_cabinet', []))
        .filter((x) => x && typeof x.id === 'string')
        .slice(0, 100)
        .map((x) => ({
          id: x.id,
          perDay: Math.max(0, Math.min(50, Number(x.qty) || 1)),
          days: 30,
          at: typeof x.at === 'string' ? x.at : new Date().toISOString(),
        })),
    };
  }
  let syncTimer = null;
  function cabinetChanged() {
    if (!userToken()) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncCabinetNow, 1200);
  }
  function syncCabinetNow() {
    const token = userToken();
    if (!token) return Promise.resolve(null);
    return apiCall('api/account?a=save-cabinet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(cabinetPayload()),
    });
  }
  /** On start-up: refresh the signed-in user, and restore My Medicines from the account on a new device. */
  async function loadAccount() {
    const token = userToken();
    if (!token) return null;
    const r = await apiCall('api/account?a=me', { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' });
    if (!r.ok || !r.data.user) return null;
    const user = r.data.user;
    state.user = user;
    save('sd_user', user);
    const local = store('sd_cabinet', []);
    if (!local.length && Array.isArray(user.cabinet) && user.cabinet.length) {
      const restored = user.cabinet
        .filter((x) => x && typeof x.id === 'string')
        .map((x) => ({ id: x.id, qty: Number(x.perDay) || 1, at: x.at || new Date().toISOString() }));
      save('sd_cabinet', restored);
      updateCabinetBadge();
    }
    renderAccountNav();
    if (state.route && state.route.name === 'cabinet' && state.engine) renderCabinet();
    return user;
  }

  function renderAccountNav() {
    const u = state.user || storedUser();
    const signedIn = !!(u && userToken());
    const first = signedIn && u.name ? String(u.name).trim().split(/\s+/)[0].slice(0, 16) : '';
    $$('.nav-account-label').forEach((el) => {
      el.textContent = signedIn && first ? t('nav_hi', { name: first }) : t('nav_account');
    });
    $$('[data-ext-link]').forEach((a) => a.setAttribute('href', siteLink(a.dataset.extLink)));
  }

  /**
   * Monthly cost of a cabinet entry. qty = units per day for tablets/capsules,
   * otherwise packs per month. `asMed` prices the same quantity with another
   * (same-formula) product, scaled to the original pack size.
   */
  function monthlyCost(med, qty, asMed) {
    const p = asMed || med;
    if (med.unit === 'unit') return p.unitPrice * qty * 30;
    return p.unitPrice * med.units * qty;
  }

  function updateCabinetBadge() {
    const n = store('sd_cabinet', []).length;
    ['#cabinet-count', '#cabinet-count-m'].forEach((s) => {
      const el = $(s);
      if (!el) return;
      el.textContent = n;
      el.hidden = n === 0;
    });
  }

  function pushRecent(id) {
    const list = store('sd_recent', []).filter((x) => x !== id);
    list.unshift(id);
    save('sd_recent', list.slice(0, 10));
  }

  // ------------------------------------------------------------------------
  // Compare tray (up to 3 medicines, kept in localStorage "sd_compare")
  // ------------------------------------------------------------------------
  const COMPARE_MAX = 3;
  const compare = {
    ids() {
      const list = store('sd_compare', []);
      return Array.isArray(list) ? list.filter((id) => typeof id === 'string').slice(0, COMPARE_MAX) : [];
    },
    has(id) {
      return compare.ids().includes(id);
    },
    /** Returns 'added' | 'removed' | 'full'. */
    toggle(id) {
      const list = compare.ids();
      let out;
      if (list.includes(id)) {
        save('sd_compare', list.filter((x) => x !== id));
        out = 'removed';
      } else if (list.length >= COMPARE_MAX) {
        out = 'full';
      } else {
        list.push(id);
        save('sd_compare', list);
        out = 'added';
      }
      renderCompareTray();
      return out;
    },
    remove(id) {
      save('sd_compare', compare.ids().filter((x) => x !== id));
      renderCompareTray();
    },
    clear() {
      save('sd_compare', []);
      renderCompareTray();
    },
  };

  function compareMeds() {
    return state.engine ? compare.ids().map((id) => state.engine.byId(id)).filter(Boolean) : [];
  }

  function renderCompareTray() {
    const tray = $('#compare-tray');
    if (!tray) return;
    const meds = compareMeds();
    const onCompare = state.route && state.route.name === 'compare';
    if (!meds.length || onCompare) {
      tray.hidden = true;
      tray.innerHTML = '';
      return;
    }
    tray.hidden = false;
    tray.innerHTML = `<span class="ct-text"><svg class="ic" aria-hidden="true"><use href="#i-compare"/></svg><span>${esc(t('compare_tray', { n: meds.length }))}</span></span>
      <a class="btn btn-primary sm" href="#/compare">${esc(t('compare_open', { n: meds.length }))}</a>
      <button type="button" class="btn btn-ghost sm" data-compare-clear>${esc(t('compare_clear'))}</button>`;
  }

  function onCompareToggle(id, btn) {
    const r = compare.toggle(id);
    toast(t(r === 'added' ? 'compare_added' : r === 'removed' ? 'compare_removed' : 'compare_full'));
    if (btn && r !== 'full') {
      const on = r === 'added';
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.classList.toggle('on', on);
      const label = $('.cmp-label', btn);
      if (label) label.textContent = t(on ? 'compare_in' : 'compare_add');
    }
    return r;
  }

  // ------------------------------------------------------------------------
  // Routing
  // ------------------------------------------------------------------------
  const VIEWS = ['home', 'search', 'category', 'medicine', 'brand', 'cabinet', 'compare', 'empty'];

  function parseHash() {
    let h = location.hash.replace(/^#\/?/, '');
    try {
      h = decodeURIComponent(h);
    } catch (e) {
      h = h.replace(/%(?![0-9a-f]{2})/gi, '%25'); // a stray "%" (e.g. "50%") must not break the page
      try { h = decodeURIComponent(h); } catch (e2) { h = ''; }
    }
    const [name, ...rest] = h.split('/');
    const arg = rest.join('/');
    if (name === 'search' && arg) return { name: 'search', q: arg };
    if (name === 'medicine' && arg) return { name: 'medicine', id: arg };
    if (name === 'brand' && arg) return { name: 'brand', reg: arg };
    if (name === 'category' && arg) return { name: 'category', id: arg };
    if (name === 'my-medicines') return { name: 'cabinet' };
    if (name === 'compare') return { name: 'compare' };
    return { name: 'home' };
  }

  function go(path) {
    if (location.hash === '#' + path) render();
    else location.hash = path;
  }

  function showView(name) {
    VIEWS.forEach((v) => {
      const el = $('#view-' + v);
      if (el) el.hidden = v !== name;
    });
    $$('[data-route]').forEach((a) => a.classList.toggle('active', a.dataset.route === (name === 'cabinet' ? 'cabinet' : name === 'home' ? 'home' : '')));
  }

  function render() {
    if (!state.engine) return;
    const r = parseHash();
    state.route = r;
    state.viewedPids = new Set(); // pharmacy "view" counters: once per pharmacy per page view
    closeSuggest();
    if (r.name === 'search') renderSearch(r.q);
    else if (r.name === 'medicine') renderMedicine(r.id);
    else if (r.name === 'brand') renderBrand(r.reg);
    else if (r.name === 'category') renderCategory(r.id, true);
    else if (r.name === 'cabinet') renderCabinet();
    else if (r.name === 'compare') renderCompare();
    else renderHome();
    renderCompareTray();
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
    trackView(r);
  }

  // Vercel Web Analytics: the site uses #/hash routes, which analytics can't see, so report each
  // screen as a path. Search words are left out on purpose. Website only (the app has no script).
  let lastViewPath = null;
  function trackView(r) {
    if (NATIVE || typeof window.va !== 'function') return;
    let route = '/';
    let path = '/';
    if (r.name === 'medicine') { route = '/medicine/[id]'; path = '/medicine/' + r.id; }
    else if (r.name === 'category') { route = '/category/[id]'; path = '/category/' + r.id; }
    else if (r.name === 'search') { route = '/search'; path = '/search'; }
    else if (r.name === 'brand') { route = '/brand/[reg]'; path = '/brand/' + r.reg; }
    else if (r.name === 'cabinet') { route = '/my-medicines'; path = '/my-medicines'; }
    else if (r.name === 'compare') { route = '/compare'; path = '/compare'; }
    if (path === lastViewPath) return;
    lastViewPath = path;
    try { window.va('pageview', { route, path }); } catch (e) { /* analytics must never break the page */ }
  }

  // ------------------------------------------------------------------------
  // Home
  // ------------------------------------------------------------------------
  function renderHome() {
    showView('home');
    document.title = 'Sasta Dawa Finder — Compare medicine prices & find cheaper generics in Pakistan';
    const { engine, ds } = state;

    // quick chips: the admin's list if set, otherwise the most popular brands
    const picked = state.site && Array.isArray(state.site.popular) ? state.site.popular.slice(0, 10) : [];
    $('#quick-chips').innerHTML = picked.length
      ? picked.map((name) => `<a class="chip" href="#/search/${encodeURIComponent(name)}">${esc(name)}</a>`).join('')
      : engine.popular(9).map((m) => `<a class="chip" href="#/medicine/${encodeURIComponent(m.id)}">${esc(m.name)}</a>`).join('');

    $('#data-stamp').textContent = t('data_stamp', {
      products: ds.items.length.toLocaleString('en-PK'),
      date: fmtDate(ds.meta.latest_price_date),
    });
    $('#hero-stats').innerHTML = [
      [ds.items.length.toLocaleString('en-PK'), t('stat_medicines')],
      [ds.groups.size.toLocaleString('en-PK'), t('stat_formulas')],
      [fmtDate(ds.meta.latest_price_date), t('stat_updated')],
    ]
      .map(([v, k]) => `<div><b class="num">${esc(v)}</b><span>${esc(k)}</span></div>`)
      .join('');

    // recent
    const recent = store('sd_recent', []).map((id) => engine.byId(id)).filter(Boolean);
    $('#recent-block').hidden = recent.length === 0;
    $('#recent-list').innerHTML = recent
      .map((m) => `<a class="recent-card" href="#/medicine/${encodeURIComponent(m.id)}"><b>${esc(medTitle(m))}</b><span>${esc(m.generic)} · ${rs(m.unitPrice)}/${esc(unitWord(m))}</span></a>`)
      .join('');

    // categories
    const counts = engine.categoryCounts();
    $('#cat-grid').innerHTML = ds.categories
      .filter((c) => (counts.get(c.id) || 0) > 0 && c.id !== 'other')
      .map((c) => `<a class="cat-card" href="#/category/${c.id}"><span class="cat-ic">${catIcon(c.icon)}</span><span><span class="cat-name">${esc(catName(c))}</span><br><span class="cat-n">${(counts.get(c.id) || 0).toLocaleString('en-PK')}</span></span></a>`)
      .join('');

    // deals
    const deals = engine.topSavings(6);
    $('#deal-grid').innerHTML = deals.length
      ? deals
        .map(({ med, s }) => {
          const u = unitWord(med);
          return `<a class="deal" href="#/medicine/${encodeURIComponent(med.id)}">
            <div class="deal-top"><div><div class="deal-name">${esc(medTitle(med))}</div><div class="deal-gen">${esc(med.generic)} · ${esc(med.form)}</div></div>
            <span class="save-pill">−${s.percent}%</span></div>
            <div class="deal-compare">
              <span class="lbl">${esc(med.name)}</span><span class="val num">${rs(med.unitPrice)}/${esc(u)}</span>
              <span class="lbl cheap">${esc(s.cheapest.name)}</span><span class="val num cheap">${rs(s.cheapest.unitPrice)}/${esc(u)}</span>
            </div></a>`;
        })
        .join('')
      : '';
    $('#deal-grid').closest('.block').hidden = deals.length === 0;
  }

  // ------------------------------------------------------------------------
  // Search results
  // ------------------------------------------------------------------------
  function resultRow(med, q, ctx, packs) {
    const s = state.engine.savings(med);
    const tags = [];
    if (s && s.percent >= 5) tags.push(`<span class="tag save">${esc(t('save_upto', { pct: s.percent }))}</span>`);
    const g = med.group ? (state.ds.groups.get(med.group) || []).length : 1;
    if (g > 1) tags.push(`<span class="tag">${esc(t('brands_n', { n: g }))}</span>`);
    if (packs > 1) tags.push(`<span class="tag">${esc(t('pack_sizes', { n: packs }))}</span>`);
    const inCmp = compare.has(med.id);
    return `<div class="result-wrap"><a class="result" href="#/medicine/${encodeURIComponent(med.id)}">
      <div><div class="r-name">${highlight(med.name, q)} <span class="r-strength">${esc(med.strength)}</span></div>
      <div class="r-meta">${highlight(med.generic, q)} · ${esc(med.form)} · ${esc(med.pack)}</div>
      ${tags.length ? `<div class="r-tags">${tags.join('')}</div>` : ''}</div>
      <div class="r-price"><b class="num">${rs(med.unitPrice)}</b><span>${esc(t('per_unit', { unit: unitWord(med) }))}</span></div>
    </a>${compareBtn(med, inCmp, true)}</div>`;
  }

  /** "Compare" toggle button (a sibling of the result link, never nested inside it). */
  function compareBtn(med, on, iconOnly) {
    const label = t('compare_add_named', { name: medTitle(med) });
    return `<button type="button" class="${iconOnly ? 'icon-btn cmp-btn' : 'btn btn-ghost cmp-btn'}${on ? ' on' : ''}" data-compare="${esc(med.id)}" aria-pressed="${on ? 'true' : 'false'}" aria-label="${esc(label)}" title="${esc(label)}"><svg class="ic" aria-hidden="true"><use href="#i-compare"/></svg>${iconOnly ? '' : `<span class="cmp-label">${esc(t(on ? 'compare_in' : 'compare_add'))}</span>`}</button>`;
  }

  /** "DRAP prices updated to <date>" line on result pages. */
  function pageStamp(sel) {
    const el = $(sel);
    if (el && state.ds) el.textContent = t('page_stamp', { date: fmtDate(state.ds.meta.latest_price_date) });
  }

  function renderSearch(q) {
    state.lastQuery = q;
    const input = $('#search-input');
    if (document.activeElement !== input) input.value = q;
    updateSearchButtons();
    const raw = state.engine.search(q, { limit: 200 });
    // Registered brands with no DRAP price (Valtec, Starcox...): brand-name matches only
    const unpriced = state.reg ? state.reg.search(q, { limit: 20, minScore: 60 }) : [];
    if (!raw.length && !unpriced.length) return renderNotFound(q);
    // One row per brand + strength + form (cheapest pack per unit), with a count of pack sizes
    const byKey = new Map();
    for (const r of raw) {
      const k = r.med.name + '|' + r.med.strength + '|' + r.med.form;
      const prev = byKey.get(k);
      if (!prev) byKey.set(k, { ...r, packs: 1 });
      else {
        prev.packs++;
        if (r.med.unitPrice < prev.med.unitPrice) prev.med = r.med;
      }
    }
    const results = [...byKey.values()].slice(0, 80);
    showView('search');
    document.title = `${q} — prices & cheaper alternatives | Sasta Dawa Finder`;
    $('#search-title').textContent = t('results_for', { q });
    pageStamp('#search-stamp');
    $('#search-sub').textContent = results.length
      ? t('results_count', { n: results.length >= 80 ? '80+' : results.length })
      : t('unpriced_only_sub');
    const unpricedHtml = unpriced.length
      ? `<div class="unpriced-head"><h2>${esc(t('unpriced_title'))}</h2><p>${esc(t('unpriced_sub'))}</p></div>` +
        unpriced.map((r) => unpricedRow(r.med, q)).join('')
      : '';
    // The unpriced section leads when there are no priced results, or when the unpriced brand is a
    // clearly better name match ("valtec" also loosely matches priced valsartan products).
    const top = unpriced[0];
    const unpricedFirst = !results.length || (top && top.score > Math.max(...results.map((r) => r.score)));
    $('#search-results').innerHTML =
      (unpricedFirst ? unpricedHtml : '') +
      results.map((r) => resultRow(r.med, q, null, r.packs)).join('') +
      (results.length >= 80 ? `<p class="more-note">${esc(t('results_more', { n: 80 }))}</p>` : '') +
      (unpricedFirst ? '' : unpricedHtml);
  }

  /** A registered brand with no DRAP price: shows the formula and how many priced options exist. */
  function unpricedRow(item, q) {
    const alts = state.reg.pricedAlternatives(item);
    const exact = alts.filter((a) => a.exact).length;
    const tags = [`<span class="tag warn">${esc(t('no_drap_price'))}</span>`];
    if (alts.length) tags.push(`<span class="tag save">${esc(t(exact ? 'priced_same_n' : 'priced_salt_n', { n: exact || alts.length }))}</span>`);
    return `<a class="result unpriced" href="#/brand/${encodeURIComponent(item.reg)}">
      <div><div class="r-name">${highlight(item.name, q)}${item.strength ? ` <span class="r-strength">${esc(item.strength)}</span>` : ''}</div>
      <div class="r-meta">${item.generic ? highlight(item.generic, q) + ' · ' : ''}${esc(item.form)}${item.manufacturer ? ' · ' + esc(item.manufacturer) : ''}</div>
      <div class="r-tags">${tags.join('')}</div></div>
      <div class="r-price"><span class="np">${esc(t('price_not_set'))}</span></div>
    </a>`;
  }

  function renderBrand(reg) {
    const item = state.reg && state.reg.byReg(reg);
    if (!item && !state.reg) {
      // registry still loading: loadRegistryInBackground() renders this page again when it arrives
      showView('brand');
      $('#brand-hero').innerHTML = `<p class="muted">${esc(t('loading'))}</p>`;
      $('#brand-alt-list').innerHTML = '';
      return;
    }
    if (!item) return renderNotFound(String(reg));
    showView('brand');
    document.title = `${item.product} — formula & cheaper alternatives | Sasta Dawa Finder`;
    $('#brand-back').setAttribute('href', state.lastQuery ? '#/search/' + encodeURIComponent(state.lastQuery) : '#/');
    $('#brand-hero').innerHTML = `
      <div class="mh-top"><div>
        <h1 class="mh-name">${esc(item.name)}${item.strength ? ' ' + esc(item.strength) : ''}</h1>
        <p class="mh-product">${esc(item.product)}</p>
      </div></div>
      <div class="mh-formula"><small>${esc(t('formula'))}</small><b>${esc(item.generic || t('formula_unknown'))}</b></div>
      <div class="notice mh-noprice"><svg class="ic"><use href="#i-alert"/></svg><span>${esc(t(state.reg.pricedAlternatives(item).length ? 'unpriced_explain' : 'unpriced_explain_none'))}</span></div>
      <dl class="mh-facts">
        <dt>${esc(t('form_label'))}</dt><dd>${esc(item.form || '—')}</dd>
        <dt>${esc(t('maker'))}</dt><dd>${esc(item.manufacturer || '—')}</dd>
        <dt>${esc(t('reg_no'))}</dt><dd>${esc(item.reg)}</dd>
      </dl>
      <div class="mh-actions">
        <a class="btn btn-ghost" href="https://www.google.com/maps/search/pharmacy+near+me" target="_blank" rel="noopener"><svg class="ic"><use href="#i-map"/></svg><span>${esc(t('find_pharmacy'))}</span></a>
      </div>
      <p class="small muted">${esc(t('registry_source'))}</p>`;

    const alts = state.reg.pricedAlternatives(item);
    const exact = alts.filter((a) => a.exact);
    const other = alts.filter((a) => !a.exact);
    // other registered brands with this salt that have no DRAP price either
    const unpricedAlts = state.reg.unpricedAlternatives(item, alts.length ? 12 : 30);
    $('#brand-alt-count').textContent = alts.length;
    $('#brand-alt-list').innerHTML =
      (alts.length || unpricedAlts.length ? consultNote() : '') +
      (alts.length
        ? (exact.length ? `<p class="alt-sub">${esc(t('alts_same_strength'))}</p>` + exact.map((a) => resultRow(a.med, '')).join('') : '') +
          (other.length ? `<p class="alt-sub">${esc(t(exact.length ? 'alts_other_strength' : 'alts_same_salt'))}</p>` + other.slice(0, 40).map((a) => resultRow(a.med, '')).join('') : '')
        : `<div class="alt-empty"><p>${esc(t('no_priced_alts'))}</p></div>`) +
      (unpricedAlts.length
        ? `<p class="alt-sub">${esc(t('alts_unpriced'))}</p>` + unpricedAlts.map((a) => unpricedRow(a.med, '')).join('')
        : '');
  }

  /** "Consult your doctor or pharmacist before switching medicine." shown on every list of alternatives. */
  function consultNote() {
    return `<p class="consult-note" role="note"><svg class="ic" aria-hidden="true"><use href="#i-alert"/></svg><span>${esc(t('consult_doctor'))}</span></p>`;
  }

  /** data/registry.json is optional and loads after the price list, so it never slows the first paint. */
  async function loadRegistryInBackground() {
    try {
      const registry = await window.SDData.loadRegistry('data/registry.json');
      state.reg = window.SDSearch.createRegistryIndex(registry, state.ds);
      const warm = () => state.reg.warm();
      if (window.requestIdleCallback) requestIdleCallback(warm, { timeout: 3000 });
      else setTimeout(warm, 500);
    } catch (e) {
      console.warn('Registry not loaded', e);
      return;
    }
    const r = state.route;
    if (r && (r.name === 'search' || r.name === 'brand')) render();
  }

  function renderNotFound(q) {
    showView('empty');
    $('#empty-title').textContent = t('not_found_t', { q });
    $('#empty-sub').textContent = t('not_found_d');
    const dym = state.engine.didYouMean(q, 6);
    $('#empty-suggest').innerHTML = dym.length
      ? `<span class="muted small" style="width:100%">${esc(t('did_you_mean'))}</span>` +
        dym.map((d) => `<a class="chip" href="#/search/${encodeURIComponent(d)}">${esc(d)}</a>`).join('')
      : '';
    $('#empty-ask').onclick = () => window.SDAssistantUI && window.SDAssistantUI.open(q);
  }

  // ------------------------------------------------------------------------
  // Category
  // ------------------------------------------------------------------------
  function renderCategory(id, reset) {
    const cat = state.ds.categories.find((c) => c.id === id);
    if (!cat) return go('/');
    if (reset) {
      state.categoryLimit = 30;
      $('#category-filter').value = '';
      const forms = state.engine.categoryForms(id);
      $('#category-form').innerHTML =
        `<option value="">${esc(t('all_forms'))}</option>` +
        forms.map((f) => `<option value="${esc(f.form)}">${esc(f.form)} (${f.count})</option>`).join('');
    }
    showView('category');
    document.title = `${cat.en} medicines — prices in Pakistan | Sasta Dawa Finder`;
    $('#category-title').textContent = catName(cat);
    pageStamp('#category-stamp');
    $('#category-filter').placeholder = t('filter_placeholder');
    const fams = state.engine.categoryFamilies(id, { filter: $('#category-filter').value, form: $('#category-form').value });
    const products = fams.reduce((n, f) => n + f.count, 0);
    $('#category-sub').textContent = t('cat_count', { n: fams.length.toLocaleString('en-PK'), p: products.toLocaleString('en-PK') });
    const shown = fams.slice(0, state.categoryLimit);
    $('#category-list').innerHTML = shown
      .map((f) => {
        const c = f.cheapest;
        const u = unitWord(c);
        const brands = f.count === 1 ? t('brand_1') : t('brands_n', { n: f.count });
        const range = f.count > 1 && f.max > f.min ? `${rs(f.min)} – ${rs(f.max)}` : rs(f.min);
        return `<a class="group-row" href="#/medicine/${encodeURIComponent(c.id)}">
          <div class="g-name">${esc(f.generic)} <span class="muted">${esc(f.strength)}</span></div>
          <div class="g-meta">${esc(f.form)} · ${esc(brands)}${f.count > 1 ? ' · ' + esc(range) : ''}</div>
          <div class="g-price"><b class="num">${rs(f.min)}</b><span class="muted">${esc(t('per_unit', { unit: u }))}</span></div>
        </a>`;
      })
      .join('');
    $('#category-more').hidden = fams.length <= state.categoryLimit;
  }

  // ------------------------------------------------------------------------
  // Medicine detail
  // ------------------------------------------------------------------------
  const NARROW_THERAPEUTIC = /levothyroxine|thyroxine|warfarin|phenytoin|carbamazepine|valpro|lithium|digoxin|tacrolimus|ciclosporin|cyclosporine|amiodarone|lamotrigine|levetiracetam|clozapine|theophylline|methotrexate/i;

  function renderMedicine(id) {
    const { engine } = state;
    const med = engine.byId(id);
    if (!med) return renderNotFound(id.replace(/-\d+$/, '').replace(/-/g, ' '));
    showView('medicine');
    pushRecent(med.id);
    document.title = `${medTitle(med)} ${med.form} price in Pakistan — cheaper alternatives | Sasta Dawa Finder`;
    $('#medicine-back').setAttribute('href', state.lastQuery ? '#/search/' + encodeURIComponent(state.lastQuery) : '#/');

    const u = unitWord(med);
    const inCab = cabinet.has(med.id);
    const cat = state.ds.categories.find((c) => c.id === med.category);
    $('#med-hero').innerHTML = `
      <div class="mh-top">
        <div>
          <h1 class="mh-name">${esc(medTitle(med))}</h1>
          <p class="mh-product">${esc(med.product)}</p>
        </div>
        ${cat && cat.id !== 'other' ? `<a class="cat-ic" href="#/category/${cat.id}" title="${esc(catName(cat))}" aria-label="${esc(catName(cat))}">${catIcon(cat.icon)}</a>` : ''}
      </div>
      <div class="mh-formula"><small>${esc(t('formula'))}</small><b>${esc(med.generic)}${med.strength ? ' — ' + esc(med.strength) : ''}</b></div>
      <div class="mh-prices">
        <div class="mh-price"><small>${esc(t('pack_price'))}</small><b class="num">${rs(med.price)}</b></div>
        <div class="mh-price"><small>${esc(t('unit_price', { unit: u }))}</small><b class="num">${med.unit === 'pack' ? '—' : rs(med.unitPrice)}</b></div>
      </div>
      ${'{{SAVINGS}}'}
      <dl class="mh-facts">
        <dt>${esc(t('form_label'))}</dt><dd>${esc(med.form)}</dd>
        <dt>${esc(t('pack_label'))}</dt><dd>${esc(med.pack || '—')}</dd>
        <dt>${esc(t('maker'))}</dt><dd>${esc(med.manufacturer || '—')}</dd>
        <dt>${esc(t('effective'))}</dt><dd>${esc(fmtDate(med.effective))}</dd>
        ${med.reg ? `<dt>${esc(t('reg_no'))}</dt><dd>${esc(med.reg)}</dd>` : ''}
      </dl>
      <p class="mh-stamp small muted">${esc(t('price_checked', { date: fmtDate(state.ds.meta.latest_price_date) }))}</p>
      <div class="mh-actions">
        <button type="button" class="btn ${inCab ? 'btn-soft' : 'btn-primary'}" id="btn-cabinet">
          <svg class="ic"><use href="#${inCab ? 'i-check' : 'i-plus'}"/></svg><span>${esc(t(inCab ? 'in_cabinet' : 'add_cabinet'))}</span></button>
        ${compareBtn(med, compare.has(med.id), false).replace('class="btn btn-ghost cmp-btn', 'id="btn-compare" class="btn btn-ghost cmp-btn')}
        <button type="button" class="btn btn-ghost" id="btn-share"><svg class="ic"><use href="#i-share"/></svg><span>${esc(t('share'))}</span></button>
      </div>
      ${med.corrected ? `<p class="mh-corrected"><svg class="ic"><use href="#i-check"/></svg>${esc(t('price_corrected', { price: rs(med.drapPrice) }))}</p>` : ''}
      <button type="button" class="link-btn mh-report" id="btn-report"><svg class="ic"><use href="#i-flag"/></svg>${esc(t('report_price'))}</button>`;

    const onCabinet = () => {
      if (cabinet.has(med.id)) {
        cabinet.remove(med.id);
        toast(t('removed'));
      } else {
        cabinet.add(med.id);
        toast(t('added'));
      }
      renderMedicine(med.id);
    };

    // savings
    const s = engine.savings(med);
    const alts = engine.alternatives(med, state.altSort);
    let savingsHtml = '';
    if (s && s.percent >= 1) {
      savingsHtml = `<div class="savings"><span class="big">−${s.percent}%</span><div>
        <p class="s-title">${esc(t('save_banner', { pct: s.percent, name: s.cheapest.name, price: rs(s.cheapest.unitPrice), unit: u })).replace(esc(s.cheapest.name), `<a href="#/medicine/${encodeURIComponent(s.cheapest.id)}">${esc(s.cheapest.name)}</a>`)}</p>
        ${med.unit !== 'pack' ? `<p class="s-sub">${esc(t('save_detail', { pack: rs(s.perPack), units: med.units + ' ' + u }))}</p>` : ''}
      </div></div>`;
    } else if (alts.length > 1) {
      savingsHtml = `<div class="savings neutral"><svg class="ic"><use href="#i-check"/></svg><p class="s-title">${esc(t('cheapest_already'))}</p></div>`;
    }
    // Every medicine page carries the doctor/pharmacist warning; narrow-therapeutic ones get the stronger one too.
    let noticeHtml = `<div class="notice consult"><svg class="ic"><use href="#i-alert"/></svg><span>${esc(t('consult_doctor'))}</span></div>`;
    if (NARROW_THERAPEUTIC.test(med.generic) && alts.length > 1) {
      noticeHtml += `<div class="notice"><svg class="ic"><use href="#i-alert"/></svg><span>${esc(t('switch_warning'))}</span></div>`;
    }
    $('#med-hero').innerHTML = $('#med-hero').innerHTML.replace('{{SAVINGS}}', savingsHtml);
    $('#btn-cabinet').onclick = onCabinet;
    $('#btn-share').onclick = () => shareMedicine(med);
    $('#btn-report').onclick = () => openFeedback('wrong_price', { med });
    $('#med-savings').innerHTML = noticeHtml;

    // strengths
    const str = engine.strengths(med);
    $('#med-strengths').innerHTML = str.length
      ? `<div class="strengths"><h3>${esc(t('strengths_title', { generic: med.generic }))}</h3><div class="strength-chips">${str
        .map(({ med: m, count }) => `<a class="strength-chip" href="#/medicine/${encodeURIComponent(m.id)}"><b>${esc(m.strength || m.name)} · ${esc(m.form)}</b><span>${esc(count > 1 ? t('from_price', { price: rs(m.unitPrice) }) : rs(m.unitPrice))}/${esc(unitWord(m))}</span></a>`)
        .join('')}</div></div>`
      : '';

    renderAlternatives(med);
    renderNearby(med);
  }

  function renderAlternatives(med) {
    const alts = state.engine.alternatives(med, state.altSort);
    const u = unitWord(med);
    $('#alt-count').textContent = alts.length;
    $('#alt-sort').value = state.altSort;
    if (alts.length <= 1) {
      $('#alt-list').innerHTML = `<div class="alt-empty"><p>${esc(t('no_alts'))}</p>${state.engine.strengths(med).length ? `<p class="small">${esc(t('no_alts_hint'))}</p>` : ''}</div>`;
      return;
    }
    const max = Math.max(...alts.map((a) => a.unitPrice));
    const minPrice = Math.min(...alts.map((a) => a.unitPrice));
    $('#alt-list').innerHTML = consultNote() + alts
      .map((a) => {
        const isCur = a.id === med.id;
        const pct = med.unitPrice > 0 ? Math.round(((a.unitPrice - med.unitPrice) / med.unitPrice) * 100) : 0;
        const delta = isCur
          ? `<span class="tag brand">${esc(t('this_one'))}</span>`
          : pct < 0
            ? `<span class="alt-delta down">${esc(t('cheaper_by', { pct: -pct }))}</span>`
            : pct > 0
              ? `<span class="alt-delta up">${esc(t('costlier_by', { pct }))}</span>`
              : `<span class="alt-delta">${esc(t('same_price'))}</span>`;
        const cheapest = a.unitPrice === minPrice;
        return `<a class="alt${isCur ? ' current' : ''}${cheapest ? ' cheapest' : ''}" href="#/medicine/${encodeURIComponent(a.id)}">
          <div class="alt-name">${esc(a.name)} ${cheapest ? `<span class="tag save">${esc(t('cheapest_tag'))}</span>` : ''} ${delta}</div>
          <div class="alt-meta">${esc(a.manufacturer)} · ${esc(a.pack)} · ${rs(a.price)}</div>
          <div class="alt-price"><b class="num">${a.unit === 'pack' ? rs(a.price) : rs(a.unitPrice)}</b><span>${esc(t('per_unit', { unit: u }))}</span></div>
          <div class="alt-bar" aria-hidden="true"><i style="width:${Math.max(4, Math.round((a.unitPrice / max) * 100))}%"></i></div>
        </a>`;
      })
      .join('');
  }

  function shareText(med) {
    const s = state.engine.savings(med);
    const u = unitWord(med);
    let txt = `${medTitle(med)} (${med.generic}) — ${rs(med.price)} / ${med.pack} [DRAP MRP]`;
    if (s) txt += `\nSame formula, cheaper: ${s.cheapest.name} — ${rs(s.cheapest.unitPrice)}/${u} vs ${rs(med.unitPrice)}/${u} (save ${s.percent}%)`;
    txt += '\nAsk your pharmacist before switching.';
    return txt;
  }

  async function shareMedicine(med) {
    const hash = '#/medicine/' + encodeURIComponent(med.id);
    const url = NATIVE ? NATIVE.webUrl(hash) : location.origin + location.pathname + hash;
    const text = shareText(med);
    if (NATIVE && (await NATIVE.share({ title: medTitle(med), text, url }))) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: medTitle(med), text, url });
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return;
      }
    }
    window.open('https://wa.me/?text=' + encodeURIComponent(text + '\n' + url), '_blank', 'noopener');
  }

  // ------------------------------------------------------------------------
  // My Medicines view
  // ------------------------------------------------------------------------
  function renderCabinet() {
    showView('cabinet');
    document.title = 'My Medicines — monthly cost planner | Sasta Dawa Finder';
    const list = cabinet.list();
    const body = $('#cabinet-body');
    const u = state.user || (userToken() ? storedUser() : null);
    const jc = u && u.joinedCompany;
    const chip = jc && jc.name ? `<p class="staff-chip"><svg class="ic" aria-hidden="true"><use href="#i-check"/></svg><span>${esc(t('staff_benefit', { company: jc.name }))}</span></p>` : '';
    if (!list.length) {
      body.innerHTML = chip + `<div class="empty"><div class="empty-ic"><svg class="ic"><use href="#i-list"/></svg></div>
        <h2 class="view-title">${esc(t('cabinet_empty_t'))}</h2><p class="view-sub">${esc(t('cabinet_empty_d'))}</p>
        <div class="chips center" style="margin-top:16px">${state.engine.popular(6).map((m) => `<a class="chip" href="#/medicine/${encodeURIComponent(m.id)}">${esc(m.name)}</a>`).join('')}</div></div>`;
      if (NATIVE) NATIVE.reminders.refresh(reminderText());
      return;
    }
    let now = 0;
    let best = 0;
    const rows = list.map(({ id, qty }) => {
      const med = state.engine.byId(id);
      const cheap = state.engine.cheapest(med);
      const costNow = monthlyCost(med, qty);
      const costBest = monthlyCost(med, qty, cheap);
      now += costNow;
      best += Math.min(costNow, costBest);
      const perDay = med.unit === 'unit';
      const saving = costNow - costBest;
      return `<div class="cab-item" data-id="${esc(id)}">
        <div><div class="cab-name"><a href="#/medicine/${encodeURIComponent(id)}">${esc(medTitle(med))}</a></div>
          <div class="cab-meta">${esc(med.generic)} · ${esc(med.form)} · ${rs(perDay ? med.unitPrice : med.price)}/${esc(perDay ? unitWord(med) : t('unit_pack'))}</div></div>
        <div class="cab-qty">
          <div class="stepper"><button type="button" class="icon-btn ghost sm" data-act="dec" aria-label="Less"><svg class="ic"><use href="#i-minus"/></svg></button>
          <input type="number" inputmode="decimal" min="0" max="99" step="${perDay ? 0.5 : 1}" value="${qty}" aria-label="Quantity">
          <button type="button" class="icon-btn ghost sm" data-act="inc" aria-label="More"><svg class="ic"><use href="#i-plus"/></svg></button></div>
          <span class="stepper-label">${esc(perDay ? t('per_day') : t('packs_month'))}</span>
          <button type="button" class="icon-btn ghost sm" data-act="remove" aria-label="${esc(t('remove'))}"><svg class="ic"><use href="#i-trash"/></svg></button>
        </div>
        <div class="cab-cost"><b class="num">${rs(costNow)}</b><span>${esc(t('per_month'))}</span></div>
        ${cheap.id !== med.id && saving > 0.5 ? `<div class="cab-switch"><span>${esc(t('switch_to', { name: cheap.name }))}: <b class="num">${rs(costBest)}</b>/${esc(t('per_month'))}</span>
          <span><a href="#/medicine/${encodeURIComponent(cheap.id)}">${esc(t('view_details'))}</a> · <button type="button" class="btn btn-save sm" data-act="switch" data-to="${esc(cheap.id)}">${esc(t('switch_save', { amount: rs(saving) }))}</button></span></div>` : ''}
      </div>`;
    });
    const saveAmt = Math.max(0, now - best);
    body.innerHTML = chip + `
      <div class="cab-summary">
        <div class="stat"><small>${esc(t('monthly_now'))}</small><b class="num">${rs(now)}</b></div>
        <div class="stat"><small>${esc(t('monthly_cheapest'))}</small><b class="num">${rs(best)}</b></div>
        <div class="stat good"><small>${esc(t('monthly_save'))}</small><b class="num">${rs(saveAmt)}</b><div class="sub">${esc(t('yearly_save', { amount: rs(saveAmt * 12) }))}</div></div>
      </div>
      <div class="cab-list">${rows.join('')}</div>
      ${NATIVE ? reminderCard() : ''}
      <div class="cab-tools">
        <button type="button" class="btn btn-ghost" id="cab-share"><svg class="ic"><use href="#i-share"/></svg>${esc(t('share_list'))}</button>
        ${NATIVE ? '' : `<button type="button" class="btn btn-ghost" id="cab-print"><svg class="ic"><use href="#i-print"/></svg>${esc(t('print_list'))}</button>`}
      </div>
      <p class="cab-note">${esc(t('cabinet_note'))}</p>`;

    $$('.cab-item', body).forEach((row) => {
      const id = row.dataset.id;
      const input = $('input', row);
      const step = parseFloat(input.step) || 1;
      row.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const act = btn.dataset.act;
        if (act === 'inc') cabinet.setQty(id, (parseFloat(input.value) || 0) + step);
        else if (act === 'dec') cabinet.setQty(id, (parseFloat(input.value) || 0) - step);
        else if (act === 'remove') { cabinet.remove(id); toast(t('removed')); }
        else if (act === 'switch') { cabinet.replace(id, btn.dataset.to); }
        renderCabinet();
      });
      input.addEventListener('change', () => {
        cabinet.setQty(id, parseFloat(input.value) || 0);
        renderCabinet();
      });
    });
    if ($('#cab-print')) $('#cab-print').onclick = () => window.print();
    if (NATIVE) setupReminders(body);
    $('#cab-share').onclick = async () => {
      const lines = cabinet.list().map(({ id, qty }) => {
        const m = state.engine.byId(id);
        const c = state.engine.cheapest(m);
        return `• ${medTitle(m)} (${m.generic}) — ${rs(monthlyCost(m, qty))}/month` + (c.id !== m.id ? ` → ${c.name}: ${rs(monthlyCost(m, qty, c))}/month` : '');
      });
      const text = `My medicines (DRAP prices)\n${lines.join('\n')}\nPossible saving: ${rs(saveAmt)}/month\n— Sasta Dawa Finder`;
      if (NATIVE && (await NATIVE.share({ title: t('share_list'), text, url: NATIVE.webUrl('') }))) return;
      window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
    };
  }

  // ------------------------------------------------------------------------
  // Daily reminders (app only, see js/native.js)
  // ------------------------------------------------------------------------
  function reminderText() {
    const names = cabinet.list().map(({ id }) => state.engine.byId(id)).filter(Boolean).map((m) => m.name);
    const shown = names.slice(0, 4).join(', ') + (names.length > 4 ? ' +' + (names.length - 4) : '');
    return { title: t('reminder_notif_title'), body: names.length ? t('reminder_notif_body', { list: shown }) : t('reminder_notif_body_empty') };
  }

  function fmtTime(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    const d = new Date(2000, 0, 1, h, m);
    try {
      return d.toLocaleTimeString(I18N.getLang && I18N.getLang() === 'ur' ? 'ur-PK' : 'en-PK', { hour: 'numeric', minute: '2-digit' });
    } catch (e) {
      return hhmm;
    }
  }

  function reminderCard() {
    const r = NATIVE.reminders.get();
    const chips = r.times.map((tm) => `<span class="chip rem-chip">${esc(fmtTime(tm))}<button type="button" class="rem-x" data-rem-del="${esc(tm)}" aria-label="${esc(t('remove'))}">×</button></span>`).join('');
    const canAdd = r.times.length < NATIVE.reminders.MAX_TIMES;
    const nextTime = ['09:00', '21:00', '14:00', '18:00', '07:00'].find((x) => !r.times.includes(x)) || '12:00';
    return `<div class="rem-card" id="rem-card">
      <div class="rem-head"><svg class="ic"><use href="#i-clock"/></svg><div><b>${esc(t('reminder_title'))}</b>
        <p>${esc(r.times.length ? t('reminder_on') : t('reminder_desc'))}</p></div></div>
      <div class="chips rem-times">${chips}
        ${canAdd ? `<label class="chip rem-add"><span>+ ${esc(t('reminder_add'))}</span><input type="time" id="rem-new" value="${nextTime}" aria-label="${esc(t('reminder_add'))}"></label>
        <button type="button" class="btn btn-save sm" id="rem-save">${esc(t('reminder_set'))}</button>` : ''}
      </div>
    </div>`;
  }

  function setupReminders(body) {
    const card = $('#rem-card', body);
    if (!card) return;
    const apply = async (times, msg) => {
      const ok = await NATIVE.reminders.set(times, reminderText());
      toast(ok ? msg : t('reminder_blocked'));
      renderCabinet();
    };
    card.addEventListener('click', (e) => {
      const del = e.target.closest('[data-rem-del]');
      if (del) {
        apply(NATIVE.reminders.get().times.filter((x) => x !== del.dataset.remDel), t('reminder_removed'));
        return;
      }
      if (e.target.closest('#rem-save')) {
        const v = $('#rem-new', card).value;
        if (!NATIVE.reminders.validTime(v)) return;
        apply(NATIVE.reminders.get().times.concat(v), t('reminder_saved', { time: fmtTime(v) }));
      }
    });
    NATIVE.reminders.refresh(reminderText());
  }

  // ------------------------------------------------------------------------
  // Compare view (#/compare)
  // ------------------------------------------------------------------------
  function renderCompare() {
    showView('compare');
    document.title = 'Compare medicines | Sasta Dawa Finder';
    $('#compare-back').setAttribute('href', state.lastQuery ? '#/search/' + encodeURIComponent(state.lastQuery) : '#/');
    const meds = compareMeds();
    const body = $('#compare-body');
    if (!meds.length) {
      body.innerHTML = `<div class="empty"><div class="empty-ic"><svg class="ic"><use href="#i-compare"/></svg></div>
        <p class="view-sub">${esc(t('compare_empty'))}</p>
        <div class="chips center" style="margin-top:16px">${state.engine.popular(6).map((m) => `<a class="chip" href="#/medicine/${encodeURIComponent(m.id)}">${esc(m.name)}</a>`).join('')}</div></div>`;
      return;
    }
    const cell = (fn) => meds.map((m) => `<td>${fn(m)}</td>`).join('');
    const rows = [
      [t('formula'), (m) => esc(m.generic)],
      [t('compare_strength'), (m) => esc(m.strength || '—')],
      [t('form_label'), (m) => esc(m.form || '—')],
      [t('pack_label'), (m) => esc(m.pack || '—')],
      [t('pack_price'), (m) => `<b class="num">${rs(m.price)}</b>`],
      [t('compare_unit_price'), (m) => (m.unit === 'pack' ? '—' : `<span class="num">${rs(m.unitPrice)}</span> <span class="muted small">/ ${esc(unitWord(m))}</span>`)],
      [t('maker'), (m) => esc(m.manufacturer || '—')],
      [t('effective'), (m) => esc(fmtDate(m.effective))],
      [t('compare_cheapest'), (m) => {
        const c = state.engine.cheapest(m);
        if (!c || c.id === m.id) return `<span class="tag save">${esc(t('cheapest_tag'))}</span>`;
        return `<a href="#/medicine/${encodeURIComponent(c.id)}">${esc(medTitle(c))}</a><br><span class="num small">${rs(c.unitPrice)} / ${esc(unitWord(c))}</span>`;
      }],
    ];
    body.innerHTML = `<div class="cmp-scroll"><table class="cmp-table">
      <thead><tr><th scope="col"><span class="sr-only">${esc(t('compare_medicine'))}</span></th>${meds.map((m) => `<th scope="col">
        <a href="#/medicine/${encodeURIComponent(m.id)}" class="cmp-name">${esc(medTitle(m))}</a>
        <button type="button" class="icon-btn ghost sm cmp-x" data-compare-remove="${esc(m.id)}" aria-label="${esc(t('remove') + ': ' + medTitle(m))}"><svg class="ic"><use href="#i-x"/></svg></button></th>`).join('')}</tr></thead>
      <tbody>${rows.map(([label, fn]) => `<tr><th scope="row">${esc(label)}</th>${cell(fn)}</tr>`).join('')}</tbody>
    </table></div>
    ${consultNote()}
    <div class="cab-tools"><button type="button" class="btn btn-ghost" data-compare-clear>${esc(t('compare_clear'))}</button></div>`;
  }

  // ------------------------------------------------------------------------
  // Pharmacies near you (medicine page) — /api/places?a=nearby
  // ------------------------------------------------------------------------
  const MAPS_FALLBACK = 'https://www.google.com/maps/search/pharmacy+near+me';
  const nearby = { med: null, seq: 0, list: [], geo: null };

  function waDigits(v) {
    let d = String(v || '').replace(/\D/g, '');
    if (d.startsWith('00')) d = d.slice(2);
    else if (d.startsWith('0')) d = '92' + d.slice(1); // 0300... -> 92300...
    return d;
  }
  function telHref(v) {
    return 'tel:' + String(v || '').replace(/[^\d+]/g, '');
  }
  function directionsUrl(p) {
    const dest = p.lat != null && p.lng != null ? p.lat + ',' + p.lng : [p.name, p.address, p.area, p.city].filter(Boolean).join(', ');
    return 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(dest);
  }
  function waUrl(p, med) {
    const num = waDigits(p.whatsapp || p.phone);
    const text = t('wa_text', { med: med ? medTitle(med) : '' });
    return num ? 'https://wa.me/' + num + '?text=' + encodeURIComponent(text) : '';
  }

  function nearbyUrl(med, opts) {
    const o = opts || {};
    const qs = ['a=nearby'];
    if (med) qs.push('med=' + encodeURIComponent(med.id));
    if (o.city) qs.push('city=' + encodeURIComponent(o.city));
    if (o.geo) qs.push('lat=' + encodeURIComponent(o.geo.lat), 'lng=' + encodeURIComponent(o.geo.lng));
    return 'api/places?' + qs.join('&');
  }

  function pharmacyCard(p, med) {
    const place = [p.area, p.address, p.city].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ');
    const stock = p.stock === 'in' ? ['in', t('stock_in')] : p.stock === 'out' ? ['out', t('stock_out')] : ['unknown', t('stock_unknown')];
    const wa = waUrl(p, med);
    const phone = p.phone || p.whatsapp;
    return `<article class="ph-card${p.sponsored ? ' sponsored' : ''}" data-pid="${esc(p.id)}">
      <div class="ph-top">
        <h3 class="ph-name">${esc(p.name)}${p.verified ? ` <span class="ph-verified" title="${esc(t('verified'))}"><svg class="ic" aria-hidden="true"><use href="#i-check"/></svg><span>${esc(t('verified'))}</span></span>` : ''}</h3>
        ${p.sponsored ? `<span class="tag warn">${esc(t('sponsored'))}</span>` : ''}
      </div>
      ${place ? `<p class="ph-place">${esc(place)}</p>` : ''}
      <div class="ph-tags">
        ${med ? `<span class="ph-stock ${stock[0]}">${esc(stock[1])}</span>` : ''}
        ${typeof p.price === 'number' ? `<span class="tag save">${esc(t('pharmacy_price', { price: rs(p.price) }))}</span>` : ''}
        ${typeof p.km === 'number' ? `<span class="tag">${esc(t('km_away', { km: p.km }))}</span>` : ''}
        ${p.delivery ? `<span class="tag brand">${esc(t('home_delivery'))}</span>` : ''}
      </div>
      ${p.hours ? `<p class="ph-hours"><svg class="ic" aria-hidden="true"><use href="#i-clock"/></svg><span>${esc(p.hours)}</span></p>` : ''}
      <div class="ph-actions">
        ${wa ? `<a class="btn btn-save sm" href="${esc(wa)}" target="_blank" rel="noopener" data-ev="wa"><svg class="ic" aria-hidden="true"><use href="#i-whatsapp"/></svg><span>${esc(t('btn_whatsapp'))}</span></a>` : ''}
        ${phone ? `<a class="btn btn-ghost sm" href="${esc(telHref(phone))}" data-ev="call"><svg class="ic" aria-hidden="true"><use href="#i-phone"/></svg><span>${esc(t('btn_call'))}</span></a>` : ''}
        <a class="btn btn-ghost sm" href="${esc(directionsUrl(p))}" target="_blank" rel="noopener" data-ev="dir"><svg class="ic" aria-hidden="true"><use href="#i-route"/></svg><span>${esc(t('btn_directions'))}</span></a>
        ${p.reserve && med ? `<button type="button" class="btn btn-soft sm" data-reserve aria-expanded="false"><span>${esc(t('btn_reserve'))}</span></button>` : ''}
      </div>
      <div class="ph-reserve" hidden></div>
    </article>`;
  }

  function reserveForm(pid) {
    const f = 'rv-' + pid;
    return `<form class="rv-form" data-rv="${esc(pid)}" autocomplete="on" novalidate>
      <label class="field"><span>${esc(t('reserve_name'))}</span><input class="input" name="name" id="${esc(f)}-name" maxlength="80" autocomplete="name" required></label>
      <label class="field"><span>${esc(t('reserve_phone'))}</span><input class="input" name="phone" id="${esc(f)}-phone" type="tel" inputmode="tel" maxlength="30" autocomplete="tel" required></label>
      <label class="field"><span>${esc(t('reserve_qty'))}</span><input class="input" name="qty" id="${esc(f)}-qty" maxlength="30" value="1"></label>
      <label class="field"><span>${esc(t('reserve_note'))}</span><input class="input" name="note" id="${esc(f)}-note" maxlength="300"></label>
      <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
      <p class="fb-status" role="status" hidden></p>
      <div class="modal-actions"><button type="submit" class="btn btn-primary sm">${esc(t('reserve_send'))}</button></div>
    </form>`;
  }

  function renderNearby(med) {
    const box = $('#med-nearby');
    if (!box) return;
    if (nearby.med !== med.id) nearby.list = [];
    nearby.med = med.id;
    const city = store('sd_city', '');
    const cities = state.cities || [];
    const cityOpts = [...new Set(cities.concat(city ? [city] : []))].sort();
    box.innerHTML = `<div class="nearby-head">
        <h2 class="panel-title" id="nearby-title"><svg class="ic" aria-hidden="true"><use href="#i-map"/></svg><span>${esc(t('nearby_title'))}</span></h2>
        <div class="nearby-tools">
          <label class="sr-only" for="nearby-city">${esc(t('nearby_city'))}</label>
          <select id="nearby-city" class="input select sm">
            <option value="">${esc(nearby.geo ? t('nearby_near_me') : t('nearby_choose_city'))}</option>
            ${cityOpts.map((c) => `<option value="${esc(c)}"${c === city && !nearby.geo ? ' selected' : ''}>${esc(c)}</option>`).join('')}
          </select>
          <button type="button" class="btn btn-ghost sm" id="nearby-locate"><svg class="ic" aria-hidden="true"><use href="#i-route"/></svg><span>${esc(t('nearby_locate'))}</span></button>
        </div>
      </div>
      <div id="nearby-list" class="nearby-list" aria-live="polite"></div>
      <p class="nearby-foot"><a href="${esc(siteLink('business'))}" data-ext-link="business">${esc(t('nearby_own'))}</a></p>`;
    $('#nearby-city', box).addEventListener('change', (e) => {
      save('sd_city', e.target.value);
      nearby.geo = null;
      loadNearby(med);
    });
    $('#nearby-locate', box).addEventListener('click', () => locateAndLoad(med));
    box.onclick = (e) => onNearbyClick(e, med);
    box.onsubmit = (e) => onReserveSubmit(e, med);
    loadNearby(med);
  }

  function nearbyFallback(msgKey) {
    return `<div class="nearby-empty"><p class="muted">${esc(t(msgKey))}</p>
      <a class="btn btn-ghost sm" href="${MAPS_FALLBACK}" target="_blank" rel="noopener"><svg class="ic" aria-hidden="true"><use href="#i-map"/></svg><span>${esc(t('nearby_maps'))}</span></a></div>`;
  }

  async function loadNearby(med) {
    const list = $('#nearby-list');
    if (!list) return;
    const seq = ++nearby.seq;
    if (!canUseApi()) {
      list.innerHTML = nearbyFallback('nearby_empty');
      return;
    }
    list.innerHTML = `<p class="muted small">${esc(t('nearby_loading'))}</p>`;
    const city = nearby.geo ? '' : store('sd_city', '');
    const r = await apiCall(nearbyUrl(med, { city, geo: nearby.geo }), { cache: 'no-store' });
    if (seq !== nearby.seq || nearby.med !== med.id || !$('#nearby-list')) return; // a newer request or page took over
    if (!r.ok) {
      list.innerHTML = nearbyFallback(r.status ? 'nearby_error' : 'nearby_empty');
      return;
    }
    if (Array.isArray(r.data.cities) && r.data.cities.length) {
      const before = (state.cities || []).join('|');
      state.cities = r.data.cities.slice(0, 200).map(String);
      if (before !== state.cities.join('|')) refreshCityOptions();
    } else if (!state.cities && city) {
      // the city-filtered answer has no city list: fetch it once for the picker
      apiCall('api/places?a=cities').then((c) => {
        if (c.ok && Array.isArray(c.data.cities)) { state.cities = c.data.cities.slice(0, 200).map(String); refreshCityOptions(); }
      });
    }
    const items = (Array.isArray(r.data.pharmacies) ? r.data.pharmacies : []).filter((p) => p && typeof p.id === 'string');
    nearby.list = items;
    if (!items.length) {
      list.innerHTML = nearbyFallback('nearby_empty');
      return;
    }
    list.innerHTML = items.map((p) => pharmacyCard(p, med)).join('');
    if (!state.viewedPids) state.viewedPids = new Set();
    items.forEach((p) => {
      if (state.viewedPids.has(p.id)) return;
      state.viewedPids.add(p.id);
      beacon('api/places?a=event', { pid: p.id, type: 'view' });
    });
  }

  function refreshCityOptions() {
    const sel = $('#nearby-city');
    if (!sel) return;
    const current = nearby.geo ? '' : store('sd_city', '');
    const opts = [...new Set((state.cities || []).concat(current ? [current] : []))].sort();
    sel.innerHTML = `<option value="">${esc(nearby.geo ? t('nearby_near_me') : t('nearby_choose_city'))}</option>` +
      opts.map((c) => `<option value="${esc(c)}"${c === current ? ' selected' : ''}>${esc(c)}</option>`).join('');
  }

  function locateAndLoad(med) {
    const btn = $('#nearby-locate');
    if (!navigator.geolocation) { toast(t('nearby_loc_denied')); return; }
    if (btn) btn.disabled = true;
    const list = $('#nearby-list');
    if (list) list.innerHTML = `<p class="muted small">${esc(t('nearby_locating'))}</p>`;
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          nearby.geo = { lat: Math.round(pos.coords.latitude * 1e4) / 1e4, lng: Math.round(pos.coords.longitude * 1e4) / 1e4 };
          if (btn) btn.disabled = false;
          refreshCityOptions();
          loadNearby(med);
        },
        () => {
          if (btn) btn.disabled = false;
          toast(t('nearby_loc_denied'));
          loadNearby(med);
        },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 }
      );
    } catch (e) {
      if (btn) btn.disabled = false;
      toast(t('nearby_loc_denied'));
      loadNearby(med);
    }
  }

  function onNearbyClick(e, med) {
    const card = e.target.closest('[data-pid]');
    if (!card) return;
    const pid = card.dataset.pid;
    const ev = e.target.closest('[data-ev]');
    if (ev) {
      beacon('api/places?a=event', { pid, type: ev.dataset.ev });
      return;
    }
    const rbtn = e.target.closest('[data-reserve]');
    if (rbtn) {
      const box = $('.ph-reserve', card);
      const open = box.hidden;
      box.hidden = !open;
      rbtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open && !box.firstChild) box.innerHTML = reserveForm(pid);
      if (open) { const first = $('input', box); if (first) first.focus(); }
    }
  }

  async function onReserveSubmit(e, med) {
    const form = e.target.closest('[data-rv]');
    if (!form) return;
    e.preventDefault();
    const status = $('.fb-status', form);
    const val = (n) => (form.elements[n] ? String(form.elements[n].value || '').trim() : '');
    if (!val('name') || val('phone').replace(/\D/g, '').length < 7) {
      status.textContent = t('reserve_missing');
      status.className = 'fb-status bad';
      status.hidden = false;
      return;
    }
    const btn = $('button[type="submit"]', form);
    btn.disabled = true;
    const r = await apiCall('api/places?a=reserve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pid: form.dataset.rv, med: med.id, medName: medTitle(med), name: val('name'), phone: val('phone'), qty: val('qty'), note: val('note'), website: val('website') }),
    });
    btn.disabled = false;
    if (r.ok) {
      toast(t('reserve_ok'));
      const box = form.parentElement;
      box.hidden = true;
      box.innerHTML = '';
      const card = box.closest('[data-pid]');
      const rb = card && $('[data-reserve]', card);
      if (rb) rb.setAttribute('aria-expanded', 'false');
      return;
    }
    status.textContent = (r.data && typeof r.data.error === 'string' && r.status && r.status < 500 ? r.data.error : t('reserve_error'));
    status.className = 'fb-status bad';
    status.hidden = false;
  }

  // ------------------------------------------------------------------------
  // QR sticker landing: /?pharmacy=<id> shows a small welcome banner for that pharmacy
  // ------------------------------------------------------------------------
  async function showPharmacyBanner() {
    let pid = '';
    try { pid = new URLSearchParams(location.search).get('pharmacy') || ''; } catch (e) { return; }
    if (!/^p_[a-f0-9]{12}$/.test(pid)) return;
    const r = await apiCall('api/places?a=nearby', { cache: 'no-store' });
    const p = r.ok && Array.isArray(r.data.pharmacies) ? r.data.pharmacies.find((x) => x && x.id === pid) : null;
    const box = $('#pharmacy-banner');
    if (!p || !box) return;
    if (p.city) save('sd_city', p.city);
    beacon('api/places?a=event', { pid: p.id, type: 'view' });
    const wa = waUrl(p, null);
    const phone = p.phone || p.whatsapp;
    box.hidden = false;
    box.innerHTML = `<div class="ph-banner" data-pid="${esc(p.id)}">
      <svg class="ic" aria-hidden="true"><use href="#i-store"/></svg>
      <div class="ph-banner-text"><b>${esc(t('ph_banner', { name: p.name }))}</b>${p.verified ? ` <span class="ph-verified"><svg class="ic" aria-hidden="true"><use href="#i-check"/></svg><span>${esc(t('verified'))}</span></span>` : ''}
        <span class="small muted">${esc([p.area, p.city].filter(Boolean).join(', '))}</span>
        <span class="small">${esc(t('ph_banner_sub'))}</span></div>
      <div class="ph-banner-actions">
        ${wa ? `<a class="btn btn-save sm" href="${esc(wa.replace(/\?text=.*$/, ''))}" target="_blank" rel="noopener" data-ev="wa" aria-label="${esc(t('btn_whatsapp'))}"><svg class="ic" aria-hidden="true"><use href="#i-whatsapp"/></svg></a>` : ''}
        ${phone ? `<a class="btn btn-ghost sm" href="${esc(telHref(phone))}" data-ev="call" aria-label="${esc(t('btn_call'))}"><svg class="ic" aria-hidden="true"><use href="#i-phone"/></svg></a>` : ''}
        <button type="button" class="icon-btn ghost" data-ph-close aria-label="${esc(t('close'))}"><svg class="ic"><use href="#i-x"/></svg></button>
      </div></div>`;
    box.onclick = (e) => {
      if (e.target.closest('[data-ph-close]')) { box.hidden = true; return; }
      const ev = e.target.closest('[data-ev]');
      if (ev) beacon('api/places?a=event', { pid: p.id, type: ev.dataset.ev });
    };
  }

  // ------------------------------------------------------------------------
  // Prescription photo -> medicine names (/api/places?a=rx, only when the site says AI is on)
  // ------------------------------------------------------------------------
  function downscaleImage(file, max, quality) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type || 'image/')) return reject(new Error('not an image'));
      const URLx = window.URL || window.webkitURL;
      const src = URLx.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const w = img.naturalWidth || img.width;
          const h = img.naturalHeight || img.height;
          const s = Math.min(1, (max || 1600) / Math.max(w, h));
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(w * s));
          c.height = Math.max(1, Math.round(h * s));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', quality || 0.8));
        } catch (e) {
          reject(e);
        } finally {
          URLx.revokeObjectURL(src);
        }
      };
      img.onerror = () => { URLx.revokeObjectURL(src); reject(new Error('bad image')); };
      img.src = src;
    });
  }

  function setupRx() {
    const block = $('#rx-block');
    if (!block) return;
    block.hidden = !(state.site && state.site.ai === true && canUseApi());
    if (block.hidden || block.dataset.ready) return;
    block.dataset.ready = '1';
    const btn = $('#rx-btn');
    const file = $('#rx-file');
    btn.addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      const f = file.files && file.files[0];
      file.value = '';
      if (!f) return;
      const label = $('span', btn);
      btn.disabled = true;
      label.textContent = t('rx_reading');
      try {
        const image = await downscaleImage(f, 1600, 0.8);
        const r = await apiCall('api/places?a=rx', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image }) });
        if (r.status === 503) toast(t('rx_off'));
        else if (!r.ok) toast(r.status === 429 && r.data.error ? r.data.error : t('rx_error'));
        else renderRxResult(Array.isArray(r.data.items) ? r.data.items : []);
      } catch (e) {
        toast(t('rx_error'));
      } finally {
        btn.disabled = false;
        label.textContent = t('rx_btn');
      }
    });
    $('#rx-result').addEventListener('click', (e) => {
      if (e.target.closest('[data-rx-close]')) { $('#rx-result').hidden = true; return; }
      const add = e.target.closest('[data-rx-add]');
      if (!add) return;
      let n = 0;
      add.dataset.rxAdd.split(',').filter(Boolean).forEach((id) => { if (state.engine.byId(id) && cabinet.add(id)) n++; });
      toast(t('rx_added', { n }));
    });
  }

  function renderRxResult(items) {
    const box = $('#rx-result');
    const matched = items.filter((it) => it && it.match && state.engine.byId(it.match.id));
    box.hidden = false;
    box.innerHTML = `<div class="rx-head"><h2 class="hs-title">${esc(t('rx_title'))}</h2>
        <button type="button" class="icon-btn ghost sm" data-rx-close aria-label="${esc(t('close'))}"><svg class="ic"><use href="#i-x"/></svg></button></div>
      ${items.length ? `<ul class="rx-list">${items.filter(Boolean).map((it) => {
        const read = String(it.read || '') + (it.strength ? ' ' + String(it.strength) : '');
        const m = it.match && state.engine.byId(it.match.id);
        return `<li><span class="rx-read">${esc(read)}</span>${m
          ? `<a href="#/medicine/${encodeURIComponent(m.id)}">${esc(medTitle(m))} · ${rs(m.price)}</a>`
          : `<a href="#/search/${encodeURIComponent(String(it.read || ''))}" class="muted">${esc(t('rx_no_match'))}</a>`}</li>`;
      }).join('')}</ul>` : `<p class="muted small">${esc(t('rx_none'))}</p>`}
      ${matched.length ? `<button type="button" class="btn btn-primary sm" data-rx-add="${esc(matched.map((it) => it.match.id).join(','))}"><svg class="ic" aria-hidden="true"><use href="#i-plus"/></svg><span>${esc(t('rx_add_all'))}</span></button>` : ''}
      <p class="small muted">${esc(t('rx_note'))}</p>`;
  }

  // ------------------------------------------------------------------------
  // Search box + autocomplete
  // ------------------------------------------------------------------------
  function updateSearchButtons() {
    const has = $('#search-input').value.trim().length > 0;
    $('#search-clear').hidden = !has;
  }

  function closeSuggest() {
    const box = $('#suggest');
    box.hidden = true;
    box.innerHTML = '';
    state.suggestions = [];
    state.activeSuggestion = -1;
    $('#search-input').setAttribute('aria-expanded', 'false');
  }

  function renderSuggest(q) {
    if (!state.engine || q.trim().length < 2) return closeSuggest();
    let list = state.engine.suggest(q, 8);
    // Registered brands without a DRAP price (brand-name matches only). They fill the remaining
    // slots, or go first when no priced brand NAME matches ("starc" -> Starcox before starch fluids).
    const qn = window.SDSearch.normalize(q);
    const pricedNameHit = list.some((m) => window.SDSearch.normalize(m.name).startsWith(qn));
    const unpricedFirst = !pricedNameHit;
    const room = unpricedFirst ? 5 : 8 - list.length;
    const unpriced = state.reg && room > 0 ? state.reg.search(q, { limit: room, minScore: 70 }).map((r) => r.med) : [];
    if (unpricedFirst && unpriced.length) list = list.slice(0, 8 - unpriced.length);
    state.suggestions = list;
    state.activeSuggestion = -1;
    const box = $('#suggest');
    const unpricedLis = unpriced
      .map((m, i) => `<li role="option" id="sg-u${i}" data-reg="${esc(m.reg)}" aria-selected="false">
          <div class="sg-main"><div class="sg-name">${highlight(m.name, q)} <span class="muted">${esc(m.strength)}</span></div>
          <div class="sg-meta">${m.generic ? highlight(m.generic, q) + ' · ' : ''}${esc(m.form)}</div></div>
          <div class="sg-price"><small>${esc(t('no_drap_price'))}</small></div></li>`)
      .join('');
    if (!list.length && unpriced.length) {
      box.innerHTML = unpricedLis;
    } else if (!list.length) {
      const dym = state.engine.didYouMean(q, 4);
      if (!dym.length) return closeSuggest();
      box.innerHTML = `<li class="sg-head" role="presentation">${esc(t('did_you_mean'))}</li>` + dym.map((d) => `<li role="option" data-q="${esc(d)}"><div class="sg-main"><div class="sg-name">${esc(d)}</div></div></li>`).join('');
    } else {
      box.innerHTML = list
        .map((m, i) => `<li role="option" id="sg-${i}" data-id="${esc(m.id)}" aria-selected="false">
          <div class="sg-main"><div class="sg-name">${highlight(m.name, q)} <span class="muted">${esc(m.strength)}</span></div>
          <div class="sg-meta">${highlight(m.generic, q)} · ${esc(m.form)}</div></div>
          <div class="sg-price num">${rs(m.unitPrice)}<small>${esc(t('per_unit', { unit: unitWord(m) }))}</small></div></li>`)
        .join('');
      box.innerHTML = unpricedFirst ? unpricedLis + box.innerHTML : box.innerHTML + unpricedLis;
    }
    box.hidden = false;
    $('#search-input').setAttribute('aria-expanded', 'true');
  }

  function moveSuggest(dir) {
    const items = $$('#suggest li[role="option"]');
    if (!items.length) return;
    state.activeSuggestion = (state.activeSuggestion + dir + items.length) % items.length;
    items.forEach((li, i) => li.setAttribute('aria-selected', i === state.activeSuggestion ? 'true' : 'false'));
    const active = items[state.activeSuggestion];
    active.scrollIntoView({ block: 'nearest' });
    $('#search-input').setAttribute('aria-activedescendant', active.id || '');
  }

  function pickSuggestion(li) {
    if (!li) return;
    if (li.dataset.id) {
      state.lastQuery = $('#search-input').value.trim();
      go('/medicine/' + encodeURIComponent(li.dataset.id));
    } else if (li.dataset.reg) {
      state.lastQuery = $('#search-input').value.trim();
      go('/brand/' + encodeURIComponent(li.dataset.reg));
    } else if (li.dataset.q) {
      $('#search-input').value = li.dataset.q;
      go('/search/' + encodeURIComponent(li.dataset.q));
    }
    closeSuggest();
    $('#search-input').blur();
  }

  function setupSearch() {
    const input = $('#search-input');
    let timer;
    input.addEventListener('input', () => {
      updateSearchButtons();
      clearTimeout(timer);
      timer = setTimeout(() => renderSuggest(input.value), 60);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveSuggest(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveSuggest(-1); }
      else if (e.key === 'Escape') closeSuggest();
      else if (e.key === 'Enter' && state.activeSuggestion >= 0) {
        e.preventDefault();
        pickSuggestion($$('#suggest li[role="option"]')[state.activeSuggestion]);
      }
    });
    input.addEventListener('focus', () => input.value.trim().length >= 2 && renderSuggest(input.value));
    $('#suggest').addEventListener('mousedown', (e) => {
      const li = e.target.closest('li[role="option"]');
      if (li) { e.preventDefault(); pickSuggestion(li); }
    });
    document.addEventListener('click', (e) => { if (!e.target.closest('#search')) closeSuggest(); });
    $('#search-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return input.focus();
      closeSuggest();
      input.blur();
      go('/search/' + encodeURIComponent(q));
    });
    $('#search-clear').addEventListener('click', () => {
      input.value = '';
      updateSearchButtons();
      closeSuggest();
      input.focus();
    });

    // Voice search (Chrome / Android): great for brand names that are hard to spell
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      const mic = $('#search-mic');
      mic.hidden = false;
      mic.addEventListener('click', () => {
        const rec = new SR();
        rec.lang = 'en-PK';
        rec.interimResults = false;
        rec.maxAlternatives = 1;
        mic.classList.add('active');
        rec.onresult = (ev) => {
          const said = ev.results[0][0].transcript.replace(/[.?!]$/, '');
          input.value = said;
          updateSearchButtons();
          go('/search/' + encodeURIComponent(said));
        };
        rec.onend = () => mic.classList.remove('active');
        rec.onerror = () => mic.classList.remove('active');
        rec.start();
      });
    }
  }

  // ------------------------------------------------------------------------
  // Language & theme
  // ------------------------------------------------------------------------
  function applyLanguage() {
    const lang = I18N.getLang();
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ur' ? 'rtl' : 'ltr';
    $$('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)));
    $$('[data-lang]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.lang === lang ? 'true' : 'false'));
    $('#search-input').placeholder = t('search_placeholder');
    $('#assistant-text').placeholder = t('as_placeholder');
    renderAccountNav();
    const rxFile = $('#rx-file');
    if (rxFile) rxFile.setAttribute('aria-label', t('rx_btn'));
    if (state.ds) {
      $('#footer-source').textContent = t('footer_source', { date: fmtDate((state.ds.meta.synced_at || '').slice(0, 10)) });
    }
  }

  /** pref: 'light' | 'dark' | 'system' (follow the phone / computer setting) */
  function applyTheme(pref) {
    const p = pref === 'light' || pref === 'dark' ? pref : 'system';
    const systemDark = !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    const resolved = p === 'system' ? (systemDark ? 'dark' : 'light') : p;
    document.documentElement.setAttribute('data-theme', resolved);
    $$('[data-theme-set]').forEach((b) => {
      b.setAttribute('aria-pressed', b.dataset.themeSet === p ? 'true' : 'false');
      const label = t('theme_' + b.dataset.themeSet);
      b.setAttribute('aria-label', label);
      b.title = label;
    });
    const seg = $('#theme-seg');
    if (seg) seg.setAttribute('aria-label', t('theme_label'));
    const meta = $('#meta-theme');
    if (meta) meta.setAttribute('content', resolved === 'dark' ? '#0b1412' : '#0f5c54');
  }

  // ------------------------------------------------------------------------
  // Site settings from the admin panel (announcement, price fixes, contact)
  // ------------------------------------------------------------------------
  /**
   * Admin settings (price fixes, hidden products, announcement). Runs in parallel with the
   * medicine data download. On a slow or broken connection, fall back to the last settings this
   * browser received, so price fixes and hidden products still apply.
   */
  async function fetchSiteConfig() {
    if (!canUseApi()) return null;
    try {
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = setTimeout(() => ctrl && ctrl.abort(), 8000);
      const res = await fetch(apiUrl('api/config'), { cache: 'no-cache', ...(ctrl ? { signal: ctrl.signal } : {}) });
      clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const cfg = await res.json();
      save('sd_site', cfg);
      return cfg;
    } catch (e) {
      return store('sd_site', null);
    }
  }

  function renderAnnouncement() {
    const box = $('#announce');
    const a = state.site && state.site.announcement;
    const text = a && (I18N.getLang() === 'ur' ? a.ur || a.en : a.en || a.ur);
    let dismissed = null;
    try { dismissed = sessionStorage.getItem('sd_announce_closed'); } catch (e) { /* ignore */ }
    if (!text || dismissed === text) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    box.innerHTML = `<div class="announce tone-${esc(a.tone)}" role="note"><svg class="ic"><use href="#i-${a.tone === 'warn' ? 'alert' : 'info'}"/></svg><span>${esc(text)}</span>
      <button type="button" class="icon-btn ghost sm" id="announce-close" aria-label="${esc(t('close'))}"><svg class="ic"><use href="#i-x"/></svg></button></div>`;
    $('#announce-close').onclick = () => {
      try { sessionStorage.setItem('sd_announce_closed', text); } catch (e) { /* ignore */ }
      box.hidden = true;
    };
  }

  function renderContact() {
    const c = state.site && state.site.contact;
    if (!c) return;
    const links = [];
    if (c.phone) links.push(`<a class="footer-link" href="tel:${esc(c.phone.replace(/[^\d+]/g, ''))}">${esc(c.phone)}</a>`);
    if (c.whatsapp) links.push(`<a class="footer-link" href="https://wa.me/${esc(c.whatsapp.replace(/\D/g, ''))}" target="_blank" rel="noopener">${esc(t('footer_whatsapp'))}: ${esc(c.whatsapp)}</a>`);
    if (c.email) links.push(`<a class="footer-link" href="mailto:${esc(c.email)}">${esc(c.email)}</a>`);
    $('#footer-contact').innerHTML = links.join('');
  }

  // ------------------------------------------------------------------------
  // Report a wrong price / request a medicine / suggestion
  // ------------------------------------------------------------------------
  const fb = { type: 'other', med: null, query: '', lastFocus: null };

  function openFeedback(type, opts) {
    const o = opts || {};
    fb.type = type;
    fb.med = o.med || null;
    fb.query = o.query || '';
    fb.lastFocus = document.activeElement;
    const kind = type === 'wrong_price' ? 'price' : type === 'missing' ? 'missing' : 'general';
    $('#fb-title').textContent = t('fb_title_' + kind);
    $('#fb-intro').textContent = t('fb_intro_' + kind);
    const about = $('#fb-about');
    if (fb.med) {
      about.hidden = false;
      about.textContent = `${medTitle(fb.med)} · ${fb.med.pack || fb.med.form} · ${rs(fb.med.price)}`;
    } else if (fb.query) {
      about.hidden = false;
      about.textContent = fb.query;
    } else about.hidden = true;
    $('#fb-message').value = '';
    $('#fb-status').hidden = true;
    $('#fb-send').disabled = false;
    $('#fb-modal').hidden = false;
    document.body.classList.add('modal-open');
    setTimeout(() => $('#fb-message').focus(), 30);
  }

  function closeFeedback() {
    $('#fb-modal').hidden = true;
    document.body.classList.remove('modal-open');
    if (fb.lastFocus && fb.lastFocus.focus) fb.lastFocus.focus();
  }

  function setupFeedback() {
    $$('#fb-modal [data-close]').forEach((el) => el.addEventListener('click', closeFeedback));
    $('#fb-modal').addEventListener('keydown', (e) => { if (e.key === 'Escape') closeFeedback(); });
    $('#footer-feedback').addEventListener('click', () => openFeedback('suggestion'));
    $('#empty-request').addEventListener('click', () => openFeedback('missing', { query: state.lastQuery || (state.route && state.route.q) || '' }));
    $('#fb-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const message = $('#fb-message').value.trim();
      const status = $('#fb-status');
      if (!message) {
        status.textContent = t('fb_empty');
        status.className = 'fb-status bad';
        status.hidden = false;
        return;
      }
      $('#fb-send').disabled = true;
      status.textContent = t('fb_sending');
      status.className = 'fb-status';
      status.hidden = false;
      try {
        const res = await fetch(apiUrl('api/feedback'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: fb.type,
            message,
            contact: $('#fb-contact').value.trim(),
            medicine_id: fb.med ? fb.med.id : '',
            medicine_name: fb.med ? medTitle(fb.med) : '',
            query: fb.query,
            lang: I18N.getLang(),
            website: $('#fb-website').value,
          }),
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        closeFeedback();
        toast(t('fb_thanks'));
      } catch (err) {
        status.textContent = t('fb_error');
        status.className = 'fb-status bad';
        $('#fb-send').disabled = false;
      }
    });
  }

  // ------------------------------------------------------------------------
  // Init
  // ------------------------------------------------------------------------
  function setupGlobal() {
    $$('[data-lang]').forEach((b) =>
      b.addEventListener('click', () => {
        I18N.setLang(b.dataset.lang);
        applyLanguage();
        applyTheme(store('sd_theme', 'system'));
        renderAnnouncement();
        renderContact();
        render();
        window.SDAssistantUI && window.SDAssistantUI.refresh();
      })
    );
    $$('[data-theme-set]').forEach((b) =>
      b.addEventListener('click', () => {
        save('sd_theme', b.dataset.themeSet);
        applyTheme(b.dataset.themeSet);
      })
    );
    if (window.matchMedia) {
      const mq = matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => { if (store('sd_theme', 'system') === 'system') applyTheme('system'); };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
    }
    $('#recent-clear').addEventListener('click', () => {
      save('sd_recent', []);
      renderHome();
    });
    $('#alt-sort').addEventListener('change', (e) => {
      state.altSort = e.target.value;
      const med = state.engine.byId(state.route.id);
      if (med) renderAlternatives(med);
    });
    let ft;
    $('#category-filter').addEventListener('input', () => {
      clearTimeout(ft);
      ft = setTimeout(() => { state.categoryLimit = 30; renderCategory(state.route.id, false); }, 120);
    });
    $('#category-form').addEventListener('change', () => { state.categoryLimit = 30; renderCategory(state.route.id, false); });
    $('#category-more').addEventListener('click', () => { state.categoryLimit += 30; renderCategory(state.route.id, false); });
    window.addEventListener('hashchange', render);
    // Compare buttons live on result cards, the medicine page, the tray and the compare view.
    document.addEventListener('click', (e) => {
      const tog = e.target.closest('[data-compare]');
      if (tog) {
        e.preventDefault();
        onCompareToggle(tog.dataset.compare, tog);
        return;
      }
      const rm = e.target.closest('[data-compare-remove]');
      if (rm) {
        compare.remove(rm.dataset.compareRemove);
        if (state.route.name === 'compare') renderCompare();
        return;
      }
      if (e.target.closest('[data-compare-clear]')) {
        compare.clear();
        if (state.route.name === 'compare') renderCompare();
      }
    });
  }

  async function init() {
    const ua = navigator.userAgent || '';
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    document.documentElement.classList.add(isIOS ? 'is-ios' : 'not-ios');
    I18N.initLang();
    applyTheme(store('sd_theme', 'system'));
    applyLanguage();
    setupGlobal();
    setupSearch();
    setupFeedback();
    updateCabinetBadge();
    const yr = $('#copyright-year');
    if (yr) yr.textContent = new Date().getFullYear();
    const sitePromise = fetchSiteConfig();
    try {
      state.ds = await window.SDData.load('data/medicines.json');
      state.site = await sitePromise;
      if (state.site && state.site.overrides) window.SDData.applyOverrides(state.ds, state.site.overrides);
      state.engine = window.SDSearch.createEngine(state.ds);
    } catch (e) {
      console.error(e);
      $('#loading').innerHTML = `<span>${esc(t('load_error'))}</span>`;
      return;
    }
    $('#loading').hidden = true;
    applyLanguage();
    renderAnnouncement();
    renderContact();
    updateCabinetBadge();
    render();
    setupRx();
    if (window.SDAssistantUI) window.SDAssistantUI.init({ engine: state.engine, ds: state.ds, app: api });
    loadRegistryInBackground();
    // Accounts and the pharmacy QR landing: in the background, never blocking the page.
    loadAccount().catch(() => {});
    showPharmacyBanner().catch(() => {});
    // Build the search index once the page is on screen, before the visitor starts typing.
    // (If they type first, the first search builds it.)
    const warm = () => state.engine.warm && state.engine.warm();
    if (window.requestIdleCallback) requestIdleCallback(warm, { timeout: 1500 });
    else setTimeout(warm, 200);
  }

  const api = {
    state,
    go,
    rs,
    unitWord,
    medTitle,
    medMeta,
    esc,
    toast,
    cabinet,
    compare,
    monthlyCost,
    render,
    renderCabinet,
    // exposed for tests and the account portal
    cabinetPayload,
    syncCabinetNow,
    loadAccount,
    waDigits,
  };
  window.SDApp = api;

  if (!NATIVE && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  api.ready = document.readyState === 'loading'
    ? new Promise((resolve) => document.addEventListener('DOMContentLoaded', () => resolve(init())))
    : init();
})();
