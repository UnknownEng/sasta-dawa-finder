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

  async function api(action, body, params) {
    const opts = { method: body ? 'POST' : 'GET', credentials: 'same-origin', headers: { 'X-SD-Admin': '1' }, cache: 'no-store' };
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const qs = new URLSearchParams({ a: action, ...(params || {}) });
    const res = await fetch('/api/admin?' + qs.toString(), opts);
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
    if (name === 'analytics') loadAnalytics();
    if (name === 'users' || name === 'pharmacies' || name === 'payments') loadBusiness(name);
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
    const open = state.openCount;
    const full = o.feedback && open >= o.feedback.max;
    $('#ov-stats').innerHTML = [
      ['Medicines listed', d.products.toLocaleString('en-PK'), 'DRAP-registered products'],
      ['Same-formula groups', d.formulas.toLocaleString('en-PK'), 'where cheaper brands are compared'],
      ['Prices updated to', fmtDate(d.latest_price_date), 'downloaded ' + fmtDate((d.synced_at || '').slice(0, 10))],
      ['Price fixes active', String(Object.keys(state.cfg.overrides).length), 'your corrections'],
      ['Open reports', String(open), full ? 'inbox full: new reports are refused until you clear some' : open ? 'waiting in the inbox' : 'all caught up', open ? 'attn' : ''],
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

  $$('[data-filter]').forEach((b) =>
    b.addEventListener('click', async () => {
      state.filter = b.dataset.filter;
      if (state.filter === 'all' && !state.doneLoaded) {
        try {
          const done = await api('feedback', null, { status: 'done' });
          state.feedback = state.feedback.concat(done.items || []);
          state.doneLoaded = true;
        } catch (err) {
          toast(err.message, true);
        }
      }
      renderInbox();
    })
  );

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
        const gone = state.feedback.find((f) => f.key === key);
        if (gone && gone.status !== 'done') state.openCount = Math.max(0, state.openCount - 1);
        state.feedback = state.feedback.filter((f) => f.key !== key);
        toast('Report deleted');
      } else {
        const out = await api('feedback-update', { key, status: act === 'done' ? 'done' : 'new' });
        const f = state.feedback.find((x) => x.key === key);
        if (f) {
          f.status = act === 'done' ? 'done' : 'new';
          f.key = out.key || key;
        }
        state.openCount = Math.max(0, state.openCount + (act === 'done' ? -1 : 1));
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
  // Users, pharmacies and payments (accounts & paid plans, lib/platform.js)
  // ------------------------------------------------------------------------
  const PLAN_NAMES = {
    free: 'Free',
    pharmacy_pro: 'Pharmacy Pro',
    pharmacy_premium: 'Pharmacy Premium',
    clinic: 'Clinic / Hospital',
    ngo: 'NGO / Welfare Trust',
    company: 'Corporate / Insurer',
    api: 'API',
  };
  const planName = (p) => PLAN_NAMES[p] || p || 'Free';
  const biz = { users: null, pharmacies: null, payments: null };

  async function loadBusiness(name, force) {
    if (biz[name] && !force) return render(name);
    const box = { users: '#users-list', pharmacies: '#ph-list', payments: '#pay-list' }[name];
    $(box).innerHTML = '<p class="muted small">Loading…</p>';
    try {
      const out = await api(name);
      biz[name] = out[name] || [];
      render(name);
    } catch (err) {
      $(box).innerHTML = `<p class="ad-error">${esc(err.message)}</p>`;
    }
    function render(n) {
      if (n === 'users') renderUsers();
      else if (n === 'pharmacies') renderPharmacies();
      else renderPayments();
    }
  }
  document.addEventListener('click', (e) => {
    const r = e.target.closest('[data-reload]');
    if (r) loadBusiness(r.dataset.reload, true);
  });

  // -- users
  function renderUsers() {
    const q = $('#users-search').value.trim().toLowerCase();
    const all = biz.users || [];
    const list = q
      ? all.filter((u) => [u.name, u.email, u.phone, u.role, u.plan, planName(u.plan)].some((v) => String(v || '').toLowerCase().includes(q)))
      : all;
    $('#users-count').textContent = `${list.length} of ${all.length} accounts`;
    if (!list.length) {
      $('#users-list').innerHTML = `<div class="ad-empty">${all.length ? 'No account matches.' : 'No accounts yet.'}</div>`;
      return;
    }
    const opts = Object.keys(PLAN_NAMES).map((p) => `<option value="${esc(p)}">${esc(PLAN_NAMES[p])}</option>`).join('');
    $('#users-list').innerHTML = list.slice(0, 300).map((u) => `<article class="ad-item${u.disabled ? ' off' : ''}" data-uid="${esc(u.id)}">
        <div class="ad-item-top"><b>${esc(u.name || '—')}</b>
          <span><span class="tag brand">${esc(u.role || 'patient')}</span> <span class="tag ${u.plan && u.plan !== 'free' ? 'save' : ''}">${esc(planName(u.plan))}${u.trial ? ' (trial)' : ''}</span>${u.disabled ? ' <span class="tag warn">Disabled</span>' : ''}</span></div>
        <p class="ad-item-sub">${esc(u.email)}${u.phone ? ' · ' + esc(u.phone) : ''} · joined ${esc(fmtDate(u.createdAt))}${u.plan && u.plan !== 'free' && u.planUntil ? ' · plan until ' + esc(fmtDate(u.planUntil)) : ''}</p>
        <div class="ad-grant">
          <label class="ad-field"><span>Give plan</span><select class="input select" data-f="plan">${opts}</select></label>
          <label class="ad-field days"><span>Days</span><input type="number" class="input" data-f="days" min="1" max="3650" value="30"></label>
          <button type="button" class="btn btn-soft" data-act="grant">Give plan</button>
          <button type="button" class="btn btn-ghost${u.disabled ? '' : ' danger'}" data-act="${u.disabled ? 'enable' : 'disable'}">${u.disabled ? 'Enable account' : 'Disable account'}</button>
        </div></article>`).join('') + (list.length > 300 ? '<p class="muted small">Showing the first 300. Search to narrow down.</p>' : '');
  }
  let us;
  $('#users-search').addEventListener('input', () => { clearTimeout(us); us = setTimeout(renderUsers, 120); });
  $('#users-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const row = btn.closest('[data-uid]');
    const id = row.dataset.uid;
    const body = { id };
    if (btn.dataset.act === 'grant') {
      body.grantPlan = $('[data-f="plan"]', row).value;
      body.days = Math.max(1, Math.min(3650, parseInt($('[data-f="days"]', row).value, 10) || 30));
      if (!confirm(body.grantPlan === 'free' ? 'Move this account to the Free plan?' : `Give ${planName(body.grantPlan)} for ${body.days} days?`)) return;
    } else {
      body.disabled = btn.dataset.act === 'disable';
      if (body.disabled && !confirm('Disable this account? They will be signed out and cannot sign in until you enable it again.')) return;
    }
    btn.disabled = true;
    try {
      await api('user-update', body);
      toast(body.grantPlan ? 'Plan updated' : body.disabled ? 'Account disabled' : 'Account enabled');
      await loadBusiness('users', true);
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false;
    }
  });

  // -- pharmacies
  function renderPharmacies() {
    const list = (biz.pharmacies || []).slice().sort((a, b) => (a.verified === b.verified ? (a.createdAt < b.createdAt ? 1 : -1) : a.verified ? 1 : -1));
    const pending = list.filter((p) => !p.verified).length;
    const badge = $('#ph-badge');
    badge.textContent = pending;
    badge.hidden = pending === 0;
    if (!list.length) {
      $('#ph-list').innerHTML = '<div class="ad-empty">No pharmacy listings yet.<br><span class="muted small">Pharmacies sign up at /business and add their shop from their account.</span></div>';
      return;
    }
    $('#ph-list').innerHTML = list.map((p) => `<article class="ad-item${p.verified ? '' : ' pending'}" data-pid="${esc(p.id)}">
        <div class="ad-item-top"><b>${esc(p.name)}</b>
          <span>${p.verified ? '<span class="tag save">Verified</span>' : '<span class="tag warn">Waiting for check</span>'} ${p.featured ? '<span class="tag brand">Featured</span>' : ''} <span class="tag">${esc(planName(p.plan))}</span></span></div>
        <p class="ad-item-sub">${esc([p.address, p.area, p.city].filter(Boolean).join(', '))}</p>
        <p class="small">${p.phone ? 'Phone: <b>' + esc(p.phone) + '</b> ' : ''}${p.whatsapp ? 'WhatsApp: <b>' + esc(p.whatsapp) + '</b> ' : ''}${p.hours ? '· ' + esc(p.hours) : ''}</p>
        <p class="muted small">${esc(String(p.stockCount || 0))} medicines in stock list · added ${esc(fmtWhen(p.createdAt))}${p.lat != null ? ` · <a href="https://www.google.com/maps?q=${encodeURIComponent(p.lat + ',' + p.lng)}" target="_blank" rel="noopener">map ↗</a>` : ''}</p>
        <div class="ad-item-actions">
          <button type="button" class="btn ${p.verified ? 'btn-ghost' : 'btn-primary'} sm" data-act="verify" data-on="${p.verified ? '0' : '1'}">${p.verified ? 'Unverify (hide)' : 'Verify (show on site)'}</button>
          <button type="button" class="btn btn-ghost sm" data-act="feature" data-on="${p.featured ? '0' : '1'}">${p.featured ? 'Remove featured' : 'Feature'}</button>
        </div>
        ${p.featured && !/pharmacy_(pro|premium)/.test(p.plan || '') ? '<p class="muted small">Featured only shows as “Sponsored” while the pharmacy has a paid plan.</p>' : ''}
      </article>`).join('');
  }
  $('#ph-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.closest('[data-pid]').dataset.pid;
    const on = btn.dataset.on === '1';
    const body = btn.dataset.act === 'verify' ? { id, verified: on } : { id, featured: on };
    btn.disabled = true;
    try {
      await api('pharmacy-update', body);
      toast(btn.dataset.act === 'verify' ? (on ? 'Verified: now visible to visitors' : 'Hidden from visitors') : on ? 'Featured' : 'No longer featured');
      await loadBusiness('pharmacies', true);
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false;
    }
  });

  // -- payments
  function renderPayments() {
    const list = (biz.payments || []).slice().sort((a, b) => ((a.status === 'pending') === (b.status === 'pending') ? (a.at < b.at ? 1 : -1) : a.status === 'pending' ? -1 : 1));
    const pending = list.filter((p) => p.status === 'pending').length;
    const badge = $('#pay-badge');
    badge.textContent = pending;
    badge.hidden = pending === 0;
    if (!list.length) {
      $('#pay-list').innerHTML = '<div class="ad-empty">No payments yet.<br><span class="muted small">Add your JazzCash / Easypaisa / bank details in Site settings so businesses know where to pay.</span></div>';
      return;
    }
    const METHOD = { jazzcash: 'JazzCash', easypaisa: 'Easypaisa', bank: 'Bank transfer' };
    $('#pay-list').innerHTML = list.map((p) => `<article class="ad-item${p.status === 'pending' ? ' pending' : ' done'}" data-key="${esc(p.key)}">
        <div class="ad-item-top"><b>${esc(planName(p.plan))} × ${esc(String(p.periods || 1))} · ${esc(rs(p.amount))}</b>
          <span class="tag ${p.status === 'approved' ? 'save' : p.status === 'pending' ? 'warn' : ''}">${esc(p.status)}</span></div>
        <p class="ad-item-sub">${esc(p.name || '')} · ${esc(p.email || '')}</p>
        <p class="small">${esc(METHOD[p.method] || p.method)} · Transaction ID: <b>${esc(p.txnId)}</b>${p.payerPhone ? ' · from ' + esc(p.payerPhone) : ''} · ${esc(fmtWhen(p.at))}</p>
        ${p.status === 'pending' ? `<div class="ad-item-actions">
          <button type="button" class="btn btn-primary sm" data-act="approved">Approve &amp; switch plan on</button>
          <button type="button" class="btn btn-ghost sm danger" data-act="rejected">Reject</button></div>` : p.decidedAt ? `<p class="muted small">Decided ${esc(fmtWhen(p.decidedAt))}</p>` : ''}
      </article>`).join('');
  }
  $('#pay-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const key = btn.closest('[data-key]').dataset.key;
    const status = btn.dataset.act === 'approved' ? 'approved' : 'rejected';
    if (!confirm(status === 'approved' ? 'Approve this payment? Only do this after you have seen the money arrive.' : 'Reject this payment?')) return;
    btn.disabled = true;
    try {
      await api('payment-update', { key, status });
      toast(status === 'approved' ? 'Approved: plan is on' : 'Rejected');
      await loadBusiness('payments', true);
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false;
    }
  });

  // ------------------------------------------------------------------------
  // Analytics (/api/admin?a=analytics): accounts, revenue, activity, renewals
  // ------------------------------------------------------------------------
  const ana = { data: null };
  const METHOD_NAMES = { jazzcash: 'JazzCash', easypaisa: 'Easypaisa', bank: 'Bank transfer' };
  const EVENT_NAMES = { view: 'Profile views', wa: 'WhatsApp taps', call: 'Call taps', dir: 'Directions taps', reserve: 'Reservations', delivery: 'Delivery orders', widget: 'Clinic widget searches', saved: 'Possible savings shown (Rs)', savedCount: 'Cheaper options shown' };
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
  const count = (v) => num(v).toLocaleString('en-PK');

  async function loadAnalytics(force) {
    if (ana.data && !force) return renderAnalytics();
    $('#ana-body').innerHTML = '<p class="muted small">Loading…</p>';
    try {
      ana.data = await api('analytics');
      renderAnalytics();
    } catch (err) {
      $('#ana-body').innerHTML = `<p class="ad-error">${esc(err.message)}</p>`;
    }
  }
  $('#ana-reload').addEventListener('click', () => loadAnalytics(true));

  function waDigits(v) {
    let d = String(v || '').replace(/\D/g, '');
    if (d.startsWith('00')) d = d.slice(2);
    else if (d.startsWith('0')) d = '92' + d.slice(1);
    return d.length >= 10 ? d : '';
  }

  /** Polite renewal reminder the admin sends from their own WhatsApp. */
  function renewalText(u) {
    const first = String(u.name || '').trim().split(/\s+/)[0] || '';
    const what = u.trial ? `free trial of ${planName(u.plan)}` : `${planName(u.plan)} plan`;
    return `Assalam o Alaikum${first ? ' ' + first : ''}, this is Sasta Dawa Finder. Your ${what} ends on ${fmtDate(u.planUntil)}. ` +
      'To keep it active, please renew from your account (Account → Plan) and send the transaction ID there. ' +
      'If you have any question, just reply here. Thank you!';
  }

  function kvTable(title, obj, opts) {
    const o = opts || {};
    const rows = Object.entries(obj && typeof obj === 'object' ? obj : {}).filter(([, v]) => typeof v === 'number').sort((a, b) => b[1] - a[1]);
    return `<div class="ad-card"><h2>${esc(title)}</h2>${rows.length
      ? `<div class="ad-table-wrap"><table class="ad-table"><thead><tr><th scope="col">${esc(o.key || 'Name')}</th><th scope="col" class="num">${esc(o.val || 'Count')}</th></tr></thead><tbody>${rows
        .map(([k, v]) => `<tr><td>${esc(o.label ? o.label(k) : k)}</td><td class="num">${esc(o.money ? rs(v) : count(v))}</td></tr>`)
        .join('')}</tbody></table></div>`
      : '<p class="muted small">Nothing yet.</p>'}</div>`;
  }

  /** 30 bars, one per day, of pharmacy profile views (plain SVG, no library). */
  function viewsChart(days) {
    const list = (Array.isArray(days) ? days : []).filter((d) => d && typeof d.day === 'string').slice(-30);
    if (!list.length) return '<p class="muted small">No views recorded yet.</p>';
    const top = Math.max(0, ...list.map((d) => num(d.views)));
    const max = Math.max(1, top); // bar scale
    const W = 600;
    const H = 160;
    const pad = 18;
    const bw = W / list.length;
    const total = list.reduce((s, d) => s + num(d.views), 0);
    const bars = list.map((d, i) => {
      const v = num(d.views);
      const h = Math.round(((H - pad) * v) / max);
      return `<rect class="ad-bar" x="${(i * bw + 1).toFixed(1)}" y="${H - pad - h}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${Math.max(h, v ? 1 : 0)}"><title>${esc(fmtDate(d.day))}: ${esc(count(v))} views</title></rect>`;
    }).join('');
    const first = list[0].day;
    const last = list[list.length - 1].day;
    return `<svg class="ad-chart" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="${esc(`Pharmacy profile views per day: ${count(total)} in ${list.length} days, highest ${count(top)}`)}" preserveAspectRatio="none">
        <line class="ad-axis" x1="0" y1="${H - pad}" x2="${W}" y2="${H - pad}"></line>${bars}
      </svg>
      <div class="ad-chart-foot"><span>${esc(fmtDate(first))}</span><span>${esc(count(total))} ${total === 1 ? 'view' : 'views'} · busiest day ${esc(count(top))}</span><span>${esc(fmtDate(last))}</span></div>`;
  }

  function renderAnalytics() {
    const d = ana.data || {};
    const users = d.users || {};
    const rev = d.revenue || {};
    const ph = d.pharmacies || {};
    const byPlan = users.byPlan || {};
    const active = Object.entries(byPlan).filter(([p]) => p !== 'free').reduce((s, [, v]) => s + num(v), 0);
    const paying = Math.max(0, active - num(users.trials));
    const stats = [
      ['Accounts', count(users.total), `${count(users.newLast30)} new in the last 30 days`],
      ['Paying accounts', count(paying), 'paid plan, not on trial'],
      ['On free trial', count(users.trials), 'remind them before it ends'],
      ['Revenue approved', rs(num(rev.approved)), 'all time'],
      ['Revenue, last 30 days', rs(num(rev.last30)), 'approved payments'],
      ['Waiting for approval', rs(num(rev.pending)), 'check in Payments', num(rev.pending) ? 'attn' : ''],
      ['Pharmacies verified', count(ph.verified), `of ${count(ph.total)} listings`],
      ['Pharmacies waiting', count(ph.pending), 'verify in Pharmacies', num(ph.pending) ? 'attn' : ''],
    ];
    const ev = d.events30 || {};
    const exp = (Array.isArray(d.expiringSoon) ? d.expiringSoon : []).filter((u) => u && typeof u === 'object');
    const top = (Array.isArray(d.topSearched) ? d.topSearched : []).filter((m) => m && typeof m === 'object');
    const cities = Array.isArray(ph.cities) ? ph.cities.filter((c) => typeof c === 'string') : [];

    const expHtml = exp.length
      ? `<ul class="ad-renew">${exp.map((u) => {
        const wa = waDigits(u.phone);
        const left = Math.ceil((Date.parse(u.planUntil) - Date.now()) / 86400000);
        const when = isNaN(left) ? '' : left <= 0 ? 'ends today' : left === 1 ? 'ends tomorrow' : `ends in ${left} days`;
        return `<li class="ad-renew-item">
            <div class="ad-renew-main"><b>${esc(u.name || '—')}</b> <span class="tag ${u.trial ? 'warn' : 'save'}">${esc(planName(u.plan))}${u.trial ? ' (trial)' : ''}</span>
              <span class="muted small">${esc(fmtDate(u.planUntil))}${when ? ' · ' + esc(when) : ''}</span>
              <span class="muted small">${esc(u.email || '')}${u.phone ? ' · ' + esc(u.phone) : ''}</span></div>
            <div class="ad-item-actions">
              ${wa ? `<a class="btn btn-save sm" href="${esc('https://wa.me/' + wa + '?text=' + encodeURIComponent(renewalText(u)))}" target="_blank" rel="noopener" data-renew="wa">WhatsApp reminder</a>` : ''}
              ${u.email ? `<a class="btn btn-ghost sm" href="${esc('mailto:' + u.email + '?subject=' + encodeURIComponent('Your Sasta Dawa Finder plan') + '&body=' + encodeURIComponent(renewalText(u)))}" data-renew="email">Email</a>` : ''}
            </div></li>`;
      }).join('')}</ul>`
      : '<p class="muted small">No plan ends in the next 7 days.</p>';

    const topHtml = top.length
      ? `<div class="ad-table-wrap"><table class="ad-table"><thead><tr><th scope="col">Medicine</th><th scope="col">Formula</th><th scope="col" class="num">Searches</th></tr></thead><tbody>${top
        .map((m) => `<tr><td>${typeof m.id === 'string' && m.id ? `<a href="/#/medicine/${encodeURIComponent(m.id)}" target="_blank" rel="noopener">${esc(m.name || m.id)}</a>` : esc(m.name || '—')}</td><td>${esc(m.generic || '')}</td><td class="num">${esc(count(m.searches))}</td></tr>`)
        .join('')}</tbody></table></div>`
      : '<p class="muted small">No searches near listed pharmacies yet.</p>';

    $('#ana-body').innerHTML = `
      <div class="ad-stats ana-stats">${stats.map(([k, v, sub, cls]) => `<div class="ad-stat ${cls || ''}"><small>${esc(k)}</small><b>${esc(v)}</b><span>${esc(sub)}</span></div>`).join('')}</div>
      <div class="ad-card ana-renew-card">
        <h2>Plans ending in the next 7 days <span class="pill-count">${esc(String(exp.length))}</span></h2>
        <p class="muted small">Send a polite reminder so they can pay before the plan stops. Approve their payment in Payments when it arrives.</p>
        ${expHtml}
      </div>
      <div class="ad-card">
        <h2>Pharmacy profile views per day (30 days)</h2>
        ${viewsChart(d.viewsByDay)}
      </div>
      <div class="ad-grid3">
        ${kvTable('Accounts by type', users.byRole, { key: 'Type' })}
        ${kvTable('Accounts by plan', byPlan, { key: 'Plan', label: planName })}
        ${kvTable('Revenue by method', rev.byMethod, { key: 'Method', val: 'Amount', money: true, label: (k) => METHOD_NAMES[k] || k })}
        ${kvTable('Revenue by plan', rev.byPlan, { key: 'Plan', val: 'Amount', money: true, label: planName })}
        ${kvTable('Pharmacy activity (30 days)', ev, { key: 'What', label: (k) => EVENT_NAMES[k] || k })}
        <div class="ad-card"><h2>Cities with pharmacies</h2>${cities.length ? `<p>${cities.map((c) => `<span class="tag">${esc(c)}</span>`).join(' ')}</p>` : '<p class="muted small">None yet.</p>'}</div>
      </div>
      <div class="ad-card">
        <h2>Most searched medicines near listed pharmacies</h2>
        ${topHtml}
      </div>`;
  }

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
    const pay = c.payments || {};
    $('#pay-title').value = pay.title || '';
    $('#pay-jazzcash').value = pay.jazzcash || '';
    $('#pay-easypaisa').value = pay.easypaisa || '';
    $('#pay-bank').value = pay.bank || '';
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
    c.payments = {
      title: $('#pay-title').value.trim(),
      jazzcash: $('#pay-jazzcash').value.trim(),
      easypaisa: $('#pay-easypaisa').value.trim(),
      bank: $('#pay-bank').value.trim(),
    };
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
      // send the version we loaded, so a save from another tab/device is never silently overwritten
      const out = await api('save-config', { config: cfg, expectedUpdatedAt: state.cfg.updatedAt || null });
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
    state.openCount = ov.feedback ? ov.feedback.open : state.feedback.length;
    state.doneLoaded = false;
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
    // badges for pending pharmacies / payments (loaded quietly in the background)
    ['pharmacies', 'payments'].forEach((n) => { if (n !== tab) loadBusiness(n); });
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
