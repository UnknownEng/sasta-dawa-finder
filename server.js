/**
 * Sasta Dawa Finder - web server
 *
 *  - Serves the static app with gzip + sensible caching and security headers
 *  - GET  /api/health  -> { ok, ai, products, latest_price_date }
 *  - POST /api/chat    -> AI assistant (Claude) grounded in the DRAP dataset via tool calls.
 *                         Enabled only when ANTHROPIC_API_KEY is set; otherwise the browser
 *                         uses the built-in offline assistant.
 *
 * Environment:
 *   PORT               (default 3000)
 *   ANTHROPIC_API_KEY  enables the AI assistant
 *   CHAT_MODEL         (default claude-opus-5-5)
 *   CHAT_RATE_LIMIT    requests per IP per 10 minutes (default 30)
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SDData = require('./js/data.js');
const SDSearch = require('./js/search.js');

const PORT = process.env.PORT || 3000;
const ROOT_DIR = path.resolve(__dirname);
const CHAT_MODEL = process.env.CHAT_MODEL || 'claude-opus-5-5';
const RATE_LIMIT = parseInt(process.env.CHAT_RATE_LIMIT || '30', 10);

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
const BLOCKED = /^\/(\.|node_modules|scripts|tests|\.cache|package(-lock)?\.json|server\.js|.*\.md$)/i;

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), camera=(), microphone=(self)',
};

// ---------------------------------------------------------------------------
// Dataset (loaded once, reused by the chat tools)
// ---------------------------------------------------------------------------
let dataset = null;
let engine = null;
function loadDataset() {
  if (engine) return engine;
  const json = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'data', 'medicines.json'), 'utf8'));
  dataset = SDData.expand(json);
  engine = SDSearch.createEngine(dataset);
  return engine;
}

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
// AI chat (Claude)
// ---------------------------------------------------------------------------
let Anthropic = null;
try {
  Anthropic = require('@anthropic-ai/sdk');
  Anthropic = Anthropic.default || Anthropic;
} catch (e) {
  Anthropic = null;
}
let client = null;
function aiEnabled() {
  return !!(Anthropic && process.env.ANTHROPIC_API_KEY);
}
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

const SYSTEM_PROMPT = `You are "Dawa Assistant", the chat helper on Sasta Dawa Finder, a free website that helps people in Pakistan pay less for medicine.

What you do:
- Look up medicines in the website's dataset: the Drug Regulatory Authority of Pakistan (DRAP) public price index, which lists each product's maximum retail price (MRP) in PKR, pack size, manufacturer and the date the price became effective.
- Explain a medicine's formula (active ingredients and strength) and price.
- Find brands with exactly the same formula, strength and dosage form that cost less, and say how much the person would save per tablet / pack.
- Compare two medicines and say plainly whether they are the same formula or different medicines.

How to answer:
- Always use the tools to get prices and formulas. Never state a price, brand, manufacturer or formula that did not come from a tool result in this conversation. If the tools don't find a medicine, say so and suggest checking the spelling or trying the salt name.
- When a brand name is ambiguous (several strengths or forms), pick the most common tablet/capsule strength or the one the person mentioned, and mention that other strengths exist.
- Prices are in Pakistani rupees; write them like "Rs 54.87 per tablet" or "Rs 549 per pack of 10". Mention that these are DRAP maximum retail prices and pharmacies may charge less.
- Reply in the same language and script the person used: English, Urdu script, or Roman Urdu. Keep it short and friendly: 2–5 sentences or a short bullet list, under about 120 words. Use **bold** for medicine names and key prices. No tables, no headings.
- When suggesting a cheaper same-formula brand, add one short line telling them to confirm with their pharmacist or doctor before switching. For medicines where small differences matter (e.g. levothyroxine, warfarin, anti-epileptics such as phenytoin, carbamazepine, valproate, lamotrigine; lithium; digoxin; tacrolimus/ciclosporin), say clearly that switching brands should only be done with the doctor's advice.

Safety limits:
- You are not a doctor. Do not diagnose, do not recommend which medicine to take for a symptom, and do not give doses, schedules, or advice about pregnancy, children's dosing, side effects, interactions, or stopping a medicine. Say kindly that their doctor or pharmacist should answer that, and offer the price/formula information you can give.
- If the message suggests an emergency (overdose, poisoning, chest pain, trouble breathing, unconsciousness, seizures, severe bleeding, thoughts of self-harm), tell them to call Rescue 1122 or Edhi 115 or go to the nearest hospital emergency immediately, before anything else.
- Stay on topic: medicine prices, formulas, alternatives, and how to use this website. For anything else, politely say you can only help with medicine prices and alternatives.`;

const TOOLS = [
  {
    name: 'search_medicines',
    description:
      'Search the DRAP medicine price list by brand name, generic/salt name, strength or dosage form (e.g. "Panadol", "omeprazole 20", "augmentin syrup"). Returns up to 10 matching products with ids, formula, form, pack, pack price and price per unit. Use this first to resolve any medicine the person mentions.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Brand or generic name, optionally with strength or form.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'get_alternatives',
    description:
      'For one product id (from search_medicines), list all brands with exactly the same active ingredients, strength and dosage form, cheapest first, with price per unit and percent saving versus the given product. Also lists other strengths/forms of the same formula.',
    input_schema: {
      type: 'object',
      properties: {
        medicine_id: { type: 'string', description: 'The id field of a product returned by search_medicines.' },
      },
      required: ['medicine_id'],
      additionalProperties: false,
    },
    strict: true,
  },
];

function unitName(m) {
  if (m.unit === 'unit') return /capsule/i.test(m.form) ? 'capsule' : /sachet/i.test(m.form) ? 'sachet' : 'tablet';
  return { dose: 'vial/dose', ml: 'ml', g: 'gram', pack: 'pack' }[m.unit] || m.unit;
}

function brief(m) {
  return {
    id: m.id,
    brand: m.name,
    product: m.product,
    formula: m.generic,
    strength: m.strength,
    form: m.form,
    pack: m.pack,
    pack_price_rs: m.price,
    price_per_unit_rs: Math.round(m.unitPrice * 100) / 100,
    unit: unitName(m),
    manufacturer: m.manufacturer,
    price_effective_from: m.effective,
  };
}

function runTool(name, input, seen) {
  const e = loadDataset();
  if (name === 'search_medicines') {
    const q = String((input && input.query) || '').slice(0, 120);
    const results = e.search(q, { limit: 10 }).map((r) => r.med);
    results.forEach((m) => seen.set(m.id, m));
    if (!results.length) {
      return { results: [], did_you_mean: e.didYouMean(q, 5), note: 'No product matched. Try a suggested spelling or the generic name.' };
    }
    return { results: results.map(brief) };
  }
  if (name === 'get_alternatives') {
    const m = e.byId(String((input && input.medicine_id) || ''));
    if (!m) return { error: 'Unknown medicine_id. Call search_medicines first and use an id from its results.' };
    seen.set(m.id, m);
    const alts = e.alternatives(m, 'unit');
    alts.slice(0, 10).forEach((a) => seen.set(a.id, a));
    const strengths = e.strengths(m).slice(0, 8);
    strengths.forEach((s) => seen.set(s.med.id, s.med));
    return {
      medicine: brief(m),
      same_formula_brand_count: alts.length,
      cheapest_first: alts.slice(0, 10).map((a) => ({
        ...brief(a),
        percent_vs_selected: m.unitPrice > 0 ? Math.round(((a.unitPrice - m.unitPrice) / m.unitPrice) * 100) : 0,
      })),
      other_strengths_or_forms: strengths.map((s) => ({ ...brief(s.med), brands_with_this_formula: s.count })),
    };
  }
  return { error: 'Unknown tool' };
}

// Simple in-memory rate limiter (per IP, sliding 10 min window)
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const list = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(k);
  return list.length > RATE_LIMIT;
}

function validateMessages(body) {
  if (!body || !Array.isArray(body.messages)) return null;
  const msgs = body.messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 1500) }));
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return null;
  // merge consecutive same-role turns
  const merged = [];
  for (const m of msgs) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) last.content += '\n' + m.content;
    else merged.push({ ...m });
  }
  return merged;
}

/** Medicine ids mentioned in the reply, in order of appearance. */
function mentionedIds(reply, seen) {
  const text = reply.toLowerCase();
  const found = [];
  const usedNames = new Set();
  for (const m of seen.values()) {
    const name = m.name.toLowerCase();
    if (usedNames.has(name + m.strength)) continue;
    const idx = text.indexOf(name);
    if (idx < 0) continue;
    // prefer the product whose strength is also mentioned
    const strengthHit = m.strength && text.includes(m.strength.toLowerCase()) ? 0 : 1;
    found.push({ id: m.id, idx, strengthHit, unitPrice: m.unitPrice, name });
    usedNames.add(name + m.strength);
  }
  found.sort((a, b) => a.idx - b.idx || a.strengthHit - b.strengthHit || a.unitPrice - b.unitPrice);
  const ids = [];
  const names = new Set();
  for (const f of found) {
    if (names.has(f.name)) continue;
    names.add(f.name);
    ids.push(f.id);
    if (ids.length >= 5) break;
  }
  return ids;
}

async function chat(messages, lang) {
  const anthropic = getClient();
  const seen = new Map();
  const convo = [...messages];
  if (lang === 'ur') {
    convo.push({ role: 'system', content: 'The website is currently shown in Urdu. If the person writes in Urdu script or Roman Urdu, reply in the same script.' });
  }
  for (let turn = 0; turn < 6; turn++) {
    const response = await anthropic.beta.messages.create({
      model: CHAT_MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: TOOLS,
      messages: convo,
    });

    if (response.stop_reason === 'refusal') {
      const err = new Error('refusal');
      err.code = 'refusal';
      throw err;
    }

    const toolUses = response.content.filter((b) => b.type === 'tool_use');
    if (response.stop_reason === 'tool_use' && toolUses.length) {
      convo.push({ role: 'assistant', content: response.content });
      convo.push({
        role: 'user',
        content: toolUses.map((tu) => {
          let result;
          try {
            result = runTool(tu.name, tu.input, seen);
          } catch (e) {
            return { type: 'tool_result', tool_use_id: tu.id, is_error: true, content: 'Tool failed: ' + e.message };
          }
          return { type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result) };
        }),
      });
      continue;
    }

    const reply = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    if (!reply) throw new Error('empty reply');
    return { reply, medicine_ids: mentionedIds(reply, seen) };
  }
  throw new Error('too many tool rounds');
}

function readJson(req, limit) {
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

function json(req, res, status, obj) {
  send(req, res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, '.json');
}

async function handleChat(req, res) {
  if (!aiEnabled()) return json(req, res, 503, { error: 'AI assistant is not configured' });
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  if (rateLimited(ip)) return json(req, res, 429, { error: 'Too many messages. Please wait a few minutes.' });
  let body;
  try {
    body = await readJson(req, 32 * 1024);
  } catch (e) {
    return json(req, res, e.status || 400, { error: e.message });
  }
  const messages = validateMessages(body);
  if (!messages) return json(req, res, 400, { error: 'Invalid messages' });
  try {
    const out = await chat(messages, body.lang === 'ur' ? 'ur' : 'en');
    return json(req, res, 200, out);
  } catch (e) {
    if (Anthropic && e instanceof Anthropic.RateLimitError) return json(req, res, 429, { error: 'Assistant is busy, please retry.' });
    if (Anthropic && e instanceof Anthropic.AuthenticationError) console.error('Chat: invalid ANTHROPIC_API_KEY');
    else console.error('Chat error:', e && e.message);
    // The browser falls back to the offline assistant on any non-200
    return json(req, res, 502, { error: 'Assistant unavailable' });
  }
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (e) {
    return send(req, res, 400, 'Bad request', { 'Content-Type': 'text/plain' }, '.txt');
  }

  if (pathname === '/api/health') {
    let info = {};
    try {
      const e = loadDataset();
      info = { products: e.stats().products, latest_price_date: dataset.meta.latest_price_date };
    } catch (err) {
      info = { error: 'dataset unavailable' };
    }
    return json(req, res, 200, { ok: true, ai: aiEnabled(), ...info });
  }
  if (pathname === '/api/chat') {
    if (req.method !== 'POST') return json(req, res, 405, { error: 'POST only' });
    return handleChat(req, res);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(req, res, 405, 'Method not allowed', { 'Content-Type': 'text/plain', Allow: 'GET, HEAD' }, '.txt');
  }

  if (pathname === '/' || pathname === '/index.html') {
    return send(req, res, 200, getPreRenderedHTML(), { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400' }, '.html');
  }

  const filePath = path.normalize(path.join(ROOT_DIR, pathname));
  if (!filePath.startsWith(ROOT_DIR + path.sep) || BLOCKED.test(pathname)) {
    return send(req, res, 404, get404HTML(), { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex', 'Cache-Control': 'no-cache' }, '.html');
  }
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      return send(req, res, 404, get404HTML(), { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex, follow', 'Cache-Control': 'no-cache' }, '.html');
    }
    serveFile(req, res, filePath, stats);
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Sasta Dawa Finder running at http://localhost:${PORT}`);
    console.log(aiEnabled() ? `AI assistant: enabled (${CHAT_MODEL})` : 'AI assistant: off (set ANTHROPIC_API_KEY to enable); offline assistant is used.');
  });
}

function _setClientForTests(c) {
  client = c;
}

module.exports = { server, getPreRenderedHTML, get404HTML, runTool, validateMessages, mentionedIds, chat, TOOLS, SYSTEM_PROMPT, _setClientForTests };
