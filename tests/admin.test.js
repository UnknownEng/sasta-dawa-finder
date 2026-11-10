// Admin panel, site settings and feedback API (local-file storage in a temp folder).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

process.env.SD_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-admin-'));
process.env.ADMIN_PASSWORD = 'test-password-123';
delete process.env.BLOB_READ_WRITE_TOKEN;

const { server } = require('../server');
const config = require('../lib/config');
const auth = require('../lib/auth');

function request(port, method, p, { body, cookie, headers } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: p,
        headers: {
          ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
          ...(headers || {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try { json = JSON.parse(text); } catch (e) { /* not json */ }
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const ADMIN = { 'X-SD-Admin': '1' };

test('admin: sign-in, settings, price fixes, inbox', async (t) => {
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  t.after(() => server.close());
  const go = (m, p, o) => request(port, m, p, o);

  // hidden page is served, never indexed
  const page = await go('GET', '/unonenginerrunon');
  assert.equal(page.status, 200);
  assert.match(page.headers['x-robots-tag'], /noindex/);
  assert.match(page.text, /Admin sign in/);
  assert.equal((await go('GET', '/unonenginerrunon/admin.js')).status, 200);
  // the public site never links to it
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8'), /unonenginerrunon/);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', 'robots.txt'), 'utf8'), /unonenginerrunon/);

  // server code and stored data are not downloadable
  for (const p of ['/lib/auth.js', '/api/admin.js', '/.data/config/site.json', '/vercel.json']) {
    assert.equal((await go('GET', p)).status, 404, p);
  }

  assert.deepEqual((await go('GET', '/api/admin?a=me')).json, { configured: true, authed: false });
  assert.equal((await go('GET', '/api/admin?a=overview')).status, 401);
  assert.equal((await go('POST', '/api/admin?a=login', { body: { password: 'test-password-123' } })).status, 403, 'needs the admin header');
  assert.equal((await go('POST', '/api/admin?a=login', { body: { password: 'wrong' }, headers: ADMIN })).status, 401);

  const login = await go('POST', '/api/admin?a=login', { body: { password: 'test-password-123' }, headers: ADMIN });
  assert.equal(login.status, 200);
  const setCookie = login.headers['set-cookie'][0];
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  const cookie = setCookie.split(';')[0];
  assert.equal((await go('GET', '/api/admin?a=me', { cookie })).json.authed, true);

  const ov = await go('GET', '/api/admin?a=overview', { cookie });
  assert.equal(ov.status, 200);
  assert.ok(ov.json.data.products > 1000);
  assert.match(ov.json.storage, /local/);

  // pick a real product to correct and one to hide
  const engine = require('../lib/dataset').get().engine;
  const [fix, hide] = engine.search('panadol', { limit: 5 }).map((r) => r.med);

  const saved = await go('POST', '/api/admin?a=save-config', {
    cookie,
    headers: ADMIN,
    body: {
      config: {
        announcement: { on: true, tone: 'warn', en: 'Prices updated', ur: '' },
        ai: { enabled: false },
        popular: 'Panadol, Risek',
        contact: { phone: '0300 1234567', email: 'a@b.pk', whatsapp: '+92 300-1234567' },
        overrides: { [fix.id]: { price: 99.5, note: 'receipt' }, [hide.id]: { hidden: true }, 'BAD id!': { price: 1 } },
      },
    },
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.json.config.popular, ['Panadol', 'Risek']);
  assert.equal(saved.json.config.contact.whatsapp, '+923001234567');
  assert.equal(Object.keys(saved.json.config.overrides).length, 2, 'invalid ids are dropped');

  config._resetCache();
  const pub = (await go('GET', '/api/config')).json;
  assert.equal(pub.announcement.en, 'Prices updated');
  assert.equal(pub.ai, false);
  assert.deepEqual(pub.overrides[fix.id], { price: 99.5 }, 'admin notes are not public');
  assert.deepEqual(pub.overrides[hide.id], { hidden: true });

  // chat respects the admin switch; health reflects the corrected dataset
  assert.equal((await go('GET', '/api/health')).json.ai, false);
  const after = require('../lib/dataset').get();
  assert.equal(after.ds.byId.get(fix.id).price, 99.5);
  assert.equal(after.ds.byId.get(hide.id), undefined);

  // visitor feedback -> inbox -> done -> delete
  const fb = await go('POST', '/api/feedback', { body: { type: 'wrong_price', message: 'Rs 120 at my pharmacy', medicine_id: fix.id, medicine_name: fix.name, contact: '0300' } });
  assert.equal(fb.status, 200);
  assert.equal((await go('POST', '/api/feedback', { body: { type: 'other', message: '' } })).status, 400);
  assert.equal((await go('POST', '/api/feedback', { body: { message: 'spam', website: 'http://x' } })).status, 200, 'honeypot is silently accepted');
  const inbox = await go('GET', '/api/admin?a=feedback', { cookie });
  assert.equal(inbox.json.items.length, 1);
  const key = inbox.json.items[0].key;
  assert.equal(inbox.json.items[0].type, 'wrong_price');
  assert.equal((await go('POST', '/api/admin?a=feedback-update', { cookie, headers: ADMIN, body: { key, status: 'done' } })).status, 200);
  assert.equal((await go('GET', '/api/admin?a=feedback', { cookie })).json.items[0].status, 'done');
  assert.equal((await go('POST', '/api/admin?a=feedback-delete', { cookie, headers: ADMIN, body: { key: '../../etc/passwd' } })).status, 400);
  assert.equal((await go('POST', '/api/admin?a=feedback-delete', { cookie, headers: ADMIN, body: { key } })).status, 200);
  assert.equal((await go('GET', '/api/admin?a=feedback', { cookie })).json.items.length, 0);

  // sign out clears the cookie
  const out = await go('POST', '/api/admin?a=logout', { cookie, headers: ADMIN, body: {} });
  assert.match(out.headers['set-cookie'][0], /Max-Age=0/);
});

test('admin: session tokens are signed and expire', () => {
  const tok = auth.createToken(Date.now());
  assert.equal(auth.verifyToken(tok), true);
  assert.equal(auth.verifyToken(tok.slice(0, -2) + 'xx'), false, 'tampered signature');
  assert.equal(auth.verifyToken(auth.createToken(Date.now() - 13 * 3600 * 1000)), false, 'expired');
  const pw = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = 'another-password';
  assert.equal(auth.verifyToken(tok), false, 'changing the password signs everyone out');
  process.env.ADMIN_PASSWORD = pw;
});

test('settings sanitizer keeps text short and safe', () => {
  const c = config.sanitize({ announcement: { on: 1, tone: 'evil', en: 'x'.repeat(500) }, popular: Array(40).fill('a'), overrides: { ok: { price: -5 } } });
  assert.equal(c.announcement.tone, 'info');
  assert.equal(c.announcement.en.length, 280);
  assert.equal(c.popular.length, 16);
  assert.deepEqual(c.overrides, {}, 'non-positive prices are rejected');
});
