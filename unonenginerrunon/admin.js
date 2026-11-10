/**
 * Sasta Dawa Finder - admin panel (served at /unonenginerrunon, never linked from the site).
 * All data comes from /api/admin, which requires the ADMIN_PASSWORD sign-in.
 */
(function () {
  'use strict';

  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => [...(el || document).querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rs = (v) => (typeof v === 'number' && isFinite(v) ? 'Rs ' + v.toLocaleString('en-PK', { maximumFractionDigits: 2 }) : '—');
  const fmtDate = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso.length <= 10 ? iso + 'T00:00:00Z' : iso);
    return isNaN(d) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  };
  const fmtWhen = (iso) => {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const mins = Math.round((Date.now() - d) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + ' min ago';
    if (mins < 1440) return Math.round(mins / 60) + ' h ago';
    return fmtDate(iso);
  };

  const state = { cfg: null, overview: null, feedback: [], filter: 'open', engine: null, ds: null, dirty: false, selected: null };

  let toastTimer;
  function toast(msg, bad) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.toggle('bad', !!bad);
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  async function api(action, body) {
    const opts = { method: body ? 'POST' : 'GET', credentials: 'same-origin', headers: { 'X-SD-Admin': '1' }, cache: 'no-store' };
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch('/api/admin?a=' + encodeURIComponent(action), opts);
    let data = {};
    try { data = await res.json(); } catch (e) { /* empty */ }
    if (res.status === 401 && action !== 'login') {
      showLogin();
      throw new Error(data.error || 'Please sign in');
    }
    if (!res.ok) throw new Error(data.error || 'Request failed (' + res.status + ')');
    return data;
  }

  // ------------------------------------------------------------------------
  // Theme (shares the site's preference)
  // ------------------------------------------------------------------------
  $('#ad-theme').addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('sd_theme', JSON.stringify(next)); } catch (e) { /* ignore */ }
  });

  // ------------------------------------------------------------------------
  // Sign in / out
  // ------------------------------------------------------------------------
  function showLogin(note) {
    $('#booting').hidden = true;
    $('#panel').hidden = true;
    $('#login').hidden = false;
    if (note) $('#login-note').textContent = note;
    setTimeout(() => $('#login-password').focus(), 50);
  }

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#login-btn');
    btn.disabled = true;
    $('#login-error').hidden = true;
    try {
      await api('login', { password: $('#login-password').value });
      $('#login-password').value = '';
      await openPanel();
    } catch (err) {
      $('#login-error').textContent = err.message;
      $('#login-error').hidden = false;
    } finally {
      btn.disabled = false;
    }
  });

  $('#logout').addEventListener('click', async () => {
    try { await api('logout', {}); } catch (e) { /* ignore */ }
    showLogin('Signed out.');
  });

  // ------------------------------------------------------------------------
  // Tabs
  // ------------------------------------------------------------------------
  function setTab(name) {
    $$('[role="tab"]').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === name ? 'true' : 'false'));
    $$('[data-pane]').forEach((p) => (p.hidden = p.dataset.pane !== name));
    try { sessionStorage.setItem('sd_admin_tab', name); } catch (e) { /* ignore */ }
    if (name === 'prices') ensureData();
    window.scrollTo(0, 0);
  }
  $$('[role="tab"]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-goto]');
    if (g) setTab(g.dataset.goto);
  });

  // ------------------------------------------------------------------------
  // Overview
  // ------------------------------------------------------------------------
  function renderOverview() {
    const o = state.overview;
    const d = o.data;
    const open = state.feedback.filter((f) => f.status !== 'done').length;
    $('#ov-stats').innerHTML = [
      ['Medicines listed', d.products.toLocaleString('en-PK'), 'DRAP-registered products'],
      ['Same-formula groups', d.formulas.toLocaleString('en-PK'), 'where cheaper brands are compared'],
      ['Prices updated to', fmtDate(d.latest_price_date), 'downloaded ' + fmtDate((d.synced_at || '').slice(0, 10))],
      ['Price fixes active', String(Object.keys(state.cfg.overrides).length), 'your corrections'],
      ['Open reports', String(open), open ? 'waiting in the inbox' : 'all caught up', open ? 'attn' : ''],
    ]
      .map(([k, v, sub, cls]) => `<div class="ad-stat ${cls || ''}"><small>${esc(k)}</small><b>${esc(v)}</b><span>${esc(sub)}</span></div>`)
      .join('');
    const ai = o.ai;
    const aiState = ai.keySet && ai.enabled ? ['ok', `On (${ai.model})`] : ai.keySet ? ['warn', 'Switched off in Site settings'] : ['off', 'Offline answers only (no ANTHROPIC_API_KEY set)'];
    const an = state.cfg.announcement;
    $('#ov-status').innerHTML = [
      ['AI assistant', ...aiState],
      ['Announcement', an.on && (an.en || an.ur) ? 'ok' : 'off', an.on && (an.en || an.ur) ? 'Showing: “' + (an.en || an.ur).slice(0, 60) + '”' : 'None'],
      ['Saved data', o.storageOk === false ? 'warn' : 'ok', o.storage],
      ['Settings last saved', state.cfg.updatedAt ? 'ok' : 'off', state.cfg.updatedAt ? fmtWhen(state.cfg.updatedAt) : 'Never (using defaults)'],
    ]
      .map(([k, s, v]) => `<li><span class="dot ${s}"></span><b>${esc(k)}</b><span>${esc(v)}</span></li>`)
      .join('');
    const badge = $('#inbox-badge');
    badge.textContent = open;
    badge.hidden = open === 0;
  }

  // ------------------------------------------------------------------------
  // Inbox
  // ------------------------------------------------------------------------
  const TYPE_LABEL = { wrong_price: 'Wrong price', missing: 'Missing medicine', suggestion: 'Suggestion', other: 'Other' };

  function renderInbox() {
    $$('[data-filter]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.filter === state.filter ? 'true' : 'false'));
    const items = state.feedback.filter((f) => state.filter === 'all' || f.status !== 'done');
    if (!items.length) {
      $('#inbox-list').innerHTML = `<div class="ad-empty">${state.filter === 'open' ? 'No open reports. 🎉' : 'No reports yet.'}<br><span class="muted small">Visitors can send reports from any medicine page (“Report a wrong price”) or when a search finds nothing.</span></div>`;
      return;
    }
    $('#inbox-list').innerHTML = items
      .map((f) => {
        const med = f.medicine_id ? `<a href="/#/medicine/${encodeURIComponent(f.medicine_id)}" target="_blank" rel="noopener">${esc(f.medicine_name || f.medicine_id)} ↗</a>` : '';
        return `<article class="ad-item ${f.status === 'done' ? 'done' : ''}" data-key="${esc(f.key)}">
          <div class="ad-item-top"><span class="tag ${f.type === 'wrong_price' ? 'warn' : f.type === 'missing' ? 'brand' : ''}">${esc(TYPE_LABEL[f.type] || 'Other')}</span>
            <span class="muted small">${esc(fmtWhen(f.at))}${f.lang === 'ur' ? ' · Urdu' : ''}</span></div>
          ${med ? `<p class="ad-item-med">${med}</p>` : ''}
          ${f.query ? `<p class="ad-item-med">Searched for: <b>${esc(f.query)}</b></p>` : ''}
          ${f.message ? `<p class="ad-item-msg" ${f.lang === 'ur' ? 'dir="auto"' : ''}>${esc(f.message)}</p>` : ''}
          ${f.contact ? `<p class="small">Contact: <b>${esc(f.contact)}</b></p>` : ''}
          <div class="ad-item-actions">
            ${f.type === 'wrong_price' && f.medicine_id ? `<button type="button" class="btn btn-soft sm" data-act="fix" data-id="${esc(f.medicine_id)}">Fix this price</button>` : ''}
            <button type="button" class="btn btn-ghost sm" data-act="${f.status === 'done' ? 'reopen' : 'done'}">${f.status === 'done' ? 'Reopen' : 'Mark done'}</button>
            <button type="button" class="btn btn-ghost sm danger" data-act="delete">Delete</button>
          </div></article>`;
      })
      .join('');
  }

  $$('[data-filter]').forEach((b) => b.addEventListener('click', () => { state.filter = b.dataset.filter; renderInbox(); }));

  $('#inbox-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const key = btn.closest('[data-key]').dataset.key;
    const act = btn.dataset.act;
    if (act === 'fix') {
      setTab('prices');
      await ensureData();
      selectMedicine(btn.dataset.id);
      return;
    }
    if (act === 'delete' && !confirm('Delete this report? This cannot be undone.')) return;
    btn.disabled = true;
    try {
      if (act === 'delete') {
        await api('feedback-delete', { key });
        state.feedback = state.feedback.filter((f) => f.key !== key);
        toast('Report deleted');
      } else {
        await api('feedback-update', { key, status: act === 'done' ? 'done' : 'new' });
        const f = state.feedback.find((x) => x.key === key);
        if (f) f.status = act === 'done' ? 'done' : 'new';
        toast(act === 'done' ? 'Marked as done' : 'Reopened');
      }
      renderInbox();
      renderOverview();
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false;
    }
  });

  // ------------------------------------------------------------------------
  // Price fixes
  // ------------------------------------------------------------------------
  let dataPromise = null;
  function ensureData() {
    if (!dataPromise) {
      $('#pf-results').innerHTML = '<p class="muted small">Loading medicine list…</p>';
      dataPromise = window.SDData.load('/data/medicines.json').then((ds) => {
        state.ds = ds;
        state.engine = window.SDSearch.createEngine(ds);
        $('#pf-results').innerHTML = '';
        renderFixes();
      }).catch((e) => {
        dataPromise = null;
        $('#pf-results').innerHTML = `<p class="ad-error">${esc(e.message)}</p>`;
      });
    }
    return dataPromise;
  }

  function unitLabel(m) {
    if (m.unit === 'unit') return /capsule/i.test(m.form) ? 'capsule' : 'tablet';
    return { ml: 'ml', g: 'g', dose: 'dose', pack: 'pack' }[m.unit] || m.unit;
  }

  let st;
  $('#pf-search').addEventListener('input', () => {
    clearTimeout(st);
    st = setTimeout(() => {
      const q = $('#pf-search').value.trim();
      if (!state.engine || q.length < 2) { $('#pf-results').innerHTML = ''; return; }
      const res = state.engine.search(q, { limit: 12 });
      $('#pf-results').innerHTML = res.length
        ? res.map(({ med: m }) => `<button type="button" class="ad-result" data-id="${esc(m.id)}"><span><b>${esc(m.name)}</b> ${esc(m.strength)} <span class="muted">· ${esc(m.form)} · ${esc(m.pack)}</span><br><span class="muted small">${esc(m.manufacturer)}</span></span><span class="num">${rs(m.price)}</span></button>`).join('')
        : '<p class="muted small">Nothing found.</p>';
    }, 120);
  });
  $('#pf-results').addEventListener('click', (e) => {
    const b = e.target.closest('[data-id]');
    if (b) selectMedicine(b.dataset.id);
  });

  function selectMedicine(id) {
    const m = state.ds && state.ds.byId.get(id);
    const editor = $('#pf-editor');
    if (!m) {
      editor.innerHTML = '<p class="ad-error">That medicine is not in the current price list.</p>';
      return;
    }
    state.selected = m;
    const fix = state.cfg.overrides[id] || {};
    editor.innerHTML = `<div class="ad-editor">
      <h3>${esc(m.name)} ${esc(m.strength)}</h3>
      <p class="muted small">${esc(m.product)} · ${esc(m.manufacturer)} · Reg ${esc(m.reg || '—')}</p>
      <p>DRAP price: <b>${rs(m.price)}</b> for ${esc(m.pack || 'one pack')} (${rs(m.unitPrice)} per ${esc(unitLabel(m))})</p>
      <label class="ad-field"><span>Correct pack price (Rs)</span><input type="number" id="pf-price" class="input" min="0.01" step="0.01" value="${fix.price || ''}" placeholder="${m.price}"></label>
      <label class="ad-switch"><input type="checkbox" id="pf-hide" ${fix.hidden ? 'checked' : ''}><span>Hide this product from the site</span></label>
      <label class="ad-field"><span>Note for yourself (optional)</span><input type="text" id="pf-note" class="input" maxlength="200" value="${esc(fix.note || '')}" placeholder="e.g. Pharmacy receipt shows Rs 120"></label>
      <div class="ad-actions"><button type="button" class="btn btn-primary" id="pf-save">Save fix</button>
      ${state.cfg.overrides[id] ? '<button type="button" class="btn btn-ghost danger" id="pf-remove">Remove fix</button>' : ''}
      <a class="btn btn-ghost" href="/#/medicine/${encodeURIComponent(id)}" target="_blank" rel="noopener">Open on site ↗</a></div></div>`;
    editor.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    $('#pf-save').onclick = () => saveFix(m);
    const rm = $('#pf-remove');
    if (rm) rm.onclick = () => removeFix(id);
  }

  async function saveFix(m) {
    const price = parseFloat($('#pf-price').value);
    const hidden = $('#pf-hide').checked;
    if (!hidden && !(price > 0)) return toast('Enter the correct price, or tick “Hide”.', true);
    const cfg = JSON.parse(JSON.stringify(state.cfg));
    cfg.overrides[m.id] = { price: hidden ? undefined : price, hidden, note: $('#pf-note').value, name: `${m.name} ${m.strength}`.trim(), at: new Date().toISOString() };
    await saveConfig(cfg, 'Price fix saved. It goes live within a minute.');
    renderFixes();
    selectMedicine(m.id);
  }

  async function removeFix(id) {
    const cfg = JSON.parse(JSON.stringify(state.cfg));
    delete cfg.overrides[id];
    await saveConfig(cfg, 'Fix removed');
    renderFixes();
    if (state.selected && state.selected.id === id) selectMedicine(id);
  }

  function renderFixes() {
    const entries = Object.entries(state.cfg.overrides).sort((a, b) => (a[1].at < b[1].at ? 1 : -1));
    $('#pf-count').textContent = entries.length;
    $('#pf-list').innerHTML = entries.length
      ? entries.map(([id, o]) => {
        const m = state.ds && state.ds.byId.get(id);
        return `<div class="ad-fix"><div><b>${esc(o.name || (m && m.name) || id)}</b>
          <div class="small">${o.hidden ? '<span class="tag warn">Hidden</span>' : `${m ? `<s class="muted">${rs(m.price)}</s> → ` : ''}<b>${rs(o.price)}</b>`} <span class="muted">· ${esc(fmtWhen(o.at))}</span></div>
          ${o.note ? `<div class="muted small">${esc(o.note)}</div>` : ''}</div>
          <div class="ad-fix-actions"><button type="button" class="btn btn-ghost sm" data-edit="${esc(id)}">Edit</button></div></div>`;
      }).join('')
      : '<div class="ad-empty small">No fixes. Search for a medicine on the left to correct its price.</div>';
  }
  $('#pf-list').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-edit]');
    if (!b) return;
    await ensureData();
    selectMedicine(b.dataset.edit);
  });

  // ------------------------------------------------------------------------
  // Settings
  // ------------------------------------------------------------------------
  function fillSettings() {
    const c = state.cfg;
    $('#an-on').checked = c.announcement.on;
    $('#an-tone').value = c.announcement.tone;
    $('#an-en').value = c.announcement.en;
    $('#an-ur').value = c.announcement.ur;
    $('#ai-on').checked = c.ai.enabled;
    $('#popular').value = c.popular.join(', ');
    $('#c-phone').value = c.contact.phone;
    $('#c-email').value = c.contact.email;
    $('#c-wa').value = c.contact.whatsapp;
    $('#ai-note').textContent = state.overview.ai.keySet
      ? 'An Anthropic API key is set on the server. Each AI answer costs a small amount; switch this off to use only the free offline answers.'
      : 'No ANTHROPIC_API_KEY is set on the server, so the assistant uses its free offline answers either way.';
    setDirty(false);
    renderPreview();
  }

  function readSettings() {
    const c = JSON.parse(JSON.stringify(state.cfg));
    c.announcement = { on: $('#an-on').checked, tone: $('#an-tone').value, en: $('#an-en').value.trim(), ur: $('#an-ur').value.trim() };
    c.ai = { enabled: $('#ai-on').checked };
    c.popular = $('#popular').value.split(',').map((s) => s.trim()).filter(Boolean);
    c.contact = { phone: $('#c-phone').value.trim(), email: $('#c-email').value.trim(), whatsapp: $('#c-wa').value.trim() };
    return c;
  }

  function renderPreview() {
    const en = $('#an-en').value.trim();
    const ur = $('#an-ur').value.trim();
    const tone = $('#an-tone').value;
    $('#an-preview').innerHTML = en || ur
      ? `<div class="announce tone-${esc(tone)}${$('#an-on').checked ? '' : ' off'}"><span>${esc(en || ur)}</span></div>${$('#an-on').checked ? '' : '<p class="muted small">Hidden: tick “Show a banner” to publish it.</p>'}`
      : '<p class="muted small">Write a message to see a preview.</p>';
  }

  function setDirty(d) {
    state.dirty = d;
    $('#settings-state').textContent = d ? 'You have unsaved changes' : 'No unsaved changes';
    $('#settings-state').classList.toggle('attn', d);
  }

  $('#settings-form').addEventListener('input', () => { setDirty(true); renderPreview(); });
  $('#settings-form').addEventListener('change', () => { setDirty(true); renderPreview(); });
  $('#settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveConfig(readSettings(), 'Settings saved. Visitors see them within a minute.');
    fillSettings();
    renderOverview();
  });
  window.addEventListener('beforeunload', (e) => {
    if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  async function saveConfig(cfg, msg) {
    const btns = $$('#settings-save, #pf-save');
    btns.forEach((b) => (b.disabled = true));
    try {
      const out = await api('save-config', { config: cfg });
      state.cfg = out.config;
      toast(msg);
    } catch (err) {
      toast(err.message, true);
      throw err;
    } finally {
      btns.forEach((b) => (b.disabled = false));
    }
  }

  // ------------------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------------------
  async function openPanel() {
    const [ov, fb] = await Promise.all([api('overview'), api('feedback')]);
    state.overview = ov;
    state.cfg = ov.config;
    state.feedback = fb.items || [];
    $('#booting').hidden = true;
    $('#login').hidden = true;
    $('#panel').hidden = false;
    renderOverview();
    renderInbox();
    renderFixes();
    fillSettings();
    let tab = 'overview';
    try { tab = sessionStorage.getItem('sd_admin_tab') || 'overview'; } catch (e) { /* ignore */ }
    setTab(tab);
  }

  (async function boot() {
    try {
      const me = await api('me');
      if (!me.configured) return showLogin('The admin panel is not set up yet: add an ADMIN_PASSWORD environment variable (8+ characters) on the server, then reload.');
      if (!me.authed) return showLogin();
      await openPanel();
    } catch (e) {
      showLogin('Could not reach the server: ' + e.message);
    }
  })();
})();
