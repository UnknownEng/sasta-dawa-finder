// Strict CSV imports (lib/csv.js) for every template, plus safe CSV exports.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-csv-'));
process.env.SD_DATA_DIR = DIR;
process.env.ADMIN_PASSWORD = 'admin-pass-csv-1';
delete process.env.ADMIN_2FA_RESET;
delete process.env.VERCEL;
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.BLOB_STORE_ID;

const { server } = require('../server');
const csv = require('../lib/csv');
const dataset = require('../lib/dataset');
const { client, adminLogin, signup } = require('./_http');

let port;
const call = client(() => port);
const e = dataset.get().engine;
const M = ['panadol', 'augmentin', 'brufen', 'flagyl', 'risek'].map((q) => e.search(q, { limit: 1 })[0].med);

test('csv parser (RFC 4180)', () => {
  const recs = csv.parse('﻿a,b,c\r\n"x, y","he said ""hi""",3\n\n"multi\nline",,\r\nlast,row,end');
  assert.deepEqual(recs.map((r) => r.fields), [['a', 'b', 'c'], ['x, y', 'he said "hi"', '3'], ['multi\nline', '', ''], ['last', 'row', 'end']]);
  assert.deepEqual(recs.map((r) => r.row), [1, 2, 4, 5], 'spreadsheet row numbers: a blank line counts, a multi-line cell is one row');
  assert.throws(() => csv.parse('a,b\n"open,2'), /never closed/);
  assert.throws(() => csv.parse('a,b\nx"y,2'), /quote/);
  assert.throws(() => csv.parse('a,b\n"x"y,2'), /after a closing quote/);
  assert.throws(() => csv.parse('x'.repeat(2 * 1024 * 1024 + 1)), (err) => err.status === 413);
  assert.throws(() => csv.parse('h\n' + 'r\n'.repeat(5001)), (err) => err.status === 413 && /5000/.test(err.message));
  assert.equal(csv.parse('h\n' + 'r\n'.repeat(5000)).length, 5001, '5000 data rows are fine');
  assert.throws(() => csv.parse(null), /text/);
});

test('csv templates: exact headers and 2 example rows, every one parses against itself', () => {
  for (const [type, t] of Object.entries(csv.TEMPLATES)) {
    const text = csv.template(type);
    const lines = text.trim().split('\r\n');
    assert.equal(lines[0], t.header.join(','), type);
    const parsed = csv.parseTemplate(text, type);
    assert.equal(parsed.records.length, 2, type);
    assert.equal(parsed.errors.length, 0, type);
  }
  assert.equal(csv.TEMPLATES.stock.header.join(','), 'medicine,status,price');
  assert.equal(csv.TEMPLATES.refills.header.join(','), 'name,phone,medicines,every_days,last_refill_date');
  assert.equal(csv.TEMPLATES.list.header.join(','), 'medicine,quantity');
  assert.equal(csv.TEMPLATES.claims.header.join(','), 'medicine,quantity,amount_paid');
  assert.equal(csv.TEMPLATES.overrides.header.join(','), 'medicine_id,price,hide,note');
  assert.equal(csv.TEMPLATES.pharmacies.header.join(','), 'name,address,area,city,phone,whatsapp,hours,lat,lng,owner_email');
});

test('csv export escapes formula injection', () => {
  for (const bad of ['=HYPERLINK("http://x","y")', '+92300', '-2+3', '@SUM(A1)', '\tx', '\rx']) {
    const c = csv.cell(bad);
    assert.ok(c.replace(/^"/, '').startsWith("'"), JSON.stringify(bad) + ' -> ' + c);
  }
  assert.equal(csv.cell('plain'), 'plain');
  assert.equal(csv.cell('a,b'), '"a,b"');
  assert.equal(csv.cell('say "x"'), '"say ""x"""');
  const out = csv.toCsv(['name', 'note'], [['=1+1', 'ok']]);
  assert.equal(out, "name,note\r\n'=1+1,ok\r\n");
  // what we export can be imported again
  assert.deepEqual(csv.parse(out)[1].fields, ["'=1+1", 'ok']);
});

test('CSV imports over HTTP', async (t) => {
  await new Promise((r) => server.listen(0, r));
  port = server.address().port;
  t.after(() => {
    server.close();
    fs.rmSync(DIR, { recursive: true, force: true });
  });

  const ph = await signup(call, 'pharmacy', 'shop@example.com');
  const pid = (await call('/api/account?a=save-pharmacy', { headers: ph.h, body: { name: 'Shifa', address: '1 Mall Road', city: 'Lahore', phone: '03001234567' } })).body.pharmacy.id;
  const admin = (await adminLogin(call, 'admin-pass-csv-1')).headers;

  await t.test('template downloads (account: public; admin: signed in)', async () => {
    for (const type of ['stock', 'refills', 'list', 'claims']) {
      const r = await call('/api/account?a=csv-template&type=' + type);
      assert.equal(r.status, 200, type);
      assert.match(r.headers['content-type'], /^text\/csv/);
      assert.match(r.headers['content-disposition'], new RegExp(`attachment; filename="sasta-dawa-${type}-template.csv"`));
      assert.equal(r.text, csv.template(type));
      assert.equal(r.text.trim().split('\r\n').length, 3, 'header + 2 example rows');
    }
    assert.equal((await call('/api/account?a=csv-template&type=overrides')).status, 400, 'admin templates are not on /api/account');
    for (const type of ['overrides', 'pharmacies']) {
      assert.equal((await call('/api/admin?a=csv-template&type=' + type)).status, 401);
      const r = await call('/api/admin?a=csv-template&type=' + type, { headers: admin });
      assert.equal(r.status, 200);
      assert.equal(r.text, csv.template(type));
    }
    assert.equal((await call('/api/admin?a=csv-template&type=stock', { headers: admin })).status, 400);
  });

  await t.test('stock: good file, bad header, all-or-nothing, partial, limits, export', async () => {
    const good = `medicine,status,price\r\n"${M[0].product}",in,30\r\n${M[1].id},OUT,\r\n`;
    let r = await call('/api/account?a=import-stock', { headers: ph.h, body: { pid, csv: good } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.imported, 2);
    assert.deepEqual(r.body.errors, []);
    assert.equal(r.body.stock[M[1].id].s, 'out');
    assert.equal(r.body.stock[r.body.rows[0].id].price, 30);
    // bad header
    r = await call('/api/account?a=import-stock', { headers: ph.h, body: { pid, csv: 'name,status,price\nx,in,1\n' } });
    assert.equal(r.status, 400);
    assert.deepEqual(r.body.expected, ['medicine', 'status', 'price']);
    assert.match(r.body.error, /medicine,status,price/);
    r = await call('/api/account?a=import-stock', { headers: ph.h, body: { pid, csv: 'medicine,price,status\nx,1,in\n' } });
    assert.equal(r.status, 400, 'order matters');
    r = await call('/api/account?a=import-stock', { headers: ph.h, body: { pid, csv: ' Medicine , STATUS ,price\n' + M[2].id + ',in,\n' } });
    assert.equal(r.status, 200, 'case and spaces in the header are fine: ' + r.text);
    // bad rows: nothing imported
    const before = (await call('/api/account?a=my-pharmacies', { headers: ph.h })).body.pharmacies[0].stock;
    const bad = `medicine,status,price\n${M[3].id},in,10\nzzzz-no-such-medicine-qq,in,1\n${M[4].id},maybe,\n${M[4].id},in,-5\n${M[4].id},in\n`;
    r = await call('/api/account?a=import-stock', { headers: ph.h, body: { pid, csv: bad } });
    assert.equal(r.status, 400);
    assert.equal(r.body.imported, 0);
    assert.deepEqual(r.body.errors.map((x) => x.row), [3, 4, 5, 6]);
    assert.match(r.body.errors[1].error, /status/);
    assert.match(r.body.errors[2].error, /price/);
    assert.match(r.body.errors[3].error, /columns/);
    const after = (await call('/api/account?a=my-pharmacies', { headers: ph.h })).body.pharmacies[0].stock;
    assert.deepEqual(after, before, 'all-or-nothing');
    // partial: good rows only
    r = await call('/api/account?a=import-stock', { headers: ph.h, body: { pid, csv: bad, partial: true } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.imported, 1);
    assert.equal(r.body.errors.length, 4);
    assert.ok(r.body.stock[M[3].id]);
    // limits
    r = await call('/api/account?a=import-stock', { headers: ph.h, body: { pid, csv: 'medicine,status,price\n' + `${M[0].id},in,\n`.repeat(51) } });
    assert.equal(r.status, 402, 'more than 50 rows is a bulk upload (Premium)');
    r = await call('/api/account?a=import-stock', { headers: ph.h, body: { pid, csv: 'medicine,status,price\n' + `${M[0].id},in,\n`.repeat(5001) } });
    assert.equal(r.status, 413);
    r = await call('/api/account?a=import-stock', { headers: ph.h, body: { pid, csv: 'medicine,status,price\n' + 'x'.repeat(2.2 * 1024 * 1024) } });
    assert.equal(r.status, 413);
    r = await call('/api/account?a=import-stock', { headers: ph.h, body: { pid, csv: 'medicine,status,price\n' } });
    assert.equal(r.status, 400, 'no rows');
    r = await call('/api/account?a=import-stock', { headers: ph.h, body: { pid } });
    assert.equal(r.status, 400, 'csv missing');
    r = await call('/api/account?a=import-stock', { headers: ph.h, body: { pid: 'p_000000000000', csv: good } });
    assert.equal(r.status, 404, 'someone else\'s / unknown listing');
    // export in the same format
    r = await call('/api/account?a=export-csv&type=stock&id=' + pid, { headers: ph.h });
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /text\/csv/);
    assert.ok(r.text.startsWith('medicine,status,price\r\n'));
    const back = await call('/api/account?a=import-stock', { headers: ph.h, body: { pid, csv: r.text } });
    assert.equal(back.status, 200, 'an export imports again: ' + back.text);
  });

  await t.test('refills: good, bad rows, partial, export with formula-safe cells', async () => {
    const good = `name,phone,medicines,every_days,last_refill_date\nAli Khan,0300 1234567,"${M[0].product};${M[1].id}",30,2026-11-01\n"=HYPERLINK(""http://evil"")",03111234567,${M[2].id},15,\n`;
    let r = await call('/api/account?a=import-refills', { headers: ph.h, body: { pid, csv: good } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.imported, 2);
    let list = (await call('/api/account?a=refills&id=' + pid, { headers: ph.h })).body.customers;
    assert.equal(list.length, 2);
    const ali = list.find((c) => c.name === 'Ali Khan');
    assert.equal(ali.meds.length, 2);
    assert.equal(ali.every, 30);
    assert.equal(ali.lastAt.slice(0, 10), '2026-11-01');
    const bad = 'name,phone,medicines,every_days,last_refill_date\nNo Phone,,x,30,\nBad Med,03001112233,zzzz-no-such-med-qq,30,\nBad Days,03001112233,' + M[0].id + ',0,\nBad Date,03001112233,' + M[0].id + ',30,27/11/2026\nFuture,03001112233,' + M[0].id + ',30,2099-01-01\nGood One,03009998877,' + M[0].id + ',7,2026-11-20\n';
    r = await call('/api/account?a=import-refills', { headers: ph.h, body: { pid, csv: bad } });
    assert.equal(r.status, 400);
    assert.deepEqual(r.body.errors.map((x) => x.row), [2, 3, 4, 5, 6]);
    assert.equal((await call('/api/account?a=refills&id=' + pid, { headers: ph.h })).body.customers.length, 2, 'nothing imported');
    r = await call('/api/account?a=import-refills', { headers: ph.h, body: { pid, csv: bad, partial: true } });
    assert.equal(r.body.imported, 1);
    // same phone again replaces the customer instead of duplicating
    r = await call('/api/account?a=import-refills', { headers: ph.h, body: { pid, csv: 'name,phone,medicines,every_days,last_refill_date\nGood One Renamed,03009998877,' + M[0].id + ',7,\n' } });
    list = (await call('/api/account?a=refills&id=' + pid, { headers: ph.h })).body.customers;
    assert.equal(list.length, 3);
    assert.ok(list.some((c) => c.name === 'Good One Renamed'));
    r = await call('/api/account?a=import-refills', { headers: ph.h, body: { pid, csv: 'name,phone\nx,1\n' } });
    assert.equal(r.status, 400);
    assert.ok(r.body.expected);
    // export: the formula cell is neutralised
    r = await call('/api/account?a=export-csv&type=refills&id=' + pid, { headers: ph.h });
    assert.equal(r.status, 200);
    assert.ok(r.text.startsWith('name,phone,medicines,every_days,last_refill_date\r\n'));
    assert.match(r.text, /"'=HYPERLINK\(""http:\/\/evil""\)"/);
    assert.doesNotMatch(r.text, /(^|\n|,)=HYPERLINK/);
  });

  await t.test('NGO list: good, bad, partial, save as list', async () => {
    const ngo = await signup(call, 'ngo', 'ngo@example.com');
    const good = `medicine,quantity\n"${M[0].product}",100\n${M[1].id},50\n${M[1].id},25\n`;
    let r = await call('/api/account?a=import-list', { headers: ngo.h, body: { csv: good } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.imported, 3);
    assert.equal(r.body.items.find((x) => x.id === M[1].id).qty, 75, 'repeated medicines are added up');
    assert.ok(r.body.total_best <= r.body.total_now);
    assert.equal(r.body.list, undefined, 'not saved unless asked');
    r = await call('/api/account?a=import-list', { headers: ngo.h, body: { csv: 'medicine,quantity\nzzzz-not-real-qq,5\n' + M[0].id + ',abc\n' + M[0].id + ',3\n' } });
    assert.equal(r.status, 400);
    assert.deepEqual(r.body.errors.map((x) => x.row), [2, 3]);
    r = await call('/api/account?a=import-list', { headers: ngo.h, body: { csv: 'medicine,quantity\nzzzz-not-real-qq,5\n' + M[0].id + ',3\n', partial: true, save: true, name: 'Camp list' } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.list.name, 'Camp list');
    assert.equal(r.body.user.lists[0].items.length, 1);
    r = await call('/api/account?a=import-list', { headers: ngo.h, body: { csv: 'medicine,qty\nx,1\n' } });
    assert.equal(r.status, 400);
    r = await call('/api/account?a=import-list', { headers: ph.h, body: { csv: good } });
    assert.equal(r.status, 404, 'NGO accounts only');
  });

  await t.test('company claims: {csv} with medicine,quantity,amount_paid', async () => {
    const co = await signup(call, 'company', 'co@example.com');
    const good = `medicine,quantity,amount_paid\n"${M[0].product}",200,900\n${M[1].id},14,\nzzzz not a medicine qq,3,10\n`;
    let r = await call('/api/account?a=claims-report', { headers: co.h, body: { csv: good } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.imported, 3);
    assert.equal(r.body.rows.length, 2);
    assert.deepEqual(r.body.unmatched, ['zzzz not a medicine qq'], 'unknown medicines are listed, not errors');
    assert.ok(r.body.total_paid >= 900);
    r = await call('/api/account?a=claims-report', { headers: co.h, body: { csv: 'medicine,quantity,amount_paid\n' + M[0].id + ',,5\n' + M[0].id + ',2,lots\n' } });
    assert.equal(r.status, 400);
    assert.deepEqual(r.body.errors.map((x) => x.row), [2, 3]);
    r = await call('/api/account?a=claims-report', { headers: co.h, body: { csv: 'medicine,qty,paid\n' } });
    assert.equal(r.status, 400);
    assert.deepEqual(r.body.expected, ['medicine', 'quantity', 'amount_paid']);
    r = await call('/api/account?a=claims-report', { headers: co.h, body: { rows: [{ medicine: M[0].id, qty: 2 }] } });
    assert.equal(r.status, 200, 'the JSON rows form still works');
  });

  await t.test('admin price corrections: merged into settings, all-or-nothing', async () => {
    const good = `medicine_id,price,hide,note\n${M[0].id},12.5,no,New notice\n${M[1].id},,yes,Withdrawn\n`;
    let r = await call('/api/admin?a=import-overrides', { headers: { Cookie: admin.Cookie }, body: { csv: good } });
    assert.equal(r.status, 403, 'CSRF header needed');
    r = await call('/api/admin?a=import-overrides', { headers: admin, body: { csv: good } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.imported, 2);
    assert.equal(r.body.config.overrides[M[0].id].price, 12.5);
    assert.equal(r.body.config.overrides[M[1].id].hidden, true);
    const pub = (await call('/api/config')).body;
    assert.equal(pub.overrides[M[0].id].price, 12.5);
    const bad = `medicine_id,price,hide,note\nnot-a-real-id-zzz,5,no,\n${M[2].id},,no,\n${M[2].id},abc,no,\n${M[2].id},5,perhaps,\n${M[3].id},7,no,ok\n`;
    r = await call('/api/admin?a=import-overrides', { headers: admin, body: { csv: bad } });
    assert.equal(r.status, 400);
    assert.deepEqual(r.body.errors.map((x) => x.row), [2, 3, 4, 5]);
    assert.equal((await call('/api/config')).body.overrides[M[3].id], undefined, 'nothing imported');
    r = await call('/api/admin?a=import-overrides', { headers: admin, body: { csv: bad, partial: true } });
    assert.equal(r.body.imported, 1);
    // a hidden medicine can be un-hidden by giving a price
    r = await call('/api/admin?a=import-overrides', { headers: admin, body: { csv: `medicine_id,price,hide,note\n${M[1].id},20,no,back\n` } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.config.overrides[M[1].id].price, 20);
  });

  await t.test('admin pharmacies: owner must exist and be a pharmacy; created verified', async () => {
    await signup(call, 'patient', 'pat@example.com');
    const good = 'name,address,area,city,phone,whatsapp,hours,lat,lng,owner_email\nCity Medicos,"Shop 4, Blue Area",F-6,Islamabad,0512345678,,24 hours,33.71,73.06,SHOP@example.com\nSecond,12 Road,,Lahore,,03001234567,,,,shop@example.com\n';
    let r = await call('/api/admin?a=import-pharmacies', { headers: admin, body: { csv: good } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.imported, 2);
    const near = (await call('/api/places?a=nearby&city=Islamabad')).body.pharmacies;
    const cm = near.find((p) => p.name === 'City Medicos');
    assert.ok(cm && cm.verified, 'visible and verified');
    assert.equal(cm.address, 'Shop 4, Blue Area');
    const bad = 'name,address,area,city,phone,whatsapp,hours,lat,lng,owner_email\nPharm A,1 Rd,,Lahore,0300123456,,,,,nobody@example.com\nPharm B,1 Rd,,Lahore,0300123456,,,,,pat@example.com\nPharm C,1 Rd,,Lahore,,,,,,shop@example.com\nPharm D,1 Rd,,Lahore,0300123456,,,99,73,shop@example.com\nPharm E,,,Lahore,0300123456,,,,,shop@example.com\nPharm F,1 Rd,,Lahore,0300123456,,,,,not-an-email\n';
    r = await call('/api/admin?a=import-pharmacies', { headers: admin, body: { csv: bad } });
    assert.equal(r.status, 400);
    assert.deepEqual(r.body.errors.map((x) => x.row), [2, 3, 4, 5, 6, 7]);
    assert.match(r.body.errors[0].error, /sign up first/);
    assert.match(r.body.errors[1].error, /not a pharmacy/);
    r = await call('/api/admin?a=import-pharmacies', { headers: { 'X-SD-Admin': '1' }, body: { csv: good } });
    assert.equal(r.status, 401, 'admin only');
  });
});
