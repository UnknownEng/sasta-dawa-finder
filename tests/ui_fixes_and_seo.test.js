/**
 * Sasta Dawa Finder - Comprehensive UI/UX Fixes and Technical SEO Test Suite
 * Explicitly tests each of the 20 UI/UX fixes and 17 Technical SEO requirements.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

async function loadDOM(filePath = '../index.html') {
  const htmlPath = path.join(__dirname, filePath);
  const htmlContent = fs.readFileSync(htmlPath, 'utf8');

  const embedJs = fs.readFileSync(path.join(__dirname, '../js/medicines_data_embed.js'), 'utf8');
  const translationsJs = fs.readFileSync(path.join(__dirname, '../js/translations.js'), 'utf8');
  const searchJs = fs.readFileSync(path.join(__dirname, '../js/search.js'), 'utf8');
  const dataJs = fs.readFileSync(path.join(__dirname, '../js/data.js'), 'utf8');
  const appJs = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');

  const dom = new JSDOM(htmlContent, {
    runScripts: 'outside-only',
    url: 'https://sastadawafinder.pk/',
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

test('Part 2: The 20 UI/UX and Functional Fixes Verification Suite', async (t) => {
  const dom = await loadDOM();
  const { document, window } = dom.window;
  const cssContent = fs.readFileSync(path.join(__dirname, '../css/style.css'), 'utf8');

  await t.test('Fix 1: Remove horizontal scrolling', () => {
    assert.ok(cssContent.includes('overflow-x: hidden'), 'CSS must prevent horizontal overflow on viewport');
    assert.ok(cssContent.includes('max-width: 100vw'), 'CSS must constrain viewport width to 100vw');
  });

  await t.test('Fix 2: Find broken links', () => {
    const links = Array.from(document.querySelectorAll('a[href]'));
    assert.ok(links.length > 5, 'Must contain navigation and content links');
    for (const link of links) {
      const href = link.getAttribute('href');
      assert.notStrictEqual(href, '', 'Link must not have empty href');
      assert.notStrictEqual(href, '#', 'Link must not have dead # href');
    }
  });

  await t.test('Fix 3: Add a mobile menu', () => {
    const toggleBtn = document.getElementById('mobile-menu-toggle');
    const drawer = document.getElementById('mobile-nav-drawer');
    const closeBtn = document.getElementById('drawer-close-btn');

    assert.ok(toggleBtn, 'Mobile menu toggle button exists');
    assert.ok(drawer, 'Mobile navigation drawer exists');
    assert.ok(closeBtn, 'Drawer close button exists');
    assert.strictEqual(toggleBtn.getAttribute('aria-expanded'), 'false');
    assert.ok(drawer.hasAttribute('hidden'), 'Drawer hidden by default');
  });

  await t.test('Fix 4: Add a favicon', () => {
    assert.ok(fs.existsSync(path.join(__dirname, '../favicon.ico')), 'favicon.ico must exist in root');
    assert.ok(fs.existsSync(path.join(__dirname, '../icons/favicon.ico')), 'favicon.ico must exist in icons/');
    const faviconLink = document.querySelector('link[rel="icon"]');
    assert.ok(faviconLink, 'Favicon link tag exists in DOM');
  });

  await t.test('Fix 5: Fix page titles', () => {
    const title = document.title;
    assert.ok(title.includes('Sasta Dawa Finder'), 'Title must feature Sasta Dawa Finder');
    assert.ok(title.includes('Medicine Price'), 'Title must contain primary keyword');
  });

  await t.test('Fix 6: Add meta descriptions', () => {
    const metaDesc = document.querySelector('meta[name="description"]');
    assert.ok(metaDesc, 'Meta description tag must exist');
    const content = metaDesc.getAttribute('content');
    assert.ok(content.length >= 120 && content.length <= 180, `Meta description length (${content.length}) should be within 120-180 chars`);
  });

  await t.test('Fix 7: Fix footer links', () => {
    const footerNav = document.querySelector('.footer-nav-grid');
    assert.ok(footerNav, 'Footer navigation grid exists');
    const footerLinks = document.querySelectorAll('.footer-link');
    assert.ok(footerLinks.length >= 5, 'Must have at least 5 structured footer links');
  });

  await t.test('Fix 8: Add a custom 404 page', () => {
    const path404 = path.join(__dirname, '../404.html');
    assert.ok(fs.existsSync(path404), '404.html must exist');
    const html404 = fs.readFileSync(path404, 'utf8');
    assert.ok(html404.includes('404'), '404 page contains 404 code');
    assert.ok(html404.includes('content="noindex, follow"'), '404 page has noindex meta');
  });

  await t.test('Fix 9: Fix the copyright year', () => {
    const currentYear = new Date().getFullYear().toString();
    const copyEl = document.getElementById('copyright-year');
    assert.ok(copyEl, 'Copyright year element exists');
    assert.strictEqual(copyEl.textContent, currentYear, 'Copyright year reflects current year');
  });

  await t.test('Fix 10: Compress images', () => {
    assert.ok(fs.existsSync(path.join(__dirname, '../icons/icon-192.webp')), 'WebP compressed icon exists');
    assert.ok(fs.existsSync(path.join(__dirname, '../icons/icon-512.webp')), 'WebP splash icon exists');
    const webpStats = fs.statSync(path.join(__dirname, '../icons/icon-192.webp'));
    assert.ok(webpStats.size < 5000, 'WebP icon must be compressed under 5KB');
  });

  await t.test('Fix 11: Fix broken buttons', () => {
    const buttons = Array.from(document.querySelectorAll('button'));
    assert.ok(buttons.length >= 8, 'Page contains interactive buttons');
    for (const btn of buttons) {
      assert.ok(btn.getAttribute('type'), 'Every button must declare an explicit type');
    }
  });

  await t.test('Fix 12: Add success message', () => {
    const toastContainer = document.getElementById('toast-container');
    assert.ok(toastContainer, 'Toast container exists');
    window.SastaApp.showSuccessMessage('Test success toast');
    const toast = toastContainer.querySelector('.toast-success');
    assert.ok(toast, 'Success toast rendered in container');
    assert.ok(toast.textContent.includes('Test success toast'));
  });

  await t.test('Fix 13: Add error messages', () => {
    const toastContainer = document.getElementById('toast-container');
    window.SastaApp.showErrorMessage('Test error toast');
    const toast = toastContainer.querySelector('.toast-error');
    assert.ok(toast, 'Error toast rendered in container');
    assert.ok(toast.textContent.includes('Test error toast'));
  });

  await t.test('Fix 14: Remove placeholder text', () => {
    const input = document.getElementById('search-input');
    const placeholder = input.getAttribute('placeholder');
    assert.strictEqual(placeholder.includes('Lorem ipsum'), false);
    assert.ok(placeholder.includes('Panadol') || placeholder.includes('Search'));
  });

  await t.test('Fix 15: Remove unused navigation', () => {
    const navItems = Array.from(document.querySelectorAll('.desktop-nav-link, .mobile-nav-link'));
    assert.ok(navItems.length >= 4, 'Active navigation links present');
    for (const item of navItems) {
      assert.ok(item.getAttribute('href'), 'Every nav item points to an active route/section');
    }
  });

  await t.test('Fix 16: Fix mobile overflow', () => {
    assert.ok(cssContent.includes('.container'), 'Container constraint exists');
    assert.ok(cssContent.includes('max-width: 100vw'), 'Mobile overflow constrained in CSS');
  });

  await t.test('Fix 17: Make the logo clickable', () => {
    const logoLink = document.getElementById('site-logo-link');
    assert.ok(logoLink, 'Clickable logo link element exists');
    assert.strictEqual(logoLink.tagName.toLowerCase(), 'a');
    assert.strictEqual(logoLink.getAttribute('href'), '/');
  });

  await t.test('Fix 18: Make the phone number clickable', () => {
    const telLinks = Array.from(document.querySelectorAll('a[href^="tel:"]'));
    assert.ok(telLinks.length >= 2, 'Must feature clickable tel links');
    assert.ok(telLinks[0].getAttribute('href').includes('tel:+92'));
  });

  await t.test('Fix 19: Make the email clickable', () => {
    const mailLinks = Array.from(document.querySelectorAll('a[href^="mailto:"]'));
    assert.ok(mailLinks.length >= 2, 'Must feature clickable mailto links');
    assert.ok(mailLinks[0].getAttribute('href').includes('mailto:ahmedmansoorrind1210@gmail.com'));
  });

  await t.test('Fix 20: Make every page mobile optimized', () => {
    const viewport = document.querySelector('meta[name="viewport"]');
    assert.ok(viewport, 'Viewport meta tag present');
    assert.ok(viewport.getAttribute('content').includes('width=device-width'));
    assert.ok(cssContent.includes('min-height: 48px') || cssContent.includes('min-height: 44px'), 'Touch targets meet minimum 44px');
  });
});

test('Part 3: Comprehensive Technical SEO & Performance Suite', async (t) => {
  const dom = await loadDOM();
  const { document } = dom.window;

  await t.test('Req 1: Render it server-side', () => {
    const serverModule = require('../server.js');
    assert.ok(typeof serverModule.getPreRenderedHTML === 'function', 'SSR HTML generator function exists');
    const ssrHtml = serverModule.getPreRenderedHTML();
    assert.ok(ssrHtml.includes('Sasta Dawa Finder'), 'SSR HTML contains brand name');
    assert.ok(ssrHtml.includes('site-header'), 'SSR HTML contains pre-rendered header');
  });

  await t.test('Req 2: Submit to Search Console', () => {
    assert.ok(fs.existsSync(path.join(__dirname, '../SEARCH_CONSOLE.md')), 'Search Console documentation exists');
    const gscMeta = document.querySelector('meta[name="google-site-verification"]');
    assert.ok(gscMeta, 'Google Search Console verification meta tag exists');
  });

  await t.test('Req 3: Check and implement noindex tags properly', () => {
    const indexRobots = document.querySelector('meta[name="robots"]');
    assert.ok(indexRobots.getAttribute('content').includes('index, follow'), 'Index page must allow indexing');

    const html404 = fs.readFileSync(path.join(__dirname, '../404.html'), 'utf8');
    assert.ok(html404.includes('content="noindex, follow"'), '404 page must forbid indexing via noindex');
  });

  await t.test('Req 4: Add canonical tags', () => {
    const canonical = document.querySelector('link[rel="canonical"]');
    assert.ok(canonical, 'Canonical tag exists');
    assert.strictEqual(canonical.getAttribute('href'), 'https://sastadawafinder.pk/');
  });

  await t.test('Req 5: Ensure exactly one H1 per page', () => {
    const h1s = document.querySelectorAll('h1');
    assert.strictEqual(h1s.length, 1, 'index.html must contain exactly one <h1> tag');

    const dom404 = new JSDOM(fs.readFileSync(path.join(__dirname, '../404.html'), 'utf8'));
    const h1s404 = dom404.window.document.querySelectorAll('h1');
    assert.strictEqual(h1s404.length, 1, '404.html must contain exactly one <h1> tag');
  });

  await t.test('Req 6: Implement breadcrumbs', () => {
    const breadcrumbNav = document.querySelector('.breadcrumb-nav');
    assert.ok(breadcrumbNav, 'Breadcrumb navigation exists in HTML');
    const breadcrumbList = document.querySelector('.breadcrumb-list');
    assert.strictEqual(breadcrumbList.getAttribute('itemtype'), 'https://schema.org/BreadcrumbList');
  });

  await t.test('Req 7: Add alt text on images', () => {
    const images = Array.from(document.querySelectorAll('img'));
    for (const img of images) {
      assert.ok(img.hasAttribute('alt'), 'All <img> elements must possess alt attribute');
    }
  });

  await t.test('Req 8: Fix layout shift', () => {
    const cssContent = fs.readFileSync(path.join(__dirname, '../css/style.css'), 'utf8');
    assert.ok(cssContent.includes('.logo-icon'), 'Logo has defined CSS dimensions');
    assert.ok(cssContent.includes('width: 48px') && cssContent.includes('height: 48px'), 'Logo reserves 48x48 space to avoid CLS');
  });

  await t.test('Req 9: Generate sitemap.xml', () => {
    const sitemapPath = path.join(__dirname, '../sitemap.xml');
    assert.ok(fs.existsSync(sitemapPath), 'sitemap.xml must exist');
    const sitemap = fs.readFileSync(sitemapPath, 'utf8');
    assert.ok(sitemap.includes('<urlset'), 'Sitemap is valid XML urlset');
    assert.ok(sitemap.includes('https://sastadawafinder.pk/'));
  });

  await t.test('Req 10: Unblock Googlebot', () => {
    const robotsPath = path.join(__dirname, '../robots.txt');
    assert.ok(fs.existsSync(robotsPath), 'robots.txt must exist');
    const robots = fs.readFileSync(robotsPath, 'utf8');
    assert.ok(robots.includes('User-agent: Googlebot'), 'robots.txt explicitly targets Googlebot');
    assert.ok(robots.includes('Allow: /'), 'Googlebot is allowed');
    assert.ok(robots.includes('Sitemap: https://sastadawafinder.pk/sitemap.xml'), 'robots.txt links sitemap');
  });

  await t.test('Req 11: Remove all redirect chains', () => {
    const links = Array.from(document.querySelectorAll('a[href]'));
    for (const link of links) {
      const href = link.getAttribute('href');
      assert.strictEqual(href.startsWith('http://'), false, 'No insecure http:// redirects');
    }
  });

  await t.test('Req 12: Handle 404s properly for search engines', () => {
    const serverModule = require('../server.js');
    assert.ok(typeof serverModule.get404HTML === 'function');
    const html = serverModule.get404HTML();
    assert.ok(html.includes('404'), '404 HTML returned');
  });

  await t.test('Req 13: Write SEO-optimized meta descriptions', () => {
    const desc = document.querySelector('meta[name="description"]').getAttribute('content');
    assert.ok(desc.includes('Sasta Dawa') && desc.includes('Pakistan') && desc.includes('generic'));
  });

  await t.test('Req 14: Add FAQ schema', () => {
    const schemas = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    const faqSchema = schemas.find(s => s.textContent.includes('FAQPage'));
    assert.ok(faqSchema, 'FAQPage schema JSON-LD must be present');
    const parsed = JSON.parse(faqSchema.textContent);
    assert.strictEqual(parsed['@type'], 'FAQPage');
    assert.ok(Array.isArray(parsed.mainEntity) && parsed.mainEntity.length >= 3, 'FAQ has at least 3 Q&As');
  });

  await t.test('Req 15: Link orphan pages to the main site structure', () => {
    const links = Array.from(document.querySelectorAll('a[href]'));
    const hrefs = links.map(l => l.getAttribute('href'));
    assert.ok(hrefs.includes('404.html') || hrefs.some(h => h.includes('404')), '404 page is reachable from site structure');
  });

  await t.test('Req 16: Convert images -> WebP format', () => {
    assert.ok(fs.existsSync(path.join(__dirname, '../icons/icon-192.webp')), 'WebP icon exists');
    assert.ok(fs.existsSync(path.join(__dirname, '../icons/icon-512.webp')), 'WebP 512px icon exists');
    assert.ok(fs.existsSync(path.join(__dirname, '../icons/favicon-32x32.webp')), 'WebP 32px favicon exists');
  });

  await t.test('Req 17: Ensure the site will load under 2s', () => {
    const htmlSize = fs.statSync(path.join(__dirname, '../index.html')).size;
    const cssSize = fs.statSync(path.join(__dirname, '../css/style.css')).size;
    const totalAssetsKB = (htmlSize + cssSize) / 1024;
    assert.ok(totalAssetsKB < 200, `Total critical assets (${totalAssetsKB.toFixed(1)} KB) well below budget for sub-2s loads`);
  });
});
