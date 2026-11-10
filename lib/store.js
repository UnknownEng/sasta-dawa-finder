/**
 * Tiny JSON store used by the admin panel and the feedback inbox.
 *
 *  - With a Vercel Blob store connected (BLOB_READ_WRITE_TOKEN, or BLOB_STORE_ID + OIDC): private Blob.
 *  - On Vercel without a store: nothing can be saved (the file system is read-only).
 *  - Anywhere else: JSON files in ./.data (git-ignored).
 *
 * Keys look like "config/site.json" or "feedback/1731234567890-ab12cd.json".
 */
'use strict';

const fs = require('fs');
const path = require('path');

const LOCAL_DIR = process.env.SD_DATA_DIR || path.join(__dirname, '..', '.data');

function safeKey(key) {
  const k = String(key || '');
  if (!/^[a-z0-9][a-z0-9/_.-]{0,200}$/i.test(k) || k.includes('..')) throw new Error('bad key');
  return k;
}

// ---------------------------------------------------------------------------
// Local filesystem backend
// ---------------------------------------------------------------------------
const local = {
  name: 'local files (.data folder)',
  async get(key) {
    try {
      return JSON.parse(fs.readFileSync(path.join(LOCAL_DIR, safeKey(key)), 'utf8'));
    } catch (e) {
      return null;
    }
  },
  async put(key, value) {
    const p = path.join(LOCAL_DIR, safeKey(key));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(value, null, 2));
  },
  async list(prefix) {
    const dir = path.join(LOCAL_DIR, safeKey(prefix.replace(/\/$/, '')));
    let names = [];
    try {
      names = fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
    } catch (e) {
      return [];
    }
    return names.map((n) => ({ key: prefix.replace(/\/?$/, '/') + n, uploadedAt: fs.statSync(path.join(dir, n)).mtime.toISOString() }));
  },
  async del(key) {
    try {
      fs.unlinkSync(path.join(LOCAL_DIR, safeKey(key)));
    } catch (e) {
      /* already gone */
    }
  },
};

// ---------------------------------------------------------------------------
// Vercel Blob backend (private store)
// ---------------------------------------------------------------------------
let blobLib = null;
function blob() {
  if (!blobLib) blobLib = require('@vercel/blob');
  return blobLib;
}

const vercelBlob = {
  name: 'Vercel Blob (private)',
  async get(key) {
    const r = await blob().get(safeKey(key), { access: 'private', useCache: false });
    if (!r || !r.stream) return null;
    const text = await new Response(r.stream).text();
    try {
      return JSON.parse(text);
    } catch (e) {
      return null;
    }
  },
  async put(key, value) {
    await blob().put(safeKey(key), JSON.stringify(value), {
      access: 'private',
      allowOverwrite: true,
      addRandomSuffix: false,
      contentType: 'application/json',
      cacheControlMaxAge: 60,
    });
  },
  async list(prefix) {
    const out = [];
    let cursor;
    do {
      const page = await blob().list({ prefix: safeKey(prefix), cursor, limit: 1000 });
      page.blobs.forEach((b) => out.push({ key: b.pathname, uploadedAt: new Date(b.uploadedAt).toISOString(), url: b.url }));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor && out.length < 5000);
    return out;
  },
  async del(key) {
    const items = await this.list(safeKey(key));
    const hit = items.find((i) => i.key === key);
    if (hit) await blob().del(hit.url);
  },
};

// On Vercel the file system is read-only, so without a Blob store nothing can be saved.
const missing = {
  name: 'NOT CONNECTED: add a Blob store to this Vercel project, then redeploy',
  async get() {
    return null;
  },
  async put() {
    throw new Error('Storage is not connected. In Vercel, add a Blob store to this project and redeploy.');
  },
  async list() {
    return [];
  },
  async del() {
    throw new Error('Storage is not connected.');
  },
};

/** A Blob store connects either with a read-write token or (newer) with BLOB_STORE_ID + Vercel's OIDC token. */
function blobConnected() {
  return !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

function backend() {
  if (blobConnected()) return vercelBlob;
  return process.env.VERCEL ? missing : local;
}

module.exports = {
  get: (k) => backend().get(k),
  put: (k, v) => backend().put(k, v),
  list: (p) => backend().list(p),
  del: (k) => backend().del(k),
  backendName: () => backend().name,
  isConnected: () => backend() !== missing,
  safeKey,
};
