/**
 * Sasta Dawa Finder - account portal (account.html).
 * Vanilla JS single-page app with hash routes, built against lib/platform.js:
 *   /api/account?a=...   (Bearer token in localStorage "sd_user_token", user JSON in "sd_user")
 * Every value from the server or the user goes through esc() before it reaches innerHTML.
 */
(function () {
  'use strict';

  // ===========================================================================
  // QR code generator (byte mode, error correction M, versions 1-6 -> up to 106 bytes)
  // ===========================================================================
  const QR_TOTAL = [0, 26, 44, 70, 100, 134, 172]; // total codewords per version
  const QR_EC = [0, 10, 16, 26, 18, 24, 16]; // EC codewords per block (level M)
  const QR_BLOCKS = [0, 1, 1, 1, 2, 2, 4]; // number of blocks (level M)
  const QR_ALIGN = [0, 0, 18, 22, 26, 30, 34]; // the one alignment pattern centre (v2-6)

  function gfMul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xff;
  }
  function rsDivisor(degree) {
    const r = new Array(degree).fill(0);
    r[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < degree; j++) {
        r[j] = gfMul(r[j], root);
        if (j + 1 < degree) r[j] ^= r[j + 1];
      }
      root = gfMul(root, 2);
    }
    return r;
  }
  function rsRemainder(data, div) {
    const r = new Array(div.length).fill(0);
    for (const b of data) {
      const f = b ^ r.shift();
      r.push(0);
      div.forEach((c, i) => (r[i] ^= gfMul(c, f)));
    }
    return r;
  }

  /** Returns a square boolean matrix (true = dark) for the text, or throws if it is too long. */
  function qrMatrix(text, forceMask) {
    const bytes = Array.from(new TextEncoder().encode(String(text)));
    let ver = 0;
    for (let v = 1; v <= 6; v++) {
      const dataCap = QR_TOTAL[v] - QR_EC[v] * QR_BLOCKS[v];
      if (4 + 8 + bytes.length * 8 <= dataCap * 8) {
        ver = v;
        break;
      }
    }
    if (!ver) throw new Error('Text too long for QR');
    const total = QR_TOTAL[ver];
    const ecLen = QR_EC[ver];
    const nBlocks = QR_BLOCKS[ver];
    const dataCap = total - ecLen * nBlocks;

    // Bit stream
    const bits = [];
    const put = (val, len) => {
      for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
    };
    put(4, 4);
    put(bytes.length, 8);
    bytes.forEach((b) => put(b, 8));
    put(0, Math.min(4, dataCap * 8 - bits.length));
    while (bits.length % 8) bits.push(0);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
    for (let pad = 0xec; data.length < dataCap; pad ^= 0xec ^ 0x11) data.push(pad);

    // Blocks + error correction, interleaved
    const numShort = nBlocks - (total % nBlocks);
    const shortLen = Math.floor(total / nBlocks);
    const div = rsDivisor(ecLen);
    const blocks = [];
    for (let i = 0, k = 0; i < nBlocks; i++) {
      const dl = shortLen - ecLen + (i < numShort ? 0 : 1);
      const d = data.slice(k, k + dl);
      k += dl;
      const ec = rsRemainder(d, div);
      if (i < numShort) d.push(-1); // placeholder so all blocks line up
      blocks.push(d.concat(ec));
    }
    const words = [];
    for (let i = 0; i < blocks[0].length; i++) {
      blocks.forEach((b, j) => {
        if (i !== shortLen - ecLen || j >= numShort) words.push(b[i]);
      });
    }

    // Matrix + function patterns
    const size = ver * 4 + 17;
    const mod = Array.from({ length: size }, () => new Array(size).fill(false));
    const fn = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (x, y, dark) => {
      mod[y][x] = dark;
      fn[y][x] = true;
    };
    for (let i = 0; i < size; i++) {
      set(6, i, i % 2 === 0);
      set(i, 6, i % 2 === 0);
    }
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= size || y >= size) continue;
          const d = Math.max(Math.abs(dx), Math.abs(dy));
          set(x, y, d !== 2 && d !== 4);
        }
      }
    };
    finder(3, 3);
    finder(size - 4, 3);
    finder(3, size - 4);
    if (ver >= 2) {
      const c = QR_ALIGN[ver];
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(c + dx, c + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
    const drawFormat = (mask) => {
      const dataBits = (0 << 3) | mask; // level M = 00
      let rem = dataBits;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const fb = ((dataBits << 10) | rem) ^ 0x5412;
      const bit = (i) => ((fb >>> i) & 1) === 1;
      for (let i = 0; i <= 5; i++) set(8, i, bit(i));
      set(8, 7, bit(6));
      set(8, 8, bit(7));
      set(7, 8, bit(8));
      for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
      set(8, size - 8, true);
    };
    drawFormat(0); // reserve the format areas

    // Codewords (zig-zag)
    let bi = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const up = ((right + 1) & 2) === 0;
          const y = up ? size - 1 - vert : vert;
          if (!fn[y][x] && bi < words.length * 8) {
            mod[y][x] = ((words[bi >>> 3] >>> (7 - (bi & 7))) & 1) === 1;
            bi++;
          }
        }
      }
    }

    const maskFn = [
      (x, y) => (x + y) % 2 === 0,
      (x, y) => y % 2 === 0,
      (x) => x % 3 === 0,
      (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
      (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
      (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
      (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
    ];
    const applyMask = (m) => {
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && maskFn[m](x, y)) mod[y][x] = !mod[y][x];
    };
    const penalty = () => {
      let p = 0;
      const line = (get) => {
        for (let a = 0; a < size; a++) {
          let run = 1;
          for (let b = 1; b <= size; b++) {
            if (b < size && get(a, b) === get(a, b - 1)) run++;
            else {
              if (run >= 5) p += 3 + run - 5;
              run = 1;
            }
          }
          for (let b = 0; b + 11 <= size; b++) {
            const s = [];
            for (let k = 0; k < 11; k++) s.push(get(a, b + k) ? 1 : 0);
            const t = s.join('');
            if (t === '10111010000' || t === '00001011101') p += 40;
          }
        }
      };
      line((a, b) => mod[a][b]);
      line((a, b) => mod[b][a]);
      let dark = 0;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          if (mod[y][x]) dark++;
          if (x < size - 1 && y < size - 1) {
            const c = mod[y][x];
            if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) p += 3;
          }
        }
      }
      p += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
      return p;
    };
    let best = forceMask;
    if (best == null) {
      let bestP = Infinity;
      for (let m = 0; m < 8; m++) {
        applyMask(m);
        drawFormat(m);
        const p = penalty();
        if (p < bestP) {
          bestP = p;
          best = m;
        }
        applyMask(m); // undo
      }
    }
    applyMask(best);
    drawFormat(best);
    return mod;
  }

  /** SVG markup (safe: only numbers) for a QR matrix with a 4-module quiet zone. */
  function qrSvg(text) {
    const m = qrMatrix(text);
    const n = m.length + 8;
    let d = '';
    m.forEach((row, y) => row.forEach((dark, x) => {
      if (dark) d += `M${x + 4} ${y + 4}h1v1h-1z`;
    }));
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="260" height="260" role="img" aria-label="QR code" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  }

  if (typeof module === 'object' && module.exports) module.exports = { qrMatrix, qrSvg };
  if (typeof document === 'undefined' || !document.getElementById('app')) return;

  // ===========================================================================
  // Basics
  // ===========================================================================
  const SITE = 'https://sasta-dawa-finder.vercel.app';
  const API = location.protocol.startsWith('http') && !/^(capacitor:|https:\/\/localhost$)/.test(location.origin) ? '' : SITE;
  const WA_NUMBER = '923393202419';
  const WA_TEXT = '+92 339 3202419';
  const TOKEN_KEY = 'sd_user_token';
  const USER_KEY = 'sd_user';

  const app = document.getElementById('app');
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }
  const rs = (n) => 'Rs ' + Math.round(Number(n) || 0).toLocaleString('en-PK');
  const rs2 = (n) => 'Rs ' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-PK', { maximumFractionDigits: 2 });
  const fmtDate = (s) => {
    const d = new Date(s);
    return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  };
  const fmtTime = (s) => {
    const d = new Date(s);
    return isNaN(d) ? '' : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };
  const waLink = (phone, text) => {
    let p = String(phone || '').replace(/[^\d]/g, '');
    if (p.startsWith('0')) p = '92' + p.slice(1);
    return 'https://wa.me/' + p + (text ? '?text=' + encodeURIComponent(text) : '');
  };
  function lsGet(k) {
    try {
      return localStorage.getItem(k);
    } catch (e) {
      return null;
    }
  }
  function lsSet(k, v) {
    try {
      if (v == null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch (e) {
      /* private mode: stay signed in for this page only */
    }
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 4000);
  }

  const ROLE_LABEL = { patient: 'Personal', pharmacy: 'Pharmacy', clinic: 'Clinic / Hospital', ngo: 'NGO / Welfare trust', company: 'Company / Insurer', developer: 'Developer' };
  const ROLE_HINT = {
    patient: 'Save your medicines across devices',
    pharmacy: 'List your pharmacy, stock and prices',
    clinic: 'Price widget for your website',
    ngo: 'Stretch your medicine budget',
    company: 'Medicine savings for your staff',
    developer: 'Medicine price API keys',
  };

  // ===========================================================================
  // Session + API
  // ===========================================================================
  const S = {
    token: lsGet(TOKEN_KEY) || '',
    user: null,
    plans: null,
    pharmacies: null,
    engine: null,
    enginePromise: null,
  };
  try {
    S.user = JSON.parse(lsGet(USER_KEY) || 'null');
  } catch (e) {
    S.user = null;
  }

  function setSession(token, user) {
    if (token !== undefined) {
      S.token = token || '';
      lsSet(TOKEN_KEY, token || null);
    }
    if (user !== undefined) {
      S.user = user || null;
      lsSet(USER_KEY, user ? JSON.stringify(user) : null);
    }
  }
  function go(hash) {
    if (location.hash === hash) route();
    else location.hash = hash;
  }
  function signOutLocal() {
    setSession('', null);
    S.pharmacies = null;
  }

  async function api(action, opts) {
    const o = opts || {};
    const qs = o.params ? '&' + new URLSearchParams(o.params).toString() : '';
    const headers = {};
    if (S.token) headers.Authorization = 'Bearer ' + S.token;
    if (o.body) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetch(API + '/api/account?a=' + encodeURIComponent(action) + qs, {
        method: o.body ? 'POST' : 'GET',
        headers,
        body: o.body ? JSON.stringify(o.body) : undefined,
        cache: 'no-store',
      });
    } catch (e) {
      throw Object.assign(new Error('Could not reach the server. Check your internet connection and try again.'), { status: 0 });
    }
    let data = {};
    try {
      data = await res.json();
    } catch (e) {
      data = {};
    }
    if (res.status === 401 && !['login', 'signup', 'plans'].includes(action)) {
      signOutLocal();
      toast('Please sign in again.');
      go('#/signin');
      throw Object.assign(new Error(data.error || 'Please sign in.'), { status: 401, handled: true });
    }
    if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong (' + res.status + '). Please try again.'), { status: res.status });
    if (data.user) setSession(undefined, data.user);
    return data;
  }

  async function getPlans() {
    if (!S.plans) S.plans = await api('plans');
    return S.plans;
  }

  /** The medicine search engine (same data + engine as the main site, loaded on first use). */
  function loadEngine() {
    if (S.engine) return Promise.resolve(S.engine);
    if (!S.enginePromise) {
      S.enginePromise = window.SDData.load('data/medicines.json')
        .then((ds) => {
          S.engine = window.SDSearch.createEngine(ds);
          return S.engine;
        })
        .catch((e) => {
          S.enginePromise = null;
          throw e;
        });
    }
    return S.enginePromise;
  }
  const medLabel = (m) => (m ? `${m.name} ${m.strength || ''}`.trim() : '');
  const medMeta = (m) => (m ? [m.generic, m.form, m.pack, m.manufacturer].filter(Boolean).join(' · ') : '');

  // ===========================================================================
  // Small render helpers
  // ===========================================================================
  const loadingHtml = '<div class="loading"><div class="spinner" aria-hidden="true"></div><span>Loading…</span></div>';
  const icInfo = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>';

  function errorHtml(e) {
    if (e && e.status === 402) {
      return `<div class="upgrade"><p>${esc(e.message)}</p><div class="actions"><a class="btn btn-primary" href="#/plan">Upgrade your plan</a><a class="btn btn-ghost" href="business">Compare plans</a></div></div>`;
    }
    return `<div class="notice bad">${icInfo}<p>${esc((e && e.message) || 'Something went wrong.')}</p></div>`;
  }
  /** Run an async loader into an element, showing a spinner and a friendly error. */
  async function into(el, fn) {
    if (!el) return;
    el.innerHTML = loadingHtml;
    try {
      await fn(el);
    } catch (e) {
      if (e && e.handled) return;
      el.innerHTML = errorHtml(e);
    }
  }
  function msg(el, text, good) {
    if (!el) return;
    el.textContent = text || '';
    el.className = 'form-msg ' + (text ? (good ? 'good' : 'bad') : '');
  }
  /** Wire a <form>: disables the submit button while running, shows errors in .form-msg. */
  function onSubmit(form, fn) {
    if (!form) return;
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const btn = $('button[type="submit"]', form);
      const out = $('.form-msg', form);
      msg(out, '');
      if (btn) btn.disabled = true;
      try {
        await fn(new FormData(form), out);
      } catch (e) {
        if (!e || !e.handled) {
          if (e && e.status === 402) {
            msg(out, e.message + ' Open the Plan & billing tab to upgrade.');
          } else msg(out, (e && e.message) || 'Something went wrong.');
        }
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }
  const val = (fd, k) => String(fd.get(k) || '').trim();

  function setTitle(t) {
    document.title = t + ' | Sasta Dawa Finder';
  }

  // ===========================================================================
  // Router
  // ===========================================================================
  const params = new URLSearchParams(location.search);

  function tabsFor(role) {
    const t = {
      patient: [['medicines', 'My Medicines']],
      pharmacy: [['branches', 'My pharmacy']],
      clinic: [['clinic', 'Clinic widget']],
      ngo: [['optimiser', 'Budget optimiser'], ['patients', 'Patients']],
      company: [['company', 'Company benefit']],
      developer: [['keys', 'API keys']],
    }[role] || [];
    return t.concat([['plan', 'Plan & billing'], ['profile', 'Profile']]);
  }

  function route() {
    const parts = (location.hash.replace(/^#\/?/, '') || '').split('/').map(decodeURIComponent);
    window.scrollTo(0, 0);
    if (!S.token || !S.user) {
      const mode = parts[0] === 'signup' || (parts[0] !== 'signin' && params.get('mode') === 'signup') ? 'signup' : 'signin';
      return renderAuth(mode);
    }
    const tabs = tabsFor(S.user.role);
    let tab = parts[0] || '';
    if (tab === 'signin' || tab === 'signup') tab = '';
    if (tab === 'branch') return renderDashboard('branches', parts.slice(1));
    if (!tabs.some((x) => x[0] === tab)) tab = tabs[0][0];
    renderDashboard(tab, parts.slice(1));
  }
  window.addEventListener('hashchange', route);

  // ===========================================================================
  // Sign in / Create account
  // ===========================================================================
  function renderAuth(mode) {
    setTitle(mode === 'signup' ? 'Create account' : 'Sign in');
    const pre = ROLE_LABEL[params.get('type')] ? params.get('type') : 'patient';
    const typeOpts = Object.keys(ROLE_LABEL)
      .map((r) => `<label class="type-opt"><input type="radio" name="role" value="${r}"${r === pre ? ' checked' : ''}><span>${esc(ROLE_LABEL[r])}<small>${esc(ROLE_HINT[r])}</small></span></label>`)
      .join('');
    app.innerHTML = `
      <section class="auth view">
        <h1 class="view-title">${mode === 'signup' ? 'Create your account' : 'Sign in to Sasta Dawa'}</h1>
        <p class="view-sub" style="margin-block-end:14px">${mode === 'signup' ? 'Business accounts (pharmacy, clinic, NGO, company, developer) get 30 days of their paid plan free. No card needed.' : 'One account for the website and the app.'}</p>
        <nav class="auth-switch" aria-label="Sign in or create account">
          <a href="#/signin"${mode === 'signin' ? ' aria-current="page"' : ''}>Sign in</a>
          <a href="#/signup"${mode === 'signup' ? ' aria-current="page"' : ''}>Create account</a>
        </nav>
        <div class="card">
        ${mode === 'signup' ? `
          <form class="form" id="signup-form" novalidate>
            <fieldset class="types"><legend>Account type</legend>${typeOpts}</fieldset>
            <label class="field">Name (or business name)<input class="input" name="name" autocomplete="name" required maxlength="80"></label>
            <div class="form-row">
              <label class="field">Email<input class="input" type="email" name="email" autocomplete="email" required maxlength="200"></label>
              <label class="field">Phone <small class="muted">(optional)</small><input class="input" type="tel" name="phone" autocomplete="tel" maxlength="30" placeholder="03xx xxxxxxx"></label>
            </div>
            <label class="field">Password <small class="muted">(at least 8 characters)</small><input class="input" type="password" name="password" autocomplete="new-password" required minlength="8" maxlength="200"></label>
            <label class="hp" aria-hidden="true">Website<input type="text" name="website" tabindex="-1" autocomplete="off"></label>
            <p class="small muted" style="margin:0">By creating an account you agree to our <a href="privacy.html">privacy policy</a>. We never sell your data.</p>
            <div class="actions"><button type="submit" class="btn btn-primary">Create account</button></div>
            <p class="form-msg" role="alert"></p>
          </form>` : `
          <form class="form" id="signin-form" novalidate>
            <label class="field">Email<input class="input" type="email" name="email" autocomplete="email" required maxlength="200"></label>
            <label class="field">Password<input class="input" type="password" name="password" autocomplete="current-password" required maxlength="200"></label>
            <div class="actions"><button type="submit" class="btn btn-primary">Sign in</button></div>
            <p class="form-msg" role="alert"></p>
            <p class="small muted" style="margin:0">Forgot your password? Message us on <a href="https://wa.me/${WA_NUMBER}" rel="noopener">WhatsApp ${WA_TEXT}</a> from your account's phone number.</p>
          </form>`}
        </div>
      </section>`;

    onSubmit($('#signin-form'), async (fd, out) => {
      if (!val(fd, 'email') || !val(fd, 'password')) return msg(out, 'Enter your email and password.');
      const r = await api('login', { body: { email: val(fd, 'email'), password: String(fd.get('password') || '') } });
      afterAuth(r);
    });
    onSubmit($('#signup-form'), async (fd, out) => {
      const body = {
        role: val(fd, 'role') || 'patient',
        name: val(fd, 'name'),
        email: val(fd, 'email'),
        phone: val(fd, 'phone'),
        password: String(fd.get('password') || ''),
        website: val(fd, 'website'),
      };
      if (body.name.length < 2) return msg(out, 'Please enter your name (or your business name).');
      if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(body.email)) return msg(out, 'Please enter a valid email address.');
      if (body.password.length < 8) return msg(out, 'Password must be at least 8 characters.');
      const r = await api('signup', { body });
      afterAuth(r);
    });
  }

  function afterAuth(r) {
    if (!r || !r.token || !r.user) throw new Error('Could not sign you in. Please try again.');
    setSession(r.token, r.user);
    S.pharmacies = null;
    toast('Welcome, ' + r.user.name + '!');
    if (location.search) history.replaceState(null, '', location.pathname + '#/');
    if (location.hash === '#/' || !location.hash) route();
    else location.hash = '#/';
  }

  // ===========================================================================
  // Dashboard shell
  // ===========================================================================
  function planBadges(u) {
    const b = [`<span class="badge brand">${esc(ROLE_LABEL[u.role] || u.role)}</span>`];
    if (u.plan !== 'free') b.push(`<span class="badge good">${esc(u.planName)}${u.trial ? ' · free trial' : ''}</span>`);
    else b.push('<span class="badge">Free plan</span>');
    if (u.joinedCompany) b.push(`<span class="badge">Staff of ${esc(u.joinedCompany.name)}</span>`);
    return b.join('');
  }

  function renderDashboard(tab, rest) {
    const u = S.user;
    const tabs = tabsFor(u.role);
    const label = (tabs.find((t) => t[0] === tab) || ['', 'Account'])[1];
    setTitle(label);
    let banner = '';
    if (u.plan !== 'free' && u.trial && u.planUntil) {
      banner = `<div class="notice info no-print">${icInfo}<p>Your free trial of <b>${esc(u.planName)}</b> runs until <b>${esc(fmtDate(u.planUntil))}</b>. <a href="#/plan">Pay to keep it</a>.</p></div>`;
    } else if (u.plan === 'free' && u.paidPlan) {
      banner = `<div class="notice no-print">${icInfo}<p>You are on the free plan. Paid features are paused. <a href="#/plan">Choose a plan</a>.</p></div>`;
    }
    app.innerHTML = `
      <div class="dash-head no-print">
        <div><h1>Hi, ${esc(u.name)}</h1><div class="badges">${planBadges(u)}</div></div>
      </div>
      ${banner}
      <nav class="tabs no-print" aria-label="Account sections" style="margin-block-start:14px">
        ${tabs.map((t) => `<a href="#/${t[0]}"${t[0] === tab ? ' aria-current="page"' : ''}>${esc(t[1])}</a>`).join('')}
      </nav>
      <section id="tab" class="view" aria-label="${esc(label)}"></section>`;
    const el = $('#tab');
    const views = {
      medicines: viewMedicines,
      branches: viewPharmacy,
      clinic: viewClinic,
      optimiser: viewOptimiser,
      patients: viewPatients,
      company: viewCompany,
      keys: viewKeys,
      plan: viewPlan,
      profile: viewProfile,
    };
    (views[tab] || viewProfile)(el, rest || []);
  }

  // ===========================================================================
  // Profile
  // ===========================================================================
  function viewProfile(el) {
    const u = S.user;
    el.innerHTML = `
      <div class="grid-2">
        <div class="card">
          <h2>Your details</h2>
          <form class="form" id="profile-form">
            <label class="field">Email<input class="input" value="${esc(u.email)}" disabled></label>
            <label class="field">Name<input class="input" name="name" value="${esc(u.name)}" maxlength="80" required></label>
            <label class="field">Phone<input class="input" type="tel" name="phone" value="${esc(u.phone || '')}" maxlength="30"></label>
            <div class="actions"><button type="submit" class="btn btn-primary">Save</button></div>
            <p class="form-msg" role="status"></p>
          </form>
        </div>
        <div class="card">
          <h2>Change password</h2>
          <form class="form" id="password-form">
            <label class="field">Current password<input class="input" type="password" name="current" autocomplete="current-password" required></label>
            <label class="field">New password <small class="muted">(8+ characters)</small><input class="input" type="password" name="password" autocomplete="new-password" minlength="8" required></label>
            <div class="actions"><button type="submit" class="btn btn-primary">Change password</button></div>
            <p class="form-msg" role="status"></p>
            <p class="small muted" style="margin:0">Changing your password signs you out on your other devices.</p>
          </form>
        </div>
      </div>
      <div class="card">
        <h2>Sign out</h2>
        <div class="actions">
          <button type="button" class="btn btn-ghost" id="signout">Sign out</button>
          <button type="button" class="btn btn-ghost" id="signout-all">Sign out everywhere</button>
        </div>
        <p class="form-msg" id="signout-msg" role="status"></p>
      </div>
      <div class="card">
        <h2>Delete account</h2>
        <p class="muted">This permanently deletes your account${u.role === 'pharmacy' ? ', your pharmacy listings' : ''}${u.role === 'developer' ? ', your API keys' : ''} and saved data. It cannot be undone.</p>
        <form class="form" id="delete-form">
          <label class="field">Your password<input class="input" type="password" name="password" autocomplete="current-password" required></label>
          <label class="check"><input type="checkbox" name="sure" value="1"> I understand this cannot be undone</label>
          <div class="actions"><button type="submit" class="btn btn-danger">Delete my account</button></div>
          <p class="form-msg" role="alert"></p>
        </form>
      </div>`;

    onSubmit($('#profile-form', el), async (fd, out) => {
      await api('update-profile', { body: { name: val(fd, 'name'), phone: val(fd, 'phone') } });
      msg(out, 'Saved.', true);
      $('.dash-head h1').textContent = 'Hi, ' + S.user.name;
    });
    onSubmit($('#password-form', el), async (fd, out) => {
      const pw = String(fd.get('password') || '');
      if (pw.length < 8) return msg(out, 'New password must be at least 8 characters.');
      const r = await api('change-password', { body: { current: String(fd.get('current') || ''), password: pw } });
      if (r.token) setSession(r.token);
      $('#password-form', el).reset();
      msg(out, 'Password changed.', true);
    });
    $('#signout', el).addEventListener('click', () => {
      signOutLocal();
      toast('Signed out.');
      go('#/signin');
    });
    $('#signout-all', el).addEventListener('click', async () => {
      try {
        await api('logout-all', { body: {} });
        signOutLocal();
        toast('Signed out on all devices.');
        go('#/signin');
      } catch (e) {
        if (!e.handled) msg($('#signout-msg', el), e.message);
      }
    });
    onSubmit($('#delete-form', el), async (fd, out) => {
      if (!fd.get('sure')) return msg(out, 'Tick the box to confirm.');
      await api('delete-account', { body: { password: String(fd.get('password') || '') } });
      signOutLocal();
      toast('Your account has been deleted.');
      go('#/signup');
    });
  }

  // ===========================================================================
  // Plan & billing (+ join company)
  // ===========================================================================
  function viewPlan(el) {
    into(el, async () => {
      const [pl, pays] = await Promise.all([getPlans(), api('payments')]);
      const u = S.user;
      const mine = Object.entries(pl.plans).filter(([k, p]) => k !== 'free' && p.roles.includes(u.role));
      const pay = pl.payTo || {};
      const hasPay = pay.jazzcash || pay.easypaisa || pay.bank;
      const per = (p) => (p.period === 'year' ? 'year' : 'month');
      const statusBadge = (s) => `<span class="badge ${s === 'approved' ? 'good' : s === 'rejected' ? 'bad' : 'warn'}">${esc(s === 'pending' ? 'Waiting for approval' : s)}</span>`;

      el.innerHTML = `
        <div class="grid-2">
          <div class="card">
            <h2>Your plan</h2>
            <p><b>${esc(u.planName)}</b>${u.trial ? ' <span class="badge warn">Free trial</span>' : ''}</p>
            ${u.planUntil ? `<p class="muted">${u.trial ? 'Trial ends' : 'Paid until'} <b>${esc(fmtDate(u.planUntil))}</b>.</p>` : '<p class="muted">No paid plan is active.</p>'}
            ${mine.length ? `<h3>Plans for your account</h3><ul class="items" style="list-style:none;padding:0;margin:0">${mine.map(([, p]) => `<li class="item"><div class="item-top"><span class="item-title">${esc(p.name)}</span><b>${esc(rs(p.price))} / ${per(p)}</b></div></li>`).join('')}</ul>
            <p class="small muted" style="margin-block-start:10px">What each plan includes: <a href="business">see all plans</a>.</p>` : '<p class="muted">Personal accounts are free. You can still join your employer\'s benefit below.</p>'}
          </div>
          ${mine.length ? `<div class="card">
            <h2>Pay for your plan</h2>
            ${hasPay ? `<div class="pay-box">
                ${pay.title ? `<div>Account title: <b>${esc(pay.title)}</b></div>` : ''}
                ${pay.jazzcash ? `<div>JazzCash: <b>${esc(pay.jazzcash)}</b></div>` : ''}
                ${pay.easypaisa ? `<div>Easypaisa: <b>${esc(pay.easypaisa)}</b></div>` : ''}
                ${pay.bank ? `<div>Bank transfer: <b>${esc(pay.bank)}</b></div>` : ''}
              </div>
              <p class="small muted" style="margin-block-start:8px">Send the amount, then enter the transaction ID below. We activate your plan after checking the payment (usually within a day).</p>`
              : `<p>To pay, contact us on <a href="https://wa.me/${WA_NUMBER}?text=${encodeURIComponent('Assalam o Alaikum, I want to pay for my Sasta Dawa plan. My account email: ' + u.email)}" rel="noopener">WhatsApp ${WA_TEXT}</a> and we will send payment details. Then enter the transaction ID here.</p>`}
            <form class="form" id="pay-form">
              <div class="form-row">
                <label class="field">Plan<select class="input select" name="plan">${mine.map(([k, p]) => `<option value="${esc(k)}"${k === u.paidPlan ? ' selected' : ''}>${esc(p.name)} (${esc(rs(p.price))}/${per(p)})</option>`).join('')}</select></label>
                <label class="field">Pay for<select class="input select" name="periods">${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">${i + 1} period${i ? 's' : ''}</option>`).join('')}</select></label>
              </div>
              <p class="small" style="margin:0">Amount to send: <b id="pay-amount"></b></p>
              <div class="form-row">
                <label class="field">Paid with<select class="input select" name="method"><option value="jazzcash">JazzCash</option><option value="easypaisa">Easypaisa</option><option value="bank">Bank transfer</option></select></label>
                <label class="field">Transaction ID<input class="input" name="txnId" maxlength="60" required></label>
              </div>
              <label class="field">Phone you paid from<input class="input" type="tel" name="payerPhone" maxlength="30" value="${esc(u.phone || '')}"></label>
              <div class="actions"><button type="submit" class="btn btn-primary">Submit payment</button></div>
              <p class="form-msg" role="status"></p>
            </form>
          </div>` : ''}
        </div>
        ${mine.length ? `<div class="card">
          <h2>My payments</h2>
          ${pays.payments.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Plan</th><th class="n">Amount</th><th>Method</th><th>Transaction</th><th>Status</th></tr></thead><tbody>
            ${pays.payments.map((p) => `<tr><td>${esc(fmtDate(p.at))}</td><td>${esc((pl.plans[p.plan] || {}).name || p.plan)} × ${esc(p.periods)}</td><td class="n">${esc(rs(p.amount))}</td><td>${esc(p.method)}</td><td>${esc(p.txnId)}</td><td>${statusBadge(p.status)}</td></tr>`).join('')}
          </tbody></table></div>` : '<p class="empty-note">No payments yet.</p>'}
        </div>` : ''}
        <div class="card">
          <h2>Join company benefit</h2>
          ${u.joinedCompany ? `<p>You are part of <b>${esc(u.joinedCompany.name)}</b> (code ${esc(u.joinedCompany.code)}).</p>` : '<p class="muted">If your employer or insurer gave you a Sasta Dawa company code, enter it here.</p>'}
          <form class="form" id="join-form">
            <label class="field">Company code<input class="input" name="code" maxlength="20" autocomplete="off" style="text-transform:uppercase"></label>
            <div class="actions"><button type="submit" class="btn btn-ghost">Join company</button></div>
            <p class="form-msg" role="status"></p>
          </form>
        </div>`;

      const pf = $('#pay-form', el);
      if (pf) {
        const upd = () => {
          const p = pl.plans[pf.elements.plan.value];
          $('#pay-amount', el).textContent = p ? `${rs(p.price * Number(pf.elements.periods.value))} (${pf.elements.periods.value} ${per(p)}${pf.elements.periods.value > 1 ? 's' : ''})` : '';
        };
        pf.addEventListener('change', upd);
        upd();
        onSubmit(pf, async (fd, out) => {
          if (val(fd, 'txnId').length < 4) return msg(out, 'Enter the transaction ID from your payment SMS.');
          await api('pay', { body: { plan: val(fd, 'plan'), periods: Number(val(fd, 'periods')), method: val(fd, 'method'), txnId: val(fd, 'txnId'), payerPhone: val(fd, 'payerPhone') } });
          toast('Payment submitted. We will activate your plan after checking it.');
          viewPlan(el);
        });
      }
      onSubmit($('#join-form', el), async (fd, out) => {
        const code = val(fd, 'code').toUpperCase();
        if (!/^[A-Z0-9]{4,12}$/.test(code)) return msg(out, 'Enter the code exactly as your company gave it.');
        await api('join-company', { body: { code } });
        toast('You joined ' + S.user.joinedCompany.name + '.');
        renderDashboard('plan');
      });
    });
  }

  // ===========================================================================
  // Patient: My Medicines
  // ===========================================================================
  function viewMedicines(el) {
    into(el, async () => {
      const r = await api('me');
      const cab = r.user.cabinet || [];
      let engine = null;
      if (cab.length) {
        try {
          engine = await loadEngine();
        } catch (e) {
          engine = null;
        }
      }
      el.innerHTML = `
        <div class="card">
          <h2>My Medicines</h2>
          <p class="muted">This list syncs from <b>My Medicines</b> on the main site and app while you are signed in, so it is safe if you change phones.</p>
          ${cab.length ? `<div class="items">${cab.map((c) => {
            const m = engine && engine.byId(c.id);
            const cost = m ? m.unitPrice * (c.perDay || 1) * 30 : 0;
            return `<div class="item"><div class="item-top"><div><div class="item-title">${esc(m ? medLabel(m) : c.id)}</div><div class="item-meta">${esc(m ? medMeta(m) : '')}</div></div>
              <div class="n" style="text-align:end">${m ? `<b>${esc(rs(cost))}</b><div class="item-meta">a month at ${esc(c.perDay || 1)}/day</div>` : ''}</div></div></div>`;
          }).join('')}</div>` : '<p class="empty-note">No medicines saved yet.</p>'}
          <div class="actions" style="margin-block-start:14px"><a class="btn btn-primary" href="/#/my-medicines">Open My Medicines</a><a class="btn btn-ghost" href="/">Search medicines</a></div>
        </div>`;
    });
  }

  // ===========================================================================
  // Medicine picker (search with the site's engine)
  // ===========================================================================
  /** Renders a search box into `host`; calls onPick(med) when the user adds a result. */
  function medPicker(host, onPick, opts) {
    const o = opts || {};
    const id = 'pk' + Math.random().toString(36).slice(2, 8);
    host.innerHTML = `<div class="picker">
      <label class="field" for="${id}">${esc(o.label || 'Search a medicine')}</label>
      <input class="input" id="${id}" type="search" autocomplete="off" placeholder="e.g. Panadol, Augmentin, Omeprazole" style="margin-block-start:6px">
      <ul class="picker-results" aria-live="polite"></ul></div>`;
    const input = $('input', host);
    const list = $('ul', host);
    let found = [];
    let timer = null;
    const run = async () => {
      const q = input.value.trim();
      if (q.length < 2) {
        list.innerHTML = '';
        return;
      }
      let engine;
      try {
        engine = await loadEngine();
      } catch (e) {
        list.innerHTML = '<li>Could not load the medicine list. Check your connection.</li>';
        return;
      }
      found = engine.search(q, { limit: 12 }).map((r) => r.med);
      list.innerHTML = found.length
        ? found.map((m, i) => `<li><div class="pr-main"><div class="pr-name">${esc(medLabel(m))}</div><div class="pr-meta">${esc(medMeta(m))} · ${esc(rs2(m.price))}</div></div><button type="button" class="btn btn-soft sm" data-i="${i}" style="min-height:44px">${esc(o.button || 'Add')}</button></li>`).join('')
        : '<li class="muted">No medicine found. Try the brand or formula name.</li>';
    };
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(run, 150);
    });
    input.addEventListener('focus', () => loadEngine().catch(() => {}));
    list.addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-i]');
      if (!b) return;
      const m = found[Number(b.dataset.i)];
      if (m) onPick(m);
      if (o.clear !== false) {
        input.value = '';
        list.innerHTML = '';
        input.focus();
      }
    });
  }

  // ===========================================================================
  // Pharmacy
  // ===========================================================================
  async function myPharmacies(fresh) {
    if (!S.pharmacies || fresh) S.pharmacies = (await api('my-pharmacies')).pharmacies;
    return S.pharmacies;
  }
  const verifiedBadge = (p) => (p.verified ? '<span class="badge good">✓ Verified</span>' : '<span class="badge warn">Pending verification by Sasta Dawa team</span>');

  function viewPharmacy(el, rest) {
    const pid = rest[0];
    if (!pid) return pharmacyList(el);
    if (pid === 'new') return pharmacyForm(el, null);
    into(el, async () => {
      const list = await myPharmacies();
      const p = list.find((x) => x.id === pid);
      if (!p) throw new Error('Pharmacy not found.');
      const sub = rest[1] || 'dashboard';
      const subs = [
        ['dashboard', 'Dashboard'],
        ['stock', 'Stock & prices'],
        ['bulk', 'Bulk upload'],
        ['alerts', 'Request alerts'],
        ['reservations', 'Reservations'],
        ['report', 'Monthly report'],
        ['competitors', 'Competitor prices'],
        ['qr', 'QR sticker'],
        ['edit', 'Edit details'],
      ];
      el.innerHTML = `
        <div class="no-print" style="margin-block-end:10px">
          <a class="back-link" href="#/branches">← All branches</a>
          <div class="item-top"><h2 style="margin:4px 0;font-size:20px;overflow-wrap:anywhere">${esc(p.name)}</h2><div class="badges">${verifiedBadge(p)}</div></div>
          <p class="item-meta" style="margin:0">${esc([p.address, p.area, p.city].filter(Boolean).join(', '))}</p>
        </div>
        <nav class="tabs sub no-print" aria-label="Branch sections">${subs.map((s) => `<a href="#/branch/${esc(p.id)}/${s[0]}"${s[0] === sub ? ' aria-current="page"' : ''}>${esc(s[1])}</a>`).join('')}</nav>
        <div id="branch-view"></div>`;
      const bv = $('#branch-view', el);
      const fns = { dashboard: branchStats, stock: branchStock, bulk: branchBulk, alerts: branchAlerts, reservations: branchReservations, report: branchReport, competitors: branchCompetitors, qr: branchQr, edit: (v, x) => pharmacyForm(v, x) };
      (fns[sub] || branchStats)(bv, p);
    });
  }

  function pharmacyList(el) {
    into(el, async () => {
      const list = await myPharmacies(true);
      const premium = S.user.plan === 'pharmacy_premium';
      el.innerHTML = `
        <div class="card">
          <div class="item-top"><h2>Your branches</h2>${!list.length || premium ? '<a class="btn btn-primary" href="#/branch/new">Add branch</a>' : ''}</div>
          ${list.length ? `<div class="items">${list.map((p) => `
            <div class="item">
              <div class="item-top"><div><div class="item-title">${esc(p.name)}</div><div class="item-meta">${esc([p.address, p.area, p.city].filter(Boolean).join(', '))}</div></div><div class="badges">${verifiedBadge(p)}${p.featured ? '<span class="badge brand">Featured</span>' : ''}${p.delivery ? '<span class="badge brand">Delivery</span>' : ''}</div></div>
              <div class="item-meta">${esc(Object.keys(p.stock || {}).length)} medicines listed${p.hours ? ' · ' + esc(p.hours) : ''}</div>
              <div class="actions"><a class="btn btn-primary sm" style="min-height:44px" href="#/branch/${esc(p.id)}/dashboard">Open</a><a class="btn btn-ghost sm" style="min-height:44px" href="#/branch/${esc(p.id)}/stock">Stock & prices</a><a class="btn btn-ghost sm" style="min-height:44px" href="#/branch/${esc(p.id)}/edit">Edit</a></div>
            </div>`).join('')}</div>` : '<p class="empty-note">Add your pharmacy so people nearby can find you, see what is in stock and contact you on WhatsApp.</p>'}
          ${list.length && !premium ? '<p class="small muted" style="margin-block-start:12px">More than one branch needs <a href="#/plan">Pharmacy Premium</a>.</p>' : ''}
        </div>
        <div class="notice info">${icInfo}<p>New listings appear on the site after a quick check by the Sasta Dawa team (we may call the number you give).</p></div>`;
    });
  }

  function pharmacyForm(el, p) {
    const u = S.user;
    const paid = u.plan === 'pharmacy_pro' || u.plan === 'pharmacy_premium';
    const premium = u.plan === 'pharmacy_premium';
    const x = p || {};
    el.innerHTML = `
      <div class="card">
        ${p ? '' : '<a class="back-link" href="#/branches">← All branches</a>'}
        <h2>${p ? 'Edit branch details' : 'Add a branch'}</h2>
        <form class="form" id="ph-form">
          <label class="field">Pharmacy name<input class="input" name="name" value="${esc(x.name || '')}" maxlength="100" required></label>
          <label class="field">Address<input class="input" name="address" value="${esc(x.address || '')}" maxlength="200" required></label>
          <div class="form-row">
            <label class="field">Area / sector<input class="input" name="area" value="${esc(x.area || '')}" maxlength="60"></label>
            <label class="field">City<input class="input" name="city" value="${esc(x.city || '')}" maxlength="40" required></label>
          </div>
          <div class="form-row">
            <label class="field">Phone<input class="input" type="tel" name="phone" value="${esc(x.phone || '')}" maxlength="30"></label>
            <label class="field">WhatsApp<input class="input" type="tel" name="whatsapp" value="${esc(x.whatsapp || '')}" maxlength="30"></label>
          </div>
          <label class="field">Opening hours<input class="input" name="hours" value="${esc(x.hours || '')}" maxlength="80" placeholder="e.g. 9am – 11pm, open 7 days"></label>
          <div class="form-row">
            <label class="field">Latitude<input class="input" name="lat" inputmode="decimal" value="${esc(x.lat == null ? '' : x.lat)}"></label>
            <label class="field">Longitude<input class="input" name="lng" inputmode="decimal" value="${esc(x.lng == null ? '' : x.lng)}"></label>
          </div>
          <div class="actions"><button type="button" class="btn btn-ghost" id="geo-btn">Use my current location</button><span class="small muted" id="geo-msg">Stand inside the pharmacy for the best result.</span></div>
          <label class="check"><input type="checkbox" name="featured" value="1"${x.featured ? ' checked' : ''}${paid ? '' : ' disabled'}> Show as featured in search results <small>(Pharmacy Pro)</small></label>
          <label class="check"><input type="checkbox" name="delivery" value="1"${x.delivery ? ' checked' : ''}${premium ? '' : ' disabled'}> We offer home delivery <small>(Pharmacy Premium)</small></label>
          <div class="actions"><button type="submit" class="btn btn-primary">${p ? 'Save changes' : 'Add pharmacy'}</button>${p ? '<button type="button" class="btn btn-ghost" id="ph-delete">Delete branch</button>' : ''}</div>
          <p class="form-msg" role="status"></p>
        </form>
      </div>`;
    const f = $('#ph-form', el);
    $('#geo-btn', el).addEventListener('click', () => {
      const gm = $('#geo-msg', el);
      if (!navigator.geolocation) {
        gm.textContent = 'Location is not available on this device. Enter it from Google Maps instead.';
        return;
      }
      gm.textContent = 'Finding your location…';
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          f.elements.lat.value = pos.coords.latitude.toFixed(6);
          f.elements.lng.value = pos.coords.longitude.toFixed(6);
          gm.textContent = 'Location added (accuracy about ' + Math.round(pos.coords.accuracy) + ' m).';
        },
        (err) => {
          gm.textContent = err && err.code === 1 ? 'Location permission was denied. You can type the latitude and longitude from Google Maps.' : 'Could not get your location. Try again or type it in.';
        },
        { enableHighAccuracy: true, timeout: 15000 }
      );
    });
    onSubmit(f, async (fd, out) => {
      const body = { name: val(fd, 'name'), address: val(fd, 'address'), area: val(fd, 'area'), city: val(fd, 'city'), phone: val(fd, 'phone'), whatsapp: val(fd, 'whatsapp'), hours: val(fd, 'hours'), lat: val(fd, 'lat'), lng: val(fd, 'lng'), featured: !!fd.get('featured'), delivery: !!fd.get('delivery') };
      if (p) body.id = p.id;
      if (body.name.length < 2 || !body.address || !body.city) return msg(out, 'Name, address and city are required.');
      if (!body.phone && !body.whatsapp) return msg(out, 'Add a phone or WhatsApp number so customers can reach you.');
      if ((body.lat || body.lng) && !(Number(body.lat) >= 23 && Number(body.lat) <= 38 && Number(body.lng) >= 60 && Number(body.lng) <= 78)) return msg(out, 'The location does not look like it is in Pakistan. Check latitude and longitude.');
      const r = await api('save-pharmacy', { body });
      await myPharmacies(true);
      toast(p ? 'Saved.' : 'Pharmacy added. We will verify it soon.');
      go('#/branch/' + r.pharmacy.id + '/dashboard');
    });
    const del = $('#ph-delete', el);
    if (del) {
      del.addEventListener('click', async () => {
        if (!window.confirm('Delete "' + p.name + '"? Its stock list will be removed. This cannot be undone.')) return;
        try {
          await api('delete-pharmacy', { body: { id: p.id } });
          await myPharmacies(true);
          toast('Branch deleted.');
          go('#/branches');
        } catch (e) {
          if (!e.handled) msg($('.form-msg', f), e.message);
        }
      });
    }
  }

  function barChart(days, field) {
    const max = Math.max(1, ...days.map((d) => d[field] || 0));
    return `<div class="chart" role="img" aria-label="Daily ${esc(field)} for the last ${days.length} days">${days
      .map((d) => {
        const v = d[field] || 0;
        return `<div class="bar${v ? '' : ' zero'}" style="block-size:${v ? Math.max(4, Math.round((v / max) * 100)) : 2}%" title="${esc(d.day)}: ${v}"></div>`;
      })
      .join('')}</div><div class="chart-axis"><span>${esc(fmtDate(days[0] && days[0].day))}</span><span>Max ${max}/day</span><span>${esc(fmtDate(days[days.length - 1] && days[days.length - 1].day))}</span></div>`;
  }

  function branchStats(el, p) {
    into(el, async () => {
      const s = await api('stats', { params: { id: p.id } });
      const t = s.totals || {};
      const card = (label, n) => `<div class="stat"><small>${esc(label)}</small><b class="num">${esc(n || 0)}</b></div>`;
      el.innerHTML = `
        <h3 style="margin:0 0 10px">Last 30 days</h3>
        <div class="stat-grid">${card('Profile views', t.view)}${card('WhatsApp taps', t.wa)}${card('Calls', t.call)}${card('Directions', t.dir)}${card('Reservations', t.reserve)}</div>
        <div class="card"><h3>Daily views</h3>${barChart(s.days || [], 'view')}</div>`;
    });
  }

  // -- Stock & prices
  function branchStock(el, p) {
    const draft = {}; // id -> {s, price, remove}
    el.innerHTML = `
      <div class="card"><div id="stock-picker"></div><p class="small muted" style="margin-block-start:8px">Customers see “in stock” on the medicine page. Your own price shows with Pharmacy Pro.</p></div>
      <div class="card">
        <div class="item-top"><h3>Your stock list</h3><div class="actions"><button type="button" class="btn btn-primary" id="stock-save" disabled>Save changes</button></div></div>
        <p class="form-msg" id="stock-msg" role="status"></p>
        <div id="stock-list">${loadingHtml}</div>
      </div>`;
    const listEl = $('#stock-list', el);
    const saveBtn = $('#stock-save', el);
    let engine = null;
    const current = () => {
      const st = Object.assign({}, p.stock || {});
      Object.entries(draft).forEach(([id, d]) => {
        if (d.remove) delete st[id];
        else st[id] = { s: d.s, price: d.price };
      });
      return st;
    };
    const draw = () => {
      const st = current();
      const ids = Object.keys(st);
      saveBtn.disabled = !Object.keys(draft).length;
      saveBtn.textContent = Object.keys(draft).length ? `Save ${Object.keys(draft).length} change${Object.keys(draft).length > 1 ? 's' : ''}` : 'Save changes';
      if (!ids.length) {
        listEl.innerHTML = '<p class="empty-note">No medicines yet. Search above to add what you keep in stock.</p>';
        return;
      }
      ids.sort((a, b) => medLabel(engine && engine.byId(a)).localeCompare(medLabel(engine && engine.byId(b))));
      listEl.innerHTML = `<div class="table-wrap"><table class="tbl"><thead><tr><th>Medicine</th><th>Stock</th><th class="n">Your price (Rs)</th><th class="n">DRAP price</th><th><span class="sr-only">Remove</span></th></tr></thead><tbody>${ids
        .map((id) => {
          const m = engine && engine.byId(id);
          const x = st[id];
          const out = x.s === 'out';
          return `<tr data-id="${esc(id)}"><td><b>${esc(m ? medLabel(m) : id)}</b><span class="sub">${esc(m ? m.pack || '' : '')}</span></td>
            <td><div class="seg-toggle" role="group" aria-label="Stock status"><button type="button" class="in" data-s="in" aria-pressed="${!out}">In</button><button type="button" class="out" data-s="out" aria-pressed="${out}">Out</button></div></td>
            <td class="n"><input class="input" type="number" min="0" step="0.01" inputmode="decimal" aria-label="Your price" value="${esc(x.price || '')}" data-price></td>
            <td class="n">${esc(m ? rs2(m.price) : '')}</td>
            <td><button type="button" class="icon-btn" data-remove aria-label="Remove ${esc(m ? medLabel(m) : id)}">✕</button></td></tr>`;
        })
        .join('')}</tbody></table></div>`;
    };
    const touch = (id, change) => {
      const base = draft[id] || (p.stock && p.stock[id] ? { s: p.stock[id].s, price: p.stock[id].price } : { s: 'in' });
      draft[id] = Object.assign({}, base, change);
    };
    listEl.addEventListener('click', (ev) => {
      const tr = ev.target.closest('tr[data-id]');
      if (!tr) return;
      const id = tr.dataset.id;
      const sb = ev.target.closest('button[data-s]');
      if (sb) {
        touch(id, { s: sb.dataset.s });
        draw();
      } else if (ev.target.closest('button[data-remove]')) {
        if (p.stock && p.stock[id]) draft[id] = { remove: true };
        else delete draft[id];
        draw();
      }
    });
    listEl.addEventListener('change', (ev) => {
      if (!ev.target.matches('input[data-price]')) return;
      const id = ev.target.closest('tr').dataset.id;
      const v = Number(ev.target.value);
      touch(id, { price: v > 0 ? v : undefined });
      draw();
    });
    saveBtn.addEventListener('click', async () => {
      const items = Object.entries(draft).map(([id, d]) => (d.remove ? { id, remove: true } : { id, s: d.s, price: d.price }));
      if (!items.length) return;
      saveBtn.disabled = true;
      msg($('#stock-msg', el), '');
      try {
        const r = await api('set-stock', { body: { id: p.id, items } });
        p.stock = r.stock;
        Object.keys(draft).forEach((k) => delete draft[k]);
        msg($('#stock-msg', el), `Saved ${r.changed} change${r.changed === 1 ? '' : 's'}.`, true);
        draw();
      } catch (e) {
        if (e.handled) return;
        if (e.status === 402) {
          $('#stock-msg', el).innerHTML = errorHtml(e);
          $('#stock-msg', el).className = 'form-msg';
        } else msg($('#stock-msg', el), e.message);
        saveBtn.disabled = false;
      }
    });
    loadEngine()
      .then((e) => {
        engine = e;
        medPicker($('#stock-picker', el), (m) => {
          touch(m.id, { s: 'in' });
          draw();
          toast(medLabel(m) + ' added. Remember to save.');
        }, { label: 'Add a medicine you stock' });
        draw();
      })
      .catch(() => {
        listEl.innerHTML = errorHtml(new Error('Could not load the medicine list. Check your connection and reload.'));
      });
  }

  // -- Bulk CSV upload
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') {
          cell += '"';
          i++;
        } else if (c === '"') q = false;
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ',' || c === '\t' || c === ';') {
        row.push(cell);
        cell = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      } else cell += c;
    }
    if (cell || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return rows.map((r) => r.map((x) => x.trim())).filter((r) => r.some(Boolean));
  }

  function matchRows(rows, engine) {
    if (rows.length && /^(medicine|name|id|product|item)/i.test(rows[0][0] || '')) rows = rows.slice(1);
    const matched = [];
    const unmatched = [];
    rows.slice(0, 5000).forEach((r, i) => {
      const key = r[0] || '';
      const st = /^(out|no|0|n|false|out of stock)$/i.test(r[1] || '') ? 'out' : 'in';
      const price = Number(String(r[2] || '').replace(/[^\d.]/g, '')) || undefined;
      let m = engine.byId(key);
      if (!m && key) {
        const hit = engine.search(key, { limit: 1 })[0];
        m = hit ? hit.med : null;
      }
      if (m) matched.push({ line: i + 1, input: key, med: m, s: st, price });
      else unmatched.push({ line: i + 1, input: key });
    });
    return { matched, unmatched };
  }

  function branchBulk(el, p) {
    const premium = S.user.plan === 'pharmacy_premium';
    el.innerHTML = `
      <div class="card">
        <h3>Bulk upload from a spreadsheet</h3>
        ${premium ? '' : '<div class="upgrade" style="margin-block-end:12px"><p>Uploading more than 50 medicines at once needs Pharmacy Premium.</p><div class="actions"><a class="btn btn-primary" href="#/plan">Upgrade</a></div></div>'}
        <p class="muted">Save your sheet as CSV with three columns: <b>medicine name or id</b>, <b>in/out</b>, <b>your price</b>. Example:</p>
        <pre class="code">Medicine,Stock,Price
Panadol 500mg,in,35
Augmentin 625mg,out,
Risek 20mg,in,480</pre>
        <form class="form" id="bulk-form">
          <label class="field">CSV file<input class="input" type="file" name="file" accept=".csv,text/csv,text/plain"></label>
          <label class="field">…or paste rows here<textarea class="input" name="text" rows="6" placeholder="Panadol 500mg,in,35"></textarea></label>
          <div class="actions"><button type="submit" class="btn btn-ghost">Check rows</button></div>
          <p class="form-msg" role="status"></p>
        </form>
      </div>
      <div id="bulk-preview"></div>`;
    const prev = $('#bulk-preview', el);
    onSubmit($('#bulk-form', el), async (fd, out) => {
      const file = fd.get('file');
      let text = val(fd, 'text');
      if (file && file.size) {
        if (file.size > 2 * 1024 * 1024) return msg(out, 'The file is too large (2 MB max).');
        text = await file.text();
      }
      if (!text) return msg(out, 'Choose a CSV file or paste some rows.');
      msg(out, 'Matching medicines…', true);
      const engine = await loadEngine();
      const res = matchRows(parseCsv(text), engine);
      msg(out, '');
      prev.innerHTML = `
        <div class="card">
          <h3>${res.matched.length} matched, ${res.unmatched.length} not found</h3>
          <p class="small muted">Check the matches: names are matched with the same search as the website. Fix any wrong ones in your sheet (use the exact brand and strength, or the medicine id) and check again.</p>
          ${res.matched.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>#</th><th>Your row</th><th>Matched medicine</th><th>Stock</th><th class="n">Price</th></tr></thead><tbody>${res.matched
            .slice(0, 500)
            .map((r) => `<tr><td>${r.line}</td><td>${esc(r.input)}</td><td><b>${esc(medLabel(r.med))}</b><span class="sub">${esc(medMeta(r.med))}</span></td><td>${r.s === 'out' ? '<span class="badge bad">Out</span>' : '<span class="badge good">In</span>'}</td><td class="n">${r.price ? esc(rs2(r.price)) : ''}</td></tr>`)
            .join('')}</tbody></table></div>${res.matched.length > 500 ? `<p class="small muted">Showing the first 500 of ${res.matched.length}.</p>` : ''}` : ''}
          ${res.unmatched.length ? `<h3 style="margin-block-start:14px">Not found</h3><p class="small">${res.unmatched.slice(0, 200).map((r) => `Row ${r.line}: ${esc(r.input || '(empty)')}`).join('<br>')}</p>` : ''}
          ${res.matched.length ? `<div class="actions" style="margin-block-start:12px"><button type="button" class="btn btn-primary" id="bulk-go">Upload ${res.matched.length} medicines</button></div><p class="form-msg" id="bulk-msg" role="status"></p>` : ''}
        </div>`;
      const go = $('#bulk-go', prev);
      if (!go) return;
      go.addEventListener('click', async () => {
        go.disabled = true;
        const bm = $('#bulk-msg', prev);
        const items = res.matched.map((r) => ({ id: r.med.id, s: r.s, price: r.price }));
        let done = 0;
        try {
          for (let i = 0; i < items.length; i += 1000) {
            const r = await api('set-stock', { body: { id: p.id, items: items.slice(i, i + 1000) } });
            done += r.changed;
            p.stock = r.stock;
            msg(bm, `Uploaded ${done} of ${items.length}…`, true);
          }
          msg(bm, `Done: ${done} medicines updated.`, true);
          toast('Stock list updated.');
        } catch (e) {
          if (e.handled) return;
          if (e.status === 402) {
            bm.innerHTML = errorHtml(e);
            bm.className = 'form-msg';
          } else msg(bm, e.message);
          go.disabled = false;
        }
      });
    });
  }

  function branchAlerts(el, p) {
    into(el, async () => {
      const r = await api('alerts', { params: { id: p.id } });
      el.innerHTML = `
        <div class="card">
          <h3>What people near ${esc(r.city)} searched for (last 7 days)</h3>
          <p class="small muted">Counts of medicine searches by people looking for pharmacies in your city. No personal data is collected.</p>
          ${r.demand.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Medicine</th><th class="n">Searches</th><th>Your stock</th></tr></thead><tbody>${r.demand
            .map((d) => `<tr><td><b>${esc(d.name)}</b><span class="sub">${esc(d.generic)}</span></td><td class="n">${esc(d.searches)}</td><td>${d.inStock ? '<span class="badge good">In stock</span>' : `<a href="#/branch/${esc(p.id)}/stock">Not listed: add it</a>`}</td></tr>`)
            .join('')}</tbody></table></div>` : '<p class="empty-note">No searches recorded for your city yet. They appear as people use the pharmacy finder.</p>'}
        </div>`;
    });
  }

  function branchReservations(el, p) {
    into(el, async () => {
      const r = await api('reservations', { params: { id: p.id } });
      const labels = { new: 'New', ready: 'Ready for pickup', collected: 'Collected', cancelled: 'Cancelled' };
      el.innerHTML = `
        <div class="card">
          <h3>Reservations</h3>
          ${r.reservations.length ? `<div class="items">${r.reservations
            .map((x, i) => `
            <div class="item">
              <div class="item-top"><div><div class="item-title">${esc(x.medName)}${x.qty ? ' × ' + esc(x.qty) : ''}</div><div class="item-meta">${esc(x.name)} · ${esc(x.phone)} · ${esc(fmtTime(x.at))}</div></div><span class="badge ${x.status === 'new' ? 'warn' : x.status === 'cancelled' ? 'bad' : 'good'}">${esc(labels[x.status] || x.status)}</span></div>
              ${x.note ? `<div class="item-meta">Note: ${esc(x.note)}</div>` : ''}
              <div class="actions">
                <label class="sr-only" for="rs${i}">Status</label>
                <select class="input select" id="rs${i}" data-key="${esc(x.key)}" style="inline-size:auto">${Object.keys(labels).map((k) => `<option value="${k}"${k === x.status ? ' selected' : ''}>${labels[k]}</option>`).join('')}</select>
                <a class="btn btn-soft" href="${esc(waLink(x.phone, `Assalam o Alaikum ${x.name}, this is ${p.name}. Your ${x.medName} is ready for pickup.`))}" target="_blank" rel="noopener">WhatsApp customer</a>
                <a class="btn btn-ghost" href="tel:${esc(String(x.phone || '').replace(/[^\d+]/g, ''))}">Call</a>
              </div>
            </div>`)
            .join('')}</div>` : '<p class="empty-note">No reservations yet. With Pharmacy Pro, customers can reserve a medicine from your listing.</p>'}
        </div>`;
      el.onchange = async (ev) => {
        const s = ev.target.closest('select[data-key]');
        if (!s) return;
        try {
          await api('reservation-update', { body: { key: s.dataset.key, status: s.value } });
          toast('Status updated.');
          branchReservations(el, p);
        } catch (e) {
          if (!e.handled) toast(e.message);
        }
      };
    });
  }

  function branchReport(el, p) {
    into(el, async () => {
      const r = await api('report', { params: { id: p.id } });
      const t = r.totals || {};
      el.innerHTML = `
        <div class="card report">
          <div class="item-top"><h2>Monthly report: ${esc(r.pharmacy.name)}</h2><button type="button" class="btn btn-primary no-print" id="print-btn">Print / save as PDF</button></div>
          <p class="muted">${esc([r.pharmacy.address, r.pharmacy.city].filter(Boolean).join(', '))} · last ${esc(r.period)} · generated ${esc(fmtDate(new Date()))}</p>
          <div class="table-wrap"><table class="tbl"><tbody>
            <tr><td>Profile views</td><td class="n">${esc(t.view || 0)}</td></tr>
            <tr><td>WhatsApp taps</td><td class="n">${esc(t.wa || 0)}</td></tr>
            <tr><td>Calls</td><td class="n">${esc(t.call || 0)}</td></tr>
            <tr><td>Directions</td><td class="n">${esc(t.dir || 0)}</td></tr>
            <tr><td>Reservations</td><td class="n">${esc(r.reservations || 0)}</td></tr>
          </tbody></table></div>
          <h3 style="margin-block-start:16px">Most searched medicines in ${esc(r.pharmacy.city)}</h3>
          ${r.topDemand.length ? `<ol>${r.topDemand.map((d) => `<li>${esc(d.name)} <span class="muted">(${esc(d.searches)} searches)</span></li>`).join('')}</ol>` : '<p class="muted">No searches recorded yet.</p>'}
          <p class="small muted print-only">Sasta Dawa Finder · sasta-dawa-finder.vercel.app</p>
        </div>`;
      $('#print-btn', el).addEventListener('click', () => window.print());
    });
  }

  function branchCompetitors(el, p) {
    into(el, async () => {
      const r = await api('competitors', { params: { id: p.id } });
      el.innerHTML = `
        <div class="card">
          <h3>Prices at other pharmacies in ${esc(r.city)}</h3>
          <p class="small muted">For medicines on your list that other listed pharmacies also price. Names of other pharmacies are not shown.</p>
          ${r.rows.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Medicine</th><th class="n">Yours</th><th class="n">Average</th><th class="n">Lowest</th><th class="n">Pharmacies</th><th class="n">DRAP price</th></tr></thead><tbody>${r.rows
            .map((x) => `<tr><td>${esc(x.name)}</td><td class="n">${x.yours ? esc(rs2(x.yours)) : '–'}</td><td class="n">${esc(rs2(x.avg))}</td><td class="n">${esc(rs2(x.min))}</td><td class="n">${esc(x.pharmacies)}</td><td class="n">${x.mrp ? esc(rs2(x.mrp)) : ''}</td></tr>`)
            .join('')}</tbody></table></div>` : '<p class="empty-note">No overlapping prices yet. This fills in as more pharmacies in your city add prices.</p>'}
        </div>`;
    });
  }

  function branchQr(el, p) {
    const url = SITE + '/?pharmacy=' + encodeURIComponent(p.id);
    let svg = '';
    try {
      svg = qrSvg(url);
    } catch (e) {
      svg = '';
    }
    el.innerHTML = `
      <div class="actions no-print" style="margin-block-end:12px"><button type="button" class="btn btn-primary" id="qr-print">Print sticker</button><span class="small muted">Stick it on your counter so customers can save your pharmacy.</span></div>
      <div class="sticker">
        <h2>${esc(p.name)}</h2>
        <p><b>Find us on Sasta Dawa Finder</b></p>
        ${svg}
        <p>Scan to see our stock, prices and WhatsApp</p>
        <p class="url">${esc(url)}</p>
      </div>`;
    $('#qr-print', el).addEventListener('click', () => window.print());
  }

  // ===========================================================================
  // Clinic
  // ===========================================================================
  function viewClinic(el) {
    const u = S.user;
    const c = u.clinic || { name: u.name, color: '#0f5c54', note: '', phone: u.phone || '' };
    const widgetUrl = SITE + '/widget?c=' + encodeURIComponent(u.id);
    const embed = `<iframe src="${widgetUrl}" width="100%" height="520" style="border:0"></iframe>`;
    el.innerHTML = `
      <div class="grid-2">
        <div class="card">
          <h2>Widget settings</h2>
          <form class="form" id="clinic-form">
            <label class="field">Name shown on the widget<input class="input" name="name" value="${esc(c.name || '')}" maxlength="80"></label>
            <label class="field">Brand colour<input class="input" type="color" name="color" value="${esc(/^#[0-9a-f]{6}$/i.test(c.color || '') ? c.color : '#0f5c54')}"></label>
            <label class="field">Note for patients <small class="muted">(optional)</small><textarea class="input" name="note" maxlength="200" rows="3">${esc(c.note || '')}</textarea></label>
            <label class="field">Clinic phone<input class="input" type="tel" name="phone" value="${esc(c.phone || '')}" maxlength="30"></label>
            <div class="actions"><button type="submit" class="btn btn-primary">Save</button><a class="btn btn-ghost" href="${esc(API ? widgetUrl : 'widget?c=' + encodeURIComponent(u.id))}" target="_blank" rel="noopener">Preview widget</a></div>
            <p class="form-msg" role="status"></p>
          </form>
        </div>
        <div class="card">
          <h2>Add it to your website</h2>
          <p class="muted">Paste this code where you want the price checker to appear.</p>
          <label class="field" for="embed-code">Embed code</label>
          <textarea class="input keybox" id="embed-code" rows="4" readonly style="margin-block-start:6px">${esc(embed)}</textarea>
          <div class="actions" style="margin-block-start:10px"><button type="button" class="btn btn-ghost" id="copy-embed">Copy code</button></div>
          ${u.plan === 'free' ? '<div class="upgrade" style="margin-block-start:12px"><p>The widget shows “not active” until the Clinic plan is paid.</p><div class="actions"><a class="btn btn-primary" href="#/plan">Pay for the Clinic plan</a></div></div>' : ''}
        </div>
      </div>
      <div class="card"><h2>Widget searches (last 30 days)</h2><div id="clinic-stats"></div></div>`;
    $('#copy-embed', el).addEventListener('click', () => copyText($('#embed-code', el).value));
    onSubmit($('#clinic-form', el), async (fd, out) => {
      await api('save-clinic', { body: { name: val(fd, 'name'), color: val(fd, 'color'), note: val(fd, 'note'), phone: val(fd, 'phone') } });
      msg(out, 'Saved. The widget updates within a minute.', true);
    });
    into($('#clinic-stats', el), async (box) => {
      const s = await api('stats');
      box.innerHTML = `<div class="stat-grid" style="grid-template-columns:minmax(0,1fr)"><div class="stat"><small>Searches from your website</small><b class="num">${esc((s.totals && s.totals.widget) || 0)}</b></div></div>${barChart(s.days || [], 'widget')}`;
    });
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied.');
    } catch (e) {
      toast('Select the text and copy it.');
    }
  }

  // ===========================================================================
  // NGO
  // ===========================================================================
  const ngoDraft = { id: null, name: '', items: [] }; // items: [{id, qty}]
  let ngoResult = null;

  function viewOptimiser(el) {
    const u = S.user;
    el.innerHTML = `
      <div class="card no-print">
        <h2>Budget optimiser</h2>
        <p class="muted">Add the medicines and quantities you buy (tablets, capsules or ml). We find the cheapest DRAP-registered brand with the same formula, strength and form.</p>
        <div id="ngo-picker"></div>
      </div>
      <div class="card no-print">
        <h3>Your list${ngoDraft.name ? ': ' + esc(ngoDraft.name) : ''}</h3>
        <div id="ngo-items"></div>
        <div class="actions" style="margin-block-start:12px"><button type="button" class="btn btn-primary" id="ngo-calc">Find cheapest options</button><button type="button" class="btn btn-ghost" id="ngo-clear">Clear list</button></div>
        <p class="form-msg" id="ngo-msg" role="status"></p>
      </div>
      <div id="ngo-result"></div>
      <div class="card no-print">
        <h3>Saved lists</h3>
        ${(u.lists || []).length ? `<div class="items">${u.lists
          .map((l) => `<div class="item"><div class="item-top"><div><div class="item-title">${esc(l.name)}</div><div class="item-meta">${esc(l.items.length)} medicines · saved ${esc(fmtDate(l.at))}</div></div>
            <div class="actions"><button type="button" class="btn btn-ghost sm" style="min-height:44px" data-load="${esc(l.id)}">Open</button><button type="button" class="btn btn-ghost sm" style="min-height:44px" data-del="${esc(l.id)}">Delete</button></div></div></div>`)
          .join('')}</div>` : '<p class="empty-note">No saved lists yet.</p>'}
      </div>`;
    const itemsEl = $('#ngo-items', el);
    const resEl = $('#ngo-result', el);
    let engine = null;
    const drawItems = () => {
      if (!ngoDraft.items.length) {
        itemsEl.innerHTML = '<p class="empty-note">Search above and add medicines.</p>';
        return;
      }
      itemsEl.innerHTML = `<div class="table-wrap"><table class="tbl"><thead><tr><th>Medicine</th><th class="n">Quantity</th><th><span class="sr-only">Remove</span></th></tr></thead><tbody>${ngoDraft.items
        .map((it, i) => {
          const m = engine && engine.byId(it.id);
          return `<tr><td><b>${esc(m ? medLabel(m) : it.id)}</b><span class="sub">${esc(m ? medMeta(m) : '')}</span></td><td class="n"><input class="input" type="number" min="1" max="1000000" value="${esc(it.qty)}" data-qty="${i}" aria-label="Quantity"></td><td><button type="button" class="icon-btn" data-rm="${i}" aria-label="Remove">✕</button></td></tr>`;
        })
        .join('')}</tbody></table></div>`;
    };
    const drawResult = () => {
      if (!ngoResult) {
        resEl.innerHTML = '';
        return;
      }
      const r = ngoResult;
      const patients = (S.user.patients || []).length;
      resEl.innerHTML = `
        <div class="card report">
          <div class="print-only"><h2>Medicine savings report: ${esc(S.user.name)}</h2><p>${esc(fmtDate(new Date()))}${ngoDraft.name ? ' · ' + esc(ngoDraft.name) : ''}</p></div>
          <div class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr))">
            <div class="stat"><small>Cost now</small><b class="num">${esc(rs(r.total_now))}</b></div>
            <div class="stat"><small>With cheapest brands</small><b class="num">${esc(rs(r.total_best))}</b></div>
            <div class="stat good"><small>You save</small><b class="num">${esc(rs(r.saving))}</b><div class="sub">${esc(r.percent)}% of this list</div></div>
            ${patients ? `<div class="stat"><small>Patients supported</small><b class="num">${esc(patients)}</b></div>` : ''}
          </div>
          <div class="table-wrap"><table class="tbl"><thead><tr><th>Medicine</th><th class="n">Qty</th><th>Cheapest same formula</th><th class="n">Cost now</th><th class="n">Cost best</th><th class="n">Saving</th></tr></thead><tbody>${r.rows
            .map((x) => `<tr><td><b>${esc(x.medicine.brand)} ${esc(x.medicine.strength || '')}</b><span class="sub">${esc(x.medicine.formula)}</span></td><td class="n">${esc(x.qty)}</td><td>${x.cheapest.id === x.medicine.id ? '<span class="muted">Already cheapest</span>' : `<b>${esc(x.cheapest.brand)}</b><span class="sub">${esc(x.cheapest.manufacturer)} · ${esc(rs2(x.cheapest.unit_price_rs))}/unit</span>`}</td><td class="n">${esc(rs(x.cost_now))}</td><td class="n">${esc(rs(x.cost_best))}</td><td class="n save-txt">${x.saving ? esc(rs(x.saving)) : ''}</td></tr>`)
            .join('')}</tbody><tfoot><tr><td colspan="3">Total</td><td class="n">${esc(rs(r.total_now))}</td><td class="n">${esc(rs(r.total_best))}</td><td class="n save-txt">${esc(rs(r.saving))}</td></tr></tfoot></table></div>
          <p class="small muted" style="margin-block-start:10px">Prices are DRAP maximum retail prices. Brands with the same formula, strength and form are listed; doctors should confirm any switch.</p>
          <form class="form no-print" id="save-list-form" style="margin-block-start:12px">
            <div class="form-row"><label class="field">List name<input class="input" name="name" maxlength="80" value="${esc(ngoDraft.name || '')}" placeholder="e.g. Monthly diabetes camp"></label></div>
            <div class="actions"><button type="submit" class="btn btn-ghost">${ngoDraft.id ? 'Update saved list' : 'Save as list'}</button><button type="button" class="btn btn-primary" id="donor-print">Print donor report</button></div>
            <p class="form-msg" role="status"></p>
          </form>
        </div>`;
      $('#donor-print', resEl).addEventListener('click', () => window.print());
      onSubmit($('#save-list-form', resEl), async (fd, out) => {
        const name = val(fd, 'name') || 'Medicine list';
        const r2 = await api('save-list', { body: { id: ngoDraft.id || undefined, name, items: ngoDraft.items } });
        ngoDraft.name = name;
        ngoDraft.id = (r2.user.lists.find((l) => l.name === name) || {}).id || ngoDraft.id;
        toast('List saved.');
        viewOptimiser(el);
      });
    };
    itemsEl.addEventListener('change', (ev) => {
      const i = ev.target.dataset.qty;
      if (i == null) return;
      ngoDraft.items[Number(i)].qty = Math.max(1, Math.round(Number(ev.target.value) || 1));
    });
    itemsEl.addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-rm]');
      if (!b) return;
      ngoDraft.items.splice(Number(b.dataset.rm), 1);
      drawItems();
    });
    $('#ngo-clear', el).addEventListener('click', () => {
      Object.assign(ngoDraft, { id: null, name: '', items: [] });
      ngoResult = null;
      viewOptimiser(el);
    });
    $('#ngo-calc', el).addEventListener('click', async (ev) => {
      const out = $('#ngo-msg', el);
      if (!ngoDraft.items.length) return msg(out, 'Add at least one medicine.');
      ev.target.disabled = true;
      msg(out, '');
      try {
        ngoResult = await api('optimise', { body: { items: ngoDraft.items } });
        drawResult();
        resEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (e) {
        if (!e.handled) msg(out, e.message);
      } finally {
        ev.target.disabled = false;
      }
    });
    el.onclick = async (ev) => {
      const ld = ev.target.closest('button[data-load]');
      const dl = ev.target.closest('button[data-del]');
      if (ld) {
        const l = (S.user.lists || []).find((x) => x.id === ld.dataset.load);
        if (!l) return;
        Object.assign(ngoDraft, { id: l.id, name: l.name, items: l.items.map((x) => ({ id: x.id, qty: x.qty })) });
        ngoResult = null;
        viewOptimiser(el);
        window.scrollTo(0, 0);
      } else if (dl) {
        if (!window.confirm('Delete this saved list?')) return;
        try {
          await api('save-list', { body: { id: dl.dataset.del, remove: true } });
          if (ngoDraft.id === dl.dataset.del) ngoDraft.id = null;
          toast('List deleted.');
          viewOptimiser(el);
        } catch (e) {
          if (!e.handled) toast(e.message);
        }
      }
    };
    loadEngine()
      .then((e) => {
        engine = e;
        medPicker($('#ngo-picker', el), (m) => {
          const ex = ngoDraft.items.find((x) => x.id === m.id);
          if (ex) ex.qty += 30;
          else ngoDraft.items.push({ id: m.id, qty: 30 });
          drawItems();
        });
        drawItems();
        drawResult();
      })
      .catch(() => {
        itemsEl.innerHTML = errorHtml(new Error('Could not load the medicine list. Check your connection and reload.'));
      });
  }

  function viewPatients(el, rest) {
    const u = S.user;
    const editId = rest[0];
    if (editId) return patientForm(el, editId === 'new' ? null : (u.patients || []).find((x) => x.id === editId) || null);
    into(el, async () => {
      let engine = null;
      try {
        engine = await loadEngine();
      } catch (e) {
        engine = null;
      }
      const pts = S.user.patients || [];
      el.innerHTML = `
        <div class="card">
          <div class="item-top"><h2>Patients (${esc(pts.length)})</h2><a class="btn btn-primary" href="#/patients/new">Add patient</a></div>
          <p class="small muted">Keep a private record of who receives which medicines. Only your account can see it.</p>
          ${pts.length ? `<div class="items">${pts
            .map((pt) => `<div class="item"><div class="item-top"><div><div class="item-title">${esc(pt.name || 'Unnamed')}${pt.ref ? ` <span class="badge">${esc(pt.ref)}</span>` : ''}</div>
              <div class="item-meta">${pt.meds.map((m) => esc(engine && engine.byId(m.id) ? medLabel(engine.byId(m.id)) : m.id) + ' × ' + esc(m.qty)).join(', ') || 'No medicines'}</div>
              ${pt.note ? `<div class="item-meta">${esc(pt.note)}</div>` : ''}</div>
              <a class="btn btn-ghost sm" style="min-height:44px" href="#/patients/${esc(pt.id)}">Edit</a></div></div>`)
            .join('')}</div>` : '<p class="empty-note">No patients yet.</p>'}
        </div>`;
    });
  }

  function patientForm(el, pt) {
    const meds = pt ? pt.meds.map((m) => ({ id: m.id, qty: m.qty })) : [];
    el.innerHTML = `
      <div class="card">
        <a class="back-link" href="#/patients">← All patients</a>
        <h2>${pt ? 'Edit patient' : 'Add patient'}</h2>
        <form class="form" id="pt-form">
          <div class="form-row">
            <label class="field">Name<input class="input" name="name" maxlength="80" value="${esc(pt ? pt.name : '')}" required></label>
            <label class="field">Reference / file no. <small class="muted">(optional)</small><input class="input" name="ref" maxlength="40" value="${esc(pt ? pt.ref : '')}"></label>
          </div>
          <label class="field">Note <small class="muted">(optional)</small><textarea class="input" name="note" maxlength="300" rows="2">${esc(pt ? pt.note : '')}</textarea></label>
          <div id="pt-picker"></div>
          <div id="pt-meds"></div>
          <div class="actions"><button type="submit" class="btn btn-primary">Save patient</button>${pt ? '<button type="button" class="btn btn-ghost" id="pt-del">Remove patient</button>' : ''}</div>
          <p class="form-msg" role="status"></p>
        </form>
      </div>`;
    const medsEl = $('#pt-meds', el);
    let engine = null;
    const draw = () => {
      medsEl.innerHTML = meds.length
        ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Medicine</th><th class="n">Qty / month</th><th><span class="sr-only">Remove</span></th></tr></thead><tbody>${meds
            .map((m, i) => {
              const x = engine && engine.byId(m.id);
              return `<tr><td>${esc(x ? medLabel(x) : m.id)}</td><td class="n"><input class="input" type="number" min="1" value="${esc(m.qty)}" data-qty="${i}" aria-label="Quantity"></td><td><button type="button" class="icon-btn" data-rm="${i}" aria-label="Remove">✕</button></td></tr>`;
            })
            .join('')}</tbody></table></div>`
        : '<p class="small muted">No medicines added.</p>';
    };
    medsEl.addEventListener('change', (ev) => {
      const i = ev.target.dataset.qty;
      if (i != null) meds[Number(i)].qty = Math.max(1, Math.round(Number(ev.target.value) || 1));
    });
    medsEl.addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-rm]');
      if (b) {
        meds.splice(Number(b.dataset.rm), 1);
        draw();
      }
    });
    loadEngine()
      .then((e) => {
        engine = e;
        medPicker($('#pt-picker', el), (m) => {
          if (!meds.some((x) => x.id === m.id)) meds.push({ id: m.id, qty: 30 });
          draw();
        }, { label: 'Add a medicine for this patient' });
        draw();
      })
      .catch(() => draw());
    const f = $('#pt-form', el);
    onSubmit(f, async (fd, out) => {
      if (!val(fd, 'name')) return msg(out, 'Enter the patient name.');
      await api('save-patient', { body: { id: pt ? pt.id : undefined, name: val(fd, 'name'), ref: val(fd, 'ref'), note: val(fd, 'note'), meds } });
      toast('Patient saved.');
      go('#/patients');
    });
    const del = $('#pt-del', el);
    if (del) {
      del.addEventListener('click', async () => {
        if (!window.confirm('Remove this patient record?')) return;
        try {
          await api('save-patient', { body: { id: pt.id, remove: true } });
          toast('Patient removed.');
          go('#/patients');
        } catch (e) {
          if (!e.handled) msg($('.form-msg', f), e.message);
        }
      });
    }
  }

  // ===========================================================================
  // Company
  // ===========================================================================
  function viewCompany(el) {
    into(el, async () => {
      const r = await api('company');
      const c = r.company;
      if (!c) {
        el.innerHTML = `
          <div class="card">
            <h2>Create your company code</h2>
            <p class="muted">Your staff enter this code in their Sasta Dawa account. You see how much your team could save on medicines (totals only, never individual medicines).</p>
            <form class="form" id="co-form">
              <label class="field">Company name<input class="input" name="name" maxlength="80" value="${esc(S.user.name)}"></label>
              <div class="actions"><button type="submit" class="btn btn-primary">Create code</button></div>
              <p class="form-msg" role="status"></p>
            </form>
          </div>`;
        onSubmit($('#co-form', el), async (fd) => {
          await api('create-company', { body: { name: val(fd, 'name') } });
          toast('Company code created.');
          viewCompany(el);
        });
        return;
      }
      el.innerHTML = `
        <div class="grid-2">
          <div class="card">
            <h2>${esc(c.name)}</h2>
            <p class="muted" style="margin:0">Your company code</p>
            <p class="code-big">${esc(c.code)}</p>
            <div class="actions"><button type="button" class="btn btn-ghost" id="co-copy">Copy code</button>${c.active ? '<span class="badge good">Active</span>' : '<span class="badge bad">Not active: plan has ended</span>'}</div>
            <h3 style="margin-block-start:16px">Share with your staff</h3>
            <p>Staff open <b>sastadawafinder</b> → <b>Account</b> → <b>Join company</b> and enter the code.</p>
            <textarea class="input keybox" id="co-msg" rows="4" readonly aria-label="Message for staff">Our company gives you Sasta Dawa Finder to find cheaper medicines with the same formula. Open ${SITE}/account, create a free account, go to Plan & billing → Join company and enter code ${c.code}.</textarea>
            <div class="actions" style="margin-block-start:8px"><button type="button" class="btn btn-ghost" id="co-copy-msg">Copy message</button></div>
          </div>
          <div class="card">
            <h2>Team savings</h2>
            <div class="stat-grid" style="grid-template-columns:repeat(2,minmax(0,1fr))">
              <div class="stat"><small>Staff joined</small><b class="num">${esc(c.members)}</b></div>
              <div class="stat"><small>Monthly medicine cost now</small><b class="num">${esc(rs(c.monthly_now))}</b></div>
              <div class="stat"><small>With cheapest brands</small><b class="num">${esc(rs(c.monthly_best))}</b></div>
              <div class="stat good"><small>Possible monthly saving</small><b class="num">${esc(rs(c.monthly_saving))}</b></div>
            </div>
            <p class="small muted">Based on the medicines staff keep in My Medicines, 30 days at their daily dose.</p>
            ${c.active ? '' : '<div class="upgrade"><p>Staff cannot join while the plan is inactive.</p><div class="actions"><a class="btn btn-primary" href="#/plan">Renew plan</a></div></div>'}
          </div>
        </div>`;
      $('#co-copy', el).addEventListener('click', () => copyText(c.code));
      $('#co-copy-msg', el).addEventListener('click', () => copyText($('#co-msg', el).value));
    });
  }

  // ===========================================================================
  // Developer
  // ===========================================================================
  function viewKeys(el) {
    into(el, async () => {
      const usage = await api('usage');
      const u = S.user;
      const days = Object.entries(usage.month || {}).sort((a, b) => (a[0] < b[0] ? 1 : -1));
      el.innerHTML = `
        <div class="card">
          <div class="item-top"><h2>API keys</h2><button type="button" class="btn btn-primary" id="key-new">Create key</button></div>
          <div id="key-shown"></div>
          ${u.apiKeys.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Key</th><th>Created</th><th><span class="sr-only">Revoke</span></th></tr></thead><tbody>${u.apiKeys
            .map((k) => `<tr><td><code>${esc(k.prefix)}…</code></td><td>${esc(fmtDate(k.createdAt))}</td><td><button type="button" class="btn btn-ghost sm" style="min-height:44px" data-revoke="${esc(k.id)}">Revoke</button></td></tr>`)
            .join('')}</tbody></table></div>` : '<p class="empty-note">No keys yet.</p>'}
          <p class="form-msg" id="key-msg" role="status"></p>
          <p class="small muted">Up to 5 keys. Read the <a href="developers">API documentation</a>.</p>
        </div>
        <div class="card">
          <h2>Usage</h2>
          <div class="stat-grid" style="grid-template-columns:repeat(2,minmax(0,1fr))">
            <div class="stat"><small>Calls today</small><b class="num">${esc(usage.today)}</b></div>
            <div class="stat"><small>Daily limit</small><b class="num">${esc(Number(usage.limit).toLocaleString('en-PK'))}</b></div>
          </div>
          ${days.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Day</th><th class="n">Calls</th></tr></thead><tbody>${days.map(([d, x]) => `<tr><td>${esc(d)}</td><td class="n">${esc((x && x.n) || 0)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty-note">No calls this month.</p>'}
        </div>`;
      $('#key-new', el).addEventListener('click', async (ev) => {
        ev.target.disabled = true;
        try {
          const r = await api('create-key', { body: {} });
          viewKeysAfterCreate(el, r.key);
        } catch (e) {
          if (!e.handled) msg($('#key-msg', el), e.message);
          ev.target.disabled = false;
        }
      });
      el.onclick = async (ev) => {
        const b = ev.target.closest('button[data-revoke]');
        if (!b) return;
        if (!window.confirm('Revoke this key? Apps using it stop working immediately.')) return;
        try {
          await api('revoke-key', { body: { id: b.dataset.revoke } });
          toast('Key revoked.');
          viewKeys(el);
        } catch (e) {
          if (!e.handled) msg($('#key-msg', el), e.message);
        }
      };
    });
  }
  async function viewKeysAfterCreate(el, key) {
    await new Promise((r) => {
      viewKeys(el);
      const wait = () => ($('#key-shown', el) ? r() : setTimeout(wait, 50));
      wait();
    });
    $('#key-shown', el).innerHTML = `<div class="notice info" style="margin-block-end:12px;display:block"><p><b>Your new key</b> (copy it now: it is shown only once)</p><code class="keybox" style="margin-block:8px">${esc(key)}</code><button type="button" class="btn btn-ghost" id="key-copy">Copy key</button></div>`;
    $('#key-copy', el).addEventListener('click', () => copyText(key));
  }

  // ===========================================================================
  // Start
  // ===========================================================================
  const yr = $('#copyright-year');
  if (yr) yr.textContent = new Date().getFullYear();
  const navAcc = $('#nav-account');
  if (navAcc) navAcc.addEventListener('click', () => {
    if (location.hash === '#/') route();
  });
  if (S.token && !S.user) S.user = { id: '', name: '', role: 'patient', plan: 'free' }; // filled by 'me' below
  const before = S.user ? S.user.role + '|' + S.user.plan : '';
  route();
  if (S.token) {
    // Refresh the stored user (plan or role may differ from what this device cached).
    api('me')
      .then(() => {
        if (!S.user) return;
        if (S.user.role + '|' + S.user.plan !== before) return route();
        const h = $('.dash-head .badges');
        if (h) h.innerHTML = planBadges(S.user);
      })
      .catch(() => {});
  }
})();
