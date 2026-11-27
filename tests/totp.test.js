// lib/totp.js against the RFC 4226 (HOTP), RFC 6238 (TOTP) and RFC 4648 (base32) test vectors.
const test = require('node:test');
const assert = require('node:assert/strict');
const totp = require('../lib/totp');

test('base32 matches RFC 4648 (no padding) and round-trips', () => {
  const v = { '': '', f: 'MY', fo: 'MZXQ', foo: 'MZXW6', foob: 'MZXW6YQ', fooba: 'MZXW6YTB', foobar: 'MZXW6YTBOI' };
  for (const [plain, enc] of Object.entries(v)) {
    assert.equal(totp.base32Encode(Buffer.from(plain)), enc);
    assert.equal(totp.base32Decode(enc).toString(), plain);
    assert.equal(totp.base32Decode(enc.toLowerCase() + '===').toString(), plain, 'case and padding ignored');
  }
  assert.throws(() => totp.base32Decode('MZ1!'));
  const s = totp.newSecret();
  assert.match(s, /^[A-Z2-7]{32}$/, '20 random bytes = 32 base32 characters');
  assert.equal(totp.base32Decode(s).length, 20);
});

test('HOTP matches RFC 4226 appendix D', () => {
  const key = Buffer.from('12345678901234567890');
  const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
  expected.forEach((code, i) => assert.equal(totp.hotp(key, i), code, 'counter ' + i));
});

test('TOTP matches RFC 6238 appendix B (SHA1, SHA256, SHA512; 8 digits)', () => {
  const keys = {
    sha1: Buffer.from('12345678901234567890'),
    sha256: Buffer.from('12345678901234567890123456789012'),
    sha512: Buffer.from('1234567890123456789012345678901234567890123456789012345678901234'),
  };
  const table = [
    [59, '94287082', '46119246', '90693936'],
    [1111111109, '07081804', '68084774', '25091201'],
    [1111111111, '14050471', '67062674', '99943326'],
    [1234567890, '89005924', '91819424', '93441116'],
    [2000000000, '69279037', '90698825', '38618901'],
    [20000000000, '65353130', '77737706', '47863826'],
  ];
  for (const [t, s1, s256, s512] of table) {
    const ctr = Math.floor(t / 30);
    assert.equal(totp.hotp(keys.sha1, ctr, 8, 'sha1'), s1, 'sha1 ' + t);
    assert.equal(totp.hotp(keys.sha256, ctr, 8, 'sha256'), s256, 'sha256 ' + t);
    assert.equal(totp.hotp(keys.sha512, ctr, 8, 'sha512'), s512, 'sha512 ' + t);
  }
});

test('6-digit codes as Google Authenticator shows them, ±1 step, no replay', () => {
  const secret = totp.base32Encode(Buffer.from('12345678901234567890'));
  const t = 1111111111 * 1000;
  assert.equal(totp.generate(secret, t), '050471', 'last 6 digits of the RFC value');
  const ctr = Math.floor(1111111111 / 30);
  assert.equal(totp.verify(secret, '050471', { ms: t }), ctr);
  assert.equal(totp.verify(secret, '050 471', { ms: t }), ctr, 'spaces allowed');
  assert.equal(totp.verify(secret, totp.generate(secret, t - 30000), { ms: t }), ctr - 1, 'previous step accepted');
  assert.equal(totp.verify(secret, totp.generate(secret, t + 30000), { ms: t }), ctr + 1, 'next step accepted');
  assert.equal(totp.verify(secret, totp.generate(secret, t - 90000), { ms: t }), -1, 'three steps old is refused');
  assert.equal(totp.verify(secret, '050471', { ms: t, lastCounter: ctr }), -1, 'a used step is never accepted again');
  assert.equal(totp.verify(secret, '12345', { ms: t }), -1);
  assert.equal(totp.verify(secret, 'abcdef', { ms: t }), -1);
  assert.equal(totp.otpauthUrl('ABC', 'Sasta Dawa Admin', 'Sasta Dawa'), 'otpauth://totp/Sasta%20Dawa%20Admin?secret=ABC&issuer=Sasta%20Dawa');
});
