/**
 * Security headers for every page. The same values are written in vercel.json (the CDN serves the
 * static pages there); tests/security.test.js checks the two stay identical.
 *
 * No inline scripts are allowed: theme / analytics bootstraps live in js/theme-init.js and
 * js/va-init.js. JSON-LD blocks (type="application/ld+json") are data and are not affected.
 */
'use strict';

const DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' https://accounts.google.com/gsi/client",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com/gsi/style",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self' https://accounts.google.com https://vitals.vercel-insights.com",
  "frame-src https://accounts.google.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
];

const CSP = [...DIRECTIVES, "frame-ancestors 'none'"].join('; ');
// The clinic widget is embedded on other websites; /app/* pages are loaded in a hidden frame by the mobile app.
const CSP_EMBEDDABLE = [...DIRECTIVES, 'frame-ancestors *'].join('; ');

const PAGE = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(self), camera=(self), microphone=(self)',
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
};

module.exports = { CSP, CSP_EMBEDDABLE, PAGE, DIRECTIVES };
