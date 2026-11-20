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
    return;
  }

  const P = Cap.Plugins || {};
  const platform = typeof Cap.getPlatform === 'function' ? Cap.getPlatform() : 'native';
  document.documentElement.classList.add('native', 'native-' + platform);

  // ------------------------------------------------------------------------
  // URLs
  // ------------------------------------------------------------------------
  function apiUrl(path) {
    return SITE + String(path || '').replace(/^\/+/, '');
  }
  function webUrl(hash) {
    return SITE + (hash || '');
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
    }
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
  // Android back button: close the open panel, else go back, else leave the app
  // ------------------------------------------------------------------------
  if (P.App && platform === 'android') {
    P.App.addListener('backButton', () => {
      const openPanel = ['assistant', 'fb-modal'].map((id) => document.getElementById(id)).find((el) => el && !el.hidden);
      if (openPanel) {
        openPanel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return;
      }
      const h = location.hash.replace(/^#\/?/, '');
      if (h) history.back();
      else P.App.exitApp();
    });
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
      if (route) location.hash = route;
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
      f.style.cssText = 'position:absolute;width:1px;height:1px;left:-9999px;top:-9999px;border:0;opacity:0';
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

  window.SDNative = {
    isNative: true,
    platform,
    site: SITE,
    apiUrl,
    webUrl,
    openExternal,
    share,
    reminders,
    countUsage,
  };
})();
