const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

test('Accessibility (a11y) & Lighthouse Audits Suite', async (t) => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../css/style.css'), 'utf8');
  const dom = new JSDOM(html);
  const { document } = dom.window;

  await t.test('1. Fix Search Input ARIA: combobox role for input with autocomplete dropdown', () => {
    const searchInput = document.getElementById('search-input');
    assert.ok(searchInput, '#search-input must exist');
    assert.strictEqual(searchInput.getAttribute('role'), 'combobox', '#search-input must have role="combobox"');
    assert.strictEqual(searchInput.getAttribute('aria-autocomplete'), 'list');
    assert.strictEqual(searchInput.getAttribute('aria-controls'), 'autocomplete-list');
    assert.strictEqual(searchInput.getAttribute('aria-expanded'), 'false');

    const dropdown = document.getElementById('autocomplete-list');
    assert.ok(dropdown, '#autocomplete-list dropdown container exists');
    assert.strictEqual(dropdown.getAttribute('role'), 'listbox');
  });

  await t.test('2. Fix Color Contrast in Footer & Breadcrumbs in CSS', () => {
    // Footer link color #CBD5E1
    assert.match(
      css,
      /\.footer-link\s*\{[^}]*color:\s*#CBD5E1/i,
      '.footer-link must have color: #CBD5E1'
    );

    // Footer col title color #F1F5F9
    assert.match(
      css,
      /\.footer-col-title\s*\{[^}]*color:\s*#F1F5F9/i,
      '.footer-col-title must have color: #F1F5F9'
    );

    // Footer text muted color #94A3B8
    assert.match(
      css,
      /\.footer-text-muted\s*\{[^}]*color:\s*#94A3B8/i,
      '.footer-text-muted must have color: #94A3B8'
    );

    // Breadcrumb link color #0369A1
    assert.match(
      css,
      /\.breadcrumb-link[^{]*\{[^}]*color:\s*#0369A1/i,
      '.breadcrumb-link must have color: #0369A1'
    );

    // Breadcrumb current label color #475569
    assert.match(
      css,
      /#breadcrumb-current-label[^{]*\{[^}]*color:\s*#475569/i,
      '#breadcrumb-current-label must have color: #475569'
    );
  });

  await t.test('3. Fix Button Accessible Names: 📍 emoji is wrapped in aria-hidden="true"', () => {
    const headerNearbyBtn = document.getElementById('header-nearby-btn');
    assert.ok(headerNearbyBtn, '#header-nearby-btn exists in DOM');

    const pinSpan = headerNearbyBtn.querySelector('span[aria-hidden="true"]');
    assert.ok(pinSpan, 'Emoji span with aria-hidden="true" exists inside #header-nearby-btn');
    assert.ok(pinSpan.textContent.includes('📍'), 'The 📍 emoji is inside the aria-hidden span');
  });

  await t.test('4. Fix Heading Hierarchy: #tips-section .tip-card headings are <h3> under <h2>', () => {
    const tipsSection = document.getElementById('tips-section');
    assert.ok(tipsSection, '#tips-section exists');

    const parentH2 = tipsSection.querySelector('h2');
    assert.ok(parentH2, 'Parent heading in tips section is an <h2>');

    const tipCards = tipsSection.querySelectorAll('.tip-card');
    assert.ok(tipCards.length > 0, '.tip-card components exist');

    // Ensure no <h4> exists in .tip-card
    const h4Headings = tipsSection.querySelectorAll('.tip-card h4');
    assert.strictEqual(h4Headings.length, 0, 'No <h4> tags should be used in .tip-card');

    // Ensure all .tip-card headings are <h3>
    const h3Headings = tipsSection.querySelectorAll('.tip-card h3');
    assert.strictEqual(h3Headings.length, tipCards.length, 'Every .tip-card has an <h3> heading');
  });
});
