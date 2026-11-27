/**
 * Strict CSV imports and safe CSV exports.
 *
 *  - parse(): RFC 4180 (quoted fields, "" escapes, CRLF or LF), max 2 MB and 5000 data rows.
 *  - parseTemplate(): the header must match one of TEMPLATES exactly (names, order; case and
 *    surrounding spaces are ignored). Every data row must have the same number of columns.
 *  - runImport(): validates each row; collects { row, error } (row = spreadsheet row number,
 *    the header is row 1).
 *  - toCsv(): export helper. Cells starting with = + - @ tab or CR get a leading ' so
 *    spreadsheet apps never run them as formulas.
 */
'use strict';

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 5000;

const TEMPLATES = {
  stock: {
    header: ['medicine', 'status', 'price'],
    examples: [
      ['Panadol Tablets', 'in', '35'],
      ['Augmentin', 'out', ''],
    ],
  },
  refills: {
    header: ['name', 'phone', 'medicines', 'every_days', 'last_refill_date'],
    examples: [
      ['Ali Khan', '03001234567', 'Panadol Tablets;Augmentin', '30', '2026-11-01'],
      ['Sara Ahmed', '03111234567', 'Glucophage', '30', '2026-11-15'],
    ],
  },
  list: {
    header: ['medicine', 'quantity'],
    examples: [
      ['Panadol Tablets', '500'],
      ['Augmentin', '100'],
    ],
  },
  claims: {
    header: ['medicine', 'quantity', 'amount_paid'],
    examples: [
      ['Panadol Tablets', '200', '900'],
      ['Augmentin', '14', ''],
    ],
  },
  overrides: {
    header: ['medicine_id', 'price', 'hide', 'note'],
    examples: [
      ['panadol-tablets-101138', '35', 'no', 'New DRAP notice'],
      ['paracetamol-suspension-002838', '', 'yes', 'Withdrawn from market'],
    ],
  },
  pharmacies: {
    header: ['name', 'address', 'area', 'city', 'phone', 'whatsapp', 'hours', 'lat', 'lng', 'owner_email'],
    examples: [
      ['Shifa Pharmacy', '12 Main Boulevard', 'Gulberg', 'Lahore', '04235761234', '03001234567', '9am-11pm', '31.5204', '74.3587', 'owner@example.com'],
      ['City Medicos', 'Shop 4, Blue Area', 'F-6', 'Islamabad', '0512345678', '', '24 hours', '', '', 'owner2@example.com'],
    ],
  },
};

const fail = (status, message, extra) => Object.assign(new Error(message), { status }, extra || {});

/** RFC 4180 parser. Returns an array of records; each record is { row, fields }. */
function parse(text, opts) {
  const maxBytes = (opts && opts.maxBytes) || MAX_BYTES;
  const maxRows = (opts && opts.maxRows) || MAX_ROWS;
  if (typeof text !== 'string') throw fail(400, 'Send the CSV file as text in the "csv" field.');
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw fail(413, `The file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  let s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records = [];
  let fields = [];
  let field = '';
  let inQuotes = false;
  let quoted = false; // current field was quoted (and the quote is closed)
  let rowNo = 1;
  let started = false; // the current record has any content
  const endField = () => {
    fields.push(field);
    field = '';
    quoted = false;
  };
  const endRecord = () => {
    endField();
    const blank = fields.length === 1 && fields[0] === '' && !started;
    if (!blank) records.push({ row: rowNo, fields });
    if (records.length > maxRows + 1) throw fail(413, `Too many rows: the limit is ${maxRows} rows per file.`);
    fields = [];
    started = false;
    rowNo++;
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
          quoted = true;
        }
      } else field += c;
      continue;
    }
    if (c === ',') {
      started = true;
      endField();
    } else if (c === '\r' || c === '\n') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      endRecord();
    } else if (c === '"') {
      if (field !== '' || quoted) throw fail(400, `Row ${rowNo}: a quote (") must surround the whole cell.`);
      inQuotes = true;
      started = true;
    } else {
      if (quoted) throw fail(400, `Row ${rowNo}: unexpected text after a closing quote.`);
      field += c;
      started = true;
    }
  }
  if (inQuotes) throw fail(400, `Row ${rowNo}: a quoted cell is never closed.`);
  if (field !== '' || fields.length || quoted || started) endRecord();
  return records;
}

/**
 * Parse a file against a template. Returns { records: [{ row, data }], errors: [{ row, error }] }.
 * Throws 400 { expected, got } when the header doesn't match.
 */
function parseTemplate(text, type, opts) {
  const t = TEMPLATES[type];
  if (!t) throw fail(400, 'Unknown template.');
  const recs = parse(text, opts);
  if (!recs.length) throw fail(400, 'The file is empty.');
  const got = recs[0].fields.map((h) => h.trim().toLowerCase());
  if (got.length !== t.header.length || got.some((h, i) => h !== t.header[i])) {
    throw fail(400, `The first row must be exactly: ${t.header.join(',')}`, { expected: t.header, got: recs[0].fields.slice(0, 30) });
  }
  const records = [];
  const errors = [];
  for (const r of recs.slice(1)) {
    if (r.fields.length !== t.header.length) {
      errors.push({ row: r.row, error: `Expected ${t.header.length} columns, found ${r.fields.length}.` });
      continue;
    }
    const data = {};
    t.header.forEach((h, i) => (data[h] = r.fields[i].trim()));
    records.push({ row: r.row, data });
  }
  if (records.length + errors.length > ((opts && opts.maxRows) || MAX_ROWS)) throw fail(413, `Too many rows: the limit is ${(opts && opts.maxRows) || MAX_ROWS} rows per file.`);
  return { records, errors };
}

/**
 * Validate every record with `validate(data, row)` (throw an Error with a plain message for a bad row).
 * Returns { good: [{ row, value }], errors }. With partial=false and any error, throws 400 and nothing
 * should be imported.
 */
function runImport(parsed, validate, partial) {
  const errors = parsed.errors.slice();
  const good = [];
  for (const r of parsed.records) {
    try {
      good.push({ row: r.row, value: validate(r.data, r.row) });
    } catch (e) {
      errors.push({ row: r.row, error: String((e && e.message) || 'Invalid row').slice(0, 200) });
    }
  }
  errors.sort((a, b) => a.row - b.row);
  if (errors.length && !partial) {
    throw fail(400, `${errors.length} row${errors.length === 1 ? ' has' : 's have'} problems, so nothing was imported. Fix ${errors.length === 1 ? 'it' : 'them'} and try again, or import only the good rows.`, { errors: errors.slice(0, 200), imported: 0 });
  }
  if (!good.length) throw fail(400, errors.length ? 'No row could be imported.' : 'The file has no rows under the header.', { errors: errors.slice(0, 200), imported: 0 });
  return { good, errors: errors.slice(0, 200) };
}

/** One cell, safe for spreadsheets (formula injection) and quoted per RFC 4180. */
function cell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\r\n]/.test(s) || /^\s|\s$/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function toCsv(header, rows) {
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

function template(type) {
  const t = TEMPLATES[type];
  return t ? toCsv(t.header, t.examples) : null;
}

/** Send CSV text as a download. */
function send(res, filename, text) {
  const body = Buffer.from(text, 'utf8');
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${String(filename).replace(/[^A-Za-z0-9._-]/g, '_')}"`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    'Content-Length': body.length,
  });
  res.end(body);
}

module.exports = { parse, parseTemplate, runImport, toCsv, cell, template, send, TEMPLATES, MAX_BYTES, MAX_ROWS };
