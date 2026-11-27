/**
 * Sasta Dawa Finder - Android / iOS app glue (Capacitor).
 *
 * On the website this file does nothing: window.SDNative stays null and every page behaves
 * exactly as before. Inside the app (window.Capacitor is a native platform) it:
 *  - sends API calls (site settings, AI chat, feedback) to the live site, because the app's
 *    pages are served from the phone itself
 *  - opens outside links (Google Maps, WhatsApp, …) in the system browser/app instead of
 *    navigating the app away
 *  - uses the phone's share sheet
 *  - handles the Android back button
 *  - colours the status bar to match light/dark mode
 *  - schedules daily "take your medicines" reminders (local notifications, no server)
 *  - opens the pages bundled in the app (account.html, legal pages) instead of the website
 *  - Google / password login through the system browser (auth.startBrowserLogin, deep link back)
 *  - voice search with the phone's speech recogniser (voice.available / voice.listen)
 *  - saving / sharing files (files.save, files.shareImage): downloads and print don't work in the WebView
 *
 * Two apps are built from the same pages (scripts/build_app.js writes <meta name="sd-app">):
 *  - "customer" (pk.sastadawa.app): home = index.html, deep link sastadawa://auth?code=…
 *  - "business" (pk.sastadawa.business): home = account.html, search = search.html,
 *    deep link sastadawabiz://auth?code=…
 *
 * Exposed as window.SDNative (and the same object as window.SastaNative).
 */
(function () {
  'use strict';

  const SITE = 'https://sasta-dawa-finder.vercel.app/';
  const REMINDER_KEY = 'sd_reminders';
  const USAGE_KEY = 'sd_usage';
  const REMINDER_BASE_ID = 7100;
  const MAX_TIMES = 4;

  const Cap = window.Capacitor;
  const isNative = !!(Cap && typeof Cap.isNativePlatform === 'function' && Cap.isNativePlatform());
  if (!isNative) {
    window.SDNative = null;
    window.SastaNative = null;
    return;
  }

  const P = Cap.Plugins || {};
  const platform = typeof Cap.getPlatform === 'function' ? Cap.getPlatform() : 'native';

  // Which app this is, and which pages ship inside it (written by scripts/build_app.js).
  function meta(name) {
    const m = document.querySelector('meta[name="' + name + '"]');
    return m ? String(m.getAttribute('content') || '') : '';
  }
  const APP = meta('sd-app') === 'business' ? 'business' : 'customer';
  const SCHEME = APP === 'business' ? 'sastadawabiz' : 'sastadawa';
  const DEFAULT_PAGES = ['index', 'account'];
  const PAGES = new Set((meta('sd-pages') || DEFAULT_PAGES.join(',')).split(',').map((s) => s.trim()).filter(Boolean));
  /** Local file of the app's home screen and of its medicine search. */
  const HOME = APP === 'business' ? 'account.html' : 'index.html';
  const SEARCH = APP === 'business' && PAGES.has('search') ? 'search.html' : 'index.html';

  document.documentElement.classList.add('native', 'native-' + platform, 'app-' + APP);

  // Business app: the account page opens with a business account type preselected
  // (account.js reads ?type= when it starts, which is after this file runs).
  if (APP === 'business' && /account\.html$/.test(location.pathname) && !/[?&]type=/.test(location.search)) {
    try {
      const q = new URLSearchParams(location.search);
      q.set('type', 'pharmacy');
      history.replaceState(history.state, '', location.pathname + '?' + q.toString() + location.hash);
    } catch (e) { /* account.js falls back to Personal */ }
  }

  // ------------------------------------------------------------------------
  // URLs
  // ------------------------------------------------------------------------
  function apiUrl(path) {
    return SITE + String(path || '').replace(/^\/+/, '');
  }
  function webUrl(hash) {
    return SITE + (hash || '');
  }
  /**
   * Where a website page opens inside the app: a bundled page ('account' → 'account.html'),
   * or the live website for pages the app does not ship ('business' → SITE/business).
   * `page` may carry a query/hash: 'account#/profile', 'account?type=pharmacy'.
   */
  function pageUrl(page) {
    const s = String(page || '').replace(/^\/+/, '');
    const m = s.match(/^([^?#]*)(.*)$/);
    let name = m[1].replace(/\.html$/i, '');
    const rest = m[2] || '';
    if (name === '' || name === 'index') return SEARCH + rest;
    if (name === 'search' && PAGES.has('search')) return SEARCH + rest;
    if (PAGES.has(name)) return name + '.html' + rest;
    return SITE + name + rest;
  }

  // ------------------------------------------------------------------------
  // Outside links
  // ------------------------------------------------------------------------
  function openExternal(url) {
    const u = String(url || '');
    if (!u) return;
    if (/^(tel|mailto|sms):/i.test(u)) {
      location.href = u;
      return;
    }
    if (P.Browser && /^https?:/i.test(u)) {
      P.Browser.open({ url: u }).catch(() => { location.href = u; });
      return;
    }
    location.href = u;
  }
  // app.js and assistant.js open outside pages with window.open(); route them through the system.
  window.open = function (url) {
    openExternal(url);
    return null;
  };
  document.addEventListener('click', (e) => {
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    const href = a.getAttribute('href') || '';
    if (/^https?:/i.test(href) && !href.startsWith(location.origin)) {
      e.preventDefault();
      openExternal(href);
      return;
    }
    // Website-style links inside the app's own pages ("/account", "business", "/terms"):
    // a bundled page opens locally, anything else opens on the live website.
    if (!href || href.charAt(0) === '#' || /^[a-z][a-z0-9+.-]*:/i.test(href)) return;
    let u;
    try { u = new URL(href, location.href); } catch (err) { return; }
    if (u.origin !== location.origin) return;
    const file = u.pathname.replace(/^\/+/, '');
    if (/\.[a-z0-9]+$/i.test(file) && !/\.html$/i.test(file)) return; // assets, downloads
    if (/\.html$/i.test(file) && PAGES.has(file.replace(/\.html$/i, ''))) return; // already a bundled file
    const target = pageUrl(file + u.search + u.hash);
    e.preventDefault();
    if (/^https?:/i.test(target)) return openExternal(target);
    // Same page ("/" and "/index.html" are the same file): just change the hash, no reload.
    const tu = new URL(target, location.href);
    const norm = (p) => p.replace(/\/$/, '/index.html');
    if (norm(tu.pathname) === norm(location.pathname) && tu.search === location.search) {
      if (tu.hash !== location.hash) location.hash = tu.hash;
      return;
    }
    location.href = target;
  }, true);

  // ------------------------------------------------------------------------
  // Share sheet
  // ------------------------------------------------------------------------
  /** Returns true when the native share sheet handled it (shared or cancelled). */
  async function share(opts) {
    if (!P.Share) return false;
    try {
      await P.Share.share({ title: opts.title, text: opts.text, url: opts.url, dialogTitle: opts.title });
    } catch (e) {
      /* user closed the sheet */
    }
    return true;
  }

  // ------------------------------------------------------------------------
  // Saving / sharing files (the WebView cannot download blobs or print)
  // ------------------------------------------------------------------------
  // In the Android WebView, <a download>, blob: links and window.print() do nothing. Pages that
  // produce a file ("Download my data", CSV templates and CSV results, the QR sticker image,
  // monthly reports) call these instead:
  //
  //   const r = await SastaNative.files.save('my-data.json', 'application/json', jsonText);
  //   const r = await SastaNative.files.save('stock.csv', 'text/csv', csvText);
  //   const r = await SastaNative.files.save('report.pdf', 'application/pdf', pdfBase64, { base64: true });
  //   const r = await SastaNative.files.shareImage('qr-sticker.png', pngBase64); // "data:image/png;base64,…" also accepted
  //
  // The file is written to the app's cache folder (@capacitor/filesystem, Directory.Cache) and the
  // phone's share sheet opens with it (@capacitor/share), so the user picks Files / Drive /
  // WhatsApp / Gmail. Resolves { ok: true, uri } when written (shared or the sheet was closed),
  // { ok: false, error } when it could not be written; never rejects. On the website
  // window.SastaNative is null, so callers keep their normal download code there.
  function safeFileName(name) {
    const s = String(name || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/^\.+/, '').trim();
    return (s || 'file').slice(0, 120);
  }
  function stripDataUrl(b64) {
    return String(b64 || '').replace(/^data:[^,]*;base64,/, '').replace(/\s+/g, '');
  }
  async function saveFile(filename, mimeType, data, opts) {
    const FS = P.Filesystem;
    if (!FS || !FS.writeFile) return { ok: false, error: 'Saving files is not available in this version of the app.' };
    const name = safeFileName(filename);
    const base64 = !!(opts && opts.base64);
    const path = 'exports/' + Date.now() + '-' + name;
    let uri = '';
    try {
      const w = await FS.writeFile({
        path,
        data: base64 ? stripDataUrl(data) : String(data == null ? '' : data),
        directory: 'CACHE', // Directory.Cache
        encoding: base64 ? undefined : 'utf8', // Encoding.UTF8; no encoding = base64 data
        recursive: true,
      });
      uri = (w && w.uri) || '';
      if (!uri && FS.getUri) uri = ((await FS.getUri({ path, directory: 'CACHE' })) || {}).uri || '';
    } catch (e) {
      return { ok: false, error: 'Could not save the file on this phone: ' + String((e && e.message) || e) };
    }
    if (P.Share && P.Share.share && uri && !(opts && opts.share === false)) {
      try {
        await P.Share.share({ title: name, dialogTitle: name, files: [uri] });
      } catch (e) {
        /* the user closed the share sheet: the file is still written */
      }
    }
    return { ok: true, uri, name, mimeType: String(mimeType || '') };
  }
  const files = {
    /** save(filename, mimeType, data, { base64: false }) → Promise<{ ok, uri }>. See above. */
    save: saveFile,
    /** shareImage(filename, pngBase64) → Promise<{ ok, uri }>. Base64 PNG, with or without data: prefix. */
    shareImage(filename, pngBase64) {
      const name = /\.(png|jpe?g|webp)$/i.test(String(filename || '')) ? filename : String(filename || 'image') + '.png';
      return saveFile(name, 'image/png', pngBase64, { base64: true });
    },
  };

  // ------------------------------------------------------------------------
  // Android back button: close the open panel, else go back, else leave the app
  // ------------------------------------------------------------------------
  // In-page depth: every hash change inside this page gets history.state.sdDepth (0 = the entry the
  // page opened with). Back then knows whether there is an in-app screen to return to: a top-level
  // tab opened directly (#/plan in the business app, a reminder's #/my-medicines) has depth 0, and
  // history.back() there would do nothing or leave the app.
  function hashDepth() {
    const s = history.state;
    return s && typeof s.sdDepth === 'number' ? s.sdDepth : 0;
  }
  let lastDepth = hashDepth();
  let resettingHash = false;
  window.addEventListener('hashchange', () => {
    const s = history.state;
    if (resettingHash) {
      resettingHash = false;
      lastDepth = 0;
    } else if (s && typeof s.sdDepth === 'number') {
      lastDepth = s.sdDepth; // came back to an entry we already numbered
      return;
    } else {
      lastDepth += 1;
    }
    try { history.replaceState(Object.assign({}, s && typeof s === 'object' ? s : {}, { sdDepth: lastDepth }), ''); } catch (e) { /* old webview */ }
  });

  if (P.App && platform === 'android') {
    P.App.addListener('backButton', () => {
      const openPanel = ['assistant', 'fb-modal'].map((id) => document.getElementById(id)).find((el) => el && !el.hidden);
      if (openPanel) {
        openPanel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return;
      }
      const h = location.hash.replace(/^#\/?/, '');
      if (h) {
        if (hashDepth() > 0) return history.back();
        // A top-level screen with nothing to pop: go to this page's root (search home / dashboard)
        if (isHomePage() || /account\.html$/.test(location.pathname)) {
          resettingHash = true;
          location.replace(location.pathname + location.search + '#/');
          return;
        }
      }
      // On another bundled page (account, terms, the business app's search): go back, not out.
      if (!isHomePage()) {
        if (history.length > 1) history.back();
        else location.replace(HOME);
        return;
      }
      P.App.exitApp();
    });
  }
  function isHomePage() {
    const file = location.pathname.replace(/^\/+/, '') || 'index.html';
    if (file === 'index.html') return true; // the business index.html only redirects to its home
    return file === HOME;
  }

  // ------------------------------------------------------------------------
  // Status bar follows light/dark mode (app.js updates <meta id="meta-theme">)
  // ------------------------------------------------------------------------
  function syncStatusBar() {
    if (!P.StatusBar) return;
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    // Style.Dark = light text, for dark backgrounds. Both our light (#0f5c54) and dark bars are dark.
    P.StatusBar.setStyle({ style: 'DARK' }).catch(() => {});
    P.StatusBar.setBackgroundColor({ color: dark ? '#0b1412' : '#0f5c54' }).catch(() => {});
  }
  if (P.StatusBar && typeof MutationObserver !== 'undefined') {
    new MutationObserver(syncStatusBar).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    syncStatusBar();
  }

  // ------------------------------------------------------------------------
  // Daily medicine reminders
  // ------------------------------------------------------------------------
  function loadReminders() {
    try {
      const r = JSON.parse(localStorage.getItem(REMINDER_KEY) || 'null');
      if (r && Array.isArray(r.times)) return { times: r.times.filter(validTime).slice(0, MAX_TIMES) };
    } catch (e) { /* ignore */ }
    return { times: [] };
  }
  function saveReminders(r) {
    try { localStorage.setItem(REMINDER_KEY, JSON.stringify(r)); } catch (e) { /* ignore */ }
  }
  function validTime(s) {
    return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
  }

  async function notificationsAllowed() {
    const LN = P.LocalNotifications;
    if (!LN) return false;
    try {
      let p = await LN.checkPermissions();
      if (p.display === 'prompt' || p.display === 'prompt-with-rationale') p = await LN.requestPermissions();
      return p.display === 'granted';
    } catch (e) {
      return false;
    }
  }

  /**
   * Cancel and re-create the daily notifications.
   * @param {string[]} times  "HH:MM" in 24h, local time
   * @param {{title:string, body:string}} text
   */
  let lastScheduled = '';
  async function schedule(times, text) {
    const LN = P.LocalNotifications;
    if (!LN) return false;
    const sig = JSON.stringify([times, text.title, text.body]);
    if (sig === lastScheduled) return true;
    const cancel = [];
    for (let i = 0; i < MAX_TIMES; i++) cancel.push({ id: REMINDER_BASE_ID + i });
    try { await LN.cancel({ notifications: cancel }); } catch (e) { /* none pending */ }
    lastScheduled = '';
    if (!times.length) return true;
    if (!(await notificationsAllowed())) return false;
    lastScheduled = sig;
    await LN.schedule({
      notifications: times.map((tm, i) => {
        const [hour, minute] = tm.split(':').map(Number);
        return {
          id: REMINDER_BASE_ID + i,
          title: text.title,
          body: text.body,
          schedule: { on: { hour, minute }, allowWhileIdle: true },
          extra: { route: '#/my-medicines' },
        };
      }),
    });
    return true;
  }

  // Tapping a reminder opens My Medicines.
  if (P.LocalNotifications) {
    P.LocalNotifications.addListener('localNotificationActionPerformed', (ev) => {
      const route = ev && ev.notification && ev.notification.extra && ev.notification.extra.route;
      if (!route) return;
      const onSearch = !!document.getElementById('search-input');
      if (onSearch) location.hash = route;
      else location.href = SEARCH + route;
    });
  }

  const reminders = {
    MAX_TIMES,
    validTime,
    get() {
      return loadReminders();
    },
    /** Save the list of times and (re)schedule. Resolves false if notifications are blocked. */
    async set(times, text) {
      const clean = [...new Set(times.filter(validTime))].sort().slice(0, MAX_TIMES);
      saveReminders({ times: clean });
      return schedule(clean, text);
    },
    /** Re-schedule with new text (e.g. the medicine list changed). */
    async refresh(text) {
      const r = loadReminders();
      if (!r.times.length) return true;
      return schedule(r.times, text);
    },
  };

  // ------------------------------------------------------------------------
  // Counting real installs and daily users (no SDK, nothing personal sent)
  // ------------------------------------------------------------------------
  // On the first launch the app loads SITE/app/installed in a hidden frame, and at most once a day
  // SITE/app/active. Vercel Web Analytics (cookieless) then shows installs that were actually
  // opened, not just downloaded, and daily active users. No ID, no medicines, no device details
  // beyond what any web page visit has.
  function today() {
    const d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }
  function ping(kind, onDone) {
    try {
      const f = document.createElement('iframe');
      f.src = SITE + 'app/' + kind;
      f.title = 'usage count';
      f.setAttribute('aria-hidden', 'true');
      f.tabIndex = -1;
      // Hidden in place: an off-screen left offset widens the page in Urdu (RTL) and it scrolls sideways.
      f.style.cssText = 'position:fixed;width:1px;height:1px;top:0;inset-inline-start:0;border:0;opacity:0;pointer-events:none;clip-path:inset(50%)';
      let done = false;
      f.addEventListener('load', () => {
        if (done) return;
        done = true;
        onDone();
        setTimeout(() => f.remove(), 10000); // let the analytics beacon finish first
      });
      document.body.appendChild(f);
    } catch (e) { /* counting must never break the app */ }
  }
  function countUsage() {
    if (navigator.onLine === false) return; // try again next launch
    let st = {};
    try { st = JSON.parse(localStorage.getItem(USAGE_KEY) || '{}') || {}; } catch (e) { st = {}; }
    const save = () => { try { localStorage.setItem(USAGE_KEY, JSON.stringify(st)); } catch (e) { /* ignore */ } };
    const active = () => {
      if (st.active === today()) return;
      ping('active', () => { st.active = today(); save(); });
    };
    if (!st.installed) ping('installed', () => { st.installed = today(); save(); active(); });
    else active();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(countUsage, 1500));
  else setTimeout(countUsage, 1500);

  // ------------------------------------------------------------------------
  // Login through the system browser (Google blocks its sign-in inside app web views)
  // ------------------------------------------------------------------------
  // 1. startBrowserLogin() opens SITE/account?app=customer|business in the system browser.
  // 2. After login there, the website asks the server for a one-time code and opens
  //    sastadawa://auth?code=… (business: sastadawabiz://…), which Android hands back to this app.
  // 3. We swap the code for a session (POST /api/account?a=app-exchange), save it where
  //    account.js and app.js read it (sd_user_token, sd_user), close the browser and open the account.
  const USED_CODE_KEY = 'sd_app_code_used';
  let exchanging = null;

  function parseAuthUrl(url) {
    let u;
    try { u = new URL(String(url || '')); } catch (e) { return null; }
    if (u.protocol !== SCHEME + ':') return null;
    // sastadawa://auth?code=… → host "auth" (some Android versions report it as the path)
    const where = (u.hostname || u.pathname.replace(/^\/+/, '')).toLowerCase();
    if (where !== 'auth') return null;
    const code = u.searchParams.get('code') || '';
    return /^[a-f0-9]{16,128}$/i.test(code) ? { code, error: '' } : { code: '', error: u.searchParams.get('error') || 'missing_code' };
  }

  function emit(name, detail) {
    try { window.dispatchEvent(new CustomEvent(name, { detail })); } catch (e) { /* old webview */ }
  }

  /** Swap a one-time code for a session. Resolves { token, user }; rejects with a readable Error. */
  async function exchangeCode(code) {
    let used = '';
    try { used = localStorage.getItem(USED_CODE_KEY) || ''; } catch (e) { /* ignore */ }
    if (used === code) throw new Error('This sign-in link was already used. Please sign in again.');
    let res;
    try {
      res = await fetch(apiUrl('api/account?a=app-exchange'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
        cache: 'no-store',
      });
    } catch (e) {
      throw new Error('Could not reach the server. Check your internet connection and try again.');
    }
    let data = {};
    try { data = (await res.json()) || {}; } catch (e) { data = {}; }
    if (!res.ok || !data.token) throw new Error(data.error || 'Sign-in did not finish. Please try again.');
    try {
      localStorage.setItem(USED_CODE_KEY, code);
      localStorage.setItem('sd_user_token', data.token);
      if (data.user) localStorage.setItem('sd_user', JSON.stringify(data.user));
    } catch (e) { /* storage blocked: nothing we can do */ }
    return { token: data.token, user: data.user || null };
  }

  /** Handles a sastadawa(biz)://auth link. Returns true if the URL was ours. */
  async function handleAuthUrl(url) {
    const p = parseAuthUrl(url);
    if (!p) return false;
    if (P.Browser && P.Browser.close) P.Browser.close().catch(() => {});
    if (!p.code) {
      emit('sd-native-login', { ok: false, error: 'Sign-in was cancelled or did not finish. Please try again.' });
      return true;
    }
    if (exchanging) return true;
    // getLaunchUrl() keeps returning the link that started the app: ignore a code we already used.
    try { if (localStorage.getItem(USED_CODE_KEY) === p.code) return true; } catch (e) { /* ignore */ }
    exchanging = exchangeCode(p.code)
      .then((r) => {
        emit('sd-native-login', { ok: true, user: r.user });
        // Open (or reload) the account dashboard so every page picks up the new session.
        if (/account\.html$/.test(location.pathname)) {
          if (location.hash !== '#/') location.hash = '#/';
          location.reload();
        } else location.href = 'account.html#/';
      })
      .catch((e) => emit('sd-native-login', { ok: false, error: e.message }))
      .finally(() => { exchanging = null; });
    await exchanging;
    return true;
  }

  /** Open the website's login in the system browser. `app` defaults to this app ('customer'|'business'). */
  function startBrowserLogin(app) {
    const which = app === 'business' || app === 'customer' ? app : APP;
    const url = SITE + 'account?app=' + which;
    if (P.Browser && P.Browser.open) return P.Browser.open({ url }).then(() => true).catch(() => { location.href = url; return true; });
    location.href = url;
    return Promise.resolve(true);
  }

  if (P.App && P.App.addListener) {
    P.App.addListener('appUrlOpen', (ev) => { handleAuthUrl(ev && ev.url); });
    // The phone may have closed the app while the browser was open: the link then starts it fresh.
    if (P.App.getLaunchUrl) {
      Promise.resolve()
        .then(() => P.App.getLaunchUrl())
        .then((r) => { if (r && r.url) handleAuthUrl(r.url); })
        .catch(() => {});
    }
  }

  const auth = { app: APP, scheme: SCHEME, startBrowserLogin, handleAuthUrl, exchangeCode };

  // ------------------------------------------------------------------------
  // Voice search (@capacitor-community/speech-recognition, Android's own recogniser)
  // ------------------------------------------------------------------------
  function voiceError(code, message) {
    return Object.assign(new Error(message), { code });
  }
  const voice = {
    /** Resolves true when the phone has a speech recogniser and the plugin is installed. */
    async available() {
      const SR = P.SpeechRecognition;
      if (!SR || !SR.available) return false;
      try {
        const r = await SR.available();
        return !!(r && r.available);
      } catch (e) {
        return false;
      }
    },
    /**
     * Listen once and resolve with what was said ('' if nothing was heard).
     * Rejects with err.code = 'unavailable' | 'denied' | 'failed'.
     * @param {string} lang  BCP-47, e.g. 'ur-PK', 'en-PK', 'en-US'
     */
    async listen(lang) {
      const SR = P.SpeechRecognition;
      if (!SR || !SR.start) throw voiceError('unavailable', 'Voice search is not available on this phone.');
      let perm = null;
      try {
        perm = await SR.checkPermissions();
        if (!perm || perm.speechRecognition !== 'granted') perm = await SR.requestPermissions();
      } catch (e) {
        perm = null;
      }
      if (!perm || perm.speechRecognition !== 'granted') throw voiceError('denied', 'Please allow the microphone to search by voice.');
      const run = async (language) => {
        const r = await SR.start({ language, maxResults: 1, partialResults: false, popup: false });
        return String((r && r.matches && r.matches[0]) || '').trim();
      };
      try {
        return await run(lang || 'en-US');
      } catch (e) {
        const msg = String((e && e.message) || e || '');
        if (/no match|didn'?t understand|nothing/i.test(msg)) return '';
        // Some recognisers do not know en-PK: try plain US English once.
        if (lang && /^en-/i.test(lang) && lang !== 'en-US') {
          try { return await run('en-US'); } catch (e2) { /* fall through */ }
        }
        throw voiceError('failed', msg || 'Voice search failed. Please try again.');
      }
    },
    stop() {
      const SR = P.SpeechRecognition;
      if (SR && SR.stop) return SR.stop().catch(() => {});
      return Promise.resolve();
    },
  };

  // ------------------------------------------------------------------------
  // Business app: a "Search medicines" button on the account screens
  // ------------------------------------------------------------------------
  function addBusinessSearchButton() {
    if (APP !== 'business' || !/account\.html$/.test(location.pathname) || document.getElementById('sd-app-search')) return;
    const a = document.createElement('a');
    a.id = 'sd-app-search';
    a.href = SEARCH;
    a.className = 'sd-app-search';
    a.textContent = 'Search medicines';
    a.setAttribute('aria-label', 'Search medicines');
    a.style.cssText = 'position:fixed;inset-inline-end:16px;bottom:calc(16px + env(safe-area-inset-bottom, 0px));z-index:50;'
      + 'display:inline-flex;align-items:center;gap:8px;min-height:48px;padding:0 18px;border-radius:999px;'
      + 'background:#0A6B3C;color:#fff;font:600 15px/1 "IBM Plex Sans",system-ui,sans-serif;text-decoration:none;'
      + 'box-shadow:0 4px 14px rgba(0,0,0,.25)';
    document.body.appendChild(a);
    document.body.style.paddingBottom = '80px';
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addBusinessSearchButton);
  else addBusinessSearchButton();

  const api = {
    isNative: true,
    platform,
    app: APP,
    site: SITE,
    home: HOME,
    search: SEARCH,
    apiUrl,
    webUrl,
    pageUrl,
    openExternal,
    share,
    files,
    reminders,
    countUsage,
    auth,
    voice,
  };
  window.SDNative = api;
  window.SastaNative = api;
})();
