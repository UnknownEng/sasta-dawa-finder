/**
 * API routes shared by the local server (server.js) and the Vercel functions (api/*.js).
 *
 *   GET  /api/health    -> { ok, ai, products, latest_price_date }
 *   POST /api/chat      -> AI assistant (see lib/chat.js)
 *   GET  /api/config    -> public site settings (announcement, price fixes, contact…)
 *   POST /api/feedback  -> visitor report (wrong price, missing medicine, suggestion)
 *   GET/POST /api/admin?a=<action>  -> admin panel (password protected)
 */
'use strict';

const crypto = require('crypto');
const chatLib = require('./chat');
const config = require('./config');
const dataset = require('./dataset');
const store = require('./store');
const auth = require('./auth');

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
};

function json(res, status, obj, extra) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { ...JSON_HEADERS, 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body), ...(extra || {}) });
  res.end(body);
}

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || 'unknown';
}

function readJson(req, limit) {
  // Vercel's Node runtime parses the body lazily via a req.body getter (throws on bad JSON).
  let pre;
  try {
    pre = req.body;
  } catch (e) {
    return Promise.reject(Object.assign(new Error('bad json'), { status: 400 }));
  }
  if (pre !== undefined && pre !== null) {
    const size = Buffer.isBuffer(pre) || typeof pre === 'string' ? pre.length : JSON.stringify(pre).length;
    if (size > limit) return Promise.reject(Object.assign(new Error('too large'), { status: 413 }));
    if (typeof pre === 'object' && !Buffer.isBuffer(pre)) return Promise.resolve(pre);
    try {
      return Promise.resolve(JSON.parse(String(pre) || '{}'));
    } catch (e) {
      return Promise.reject(Object.assign(new Error('bad json'), { status: 400 }));
    }
  }
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (e) {
        reject(Object.assign(new Error('bad json'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function query(req) {
  return new URL(req.url, 'http://localhost').searchParams;
}

// Simple per-IP limiter (per server instance)
function limiter(max, windowMs) {
  const hits = new Map();
  return (ip) => {
    const now = Date.now();
    const list = (hits.get(ip) || []).filter((t) => now - t < windowMs);
    list.push(now);
    hits.set(ip, list);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(k);
    return list.length > max;
  };
}
const feedbackLimited = limiter(6, 10 * 60 * 1000);
// Across ALL addresses, per server instance: a botnet can't turn the form into thousands of storage writes.
const feedbackGlobalLimited = (() => {
  const l = limiter(40, 10 * 60 * 1000);
  return () => l('*');
})();
const INBOX_MAX_OPEN = 300; // above this, new reports are refused until the admin clears some
let openCountCache = { t: 0, n: 0 };
async function openReportCount() {
  if (Date.now() - openCountCache.t > 5 * 60 * 1000) openCountCache = { t: Date.now(), n: (await store.list('feedback/')).length };
  return openCountCache.n;
}

// ---------------------------------------------------------------------------
// Public routes
// ---------------------------------------------------------------------------
async function health(req, res) {
  const cfg = await config.load();
  return json(res, 200, { ok: true, ai: chatLib.aiEnabled() && cfg.ai.enabled, ...dataset.meta() }, {
    'Cache-Control': 'no-cache',
    'Vercel-CDN-Cache-Control': 'max-age=30',
  });
}

async function publicConfig(req, res) {
  const cfg = await config.load();
  // Browsers always re-check; only Vercel's CDN caches briefly (admin changes show within ~1 minute).
  return json(res, 200, config.publicView(cfg, chatLib.aiEnabled()), {
    'Cache-Control': 'no-cache',
    'Vercel-CDN-Cache-Control': 'max-age=30, stale-while-revalidate=30',
  });
}

async function chat(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
  const cfg = await config.load();
  if (!chatLib.aiEnabled() || !cfg.ai.enabled) return json(res, 503, { error: 'AI assistant is not configured' });
  if (chatLib.rateLimited(clientIp(req))) return json(res, 429, { error: 'Too many messages. Please wait a few minutes.' });
  let body;
  try {
    body = await readJson(req, 32 * 1024);
  } catch (e) {
    return json(res, e.status || 400, { error: e.message });
  }
  const messages = chatLib.validateMessages(body);
  if (!messages) return json(res, 400, { error: 'Invalid messages' });
  try {
    const out = await chatLib.chat(messages, body.lang === 'ur' ? 'ur' : 'en');
    return json(res, 200, out);
  } catch (e) {
    const A = chatLib.Anthropic();
    if (A && e instanceof A.RateLimitError) return json(res, 429, { error: 'Assistant is busy, please retry.' });
    if (A && e instanceof A.AuthenticationError) console.error('Chat: invalid ANTHROPIC_API_KEY');
    else console.error('Chat error:', e && e.message);
    // The browser falls back to the offline assistant on any non-200
    return json(res, 502, { error: 'Assistant unavailable' });
  }
}

const FEEDBACK_TYPES = ['wrong_price', 'missing', 'suggestion', 'other'];

function clean(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

async function feedback(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
  let body;
  try {
    body = await readJson(req, 8 * 1024);
  } catch (e) {
    return json(res, e.status || 400, { error: e.message });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json(res, 400, { error: 'Bad request' });
  if (body.website) return json(res, 200, { ok: true }); // honeypot: bots fill hidden fields
  if (feedbackLimited(clientIp(req)) || feedbackGlobalLimited()) return json(res, 429, { error: 'Too many reports. Please try again later.' });
  const item = {
    type: FEEDBACK_TYPES.includes(body.type) ? body.type : 'other',
    message: clean(body.message, 1000),
    medicine_id: /^[a-z0-9-]{1,140}$/.test(body.medicine_id || '') ? body.medicine_id : '',
    medicine_name: clean(body.medicine_name, 140),
    query: clean(body.query, 120),
    contact: clean(body.contact, 120),
    lang: body.lang === 'ur' ? 'ur' : 'en',
    status: 'new',
    at: new Date().toISOString(),
  };
  if (!item.message && !item.query && !item.medicine_id) return json(res, 400, { error: 'Please write a short message.' });
  const key = `feedback/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.json`;
  try {
    if ((await openReportCount()) >= INBOX_MAX_OPEN) return json(res, 503, { error: 'We have too many open reports right now. Please try again in a few days.' });
    await store.put(key, item);
    openCountCache.n++;
  } catch (e) {
    console.error('Feedback save failed:', e && e.message);
    return json(res, 503, { error: 'Could not save right now. Please try again later.' });
  }
  return json(res, 200, { ok: true });
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------
// Open reports live in feedback/, finished ones in feedback-done/: counting needs one listing
// and no reads, and the inbox only reads the newest page.
const FB_PREFIX = { open: 'feedback/', done: 'feedback-done/' };
const FB_KEY = /^(feedback|feedback-done)\/[0-9]+-[a-f0-9]+\.json$/;

async function listFeedback(status, limit) {
  const keys = (await store.list(FB_PREFIX[status])).sort((a, b) => (a.key < b.key ? 1 : -1));
  const page = keys.slice(0, limit);
  const items = await Promise.all(page.map(async (k) => ({ key: k.key, ...((await store.get(k.key)) || {}), status: status === 'done' ? 'done' : 'new' })));
  return { total: keys.length, items: items.filter((i) => i.at) };
}

async function admin(req, res) {
  const a = query(req).get('a') || '';
  const ip = clientIp(req);

  if (a === 'me') {
    return json(res, 200, { configured: auth.configured(), authed: auth.isAuthed(req) });
  }

  if (req.method !== 'GET') {
    // CSRF guard on top of SameSite=Strict cookies: only our admin page sends this header.
    if (req.headers['x-sd-admin'] !== '1') return json(res, 403, { error: 'Forbidden' });
  }

  if (a === 'login') {
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
    if (!auth.configured()) return json(res, 503, { error: 'Admin is not set up: set the ADMIN_PASSWORD environment variable (8+ characters).' });
    if (auth.tooManyAttempts(ip)) return json(res, 429, { error: 'Too many attempts. Wait 15 minutes.' });
    auth.recordFailure(ip); // counted up front so parallel guesses can't all slip through; cleared on success
    let body;
    try {
      body = await readJson(req, 4 * 1024);
    } catch (e) {
      return json(res, e.status || 400, { error: e.message });
    }
    if (!body || !auth.checkPassword(String(body.password || ''))) {
      await new Promise((r) => setTimeout(r, 400));
      return json(res, 401, { error: 'Wrong password' });
    }
    auth.clearFailures(ip);
    return json(res, 200, { ok: true }, { 'Set-Cookie': auth.sessionCookie(req, auth.createToken()) });
  }

  if (a === 'logout') {
    return json(res, 200, { ok: true }, { 'Set-Cookie': auth.sessionCookie(req, '') });
  }

  if (!auth.isAuthed(req)) return json(res, 401, { error: 'Please sign in' });

  if (a === 'overview') {
    const cfg = await config.load({ fresh: true });
    const d = dataset.refresh(cfg);
    const st = d.engine.stats();
    const [open, done] = await Promise.all([store.list(FB_PREFIX.open), store.list(FB_PREFIX.done)]);
    return json(res, 200, {
      data: {
        products: st.products,
        formulas: d.ds.groups.size,
        latest_price_date: d.ds.meta.latest_price_date,
        synced_at: d.ds.meta.synced_at,
        corrections: Object.keys(cfg.overrides).length,
      },
      ai: { keySet: chatLib.aiEnabled(), enabled: cfg.ai.enabled, model: chatLib.CHAT_MODEL },
      storage: store.backendName(),
      storageOk: store.isConnected(),
      feedback: { total: open.length + done.length, open: open.length, max: INBOX_MAX_OPEN },
      config: cfg,
    });
  }

  if (a === 'save-config') {
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
    let body;
    try {
      body = await readJson(req, 512 * 1024);
    } catch (e) {
      return json(res, e.status || 400, { error: e.message });
    }
    try {
      const saved = await config.save((body && body.config) || {}, body && 'expectedUpdatedAt' in body ? body.expectedUpdatedAt : undefined);
      dataset.refresh(saved);
      return json(res, 200, { ok: true, config: saved });
    } catch (e) {
      console.error('Settings save failed:', e && e.message);
      return json(res, e.status || 503, { error: e.status ? e.message : 'Could not save settings: ' + (e && e.message) });
    }
  }

  if (a === 'feedback') {
    const status = query(req).get('status') === 'done' ? 'done' : 'open';
    return json(res, 200, await listFeedback(status, 50));
  }

  if (a === 'feedback-update' || a === 'feedback-delete') {
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
    let body;
    try {
      body = await readJson(req, 4 * 1024);
    } catch (e) {
      return json(res, e.status || 400, { error: e.message });
    }
    const key = String((body && body.key) || '');
    if (!FB_KEY.test(key)) return json(res, 400, { error: 'Bad key' });
    if (a === 'feedback-delete') {
      await store.del(key);
      if (key.startsWith(FB_PREFIX.open)) openCountCache.n = Math.max(0, openCountCache.n - 1);
      return json(res, 200, { ok: true });
    }
    const item = await store.get(key);
    if (!item) return json(res, 404, { error: 'Not found' });
    const toDone = body.status === 'done';
    const newKey = (toDone ? FB_PREFIX.done : FB_PREFIX.open) + key.split('/')[1];
    if (newKey !== key) {
      item.status = toDone ? 'done' : 'new';
      await store.put(newKey, item);
      await store.del(key);
      openCountCache.n = Math.max(0, openCountCache.n + (toDone ? -1 : 1));
    }
    return json(res, 200, { ok: true, key: newKey });
  }

  return json(res, 404, { error: 'Unknown action' });
}

const ROUTES = { health, config: publicConfig, chat, feedback, admin };

/** Handle /api/<route>. Never throws. */
async function handle(route, req, res) {
  const fn = ROUTES[route];
  try {
    if (!fn) return json(res, 404, { error: 'Not found' });
    return await fn(req, res);
  } catch (e) {
    console.error('API error in', route, e && e.stack);
    if (!res.headersSent) return json(res, 500, { error: 'Server error' });
  }
}

module.exports = { handle, ROUTES: Object.keys(ROUTES) };
