// Service worker: OCR files are not precached, are saved on first use in their own cache
// (so the second scan works offline), and that cache survives app updates.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadSw() {
  const stores = new Map();
  const open = async (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    return {
      addAll: async (urls) => urls.forEach((u) => m.set(String(u), { status: 200, type: 'basic', clone() { return this; }, body: 'pre' })),
      put: async (req, res) => m.set(req.url || String(req), res),
      match: async (req) => m.get(req.url || String(req)),
    };
  };
  const caches = {
    open,
    keys: async () => [...stores.keys()],
    delete: async (k) => stores.delete(k),
    match: async (req) => { for (const m of stores.values()) { const hit = m.get(req.url || String(req)); if (hit) return hit; } return undefined; },
  };
  const listeners = {};
  const net = [];
  const self = {
    location: { origin: 'https://sastadawafinder.pk' },
    addEventListener: (t, fn) => (listeners[t] = fn),
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  let online = true;
  const fetchFn = async (req) => {
    net.push(req.url);
    if (!online) throw new Error('offline');
    return { status: 200, type: 'basic', clone() { return this; }, body: 'net:' + req.url };
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8'), { self, caches, fetch: fetchFn, URL, Promise, setTimeout, console });
  const run = async (type, extra) => {
    let p = null;
    const ev = { waitUntil: (x) => (p = x), respondWith: (x) => (p = x), ...extra };
    listeners[type](ev);
    return p ? await p : undefined;
  };
  const get = (url) => run('fetch', { request: { url, method: 'GET', mode: 'no-cors', headers: { get: () => null } } });
  return { stores, run, get, net, setOnline: (v) => (online = v) };
}

test('service worker: OCR files cached on first use, served offline after, kept across versions', async () => {
  const sw = loadSw();
  await sw.run('install');
  const pre = [...sw.stores.values()].flatMap((m) => [...m.keys()]);
  assert.ok(pre.length > 5);
  assert.ok(!pre.some((u) => /vendor\/ocr/.test(u)), 'OCR files are not precached');

  const url = 'https://sastadawafinder.pk/vendor/ocr/eng.traineddata.gz';
  const first = await sw.get(url);
  assert.equal(first.body, 'net:' + url);
  const ocrCache = [...sw.stores.keys()].find((k) => /ocr/.test(k));
  assert.ok(ocrCache, 'separate OCR cache');
  assert.ok(sw.stores.get(ocrCache).has(url));

  sw.setOnline(false);
  const n = sw.net.length;
  const second = await sw.get(url);
  assert.equal(second.body, 'net:' + url);
  assert.equal(sw.net.length, n, 'second scan: no network');

  // a new release (activate) deletes old app caches but keeps the OCR cache
  sw.stores.set('sasta-dawa-v0.0.1', new Map());
  await sw.run('activate');
  assert.ok(!sw.stores.has('sasta-dawa-v0.0.1'));
  assert.ok(sw.stores.has(ocrCache));
});
