// Shared HTTP helper for the server tests (not a test file itself).
const http = require('http');

function client(getPort) {
  let ipSeq = 0;
  function call(p, { method, body, headers, raw, ip } = {}) {
    return new Promise((resolve, reject) => {
      const data = raw !== undefined ? raw : body === undefined ? null : JSON.stringify(body);
      const req = http.request(
        {
          host: '127.0.0.1',
          port: getPort(),
          path: p,
          method: method || (data != null ? 'POST' : 'GET'),
          headers: {
            'X-Forwarded-For': ip || '10.77.' + ((++ipSeq >> 8) & 255) + '.' + (ipSeq & 255),
            ...(data != null ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
            ...(headers || {}),
          },
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            let j = null;
            try {
              j = JSON.parse(text);
            } catch (e) {
              /* not json */
            }
            resolve({ status: res.statusCode, headers: res.headers, body: j, text });
          });
        }
      );
      req.on('error', reject);
      if (data != null) req.write(data);
      req.end();
    });
  }
  return call;
}

const bearer = (t) => ({ Authorization: 'Bearer ' + t });

async function adminLogin(call, password, extra) {
  const r = await call('/api/admin?a=login', { headers: { 'X-SD-Admin': '1' }, body: { password, ...(extra || {}) } });
  const cookie = r.headers['set-cookie'] ? r.headers['set-cookie'][0].split(';')[0] : null;
  return { r, headers: cookie ? { 'X-SD-Admin': '1', Cookie: cookie } : null };
}

async function signup(call, role, email, extra) {
  const r = await call('/api/account?a=signup', { body: { email, name: role + ' tester', password: 'password-123', role, acceptTerms: true, ...(extra || {}) } });
  if (r.status !== 200) throw new Error('signup failed: ' + r.text);
  return { token: r.body.token, user: r.body.user, h: bearer(r.body.token) };
}

module.exports = { client, bearer, adminLogin, signup };
