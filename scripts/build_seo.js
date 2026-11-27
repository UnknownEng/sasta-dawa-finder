/**
 * Search-engine pages: plain HTML that Google can index, built from the DRAP dataset.
 *
 * The app itself is one page with hash routes (#/medicine/...), and Google ignores everything
 * after a "#", so on its own the site shows Google exactly one page. This step writes:
 *
 *   /dawa/<brand>        one page per brand: every strength/pack, its DRAP price and the
 *                        cheaper same-formula brands          (~9,800 pages)
 *   /formula/<salt>      one page per active ingredient: all brands compared  (~1,900 pages)
 *   /browse/<letter>     A-Z lists that link every brand page (so crawlers find them)
 *   /formula             A-Z list of every formula page
 *   /sitemap.xml         every URL above
 *
 * Pages are served without ".html" (cleanUrls in vercel.json).
 *
 *   node scripts/build_seo.js [outDir]      (build_public.js calls build(outDir))
 */
'use strict';

const fs = require('fs');
const path = require('path');
const D = require('../js/data.js');
const S = require('../js/search.js');

const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://sasta-dawa-finder.vercel.app';
const APK = '/download'; // counts the click in Vercel Analytics, then starts the APK download

// Same list the app warns on (js/app.js): switching brand needs a doctor.
const NARROW_THERAPEUTIC = /levothyroxine|thyroxine|warfarin|phenytoin|carbamazepine|valpro|lithium|digoxin|tacrolimus|ciclosporin|cyclosporine|amiodarone|lamotrigine|levetiracetam|clozapine|theophylline|methotrexate/i;

// Version each file by its content, so browsers (and the site's offline cache) fetch the new
// file the moment it changes instead of showing an old copy.
function ver(rel) {
  return require('crypto').createHash('sha1').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex').slice(0, 8);
}
const CSS_V = ver('css/seo.css');
const JS_V = ver('js/seo-search.js');
const ANALYTICS = `<script>window.va=window.va||function(){(window.vaq=window.vaq||[]).push(arguments)};</script>
<script defer src="/_vercel/insights/script.js"></script>`;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
function rs(n) {
  if (n == null || isNaN(n)) return '–';
  const v = Number(n);
  return 'Rs ' + (v >= 100 ? v.toLocaleString('en-PK', { maximumFractionDigits: 0 }) : v.toFixed(2));
}
function unitWord(m) {
  if (m.unit === 'unit') {
    if (/capsule/i.test(m.form)) return 'capsule';
    if (/sachet/i.test(m.form)) return 'sachet';
    if (/suppositor/i.test(m.form)) return 'suppository';
    return 'tablet';
  }
  if (m.unit === 'dose') return 'dose';
  return m.unit || 'unit';
}
// Plain pack words, as on the app's medicine page: "200 tablets" rather than "200's".
function packText(m) {
  if (m.unit === 'unit' && m.units > 0 && Number.isInteger(m.units)) {
    const w = unitWord(m);
    return m.units + ' ' + (m.units === 1 ? w : w === 'suppository' ? 'suppositories' : w + 's');
  }
  return m.pack || m.form || '';
}
// "Panadol 500mg", like medTitle() in js/app.js
function medTitle(m) {
  return m.name + (m.strength && !m.name.includes(m.strength) ? ' ' + m.strength : '');
}
const appLink = (m) => '/#/medicine/' + encodeURIComponent(m.id);
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00Z');
  return isNaN(d) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
function mostCommon(list) {
  const c = new Map();
  list.forEach((x) => c.set(x, (c.get(x) || 0) + 1));
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0][0];
}
function letterOf(slug) {
  const ch = slug[0];
  return /[a-z]/.test(ch) ? ch : '0-9';
}
const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('').concat(['0-9']);

const FONTS = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600;700&display=swap';
const LOGO = '<svg viewBox="0 0 32 32" width="36" height="36" aria-hidden="true"><rect x="1" y="1" width="30" height="30" rx="4" fill="currentColor"/><path d="M13 7h6v6h6v6h-6v6h-6v-6H7v-6h6z" class="logo-cross"/></svg>';

function page({ title, description, canonical, h1, sub, body, jsonld, crumbs, appHref }) {
  const crumbHtml = crumbs && crumbs.length
    ? `<nav class="crumbs" aria-label="Breadcrumb">${crumbs.map((c, i) => (i < crumbs.length - 1 ? `<a href="${esc(c.href)}">${esc(c.name)}</a><span class="sep" aria-hidden="true">›</span>` : `<span aria-current="page">${esc(c.name)}</span>`)).join('')}</nav>`
    : '';
  const app = appHref || '/';
  const ld = []
    .concat(jsonld || [])
    .concat(crumbs && crumbs.length ? [{
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: SITE + c.href })),
    }] : []);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:site_name" content="Sasta Dawa Finder">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#F6F5EF" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0F1210" media="(prefers-color-scheme: dark)">
<link rel="icon" type="image/svg+xml" href="/icons/icon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<link rel="stylesheet" href="/css/seo.css?v=${CSS_V}">
${ld.map((o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`).join('\n')}
${ANALYTICS}
</head>
<body>
<header class="topbar"><div class="wrap topbar-in">
  <a class="brand" href="/" aria-label="Sasta Dawa Finder home"><span class="brand-mark">${LOGO}</span><span class="brand-name">Sasta Dawa</span></a>
  <a class="top-link" href="/">Search all medicines</a>
  <a class="lang-btn" href="${esc(app)}" data-lang="ur" lang="ur" title="Open in Urdu">اردو</a>
</div></header>
<main class="wrap main">
${crumbHtml}
<h1>${esc(h1)}</h1>
${sub ? `<p class="sub">${sub}</p>` : ''}
${body}
<section class="find" aria-labelledby="find-h">
  <h2 id="find-h">Look up another medicine</h2>
  <form class="seo-search" id="seo-search" action="/" role="search" autocomplete="off">
    <input type="search" name="q" placeholder="e.g. Panadol" aria-label="Medicine name" role="combobox" aria-autocomplete="list" aria-controls="seo-suggest" aria-expanded="false">
    <button class="btn btn-primary" type="submit">Search</button>
    <ul id="seo-suggest" class="suggest" role="listbox" hidden></ul>
  </form>
</section>
</main>
<footer class="footer"><div class="wrap">
  <div class="footer-cols">
    <div>
      <p class="footer-h">Contact</p>
      <a class="footer-link" href="tel:+923393202419" dir="ltr">+92 339 3202419</a>
      <a class="footer-link" href="mailto:mavericktech.pk@gmail.com">mavericktech.pk@gmail.com</a>
    </div>
    <div>
      <p class="footer-h">More</p>
      <a class="footer-link" href="${APK}" rel="nofollow">Android app</a>
      <a class="footer-link" href="/formula">All formulas (salts)</a>
      <a class="footer-link" href="/business">For pharmacies, clinics &amp; companies</a>
      <a class="footer-link" href="/privacy">Privacy policy</a>
    </div>
    <div>
      <p class="footer-h">Emergency</p>
      <a class="footer-link" href="tel:1122">Rescue 1122</a>
      <a class="footer-link" href="tel:115">Edhi 115</a>
    </div>
  </div>
  <p class="footer-h footer-az-h">All medicines A–Z</p>
  <p class="az">${LETTERS.map((l) => `<a href="/browse/${l}" aria-label="Medicines starting with ${l.toUpperCase()}">${l.toUpperCase()}</a>`).join('')}</p>
  <p class="footer-note">Prices are DRAP-notified maximum retail prices; pharmacies may sell for less. This site does not give medical advice. Always ask your doctor or pharmacist before switching medicines.</p>
  <p class="footer-copy">&copy; Maverick Technologies</p>
</div></footer>
<script src="/js/seo-search.js?v=${JS_V}" defer></script>
</body>
</html>
`;
}

// One big row in a list of brands: name + maker on the left, pack price on the right,
// a green "Save X%" / "Cheapest" line. The whole row is one link (48px+ target).
function altRow({ m, href, tag, cheapest }) {
  const inner = `<span class="alt-main"><span class="alt-name">${esc(m.name)}</span><span class="alt-meta">${esc(m.manufacturer || '')}</span>${tag ? `<span class="alt-save">${esc(tag)}</span>` : ''}</span>
<span class="alt-price"><b>${rs(m.price)}</b><span>${esc(packText(m))}</span>${m.unit === 'pack' ? '' : `<span>${rs(m.unitPrice)} per ${esc(unitWord(m))}</span>`}</span>`;
  const cls = 'alt' + (cheapest ? ' cheapest' : '');
  return href ? `<li><a class="${cls}" href="${esc(href)}">${inner}</a></li>` : `<li><div class="${cls}">${inner}</div></li>`;
}
function altList(rows) {
  return `<ul class="alt-list">${rows.map(altRow).join('\n')}</ul>`;
}

function build(outDir) {
  const OUT = outDir || path.join(ROOT, 'public');
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'medicines.json'), 'utf8'));
  const ds = D.expand(raw);
  const engine = S.createEngine(ds);
  const latest = ds.meta && ds.meta.latest_price_date;
  const latestTxt = fmtDate(latest);
  const lastmod = (latest || new Date().toISOString()).slice(0, 10);

  // ---- Brands -------------------------------------------------------------
  const brands = new Map();
  ds.items.forEach((m) => {
    if (!/[a-z]{2}/i.test(m.name)) return; // a few DRAP rows have numbers for names
    const slug = slugify(m.name);
    if (!slug) return;
    if (!brands.has(slug)) brands.set(slug, []);
    brands.get(slug).push(m);
  });
  const brandSlugOf = new Map(); // item id -> brand slug
  brands.forEach((items, slug) => items.forEach((m) => brandSlugOf.set(m.id, slug)));

  // ---- Formulas (active ingredients) ------------------------------------------
  const salts = new Map();
  ds.bySalt.forEach((items, key) => {
    const slug = slugify(key);
    if (slug && items.length) salts.set(slug, items);
  });
  const saltSlugOf = new Map();
  salts.forEach((items, slug) => items.forEach((m) => saltSlugOf.set(m.id, slug)));

  const dirs = ['dawa', 'formula', 'browse'];
  dirs.forEach((d) => fs.mkdirSync(path.join(OUT, d), { recursive: true }));
  const urls = [];

  // ---- Brand pages ------------------------------------------------------------
  brands.forEach((items, slug) => {
    const name = mostCommon(items.map((m) => m.name));
    const generics = [...new Set(items.map((m) => m.generic))];
    const variants = items.slice().sort((a, b) => (a.generic + a.strength + a.form).localeCompare(b.generic + b.strength + b.form) || a.unitPrice - b.unitPrice);
    let best = null; // the biggest saving among this brand's variants, for the title/description
    let noteShown = false; // the one-line "ask your doctor" note: once per page, not per pack
    const ALT_FIRST = 5;
    const sections = variants.map((m) => {
      const all = (engine.alternatives(m) || []).filter((a) => a.id !== m.id && a.unitPrice < m.unitPrice - 0.004);
      const alts = all.slice(0, ALT_FIRST);
      const s = alts.length ? Math.round((1 - alts[0].unitPrice / m.unitPrice) * 100) : 0;
      if (alts.length && (!best || s > best.pct)) best = { m, alt: alts[0], pct: s };
      const sv = engine.savings(m);
      const hrefOf = (a) => (brandSlugOf.has(a.id) ? '/dawa/' + brandSlugOf.get(a.id) : appLink(a));
      const pctOf = (a) => Math.round((1 - a.unitPrice / m.unitPrice) * 100);
      const narrow = NARROW_THERAPEUTIC.test(m.generic);
      const saltSlug = saltSlugOf.get(m.id);

      const priceCard = `<div class="price-label">
<p class="pl-cap">Price</p>
<p class="pl-price"><b>${rs(m.price)}</b></p>
<p class="pl-unit">for ${esc(packText(m))}${m.unit === 'pack' ? '' : ` · ${rs(m.unitPrice)} per ${esc(unitWord(m))}`}</p>
</div>`;
      let box = '';
      if (sv && sv.percent >= 1) {
        const c = sv.cheapest;
        box = `<div class="savings">
<p class="s-kicker">Cheaper option</p>
<p class="s-name"><a href="${esc(hrefOf(c))}">${esc(medTitle(c))}</a></p>
<p class="s-price"><b>${rs(c.price)}</b> for ${esc(packText(c))}</p>
<p class="s-save">${m.unit !== 'pack' ? `You save ${rs(sv.perPack)}` : `Save ${sv.percent}%`}</p>
</div>`;
      } else {
        box = '<div class="savings neutral"><p class="s-title">Good choice: this is already one of the cheapest brands with this formula.</p></div>';
      }
      let note = '';
      if (narrow && all.length) {
        note = '<div class="notice" role="note"><p><b>Ask your doctor before switching.</b> This medicine needs a doctor\'s advice to change brand, even with the same formula.</p></div>';
      } else if (all.length && !noteShown) {
        note = '<div class="notice" role="note"><p>Ask your doctor or pharmacist before you switch.</p></div>';
      }
      if (note) noteShown = true;
      const list = alts.length
        ? `<h3>Cheaper medicines with the same formula</h3>
${altList(alts.map((a, i) => ({ m: a, href: hrefOf(a), tag: `Save ${pctOf(a)}%`, cheapest: i === 0 })))}
${all.length > ALT_FIRST ? `<a class="btn btn-ghost show-all" href="${appLink(m)}">Show all ${all.length}</a>` : ''}`
        : '';
      const details = `<details class="more-details">
<summary>More details</summary>
<dl class="facts">
<dt>Formula</dt><dd>${saltSlug ? `<a href="/formula/${saltSlug}">${esc(m.generic)}</a>` : esc(m.generic)}${m.strength ? ' ' + esc(m.strength) : ''}</dd>
<dt>Form</dt><dd>${esc(m.form || '–')}</dd>
<dt>Pack</dt><dd>${esc(m.pack || '–')}</dd>
<dt>Maker</dt><dd>${esc(m.manufacturer || '–')}</dd>
${m.reg ? `<dt>DRAP Reg. no.</dt><dd>${esc(m.reg)}</dd>` : ''}
${m.effective ? `<dt>Price from</dt><dd>${esc(fmtDate(m.effective))}</dd>` : ''}
</dl>
${saltSlug ? `<p class="d-link"><a href="/formula/${saltSlug}">Compare all ${esc(m.generic)} brands</a></p>` : ''}
</details>`;
      return `<section class="variant">
<h2>${esc(name)} ${esc(m.strength || '')} ${esc(m.form || '')}</h2>
<p class="pack">Pack of ${esc(packText(m))}</p>
${priceCard}
${box}
${note}
${list}
<a class="btn btn-primary btn-lg open-app" href="${appLink(m)}">Open in Sasta Dawa</a>
${details}
</section>`;
    });

    const genericTxt = generics.slice(0, 2).join(', ');
    const title = `${name} price in Pakistan – DRAP price & cheaper alternatives`;
    const description = best
      ? `${name} (${genericTxt}) official DRAP price: ${rs(best.m.price)} for ${best.m.pack}. Same formula for less: ${best.alt.name} at ${rs(best.alt.unitPrice)} per ${unitWord(best.alt)} (${best.pct}% cheaper). Prices to ${latestTxt}.`
      : `${name} (${genericTxt}) official DRAP price in Pakistan for every strength and pack, with all same-formula brands compared. Prices to ${latestTxt}.`;
    const sub = `${esc(genericTxt)} · Government (DRAP) price, updated ${esc(latestTxt)}`;
    const intro = `<p class="lead">Official price of ${esc(name)}${best ? `, and cheaper medicines with exactly the same formula: <b>${esc(best.alt.name)}</b> costs <b>${best.pct}% less</b>` : ''}.</p>
<p class="ur" lang="ur" dir="rtl">${esc(name)} کی سرکاری قیمت اور اسی فارمولے کی سستی دوائیں</p>`;
    const jsonld = [{
      '@context': 'https://schema.org',
      '@type': 'Drug',
      name,
      nonProprietaryName: genericTxt,
      activeIngredient: genericTxt,
      dosageForm: [...new Set(items.map((m) => m.form).filter(Boolean))].join(', '),
      manufacturer: { '@type': 'Organization', name: mostCommon(items.map((m) => m.manufacturer || '').filter(Boolean).concat(['–'])) },
      url: `${SITE}/dawa/${slug}`,
    }];
    const html = page({
      title,
      description,
      canonical: `${SITE}/dawa/${slug}`,
      h1: `${name} price in Pakistan`,
      sub,
      body: intro + sections.join('\n'),
      appHref: appLink(variants[0]),
      jsonld,
      crumbs: [{ name: 'Home', href: '/' }, { name: 'Medicines ' + letterOf(slug).toUpperCase(), href: '/browse/' + letterOf(slug) }, { name, href: '/dawa/' + slug }],
    });
    fs.writeFileSync(path.join(OUT, 'dawa', slug + '.html'), html);
    urls.push(`/dawa/${slug}`);
  });

  // ---- Formula pages ------------------------------------------------------------
  const saltNames = new Map();
  salts.forEach((items, slug) => {
    const generic = mostCommon(items.map((m) => m.generic));
    saltNames.set(slug, generic);
    const groups = new Map();
    items.forEach((m) => {
      const k = [m.strength, m.form].join(' · ');
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(m);
    });
    const blocks = [...groups.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([k, list]) => {
        const sorted = list.slice().sort((a, b) => a.unitPrice - b.unitPrice);
        const FIRST = 5;
        const MAX = 40;
        const multi = sorted.length > 1;
        const rows = sorted.slice(0, MAX).map((m, i) => ({
          m,
          href: brandSlugOf.has(m.id) ? '/dawa/' + brandSlugOf.get(m.id) : appLink(m),
          tag: '',
          cheapest: i === 0 && multi,
        }));
        const c = sorted[0];
        return `<section class="variant"><h2>${esc(generic)} ${esc(k)}</h2>
<p class="pack">${sorted.length} brand${sorted.length === 1 ? '' : 's'}, cheapest first</p>
${multi ? `<div class="savings">
<p class="s-kicker">Cheapest</p>
<p class="s-name"><a href="${esc(rows[0].href)}">${esc(medTitle(c))}</a></p>
<p class="s-price"><b>${rs(c.price)}</b> for ${esc(packText(c))}${c.unit === 'pack' ? '' : ` · ${rs(c.unitPrice)} per ${esc(unitWord(c))}`}</p>
</div>` : ''}
${altList(rows.slice(0, FIRST))}
${rows.length > FIRST ? `<details class="more-rows"><summary>Show all ${sorted.length} brands</summary>
${altList(rows.slice(FIRST))}
${sorted.length > MAX ? `<a class="btn btn-ghost show-all" href="${appLink(c)}">See the other ${sorted.length - MAX} in Sasta Dawa</a>` : ''}
</details>` : ''}
</section>`;
      });
    const brandCount = new Set(items.map((m) => brandSlugOf.get(m.id)).filter(Boolean)).size;
    const cheapest = items.slice().sort((a, b) => a.unitPrice - b.unitPrice)[0];
    const narrow = NARROW_THERAPEUTIC.test(generic);
    const html = page({
      title: `${generic} price in Pakistan – all ${brandCount} brands compared`,
      description: `Compare DRAP prices of all ${brandCount} ${generic} brands in Pakistan by strength and form. Cheapest: ${cheapest.name} ${cheapest.strength || ''} at ${rs(cheapest.unitPrice)} per ${unitWord(cheapest)}. Prices to ${latestTxt}.`,
      canonical: `${SITE}/formula/${slug}`,
      h1: `${generic} price in Pakistan`,
      sub: `${brandCount} brand${brandCount === 1 ? '' : 's'} · Government (DRAP) price, updated ${esc(latestTxt)}`,
      body: `<p class="lead">Every registered brand of ${esc(generic)}, grouped by strength and form, cheapest first. Brands in one group have the same formula.</p>
${narrow
    ? '<div class="notice" role="note"><p><b>Ask your doctor before switching.</b> This medicine needs a doctor\'s advice to change brand, even with the same formula.</p></div>'
    : '<div class="notice" role="note"><p>Ask your doctor or pharmacist before you switch.</p></div>'}
${blocks.join('\n')}
<a class="btn btn-primary btn-lg open-app" href="${appLink(cheapest)}">Open in Sasta Dawa</a>`,
      appHref: appLink(cheapest),
      crumbs: [{ name: 'Home', href: '/' }, { name: 'Formulas', href: '/formula' }, { name: generic, href: '/formula/' + slug }],
    });
    fs.writeFileSync(path.join(OUT, 'formula', slug + '.html'), html);
    urls.push(`/formula/${slug}`);
  });

  // ---- A-Z browse pages ----------------------------------------------------------
  const byLetter = new Map(LETTERS.map((l) => [l, []]));
  brands.forEach((items, slug) => {
    const cheapest = items.slice().sort((a, b) => a.unitPrice - b.unitPrice)[0];
    byLetter.get(letterOf(slug)).push({ slug, name: mostCommon(items.map((m) => m.name)), generic: mostCommon(items.map((m) => m.generic)), from: cheapest });
  });
  byLetter.forEach((list, l) => {
    list.sort((a, b) => a.name.localeCompare(b.name));
    const html = page({
      title: `Medicines starting with ${l.toUpperCase()} – DRAP prices in Pakistan`,
      description: `All ${list.length} DRAP-registered medicine brands starting with ${l.toUpperCase()}, with official prices and cheaper same-formula alternatives.`,
      canonical: `${SITE}/browse/${l}`,
      h1: `Medicines starting with ${l.toUpperCase()}`,
      sub: `${list.length} brands`,
      body: `<p class="lead">Tap a medicine to see its price and cheaper options.</p>
<p class="az az-top">${LETTERS.map((x) => (x === l ? `<span aria-current="page">${x.toUpperCase()}</span>` : `<a href="/browse/${x}">${x.toUpperCase()}</a>`)).join('')}</p>
<ul class="rows">${list.map((b) => `<li><a class="row" href="/dawa/${b.slug}"><span class="row-main"><span class="row-name">${esc(b.name)}</span><span class="row-meta">${esc(b.generic)}</span></span><span class="row-price">from <b>${rs(b.from.unitPrice)}</b> / ${esc(unitWord(b.from))}</span></a></li>`).join('')}</ul>`,
      crumbs: [{ name: 'Home', href: '/' }, { name: 'Medicines ' + l.toUpperCase(), href: '/browse/' + l }],
    });
    fs.writeFileSync(path.join(OUT, 'browse', l + '.html'), html);
    urls.push(`/browse/${l}`);
  });

  // ---- Formula index ---------------------------------------------------------------
  const saltList = [...saltNames.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  fs.writeFileSync(path.join(OUT, 'formula.html'), page({
    title: 'All medicine formulas (salts) in Pakistan – compare brand prices',
    description: `${saltList.length} active ingredients sold in Pakistan. Pick one to compare the DRAP prices of all its brands.`,
    canonical: `${SITE}/formula`,
    h1: 'All medicine formulas (salts)',
    sub: `${saltList.length} active ingredients`,
    body: `<p class="lead">Pick a formula to compare the price of every brand, cheapest first.</p>
<ul class="list cols">${saltList.map(([slug, name]) => `<li><a href="/formula/${slug}">${esc(name)}</a></li>`).join('')}</ul>`,
    crumbs: [{ name: 'Home', href: '/' }, { name: 'Formulas', href: '/formula' }],
  }));
  urls.push('/formula');

  // ---- Suggestion list for the search box on these pages (js/seo-search.js) ---------------
  const index = {
    b: [...brands.entries()].map(([slug, items]) => [mostCommon(items.map((m) => m.name)), slug, mostCommon(items.map((m) => m.generic)), items.some((m) => m.popular) ? 1 : 0])
      .sort((a, b) => a[0].localeCompare(b[0])),
    f: [...saltNames.entries()].map(([slug, name]) => [name, slug]).sort((a, b) => a[0].localeCompare(b[0])),
  };
  fs.mkdirSync(path.join(OUT, 'data'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'data', 'search-index.json'), JSON.stringify(index));

  // ---- Sitemap -----------------------------------------------------------------------
  const all = ['/', '/privacy'].concat(urls);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${all.map((u) => `  <url><loc>${SITE}${u}</loc><lastmod>${lastmod}</lastmod></url>`).join('\n')}
</urlset>
`;
  fs.writeFileSync(path.join(OUT, 'sitemap.xml'), xml);

  return { brands: brands.size, formulas: salts.size, browse: LETTERS.length, urls: all.length, out: OUT };
}

if (require.main === module) {
  const r = build(process.argv[2]);
  console.log(`SEO pages: ${r.brands} brands, ${r.formulas} formulas, ${r.browse} A-Z pages; sitemap has ${r.urls} URLs`);
}

module.exports = { build, slugify, SITE };
