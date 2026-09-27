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

test('UI Plain Language, Branding & Responsiveness Suite', async (t) => {
  await t.test('Footer branding and dynamic copyright requirements', async () => {
    const dom = await createDOM();
    const { document } = dom.window;

    // 1. Branding text: "Made by Aeromaverick Technologies"
    const brandingCard = document.querySelector('.footer-branding-card');
    assert.ok(brandingCard, 'Footer branding card exists');
    assert.ok(
      brandingCard.textContent.includes('Made by Aeromaverick Technologies'),
      'Must contain "Made by Aeromaverick Technologies"'
    );

    // 2. Copyright notice: "© [YEAR] Aeromaverick Technologies. All rights reserved."
    const copyrightRow = document.querySelector('.footer-copyright-row');
    assert.ok(copyrightRow, 'Footer copyright row exists');
    assert.ok(copyrightRow.textContent.includes('Aeromaverick Technologies'));
    assert.ok(copyrightRow.textContent.includes('All rights reserved.'));

    const currentYear = new Date().getFullYear().toString();
    const copyrightYearEl = document.getElementById('copyright-year');
    assert.strictEqual(
      copyrightYearEl.textContent,
      currentYear,
      'Copyright year must dynamically reflect current year'
    );

    // 3. Distinct separation from medical disclaimer
    const disclaimerCard = document.querySelector('.footer-disclaimer-card');
    assert.ok(disclaimerCard, 'Footer disclaimer card exists separately');
    assert.ok(
      disclaimerCard.textContent.includes('Medical Disclaimer') ||
      disclaimerCard.textContent.includes('Prices and information are approximate')
    );

    // Check that disclaimer and branding are separate sibling elements
    assert.notStrictEqual(disclaimerCard, brandingCard);
    assert.notStrictEqual(disclaimerCard, copyrightRow);
    assert.notStrictEqual(brandingCard, copyrightRow);
  });

  await t.test('Plain language verification: No jargon or "Formula ID"', async () => {
    const dom = await createDOM();
    const { document } = dom.window;

    // Search for a common medicine
    const searchInput = document.getElementById('search-input');
    const searchBtn = document.getElementById('search-btn');
    searchInput.value = 'Panadol';
    searchBtn.click();

    const selectedMedCard = document.getElementById('selected-medicine-card');
    const cardText = selectedMedCard.textContent;

    // Technical jargon must be removed
    assert.strictEqual(
      cardText.includes('Formula ID'),
      false,
      'Card must NOT display technical "Formula ID"'
    );
    assert.strictEqual(
      cardText.includes('formula_id'),
      false,
      'Card must NOT display technical "formula_id"'
    );

    // Plain language replacements must be present
    assert.ok(
      cardText.includes('Contains (Main Ingredient):') || cardText.includes('Main Ingredient'),
      'Must use plain language "Contains (Main Ingredient)"'
    );
    assert.ok(cardText.includes('Type'), 'Must use "Type" instead of dosage form jargon');
    assert.ok(cardText.includes('Company'), 'Must use "Company" instead of manufacturer jargon');
    assert.ok(cardText.includes('Used For'), 'Must use "Used For" instead of therapeutic category jargon');
  });

  await t.test('Visual clarity and non-color-reliant savings indicators', async () => {
    const dom = await createDOM();
    const { document } = dom.window;

    const searchInput = document.getElementById('search-input');
    const searchBtn = document.getElementById('search-btn');
    searchInput.value = 'Panadol';
    searchBtn.click();

    // Check Savings Spotlight visibility and text
    const spotlight = document.getElementById('savings-spotlight');
    assert.strictEqual(spotlight.style.display, 'flex');
    assert.ok(
      spotlight.textContent.includes('Save up to'),
      'Spotlight must prominently highlight savings percentage'
    );

    // Check alternative cards for non-color-reliant cues
    const altCards = document.querySelectorAll('#alternatives-list .alt-card');
    assert.ok(altCards.length > 0);

    const firstCard = altCards[0];
    const savingsTag = firstCard.querySelector('.savings-tag');
    assert.ok(savingsTag, 'Alternative card has savings tag');
    
    // Non-color-reliant wording check: words like "CHEAPER", "SAME PRICE", or "HIGHER"
    const tagText = savingsTag.textContent;
    const hasExplicitWord =
      tagText.includes('CHEAPER') ||
      tagText.includes('SAME PRICE') ||
      tagText.includes('HIGHER PRICE');
    assert.ok(
      hasExplicitWord,
      `Savings tag must contain explicit text cue (not color alone), got: ${tagText}`
    );
  });

  await t.test('Responsive CSS styles at multiple device breakpoints', () => {
    const cssPath = path.join(__dirname, '../css/style.css');
    const cssContent = fs.readFileSync(cssPath, 'utf8');

    // Viewport meta check in HTML
    const htmlPath = path.join(__dirname, '../index.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
    assert.ok(
      htmlContent.includes('<meta name="viewport" content="width=device-width, initial-scale=1.0'),
      'Mobile viewport meta tag must be present'
    );

    // Mobile touch target checks (>= 48px or 44px min-height)
    assert.ok(
      cssContent.includes('min-height: 48px') || cssContent.includes('min-height: 52px'),
      'Touch-friendly interactive buttons must have >= 48px min-height'
    );

    // Breakpoint checks in style.css
    // Mobile (< 640px)
    assert.ok(cssContent.includes('@media (max-width: 640px)'), 'Mobile breakpoint rule must exist');
    // Tablet (< 768px or max-width 768px/900px)
    assert.ok(
      cssContent.includes('max-width: 768px') || cssContent.includes('max-width: 900px'),
      'Tablet / medium screen layout rules must exist'
    );
    // Large screens container rule
    assert.ok(cssContent.includes('.container'), 'Container constraint for desktop must exist');
    assert.ok(cssContent.includes('max-width: 960px') || cssContent.includes('max-width: 1100px') || cssContent.includes('max-width: 1200px'));
  });
});
