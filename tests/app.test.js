// Android / iOS app: the www/ bundle, the native glue (js/native.js) and the API's CORS for the app.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { JSDOM } = require('jsdom');
const { fixtureJson, root } = require('./helpers/fixture');

delete process.env.ANTHROPIC_API_KEY;

const SITE = 'https://sasta-dawa-finder.vercel.app/';
const SCRIPTS = ['js/native.js', 'js/i18n.js', 'js/data.js', 'js/search.js', 'js/assistant.js', 'js/app.js'];
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 0));

/** Boot the page as the app would see it: Capacitor present, pages served from https://localhost. */
async function bootApp(opts) {
  const o = opts || {};
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://localhost/' + (o.hash || '') });
  const w = dom.window;
  const data = fixtureJson();
  const calls = { fetch: [], share: [], browser: [], scheduled: [], cancelled: [], listeners: {} };
  w.scrollTo = () => {};
  w.matchMedia = () => ({ matches: false, addEventListener() {} });
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.fetch = async (url) => {
    calls.fetch.push(String(url));
    if (String(url).includes('medicines.json')) return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(data)) };
    if (String(url).endsWith('api/config')) return { ok: true, status: 200, json: async () => ({ ai: false }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  if (o.localStorage) for (const [k, v] of Object.entries(o.localStorage)) w.localStorage.setItem(k, JSON.stringify(v));
  const permission = o.permission || 'granted';
  w.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => o.platform || 'android',
    Plugins: {
      Share: { share: async (x) => { calls.share.push(x); } },
      Browser: { open: async (x) => { calls.browser.push(x.url); } },
      App: { addListener: (ev, fn) => { calls.listeners[ev] = fn; }, exitApp: () => { calls.exited = true; } },
      StatusBar: { setStyle: async () => {}, setBackgroundColor: async (x) => { calls.statusBar = x.color; } },
      LocalNotifications: {
        checkPermissions: async () => ({ display: permission === 'granted' ? 'granted' : 'prompt' }),
        requestPermissions: async () => ({ display: permission }),
        schedule: async (x) => { calls.scheduled.push(...x.notifications); },
        cancel: async (x) => { calls.cancelled.push(...x.notifications.map((n) => n.id)); calls.scheduled = []; },
        addListener: (ev, fn) => { calls.listeners['ln:' + ev] = fn; },
      },
    },
  };
  for (const s of SCRIPTS) w.eval(fs.readFileSync(path.join(root, s), 'utf8'));
  await w.SDApp.ready;
  return { dom, w, d: w.document, calls };
}

test('website: native glue stays off without Capacitor', async () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /<script src="js\/native\.js[^"]*"><\/script>\s*<script src="js\/i18n\.js/, 'native.js loads first');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
  dom.window.eval(fs.readFileSync(path.join(root, 'js/native.js'), 'utf8'));
  assert.equal(dom.window.SDNative, null);
  assert.ok(!dom.window.document.documentElement.classList.contains('native'));
});

test('app: API calls go to the live site and the bundled data loads locally', async () => {
  const { calls, d } = await bootApp();
  assert.ok(calls.fetch.includes(SITE + 'api/config'), calls.fetch.join(', '));
  assert.ok(calls.fetch.some((u) => u === 'data/medicines.json'));
  assert.ok(d.documentElement.classList.contains('native-android'));
  assert.equal(calls.statusBar, '#0f5c54');
});

test('app: sharing a medicine uses the share sheet with a link to the live site', async () => {
  const { w, d, calls } = await bootApp('');
  const id = w.SDApp.state.engine.popular(1)[0].id;
  w.location.hash = '#/medicine/' + encodeURIComponent(id);
  await tick();
  const btn = [...d.querySelectorAll('button')].find((b) => /share/i.test(b.id || '') || /share/i.test(b.textContent));
  assert.ok(btn, 'share button');
  btn.click();
  await tick(10);
  assert.equal(calls.share.length, 1);
  assert.ok(calls.share[0].url.startsWith(SITE + '#/medicine/'), calls.share[0].url);
});

test('app: outside links open in the system browser, not inside the app', async () => {
  const { w, calls } = await bootApp();
  w.open('https://www.google.com/maps/search/pharmacy+near+me', '_blank');
  assert.deepEqual(calls.browser, ['https://www.google.com/maps/search/pharmacy+near+me']);
  const a = w.document.createElement('a');
  a.href = 'https://wa.me/923001234567';
  a.target = '_blank';
  w.document.body.appendChild(a);
  a.click();
  assert.equal(calls.browser[1], 'https://wa.me/923001234567');
});

test('app: Android back button goes back, then exits on the home screen', async () => {
  const { w, calls } = await bootApp();
  let backs = 0;
  w.history.back = () => { backs++; };
  w.location.hash = '#/my-medicines';
  await tick();
  calls.listeners.backButton();
  assert.equal(backs, 1);
  w.location.hash = '';
  await tick();
  calls.listeners.backButton();
  assert.equal(calls.exited, true);
});

test('app: My Medicines has daily reminders and no print button', async () => {
  const { w, d, calls } = await bootApp();
  const [a, b] = w.SDApp.state.engine.popular(2);
  w.SDApp.cabinet.add(a.id);
  w.SDApp.cabinet.add(b.id);
  w.location.hash = '#/my-medicines';
  await tick();
  assert.ok(d.getElementById('rem-card'), 'reminder card');
  assert.equal(d.getElementById('cab-print'), null);

  d.getElementById('rem-new').value = '08:30';
  d.getElementById('rem-save').click();
  await tick(10);
  assert.equal(calls.scheduled.length, 1);
  const n = calls.scheduled[0];
  assert.equal(JSON.stringify(n.schedule.on), JSON.stringify({ hour: 8, minute: 30 }));
  assert.ok(n.body.includes(a.name) && n.body.includes(b.name), n.body);
  assert.equal(JSON.stringify(JSON.parse(w.localStorage.getItem('sd_reminders')).times), '["08:30"]');
  assert.equal(d.querySelectorAll('.rem-chip').length, 1);

  // A second time, then remove the first one.
  d.getElementById('rem-new').value = '21:00';
  d.getElementById('rem-save').click();
  await tick(10);
  assert.equal(calls.scheduled.map((x) => x.schedule.on.hour).sort((x, y) => x - y).join(), '8,21');
  d.querySelector('[data-rem-del="08:30"]').click();
  await tick(10);
  assert.equal(calls.scheduled.map((x) => x.schedule.on.hour).join(), '21');

  // Tapping the notification opens My Medicines.
  w.location.hash = '';
  await tick();
  calls.listeners['ln:localNotificationActionPerformed']({ notification: { extra: { route: '#/my-medicines' } } });
  assert.equal(w.location.hash, '#/my-medicines');
});

test('app: blocked notifications show a message and schedule nothing', async () => {
  const { w, d, calls } = await bootApp({ permission: 'denied' });
  w.SDApp.cabinet.add(w.SDApp.state.engine.popular(1)[0].id);
  w.location.hash = '#/my-medicines';
  await tick();
  d.getElementById('rem-save').click();
  await tick(10);
  assert.equal(calls.scheduled.length, 0);
  assert.match(d.body.textContent, /Notifications are off/);
});

test('build_app bundles the site for the app without admin, service worker or SEO files', () => {
  const { build } = require('../scripts/build_app');
  const out = build();
  const list = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : list.push(path.relative(out, path.join(dir, e.name)).split(path.sep).join('/'))));
  walk(out);
  for (const must of ['index.html', 'js/native.js', 'js/app.js', 'css/style.css', 'data/medicines.json', 'icons/icon-512.png']) assert.ok(list.includes(must), must);
  for (const f of list) assert.doesNotMatch(f, /^unonenginerrunon\/|^sw\.js$|sitemap|robots|404\.html|^(lib|api|scripts|tests)\//, f);
  assert.doesNotMatch(fs.readFileSync(path.join(out, 'index.html'), 'utf8'), /rel="manifest"/);
  const cap = JSON.parse(fs.readFileSync(path.join(root, 'capacitor.config.json'), 'utf8'));
  assert.equal(cap.webDir, 'www');
});

test('API: CORS only for the app origins and never for admin', async (t) => {
  const { server } = require('../server');
  await new Promise((r) => server.listen(0, r));
  t.after(() => server.close());
  const port = server.address().port;
  const req = (p, method, headers) => new Promise((resolve, reject) => {
    const r = http.request({ port, path: p, method, headers }, (res) => { res.resume(); res.on('end', () => resolve(res)); });
    r.on('error', reject);
    r.end();
  });

  for (const origin of ['https://localhost', 'capacitor://localhost']) {
    const pre = await req('/api/chat', 'OPTIONS', { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' });
    assert.equal(pre.statusCode, 204, origin);
    assert.equal(pre.headers['access-control-allow-origin'], origin);
    assert.match(pre.headers['access-control-allow-headers'], /Content-Type/i);
    const get = await req('/api/config', 'GET', { Origin: origin });
    assert.equal(get.statusCode, 200);
    assert.equal(get.headers['access-control-allow-origin'], origin);
  }
  const evil = await req('/api/config', 'GET', { Origin: 'https://evil.example' });
  assert.equal(evil.headers['access-control-allow-origin'], undefined);
  const admin = await req('/api/admin?a=me', 'GET', { Origin: 'https://localhost' });
  assert.equal(admin.headers['access-control-allow-origin'], undefined);
  const adminPre = await req('/api/admin?a=login', 'OPTIONS', { Origin: 'capacitor://localhost' });
  assert.notEqual(adminPre.statusCode, 204);
  assert.equal(adminPre.headers['access-control-allow-origin'], undefined);
});

test('website: Android download button points at the published APK; hidden inside the app', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const url = 'https://github.com/UnknownEng/sasta-dawa-finder/releases/download/android/SastaDawa.apk';
  const dom = new JSDOM(html);
  const links = [...dom.window.document.querySelectorAll('a.app-get, .app-get a')].map((a) => a.getAttribute('href'));
  assert.ok(links.length >= 3, 'side card, phone banner and footer link');
  for (const l of links) assert.equal(l, '/download', 'goes through /download so clicks are counted');
  const dl = fs.readFileSync(path.join(root, 'download.html'), 'utf8');
  assert.ok(dl.includes(url), '/download sends people to the published APK');
  assert.match(dl, /_vercel\/insights\/script\.js/);
  assert.match(dl, /noindex/);
  assert.ok(require('../scripts/build_public').FILES.includes('download.html'));
  assert.match(fs.readFileSync(path.join(root, 'css/style.css'), 'utf8'), /\.native \.app-get(, \.native \.app-hide)?\s*\{\s*display:\s*none/);
  const wf = fs.readFileSync(path.join(root, '.github/workflows/mobile-apps.yml'), 'utf8');
  assert.match(wf, /gh release upload android SastaDawa\.apk SastaDawa-Pharmacies\.apk --clobber/);
  const i18n = require('../js/i18n.js');
  for (const k of ['app_android', 'app_android_note', 'app_ios_note', 'footer_app', 'app_banner_t', 'app_banner_d', 'app_banner_btn']) {
    assert.ok(i18n.STRINGS.en[k] && i18n.STRINGS.ur[k], k);
  }
});

test('app: counts a real install once, then at most one active ping a day', async () => {
  const { w, d } = await bootApp();
  const frames = () => [...d.querySelectorAll('iframe')].map((f) => f.getAttribute('src'));
  w.SDNative.countUsage();
  assert.deepEqual(frames().filter((s) => s.endsWith('app/installed')), [SITE + 'app/installed']);
  d.querySelector('iframe[src$="app/installed"]').dispatchEvent(new w.Event('load'));
  assert.ok(frames().includes(SITE + 'app/active'), 'active ping after install');
  d.querySelector('iframe[src$="app/active"]').dispatchEvent(new w.Event('load'));
  const st = JSON.parse(w.localStorage.getItem('sd_usage'));
  assert.ok(st.installed && st.active);
  // Same day, next launch: nothing more is sent.
  d.querySelectorAll('iframe').forEach((f) => f.remove());
  w.SDNative.countUsage();
  assert.equal(d.querySelectorAll('iframe').length, 0);
  // Next day: one active ping, no second install.
  w.localStorage.setItem('sd_usage', JSON.stringify({ installed: st.installed, active: '2000-1-1' }));
  w.SDNative.countUsage();
  assert.deepEqual(frames(), [SITE + 'app/active']);
});

test('app: no web analytics inside the app; website reports one page view per screen', async () => {
  const { build } = require('../scripts/build_app');
  const html = fs.readFileSync(path.join(build(), 'index.html'), 'utf8');
  assert.doesNotMatch(html, /_vercel\/insights|data-sd-analytics/);

  const src = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(src, /_vercel\/insights\/script\.js" data-disable-auto-track="1"/);
  const dom = new JSDOM(src, { runScripts: 'outside-only', url: 'http://localhost/' });
  const w = dom.window;
  const views = [];
  w.va = (cmd, data) => { if (cmd === 'pageview') views.push(data); };
  w.scrollTo = () => {};
  w.matchMedia = () => ({ matches: false, addEventListener() {} });
  w.HTMLElement.prototype.scrollIntoView = function () {};
  const data = fixtureJson();
  w.fetch = async (url) => (String(url).includes('medicines.json') ? { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(data)) } : { ok: false, status: 404, json: async () => ({}) });
  for (const s of ['js/native.js', 'js/i18n.js', 'js/data.js', 'js/search.js', 'js/assistant.js', 'js/app.js']) w.eval(fs.readFileSync(path.join(root, s), 'utf8'));
  await w.SDApp.ready;
  const id = w.SDApp.state.engine.popular(1)[0].id;
  w.location.hash = '#/medicine/' + encodeURIComponent(id);
  await tick();
  w.location.hash = '#/search/panadol';
  await tick();
  assert.equal(JSON.stringify(views.map((v) => v.path)), JSON.stringify(['/', '/medicine/' + id, '/search']));
  assert.equal(views[1].route, '/medicine/[id]');
});

test('SEO build: brand and formula pages Google can index, with a sitemap', () => {
  const os = require('os');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-seo-'));
  const r = require('../scripts/build_seo').build(out);
  assert.ok(r.brands > 5000 && r.formulas > 1000, JSON.stringify(r));
  const panadol = fs.readFileSync(path.join(out, 'dawa', 'panadol.html'), 'utf8');
  assert.match(panadol, /<title>Panadol price in Pakistan/);
  assert.match(panadol, /<link rel="canonical" href="https:\/\/sasta-dawa-finder\.vercel\.app\/dawa\/panadol">/);
  assert.match(panadol, /"@type":"Drug"/);
  assert.match(panadol, /href="\/dawa\/viodol"/, 'links to the cheaper brand page');
  assert.match(panadol, /href="\/#\/medicine\//, 'deep link into the app');
  assert.match(panadol, /_vercel\/insights\/script\.js/);
  const map = fs.readFileSync(path.join(out, 'sitemap.xml'), 'utf8');
  assert.equal((map.match(/<url>/g) || []).length, r.urls);
  assert.match(map, /\/dawa\/panadol</);
  assert.doesNotMatch(map, /#/, 'no hash URLs in the sitemap');
  assert.ok(fs.existsSync(path.join(out, 'browse', 'p.html')) && fs.existsSync(path.join(out, 'formula.html')));
  const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  assert.equal(vercel.cleanUrls, true);
  fs.rmSync(out, { recursive: true, force: true });
});

test('medicine pages: search box suggests Panadol for "pana" and opens its page', async () => {
  const os = require('os');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-sug-'));
  require('../scripts/build_seo').build(out);
  const index = JSON.parse(fs.readFileSync(path.join(out, 'data', 'search-index.json'), 'utf8'));
  const html = fs.readFileSync(path.join(out, 'dawa', 'lipitor.html'), 'utf8');
  assert.match(html, /id="seo-search"/);
  assert.match(html, /\/js\/seo-search\.js\?v=[0-9a-f]{8}/);
  assert.match(html, /\/css\/seo\.css\?v=[0-9a-f]{8}/);
  assert.match(html, /\+92 339 3202419/);
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://sasta-dawa-finder.vercel.app/dawa/lipitor' });
  const w = dom.window;
  w.fetch = async () => ({ ok: true, json: async () => index });
  w.eval(fs.readFileSync(path.join(root, 'js/seo-search.js'), 'utf8'));
  const input = w.document.querySelector('#seo-search input');
  input.value = 'pana';
  input.dispatchEvent(new w.Event('input'));
  await new Promise((r) => setTimeout(r, 20));
  const links = [...w.document.querySelectorAll('#seo-suggest a')];
  assert.ok(links.length > 0);
  assert.equal(links[0].getAttribute('href'), '/dawa/panadol');
  fs.rmSync(out, { recursive: true, force: true });
});

test('footer: new contact details and company name; no raw text keys', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /tel:\+923393202419/);
  assert.match(html, /mavericktech\.pk@gmail\.com/);
  assert.match(html, /Maverick Technologies/);
  assert.doesNotMatch(html, /3273202419|ahmedmansoorrind|Maverick Tech Ventures|footer-az/);
  const i18n = require('../js/i18n.js');
  for (const el of new JSDOM(html).window.document.querySelectorAll('[data-i18n]')) {
    const k = el.getAttribute('data-i18n');
    assert.ok(i18n.STRINGS.en[k] && i18n.STRINGS.ur[k], 'missing text for ' + k);
  }
  assert.match(fs.readFileSync(path.join(root, 'lib/config.js'), 'utf8'), /\+92 339 3202419/);
});
