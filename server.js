/**
 * Sasta Dawa Finder - local web server (npm start). On Vercel the same API runs as
 * functions in api/*.js and static files are served by the CDN (see vercel.json).
 *
 *  - Serves the static app with gzip + sensible caching and security headers
 *  - /api/health, /api/chat, /api/config, /api/feedback, /api/admin  (lib/api.js)
 *  - /unonenginerrunon  hidden admin panel (password: ADMIN_PASSWORD env var)
 *
 * Environment: PORT (default 3000), ANTHROPIC_API_KEY, CHAT_MODEL, ADMIN_PASSWORD
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const api = require('./lib/api');
const chatLib = require('./lib/chat');

const PORT = process.env.PORT || 3000;
const ROOT_DIR = path.resolve(__dirname);
const ADMIN_PATH = '/unonenginerrunon';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.json', '.xml', '.txt', '.svg', '.webmanifest']);
const BLOCKED = /^\/(\.|node_modules|scripts|tests|lib|api|public|\.cache|\.data|vercel\.json|package(-lock)?\.json|server\.js|.*\.md$)/i;

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), camera=(), microphone=(self)',
};

// ---------------------------------------------------------------------------
// Static files
// ---------------------------------------------------------------------------
const gzCache = new Map();

function getPreRenderedHTML() {
  let html = fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8');
  const currentYear = new Date().getFullYear().toString();
  html = html.replace(/<span id="copyright-year">\d+<\/span>/, `<span id="copyright-year">${currentYear}</span>`);
  return html;
}

function get404HTML() {
  const p = path.join(ROOT_DIR, '404.html');
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  return '<!DOCTYPE html><html><head><title>404 Not Found</title></head><body><h1>404 Not Found</h1></body></html>';
}

function send(req, res, status, body, headers, ext) {
  const h = { ...SECURITY_HEADERS, ...headers };
  const accepts = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  let payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
  if (accepts && COMPRESSIBLE.has(ext) && payload.length > 1024) {
    payload = zlib.gzipSync(payload, { level: 6 });
    h['Content-Encoding'] = 'gzip';
    h['Vary'] = 'Accept-Encoding';
  }
  h['Content-Length'] = payload.length;
  res.writeHead(status, h);
  res.end(req.method === 'HEAD' ? undefined : payload);
}

function serveFile(req, res, filePath, stats) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME_TYPES[ext] || 'application/octet-stream';
  const immutable = ['.png', '.webp', '.ico', '.woff2'].includes(ext);
  const headers = {
    'Content-Type': type,
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : ext === '.json' ? 'public, max-age=3600' : 'public, max-age=600, stale-while-revalidate=86400',
    'Last-Modified': stats.mtime.toUTCString(),
  };
  if (filePath.endsWith('sw.js')) headers['Cache-Control'] = 'no-cache';
  const accepts = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  if (accepts && COMPRESSIBLE.has(ext)) {
    const key = filePath + ':' + stats.mtimeMs;
    let gz = gzCache.get(key);
    if (!gz) {
      gz = zlib.gzipSync(fs.readFileSync(filePath), { level: 9 });
      gzCache.set(key, gz);
    }
    res.writeHead(200, { ...SECURITY_HEADERS, ...headers, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding', 'Content-Length': gz.length });
    return res.end(req.method === 'HEAD' ? undefined : gz);
  }
  res.writeHead(200, { ...SECURITY_HEADERS, ...headers, 'Content-Length': stats.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(filePath).pipe(res);
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------
const API_ROUTES = new Set(api.ROUTES);
const NOT_FOUND_HEADERS = { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex', 'Cache-Control': 'no-cache' };

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (e) {
    return send(req, res, 400, 'Bad request', { 'Content-Type': 'text/plain' }, '.txt');
  }

  const apiMatch = /^\/api\/([a-z]+)\/?$/.exec(pathname);
  if (apiMatch && API_ROUTES.has(apiMatch[1])) return api.handle(apiMatch[1], req, res);
  if (pathname.startsWith('/api/')) return send(req, res, 404, JSON.stringify({ error: 'Not found' }), { 'Content-Type': 'application/json' }, '.json');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(req, res, 405, 'Method not allowed', { 'Content-Type': 'text/plain', Allow: 'GET, HEAD' }, '.txt');
  }

  if (pathname === '/' || pathname === '/index.html') {
    return send(req, res, 200, getPreRenderedHTML(), { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400' }, '.html');
  }

  // Hidden admin panel (not linked anywhere, never indexed, password protected)
  if (pathname === ADMIN_PATH || pathname === ADMIN_PATH + '/') {
    const html = fs.readFileSync(path.join(ROOT_DIR, 'unonenginerrunon', 'index.html'));
    return send(req, res, 200, html, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'X-Frame-Options': 'DENY' }, '.html');
  }

  const filePath = path.normalize(path.join(ROOT_DIR, pathname));
  if (!filePath.startsWith(ROOT_DIR + path.sep) || BLOCKED.test(pathname)) {
    return send(req, res, 404, get404HTML(), NOT_FOUND_HEADERS, '.html');
  }
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) return send(req, res, 404, get404HTML(), NOT_FOUND_HEADERS, '.html');
    if (pathname.startsWith(ADMIN_PATH + '/')) res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    serveFile(req, res, filePath, stats);
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Sasta Dawa Finder running at http://localhost:${PORT}`);
    console.log(chatLib.aiEnabled() ? `AI assistant: enabled (${chatLib.CHAT_MODEL})` : 'AI assistant: off (set ANTHROPIC_API_KEY to enable); offline assistant is used.');
    console.log(process.env.ADMIN_PASSWORD ? `Admin panel: http://localhost:${PORT}${ADMIN_PATH}` : 'Admin panel: off (set ADMIN_PASSWORD to enable)');
  });
}

module.exports = {
  server,
  getPreRenderedHTML,
  get404HTML,
  runTool: chatLib.runTool,
  validateMessages: chatLib.validateMessages,
  mentionedIds: chatLib.mentionedIds,
  chat: chatLib.chat,
  TOOLS: chatLib.TOOLS,
  SYSTEM_PROMPT: chatLib.SYSTEM_PROMPT,
  _setClientForTests: chatLib._setClientForTests,
};
