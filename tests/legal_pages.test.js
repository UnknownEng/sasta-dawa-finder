// Legal pages (terms, privacy, refund, disclaimer, pharmacy terms, delete account): content, Urdu summary,
// contact, no inline scripts (CSP), links between pages, footers of other pages, and the build file list.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { root } = require('./helpers/fixture');

const PAGES = ['terms.html', 'privacy.html', 'refund.html', 'disclaimer.html', 'pharmacy-terms.html', 'delete-account.html'];
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const doc = (f) => new JSDOM(read(f)).window.document;
const text = (d) => d.body.textContent.replace(/\s+/g, ' ');

test('every legal page: title, "Last updated 27 Nov 2026", Urdu summary on top, contact, company name', () => {
  for (const f of PAGES) {
    const d = doc(f);
    const t = text(d);
    assert.ok(d.title.endsWith('| Sasta Dawa Finder'), f + ' title');
    assert.ok(d.querySelector('h1'), f + ' h1');
    assert.match(t, /Last updated 27 Nov 2026/, f);
    const ur = d.querySelector('.urdu-summary');
    assert.ok(ur, f + ' Urdu summary');
    assert.equal(ur.getAttribute('lang'), 'ur');
    assert.equal(ur.getAttribute('dir'), 'rtl');
    assert.ok(/[؀-ۿ]{20,}/.test(ur.textContent.replace(/\s/g, '')), f + ' summary is in Urdu script');
    // the summary comes before the body text
    const firstH2 = d.querySelector('main h2');
    assert.ok(ur.compareDocumentPosition(firstH2) & 4, f + ' summary on top');
    assert.match(t, /\+92 339 3202419/, f + ' WhatsApp');
    assert.ok(d.querySelector('a[href="https://wa.me/923393202419"]'), f + ' WhatsApp link');
    assert.ok(d.querySelector('a[href="mailto:mavericktech.pk@gmail.com"]'), f + ' email');
    assert.match(t, /Maverick Technologies, Islamabad/, f);
    assert.ok(d.querySelector('link[href^="css/style.css"]') && d.querySelector('link[href^="css/account.css"]'), f + ' same calm design');
    assert.doesNotMatch(t, /lawyer/i, f + ': the "not reviewed by a lawyer" note belongs in the report, not on the page');
  }
});

test('legal pages have no inline scripts or inline handlers (CSP script-src self) and use relative links', () => {
  for (const f of PAGES) {
    const html = read(f);
    const d = doc(f);
    for (const s of d.querySelectorAll('script')) assert.ok(s.getAttribute('src'), f + ': inline <script>');
    assert.doesNotMatch(html, /\son[a-z]+=/i, f + ': inline event handler');
    // every page links to every other legal page (nav + footer), relatively so the apps can bundle them
    for (const g of PAGES) assert.ok(d.querySelector(`a[href="${g}"]`), `${f} links to ${g}`);
    assert.equal(d.querySelector('.legal-nav a[aria-current="page"]').getAttribute('href'), f);
    // internal links point at files that exist
    for (const a of d.querySelectorAll('a[href]')) {
      const h = a.getAttribute('href');
      if (/^(https?:|mailto:|tel:|#|\.\/$)/.test(h)) continue;
      assert.ok(fs.existsSync(path.join(root, h.split(/[?#]/)[0])), `${f}: broken link ${h}`);
    }
  }
});

test('Terms of Service cover the required topics', () => {
  const t = text(doc('terms.html'));
  for (const re of [/account/i, /Acceptable use/i, /free trial/i, /JazzCash, Easypaisa or bank transfer/, /Cancellation/, /does not give medical advice/i, /maximum retail prices notified by DRAP/i, /change from time to time/, /Pharmacy listings/i, /Limitation of liability/i, /laws of Pakistan/, /courts at Islamabad/, /Changes to these terms/]) {
    assert.match(t, re);
  }
});

test('Privacy Policy covers what, where (Vercel, USA), why, retention, sharing, rights, children', () => {
  const t = text(doc('privacy.html'));
  for (const re of [/name, email, phone/i, /pharmacy accounts/i, /medicines list/i, /use my location/, /not stored/i, /stay on your device/i, /AI fallback/, /Vercel/, /United States/, /Why we use it/, /How long we keep it/, /never sell/i, /pharmacy sees the details you send/i, /Download my data/, /Delete account/, /Children/, /Contact/]) {
    assert.match(t, re);
  }
});

test('Refund, disclaimer, pharmacy terms and delete-account pages say the key things', () => {
  const r = text(doc('refund.html'));
  assert.match(r, /free trial/i);
  assert.match(r, /not refunded/);
  assert.match(r, /duplicate payment/i);
  assert.match(r, /within 7 days/);
  assert.match(r, /How to ask for a refund/);
  const m = text(doc('disclaimer.html'));
  assert.match(m, /does not give medical advice/);
  assert.match(m, /maximum retail prices \(MRP\) notified by DRAP/);
  assert.match(m, /1122/);
  const p = text(doc('pharmacy-terms.html'));
  assert.match(p, /drug sale licence/);
  assert.match(p, /DRAP/);
  assert.match(p, /advertise or promote any medicine/);
  assert.match(p, /Honour reservations/);
  assert.match(p, /remove a listing/);
  const del = text(doc('delete-account.html'));
  assert.match(del, /Profile/);
  assert.match(del, /Delete account/);
  assert.match(del, /WhatsApp/);
  assert.match(del, /What is deleted/);
  assert.match(del, /purged within 14 days/);
  assert.match(del, /within 7 days/);
});

test('footers of the other web pages link the legal pages; signup screen links Terms and Privacy', () => {
  const need = ['terms', 'privacy', 'refund', 'disclaimer', 'pharmacy-terms', 'delete-account'];
  for (const f of ['account.html', 'business.html', 'developers.html', '404.html', 'download.html']) {
    const d = doc(f);
    for (const n of need) {
      const ok = [...d.querySelectorAll('a[href]')].some((a) => new RegExp('(^|/)' + n + '(\\.html)?$').test(a.getAttribute('href')));
      assert.ok(ok, `${f} links to ${n}`);
    }
  }
  const w = doc('widget.html');
  for (const n of ['terms', 'privacy', 'disclaimer']) assert.ok(w.querySelector(`a[href$="/${n}"][target="_blank"]`), 'widget links ' + n);
  assert.match(read('js/account.js'), /I agree to the <a href="terms\.html"[^>]*>Terms of Service<\/a> and <a href="privacy\.html"[^>]*>Privacy Policy<\/a>/);
});

test('build: the legal pages are published; the account portal and admin load the shared scripts', () => {
  const { FILES, DIRS } = require('../scripts/build_public');
  for (const f of PAGES) assert.ok(FILES.includes(f), f + ' in FILES');
  assert.ok(DIRS.includes('js'));
  const acc = doc('account.html');
  const srcs = [...acc.querySelectorAll('script[src]')].map((s) => s.getAttribute('src').split('?')[0]);
  assert.ok(srcs.indexOf('js/qr.js') >= 0 && srcs.indexOf('js/qr.js') < srcs.indexOf('js/account.js'));
  assert.ok(srcs.indexOf('js/csvkit.js') >= 0 && srcs.indexOf('js/csvkit.js') < srcs.indexOf('js/account.js'));
  assert.ok(!acc.querySelector('script:not([src])'), 'account.html has no inline script');
  const adm = doc('unonenginerrunon/index.html');
  const asrcs = [...adm.querySelectorAll('script[src]')].map((s) => s.getAttribute('src').split('?')[0]);
  for (const s of ['/js/qr.js', '/js/csvkit.js', '/unonenginerrunon/admin.js']) assert.ok(asrcs.includes(s), s);
  assert.ok(!adm.querySelector('script:not([src])'), 'admin page has no inline script');
});
