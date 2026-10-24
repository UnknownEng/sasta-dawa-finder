const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

async function createDOM() {
  const htmlPath = path.join(__dirname, '../index.html');
  const htmlContent = fs.readFileSync(htmlPath, 'utf8');

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

  return dom;
}

test('WhatsApp Sharing Suite', async (t) => {
  await t.test('Spotlight renders WhatsApp share button with encoded message and disclaimer in English', async () => {
    const dom = await createDOM();
    const { document } = dom.window;

    const searchInput = document.getElementById('search-input');
    const searchBtn = document.getElementById('search-btn');
    searchInput.value = 'Panadol';
    searchBtn.click();

    // Verify WhatsApp button in Savings Spotlight
    const spotlightBtn = document.querySelector('#savings-spotlight .whatsapp-share-btn');
    assert.ok(spotlightBtn, 'Spotlight must contain WhatsApp share button');

    const href = spotlightBtn.getAttribute('href');
    assert.ok(href.startsWith('https://api.whatsapp.com/send?text='), 'Must be WhatsApp API share link');

    const rawText = decodeURIComponent(href.replace('https://api.whatsapp.com/send?text=', ''));
    assert.ok(rawText.includes('Sasta Dawa Finder (Pakistan)'));
    assert.ok(rawText.includes('Panadol'));
    assert.ok(rawText.includes('Paracetamol 500mg'));
    assert.ok(rawText.includes('Save up to'));
    assert.ok(rawText.includes('Always confirm with your doctor or licensed pharmacist'));
  });

  await t.test('Spotlight renders WhatsApp share message in Urdu when Urdu mode is active', async () => {
    const dom = await createDOM();
    const { document } = dom.window;

    // Switch to Urdu
    const langUrBtn = document.getElementById('lang-ur-btn');
    langUrBtn.click();

    const searchInput = document.getElementById('search-input');
    const searchBtn = document.getElementById('search-btn');
    searchInput.value = 'Panadol';
    searchBtn.click();

    const spotlightBtn = document.querySelector('#savings-spotlight .whatsapp-share-btn');
    assert.ok(spotlightBtn, 'Spotlight must have WhatsApp share button in Urdu mode');

    const href = spotlightBtn.getAttribute('href');
    const rawText = decodeURIComponent(href.replace('https://api.whatsapp.com/send?text=', ''));
    assert.ok(rawText.includes('سستی دوا تلاش کار'));
    assert.ok(rawText.includes('اصل دوا:'));
    assert.ok(rawText.includes('سستا متبادل:'));
    assert.ok(rawText.includes('بچت:'));
    assert.ok(rawText.includes('ڈاکٹر یا فارماسسٹ سے ضرور مشورہ کریں'));
  });

  await t.test('Cheaper alternative cards have WhatsApp share button', async () => {
    const dom = await createDOM();
    const { document } = dom.window;

    const searchInput = document.getElementById('search-input');
    const searchBtn = document.getElementById('search-btn');
    searchInput.value = 'Panadol';
    searchBtn.click();

    const miniBtns = document.querySelectorAll('#alternatives-list .whatsapp-share-btn-mini');
    assert.ok(miniBtns.length > 0, 'Cheaper alternative cards should have mini WhatsApp buttons');

    const firstHref = miniBtns[0].getAttribute('href');
    assert.ok(firstHref.startsWith('https://api.whatsapp.com/send?text='));
  });
});
