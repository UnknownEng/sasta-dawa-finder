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
  if (m.unit === 'unit') return /capsule/i.test(m.form) ? 'capsule' : 'tablet';
  if (m.unit === 'dose') return 'dose';
  return m.unit || 'unit';
}
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

function page({ title, description, canonical, h1, body, jsonld, crumbs }) {
  const crumbHtml = crumbs && crumbs.length
    ? `<nav class="crumbs" aria-label="Breadcrumb">${crumbs.map((c, i) => (i < crumbs.length - 1 ? `<a href="${esc(c.href)}">${esc(c.name)}</a> › ` : `<span>${esc(c.name)}</span>`)).join('')}</nav>`
    : '';
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
<meta name="theme-color" content="#13294B">
<link rel="icon" type="image/svg+xml" href="/icons/icon.svg">
<link rel="stylesheet" href="/css/seo.css">
${ld.map((o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`).join('\n')}
${ANALYTICS}
</head>
<body>
<header class="top"><div class="wrap top-in">
  <a class="brand" href="/"><img src="/icons/icon.svg" alt="" width="34" height="34"><span>Sasta Dawa Finder</span></a>
  <a class="btn" href="/">Search any medicine</a>
</div></header>
<main class="wrap">
${crumbHtml}
<h1>${esc(h1)}</h1>
${body}
<section class="cta">
  <p><b>Check any medicine in seconds.</b> Official DRAP prices for every registered brand, in English and Urdu, free.</p>
  <p class="cta-row"><a class="btn" href="/">Open Sasta Dawa Finder</a> <a class="btn ghost" href="${APK}" rel="nofollow">Download Android app</a></p>
</section>
<p class="note">Prices are DRAP-notified maximum retail prices; pharmacies may sell for less. This page is not medical advice: always ask your doctor or pharmacist before switching medicines. In an emergency call Rescue 1122 or Edhi 115.</p>
</main>
<footer class="foot"><div class="wrap">
  <p class="az"><b>Browse medicines:</b> ${LETTERS.map((l) => `<a href="/browse/${l}">${l.toUpperCase()}</a>`).join(' ')}</p>
  <p><a href="/formula">All formulas (salts)</a> · <a href="/privacy">Privacy policy</a> · <a href="/">Sasta Dawa Finder</a></p>
</div></footer>
</body>
</html>
`;
}

function priceTable(rows, opts) {
  const o = opts || {};
  return `<div class="tbl"><table>
<thead><tr><th>Brand</th>${o.showGeneric ? '<th>Formula</th>' : ''}<th>Strength · form · pack</th><th class="num">DRAP price</th><th class="num">Per unit</th><th>Manufacturer</th></tr></thead>
<tbody>
${rows.map((r) => `<tr${r.highlight ? ' class="best"' : ''}><td>${r.href ? `<a href="${esc(r.href)}">${esc(r.m.name)}</a>` : `<b>${esc(r.m.name)}</b>`}${r.tag ? ` <span class="tag">${esc(r.tag)}</span>` : ''}</td>${o.showGeneric ? `<td>${esc(r.m.generic)}</td>` : ''}<td>${esc([r.m.strength, r.m.form, r.m.pack].filter(Boolean).join(' · '))}</td><td class="num">${rs(r.m.price)}</td><td class="num">${rs(r.m.unitPrice)} / ${esc(unitWord(r.m))}</td><td>${esc(r.m.manufacturer || '')}</td></tr>`).join('\n')}
</tbody></table></div>`;
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
    const sections = variants.map((m) => {
      const alts = (engine.alternatives(m) || []).filter((a) => a.id !== m.id && a.unitPrice < m.unitPrice - 0.004).slice(0, 6);
      const s = alts.length ? Math.round((1 - alts[0].unitPrice / m.unitPrice) * 100) : 0;
      if (alts.length && (!best || s > best.pct)) best = { m, alt: alts[0], pct: s };
      const warn = NARROW_THERAPEUTIC.test(m.generic)
        ? '<p class="warn">Switching brands of this medicine needs your doctor\'s advice, even with the same formula.</p>'
        : '';
      const altHtml = alts.length
        ? `<h3>Cheaper brands with the same formula</h3>${priceTable(alts.map((a, i) => ({ m: a, href: brandSlugOf.has(a.id) ? '/dawa/' + brandSlugOf.get(a.id) : null, tag: i === 0 ? Math.round((1 - a.unitPrice / m.unitPrice) * 100) + '% less' : '', highlight: i === 0 })))}`
        : '<p class="ok">This is already one of the cheapest DRAP-registered brands for this formula.</p>';
      const saltSlug = saltSlugOf.get(m.id);
      return `<section class="variant">
<h2>${esc(name)} ${esc(m.strength || '')} ${esc(m.form || '')} <small>(${esc(m.pack || '')})</small></h2>
<p class="facts"><b>${rs(m.price)}</b> DRAP max. price · <b>${rs(m.unitPrice)}</b> per ${esc(unitWord(m))} · ${esc(m.generic)}${saltSlug ? ` (<a href="/formula/${saltSlug}">all ${esc(m.generic)} brands</a>)` : ''} · ${esc(m.manufacturer || '')}${m.reg ? ' · DRAP Reg. ' + esc(m.reg) : ''}${m.effective ? ' · price from ' + esc(fmtDate(m.effective)) : ''}</p>
${warn}
${altHtml}
<p><a class="btn small" href="/#/medicine/${encodeURIComponent(m.id)}">Open ${esc(name)} ${esc(m.strength || '')} in the app</a></p>
</section>`;
    });

    const genericTxt = generics.slice(0, 2).join(', ');
    const title = `${name} price in Pakistan – DRAP price & cheaper alternatives`;
    const description = best
      ? `${name} (${genericTxt}) official DRAP price: ${rs(best.m.price)} for ${best.m.pack}. Same formula for less: ${best.alt.name} at ${rs(best.alt.unitPrice)} per ${unitWord(best.alt)} (${best.pct}% cheaper). Prices to ${latestTxt}.`
      : `${name} (${genericTxt}) official DRAP price in Pakistan for every strength and pack, with all same-formula brands compared. Prices to ${latestTxt}.`;
    const intro = `<p class="lead">Official DRAP maximum retail price of <b>${esc(name)}</b> (${esc(genericTxt)}) in Pakistan${best ? `, and cheaper brands with exactly the same formula. The biggest saving: <b>${esc(best.alt.name)}</b> costs <b>${best.pct}% less</b> per ${esc(unitWord(best.alt))}` : ''}. Prices updated to ${esc(latestTxt)}.</p>
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
      body: intro + sections.join('\n'),
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
        return `<section class="variant"><h2>${esc(generic)} ${esc(k)} <small>(${sorted.length} brand${sorted.length === 1 ? '' : 's'})</small></h2>
${priceTable(sorted.slice(0, 40).map((m, i) => ({ m, href: brandSlugOf.has(m.id) ? '/dawa/' + brandSlugOf.get(m.id) : null, tag: i === 0 && sorted.length > 1 ? 'cheapest' : '', highlight: i === 0 && sorted.length > 1 })))}
${sorted.length > 40 ? `<p class="more">+${sorted.length - 40} more brands in the app.</p>` : ''}</section>`;
      });
    const brandCount = new Set(items.map((m) => brandSlugOf.get(m.id)).filter(Boolean)).size;
    const cheapest = items.slice().sort((a, b) => a.unitPrice - b.unitPrice)[0];
    const html = page({
      title: `${generic} price in Pakistan – all ${brandCount} brands compared`,
      description: `Compare DRAP prices of all ${brandCount} ${generic} brands in Pakistan by strength and form. Cheapest: ${cheapest.name} ${cheapest.strength || ''} at ${rs(cheapest.unitPrice)} per ${unitWord(cheapest)}. Prices to ${latestTxt}.`,
      canonical: `${SITE}/formula/${slug}`,
      h1: `${generic} price in Pakistan`,
      body: `<p class="lead">Every DRAP-registered brand of <b>${esc(generic)}</b>, grouped by strength and form and sorted cheapest first. Brands in the same group have the same active ingredient, strength and form. Prices updated to ${esc(latestTxt)}.</p>
${NARROW_THERAPEUTIC.test(generic) ? '<p class="warn">Switching brands of this medicine needs your doctor\'s advice, even with the same formula.</p>' : ''}
${blocks.join('\n')}`,
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
      body: `<p class="lead">${list.length} brands. Tap a brand for its DRAP price and cheaper same-formula options.</p>
<ul class="list">${list.map((b) => `<li><a href="/dawa/${b.slug}">${esc(b.name)}</a> <span>${esc(b.generic)} · from ${rs(b.from.unitPrice)} / ${esc(unitWord(b.from))}</span></li>`).join('')}</ul>`,
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
    body: `<p class="lead">${saltList.length} active ingredients. Each page compares every DRAP-registered brand of that formula, cheapest first.</p>
<ul class="list cols">${saltList.map(([slug, name]) => `<li><a href="/formula/${slug}">${esc(name)}</a></li>`).join('')}</ul>`,
    crumbs: [{ name: 'Home', href: '/' }, { name: 'Formulas', href: '/formula' }],
  }));
  urls.push('/formula');

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
