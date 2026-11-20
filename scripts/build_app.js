/**
 * Mobile app build step: copy the website files the Android/iOS app needs into ./www,
 * which Capacitor packs into the app (`npx cap sync`).
 *
 * Differences from the website build (scripts/build_public.js):
 *  - no admin panel, service worker, sitemap, robots.txt or 404 page (the app bundles
 *    everything, so it works offline without a service worker)
 *  - the medicine data ships inside the app, so the first launch needs no download
 *  - API calls (AI chat, feedback, site settings) go to the live site, see js/native.js
 *
 *   node scripts/build_app.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'www');

const FILES = ['index.html', 'favicon.ico', 'manifest.json'];
const DIRS = ['css', 'js', 'icons', 'data'];

function build() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of FILES) fs.copyFileSync(path.join(ROOT, f), path.join(OUT, f));
  for (const d of DIRS) fs.cpSync(path.join(ROOT, d), path.join(OUT, d), { recursive: true });

  const indexPath = path.join(OUT, 'index.html');
  const html = fs
    .readFileSync(indexPath, 'utf8')
    .replace(/<span id="copyright-year">\d+<\/span>/, `<span id="copyright-year">${new Date().getFullYear()}</span>`)
    // The app has its own icon and splash screen; the web manifest only matters on the website.
    .replace(/\s*<link rel="manifest"[^>]*>/, '')
    // Web analytics is for the website; the app counts installs/active users itself (js/native.js).
    .replace(/\s*<script data-sd-analytics[^>]*>[\s\S]*?<\/script>/g, '');
  fs.writeFileSync(indexPath, html);

  let count = 0;
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : count++));
  walk(OUT);
  console.log(`Built www/ with ${count} files`);
  return OUT;
}

if (require.main === module) build();

module.exports = { build, FILES, DIRS };
