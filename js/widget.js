/**
 * Sasta Dawa Finder - embeddable clinic widget (widget.html?c=<clinic uid>).
 * Shows a medicine's DRAP price and the cheapest brands with the same formula.
 */
(function () {
  'use strict';

  const SITE = 'https://sasta-dawa-finder.vercel.app';
  const API = location.protocol.startsWith('http') && !/^(capacitor:|https:\/\/localhost$)/.test(location.origin) ? '' : SITE;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const rs = (n) => 'Rs ' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-PK', { maximumFractionDigits: 2 });
  const label = (m) => `${m.name} ${m.strength || ''}`.trim();
  const meta = (m) => [m.generic, m.form, m.pack, m.manufacturer].filter(Boolean).join(' · ');

  const clinicId = new URLSearchParams(location.search).get('c') || '';
  let clinic = null;
  let engine = null;
  let found = [];
  let counted = false;

  function status(text) {
    const s = $('#w-status');
    s.className = 'notice';
    s.textContent = text;
    s.hidden = false;
    $('#w-app').hidden = true;
  }

  /** Count one widget search per visit (the clinic sees totals on its dashboard). */
  function countSearch() {
    if (counted) return;
    counted = true;
    const key = 'sd_w_' + clinicId;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch (e) {
      /* storage blocked in some iframes: count once per page load */
    }
    fetch(API + '/api/places?a=event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'widget', clinic: clinicId }) }).catch(() => {});
  }

  function suggest(q) {
    const list = $('#w-suggest');
    if (!engine || q.trim().length < 2) {
      list.innerHTML = '';
      found = [];
      return;
    }
    found = engine.suggest(q, 8);
    list.innerHTML = found.length
      ? found.map((m, i) => `<li><div class="pr-main"><div class="pr-name">${esc(label(m))}</div><div class="pr-meta">${esc(meta(m))}</div></div><button type="button" class="btn btn-soft sm" style="min-height:44px" data-i="${i}">${esc(rs(m.price))}</button></li>`).join('')
      : '<li class="muted">No medicine found. Try the brand or formula name.</li>';
  }

  function show(m) {
    countSearch();
    $('#w-suggest').innerHTML = '';
    const alts = engine.alternatives(m, 'unit').filter((x) => x !== m && x.unitPrice > 0 && x.unitPrice < m.unitPrice).slice(0, 5);
    const unitWord = m.unit && m.unit !== 'pack' ? 'per ' + m.unit : '';
    const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    $('#w-result').innerHTML = `
      <div class="card result-card">
        <p class="print-only"><b>${esc(clinic.name)}</b> · cheaper-options slip · ${esc(date)}</p>
        <h2 style="font-size:18px;margin:0">${esc(label(m))}</h2>
        <p class="muted small" style="margin:2px 0 8px">${esc(meta(m))}</p>
        <p style="margin:0"><b style="font-size:20px">${esc(rs(m.price))}</b> <span class="muted small">per pack${unitWord ? ' · ' + esc(rs(m.unitPrice)) + ' ' + esc(unitWord) : ''}</span></p>
        <h3 style="font-size:15px;margin:14px 0 4px">${alts.length ? 'Cheaper brands with the same formula' : 'No cheaper brand with the same formula'}</h3>
        ${alts
          .map((a) => {
            const pct = Math.round(((m.unitPrice - a.unitPrice) / m.unitPrice) * 100);
            return `<div class="alt-row"><div><b>${esc(label(a))}</b><div class="muted small">${esc(a.manufacturer)} · ${esc(a.pack)}</div></div><div style="text-align:end"><b>${esc(rs(a.price))}</b><div><span class="save-pill">Save ${pct}%</span></div></div></div>`;
          })
          .join('')}
        <p class="warn-note">Ask your doctor before switching to another brand.</p>
        <div class="actions no-print" style="margin-block-start:10px"><button type="button" class="btn btn-ghost" id="w-print">Print cheaper-options slip</button></div>
        ${clinic.phone ? `<p class="small print-only">Questions? Call ${esc(clinic.name)}: ${esc(clinic.phone)}</p>` : ''}
      </div>`;
    $('#w-print').addEventListener('click', () => window.print());
  }

  async function start() {
    if (!/^u_[a-f0-9]{12}$/.test(clinicId)) return status('This widget link is not complete. Please check the embed code.');
    try {
      const res = await fetch(API + '/api/places?a=widget&c=' + encodeURIComponent(clinicId));
      if (res.status === 404) return status('This widget was not found.');
      if (!res.ok) throw new Error('bad status');
      clinic = await res.json();
    } catch (e) {
      return status('Could not load the price checker. Please try again later.');
    }
    $('#w-name').textContent = clinic.name || 'Medicine price checker';
    if (clinic.note) $('#w-note').textContent = clinic.note;
    if (/^#[0-9a-f]{6}$/i.test(clinic.color || '')) {
      document.documentElement.style.setProperty('--brand', clinic.color);
      document.documentElement.style.setProperty('--brand-2', clinic.color);
      document.documentElement.style.setProperty('--focus', clinic.color);
    }
    if (!clinic.active) return status('This widget is not active.');
    try {
      const ds = await window.SDData.load('data/medicines.json');
      engine = window.SDSearch.createEngine(ds);
    } catch (e) {
      return status('Could not load the medicine list. Please try again later.');
    }
    $('#w-status').hidden = true;
    $('#w-app').hidden = false;

    let t = null;
    const q = $('#w-q');
    q.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => suggest(q.value), 120);
    });
    $('#w-form').addEventListener('submit', (ev) => {
      ev.preventDefault();
      suggest(q.value);
      if (found.length === 1) show(found[0]);
    });
    $('#w-suggest').addEventListener('click', (ev) => {
      const li = ev.target.closest('li');
      const b = li && li.querySelector('button[data-i]');
      if (b && found[Number(b.dataset.i)]) show(found[Number(b.dataset.i)]);
    });
  }

  start();
})();
