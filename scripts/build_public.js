/**
 * Vercel build step: copy only the website's public files into ./public.
 * Server code (lib/, api/, server.js), scripts, tests and docs are never published.
 *
 *   node scripts/build_public.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'public');

const FILES = ['index.html', '404.html', 'privacy.html', 'download.html', 'favicon.ico', 'manifest.json', 'robots.txt', 'sw.js', 'account.html', 'business.html', 'widget.html', 'developers.html'];
const DIRS_APP = 'app'; // tiny pages the mobile app loads to count installs / daily users
const DIRS = ['css', 'js', 'icons', 'data', 'unonenginerrunon', DIRS_APP];

function build() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of FILES) {
    const src = path.join(ROOT, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(OUT, f));
  }
  for (const d of DIRS) fs.cpSync(path.join(ROOT, d), path.join(OUT, d), { recursive: true });

  const indexPath = path.join(OUT, 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8').replace(/<span id="copyright-year">\d+<\/span>/, `<span id="copyright-year">${new Date().getFullYear()}</span>`);
  fs.writeFileSync(indexPath, html);

  // On-device OCR files for the scan button (from node_modules, never committed)
  const ocr = require('./ocr_assets').copy(OUT);
  console.log(`OCR: ${ocr.files} files in vendor/ocr`);
  // The service worker keeps the OCR files in their own cache: name it after the tesseract.js
  // version, so a package update gets fresh files and ordinary releases keep the old ones.
  if (ocr.version) {
    const swPath = path.join(OUT, 'sw.js');
    fs.writeFileSync(swPath, fs.readFileSync(swPath, 'utf8').replace(/'sasta-dawa-ocr-v1'/, `'sasta-dawa-ocr-${ocr.version}'`));
  }

  // Pages Google can index (one per brand and per formula) + sitemap.xml
  const seo = require('./build_seo').build(OUT);
  console.log(`SEO: ${seo.brands} brand pages, ${seo.formulas} formula pages, sitemap ${seo.urls} URLs`);

  let count = 0;
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : count++));
  walk(OUT);
  console.log(`Built public/ with ${count} files`);
  return OUT;
}

if (require.main === module) build();

module.exports = { build, FILES, DIRS };
