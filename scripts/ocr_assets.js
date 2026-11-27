/**
 * On-device OCR files for "Scan medicine or prescription" (js/app.js, Tesseract.js).
 * Copies the few files the browser needs from node_modules into <out>/vendor/ocr/, so the
 * site and the app serve them from their own origin (no third-party CDN, works offline in the app).
 *
 * Only what is needed is copied (~11 MB on disk; a phone downloads ~7 MB once, gzip makes it less):
 *  - tesseract.min.js (main thread) + worker.min.js (Web Worker)
 *  - two LSTM-only cores: SIMD (almost every phone/browser) and a plain fallback; js/app.js picks one
 *  - English LSTM model (4.0.0_best_int, gzipped; Tesseract.js un-gzips it itself)
 *
 * The files are generated, never committed (vendor/ is in .gitignore):
 *   node scripts/ocr_assets.js            -> ./vendor/ocr  (local server, `npm start`)
 *   scripts/build_public.js / build_app.js call copy(<public|www>)
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function pkgDir(name, from) {
  return path.dirname(require.resolve(name + '/package.json', { paths: [from || ROOT] }));
}

/** [published name, source path] */
function sources() {
  const tjs = pkgDir('tesseract.js');
  // the core that this tesseract.js version was built for (it may be nested under tesseract.js)
  const core = pkgDir('tesseract.js-core', tjs);
  const eng = pkgDir('@tesseract.js-data/eng');
  return [
    ['tesseract.min.js', path.join(tjs, 'dist', 'tesseract.min.js')],
    ['worker.min.js', path.join(tjs, 'dist', 'worker.min.js')],
    ['tesseract-core-simd-lstm.wasm.js', path.join(core, 'tesseract-core-simd-lstm.wasm.js')],
    ['tesseract-core-lstm.wasm.js', path.join(core, 'tesseract-core-lstm.wasm.js')],
    ['eng.traineddata.gz', path.join(eng, '4.0.0_best_int', 'eng.traineddata.gz')],
    ['LICENSE-tesseract.js.txt', path.join(tjs, 'LICENSE.md')],
  ];
}

/**
 * Copy the OCR files into <outRoot>/vendor/ocr. Never throws: without the packages the site
 * still builds, and the scan button falls back to the AI server (or a friendly message).
 */
function copy(outRoot) {
  const dest = path.join(outRoot || ROOT, 'vendor', 'ocr');
  let list;
  try {
    list = sources();
  } catch (e) {
    console.warn('OCR: tesseract.js packages not installed, skipping vendor/ocr (' + e.message + ')');
    return { dest, files: 0, bytes: 0 };
  }
  fs.mkdirSync(dest, { recursive: true });
  let files = 0;
  let bytes = 0;
  for (const [name, src] of list) {
    if (!fs.existsSync(src)) {
      if (!/LICENSE/.test(name)) console.warn('OCR: missing ' + src);
      continue;
    }
    fs.copyFileSync(src, path.join(dest, name));
    files++;
    bytes += fs.statSync(src).size;
  }
  let version = '';
  try { version = require(path.join(pkgDir('tesseract.js'), 'package.json')).version; } catch (e) { /* unknown */ }
  return { dest, files, bytes, version };
}

if (require.main === module) {
  const r = copy(process.argv[2] ? path.resolve(process.argv[2]) : ROOT);
  console.log(`OCR: ${r.files} files, ${(r.bytes / 1048576).toFixed(1)} MB -> ${path.relative(ROOT, r.dest) || r.dest}`);
}

module.exports = { copy, sources };
