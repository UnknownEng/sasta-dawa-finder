/**
 * Sasta Dawa Finder - application controller (routing, rendering, My Medicines).
 */
(function () {
  'use strict';

  const I18N = window.SDI18n;
  const t = I18N.t;
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => [...(el || document).querySelectorAll(sel)];

  const state = {
    ds: null,
    engine: null,
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
      list.push({ id, qty: med && med.unit === 'unit' ? 1 : 1 });
      save('sd_cabinet', list);
      updateCabinetBadge();
      return true;
    },
    remove(id) {
      save('sd_cabinet', store('sd_cabinet', []).filter((x) => x.id !== id));
      updateCabinetBadge();
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
    },
    setQty(id, qty) {
      const list = store('sd_cabinet', []);
      const item = list.find((x) => x.id === id);
      if (item) item.qty = Math.max(0, Math.min(99, qty));
      save('sd_cabinet', list);
    },
  };

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
  // Routing
  // ------------------------------------------------------------------------
  const VIEWS = ['home', 'search', 'category', 'medicine', 'cabinet', 'empty'];

  function parseHash() {
    const h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
    const [name, ...rest] = h.split('/');
    const arg = rest.join('/');
    if (name === 'search' && arg) return { name: 'search', q: arg };
    if (name === 'medicine' && arg) return { name: 'medicine', id: arg };
    if (name === 'category' && arg) return { name: 'category', id: arg };
    if (name === 'my-medicines') return { name: 'cabinet' };
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
    closeSuggest();
    if (r.name === 'search') renderSearch(r.q);
    else if (r.name === 'medicine') renderMedicine(r.id);
    else if (r.name === 'category') renderCategory(r.id, true);
    else if (r.name === 'cabinet') renderCabinet();
    else renderHome();
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
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
    return `<a class="result" href="#/medicine/${encodeURIComponent(med.id)}">
      <div><div class="r-name">${highlight(med.name, q)} <span class="r-strength">${esc(med.strength)}</span></div>
      <div class="r-meta">${highlight(med.generic, q)} · ${esc(med.form)} · ${esc(med.pack)}</div>
      ${tags.length ? `<div class="r-tags">${tags.join('')}</div>` : ''}</div>
      <div class="r-price"><b class="num">${rs(med.unitPrice)}</b><span>${esc(t('per_unit', { unit: unitWord(med) }))}</span></div>
    </a>`;
  }

  function renderSearch(q) {
    state.lastQuery = q;
    const input = $('#search-input');
    if (document.activeElement !== input) input.value = q;
    updateSearchButtons();
    const raw = state.engine.search(q, { limit: 200 });
    if (!raw.length) return renderNotFound(q);
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
    $('#search-sub').textContent = t('results_count', { n: results.length >= 80 ? '80+' : results.length });
    $('#search-results').innerHTML =
      results.map((r) => resultRow(r.med, q, null, r.packs)).join('') +
      (results.length >= 80 ? `<p class="more-note">${esc(t('results_more', { n: 80 }))}</p>` : '');
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
        <dt>${esc(t('reg_no'))}</dt><dd>${esc(med.reg || '—')}</dd>
      </dl>
      <div class="mh-actions">
        <button type="button" class="btn ${inCab ? 'btn-soft' : 'btn-primary'}" id="btn-cabinet">
          <svg class="ic"><use href="#${inCab ? 'i-check' : 'i-plus'}"/></svg><span>${esc(t(inCab ? 'in_cabinet' : 'add_cabinet'))}</span></button>
        <button type="button" class="btn btn-ghost" id="btn-share"><svg class="ic"><use href="#i-share"/></svg><span>${esc(t('share'))}</span></button>
        <a class="btn btn-ghost" href="https://www.google.com/maps/search/pharmacy+near+me" target="_blank" rel="noopener"><svg class="ic"><use href="#i-map"/></svg><span>${esc(t('find_pharmacy'))}</span></a>
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
    let noticeHtml = '';
    if (NARROW_THERAPEUTIC.test(med.generic) && alts.length > 1) {
      noticeHtml = `<div class="notice"><svg class="ic"><use href="#i-alert"/></svg><span>${esc(t('switch_warning'))}</span></div>`;
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
    $('#alt-list').innerHTML = alts
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
    const url = location.origin + location.pathname + '#/medicine/' + encodeURIComponent(med.id);
    const text = shareText(med);
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
    if (!list.length) {
      body.innerHTML = `<div class="empty"><div class="empty-ic"><svg class="ic"><use href="#i-list"/></svg></div>
        <h2 class="view-title">${esc(t('cabinet_empty_t'))}</h2><p class="view-sub">${esc(t('cabinet_empty_d'))}</p>
        <div class="chips center" style="margin-top:16px">${state.engine.popular(6).map((m) => `<a class="chip" href="#/medicine/${encodeURIComponent(m.id)}">${esc(m.name)}</a>`).join('')}</div></div>`;
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
    body.innerHTML = `
      <div class="cab-summary">
        <div class="stat"><small>${esc(t('monthly_now'))}</small><b class="num">${rs(now)}</b></div>
        <div class="stat"><small>${esc(t('monthly_cheapest'))}</small><b class="num">${rs(best)}</b></div>
        <div class="stat good"><small>${esc(t('monthly_save'))}</small><b class="num">${rs(saveAmt)}</b><div class="sub">${esc(t('yearly_save', { amount: rs(saveAmt * 12) }))}</div></div>
      </div>
      <div class="cab-list">${rows.join('')}</div>
      <div class="cab-tools">
        <button type="button" class="btn btn-ghost" id="cab-share"><svg class="ic"><use href="#i-share"/></svg>${esc(t('share_list'))}</button>
        <button type="button" class="btn btn-ghost" id="cab-print"><svg class="ic"><use href="#i-print"/></svg>${esc(t('print_list'))}</button>
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
    $('#cab-print').onclick = () => window.print();
    $('#cab-share').onclick = () => {
      const lines = cabinet.list().map(({ id, qty }) => {
        const m = state.engine.byId(id);
        const c = state.engine.cheapest(m);
        return `• ${medTitle(m)} (${m.generic}) — ${rs(monthlyCost(m, qty))}/month` + (c.id !== m.id ? ` → ${c.name}: ${rs(monthlyCost(m, qty, c))}/month` : '');
      });
      const text = `My medicines (DRAP prices)\n${lines.join('\n')}\nPossible saving: ${rs(saveAmt)}/month\n— Sasta Dawa Finder`;
      window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
    };
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
    const list = state.engine.suggest(q, 8);
    state.suggestions = list;
    state.activeSuggestion = -1;
    const box = $('#suggest');
    if (!list.length) {
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
  async function fetchSiteConfig() {
    if (!location.protocol.startsWith('http')) return null;
    try {
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = setTimeout(() => ctrl && ctrl.abort(), 2500);
      const res = await fetch('api/config', { cache: 'no-cache', ...(ctrl ? { signal: ctrl.signal } : {}) });
      clearTimeout(timer);
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
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
        const res = await fetch('api/feedback', {
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
  }

  async function init() {
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
    if (window.SDAssistantUI) window.SDAssistantUI.init({ engine: state.engine, ds: state.ds, app: api });
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
    monthlyCost,
    render,
    renderCabinet,
  };
  window.SDApp = api;

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  api.ready = document.readyState === 'loading'
    ? new Promise((resolve) => document.addEventListener('DOMContentLoaded', () => resolve(init())))
    : init();
})();
