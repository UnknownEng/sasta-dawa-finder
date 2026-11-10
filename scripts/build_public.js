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

const FILES = ['index.html', '404.html', 'favicon.ico', 'manifest.json', 'robots.txt', 'sitemap.xml', 'sw.js'];
const DIRS = ['css', 'js', 'icons', 'data', 'unonenginerrunon'];

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

  let count = 0;
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : count++));
  walk(OUT);
  console.log(`Built public/ with ${count} files`);
  return OUT;
}

if (require.main === module) build();

module.exports = { build, FILES, DIRS };
