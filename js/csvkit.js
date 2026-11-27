/**
 * Sasta Dawa Finder - CSV import helpers and upload checks, shared by the account portal and the admin panel.
 * Everything here runs in the browser BEFORE a file is sent, so people get clear messages early.
 * The server checks everything again (lib/csv.js, lib/guard.js): these checks are for convenience, not security.
 *
 *   SDCsv.TEMPLATES[type]          -> { headers, example, title }
 *   SDCsv.templateCsv(type)        -> template text (header + one example row)
 *   SDCsv.readCsvFile(file)        -> Promise<text>  (rejects with a friendly Error)
 *   SDCsv.parse(text)              -> { rows: string[][], error }
 *   SDCsv.check(type, text)        -> { headerError, total, errors:[{row, error}], preview:[{row, cells, error}] }
 *   SDCsv.sniffImage(bytes)        -> 'jpeg' | 'png' | 'webp' | null
 *   SDCsv.checkImageFile(file)     -> Promise<'jpeg'|'png'|'webp'> (rejects with a friendly Error)
 */
(function (root) {
  'use strict';

  const MAX_CSV_BYTES = 2 * 1024 * 1024;
  const MAX_ROWS = 5000;
  const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

  const num = (s) => (/^\d+(\.\d+)?$/.test(String(s).trim()) ? Number(s) : NaN);
  const isInt = (s) => /^\d+$/.test(String(s).trim());
  const isDate = (s) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(s + 'T00:00:00Z');
    return !isNaN(d) && d.toISOString().slice(0, 10) === s;
  };
  const phoneOk = (s) => {
    const d = String(s).replace(/[\s()-]/g, '');
    return /^\+?\d{10,13}$/.test(d);
  };
  const emailOk = (s) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(s);
  const yesNo = (s) => /^(|yes|no|y|n|true|false|1|0)$/i.test(String(s).trim());
  const isYes = (s) => /^(yes|y|true|1)$/i.test(String(s).trim());

  /** Strict templates: header names must match exactly (case and spaces around names are ignored). */
  const TEMPLATES = {
    stock: {
      title: 'Pharmacy stock',
      headers: ['medicine', 'status', 'price'],
      example: [['Panadol 500mg', 'in', '35'], ['Augmentin 625mg', 'out', '']],
      check(r) {
        if (!r.medicine) return 'medicine is empty (use the brand and strength, or the medicine id)';
        if (!/^(in|out)$/i.test(r.status)) return 'status must be "in" or "out"';
        if (r.price !== '' && !(num(r.price) > 0)) return 'price must be a number like 35 or 120.50 (or empty)';
        return '';
      },
    },
    refills: {
      title: 'Refill customers',
      headers: ['name', 'phone', 'medicines', 'every_days', 'last_refill_date'],
      example: [['Ahmed Khan', '03001234567', 'Glucophage 500mg;Concor 5mg', '30', '2026-11-01']],
      check(r) {
        if (!r.name) return 'name is empty';
        if (!phoneOk(r.phone)) return 'phone must be a mobile number like 03001234567';
        if (!r.medicines) return 'medicines is empty (separate several with ;)';
        if (!isInt(r.every_days) || Number(r.every_days) < 1 || Number(r.every_days) > 365) return 'every_days must be a whole number from 1 to 365';
        if (r.last_refill_date !== '' && !isDate(r.last_refill_date)) return 'last_refill_date must look like 2026-11-01 (year-month-day) or be empty';
        return '';
      },
    },
    list: {
      title: 'NGO medicine list',
      headers: ['medicine', 'quantity'],
      example: [['Panadol 500mg', '200'], ['Glucophage 500mg', '600']],
      check(r) {
        if (!r.medicine) return 'medicine is empty';
        if (!isInt(r.quantity) || Number(r.quantity) < 1 || Number(r.quantity) > 1000000) return 'quantity must be a whole number from 1 to 1,000,000';
        return '';
      },
    },
    claims: {
      title: 'Company claims',
      headers: ['medicine', 'quantity', 'amount_paid'],
      example: [['Augmentin 625mg', '14', '1150'], ['Glucophage 500mg', '60', '']],
      check(r) {
        if (!r.medicine) return 'medicine is empty';
        if (!(num(r.quantity) > 0)) return 'quantity must be a number above 0';
        if (r.amount_paid !== '' && !(num(r.amount_paid) >= 0)) return 'amount_paid must be a number like 1150 (or empty to use the DRAP price)';
        return '';
      },
    },
    overrides: {
      title: 'Price corrections',
      headers: ['medicine_id', 'price', 'hide', 'note'],
      example: [['(medicine id from the site)', '120', 'no', 'Pharmacy receipt shows Rs 120']],
      check(r) {
        if (!r.medicine_id) return 'medicine_id is empty';
        if (!yesNo(r.hide)) return 'hide must be yes or no (or empty)';
        if (!isYes(r.hide) && !(num(r.price) > 0)) return 'price must be a number above 0 (or set hide to yes)';
        if (r.price !== '' && !(num(r.price) > 0)) return 'price must be a number above 0 (or empty when hide is yes)';
        if (r.note.length > 200) return 'note is longer than 200 characters';
        return '';
      },
    },
    pharmacies: {
      title: 'Pharmacies',
      headers: ['name', 'address', 'area', 'city', 'phone', 'whatsapp', 'hours', 'lat', 'lng', 'owner_email'],
      example: [['Al-Shifa Pharmacy', 'Shop 4, Main Market', 'G-9 Markaz', 'Islamabad', '0512345678', '03001234567', '9am to 11pm', '33.6938', '73.0336', 'owner@example.com']],
      check(r) {
        if (!r.name) return 'name is empty';
        if (!r.address) return 'address is empty';
        if (!r.city) return 'city is empty';
        if (r.phone && !phoneOk(r.phone)) return 'phone must be a number like 0512345678';
        if (r.whatsapp && !phoneOk(r.whatsapp)) return 'whatsapp must be a number like 03001234567';
        if ((r.lat === '') !== (r.lng === '')) return 'give both lat and lng, or leave both empty';
        if (r.lat !== '') {
          const la = Number(r.lat);
          const ln = Number(r.lng);
          if (!isFinite(la) || la < -90 || la > 90 || !isFinite(ln) || ln < -180 || ln > 180) return 'lat / lng must be map coordinates like 33.6938 and 73.0336';
        }
        if (!emailOk(r.owner_email)) return 'owner_email must be the email of an existing pharmacy account';
        return '';
      },
    },
  };

  function csvCell(v) {
    const s = String(v == null ? '' : v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function templateCsv(type) {
    const t = TEMPLATES[type];
    if (!t) throw new Error('Unknown template');
    return [t.headers].concat(t.example).map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }

  /** RFC 4180: comma separated, "quoted" cells, "" inside quotes, CRLF or LF line ends. */
  function parse(text) {
    const s = String(text || '').replace(/^﻿/, '');
    const rows = [];
    let row = [];
    let cell = '';
    let q = false;
    let quotedCell = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) {
        if (c === '"' && s[i + 1] === '"') {
          cell += '"';
          i++;
        } else if (c === '"') {
          q = false;
          const n = s[i + 1];
          if (n !== undefined && n !== ',' && n !== '\n' && n !== '\r') return { rows, error: `Row ${rows.length + 1}: unexpected text after a closing quote` };
        } else cell += c;
      } else if (c === '"') {
        if (cell !== '') return { rows, error: `Row ${rows.length + 1}: a quote (") can only start a cell. Put the whole cell in quotes.` };
        q = true;
        quotedCell = true;
      } else if (c === ',') {
        row.push(cell);
        cell = '';
        quotedCell = false;
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && s[i + 1] === '\n') i++;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
        quotedCell = false;
      } else cell += c;
    }
    if (q) return { rows, error: `Row ${rows.length + 1}: a quoted cell is never closed (missing ")` };
    if (cell !== '' || row.length || quotedCell) {
      row.push(cell);
      rows.push(row);
    }
    // drop completely empty lines (but keep their numbering out of the way: they are only at the end in practice)
    while (rows.length && rows[rows.length - 1].every((x) => x.trim() === '')) rows.pop();
    return { rows, error: '' };
  }

  /** Validates a CSV against a template. Row numbers are spreadsheet rows (the header is row 1). */
  function check(type, text) {
    const t = TEMPLATES[type];
    const out = { headerError: '', total: 0, errors: [], preview: [], headers: t ? t.headers : [] };
    if (!t) {
      out.headerError = 'Unknown import type.';
      return out;
    }
    const p = parse(text);
    if (p.error) {
      out.headerError = p.error;
      return out;
    }
    if (!p.rows.length) {
      out.headerError = 'The file is empty.';
      return out;
    }
    const head = p.rows[0].map((h) => h.trim().toLowerCase());
    if (head.length !== t.headers.length || head.some((h, i) => h !== t.headers[i])) {
      out.headerError = `The first row must be exactly: ${t.headers.join(',')}. Your file has: ${p.rows[0].join(',') || '(empty)'}. Download the template and copy your data into it.`;
      return out;
    }
    const data = p.rows.slice(1);
    out.total = data.filter((r) => r.some((x) => x.trim() !== '')).length;
    if (!out.total) {
      out.headerError = 'The file only has the header row. Add your data under it.';
      return out;
    }
    if (out.total > MAX_ROWS) {
      out.headerError = `Too many rows (${out.total}). The limit is ${MAX_ROWS} per file: split it into smaller files.`;
      return out;
    }
    data.forEach((cells, i) => {
      if (cells.every((x) => x.trim() === '')) return;
      const rowNo = i + 2;
      let error = '';
      if (cells.length !== t.headers.length) error = `has ${cells.length} cells, expected ${t.headers.length}`;
      else {
        const r = {};
        t.headers.forEach((h, j) => (r[h] = cells[j].trim()));
        error = t.check(r);
      }
      if (error) out.errors.push({ row: rowNo, error });
      if (out.preview.length < 10) out.preview.push({ row: rowNo, cells, error });
    });
    return out;
  }

  function readBytes(file) {
    if (file && typeof file.arrayBuffer === 'function') return file.arrayBuffer().then((b) => new Uint8Array(b));
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(new Uint8Array(fr.result));
      fr.onerror = () => reject(new Error('Could not read the file.'));
      fr.readAsArrayBuffer(file);
    });
  }

  /** Checks a chosen CSV file (name/type, size, no binary bytes) and returns its text. */
  function readCsvFile(file) {
    if (!file || !file.name) return Promise.reject(new Error('Choose a CSV file first.'));
    if (/\.(xlsx?|xlsm|ods|numbers|pdf|docx?|zip)$/i.test(file.name)) {
      return Promise.reject(new Error('This is not a CSV file. In Excel or Google Sheets use File → Save as / Download → CSV, then choose that file.'));
    }
    const typeOk = !file.type || /^(text\/(csv|plain|comma-separated-values)|application\/(csv|vnd\.ms-excel))$/i.test(file.type);
    if (!/\.(csv|txt)$/i.test(file.name) || !typeOk) return Promise.reject(new Error('Please choose a .csv file.'));
    if (!file.size) return Promise.reject(new Error('The file is empty.'));
    if (file.size > MAX_CSV_BYTES) return Promise.reject(new Error('The file is too large (2 MB max). Split it into smaller files.'));
    return readBytes(file).then((bytes) => {
      if (bytes[0] === 0x50 && bytes[1] === 0x4b) throw new Error('This is an Excel/zip file renamed to .csv. In Excel use File → Save as → CSV UTF-8.');
      for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i];
        if (b === 0 || (b < 0x09) || (b > 0x0d && b < 0x20 && b !== 0x1b)) throw new Error('The file contains binary data, so it is not a plain CSV file.');
      }
      try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
      } catch (e) {
        try {
          return new TextDecoder('windows-1252').decode(bytes); // older Excel "CSV (Comma delimited)"
        } catch (e2) {
          throw new Error('Save the file as "CSV UTF-8" and try again.');
        }
      }
    });
  }

  /** Image type from the first bytes (the file name and browser type can lie). */
  function sniffImage(bytes) {
    const b = bytes || [];
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
    return null;
  }

  /** Accepts only real JPEG / PNG / WEBP photos up to 4 MB. */
  function checkImageFile(file, maxBytes) {
    const max = maxBytes || MAX_IMAGE_BYTES;
    if (!file) return Promise.reject(new Error('Choose a photo first.'));
    if (file.size > max) return Promise.reject(new Error('The photo is too large (4 MB max).'));
    return readBytes(file.slice ? file.slice(0, 16) : file).then((bytes) => {
      const kind = sniffImage(bytes);
      if (!kind) throw new Error('Only JPEG, PNG or WEBP photos can be uploaded.');
      return kind;
    });
  }

  const api = { TEMPLATES, MAX_CSV_BYTES, MAX_ROWS, MAX_IMAGE_BYTES, templateCsv, parse, check, readCsvFile, sniffImage, checkImageFile, csvCell };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SDCsv = api;
})(typeof window !== 'undefined' ? window : null);
