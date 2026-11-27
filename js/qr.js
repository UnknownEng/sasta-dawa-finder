/**
 * Sasta Dawa Finder - tiny QR code encoder (no library), shared by the account portal
 * (pharmacy counter sticker) and the admin panel (2-step login setup).
 * Byte mode, error correction M, versions 1-6 (up to 106 bytes of text).
 *   window.SDQR.qrSvg(text) -> safe SVG markup (numbers only)
 *   window.SDQR.qrMatrix(text) -> boolean[][]
 */
(function (root) {
  'use strict';

  // ===========================================================================
  // QR code generator (byte mode, error correction M, versions 1-6 -> up to 106 bytes)
  // ===========================================================================
  const QR_TOTAL = [0, 26, 44, 70, 100, 134, 172]; // total codewords per version
  const QR_EC = [0, 10, 16, 26, 18, 24, 16]; // EC codewords per block (level M)
  const QR_BLOCKS = [0, 1, 1, 1, 2, 2, 4]; // number of blocks (level M)
  const QR_ALIGN = [0, 0, 18, 22, 26, 30, 34]; // the one alignment pattern centre (v2-6)

  function gfMul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xff;
  }
  function rsDivisor(degree) {
    const r = new Array(degree).fill(0);
    r[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < degree; j++) {
        r[j] = gfMul(r[j], root);
        if (j + 1 < degree) r[j] ^= r[j + 1];
      }
      root = gfMul(root, 2);
    }
    return r;
  }
  function rsRemainder(data, div) {
    const r = new Array(div.length).fill(0);
    for (const b of data) {
      const f = b ^ r.shift();
      r.push(0);
      div.forEach((c, i) => (r[i] ^= gfMul(c, f)));
    }
    return r;
  }

  /** Returns a square boolean matrix (true = dark) for the text, or throws if it is too long. */
  function qrMatrix(text, forceMask) {
    const bytes = Array.from(new TextEncoder().encode(String(text)));
    let ver = 0;
    for (let v = 1; v <= 6; v++) {
      const dataCap = QR_TOTAL[v] - QR_EC[v] * QR_BLOCKS[v];
      if (4 + 8 + bytes.length * 8 <= dataCap * 8) {
        ver = v;
        break;
      }
    }
    if (!ver) throw new Error('Text too long for QR');
    const total = QR_TOTAL[ver];
    const ecLen = QR_EC[ver];
    const nBlocks = QR_BLOCKS[ver];
    const dataCap = total - ecLen * nBlocks;

    // Bit stream
    const bits = [];
    const put = (val, len) => {
      for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
    };
    put(4, 4);
    put(bytes.length, 8);
    bytes.forEach((b) => put(b, 8));
    put(0, Math.min(4, dataCap * 8 - bits.length));
    while (bits.length % 8) bits.push(0);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
    for (let pad = 0xec; data.length < dataCap; pad ^= 0xec ^ 0x11) data.push(pad);

    // Blocks + error correction, interleaved
    const numShort = nBlocks - (total % nBlocks);
    const shortLen = Math.floor(total / nBlocks);
    const div = rsDivisor(ecLen);
    const blocks = [];
    for (let i = 0, k = 0; i < nBlocks; i++) {
      const dl = shortLen - ecLen + (i < numShort ? 0 : 1);
      const d = data.slice(k, k + dl);
      k += dl;
      const ec = rsRemainder(d, div);
      if (i < numShort) d.push(-1); // placeholder so all blocks line up
      blocks.push(d.concat(ec));
    }
    const words = [];
    for (let i = 0; i < blocks[0].length; i++) {
      blocks.forEach((b, j) => {
        if (i !== shortLen - ecLen || j >= numShort) words.push(b[i]);
      });
    }

    // Matrix + function patterns
    const size = ver * 4 + 17;
    const mod = Array.from({ length: size }, () => new Array(size).fill(false));
    const fn = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (x, y, dark) => {
      mod[y][x] = dark;
      fn[y][x] = true;
    };
    for (let i = 0; i < size; i++) {
      set(6, i, i % 2 === 0);
      set(i, 6, i % 2 === 0);
    }
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= size || y >= size) continue;
          const d = Math.max(Math.abs(dx), Math.abs(dy));
          set(x, y, d !== 2 && d !== 4);
        }
      }
    };
    finder(3, 3);
    finder(size - 4, 3);
    finder(3, size - 4);
    if (ver >= 2) {
      const c = QR_ALIGN[ver];
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(c + dx, c + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
    const drawFormat = (mask) => {
      const dataBits = (0 << 3) | mask; // level M = 00
      let rem = dataBits;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const fb = ((dataBits << 10) | rem) ^ 0x5412;
      const bit = (i) => ((fb >>> i) & 1) === 1;
      for (let i = 0; i <= 5; i++) set(8, i, bit(i));
      set(8, 7, bit(6));
      set(8, 8, bit(7));
      set(7, 8, bit(8));
      for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
      set(8, size - 8, true);
    };
    drawFormat(0); // reserve the format areas

    // Codewords (zig-zag)
    let bi = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const up = ((right + 1) & 2) === 0;
          const y = up ? size - 1 - vert : vert;
          if (!fn[y][x] && bi < words.length * 8) {
            mod[y][x] = ((words[bi >>> 3] >>> (7 - (bi & 7))) & 1) === 1;
            bi++;
          }
        }
      }
    }

    const maskFn = [
      (x, y) => (x + y) % 2 === 0,
      (x, y) => y % 2 === 0,
      (x) => x % 3 === 0,
      (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
      (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
      (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
      (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
    ];
    const applyMask = (m) => {
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && maskFn[m](x, y)) mod[y][x] = !mod[y][x];
    };
    const penalty = () => {
      let p = 0;
      const line = (get) => {
        for (let a = 0; a < size; a++) {
          let run = 1;
          for (let b = 1; b <= size; b++) {
            if (b < size && get(a, b) === get(a, b - 1)) run++;
            else {
              if (run >= 5) p += 3 + run - 5;
              run = 1;
            }
          }
          for (let b = 0; b + 11 <= size; b++) {
            const s = [];
            for (let k = 0; k < 11; k++) s.push(get(a, b + k) ? 1 : 0);
            const t = s.join('');
            if (t === '10111010000' || t === '00001011101') p += 40;
          }
        }
      };
      line((a, b) => mod[a][b]);
      line((a, b) => mod[b][a]);
      let dark = 0;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          if (mod[y][x]) dark++;
          if (x < size - 1 && y < size - 1) {
            const c = mod[y][x];
            if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) p += 3;
          }
        }
      }
      p += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
      return p;
    };
    let best = forceMask;
    if (best == null) {
      let bestP = Infinity;
      for (let m = 0; m < 8; m++) {
        applyMask(m);
        drawFormat(m);
        const p = penalty();
        if (p < bestP) {
          bestP = p;
          best = m;
        }
        applyMask(m); // undo
      }
    }
    applyMask(best);
    drawFormat(best);
    return mod;
  }

  /** SVG markup (safe: only numbers) for a QR matrix with a 4-module quiet zone. */
  function qrSvg(text) {
    const m = qrMatrix(text);
    const n = m.length + 8;
    let d = '';
    m.forEach((row, y) => row.forEach((dark, x) => {
      if (dark) d += `M${x + 4} ${y + 4}h1v1h-1z`;
    }));
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="260" height="260" role="img" aria-label="QR code" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  }

  const api = { qrMatrix, qrSvg };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SDQR = api;
})(typeof window !== 'undefined' ? window : null);
