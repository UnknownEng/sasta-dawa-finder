/**
 * Antigracity - Production SSR & Static Web Server
 * High-performance server with server-side rendering, strict HTTP status codes,
 * proper 404 handling, asset caching, and SEO crawler headers.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT_DIR = path.resolve(__dirname);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf'
};

function getPreRenderedHTML() {
  const htmlPath = path.join(ROOT_DIR, 'index.html');
  let html = fs.readFileSync(htmlPath, 'utf8');

  // SSR Enhancement: Ensure current year is baked into static markup
  const currentYear = new Date().getFullYear().toString();
  html = html.replace(/<span id="copyright-year">\d+<\/span>/, `<span id="copyright-year">${currentYear}</span>`);

  return html;
}

function get404HTML() {
  const path404 = path.join(ROOT_DIR, '404.html');
  if (fs.existsSync(path404)) {
    return fs.readFileSync(path404, 'utf8');
  }
  return '<!DOCTYPE html><html><head><title>404 Not Found</title></head><body><h1>404 Not Found</h1></body></html>';
}

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = decodeURIComponent(parsedUrl.pathname);

  // Security: prevent directory traversal
  const safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  
  // Route: Root / Index -> Server-Side Rendered HTML
  if (safePath === '/' || safePath === '/index.html') {
    const html = getPreRenderedHTML();
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(html),
      'Cache-Control': 'public, max-age=600, stale-while-revalidate=86400',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'X-XSS-Protection': '1; mode=block',
      'Referrer-Policy': 'strict-origin-when-cross-origin'
    });
    return res.end(html);
  }

  // Route: robots.txt
  if (safePath === '/robots.txt') {
    const robotsPath = path.join(ROOT_DIR, 'robots.txt');
    if (fs.existsSync(robotsPath)) {
      const robots = fs.readFileSync(robotsPath, 'utf8');
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'public, max-age=86400'
      });
      return res.end(robots);
    }
  }

  // Route: sitemap.xml
  if (safePath === '/sitemap.xml') {
    const sitemapPath = path.join(ROOT_DIR, 'sitemap.xml');
    if (fs.existsSync(sitemapPath)) {
      const sitemap = fs.readFileSync(sitemapPath, 'utf8');
      res.writeHead(200, {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=86400'
      });
      return res.end(sitemap);
    }
  }

  // Static File Serving
  const filePath = path.join(ROOT_DIR, safePath);
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Return HTTP 404 status code (no soft-404)
      const errorHtml = get404HTML();
      res.writeHead(404, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': Buffer.byteLength(errorHtml),
        'X-Robots-Tag': 'noindex, follow',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      });
      return res.end(errorHtml);
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const isImmutable = ['.png', '.webp', '.svg', '.ico', '.woff2'].includes(ext);

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Cache-Control': isImmutable
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=3600, stale-while-revalidate=86400',
      'X-Content-Type-Options': 'nosniff'
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Antigracity SSR & Static Server running at http://localhost:${PORT}`);
  });
}

module.exports = { server, getPreRenderedHTML, get404HTML };
