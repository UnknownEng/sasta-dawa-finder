const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('PWA (Progressive Web App) Suite', async (t) => {
  await t.test('manifest.json is valid and contains required PWA fields', () => {
    const manifestPath = path.join(__dirname, '../manifest.json');
    assert.ok(fs.existsSync(manifestPath), 'manifest.json must exist');

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.ok(manifest.name.includes('Sasta Dawa Finder'));
    assert.strictEqual(manifest.short_name, 'Sasta Dawa');
    assert.strictEqual(manifest.display, 'standalone');
    assert.strictEqual(manifest.theme_color, '#059669');
    assert.strictEqual(manifest.start_url, './index.html');
    assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0);
  });

  await t.test('app icon and service worker exist', () => {
    const iconPath = path.join(__dirname, '../icons/icon.svg');
    assert.ok(fs.existsSync(iconPath), 'icon.svg must exist');
    const svgContent = fs.readFileSync(iconPath, 'utf8');
    assert.ok(svgContent.includes('<svg') && svgContent.includes('</svg>'));

    const swPath = path.join(__dirname, '../sw.js');
    assert.ok(fs.existsSync(swPath), 'sw.js must exist');
    const swContent = fs.readFileSync(swPath, 'utf8');
    assert.ok(swContent.includes('addEventListener(\'install\''));
    assert.ok(swContent.includes('addEventListener(\'fetch\''));
    assert.ok(swContent.includes('addEventListener(\'activate\''));
  });

  await t.test('index.html links manifest, theme-color, and apple mobile meta tags', () => {
    const htmlPath = path.join(__dirname, '../index.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');

    assert.ok(htmlContent.includes('<link rel="manifest" href="manifest.json">'));
    assert.ok(htmlContent.includes('<meta name="theme-color" content="#059669">'));
    assert.ok(htmlContent.includes('<meta name="apple-mobile-web-app-capable" content="yes">'));
    assert.ok(htmlContent.includes('<link rel="icon" type="image/svg+xml" href="icons/icon.svg">'));
  });
});
