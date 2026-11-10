// Which storage the admin panel uses, depending on how Vercel connected the Blob store.
const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('../lib/store');

function withEnv(env, fn) {
  const keys = ['VERCEL', 'BLOB_READ_WRITE_TOKEN', 'BLOB_STORE_ID'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  keys.forEach((k) => delete process.env[k]);
  Object.assign(process.env, env);
  try {
    return fn();
  } finally {
    keys.forEach((k) => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k])));
  }
}

test('storage: local files on a PC', () => {
  withEnv({}, () => {
    assert.match(store.backendName(), /local/);
    assert.equal(store.isConnected(), true);
  });
});

test('storage: Vercel Blob via read-write token or via BLOB_STORE_ID (OIDC)', () => {
  withEnv({ VERCEL: '1', BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_x_y' }, () => assert.match(store.backendName(), /Vercel Blob/));
  withEnv({ VERCEL: '1', BLOB_STORE_ID: 'store_abc' }, () => assert.match(store.backendName(), /Vercel Blob/));
});

test('storage: on Vercel without a store it says so and refuses to save', async () => {
  const { get, put } = withEnv({ VERCEL: '1' }, () => {
    assert.match(store.backendName(), /NOT CONNECTED/);
    assert.equal(store.isConnected(), false);
    // start both calls while the Vercel-without-store environment is active
    return { get: store.get('config/site.json'), put: store.put('config/site.json', {}) };
  });
  assert.equal(await get, null);
  await assert.rejects(put, /not connected/i);
});
