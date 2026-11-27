/**
 * Mobile app build step. Two Android apps are built from the website files:
 *
 *   customer  → www/           pk.sastadawa.app       "Sasta Dawa Finder"
 *               home = index.html (medicine search), Account tab = bundled account.html
 *   business  → www-business/  pk.sastadawa.business  "Sasta Dawa for Pharmacies"
 *               home = account.html (index.html only redirects there),
 *               "Search medicines" = search.html (a copy of the main search page)
 *
 * Both bundle: the main search page, account.html (+ css/account.css, js/account.js, js/qr.js if
 * present), the legal pages that exist, css/, js/, icons/, data/ and the on-device OCR files.
 * Every bundled page gets <meta name="sd-app"> (which app) and <meta name="sd-pages"> (which pages
 * are local) for js/native.js, and loads js/native.js first.
 *
 * Differences from the website build (scripts/build_public.js):
 *  - no admin panel, service worker, sitemap, robots.txt or 404 page (the app bundles
 *    everything, so it works offline without a service worker)
 *  - the medicine data ships inside the app, so the first launch needs no download
 *  - no web analytics; API calls go to the live site (js/native.js)
 *
 * Android packaging (one Gradle project, productFlavors customer/business, android/app/build.gradle):
 *   node scripts/build_app.js                    # builds www/ and www-business/
 *   npx cap sync android                         # www/ → android/app/src/main/assets (customer flavor)
 *   node scripts/build_app.js --android-flavors  # www-business/ → android/app/src/business/assets
 * (`npm run app:sync:android` runs all three.)
 * iOS ships only the customer app (`npx cap sync ios` uses www/).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const APPS = {
  customer: { out: 'www', appId: 'pk.sastadawa.app', appName: 'Sasta Dawa Finder', scheme: 'sastadawa' },
  business: { out: 'www-business', appId: 'pk.sastadawa.business', appName: 'Sasta Dawa for Pharmacies', scheme: 'sastadawabiz' },
};

const FILES = ['index.html', 'favicon.ico', 'manifest.json'];
const DIRS = ['css', 'js', 'icons', 'data'];
/** Website pages bundled in both apps (name → name.html). account is required, the rest if present. */
const REQUIRED_PAGES = ['account'];
const OPTIONAL_PAGES = ['terms', 'privacy', 'refund', 'disclaimer', 'pharmacy-terms', 'delete-account'];

const ANDROID_APP = path.join(ROOT, 'android', 'app', 'src');

function nativeVersion(html) {
  const m = html.match(/js\/native\.js\?v=([\w.-]+)/);
  return m ? m[1] : '1';
}

/** Common changes for every page that goes into an app. */
function prepPage(html, { app, pages, isIndex, nativeV }) {
  let out = html
    .replace(/<span id="copyright-year">\d+<\/span>/, `<span id="copyright-year">${new Date().getFullYear()}</span>`)
    // The app has its own icon and splash screen; the web manifest only matters on the website.
    .replace(/\s*<link rel="manifest"[^>]*>/g, '')
    // Web analytics is for the website; the app counts installs/active users itself (js/native.js).
    .replace(/\s*<script data-sd-analytics[^>]*>[\s\S]*?<\/script>/g, '')
    .replace(/\s*<script>\s*window\.va\s*=\s*window\.va\s*\|\|[\s\S]*?<\/script>/g, '')
    .replace(/\s*<script[^>]*src="\/_vercel\/insights\/script\.js"[^>]*><\/script>/g, '');
  const metas = `\n  <meta name="sd-app" content="${app}">\n  <meta name="sd-pages" content="${pages.join(',')}">`;
  out = /<meta charset[^>]*>/i.test(out) ? out.replace(/(<meta charset[^>]*>)/i, `$1${metas}`) : out.replace(/<head[^>]*>/i, (h) => h + metas);
  if (!isIndex && !/js\/native\.js/.test(out)) {
    const tag = `<script src="js/native.js?v=${nativeV}"></script>`;
    // Before the page's first script file, so native.js sets things up before account.js runs.
    const i = out.search(/<script[^>]*\ssrc="\/?js\//);
    if (i >= 0) out = out.slice(0, i) + tag + '\n  ' + out.slice(i);
    else out = out.replace(/<\/body>/i, `  ${tag}\n</body>`);
  }
  return out;
}

/** Small start page of the business app: opens the account portal (keeps a deep-link hash). */
function businessIndex() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="sd-app" content="business">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${APPS.business.appName}</title>
  <style>html,body{margin:0;height:100%;background:#F6F5EF}@media (prefers-color-scheme: dark){html,body{background:#0F1210}}</style>
  <script>location.replace('account.html' + (location.hash && location.hash.length > 1 ? location.hash : '#/'));</script>
</head>
<body><noscript><a href="account.html">Open your account</a></noscript></body>
</html>
`;
}

function countFiles(dir) {
  let count = 0;
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : count++));
  walk(dir);
  return count;
}

/**
 * Build one app's web folder. Returns its absolute path.
 * @param {'customer'|'business'} [app]
 */
function build(app) {
  const which = app === 'business' ? 'business' : 'customer';
  const OUT = path.join(ROOT, APPS[which].out);
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of FILES) fs.copyFileSync(path.join(ROOT, f), path.join(OUT, f));
  for (const d of DIRS) fs.cpSync(path.join(ROOT, d), path.join(OUT, d), { recursive: true });

  const extra = OPTIONAL_PAGES.filter((p) => fs.existsSync(path.join(ROOT, p + '.html')));
  for (const p of REQUIRED_PAGES) if (!fs.existsSync(path.join(ROOT, p + '.html'))) throw new Error(`build_app: ${p}.html is missing`);
  const local = ['index', ...REQUIRED_PAGES, ...extra];
  if (which === 'business') local.push('search');

  const indexSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const nativeV = nativeVersion(indexSrc);
  const opts = { app: which, pages: local, nativeV };
  const mainPage = prepPage(indexSrc, { ...opts, isIndex: true });
  if (which === 'business') {
    fs.writeFileSync(path.join(OUT, 'search.html'), mainPage);
    fs.writeFileSync(path.join(OUT, 'index.html'), businessIndex());
  } else {
    fs.writeFileSync(path.join(OUT, 'index.html'), mainPage);
  }
  for (const p of [...REQUIRED_PAGES, ...extra]) {
    const src = fs.readFileSync(path.join(ROOT, p + '.html'), 'utf8');
    fs.writeFileSync(path.join(OUT, p + '.html'), prepPage(src, { ...opts, isIndex: false }));
  }

  // On-device OCR (scan button) ships inside the app so it works offline. The language file is
  // written un-gzipped (eng.traineddata): Android's packaging strips ".gz" from asset names.
  require('./ocr_assets').copy(OUT, { native: true });

  console.log(`Built ${APPS[which].out}/ (${which} app) with ${countFiles(OUT)} files; pages: ${local.join(', ')}`);
  return OUT;
}

function buildAll() {
  return { customer: build('customer'), business: build('business') };
}

/**
 * After `npx cap sync android` (which fills android/app/src/main/assets for the customer flavor),
 * give the business flavor its own web files and Capacitor config in android/app/src/business/assets.
 * The Gradle build uses src/main/assets only for `customer` and src/business/assets only for `business`.
 */
function androidFlavors() {
  const mainAssets = path.join(ANDROID_APP, 'main', 'assets');
  const mainCfg = path.join(mainAssets, 'capacitor.config.json');
  const mainPlugins = path.join(mainAssets, 'capacitor.plugins.json');
  if (!fs.existsSync(path.join(mainAssets, 'public', 'index.html')) || !fs.existsSync(mainCfg) || !fs.existsSync(mainPlugins)) {
    throw new Error('build_app --android-flavors: run `npx cap sync android` first (android/app/src/main/assets is empty)');
  }
  const bizWww = path.join(ROOT, APPS.business.out);
  if (!fs.existsSync(path.join(bizWww, 'account.html'))) build('business');

  const dest = path.join(ANDROID_APP, 'business', 'assets');
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(bizWww, path.join(dest, 'public'), { recursive: true });

  const cfg = JSON.parse(fs.readFileSync(mainCfg, 'utf8'));
  cfg.appId = APPS.business.appId;
  cfg.appName = APPS.business.appName;
  fs.writeFileSync(path.join(dest, 'capacitor.config.json'), JSON.stringify(cfg, null, '\t'));
  // Same native code in both flavors, so the same plugin list.
  fs.copyFileSync(mainPlugins, path.join(dest, 'capacitor.plugins.json'));
  console.log(`Android business flavor: ${countFiles(path.join(dest, 'public'))} web files → ${path.relative(ROOT, dest)}`);
  return dest;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  try {
    if (args.includes('--android-flavors')) androidFlavors();
    else if (args.includes('--business')) build('business');
    else if (args.includes('--customer')) build('customer');
    else buildAll();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

module.exports = { build, buildAll, androidFlavors, prepPage, APPS, FILES, DIRS, REQUIRED_PAGES, OPTIONAL_PAGES };
