/**
 * Sasta Dawa Finder - DRAP record normalizer
 *
 * Turns raw rows from DRAP's public "Pharmaceutical Product Price Index"
 * (https://e.dra.gov.pk/public/price) into clean, comparable medicine records:
 *   - extracts active ingredients + strengths from free-text compositions
 *   - detects dosage form (and modified-release variants, which are NOT interchangeable)
 *   - parses pack sizes so we can compare price per tablet / ml / gram
 *   - builds a conservative "salt group" key: two products are only listed as
 *     alternatives when ingredients, strengths, dosage form and release type all match.
 *
 * Pure functions only (no I/O) so they can be unit-tested.
 */
'use strict';

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

function squash(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function titleCaseIfShouting(s) {
  const letters = s.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 3 && letters === letters.toUpperCase()) {
    return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
  }
  return s;
}

function slug(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------------------
// Ingredient name normalization
// ---------------------------------------------------------------------------

// Spelling variants seen in DRAP data -> canonical name
const SPELLING = [
  [/\bamoxycillin\b/g, 'amoxicillin'],
  [/\bamoxicilin\b/g, 'amoxicillin'],
  [/\bclau?lanic\b/g, 'clavulanic'],
  [/\bclavulanate\b/g, 'clavulanic acid'],
  [/\bclavulanic(?! acid)\b/g, 'clavulanic acid'],
  [/\bpipr?acillin\b/g, 'piperacillin'],
  [/\btazobactum\b/g, 'tazobactam'],
  [/\bacetaminophen\b/g, 'paracetamol'],
  [/\balbuterol\b/g, 'salbutamol'],
  [/\bcephalexin\b/g, 'cefalexin'],
  [/\bcephradine\b/g, 'cefradine'],
  [/\bsulphate\b/g, 'sulfate'],
  [/\bsulpha/g, 'sulfa'],
  [/\bsulphur\b/g, 'sulfur'],
  [/\bdipyrone\b|\bnovaminsulfon\b|\bnovaminsulphon\b|\banalgin\b/g, 'metamizole'],
  [/\bmetamizole sodium\b/g, 'metamizole'],
  [/\bhyoscine-?n-?butyl ?bromide\b/g, 'hyoscine butylbromide'],
  [/\bbutyl ?bromide\b/g, 'butylbromide'],
  [/\bvitamin\s+b\s*(\d+)\b/g, 'vitamin b$1'],
  [/\bcholecalciferol\b/g, 'cholecalciferol (vitamin d3)'],
  [/\bacetyl ?salicylic acid\b/g, 'aspirin'],
  [/\bglibenclamide\b/g, 'glibenclamide'],
  [/\brosuvastatin calcium\b/g, 'rosuvastatin'],
  [/\batorvastatin calcium\b/g, 'atorvastatin'],
  [/\besomeprazole magnesium\b/g, 'esomeprazole'],
  [/\bomeprazole magnesium\b/g, 'omeprazole'],
  [/\bfrusemide\b/g, 'furosemide'],
  [/\blignocaine\b/g, 'lidocaine'],
  [/\badrenaline\b/g, 'epinephrine'],
  [/\bco-?amoxiclav\b/g, 'amoxicillin clavulanic acid'],
];

// Salt / hydrate / pharmacopoeia words removed when they are NOT the first word.
const SALT_WORDS = new Set([
  'sodium', 'potassium', 'calcium', 'magnesium', 'hydrochloride', 'hcl', 'hci', 'hydrobromide', 'hbr',
  'sulfate', 'maleate', 'besylate', 'besilate', 'mesylate', 'mesilate', 'citrate', 'tartrate', 'bitartrate',
  'fumarate', 'succinate', 'trihydrate', 'dihydrate', 'monohydrate', 'hemihydrate', 'pentahydrate',
  'sesquihydrate', 'anhydrous', 'hydrate', 'phosphate', 'acetate', 'propionate', 'dipropionate',
  'valerate', 'butyrate', 'disodium', 'trometamol', 'tromethamine', 'arginine', 'lysine', 'meglumine',
  'bromide', 'chloride', 'nitrate', 'oxalate', 'pamoate', 'embonate', 'stearate', 'palmitate',
  'mononitrate', 'dinitrate', 'cilexetil', 'medoxomil', 'axetil', 'pivoxil', 'proxetil', 'estolate',
  'ethylsuccinate', 'lactobionate', 'glucoheptonate', 'gluconate', 'lactate', 'xinafoate', 'furoate',
  'base', 'activity', 'usp', 'bp', 'ph', 'eur', 'nf', 'jp', 'ip', 'micronized', 'micronised', 'pellets', 'pellet',
  'enteric', 'coated', 'granules', 'dc', 'eq', 'equivalent', 'to', 'as', 'of', 'specs', 'spec',
]);

// Words DRAP mixes into ingredient names that are not part of the ingredient.
const NOISE_WORDS = new Set(['sterile', 'inj', 'injection', 'specification', 'specifications', 'containg', 'contains', 'contain', 'each']);

// Esters/salts that change the active moiety meaningfully for topical steroids -> keep them.
const KEEP_AFTER_FIRST = new Set(['valerate', 'dipropionate', 'propionate', 'furoate', 'acetonide', 'butyrate']);
const MINERALS = new Set(['magnesium', 'calcium', 'sodium', 'potassium', 'ferrous', 'ferric', 'zinc', 'aluminium', 'aluminum', 'iron', 'copper', 'lithium', 'silver', 'bismuth', 'ammonium', 'cupric', 'selenium']);
const TOPICAL_STEROIDS = new Set(['betamethasone', 'clobetasol', 'hydrocortisone', 'mometasone', 'fluticasone', 'triamcinolone']);

function normalizeIngredientName(raw) {
  let s = String(raw || '').toLowerCase();
  s = s.replace(/\([^)]*\)/g, ' '); // drop parentheticals like (as sodium), (USP)
  s = s.replace(/[^a-z0-9\s\-]/g, ' ');
  s = squash(s);
  for (const [re, rep] of SPELLING) s = s.replace(re, rep);
  s = squash(s);
  const words = s.split(' ').filter(Boolean);
  while (words.length > 1 && NOISE_WORDS.has(words[0])) words.shift(); // "injection cefazolin"
  if (!words.length) return '';
  const first = words[0];
  if (MINERALS.has(first)) return words.filter((w, i) => !/^(usp|bp|nf|eq|as|to|anhydrous|dried|monohydrate|heptahydrate|dihydrate)$/.test(w) && words.indexOf(w) === i).join(' ');
  const keepEster = TOPICAL_STEROIDS.has(first);
  const out = [first];
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    if (SALT_WORDS.has(w) && !(keepEster && KEEP_AFTER_FIRST.has(w))) continue;
    if (NOISE_WORDS.has(w) && !(out[out.length - 1] === 'for' && /^inj/.test(w))) continue; // keep "water for injection"
    if (/^\d/.test(w)) continue;
    if (out.includes(w)) continue; // "ceftazidime pentahydrate ceftazidime" -> "ceftazidime"
    out.push(w);
  }
  let name = out.join(' ');
  // trailing connector words
  name = name.replace(/\b(and|with|plus|w)$/g, '').trim();
  return name;
}

function displayIngredient(name) {
  return name
    .split(' ')
    .map((w) => (/^(b\d+|d3|k2|hcl|ii|iii)$/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

// ---------------------------------------------------------------------------
// Strengths
// ---------------------------------------------------------------------------

const UNIT_RE = '(mg|mcg|µg|ug|microgram|micrograms|g|gm|gms|gram|grams|iu|i\\.u\\.|units?|%|w\\/w|w\\/v|mmol|meq)';

function canonicalAmount(value, unit) {
  let v = parseFloat(String(value).replace(/,/g, ''));
  let u = String(unit || '').toLowerCase().replace(/\./g, '');
  if (!isFinite(v)) return null;
  if (u === 'g' || u === 'gm' || u === 'gms' || u === 'gram' || u === 'grams') {
    v = v * 1000;
    u = 'mg';
  } else if (u === 'µg' || u === 'ug' || u === 'microgram' || u === 'micrograms') {
    u = 'mcg';
  } else if (u === 'mcg' && v >= 1000 && v % 1000 === 0) {
    v = v / 1000;
    u = 'mg';
  } else if (u === 'iu' || u === 'unit' || u === 'units') {
    u = 'IU';
  } else if (u === 'w/w' || u === 'w/v') {
    u = '%';
  }
  v = Math.round(v * 1000) / 1000;
  return { value: v, unit: u };
}

function formatAmount(a) {
  if (!a) return '';
  if (a.unit === 'mg' && a.value >= 1000 && a.value % 1000 === 0) return `${a.value / 1000}g`;
  return `${a.value}${a.unit === '%' ? '%' : a.unit}`;
}

// ---------------------------------------------------------------------------
// Dosage forms
// ---------------------------------------------------------------------------

const FORM_RULES = [
  ['Vaccine', /\bvaccine\b/],
  ['Infusion', /\binfusion\b|\bi\.?v\.? fluid\b|\bdextrose\b.*\bsaline\b/],
  ['Injection', /\binj(ection)?s?\b|\binj\.|\bvials?\b|\bampoules?\b|\bamps?\b|\bampul|\bpre-?filled|\bi\.?m\.?\b|\bi\.?v\.?\b|\bpfs\b|\blyophili[sz]ed\b/],
  ['Inhaler', /\binhaler\b|\bhfa\b|\bmdi\b|\brotacaps?\b|\bevohaler\b|\baccuhaler\b|\bturbuhaler\b|\bdiskus\b|\binhalation powder\b/],
  ['Nebuliser Solution', /\brespules?\b|\bnebuli[sz]|\bnebules?\b/],
  ['Eye Drops', /\beye ?drops?\b|\bophthalmic\b|\bophth\b|\be\/d\b/],
  ['Ear Drops', /\bear ?drops?\b|\botic\b/],
  ['Nasal Spray', /\bnasal\b/],
  ['Eye Ointment', /\beye ointment\b/],
  ['Drops', /\bdrops?\b|\bpaed(iatric)? drops\b/],
  ['Syrup', /\bsyrup\b|\bsyp\b|\belixir\b|\blinctus\b/],
  ['Suspension', /\bsuspension\b|\bsusp\b|\bdry powder for susp|\bdps\b/],
  ['Oral Solution', /\boral solution\b|\boral liquid\b|\bsolution\b/],
  ['Cream', /\bcream\b/],
  ['Ointment', /\bointment\b|\boint\b/],
  ['Gel', /\bgel\b/],
  ['Lotion', /\blotion\b/],
  ['Shampoo', /\bshampoo\b/],
  ['Spray', /\bspray\b/],
  ['Suppository', /\bsuppositor(y|ies)\b|\bsupp\b/],
  ['Vaginal Tablet', /\bvaginal\b|\bpessar|\bvag\.?\b|\bvig\.?\b|\binserts?\b/],
  ['Patch', /\bpatch\b|\btransdermal\b/],
  ['Sachet', /\bsachets?\b|\bgranules\b|\bpowder\b|\bors\b/],
  ['Capsule', /\bcaps?\b|\bcapsules?\b|\bcapsule\b|\bsoftgel|\bcap\.|\bcaplets?\b/],
  ['Chewable Tablet', /\bchewable\b/],
  ['Dispersible Tablet', /\bdispersible\b|\bdt\b|\bodt\b|\borally disintegrating\b/],
  ['Effervescent Tablet', /\beffervescent\b/],
  ['Tablet', /\btabs?\b|\btablets?\b|\btablet\b|\btab\.|\bf\.?c\.?t\b|\bfilm[- ]coated\b/],
];

const MODIFIED_RELEASE_RE = /\b(sr|xr|er|cr|mr|xl|retard|extended|sustained|modified|controlled|prolonged)(\s|-)?(release)?\b/;
const MR_FORMS = new Set(['Tablet', 'Capsule']);

function detectForm(product, composition, pack) {
  const hay = ` ${String(product || '')} ${String(pack || '')} `.toLowerCase();
  const hay2 = ` ${String(composition || '')} `.toLowerCase();
  let form = null;
  for (const [name, re] of FORM_RULES) {
    if (re.test(hay)) { form = name; break; }
  }
  if (!form) {
    for (const [name, re] of FORM_RULES) {
      if (re.test(hay2)) { form = name; break; }
    }
  }
  form = form || 'Other';
  const release = MR_FORMS.has(form) && MODIFIED_RELEASE_RE.test(String(product || '').toLowerCase()) ? 'MR' : '';
  return { form, release };
}

const SOLID_FORMS = new Set(['Tablet', 'Capsule', 'Chewable Tablet', 'Dispersible Tablet', 'Effervescent Tablet',
  'Vaginal Tablet', 'Sachet', 'Suppository', 'Patch', 'Injection', 'Infusion', 'Vaccine', 'Inhaler', 'Nebuliser Solution']);
const LIQUID_FORMS = new Set(['Syrup', 'Suspension', 'Oral Solution', 'Drops', 'Eye Drops', 'Ear Drops', 'Nasal Spray', 'Spray']);
const TOPICAL_FORMS = new Set(['Cream', 'Ointment', 'Gel', 'Lotion', 'Shampoo', 'Eye Ointment']);

// ---------------------------------------------------------------------------
// Pack sizes
// ---------------------------------------------------------------------------

function parsePack(pack, form) {
  const p = String(pack || '').toLowerCase().replace(/[’`]/g, "'").replace(/×/g, 'x');
  const result = { count: null, volume_ml: null, weight_g: null };

  const vol = p.match(/(\d+(?:\.\d+)?)\s*ml\b/);
  if (vol) result.volume_ml = parseFloat(vol[1]);
  const wt = p.match(/(\d+(?:\.\d+)?)\s*(?:g|gm|gms|gram|grams)\b/);
  if (wt) result.weight_g = parseFloat(wt[1]);

  let m;
  if ((m = p.match(/\(?(\d+)\s*x\s*(\d+)\s*\)?\s*(?:'?\s*s\b|tab|cap|vial|amp|sachet|\b|$)/)) && !/ml|g\b/.test(p.slice(m.index, m.index + m[0].length + 3).replace(/x\s*\d+$/, ''))) {
    result.count = parseInt(m[1], 10) * parseInt(m[2], 10);
  }
  if (result.count == null && (m = p.match(/(\d+)\s*'?\s*s\b/))) result.count = parseInt(m[1], 10);
  if (result.count == null && (m = p.match(/(\d+)\s*(?:tablets?|tabs?|capsules?|caps?|sachets?|vials?|amps?|ampoules?|suppositor\w*|patch\w*|pfs|syringes?)\b/))) {
    result.count = parseInt(m[1], 10);
  }
  if (result.count == null && /^\s*\(?\s*(\d+)\s*\)?\s*$/.test(p)) result.count = parseInt(p.replace(/\D/g, ''), 10);
  if (result.count == null && /^\s*(a|one)?\s*(vial|amp|ampoule|inhaler|bottle|tube|device|pack)\b/.test(p)) result.count = 1;
  if (result.count === 0) result.count = null;

  // Decide comparison unit
  let unit = 'pack';
  let units = 1;
  if (LIQUID_FORMS.has(form) && result.volume_ml) {
    unit = 'ml';
    units = result.volume_ml * (result.count && result.count > 1 && result.count < 50 && /x/.test(p) ? result.count : 1);
  } else if (TOPICAL_FORMS.has(form) && result.weight_g) {
    unit = 'g';
    units = result.weight_g;
  } else if (SOLID_FORMS.has(form) && result.count) {
    unit = form === 'Injection' || form === 'Infusion' || form === 'Vaccine' ? 'dose' : form === 'Inhaler' ? 'pack' : 'unit';
    units = form === 'Inhaler' ? 1 : result.count;
    if (form === 'Inhaler') unit = 'pack';
  }
  return { ...result, unit, units };
}

// ---------------------------------------------------------------------------
// Composition parsing
// ---------------------------------------------------------------------------

function cleanComposition(text, opts) {
  const keepTitle = !!(opts && opts.keepTitle);
  let s = String(text || '');
  s = s.replace(/[’`]/g, "'").replace(/µ/g, 'mc');
  s = s.replace(/\(\s*(usp|bp|ph\.?\s*eur\.?|nf|usp specs?\.?|b\.p\.?|u\.s\.p\.?|innovator'?s? specs?\.?|manufacturer'?s? specs?\.?)\s*\)/gi, ' ');
  // Per-volume header: "Each 5ml contains" -> remember volume
  s = s.replace(/(\d\s*(?:mg|mcg|gm|g|iu|ml|%))(?=[A-Z])/g, '$1 ');
  s = s.replace(/\b(eq\.?\s*to|equivalent\s*to)(?=[A-Za-z])/gi, '$1 ');
  s = s.replace(/\b(equalent|equivalant|equivelent|equivilent|equ)\b\.?/gi, 'equivalent '); // common misspellings
  // DRAP often glues a title in front: "LoratadineEach tablet contains:Loratadine….10mg" or
  // "Telmisartan + Amlodipine BesylateEach … contains: …". The title repeats the ingredients,
  // so drop it when it has no amounts of its own (otherwise names come out doubled).
  const header = s.match(/each\s+[^:;]*?contains?\b/i);
  if (!keepTitle && header && header.index > 0 && !/\d/.test(s.slice(0, header.index))) s = s.slice(header.index);
  s = s.replace(/\bn\.f\.?/gi, ' ');
  // "Betamethasone Dipropionate 0.64 mg eq. to Betamethasone 0.5 mg": the salt and its amount
  // are not a second ingredient, only the equivalent amount counts.
  s = s.replace(/\b[A-Za-z][A-Za-z\s\-]*?\s*[.…]*\s*\d+(?:[.,]\d+)?\s*(?:mg|mcg|g|gm|iu)\b\.?\s*(?:\(\s*)?(?:\beq\b\.?|\bequivalent\b|\bequiv\b\.?|\beqv\b\.?)\s*(?:to\b)?\s*(?=[A-Za-z])(?!to\b)/gi, ' ');
  s = s.replace(/each\s+[^:;]*?contains?\s*[:;\-]*/gi, ' ');
  s = s.replace(/\b(contains?|composition)\s*[:;\-]/gi, ' ');
  // "X eq. to Y" -> "Y"
  s = s.replace(/(?<!\d\s?)\b[A-Za-z][A-Za-z\s\-\(\)]*?\s*(?:\beq\b\.?|\bequivalent\b|\bequiv\b\.?|\beqv\b\.?)\s*(?:to\b)?\s*(?=[A-Za-z])(?!to\b)/gi, ' ');
  s = s.replace(/\(\s*as\s+[^)]*\)/gi, ' ');
  s = s.replace(/\b(usp|bp|ph\.?\s?eur|n\.f\.|nf|jp)\b\.?/gi, ' ');
  s = s.replace(/[.…]{2,}|…|_{2,}/g, ' ');
  s = s.replace(/-{2,}/g, ' ');
  return squash(s);
}

function perVolumeFrom(text) {
  const m = String(text || '').toLowerCase().match(/each\s+(\d+(?:\.\d+)?)\s*ml\b/);
  if (m) return parseFloat(m[1]);
  const m2 = String(text || '').toLowerCase().match(/each\s+ml\b/);
  if (m2) return 1;
  return null;
}

const PAIR_RE = new RegExp(
  '([A-Za-z][A-Za-z0-9\\-\\s\',/&]*?)\\s*[:\\-=]?\\s*(\\d+(?:[.,]\\d+)?)\\s*' + UNIT_RE + '(?![a-z])(?:\\s*\\/\\s*(\\d+(?:\\.\\d+)?)?\\s*(ml|g|gm|dose|actuation|puff|tab|tablet|cap|capsule)\\b)?',
  'gi'
);

/**
 * Parse with and without the leading title. Usually the title only repeats the ingredients
 * (dropping it avoids doubled names), but sometimes the amounts only read correctly with it
 * ("Insulin Glargine: Each ml contains 100 units insulin glargine"). Keep whichever finds more
 * amounts; on a tie, the version without the title.
 */
function parseComposition(composition, product) {
  const withAmounts = (list) => list.filter((i) => i.amount).length;
  const dropped = parseCompositionOnce(composition, product, false);
  const kept = parseCompositionOnce(composition, product, true);
  return withAmounts(kept) > withAmounts(dropped) ? kept : dropped;
}

function parseCompositionOnce(composition, product, keepTitle) {
  const perVol = perVolumeFrom(composition);
  const cleaned = cleanComposition(composition, { keepTitle });
  const ingredients = [];
  let m;
  PAIR_RE.lastIndex = 0;
  while ((m = PAIR_RE.exec(cleaned))) {
    let rawName = m[1].replace(/^(and|with|plus|\+|&|,)\s*/i, '');
    // keep only last chunk after separators like "+" or ","
    rawName = rawName.split(/\s*(?:\+|,|&|\band\b|\bwith\b)\s*/i).filter(Boolean).pop() || rawName;
    const name = normalizeIngredientName(rawName);
    if (!name || name.length < 3) continue;
    if (/^(each|per|ml|tablet|capsule|vial|dose|contains|of|in)$/.test(name)) continue;
    const amt = canonicalAmount(m[2], m[3]);
    if (!amt) continue;
    let per = '';
    const perAmount = m[4] ? parseFloat(m[4]) : null;
    const perUnit = m[5] ? m[5].toLowerCase() : '';
    if (perUnit === 'ml') per = `/${perAmount || 1}ml`;
    else if (perUnit === 'g' || perUnit === 'gm') per = `/${perAmount || 1}g`;
    else if (!per && perVol) per = `/${perVol}ml`;
    if (ingredients.some((x) => x.name === name)) continue;
    ingredients.push({ name, amount: amt, per });
  }

  if (ingredients.length === 0) {
    // No strengths in the composition: take the drug name(s) and try the product name for strength
    const nameOnly = cleaned.replace(/\d+(?:[.,]\d+)?\s*(mg|mcg|g|gm|iu|ml|%)\b/gi, ' ').replace(/[()]/g, ' ');
    const parts = nameOnly
      .split(/\s*(?:\+|,|&|\band\b|\bwith\b|\/)\s*/i)
      .map(normalizeIngredientName)
      .filter((x) => x && x.length >= 3);
    const unique = [...new Set(parts)];
    if (unique.length === 1) {
      const pm = String(product || '').match(/(\d+(?:\.\d+)?)\s*(mg|mcg|g|gm|iu)\b/i);
      ingredients.push({ name: unique[0], amount: pm ? canonicalAmount(pm[1], pm[2]) : null, per: '', strengthFromName: !!pm });
    } else {
      unique.forEach((n) => ingredients.push({ name: n, amount: null, per: '' }));
    }
  }
  return ingredients;
}

// ---------------------------------------------------------------------------
// Product names
// ---------------------------------------------------------------------------

const NAME_STOP = /^(\d|tab|tabs|tablet|tablets|cap|caps|capsule|capsules|inj|inj\.|injection|syrup|syp|susp|suspension|cream|oint|ointment|gel|lotion|drops?|eye|ear|nasal|spray|sachet|sachets|vial|amp|ampoule|infusion|i\.?v\.?|i\.?m\.?|im\/iv|iv\/im|oral|solution|dry|powder|for|film|coated|f\.c|fc|dt|odt|sr|xr|er|cr|mr|xl|la|forte|ds|mg|mcg|ml|gm|g|\()/i;

function shortBrandName(product) {
  const p = squash(String(product || '').replace(/[®™]/g, '').replace(/^[^A-Za-z0-9]+/, '').replace(/^(inj|tab|cap|syp|susp)\.?\s+/i, ''));
  const tokens = p.split(' ');
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (i > 0 && NAME_STOP.test(t)) break;
    if (/^\d/.test(t) && i > 0) break;
    out.push(t);
    if (out.length >= 3) break;
  }
  let name = out.join(' ').replace(/[\-,:]+$/, '');
  // Keep meaningful variant words commonly part of the brand (Forte, Extra, Plus, DS)
  const variant = p.match(/\b(forte|extra|plus|ds|junior|kids?|max|advance|cf|cold|xr|sr)\b/i);
  if (variant && !new RegExp(`\\b${variant[1]}\\b`, 'i').test(name)) name += ' ' + variant[1];
  return titleCaseIfShouting(name || p);
}

// ---------------------------------------------------------------------------
// Therapeutic categories (by active ingredient keyword)
// ---------------------------------------------------------------------------

const CATEGORIES = [
  { id: 'pain', en: 'Pain & Fever', ur: 'درد اور بخار', icon: 'pain', keys: ['paracetamol', 'ibuprofen', 'diclofenac', 'naproxen', 'mefenamic', 'metamizole', 'aspirin', 'tramadol', 'ketorolac', 'celecoxib', 'etoricoxib', 'aceclofenac', 'piroxicam', 'meloxicam', 'nimesulide', 'flurbiprofen', 'ketoprofen', 'dexketoprofen', 'tapentadol', 'nalbuphine', 'pentazocine', 'morphine', 'codeine', 'orphenadrine', 'tizanidine', 'thiocolchicoside', 'methocarbamol', 'chlorzoxazone', 'eperisone', 'baclofen', 'colchicine', 'allopurinol', 'febuxostat', 'pregabalin', 'gabapentin', 'lornoxicam', 'indomethacin', 'tolperisone', 'cyclobenzaprine', 'glucosamine', 'chondroitin', 'diacerein', 'sumatriptan', 'rizatriptan', 'nefopam', 'buprenorphine', 'fentanyl'] },
  { id: 'stomach', en: 'Stomach & Digestion', ur: 'معدہ اور ہاضمہ', icon: 'stomach', keys: ['omeprazole', 'esomeprazole', 'pantoprazole', 'lansoprazole', 'rabeprazole', 'dexlansoprazole', 'ranitidine', 'famotidine', 'cimetidine', 'domperidone', 'metoclopramide', 'ondansetron', 'granisetron', 'itopride', 'mosapride', 'prucalopride', 'loperamide', 'mebeverine', 'hyoscine', 'drotaverine', 'dicyclomine', 'trimebutine', 'otilonium', 'pinaverium', 'simethicone', 'lactulose', 'bisacodyl', 'ispaghula', 'psyllium', 'sennosides', 'senna', 'macrogol', 'polyethylene glycol', 'sucralfate', 'aluminium hydroxide', 'magnesium hydroxide', 'magnesium trisilicate', 'sodium alginate', 'alginate', 'pancreatin', 'ursodeoxycholic', 'ursodiol', 'silymarin', 'bismuth', 'oral rehydration', 'ors', 'racecadotril', 'mesalazine', 'sulfasalazine', 'prochlorperazine', 'cinnarizine', 'meclizine', 'dimenhydrinate', 'promethazine', 'doxylamine', 'probiotic', 'lactobacillus', 'saccharomyces', 'rifaximin', 'levosulpiride', 'sodium picosulfate', 'aprepitant', 'vonoprazan', 'misoprostol'] },
  { id: 'antibiotics', en: 'Antibiotics', ur: 'اینٹی بائیوٹکس', icon: 'antibiotic', keys: ['amoxicillin', 'ampicillin', 'cloxacillin', 'flucloxacillin', 'penicillin', 'piperacillin', 'cefalexin', 'cefradine', 'cefadroxil', 'cefaclor', 'cefuroxime', 'cefixime', 'cefdinir', 'cefpodoxime', 'cefprozil', 'ceftriaxone', 'cefotaxime', 'ceftazidime', 'cefoperazone', 'cefepime', 'cefazolin', 'ceftaroline', 'azithromycin', 'clarithromycin', 'erythromycin', 'roxithromycin', 'ciprofloxacin', 'levofloxacin', 'moxifloxacin', 'ofloxacin', 'norfloxacin', 'gemifloxacin', 'doxycycline', 'tetracycline', 'minocycline', 'tigecycline', 'clindamycin', 'lincomycin', 'linezolid', 'vancomycin', 'teicoplanin', 'meropenem', 'imipenem', 'ertapenem', 'amikacin', 'gentamicin', 'tobramycin', 'streptomycin', 'nitrofurantoin', 'fosfomycin', 'trimethoprim', 'sulfamethoxazole', 'co-trimoxazole', 'metronidazole', 'tinidazole', 'secnidazole', 'ornidazole', 'nitazoxanide', 'colistin', 'polymyxin', 'aztreonam', 'chloramphenicol', 'fusidic', 'mupirocin', 'rifampicin', 'isoniazid', 'ethambutol', 'pyrazinamide', 'sultamicillin', 'sulbactam', 'tazobactam', 'clavulanic', 'daptomycin', 'neomycin', 'bacitracin', 'cephalexin', 'faropenem', 'pristinamycin'] },
  { id: 'heart', en: 'BP, Heart & Cholesterol', ur: 'بلڈ پریشر، دل اور کولیسٹرول', icon: 'heart', keys: ['amlodipine', 'nifedipine', 'diltiazem', 'verapamil', 'losartan', 'valsartan', 'irbesartan', 'telmisartan', 'olmesartan', 'candesartan', 'azilsartan', 'enalapril', 'lisinopril', 'captopril', 'ramipril', 'perindopril', 'bisoprolol', 'atenolol', 'metoprolol', 'propranolol', 'carvedilol', 'nebivolol', 'labetalol', 'hydrochlorothiazide', 'chlorthalidone', 'indapamide', 'furosemide', 'torsemide', 'spironolactone', 'eplerenone', 'atorvastatin', 'rosuvastatin', 'simvastatin', 'pravastatin', 'pitavastatin', 'ezetimibe', 'fenofibrate', 'gemfibrozil', 'clopidogrel', 'prasugrel', 'ticagrelor', 'warfarin', 'rivaroxaban', 'apixaban', 'dabigatran', 'edoxaban', 'enoxaparin', 'heparin', 'fondaparinux', 'isosorbide', 'nitroglycerin', 'glyceryl trinitrate', 'trimetazidine', 'ranolazine', 'ivabradine', 'digoxin', 'amiodarone', 'sacubitril', 'methyldopa', 'clonidine', 'prazosin', 'doxazosin', 'hydralazine', 'moxonidine', 'cilostazol', 'pentoxifylline', 'tranexamic', 'dobutamine', 'dopamine', 'norepinephrine', 'alteplase', 'streptokinase', 'tenecteplase', 'omega-3', 'lercanidipine', 'nimodipine', 'flecainide', 'propafenone', 'vericiguat', 'dapagliflozin+'] },
  { id: 'diabetes', en: 'Diabetes / Sugar', ur: 'شوگر / ذیابیطس', icon: 'diabetes', keys: ['metformin', 'glimepiride', 'gliclazide', 'glibenclamide', 'glipizide', 'sitagliptin', 'vildagliptin', 'linagliptin', 'saxagliptin', 'alogliptin', 'teneligliptin', 'empagliflozin', 'dapagliflozin', 'canagliflozin', 'ertugliflozin', 'pioglitazone', 'acarbose', 'repaglinide', 'insulin', 'liraglutide', 'semaglutide', 'dulaglutide', 'exenatide', 'tirzepatide', 'voglibose'] },
  { id: 'respiratory', en: 'Allergy, Cough & Asthma', ur: 'الرجی، کھانسی اور دمہ', icon: 'lungs', keys: ['cetirizine', 'levocetirizine', 'loratadine', 'desloratadine', 'fexofenadine', 'chlorpheniramine', 'chlorphenamine', 'diphenhydramine', 'hydroxyzine', 'ebastine', 'rupatadine', 'bilastine', 'cyproheptadine', 'pheniramine', 'triprolidine', 'ketotifen', 'montelukast', 'zafirlukast', 'salbutamol', 'levosalbutamol', 'terbutaline', 'formoterol', 'salmeterol', 'tiotropium', 'ipratropium', 'budesonide', 'beclomethasone', 'fluticasone', 'ciclesonide', 'theophylline', 'aminophylline', 'doxofylline', 'ambroxol', 'bromhexine', 'guaifenesin', 'dextromethorphan', 'pseudoephedrine', 'phenylephrine', 'oxymetazoline', 'xylometazoline', 'carbocisteine', 'acetylcysteine', 'n-acetylcysteine', 'erdosteine', 'noscapine', 'butamirate', 'pholcodine', 'diphenhydramine', 'indacaterol', 'glycopyrronium', 'umeclidinium', 'vilanterol', 'roflumilast', 'mometasone nasal', 'azelastine', 'olopatadine', 'sodium cromoglycate', 'cromoglicate', 'epinastine'] },
  { id: 'brain', en: 'Brain, Nerves & Mental Health', ur: 'دماغ، اعصاب اور ذہنی صحت', icon: 'brain', keys: ['clonazepam', 'alprazolam', 'diazepam', 'lorazepam', 'bromazepam', 'midazolam', 'chlordiazepoxide', 'oxazepam', 'zolpidem', 'zopiclone', 'escitalopram', 'citalopram', 'sertraline', 'fluoxetine', 'paroxetine', 'fluvoxamine', 'venlafaxine', 'desvenlafaxine', 'duloxetine', 'mirtazapine', 'amitriptyline', 'imipramine', 'clomipramine', 'nortriptyline', 'dothiepin', 'trazodone', 'bupropion', 'bupropin', 'vortioxetine', 'agomelatine', 'olanzapine', 'quetiapine', 'risperidone', 'aripiprazole', 'haloperidol', 'clozapine', 'paliperidone', 'ziprasidone', 'lurasidone', 'chlorpromazine', 'trifluoperazine', 'flupentixol', 'sulpiride', 'amisulpride', 'lithium', 'valproate', 'valproic', 'divalproex', 'carbamazepine', 'oxcarbazepine', 'lamotrigine', 'levetiracetam', 'phenytoin', 'phenobarbital', 'topiramate', 'lacosamide', 'brivaracetam', 'zonisamide', 'clobazam', 'perampanel', 'donepezil', 'memantine', 'rivastigmine', 'galantamine', 'levodopa', 'carbidopa', 'pramipexole', 'ropinirole', 'rasagiline', 'selegiline', 'amantadine', 'trihexyphenidyl', 'benzhexol', 'procyclidine', 'methylphenidate', 'atomoxetine', 'modafinil', 'betahistine', 'flunarizine', 'citicoline', 'piracetam', 'ginkgo', 'propranolol+', 'buspirone', 'melatonin', 'naltrexone', 'disulfiram', 'sodium valproate', 'pizotifen', 'mecobalamin'] },
  { id: 'skin', en: 'Skin, Hair & Ointments', ur: 'جلد، بال اور مرہم', icon: 'skin', keys: ['betamethasone', 'clobetasol', 'hydrocortisone', 'mometasone', 'triamcinolone', 'fluocinolone', 'fluocinonide', 'desonide', 'halobetasol', 'fusidic', 'mupirocin', 'clotrimazole', 'miconazole', 'ketoconazole', 'terbinafine', 'luliconazole', 'sertaconazole', 'econazole', 'tioconazole', 'permethrin', 'benzyl benzoate', 'crotamiton', 'tretinoin', 'adapalene', 'isotretinoin', 'benzoyl peroxide', 'azelaic', 'salicylic', 'urea', 'calamine', 'minoxidil', 'finasteride', 'tacrolimus', 'pimecrolimus', 'silver sulfadiazine', 'calcipotriol', 'coal tar', 'hydroquinone', 'kojic', 'zinc oxide', 'retapamulin', 'nadifloxacin', 'clindamycin topical', 'povidone', 'chlorhexidine', 'dexpanthenol', 'tranexamic+', 'sulfur', 'selenium sulfide'] },
  { id: 'vitamins', en: 'Vitamins & Supplements', ur: 'وٹامنز اور سپلیمنٹس', icon: 'vitamin', keys: ['vitamin', 'cholecalciferol', 'calcium carbonate', 'calcium', 'ferrous', 'iron', 'folic', 'cyanocobalamin', 'methylcobalamin', 'mecobalamin', 'thiamine', 'pyridoxine', 'riboflavin', 'nicotinamide', 'ascorbic', 'zinc', 'magnesium', 'multivitamin', 'multi-vitamin', 'omega', 'fish oil', 'cod liver', 'biotin', 'alfacalcidol', 'calcitriol', 'ergocalciferol', 'carbonyl iron', 'iron sucrose', 'ferric', 'selenium', 'l-carnitine', 'carnitine', 'coenzyme', 'lycopene', 'evening primrose', 'potassium chloride', 'electrolyte', 'menadione', 'phytomenadione', 'vitamin k', 'tocopherol', 'retinol', 'amino acid', 'whey', 'protein'] },
  { id: 'infections', en: 'Fungal, Viral & Worm Infections', ur: 'فنگس، وائرس اور کیڑے', icon: 'virus', keys: ['fluconazole', 'itraconazole', 'voriconazole', 'posaconazole', 'nystatin', 'griseofulvin', 'amphotericin', 'caspofungin', 'acyclovir', 'aciclovir', 'valacyclovir', 'valaciclovir', 'famciclovir', 'oseltamivir', 'sofosbuvir', 'daclatasvir', 'velpatasvir', 'ledipasvir', 'ribavirin', 'tenofovir', 'entecavir', 'lamivudine', 'zidovudine', 'efavirenz', 'dolutegravir', 'remdesivir', 'favipiravir', 'albendazole', 'mebendazole', 'ivermectin', 'pyrantel', 'praziquantel', 'levamisole', 'artemether', 'lumefantrine', 'artesunate', 'chloroquine', 'hydroxychloroquine', 'primaquine', 'quinine', 'mefloquine', 'atovaquone', 'proguanil', 'diloxanide', 'dihydroartemisinin', 'piperaquine', 'emtricitabine', 'abacavir', 'nevirapine', 'ritonavir', 'lopinavir'] },
  { id: 'women', en: 'Hormones, Thyroid & Women\'s Health', ur: 'ہارمونز، تھائرائیڈ اور خواتین', icon: 'hormone', keys: ['levothyroxine', 'thyroxine', 'carbimazole', 'methimazole', 'propylthiouracil', 'progesterone', 'dydrogesterone', 'norethisterone', 'medroxyprogesterone', 'estradiol', 'ethinylestradiol', 'levonorgestrel', 'desogestrel', 'drospirenone', 'cyproterone', 'clomiphene', 'clomifene', 'letrozole', 'cabergoline', 'bromocriptine', 'oxytocin', 'misoprostol+', 'metformin+', 'prednisolone', 'prednisone', 'methylprednisolone', 'dexamethasone', 'deflazacort', 'hydrocortisone+', 'testosterone', 'gonadotropin', 'menotropin', 'follitropin', 'tibolone', 'raloxifene', 'alendronate', 'alendronic', 'risedronate', 'ibandronate', 'zoledronic', 'denosumab', 'teriparatide', 'myo-inositol', 'inositol', 'mifepristone', 'ulipristal', 'desmopressin', 'somatropin', 'octreotide'] },
  { id: 'urology', en: 'Kidney, Urinary & Men\'s Health', ur: 'گردے، پیشاب اور مردانہ صحت', icon: 'kidney', keys: ['tamsulosin', 'alfuzosin', 'silodosin', 'dutasteride', 'finasteride+', 'solifenacin', 'tolterodine', 'oxybutynin', 'mirabegron', 'trospium', 'flavoxate', 'sildenafil', 'tadalafil', 'vardenafil', 'dapoxetine', 'potassium citrate', 'sodium bicarbonate', 'sevelamer', 'calcium acetate', 'cinacalcet', 'erythropoietin', 'epoetin', 'darbepoetin', 'tamsulosin+', 'cystone', 'cranberry'] },
  { id: 'eye', en: 'Eye & Ear', ur: 'آنکھ اور کان', icon: 'eye', keys: ['timolol', 'latanoprost', 'travoprost', 'bimatoprost', 'brimonidine', 'dorzolamide', 'brinzolamide', 'acetazolamide', 'pilocarpine', 'tropicamide', 'cyclopentolate', 'atropine', 'carboxymethylcellulose', 'hypromellose', 'hyaluronate', 'polyvinyl alcohol', 'moxifloxacin eye', 'tobramycin eye', 'loteprednol', 'prednisolone acetate', 'fluorometholone', 'nepafenac', 'bromfenac', 'ketorolac eye', 'cyclosporine eye', 'olopatadine eye', 'naphazoline', 'tetrahydrozoline'] },
  { id: 'cancer', en: 'Cancer & Immunity', ur: 'کینسر اور قوت مدافعت', icon: 'shield', keys: ['methotrexate', 'cyclophosphamide', 'doxorubicin', 'cisplatin', 'carboplatin', 'oxaliplatin', 'paclitaxel', 'docetaxel', 'gemcitabine', 'capecitabine', 'fluorouracil', 'imatinib', 'erlotinib', 'gefitinib', 'tamoxifen', 'anastrozole', 'letrozole+', 'exemestane', 'bicalutamide', 'abiraterone', 'enzalutamide', 'leuprolide', 'goserelin', 'triptorelin', 'rituximab', 'trastuzumab', 'bevacizumab', 'pembrolizumab', 'nivolumab', 'bortezomib', 'lenalidomide', 'thalidomide', 'hydroxyurea', 'hydroxycarbamide', 'vincristine', 'vinblastine', 'etoposide', 'irinotecan', 'temozolomide', 'azathioprine', 'mycophenolate', 'cyclosporine', 'ciclosporin', 'tacrolimus+', 'everolimus', 'sirolimus', 'leflunomide', 'hydroxychloroquine+', 'tofacitinib', 'baricitinib', 'adalimumab', 'etanercept', 'infliximab', 'pemetrexed', 'cytarabine', 'bleomycin', 'dacarbazine', 'ifosfamide', 'mesna', 'leucovorin', 'folinic', 'filgrastim', 'pegfilgrastim', 'ondansetron+', 'zoledronic+', 'interferon', 'immunoglobulin', 'sorafenib', 'sunitinib', 'lapatinib', 'osimertinib', 'ibrutinib', 'ruxolitinib', 'dasatinib', 'nilotinib', 'deferasirox', 'deferoxamine'] },
  { id: 'vaccines', en: 'Vaccines & Injectables', ur: 'ویکسین اور انجیکشن', icon: 'syringe', keys: ['vaccine', 'antigen', 'hbsag', 'hbs', 'virus', 'strain', 'polysaccharide', 'toxoid', 'antiserum', 'anti-rabies', 'antivenom', 'anti-snake', 'immune globulin', 'serum', 'tetanus', 'hepatitis b immunoglobulin', 'water for injection', 'sodium chloride', 'dextrose', 'ringer', 'lactated', 'lidocaine', 'bupivacaine', 'propofol', 'ketamine', 'atracurium', 'rocuronium', 'vecuronium', 'suxamethonium', 'neostigmine', 'sevoflurane', 'isoflurane', 'albumin', 'haemaccel', 'mannitol', 'epinephrine', 'adrenaline', 'thiopental'] },
];

function categorize(ingredientNames, form) {
  const joined = ' ' + ingredientNames.join(' + ') + ' ';
  let best = null;
  let bestScore = 0;
  for (const cat of CATEGORIES) {
    for (const key of cat.keys) {
      const k = key.replace(/\+$/, '');
      if (!k) continue;
      const re = new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
      if (re.test(joined)) {
        // earlier ingredients win; longer keys are more specific
        const pos = joined.indexOf(k);
        const score = 1000 - pos + k.length;
        if (score > bestScore) { bestScore = score; best = cat.id; }
      }
    }
  }
  // Dermatology override for topical forms of anti-infectives/steroids
  if (best && ['Cream', 'Ointment', 'Gel', 'Lotion', 'Shampoo'].includes(form) && ['antibiotics', 'infections', 'women', 'brain', 'pain'].includes(best)) {
    best = best === 'pain' ? 'pain' : 'skin';
  }
  if (['Eye Drops', 'Ear Drops', 'Eye Ointment'].includes(form)) best = 'eye';
  if (form === 'Vaccine') best = 'vaccines';
  return best || 'other';
}

// ---------------------------------------------------------------------------
// Dates & prices
// ---------------------------------------------------------------------------

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

function parseEffectiveDate(s) {
  const m = String(s || '').trim().match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*,?\s+(\d{4})/);
  if (!m) return '';
  const month = MONTHS[m[2].toLowerCase()];
  if (month == null) return '';
  const d = new Date(Date.UTC(parseInt(m[3], 10), month, parseInt(m[1], 10)));
  return d.toISOString().slice(0, 10);
}

function parsePrice(s) {
  const v = parseFloat(String(s || '').replace(/[^0-9.]/g, ''));
  return isFinite(v) ? v : null;
}

// ---------------------------------------------------------------------------
// Full record normalization
// ---------------------------------------------------------------------------

function normalizeRecord(raw, renames) {
  const product = squash(String(raw.product || '').replace(/[®™]/g, '').replace(/^[^A-Za-z0-9(]+/, ''));
  const composition = squash(raw.composition || '');
  const price = parsePrice(raw.price);
  if (!product || price == null || price <= 0) return null;

  const { form, release } = detectForm(product, composition, raw.pack);
  const compSource = composition && composition.toLowerCase() !== product.toLowerCase() ? composition : product;
  const brandWord = shortBrandName(product).split(' ')[0].toLowerCase();
  const ingredients = parseComposition(compSource, product)
    .filter((i, idx, arr) => arr.length === 1 || i.name.split(' ')[0] !== brandWord)
    .map((i) => (renames && renames.has(i.name) ? { ...i, name: renames.get(i.name) } : i));
  const pack = parsePack(raw.pack, form);

  const names = ingredients.map((i) => i.name);
  const allHaveStrength = ingredients.length > 0 && ingredients.every((i) => i.amount);
  const sorted = [...ingredients].sort((a, b) => a.name.localeCompare(b.name));
  const formKey = form + (release ? '-mr' : '');
  const group = allHaveStrength && ingredients.length <= 4
    ? slug(sorted.map((i) => `${i.name} ${formatAmount(i.amount)}${i.per}`).join(' + ')) + '--' + slug(formKey) + '--' + pack.unit
    : '';

  let generic = ingredients.map((i) => displayIngredient(i.name)).join(' + ') || titleCaseIfShouting(composition || product);
  if (generic.length > 100) generic = titleCaseIfShouting(cleanComposition(composition || product)).slice(0, 90);
  const strength = ingredients
    .filter((i) => i.amount)
    .map((i) => formatAmount(i.amount) + i.per)
    .join(' + ');
  const unitPrice = pack.units > 0 ? price / pack.units : price;

  return {
    reg: squash(raw.reg),
    product: titleCaseIfShouting(product),
    name: shortBrandName(product),
    generic,
    salt_key: slug(sorted.map((i) => i.name).join(' + ')),
    strength,
    form: form + (release ? ' (Extended release)' : ''),
    pack: squash(raw.pack),
    units: Math.round(pack.units * 1000) / 1000,
    unit: pack.unit,
    price: Math.round(price * 100) / 100,
    unit_price: Math.round(unitPrice * 10000) / 10000,
    manufacturer: squash(raw.manufacturer),
    drap_category: squash(raw.category),
    category: categorize(names, form),
    effective: parseEffectiveDate(raw.effective),
    group,
    ingredient_names: names,
  };
}

module.exports = {
  normalizeIngredientName,
  canonicalAmount,
  formatAmount,
  detectForm,
  parsePack,
  cleanComposition,
  parseComposition,
  shortBrandName,
  categorize,
  parseEffectiveDate,
  parsePrice,
  normalizeRecord,
  CATEGORIES,
  slug,
};
