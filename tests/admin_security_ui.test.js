// Admin panel round 4 in jsdom (server stubbed): 2-step login at sign-in, the Security tab (QR, setup key,
// recovery codes, turning off), and the Backup & import tab (download, automatic backups, restore, CSV imports).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { root } = require('./helpers/fixture');

const OVERVIEW = {
  data: { products: 12000, formulas: 3000, latest_price_date: '2026-11-01', synced_at: '2026-11-20T00:00:00Z' },
  config: { overrides: {}, announcement: { on: false, tone: 'info', en: '', ur: '' }, ai: { enabled: false }, popular: [], contact: { phone: '', email: '', whatsapp: '' }, payments: {}, updatedAt: null },
  ai: { keySet: false, enabled: false, model: '' },
  feedback: { open: 0, total: 0, max: 500 },
  storage: 'local files',
};

/** routes: { action: (body, url) => [status, json, contentType?] }. authed: start signed in. */
async function boot(opts) {
  const o = Object.assign({ authed: true, routes: {} }, opts);
  const html = fs.readFileSync(path.join(root, 'unonenginerrunon', 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/unonenginerrunon', virtualConsole: new VirtualConsole() });
  const w = dom.window;
  w.scrollTo = () => {};
  w.matchMedia = () => ({ matches: false, addEventListener() {} });
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.confirm = () => true;
  w.calls = [];
  w.downloads = [];
  w.copied = [];
  Object.defineProperty(w.navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => w.copied.push(t) } });
  const blobs = new Map();
  w.URL.createObjectURL = (b) => {
    const id = 'blob:test/' + blobs.size;
    blobs.set(id, b);
    return id;
  };
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function () {
    if (this.download) w.downloads.push({ name: this.download, blob: blobs.get(this.href) });
  };
  let authed = o.authed;
  w.fetch = async (url, init) => {
    const u = new URL(String(url), 'http://localhost');
    const a = u.searchParams.get('a');
    const body = init && init.body ? JSON.parse(init.body) : null;
    w.calls.push({ a, body, method: (init && init.method) || 'GET', headers: (init && init.headers) || {} });
    let out;
    if (o.routes[a]) out = o.routes[a](body, u);
    else if (a === 'me') out = [200, { configured: true, authed }];
    else if (a === 'login') {
      authed = true;
      out = [200, { ok: true }];
    } else if (a === 'overview') out = [200, OVERVIEW];
    else if (a === 'feedback') out = [200, { items: [] }];
    else if (a === 'pharmacies' || a === 'payments' || a === 'users') out = [200, { [a]: [] }];
    else if (a === 'backups') out = [200, { backups: [] }];
    else if (a === '2fa-status') out = [200, { enabled: false }];
    else out = [404, { error: 'not found' }];
    if (out[0] === 200 && a === 'login') authed = true;
    const [status, payload, ctype] = out;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (k) => (/content-type/i.test(k) ? ctype || 'application/json' : null) },
      json: async () => JSON.parse(JSON.stringify(payload)),
      text: async () => (typeof payload === 'string' ? payload : JSON.stringify(payload)),
      blob: async () => new w.Blob([typeof payload === 'string' ? payload : JSON.stringify(payload)], { type: 'application/json' }),
    };
  };
  for (const s of ['js/data.js', 'js/search.js', 'js/qr.js', 'js/csvkit.js', 'unonenginerrunon/admin.js']) w.eval(fs.readFileSync(path.join(root, s), 'utf8'));
  await settle(60);
  return w;
}
const settle = (ms) => new Promise((r) => setTimeout(r, ms || 30));
async function until(fn, label) {
  for (let i = 0; i < 150; i++) {
    if (fn()) return;
    await settle(10);
  }
  assert.fail('timed out waiting for ' + label);
}
const submit = (w, form) => form.dispatchEvent(new w.Event('submit', { cancelable: true }));
function chooseFile(w, input, text, name) {
  const file = new w.File([text], name, { type: '' });
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  input.dispatchEvent(new w.Event('change', { bubbles: true }));
}
const tab = (w, name) => w.document.querySelector(`[role="tab"][data-tab="${name}"]`).click();

// ---------------------------------------------------------------------------
// Sign in with 2-step login
// ---------------------------------------------------------------------------
test('sign in: need2fa shows the code field, the code is sent with the password, then the panel opens', async () => {
  const logins = [];
  const w = await boot({
    authed: false,
    routes: {
      login: (b) => {
        logins.push(b);
        if (!b.code) return [401, { need2fa: true, error: 'Enter the 6-digit code from Google Authenticator' }];
        if (b.code !== '123456') return [401, { need2fa: true, error: 'That code is not right. Try the newest code.' }];
        return [200, { ok: true }];
      },
    },
  });
  const d = w.document;
  await until(() => !d.getElementById('login').hidden, 'login screen');
  assert.ok(d.getElementById('login-code-wrap').hidden, 'no code field before the password');
  d.getElementById('login-password').value = 'test-password-123';
  submit(w, d.getElementById('login-form'));
  await until(() => !d.getElementById('login-code-wrap').hidden, 'code field');
  assert.deepEqual(logins[0], { password: 'test-password-123' });
  assert.match(d.getElementById('login-note').textContent, /6-digit code from Google Authenticator/);
  assert.ok(d.getElementById('login-error').hidden, 'first prompt is not shown as an error');
  assert.match(d.getElementById('login-code-wrap').textContent, /recovery codes/);
  assert.ok(d.getElementById('panel').hidden);

  // wrong code -> error, still on sign in
  d.getElementById('login-code').value = '000000';
  submit(w, d.getElementById('login-form'));
  await until(() => !d.getElementById('login-error').hidden, 'error');
  assert.match(d.getElementById('login-error').textContent, /not right/);
  assert.equal(logins[1].code, '000000');

  // right code ("123 456" with a space is fine) -> panel
  d.getElementById('login-code').value = '123 456';
  submit(w, d.getElementById('login-form'));
  await until(() => !d.getElementById('panel').hidden, 'panel');
  assert.deepEqual(logins[2], { password: 'test-password-123', code: '123456' });
  assert.equal(d.getElementById('login-code').value, '', 'code cleared');
});

test('sign in: a recovery code can be typed in the same field', async () => {
  const logins = [];
  const w = await boot({ authed: false, routes: { login: (b) => (logins.push(b), b.code ? [200, { ok: true }] : [401, { need2fa: true, error: 'Enter the code' }]) } });
  const d = w.document;
  await until(() => !d.getElementById('login').hidden, 'login');
  d.getElementById('login-password').value = 'pw-12345678';
  submit(w, d.getElementById('login-form'));
  await until(() => !d.getElementById('login-code-wrap').hidden, 'code field');
  d.getElementById('login-code').value = 'abcd-ef12-3456';
  submit(w, d.getElementById('login-form'));
  await until(() => !d.getElementById('panel').hidden, 'panel');
  assert.equal(logins[1].code, 'abcd-ef12-3456');
});

test('a wrong code while turning 2FA off does not throw you back to sign in', async () => {
  const w = await boot({ routes: { '2fa-status': () => [200, { enabled: true }], '2fa-disable': () => [401, { error: 'Wrong code' }] } });
  const d = w.document;
  tab(w, 'security');
  await until(() => d.getElementById('sec-off-form'), 'off form');
  d.getElementById('sec-off-code').value = '111111';
  submit(w, d.getElementById('sec-off-form'));
  await until(() => /Wrong code/.test(d.getElementById('sec-msg').textContent), 'error shown');
  assert.equal(d.getElementById('panel').hidden, false);
  assert.ok(d.getElementById('login').hidden);
});

// ---------------------------------------------------------------------------
// Security tab
// ---------------------------------------------------------------------------
test('Security: turn on shows a QR of the otpauth URL and the key, enabling shows 10 recovery codes with Copy / Download', async () => {
  const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
  const otpauth = 'otpauth://totp/Sasta%20Dawa%20Admin?secret=' + secret + '&issuer=Sasta%20Dawa';
  const codes = Array.from({ length: 10 }, (_, i) => 'code-' + String(i).padStart(4, '0'));
  const w = await boot({ routes: { '2fa-setup': () => [200, { secret, otpauth }], '2fa-enable': (b) => (b.code === '654321' ? [200, { enabled: true, recoveryCodes: codes }] : [400, { error: 'Wrong code' }]) } });
  const d = w.document;
  tab(w, 'security');
  await until(() => d.getElementById('sec-start'), 'off state');
  assert.match(d.getElementById('sec-body').textContent, /2-step login is OFF/);
  assert.match(d.querySelector('[data-pane="security"]').textContent, /ADMIN_2FA_RESET/);

  d.getElementById('sec-start').click();
  await until(() => d.getElementById('sec-qr'), 'setup');
  assert.equal(w.calls.find((c) => c.a === '2fa-setup').method, 'POST');
  const svg = d.querySelector('#sec-qr svg');
  assert.ok(svg && svg.querySelector('path').getAttribute('d').length > 100, 'QR drawn');
  const expected = (w.SDQR.qrSvg(otpauth).match(/ d="([^"]+)"/) || [])[1];
  assert.equal(svg.querySelector('path').getAttribute('d'), expected, 'QR encodes exactly the otpauth URL');
  assert.equal(d.getElementById('sec-secret').textContent, 'JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP');
  d.getElementById('sec-copy-secret').click();
  await settle();
  assert.deepEqual(w.copied, [secret]);

  // wrong format is checked here; wrong code comes back from the server
  d.getElementById('sec-on-code').value = '12';
  submit(w, d.getElementById('sec-on-form'));
  await settle();
  assert.ok(!w.calls.some((c) => c.a === '2fa-enable'));
  d.getElementById('sec-on-code').value = '654 321';
  submit(w, d.getElementById('sec-on-form'));
  await until(() => d.getElementById('sec-codes'), 'codes');
  assert.deepEqual(w.calls.find((c) => c.a === '2fa-enable').body, { code: '654321' });
  assert.deepEqual([...d.querySelectorAll('#sec-codes code')].map((c) => c.textContent), codes);
  assert.match(d.getElementById('sec-body').textContent, /shown only once/);
  d.getElementById('sec-copy').click();
  await settle();
  assert.equal(w.copied[1], codes.join('\n'));
  d.getElementById('sec-dl').click();
  assert.match(w.downloads[0].name, /^sasta-dawa-admin-recovery-codes-\d{4}-\d{2}-\d{2}\.txt$/);
  const txt = await w.downloads[0].blob.text();
  for (const c of codes) assert.ok(txt.includes(c));

  // switching tabs keeps the codes on screen until "I have saved them"
  tab(w, 'overview');
  tab(w, 'security');
  await settle();
  assert.ok(d.getElementById('sec-codes'));
  d.getElementById('sec-done').click();
  await settle();
  assert.match(d.getElementById('sec-body').textContent, /2-step login is ON/);
});

test('Security: turning off needs a code and sends it', async () => {
  const w = await boot({ routes: { '2fa-status': () => [200, { enabled: true, enabledAt: '2026-11-27T10:00:00Z' }], '2fa-disable': () => [200, { enabled: false }] } });
  const d = w.document;
  tab(w, 'security');
  await until(() => d.getElementById('sec-off-form'), 'on state');
  assert.match(d.getElementById('sec-body').textContent, /on since 27 Nov 2026/);
  submit(w, d.getElementById('sec-off-form'));
  await settle();
  assert.ok(!w.calls.some((c) => c.a === '2fa-disable'));
  assert.match(d.getElementById('sec-msg').textContent, /Enter the 6-digit code/);
  d.getElementById('sec-off-code').value = '222333';
  submit(w, d.getElementById('sec-off-form'));
  await until(() => d.getElementById('sec-start'), 'off again');
  assert.deepEqual(w.calls.find((c) => c.a === '2fa-disable').body, { code: '222333' });
});

// ---------------------------------------------------------------------------
// Backup & import tab
// ---------------------------------------------------------------------------
test('Backup: download saves sasta-dawa-backup-<date>.json; automatic backups list; CRON_SECRET help', async () => {
  const backup = { version: 1, createdAt: '2026-11-27T00:00:00Z', keys: { 'users/u1.json': { id: 'u1' } } };
  const w = await boot({
    routes: {
      backup: () => [200, backup],
      backups: () => [200, { cron: false, backups: [{ key: 'backups/2026-11-26.json', size: 2048000, at: '2026-11-26T21:00:05Z' }, { date: '2026-11-25', size: 1900000 }] }],
    },
  });
  const d = w.document;
  tab(w, 'backup');
  await until(() => d.querySelector('.ad-bk-list'), 'backup list');
  const items = [...d.querySelectorAll('.ad-bk-list li')].map((li) => li.textContent);
  assert.match(items[0], /2026-11-26\.json/);
  assert.match(items[0], /2\.0 MB/);
  assert.match(items[1], /2026-11-25/);
  assert.match(d.getElementById('bk-list').textContent, /not switched on/);
  assert.match(d.querySelector('[data-pane="backup"]').textContent, /CRON_SECRET/);

  d.getElementById('bk-download').click();
  await until(() => w.downloads.length, 'download');
  const call = w.calls.find((c) => c.a === 'backup');
  assert.equal(call.method, 'GET');
  assert.equal(call.headers['X-SD-Admin'], '1');
  assert.match(w.downloads[0].name, /^sasta-dawa-backup-\d{4}-\d{2}-\d{2}\.json$/);
  assert.deepEqual(JSON.parse(await w.downloads[0].blob.text()), backup);
  assert.match(d.getElementById('bk-msg').textContent, /Backup downloaded/);
});

test('Restore: file is parsed here with counts per key prefix; needs RESTORE + a 6-digit code; posts mode merge', async () => {
  const w = await boot({ routes: { restore: () => [200, { restored: 3, skipped: 0 }] } });
  const d = w.document;
  tab(w, 'backup');
  await until(() => d.querySelector('#imp-overrides [data-tpl]'), 'tab ready');
  const input = d.getElementById('rs-file');

  chooseFile(w, input, 'not json', 'backup.json');
  await until(() => /not a valid backup/.test(d.getElementById('rs-summary').textContent), 'invalid json');
  chooseFile(w, input, JSON.stringify({ hello: 'world' }), 'backup.json');
  await until(() => /does not look like/.test(d.getElementById('rs-summary').textContent), 'no keys');
  chooseFile(w, input, '{}', 'backup.txt');
  await until(() => /\.json backup file/.test(d.getElementById('rs-summary').textContent), 'wrong extension');

  const backup = { createdAt: '2026-11-26T21:00:00Z', keys: { 'users/a.json': {}, 'users/b.json': {}, 'pharmacies/p1.json': {} } };
  chooseFile(w, input, JSON.stringify(backup), 'sasta-dawa-backup-2026-11-26.json');
  await until(() => d.getElementById('rs-table'), 'summary');
  const rows = [...d.querySelectorAll('#rs-table tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent));
  assert.deepEqual(rows, [['users', '2'], ['pharmacies', '1']]);
  assert.match(d.getElementById('rs-summary').textContent, /3<\/b>|3 records|: 3/);
  assert.equal(d.getElementById('rs-confirm').hidden, false);

  d.getElementById('rs-go').click();
  await settle();
  assert.match(d.getElementById('rs-msg').textContent, /Type RESTORE/);
  d.getElementById('rs-word').value = 'restore';
  d.getElementById('rs-go').click();
  await settle();
  assert.match(d.getElementById('rs-msg').textContent, /Type RESTORE/, 'capital letters');
  d.getElementById('rs-word').value = 'RESTORE';
  d.getElementById('rs-go').click();
  await settle();
  assert.match(d.getElementById('rs-msg').textContent, /6-digit code/);
  assert.ok(!w.calls.some((c) => c.a === 'restore'));
  d.getElementById('rs-code').value = '123456';
  d.getElementById('rs-go').click();
  await until(() => /Restore finished/.test(d.getElementById('rs-msg').textContent), 'restored');
  assert.deepEqual(w.calls.find((c) => c.a === 'restore').body, { backup, mode: 'merge', code: '123456' });
  assert.match(d.getElementById('rs-msg').textContent, /3 records written/);
});

test('CSV import (price fixes): template download, strict preview, all-or-nothing, server row errors shown', async () => {
  let reply = [400, { error: 'Some rows have problems', errors: [{ row: 2, error: 'unknown medicine_id' }] }];
  const w = await boot({ routes: { 'import-overrides': () => reply, 'csv-template': (b, u) => [200, { csv: 'medicine_id,price,hide,note\r\n' + u.searchParams.get('type') + '\r\n' }] } });
  const d = w.document;
  tab(w, 'backup');
  await until(() => d.querySelector('#imp-overrides [data-tpl]'), 'importer');
  const card = d.getElementById('imp-overrides');
  card.querySelector('[data-tpl]').click();
  await until(() => w.downloads.length, 'template');
  assert.equal(w.downloads[0].name, 'sasta-dawa-overrides-template.csv');
  assert.match(await w.downloads[0].blob.text(), /^medicine_id,price,hide,note\r\noverrides/);

  card.sdLoad('medicine_id,price,hide,note\nabc-1,120,no,receipt\nabc-2,,no,\nabc-3,,yes,hidden\n');
  assert.match(card.textContent, /3 rows · 1 with problems/);
  assert.match(card.querySelector('.ad-rowerr').textContent, /Row 3: price must be a number above 0/);
  const go = card.querySelector('[data-go]');
  assert.ok(go.disabled);
  card.querySelector('[data-partial]').checked = true;
  card.querySelector('[data-partial]').dispatchEvent(new w.Event('change'));
  go.click();
  await settle();
  const call = w.calls.find((c) => c.a === 'import-overrides');
  assert.equal(call.body.partial, true);
  assert.match(call.body.csv, /^medicine_id,price,hide,note\n/);
  assert.match(card.querySelector('[data-go-msg]').textContent, /Nothing was imported/);
  assert.match(card.querySelector('[data-result]').textContent, /Row 2: unknown medicine_id/);

  reply = [200, { imported: 2, errors: [] }];
  go.click();
  await until(() => /Imported 2 rows/.test(card.querySelector('[data-go-msg]').textContent), 'imported');
  assert.ok(w.calls.filter((c) => c.a === 'overview').length >= 2, 'price fixes reloaded after import');
});

test('CSV import (pharmacies): header must match the template exactly; .xlsx is refused before upload', async () => {
  const w = await boot();
  const d = w.document;
  tab(w, 'backup');
  await until(() => d.querySelector('#imp-pharmacies [data-tpl]'), 'importer');
  const card = d.getElementById('imp-pharmacies');
  assert.match(card.textContent, /name,address,area,city,phone,whatsapp,hours,lat,lng,owner_email/);
  card.sdLoad('name,address,city\nA,B,C\n');
  assert.match(card.querySelector('[data-preview]').textContent, /must be exactly/);
  chooseFile(w, card.querySelector('[data-file]'), 'x', 'pharmacies.xlsx');
  await until(() => /not a CSV file/.test(card.querySelector('[data-msg]').textContent), 'xlsx refused');
  card.sdLoad('name,address,area,city,phone,whatsapp,hours,lat,lng,owner_email\nAl-Shifa,Shop 4,G-9,Islamabad,0512345678,03001234567,9-11,33.69,73.03,owner@example.com\nBad,,G-9,Islamabad,,,,95,73,owner@example.com\n');
  assert.match(card.querySelector('.ad-rowerr').textContent, /Row 3: address is empty/);
});
