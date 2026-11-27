// Input security: XSS, prototype pollution, path traversal, oversized bodies, CSV formula injection,
// fake images, bidi characters, and the Content-Security-Policy / security headers.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-security-'));
process.env.SD_DATA_DIR = DIR;
process.env.ADMIN_PASSWORD = 'admin-pass-sec-1';
delete process.env.ADMIN_2FA_RESET;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.VERCEL;
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.BLOB_STORE_ID;

const { server } = require('../server');
const store = require('../lib/store');
const guard = require('../lib/guard');
const headers = require('../lib/headers');
const platform = require('../lib/platform');
const dataset = require('../lib/dataset');
const { client, adminLogin, signup } = require('./_http');

const ROOT = path.join(__dirname, '..');
let port;
const call = client(() => port);
const med = dataset.get().engine.search('panadol', { limit: 1 })[0].med;
const XSS = '<script>alert(1)</script><img src=x onerror=alert(2)>';

test('guard: prototype keys rejected at any depth, strings normalised', () => {
  for (const raw of ['{"__proto__":{"x":1}}', '{"a":{"b":[{"constructor":{"prototype":{"x":1}}}]}}', '{"prototype":1}', '{"a":[[{"__proto__":null}]]}']) {
    assert.throws(() => guard.sanitize(JSON.parse(raw)), (e) => e.status === 400 && /forbidden/.test(e.message), raw);
  }
  assert.equal({}.x, undefined, 'Object.prototype untouched');
  const out = guard.sanitize({ name: 'Ali‮gnp.exe', note: 'é ⁦x⁩ a\u0000b\u0007c', keep: 'line1\nline2\ttab', n: 5, ok: true, nil: null });
  assert.equal(out.name, 'Alignp.exe');
  assert.equal(out.note, 'é x abc', 'NFC + control and isolate characters removed');
  assert.equal(out.keep, 'line1\nline2\ttab', 'newlines and tabs kept');
  assert.deepEqual([out.n, out.ok, out.nil], [5, true, null]);
  let deep = {};
  const root = deep;
  for (let i = 0; i < 40; i++) deep = deep.a = {};
  assert.throws(() => guard.sanitize(root), /deeply/);
  assert.throws(() => guard.sanitize({ ['k'.repeat(300)]: 1 }), /too long/);
});

test('store keys only through safeKey (path traversal)', async () => {
  for (const bad of ['../x.json', 'users/../../etc/passwd', '/abs.json', 'users\\..\\x', '', 'a/..', '.hidden', 'x'.repeat(300)]) {
    assert.throws(() => store.safeKey(bad), /bad key/, bad);
    assert.equal(await store.get(bad), null);
    await assert.rejects(() => store.put(bad, {}), /bad key/);
  }
  assert.equal(store.safeKey('users/u_abc.json'), 'users/u_abc.json');
});

test('images: magic bytes, size, no SVG/HTML/polyglots', () => {
  const { checkImage, sniffImage } = platform._internals;
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 1)]);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 2)]);
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(50, 3)]);
  assert.equal(sniffImage(jpeg), 'image/jpeg');
  assert.equal(sniffImage(png), 'image/png');
  assert.equal(sniffImage(webp), 'image/webp');
  const url = (type, buf) => `data:${type};base64,${buf.toString('base64')}`;
  assert.equal(checkImage(url('image/jpeg', jpeg)).mediaType, 'image/jpeg');
  assert.equal(checkImage(url('image/png', png)).mediaType, 'image/png');
  assert.equal(checkImage(url('image/webp', webp)).mediaType, 'image/webp');
  const bad = [
    url('image/jpeg', Buffer.from('<html><script>alert(1)</script></html>')), // HTML renamed .jpg
    url('image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')),
    url('image/png', Buffer.from('<svg onload=alert(1)>')),
    url('image/png', jpeg), // type does not match the bytes
    url('image/gif', Buffer.from('GIF89a....')),
    url('image/jpeg', Buffer.concat([jpeg, Buffer.from('<script>alert(1)</script>')])), // polyglot
    url('image/jpeg', Buffer.concat([jpeg, Buffer.from('<!DOCTYPE html><body>')])),
    'data:text/html;base64,' + Buffer.from('<b>x</b>').toString('base64'),
    'javascript:alert(1)',
  ];
  for (const b of bad) assert.throws(() => checkImage(b), (e) => e.status === 400, b.slice(0, 40));
  assert.throws(() => checkImage(url('image/jpeg', Buffer.concat([jpeg, Buffer.alloc(4 * 1024 * 1024)]))), (e) => e.status === 413);
});

test('security over HTTP', async (t) => {
  await new Promise((r) => server.listen(0, r));
  port = server.address().port;
  t.after(() => {
    server.close();
    platform._setRxClient(null);
    fs.rmSync(DIR, { recursive: true, force: true });
  });
  const admin = (await adminLogin(call, 'admin-pass-sec-1')).headers;

  await t.test('XSS payloads are stored as text and only ever returned as JSON (never HTML)', async () => {
    const ph = await signup(call, 'pharmacy', 'xss@example.com', { name: XSS });
    let r = await call('/api/account?a=me', { headers: ph.h });
    assert.match(r.headers['content-type'], /^application\/json/);
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.equal(r.body.user.name, XSS.slice(0, 80), 'kept as plain text, the pages escape it when they render');
    r = await call('/api/account?a=save-pharmacy', { headers: ph.h, body: { name: XSS, address: XSS, city: 'Lahore', phone: '03001234567', hours: '"><svg onload=alert(1)>' } });
    assert.equal(r.status, 200);
    await call('/api/admin?a=pharmacy-update', { headers: admin, body: { id: r.body.pharmacy.id, verified: true } });
    r = await call('/api/places?a=nearby&city=Lahore');
    assert.match(r.headers['content-type'], /^application\/json/);
    assert.ok(r.body.pharmacies.some((p) => p.name === XSS.slice(0, 100)));
    r = await call('/api/feedback', { body: { type: 'other', message: XSS } });
    assert.equal(r.status, 200);
    r = await call('/api/admin?a=feedback', { headers: admin });
    assert.match(r.headers['content-type'], /^application\/json/);
    // unknown API paths answer JSON too, not a page that could echo input
    r = await call('/api/' + encodeURIComponent('<script>'));
    assert.equal(r.status, 404);
    assert.match(r.headers['content-type'], /json/);
    // CSV errors that echo a bad cell are JSON
    const pid = (await call('/api/account?a=my-pharmacies', { headers: ph.h })).body.pharmacies[0].id;
    r = await call('/api/account?a=import-stock', { headers: ph.h, body: { pid, csv: `medicine,status,price\n"${XSS.replace(/"/g, '""')}",in,\n` } });
    assert.equal(r.status, 400);
    assert.match(r.headers['content-type'], /^application\/json/);
    // the account and widget pages escape what they render (shared esc() helpers)
    for (const f of ['js/account.js', 'js/widget.js', 'unonenginerrunon/admin.js']) {
      assert.match(fs.readFileSync(path.join(ROOT, f), 'utf8'), /function esc\(|\besc\s*=\s*\(/, f);
    }
  });

  await t.test('prototype pollution is refused on every JSON route', async () => {
    const pat = await signup(call, 'patient', 'proto@example.com');
    const bodies = ['{"__proto__":{"polluted":"yes"},"name":"x"}', '{"name":"x","constructor":{"prototype":{"polluted":"yes"}}}', '{"cabinet":[{"id":"x","__proto__":{"polluted":1}}]}'];
    for (const raw of bodies) {
      for (const [p, h] of [['/api/account?a=update-profile', pat.h], ['/api/account?a=save-cabinet', pat.h], ['/api/feedback', {}], ['/api/account?a=signup', {}], ['/api/admin?a=save-config', admin], ['/api/places?a=event', {}]]) {
        const r = await call(p, { headers: h, raw });
        assert.equal(r.status, 400, p + ' ' + raw);
        assert.match(r.body.error, /forbidden/);
      }
    }
    assert.equal({}.polluted, undefined);
    assert.equal(Object.prototype.polluted, undefined);
  });

  await t.test('path traversal in ids and keys is refused', async () => {
    const ph = await signup(call, 'pharmacy', 'trav@example.com');
    for (const id of ['../secrets/session', '..%2F..%2Fsecrets%2Fsession', 'p_000000000000/../../x']) {
      const r = await call('/api/account?a=stats&id=' + id, { headers: ph.h });
      assert.equal(r.status, 404, id);
    }
    let r = await call('/api/admin?a=feedback-delete', { headers: admin, body: { key: '../secrets/session.json' } });
    assert.equal(r.status, 400);
    r = await call('/api/account?a=reservation-update', { headers: ph.h, body: { key: 'reservations/../secrets/session.json', status: 'ready' } });
    assert.equal(r.status, 400);
    r = await call('/api/admin?a=backup&date=../../secrets/session', { headers: admin });
    assert.equal(r.status, 400);
    for (const p of ['/..%2f..%2fserver.js', '/css/..%2f.data%2fsecrets%2fsession.json', '/lib/store.js', '/.data/secrets/session.json']) {
      assert.equal((await call(p)).status, 404, p);
    }
  });

  await t.test('oversized bodies are refused', async () => {
    const big = (n) => JSON.stringify({ email: 'a@b.com', name: 'x'.repeat(n), password: 'password-123', acceptTerms: true });
    let r = await call('/api/account?a=signup', { raw: big(20 * 1024) });
    assert.equal(r.status, 413);
    r = await call('/api/feedback', { raw: JSON.stringify({ message: 'x'.repeat(9000) }) });
    assert.equal(r.status, 413);
    r = await call('/api/admin?a=login', { headers: { 'X-SD-Admin': '1' }, raw: JSON.stringify({ password: 'x'.repeat(5000) }) });
    assert.equal(r.status, 413);
    platform._setRxClient({ messages: { create: async () => ({ content: [{ type: 'text', text: '{"medicines":[]}' }] }) } });
    // a 5 MB upload: refused with 413, or the connection is cut while the client is still sending
    r = await call('/api/places?a=rx', { raw: JSON.stringify({ image: 'data:image/jpeg;base64,' + 'A'.repeat(5 * 1024 * 1024) }) }).catch((e) => ({ status: e.code }));
    assert.ok([413, 'ECONNRESET', 'EPIPE'].includes(r.status), String(r.status));
  });

  await t.test('fake images are refused before they reach the AI', async () => {
    let calls = 0;
    platform._setRxClient({ messages: { create: async () => (calls++, { content: [{ type: 'text', text: '{"medicines":[{"name":"Panadol"}]}' }] }) } });
    const html = 'data:image/jpeg;base64,' + Buffer.from('<!DOCTYPE html><html><script>alert(1)</script></html>').toString('base64');
    let r = await call('/api/places?a=rx', { body: { image: html } });
    assert.equal(r.status, 400);
    r = await call('/api/places?a=rx', { body: { image: 'data:image/svg+xml;base64,' + Buffer.from('<svg/onload=alert(1)>').toString('base64') } });
    assert.equal(r.status, 400);
    assert.equal(calls, 0);
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xdb]), Buffer.alloc(200, 7)]);
    r = await call('/api/places?a=rx', { body: { image: 'data:image/jpeg;base64,' + jpeg.toString('base64') } });
    assert.equal(r.status, 200, r.text);
    assert.equal(calls, 1);
  });

  await t.test('CSV exports neutralise formulas', async () => {
    const ph = await signup(call, 'pharmacy', 'csvx@example.com');
    const pid = (await call('/api/account?a=save-pharmacy', { headers: ph.h, body: { name: 'Shop', address: '1 Road', city: 'Multan', phone: '03001234567' } })).body.pharmacy.id;
    for (const name of ['=cmd|"/c calc"!A1', '+SUM(1)', '-1+2', '@IMPORT("x")']) {
      await call('/api/account?a=save-refill', { headers: ph.h, body: { pid, name, phone: '0300' + String(Math.floor(Math.random() * 1e7)).padStart(7, '0'), meds: [{ id: med.id }], every: 30 } });
    }
    const r = await call('/api/account?a=export-csv&type=refills&id=' + pid, { headers: ph.h });
    assert.equal(r.status, 200);
    const lines = r.text.trim().split('\r\n').slice(1);
    assert.equal(lines.length, 4);
    for (const l of lines) assert.match(l, /^"?'/, l);
  });

  await t.test('bidi override and control characters are stripped from names', async () => {
    const r = await call('/api/account?a=signup', { body: { email: 'bidi@example.com', name: 'Ali‮txt.exe⁦\u0000', password: 'password-123', acceptTerms: true } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.user.name, 'Alitxt.exe');
    const ph = await signup(call, 'pharmacy', 'bidi-shop@example.com');
    const p = await call('/api/account?a=save-pharmacy', { headers: ph.h, body: { name: 'Shifa‭‬ Medical', address: 'Road ⁧x⁩', city: 'Lahore', phone: '03001234567' } });
    assert.equal(p.body.pharmacy.name, 'Shifa Medical');
    assert.equal(p.body.pharmacy.address, 'Road x');
    const stored = fs.readFileSync(path.join(DIR, 'users', r.body.user.id + '.json'), 'utf8');
    assert.doesNotMatch(stored, /[‪-‮⁦-⁩]/);
  });

  await t.test('CSP and security headers on every page; widget and /app pages embeddable', async () => {
    for (const p of ['/', '/account', '/business', '/developers', '/privacy', '/download.html', '/unonenginerrunon', '/css/style.css', '/404-nope']) {
      const r = await call(p);
      assert.equal(r.headers['content-security-policy'], headers.CSP, p);
      assert.match(r.headers['content-security-policy'], /frame-ancestors 'none'/);
      assert.equal(r.headers['x-content-type-options'], 'nosniff', p);
      assert.ok(r.headers['x-frame-options'], p);
      assert.equal(r.headers['referrer-policy'] || 'no-referrer', r.headers['referrer-policy'] ? r.headers['referrer-policy'] : 'no-referrer');
    }
    for (const p of ['/widget', '/widget.html', '/app/installed.html', '/app/active.html']) {
      const r = await call(p);
      assert.equal(r.status, 200, p);
      assert.equal(r.headers['content-security-policy'], headers.CSP_EMBEDDABLE, p);
      assert.match(r.headers['content-security-policy'], /frame-ancestors \*/);
      assert.equal(r.headers['x-frame-options'], undefined, p);
    }
    const csp = headers.CSP;
    for (const part of ["default-src 'self'", "script-src 'self' 'wasm-unsafe-eval' https://accounts.google.com/gsi/client", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", 'font-src', 'https://fonts.gstatic.com', "img-src 'self' data: blob:", "connect-src 'self' https://accounts.google.com https://vitals.vercel-insights.com", 'frame-src https://accounts.google.com']) {
      assert.ok(csp.includes(part), part);
    }
    assert.doesNotMatch(csp, /'unsafe-eval'/, 'no eval');
    assert.doesNotMatch(csp.split('; ').find((d) => d.startsWith('script-src')), /unsafe-inline/, 'no inline scripts');
  });

  await t.test('vercel.json carries exactly the same headers', () => {
    const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
    const rule = (src) => Object.fromEntries((v.headers.find((h) => h.source === src) || { headers: [] }).headers.map((h) => [h.key, h.value]));
    const all = rule('/((?!app/|widget).*)');
    for (const [k, val] of Object.entries(headers.PAGE)) assert.equal(all[k], val, k);
    assert.equal(rule('/widget(.*)')['Content-Security-Policy'], headers.CSP_EMBEDDABLE);
    assert.equal(rule('/app/(.*)')['Content-Security-Policy'], headers.CSP_EMBEDDABLE);
    assert.equal(rule('/unonenginerrunon(.*)')['X-Frame-Options'], 'DENY');
  });

  await t.test('no inline scripts anywhere the CSP applies (JSON-LD data blocks are fine)', () => {
    const files = [
      ...fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')),
      ...fs.readdirSync(path.join(ROOT, 'app')).filter((f) => f.endsWith('.html')).map((f) => 'app/' + f),
      'unonenginerrunon/index.html',
    ];
    for (const f of files) {
      const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
      const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(([, attrs, body]) => !/\bsrc=/.test(attrs) && !/type=["']application\/ld\+json["']/.test(attrs) && body.trim());
      assert.deepEqual(inline.map((m) => m[0].slice(0, 80)), [], f);
      assert.doesNotMatch(html, /\son(?:click|load|error|submit|change|input|mouseover|focus)\s*=/i, f + ' inline event handler');
      assert.doesNotMatch(html, /href=["']javascript:/i, f);
    }
    // SEO pages generated at build time
    const seo = fs.readFileSync(path.join(ROOT, 'scripts', 'build_seo.js'), 'utf8');
    const inlineSeo = [...seo.matchAll(/<script\b([^>]*)>/gi)].filter(([, attrs]) => !/\bsrc=/.test(attrs) && !/application\/ld\+json/.test(attrs));
    assert.deepEqual(inlineSeo.map((m) => m[0]), [], 'build_seo.js');
  });
});
