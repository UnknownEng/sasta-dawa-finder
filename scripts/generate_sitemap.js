/**
 * Sitemap Generator for Sasta Dawa Finder (https://sastadawafinder.pk)
 * Generates standards-compliant XML sitemap indexing core routes and top medicine queries.
 */

const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://sastadawafinder.pk';
const TODAY = new Date().toISOString().split('T')[0];

function generateSitemap() {
  const medicinesPath = path.join(__dirname, '../data/medicines.json');
  let medicines = [];
  try {
    medicines = JSON.parse(fs.readFileSync(medicinesPath, 'utf8'));
  } catch (err) {
    console.warn('Could not read medicines.json for sitemap, using core routes only.');
  }

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n`;
  xml += `        xmlns:xhtml="http://www.w3.org/1999/xhtml">\n`;

  // Core Pages
  const coreUrls = [
    { loc: `${BASE_URL}/`, priority: '1.0', changefreq: 'daily' },
    { loc: `${BASE_URL}/#categories-section`, priority: '0.8', changefreq: 'weekly' },
    { loc: `${BASE_URL}/#tips-section`, priority: '0.7', changefreq: 'monthly' },
    { loc: `${BASE_URL}/#nearby-stores-section`, priority: '0.8', changefreq: 'weekly' }
  ];

  for (const item of coreUrls) {
    xml += `  <url>\n`;
    xml += `    <loc>${item.loc}</loc>\n`;
    xml += `    <lastmod>${TODAY}</lastmod>\n`;
    xml += `    <changefreq>${item.changefreq}</changefreq>\n`;
    xml += `    <priority>${item.priority}</priority>\n`;
    xml += `    <xhtml:link rel="alternate" hreflang="en" href="${item.loc}" />\n`;
    xml += `    <xhtml:link rel="alternate" hreflang="ur" href="${item.loc}" />\n`;
    xml += `  </url>\n`;
  }

  // Top 50 Popular Medicines
  const sampleMedicines = medicines.slice(0, 50);
  for (const med of sampleMedicines) {
    const medUrl = `${BASE_URL}/#med=${encodeURIComponent(med.id)}`;
    xml += `  <url>\n`;
    xml += `    <loc>${medUrl}</loc>\n`;
    xml += `    <lastmod>${TODAY}</lastmod>\n`;
    xml += `    <changefreq>weekly</changefreq>\n`;
    xml += `    <priority>0.8</priority>\n`;
    xml += `  </url>\n`;
  }

  xml += `</urlset>\n`;

  const sitemapPath = path.join(__dirname, '../sitemap.xml');
  fs.writeFileSync(sitemapPath, xml, 'utf8');
  console.log(`Successfully generated ${sitemapPath} with ${coreUrls.length + sampleMedicines.length} URLs.`);
}

if (require.main === module) {
  generateSitemap();
}

module.exports = { generateSitemap };
