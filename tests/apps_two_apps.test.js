// Round 4 apps: two Android apps (customer + business), bundled account page, Google login
// handoff through the browser (deep link + code exchange) and voice search (app plugin + web).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { fixtureJson, root } = require('./helpers/fixture');

const SITE = 'https://sasta-dawa-finder.vercel.app/';
const SCRIPTS = ['js/native.js', 'js/i18n.js', 'js/data.js', 'js/search.js', 'js/assistant.js', 'js/app.js'];
const CODE = 'abcdef0123456789abcdef0123456789';
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 0));

/** Fake Capacitor with the plugins native.js uses. */
function fakeCapacitor(calls, o) {
  const voice = o.voice;
  const plugins = {
    Share: { share: async () => {} },
    Browser: {
      open: async (x) => { calls.browser.push(x.url); },
      close: async () => { calls.browserClosed = (calls.browserClosed || 0) + 1; },
    },
    App: { addListener: (ev, fn) => { calls.listeners[ev] = fn; }, exitApp: () => { calls.exited = true; } },
    StatusBar: { setStyle: async () => {}, setBackgroundColor: async () => {} },
  };
  if (voice) {
    plugins.SpeechRecognition = {
      available: async () => ({ available: voice.available !== false }),
      checkPermissions: async () => ({ speechRecognition: voice.permission || 'granted' }),
      requestPermissions: async () => ({ speechRecognition: voice.permission || 'granted' }),
      start: async (opts) => {
        calls.voiceStarts.push(opts);
        if (voice.fail) throw new Error(voice.fail);
        return { matches: [voice.said] };
      },
      stop: async () => {},
    };
  }
  return { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: plugins };
}

function baseWindow(w) {
  w.scrollTo = () => {};
  w.matchMedia = () => ({ matches: false, addEventListener() {} });
  w.HTMLElement.prototype.scrollIntoView = function () {};
}

/** The main search page inside the customer app. */
async function bootApp(opts) {
  const o = opts || {};
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://localhost/' });
  const w = dom.window;
  const data = fixtureJson();
  const calls = { fetch: [], browser: [], listeners: {}, voiceStarts: [] };
  baseWindow(w);
  w.fetch = async (url, init) => {
    calls.fetch.push({ url: String(url), init });
    if (String(url).includes('medicines.json')) return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(data)) };
    if (String(url).includes('a=app-exchange')) return o.exchange ? o.exchange(init) : { ok: false, status: 400, json: async () => ({ error: 'bad' }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  if (o.lang) w.localStorage.setItem('sd_lang', o.lang);
  w.Capacitor = fakeCapacitor(calls, o);
  for (const s of SCRIPTS) w.eval(fs.readFileSync(path.join(root, s), 'utf8'));
  await w.SDApp.ready;
  return { dom, w, d: w.document, calls };
}

/** Only native.js on a bundled page (e.g. the business app's account.html). */
function bootNativeOnly({ url, app, pages }) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="sd-app" content="${app}"><meta name="sd-pages" content="${pages}"></head><body><div id="app"></div></body></html>`;
  const dom = new JSDOM(html, { runScripts: 'outside-only', url });
  const w = dom.window;
  const calls = { fetch: [], browser: [], listeners: {}, voiceStarts: [] };
  baseWindow(w);
  w.fetch = async (u, init) => { calls.fetch.push({ url: String(u), init }); return { ok: false, status: 404, json: async () => ({}) }; };
  w.Capacitor = fakeCapacitor(calls, {});
  w.eval(fs.readFileSync(path.join(root, 'js/native.js'), 'utf8'));
  return { w, d: w.document, calls };
}

// ---------------------------------------------------------------------------
// Build: two web folders
// ---------------------------------------------------------------------------
test('build_app: customer www/ bundles the account page and legal pages that exist', () => {
  const { build } = require('../scripts/build_app');
  const out = build('customer');
  assert.equal(path.basename(out), 'www');
  for (const f of ['index.html', 'account.html', 'css/account.css', 'js/account.js', 'js/native.js']) assert.ok(fs.existsSync(path.join(out, f)), f);
  assert.ok(!fs.existsSync(path.join(out, 'search.html')), 'customer app has no search.html');
  const acc = fs.readFileSync(path.join(out, 'account.html'), 'utf8');
  assert.match(acc, /<meta name="sd-app" content="customer">/);
  assert.match(acc, /<meta name="sd-pages" content="index,account[^"]*">/);
  const iNative = acc.indexOf('js/native.js');
  const iAccount = acc.indexOf('js/account.js');
  assert.ok(iNative > 0 && iNative < iAccount, 'native.js loads before account.js');
  assert.doesNotMatch(acc, /_vercel\/insights/);
  for (const p of ['terms', 'privacy', 'refund', 'disclaimer', 'pharmacy-terms', 'delete-account']) {
    if (!fs.existsSync(path.join(root, p + '.html'))) continue;
    assert.ok(fs.existsSync(path.join(out, p + '.html')), p);
    assert.match(fs.readFileSync(path.join(out, 'index.html'), 'utf8'), new RegExp('sd-pages" content="[^"]*\\b' + p + '\\b'));
  }
});

test('build_app: business www-business/ starts at the account portal and has a search page', () => {
  const { build } = require('../scripts/build_app');
  const out = build('business');
  assert.equal(path.basename(out), 'www-business');
  const index = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  assert.match(index, /location\.replace\('account\.html'/);
  assert.match(index, /<meta name="sd-app" content="business">/);
  const search = fs.readFileSync(path.join(out, 'search.html'), 'utf8');
  assert.match(search, /id="search-input"/);
  assert.match(search, /<meta name="sd-pages" content="[^"]*\bsearch\b/);
  assert.match(fs.readFileSync(path.join(out, 'account.html'), 'utf8'), /<meta name="sd-app" content="business">/);
  assert.ok(fs.existsSync(path.join(out, 'data/medicines.json')));
});

test('Android project: two flavors, own ids, names, deep-link schemes and asset folders', () => {
  const g = fs.readFileSync(path.join(root, 'android/app/build.gradle'), 'utf8');
  assert.match(g, /flavorDimensions "app"/);
  assert.match(g, /customer \{[\s\S]*?applicationId "pk\.sastadawa\.app"[\s\S]*?"Sasta Dawa Finder"[\s\S]*?authScheme: "sastadawa"\]/);
  assert.match(g, /business \{[\s\S]*?applicationId "pk\.sastadawa\.business"[\s\S]*?"Sasta Dawa for Pharmacies"[\s\S]*?authScheme: "sastadawabiz"\]/);
  assert.match(g, /main \{ assets\.srcDirs = \[\] \}/);
  assert.match(g, /business \{ assets\.srcDirs = \['src\/business\/assets'\] \}/);
  const m = fs.readFileSync(path.join(root, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
  assert.match(m, /<data android:scheme="\$\{authScheme\}" android:host="auth" \/>/);
  assert.match(m, /android\.permission\.RECORD_AUDIO/);
  const strings = fs.readFileSync(path.join(root, 'android/app/src/main/res/values/strings.xml'), 'utf8');
  assert.doesNotMatch(strings, /name="app_name"/, 'app_name comes from the flavor (resValue)');
  const cap = JSON.parse(fs.readFileSync(path.join(root, 'capacitor.config.json'), 'utf8'));
  assert.equal(cap.appId, 'pk.sastadawa.app');
  assert.equal(cap.webDir, 'www');
  const pkg = require('../package.json');
  assert.ok(pkg.dependencies['@capacitor-community/speech-recognition'], 'speech plugin installed');
  assert.match(pkg.scripts['app:sync:android'], /cap sync android && node scripts\/build_app\.js --android-flavors/);
  const wf = fs.readFileSync(path.join(root, '.github/workflows/mobile-apps.yml'), 'utf8');
  assert.match(wf, /build_app\.js --android-flavors/);
  assert.match(wf, /assembleCustomerDebug assembleBusinessDebug/);
  assert.match(wf, /app-business-release\.apk SastaDawa-Pharmacies\.apk/);
});

test('/download lists both apps; ?app=business starts the pharmacies APK', async () => {
  const html = fs.readFileSync(path.join(root, 'download.html'), 'utf8');
  assert.ok(html.includes('releases/download/android/SastaDawa.apk'));
  assert.ok(html.includes('releases/download/android/SastaDawa-Pharmacies.apk'));
  assert.doesNotMatch(html.replace(/<script[^>]*src=[^>]*><\/script>/g, ''), /<script/, 'no inline scripts (CSP)');
  const dom = new JSDOM(html.replace(/<script[^>]*><\/script>/g, ''), { runScripts: 'outside-only', url: 'https://sasta-dawa-finder.vercel.app/download?app=business' });
  dom.window.eval(fs.readFileSync(path.join(root, 'js/download.js'), 'utf8'));
  await tick(5);
  assert.ok(dom.window.document.getElementById('apk-business').classList.contains('current'));
  assert.ok(!dom.window.document.getElementById('apk').classList.contains('current'));
  assert.match(dom.window.document.getElementById('dl-status').textContent, /Pharmacies/);
  dom.window.close();
});

// ---------------------------------------------------------------------------
// Customer app: Account opens the bundled page; business stays on the website
// ---------------------------------------------------------------------------
test('customer app: Account links open the bundled account.html, For business opens the website', async () => {
  const { w, d } = await bootApp();
  assert.equal(w.SastaNative, w.SDNative, 'same object under both names');
  assert.equal(w.SDNative.app, 'customer');
  assert.equal(d.getElementById('nav-account').getAttribute('href'), 'account.html');
  assert.equal(d.getElementById('nav-account-m').getAttribute('href'), 'account.html');
  assert.equal(d.querySelector('.topnav-biz').getAttribute('href'), SITE + 'business');
  assert.equal(w.SDNative.pageUrl('account#/profile'), 'account.html#/profile');
  assert.equal(w.SDNative.pageUrl('/'), 'index.html');
  assert.equal(w.SDNative.pageUrl('terms'), SITE + 'terms', 'not bundled in this test page → website');
});

test('business app: account page gets a business type, a Search button and its own login scheme', async () => {
  const { w, d, calls } = bootNativeOnly({ url: 'https://localhost/account.html#/', app: 'business', pages: 'index,account,terms,search' });
  await tick(5);
  assert.equal(w.SastaNative.app, 'business');
  assert.equal(w.SastaNative.auth.scheme, 'sastadawabiz');
  assert.equal(w.location.search, '?type=pharmacy');
  assert.equal(w.location.hash, '#/');
  const btn = d.getElementById('sd-app-search');
  assert.ok(btn, 'search button');
  assert.equal(btn.getAttribute('href'), 'search.html');
  assert.equal(w.SastaNative.pageUrl('/'), 'search.html');
  assert.equal(w.SastaNative.pageUrl('terms'), 'terms.html');
  assert.equal(w.SastaNative.pageUrl('business'), SITE + 'business');
  w.SastaNative.auth.startBrowserLogin();
  assert.deepEqual(calls.browser, [SITE + 'account?app=business']);
  // A customer-app link must not log into the business app.
  return w.SastaNative.auth.handleAuthUrl('sastadawa://auth?code=' + CODE).then((ours) => {
    assert.equal(ours, false);
    assert.equal(calls.fetch.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Google login handoff: browser → deep link → code exchange
// ---------------------------------------------------------------------------
test('login handoff: opens the website login, then swaps the deep-link code for a session', async () => {
  const user = { id: 'u1', name: 'Ayesha Khan', role: 'patient' };
  const { w, calls } = await bootApp({
    exchange: async (init) => {
      assert.equal(init.method, 'POST');
      assert.deepEqual(JSON.parse(init.body), { code: CODE });
      return { ok: true, status: 200, json: async () => ({ token: 'tok-123', user }) };
    },
  });
  assert.equal(typeof w.SastaNative.auth.startBrowserLogin, 'function');
  await w.SastaNative.auth.startBrowserLogin('customer');
  assert.deepEqual(calls.browser, [SITE + 'account?app=customer']);

  const events = [];
  w.addEventListener('sd-native-login', (e) => events.push(e.detail));
  assert.equal(typeof calls.listeners.appUrlOpen, 'function', 'listens for deep links');
  await calls.listeners.appUrlOpen({ url: 'sastadawa://auth?code=' + CODE });
  await tick(5);
  const ex = calls.fetch.find((f) => f.url.includes('app-exchange'));
  assert.equal(ex.url, SITE + 'api/account?a=app-exchange');
  assert.equal(w.localStorage.getItem('sd_user_token'), 'tok-123');
  assert.deepEqual(JSON.parse(w.localStorage.getItem('sd_user')), user);
  assert.equal(calls.browserClosed, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0].ok, true);

  // The same code again (e.g. getLaunchUrl after a restart) is ignored, not re-sent.
  const before = calls.fetch.length;
  await w.SastaNative.auth.handleAuthUrl('sastadawa://auth?code=' + CODE);
  assert.equal(calls.fetch.length, before);
});

test('login handoff: a rejected code reports an error and keeps the user signed out', async () => {
  const { w, calls } = await bootApp({ exchange: async () => ({ ok: false, status: 400, json: async () => ({ error: 'This code has expired' }) }) });
  const events = [];
  w.addEventListener('sd-native-login', (e) => events.push(e.detail));
  await calls.listeners.appUrlOpen({ url: 'sastadawa://auth?code=' + CODE });
  await tick(5);
  assert.equal(w.localStorage.getItem('sd_user_token'), null);
  assert.equal(events[0].ok, false);
  assert.match(events[0].error, /expired/);
  // Junk links are not ours.
  assert.equal(await w.SastaNative.auth.handleAuthUrl('https://evil.example/auth?code=' + CODE), false);
  assert.equal(await w.SastaNative.auth.handleAuthUrl('sastadawa://other?code=' + CODE), false);
});

// ---------------------------------------------------------------------------
// Voice search
// ---------------------------------------------------------------------------
test('app voice search: mic shows, listens in English, and searches what was said', async () => {
  const { w, d, calls } = await bootApp({ voice: { said: 'Panadol' } });
  await tick(5);
  const mic = d.getElementById('search-mic');
  assert.equal(mic.hidden, false, 'mic shown in the app');
  mic.click();
  await tick(10);
  assert.equal(calls.voiceStarts.length, 1);
  assert.equal(calls.voiceStarts[0].language, 'en-PK');
  assert.equal(d.getElementById('search-input').value, 'Panadol');
  assert.equal(w.location.hash, '#/search/Panadol');
});

test('app voice search: Urdu mode listens in ur-PK; a blocked microphone shows a message', async () => {
  const ur = await bootApp({ lang: 'ur', voice: { said: 'پیناڈول' } });
  await tick(5);
  ur.d.getElementById('search-mic').click();
  await tick(10);
  assert.equal(ur.calls.voiceStarts[0].language, 'ur-PK');

  const denied = await bootApp({ voice: { said: 'x', permission: 'denied' } });
  await tick(5);
  denied.d.getElementById('search-mic').click();
  await tick(10);
  assert.equal(denied.calls.voiceStarts.length, 0);
  const i18n = require('../js/i18n.js');
  assert.equal(denied.d.getElementById('toast').textContent, i18n.STRINGS.en.voice_denied);
});

test('app voice search: an unknown en-PK recogniser falls back to en-US once', async () => {
  const { calls, d } = await bootApp({ voice: { said: 'x', fail: 'Language not supported' } });
  await tick(5);
  d.getElementById('search-mic').click();
  await tick(10);
  assert.deepEqual(calls.voiceStarts.map((s) => s.language), ['en-PK', 'en-US']);
  const i18n = require('../js/i18n.js');
  assert.equal(d.getElementById('toast').textContent, i18n.STRINGS.en.voice_failed);
});

test('website voice search: Web Speech API listens in the UI language', async () => {
  for (const [lang, expected] of [['en', 'en-PK'], ['ur', 'ur-PK']]) {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
    const w = dom.window;
    baseWindow(w);
    const data = fixtureJson();
    w.fetch = async (url) => (String(url).includes('medicines.json') ? { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(data)) } : { ok: false, status: 404, json: async () => ({}) });
    w.localStorage.setItem('sd_lang', lang);
    const recs = [];
    w.SpeechRecognition = class {
      constructor() { recs.push(this); }
      start() { this.started = true; }
    };
    for (const s of SCRIPTS) w.eval(fs.readFileSync(path.join(root, s), 'utf8'));
    await w.SDApp.ready;
    const mic = w.document.getElementById('search-mic');
    assert.equal(mic.hidden, false);
    mic.click();
    assert.equal(recs.length, 1);
    assert.equal(recs[0].lang, expected, lang);
    assert.ok(recs[0].started);
    recs[0].onresult({ results: [[{ transcript: 'Risek.' }]] });
    await tick();
    assert.equal(w.location.hash, '#/search/Risek');
    recs[0].onerror({ error: 'not-allowed' });
    assert.ok(w.document.getElementById('toast').textContent.length > 0);
    dom.window.close();
  }
});
