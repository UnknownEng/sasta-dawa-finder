const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

async function createDOM() {
  const htmlPath = path.join(__dirname, '../index.html');
  const htmlContent = fs.readFileSync(htmlPath, 'utf8');

  // Load scripts
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

  // Polyfill scrollTo
  window.scrollTo = () => {};

  // Execute scripts in window context
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

test('UI DOM & Integration Tests', async (t) => {
  await t.test('Page initializes with disclaimer, search bar, and popular medicines', async () => {
    const dom = await createDOM();
    const { document } = dom.window;

    // Check disclaimer
    const disclaimer = document.querySelector('.disclaimer-card');
    assert.ok(disclaimer, 'Disclaimer card must exist in DOM');
    assert.ok(
      disclaimer.textContent.includes('Prices and information are approximate and for general awareness only'),
      'Disclaimer text must match required wording'
    );

    // Check search input
    const searchInput = document.getElementById('search-input');
    assert.ok(searchInput, 'Search input exists');

    // Check popular medicines grid populated
    const popularCards = document.querySelectorAll('.popular-card');
    assert.ok(popularCards.length >= 6, `Expected >= 6 popular cards, found ${popularCards.length}`);
  });

  await t.test('Results Display: Medicine WITH alternatives (Panadol 500mg)', async () => {
    const dom = await createDOM();
    const { document } = dom.window;

    const searchInput = document.getElementById('search-input');
    const searchBtn = document.getElementById('search-btn');

    // Search Panadol
    searchInput.value = 'Panadol';
    searchBtn.click();

    // Verify Results View is visible
    const resultsView = document.getElementById('results-view');
    assert.ok(resultsView.classList.contains('active'), 'Results view should be active');

    // Verify Selected Medicine Card
    const medCard = document.getElementById('selected-medicine-card');
    assert.ok(medCard.textContent.includes('Panadol'), 'Should show brand name Panadol');
    assert.ok(medCard.textContent.includes('Paracetamol'), 'Should show generic formula Paracetamol');
    assert.ok(medCard.textContent.includes('500mg'), 'Should show strength 500mg');
    assert.ok(medCard.textContent.includes('GSK Pakistan'), 'Should show manufacturer');

    // Verify Savings Spotlight is displayed
    const spotlight = document.getElementById('savings-spotlight');
    assert.strictEqual(spotlight.style.display, 'flex', 'Savings spotlight should be visible');
    assert.ok(spotlight.textContent.includes('Save up to'), 'Spotlight should mention savings percentage');

    // Verify Alternatives list
    const altToolbar = document.getElementById('alternatives-toolbar');
    assert.strictEqual(altToolbar.style.display, 'flex', 'Toolbar should be visible');

    const altCards = document.querySelectorAll('#alternatives-list .alt-card');
    assert.ok(altCards.length >= 3, `Expected multiple alternative cards, found ${altCards.length}`);

    // Verify zero-alternatives card is hidden
    const zeroCard = document.getElementById('zero-alternatives-card');
    assert.strictEqual(zeroCard.style.display, 'none');
  });

  await t.test('Results Display: Medicine with NO alternatives found (Spiriva Respimat)', async () => {
    const dom = await createDOM();
    const { document } = dom.window;

    const searchInput = document.getElementById('search-input');
    const searchBtn = document.getElementById('search-btn');

    // Search Spiriva Respimat (unique formulation in dataset)
    searchInput.value = 'Spiriva Respimat';
    searchBtn.click();

    const resultsView = document.getElementById('results-view');
    assert.ok(resultsView.classList.contains('active'));

    // Check selected medicine
    const medCard = document.getElementById('selected-medicine-card');
    assert.ok(medCard.textContent.includes('Spiriva Respimat'));
    assert.ok(medCard.textContent.includes('Approx. Estimate'), 'Should display estimate badge');

    // Check savings spotlight is hidden
    const spotlight = document.getElementById('savings-spotlight');
    assert.strictEqual(spotlight.style.display, 'none');

    // Check alternatives toolbar is hidden
    const altToolbar = document.getElementById('alternatives-toolbar');
    assert.strictEqual(altToolbar.style.display, 'none');

    // Check zero-alternatives card is visible and has informative message
    const zeroCard = document.getElementById('zero-alternatives-card');
    assert.strictEqual(zeroCard.style.display, 'block', 'Zero alternatives card must be visible');
    assert.ok(zeroCard.textContent.includes('No Cheaper Generic Alternatives Found'));
    assert.ok(
      zeroCard.textContent.includes('Please ask your doctor or pharmacist') ||
      zeroCard.textContent.includes('Please consult your physician or pharmacist')
    );
  });

  await t.test('Sorting by price (cheapest first): DOM order verification', async () => {
    const dom = await createDOM();
    const { document } = dom.window;

    const searchInput = document.getElementById('search-input');
    const searchBtn = document.getElementById('search-btn');
    const sortSelect = document.getElementById('sort-select');

    searchInput.value = 'Risek 20';
    searchBtn.click();

    // Default is price_asc (Cheapest first)
    assert.strictEqual(sortSelect.value, 'price_asc');

    const altCards = Array.from(document.querySelectorAll('#alternatives-list .alt-card'));
    assert.ok(altCards.length >= 3);

    // Extract unit prices from rendered cards
    const unitPrices = altCards.map(card => {
      const priceText = card.querySelector('.alt-unit-price').textContent;
      const match = priceText.match(/PKR\s+([\d.]+)/);
      return match ? parseFloat(match[1]) : 0;
    });

    for (let i = 0; i < unitPrices.length - 1; i++) {
      assert.ok(
        unitPrices[i] <= unitPrices[i + 1],
        `DOM sort order failed: index ${i} (${unitPrices[i]}) > index ${i + 1} (${unitPrices[i + 1]})`
      );
    }

    // Switch sort order to price_desc (Highest first)
    sortSelect.value = 'price_desc';
    sortSelect.dispatchEvent(new dom.window.Event('change'));

    const descCards = Array.from(document.querySelectorAll('#alternatives-list .alt-card'));
    const descPrices = descCards.map(card => {
      const priceText = card.querySelector('.alt-unit-price').textContent;
      const match = priceText.match(/PKR\s+([\d.]+)/);
      return match ? parseFloat(match[1]) : 0;
    });

    for (let i = 0; i < descPrices.length - 1; i++) {
      assert.ok(
        descPrices[i] >= descPrices[i + 1],
        `Desc sort order failed: index ${i} (${descPrices[i]}) < index ${i + 1} (${descPrices[i + 1]})`
      );
    }
  });

  await t.test('Mobile Responsiveness: Structure, Viewport, and Breakpoint rules', () => {
    const htmlContent = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    const cssContent = fs.readFileSync(path.join(__dirname, '../css/style.css'), 'utf8');

    // 1. Meta viewport present with proper parameters
    assert.ok(
      htmlContent.includes('<meta name="viewport" content="width=device-width, initial-scale=1.0'),
      'HTML must contain standard responsive mobile viewport tag'
    );

    // 2. CSS contains media queries for mobile
    assert.ok(cssContent.includes('@media (max-width: 640px)'), 'CSS must include mobile breakpoint media query');

    // 3. Check mobile adjustments in CSS
    assert.ok(cssContent.includes('.medicine-header {'), 'Contains header layout styling');
    assert.ok(cssContent.includes('.search-input'), 'Contains responsive search input styling');
    assert.ok(cssContent.includes('.quick-pills-section'), 'Contains flexible pill button container');
  });

  await t.test('Error Handling: Gibberish, special characters, and long strings', async () => {
    const dom = await createDOM();
    const { document } = dom.window;

    const searchInput = document.getElementById('search-input');
    const searchBtn = document.getElementById('search-btn');
    const noResultsView = document.getElementById('no-results-view');
    const resultsView = document.getElementById('results-view');

    // Case 1: Gibberish
    searchInput.value = 'zzxxyyzzwontfindthis';
    searchBtn.click();
    assert.strictEqual(noResultsView.style.display, 'block');
    assert.strictEqual(resultsView.classList.contains('active'), false);
    assert.ok(noResultsView.textContent.includes('No Medicine Found'));

    // Case 2: Special characters & potential injection
    const initialScriptCount = document.querySelectorAll('script').length;
    searchInput.value = '"><script>alert(1)</script>';
    searchBtn.click();
    assert.strictEqual(noResultsView.style.display, 'block');
    // Ensure script was not injected as DOM element
    assert.strictEqual(document.querySelectorAll('script').length, initialScriptCount, 'No injected script tag should execute');


    // Case 3: Very long string
    searchInput.value = 'Panadol'.repeat(100);
    searchBtn.click();
    assert.strictEqual(noResultsView.style.display, 'block');
  });

  await t.test('Final Full Run-Through: Simulate 5 realistic Pakistani user searches', async () => {
    const dom = await createDOM();
    const { document } = dom.window;

    const searchInput = document.getElementById('search-input');
    const searchBtn = document.getElementById('search-btn');

    // User Search 1: Common painkiller "Panadol"
    searchInput.value = 'Panadol';
    searchBtn.click();
    assert.ok(document.getElementById('selected-medicine-card').textContent.includes('Panadol'));
    assert.ok(document.getElementById('alternatives-list').children.length >= 3);
    assert.ok(document.getElementById('savings-spotlight').textContent.includes('Save up to'));

    // User Search 2: Acid reflux / PPI "Risek"
    searchInput.value = 'Risek';
    searchBtn.click();
    assert.ok(document.getElementById('selected-medicine-card').textContent.includes('Risek 20'));
    assert.ok(document.getElementById('selected-medicine-card').textContent.includes('Omeprazole'));
    assert.ok(document.getElementById('alternatives-list').children.length >= 4);

    // User Search 3: Common antibiotic "Augmentin"
    searchInput.value = 'Augmentin';
    searchBtn.click();
    assert.ok(document.getElementById('selected-medicine-card').textContent.includes('Augmentin'));
    assert.ok(document.getElementById('selected-medicine-card').textContent.includes('Co-Amoxiclav'));
    assert.ok(document.getElementById('alternatives-list').children.length >= 2);


    // User Search 4: High blood pressure medication "Norvasc" (Amlodipine)
    searchInput.value = 'Norvasc';
    searchBtn.click();
    assert.ok(document.getElementById('selected-medicine-card').textContent.includes('Norvasc 5'));
    assert.ok(document.getElementById('selected-medicine-card').textContent.includes('Amlodipine'));
    assert.ok(document.getElementById('alternatives-list').children.length >= 3);

    // User Search 5: Allergy medication "Softin" (Loratadine)
    searchInput.value = 'Softin';
    searchBtn.click();
    assert.ok(document.getElementById('selected-medicine-card').textContent.includes('Softin 10'));
    assert.ok(document.getElementById('selected-medicine-card').textContent.includes('Loratadine'));
    assert.ok(document.getElementById('alternatives-list').children.length >= 2);
  });
});
