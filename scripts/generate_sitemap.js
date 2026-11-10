/**
 * Sitemap generator for Sasta Dawa Finder.
 * The app is a single page with hash routes (#/medicine/...), which search engines
 * do not index separately, so the sitemap lists the canonical page only.
 */
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://sastadawafinder.pk';

function generateSitemap() {
  let lastmod = new Date().toISOString().slice(0, 10);
  try {
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/medicines.json'), 'utf8'));
    if (data.meta && data.meta.synced_at) lastmod = data.meta.synced_at.slice(0, 10);
  } catch (e) {
    /* dataset missing: use today */
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${BASE_URL}/</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`;
  fs.writeFileSync(path.join(__dirname, '../sitemap.xml'), xml, 'utf8');
  console.log('Wrote sitemap.xml');
}

if (require.main === module) generateSitemap();

module.exports = { generateSitemap };
