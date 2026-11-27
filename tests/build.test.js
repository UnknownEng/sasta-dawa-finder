// The Vercel build publishes only website files - never server code, scripts, tests or docs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { build } = require('../scripts/build_public');

test('build_public copies only the website', () => {
  const out = build();
  const list = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : list.push(path.relative(out, path.join(d, e.name)).split(path.sep).join('/'))));
  walk(out);
  for (const must of ['index.html', 'privacy.html', 'sw.js', 'data/medicines.json', 'js/app.js', 'css/style.css', 'unonenginerrunon/index.html', 'unonenginerrunon/admin.js']) {
    assert.ok(list.includes(must), must);
  }
  for (const f of list) {
    assert.doesNotMatch(f, /^(lib|api|scripts|tests|node_modules)\/|server\.js$|package(-lock)?\.json$|\.md$|vercel\.json$/, f);
  }
  const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
  assert.equal(vercel.outputDirectory, 'public');
  assert.ok(vercel.headers.some((h) => h.source.startsWith('/unonenginerrunon') && h.headers.some((x) => x.key === 'X-Robots-Tag')));
  for (const r of ['health', 'chat', 'config', 'feedback', 'admin']) assert.ok(fs.existsSync(path.join(__dirname, '..', 'api', r + '.js')), r);
});

test('on-device OCR files are generated into the site (same origin, LSTM-only, small set)', () => {
  const out = path.join(__dirname, '..', 'public');
  const files = fs.readdirSync(path.join(out, 'vendor', 'ocr')).sort();
  for (const must of ['tesseract.min.js', 'worker.min.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-lstm.wasm.js', 'eng.traineddata.gz']) assert.ok(files.includes(must), must);
  // no legacy (non-LSTM) cores, no source maps
  assert.ok(!files.some((f) => /^tesseract-core(-simd|-relaxedsimd)?\.wasm|\.map$/.test(f)), files.join(','));
  const sw = fs.readFileSync(path.join(out, 'sw.js'), 'utf8');
  assert.match(sw, /'sasta-dawa-ocr-\d+\.\d+\.\d+'/);
  assert.doesNotMatch(sw.match(/PRECACHE_URLS = \[[\s\S]*?\]/)[0], /vendor\/ocr/);
  const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
  assert.ok(vercel.headers.some((h) => h.source.startsWith('/vendor/ocr/') && h.headers.some((x) => x.key === 'Cache-Control' && /max-age=\d{6,}/.test(x.value))));
  assert.match(fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8'), /^vendor\/$/m);
});
