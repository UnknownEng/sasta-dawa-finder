const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const i18n = require('../js/translations.js');

test('Urdu UI Mode & Internationalization Test Suite', async (t) => {
  await t.test('i18n module translates English and Urdu correctly', () => {
    i18n.setLanguage('en');
    assert.strictEqual(i18n.getLanguage(), 'en');
    assert.strictEqual(i18n.t('search_button'), 'Search');

    i18n.setLanguage('ur');
    assert.strictEqual(i18n.getLanguage(), 'ur');
    assert.strictEqual(i18n.t('search_button'), 'تلاش کریں');
    assert.strictEqual(i18n.t('cat_pain'), 'درد اور بخار');

    // Parameter substitution
    const formatted = i18n.t('spotlight_title', { percent: 45 });
    assert.ok(formatted.includes('45%'));
    assert.ok(formatted.includes('بچت'));
  });

  await t.test('DOM language switcher toggles RTL direction and Urdu text', async () => {
    const htmlContent = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    const embedJs = fs.readFileSync(path.join(__dirname, '../js/medicines_data_embed.js'), 'utf8');
    const translationsJs = fs.readFileSync(path.join(__dirname, '../js/translations.js'), 'utf8');
    const searchJs = fs.readFileSync(path.join(__dirname, '../js/search.js'), 'utf8');
    const dataJs = fs.readFileSync(path.join(__dirname, '../js/data.js'), 'utf8');
    const appJs = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');

    const dom = new JSDOM(htmlContent, {
      runScripts: 'outside-only',
      url: 'http://localhost/',
    });

    const { window } = dom;
    window.scrollTo = () => {};
    window.eval(embedJs);
    window.eval(translationsJs);
    window.eval(searchJs);
    window.eval(dataJs);
    window.eval(appJs);

    if (window.__APP_INIT_PROMISE__) {
      await window.__APP_INIT_PROMISE__;
    }

    const { document } = window;
    const langUrBtn = document.getElementById('lang-ur-btn');
    const langEnBtn = document.getElementById('lang-en-btn');
    const searchInput = document.getElementById('search-input');
    const searchBtn = document.getElementById('search-btn');

    // Default starts as LTR / English
    assert.strictEqual(document.documentElement.getAttribute('dir'), 'ltr');
    assert.strictEqual(document.documentElement.getAttribute('lang'), 'en');

    // Switch to Urdu
    langUrBtn.click();

    // Verify RTL & Urdu attributes
    assert.strictEqual(document.documentElement.getAttribute('dir'), 'rtl');
    assert.strictEqual(document.documentElement.getAttribute('lang'), 'ur');
    assert.ok(langUrBtn.classList.contains('active'));
    assert.strictEqual(langEnBtn.classList.contains('active'), false);

    // Verify UI strings translated to Urdu
    assert.strictEqual(searchBtn.textContent, 'تلاش کریں');
    assert.ok(searchInput.getAttribute('placeholder').includes('دوا کا نام'));
    assert.ok(document.getElementById('site-title-el').textContent.includes('سستی دوا تلاش کار'));

    // Verify disclaimer in Urdu
    const disclaimer = document.getElementById('disclaimer-text-el');
    assert.ok(disclaimer.textContent.includes('اہم طبی انتباہ:'));
    assert.ok(disclaimer.textContent.includes('ڈاکٹر یا فارماسسٹ سے ضرور مشورہ کریں'));

    // Verify Category pills rendered in Urdu
    const catPills = Array.from(document.querySelectorAll('#category-pills-container .cat-pill'));
    assert.ok(catPills.some(p => p.textContent.includes('درد اور بخار')));
    assert.ok(catPills.some(p => p.textContent.includes('معدہ اور تیزابیت')));

    // Switch back to English
    langEnBtn.click();
    assert.strictEqual(document.documentElement.getAttribute('dir'), 'ltr');
    assert.strictEqual(document.documentElement.getAttribute('lang'), 'en');
    assert.strictEqual(searchBtn.textContent, 'Search');
    assert.ok(
      searchInput.getAttribute('placeholder').includes('Panadol') ||
      searchInput.getAttribute('placeholder').includes('medicine')
    );
  });
});
