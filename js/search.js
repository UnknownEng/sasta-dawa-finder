/**
 * Sasta Dawa Finder - search & comparison engine.
 * Pure logic over the expanded dataset (see js/data.js). Shared by the browser
 * app, the offline assistant and the server-side AI chat tools.
 */
(function (root, factory) {
  const lib = factory();
  if (typeof module === 'object' && module.exports) module.exports = lib;
  if (typeof window !== 'undefined') window.SDSearch = lib;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CONSUMER_FORMS = /tablet|capsule|syrup|suspension|drops|sachet|cream|ointment|gel|inhaler/i;

  function normalize(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9؀-ۿ%.+\s-]/g, ' ')
      // a full stop that is not part of a number ("Panadol." from the phone keyboard, "Tab. Risek")
      // is punctuation; "0.5mg" and "2.5" keep theirs
      .replace(/\.(?!\d)/g, ' ')
      .replace(/(^|[^\d])\./g, '$1 ')
      .replace(/(\d)\s+(mg|mcg|g|ml|iu)\b/g, '$1$2')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // --------------------------------------------------------------------------
  // Urdu script → Latin letters (typed in Urdu, or what the phone's ur-PK voice recogniser returns).
  // Urdu leaves most short vowels out, so پیناڈول becomes "pinadol"; matching then compares
  // consonant skeletons (phoneticKey), which is what both spellings share.
  // --------------------------------------------------------------------------
  const URDU_LETTERS = {
    'ا': 'a', 'آ': 'a', 'أ': 'a', 'إ': 'i', 'ٱ': 'a', 'ب': 'b', 'پ': 'p', 'ت': 't', 'ٹ': 't', 'ث': 's', 'ج': 'j', 'چ': 'ch',
    'ح': 'h', 'خ': 'kh', 'د': 'd', 'ڈ': 'd', 'ذ': 'z', 'ر': 'r', 'ڑ': 'r', 'ز': 'z', 'ژ': 'zh', 'س': 's', 'ش': 'sh',
    'ص': 's', 'ض': 'z', 'ط': 't', 'ظ': 'z', 'ع': 'a', 'غ': 'gh', 'ف': 'f', 'ق': 'q', 'ک': 'k', 'ك': 'k', 'گ': 'g',
    'ل': 'l', 'م': 'm', 'ن': 'n', 'ں': 'n', 'و': 'o', 'ؤ': 'o', 'ہ': 'h', 'ۂ': 'h', 'ۃ': 'h', 'ة': 'h', 'ه': 'h', 'ھ': 'h',
    'ی': 'i', 'ي': 'i', 'ى': 'i', 'ئ': 'i', 'ے': 'e', 'ۓ': 'e', 'ء': '',
    // vowel marks, when written
    'َ': 'a', 'ِ': 'i', 'ُ': 'u', 'ً': 'an', 'ٍ': 'in', 'ٌ': 'un', 'ٰ': 'a', 'ّ': '', 'ْ': '', 'ٔ': '', 'ٓ': '', 'ؕ': '',
    '۔': ' ', '،': ' ', '؟': ' ', '٪': '%',
  };
  const URDU_RE = /[؀-ۿ]/;
  function hasUrdu(s) {
    return URDU_RE.test(String(s || ''));
  }
  /** "پیناڈول" → "pinadol", "بروفین" → "brofin", "رسک" → "rsk". Latin text passes through unchanged. */
  function transliterateUrdu(s) {
    const str = String(s || '').normalize('NFC');
    if (!URDU_RE.test(str)) return str;
    let out = '';
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      const prev = i > 0 ? str[i - 1] : ' ';
      const atStart = !URDU_RE.test(prev) || /[\s۔،؟]/.test(prev);
      if (ch >= '۰' && ch <= '۹') { out += String(ch.charCodeAt(0) - 0x06f0); continue; }
      if (ch >= '٠' && ch <= '٩') { out += String(ch.charCodeAt(0) - 0x0660); continue; }
      // ی / و at the start of a word are consonants (y / w), inside a word mostly vowels
      if (atStart && (ch === 'ی' || ch === 'ي')) { out += 'y'; continue; }
      if (atStart && ch === 'و') { out += 'w'; continue; }
      out += Object.prototype.hasOwnProperty.call(URDU_LETTERS, ch) ? URDU_LETTERS[ch] : URDU_RE.test(ch) ? '' : ch;
    }
    return out.replace(/\s+/g, ' ').trim();
  }

  /**
   * Consonant skeleton for sound-alike matching: "panadool", "pinadol" (پیناڈول) → "pndl";
   * "glucofage" / "glucophage" → "glkfg"; "brufin" / "brofin" (بروفین) / "brufen" → "brfn";
   * "augmenten" / "augmentin" → "_gmntn" (a leading vowel is kept as "_").
   */
  function phoneticKey(word) {
    let s = String(word || '').toLowerCase().replace(/[^a-z]/g, '');
    if (!s) return '';
    s = s.replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/ch/g, 'k').replace(/kh/g, 'k').replace(/gh/g, 'g')
      .replace(/sh/g, 's').replace(/zh/g, 's').replace(/q/g, 'k').replace(/c/g, 'k').replace(/x/g, 'ks')
      .replace(/z/g, 's').replace(/w/g, 'v').replace(/y/g, 'i').replace(/h/g, '');
    if (!s) return '';
    const lead = /[aeiou]/.test(s[0]) ? '_' : '';
    return (lead + s.replace(/[aeiou]/g, '')).replace(/(.)\1+/g, '$1');
  }

  // --------------------------------------------------------------------------
  // Roman Urdu / plain-English symptom words → a common medicine (generic names, tried in order
  // until one is in the price list) and the category to browse. Matched on phoneticKey, so
  // "bukhar", "bukhaar" and بخار all hit "fever".
  // --------------------------------------------------------------------------
  const SYMPTOMS = [
    { words: ['pait dard', 'pet dard', 'pate dard', 'stomach pain', 'stomach ache', 'maroor', 'marore'], generics: ['hyoscine', 'drotaverine', 'mebeverine'], category: 'stomach', label: 'stomach pain' },
    { words: ['sar dard', 'sir dard', 'sardard', 'sirdard', 'headache', 'head ache', 'migraine', 'adha sar'], generics: ['paracetamol', 'ibuprofen'], category: 'pain', label: 'headache' },
    { words: ['daant dard', 'dant dard', 'toothache', 'tooth pain'], generics: ['ibuprofen', 'mefenamic', 'paracetamol'], category: 'pain', label: 'toothache' },
    { words: ['kamar dard', 'joron ka dard', 'jodon ka dard', 'joint pain', 'back pain', 'body pain', 'badan dard', 'dard', 'pain'], generics: ['ibuprofen', 'diclofenac', 'paracetamol'], category: 'pain', label: 'pain' },
    { words: ['bukhar', 'bukhaar', 'bokhar', 'fever', 'tap', 'temperature'], generics: ['paracetamol', 'ibuprofen'], category: 'pain', label: 'fever' },
    { words: ['khansi', 'khaansi', 'khasi', 'khaasi', 'cough', 'balgham'], generics: ['dextromethorphan', 'ambroxol', 'bromhexine', 'guaifenesin', 'diphenhydramine'], category: 'respiratory', label: 'cough' },
    { words: ['nazla', 'nazla zukam', 'zukam', 'zukaam', 'zukham', 'cold', 'flu', 'runny nose', 'chheenk', 'cheenk'], generics: ['chlorpheniramine', 'cetirizine', 'loratadine', 'pseudoephedrine'], category: 'respiratory', label: 'cold & flu' },
    { words: ['allergy', 'alergy', 'kharish', 'khujli', 'itching'], generics: ['cetirizine', 'loratadine', 'fexofenadine', 'levocetirizine'], category: 'respiratory', label: 'allergy' },
    { words: ['tezabiyat', 'tezab', 'acidity', 'gas', 'heartburn', 'jalan', 'seene ki jalan', 'ulcer'], generics: ['omeprazole', 'esomeprazole', 'famotidine', 'pantoprazole'], category: 'stomach', label: 'acidity' },
    { words: ['dast', 'pechish', 'loose motion', 'loose motions', 'diarrhea', 'diarrhoea'], generics: ['oral rehydration', 'loperamide', 'metronidazole'], category: 'stomach', label: 'diarrhoea' },
    { words: ['qabz', 'qabz kusha', 'constipation'], generics: ['lactulose', 'ispaghula', 'bisacodyl'], category: 'stomach', label: 'constipation' },
    { words: ['ulti', 'qai', 'matli', 'vomiting', 'nausea'], generics: ['domperidone', 'metoclopramide', 'ondansetron'], category: 'stomach', label: 'vomiting' },
    { words: ['sugar', 'shugar', 'sugar ki bimari', 'diabetes', 'ziabetes', 'ziabetus'], generics: ['metformin', 'glimepiride', 'gliclazide'], category: 'diabetes', label: 'diabetes' },
    { words: ['bp', 'b p', 'blood pressure', 'high bp', 'high blood pressure', 'hypertension', 'fishar e khoon'], generics: ['amlodipine', 'losartan', 'bisoprolol'], category: 'heart', label: 'blood pressure' },
    { words: ['neend', 'neend na ana', 'insomnia', 'sleep'], generics: ['melatonin', 'zolpidem'], category: 'brain', label: 'sleep' },
    { words: ['khoon ki kami', 'anemia', 'anaemia'], generics: ['ferrous', 'iron', 'folic acid'], category: 'vitamins', label: 'anaemia' },
    { words: ['keeray', 'keere', 'pait ke keeray', 'worms'], generics: ['albendazole', 'mebendazole'], category: 'infections', label: 'worms' },
  ];
  /** Words in a query that only say "medicine for…" (dropped before matching). */
  const FILLER = new Set(['ki', 'ka', 'ke', 'kay', 'ko', 'k', 'liye', 'liay', 'lye', 'ke liye', 'dawa', 'dawai', 'dawaa', 'dwa', 'medicine', 'medicines', 'tablet', 'tablets', 'goli', 'golian', 'goliyan', 'syrup', 'sharbat', 'capsule', 'capsules', 'cap', 'tab', 'for', 'of', 'the', 'a', 'an', 'mujhe', 'chahiye', 'chaiye', 'koi', 'wali', 'wala', 'ilaj', 'treatment', 'best', 'achi', 'acha', 'sasti', 'sasta', 'price', 'qeemat', 'drops', 'cream', 'injection', 'hai', 'he', 'kya', 'aur', 'se', 'mein', 'ka ilaj', 'ki dawa', 'please', 'plz', 'bata', 'batao']);
  /** Form words in Roman Urdu / English → a word the engine scores against the dosage form. */
  const FORM_WORDS = { goli: 'tablet', golian: 'tablet', goliyan: 'tablet', tablet: 'tablet', tablets: 'tablet', tab: 'tablet', syrup: 'syrup', sharbat: 'syrup', capsule: 'capsule', capsules: 'capsule', cap: 'capsule', drops: 'drops', cream: 'cream', marham: 'cream', injection: 'injection', teeka: 'injection' };
  let symptomIndex = null;
  function buildSymptomIndex() {
    symptomIndex = [];
    SYMPTOMS.forEach((s) => s.words.forEach((w) => {
      const keys = w.split(' ').map(phoneticKey).filter(Boolean);
      if (keys.length) symptomIndex.push({ keys, entry: s, len: keys.length });
    }));
    // longest phrases first ("pait dard" before "dard")
    symptomIndex.sort((a, b) => b.len - a.len);
  }
  /**
   * Symptom phrase in a (Latin or transliterated) query → { entry, form } or null.
   * "bukhar ki dawa" → fever; "khansi ka syrup" → cough (form syrup); "sar dard ki goli" → headache (tablet).
   */
  function findSymptom(query) {
    if (!symptomIndex) buildSymptomIndex();
    const words = normalize(transliterateUrdu(query)).split(' ').filter(Boolean);
    if (!words.length) return null;
    const keys = words.map(phoneticKey);
    let form = '';
    for (const w of words) if (FORM_WORDS[w]) { form = FORM_WORDS[w]; break; }
    for (const s of symptomIndex) {
      for (let i = 0; i + s.len <= keys.length; i++) {
        let ok = true;
        for (let j = 0; j < s.len; j++) if (keys[i + j] !== s.keys[j]) { ok = false; break; }
        // a single short word ("tap", "gas", "bp") must be typed as is, not merely sound alike
        if (ok && s.len === 1 && s.keys[0].replace('_', '').length < 3) ok = s.entry.words.includes(words[i]);
        if (ok) {
          // whole: the query is only this symptom (+ "ki dawa", "goli"…), e.g. "bp", "sugar ki dawa"
          const whole = words.every((w, k) => (k >= i && k < i + s.len) || FILLER.has(w) || FORM_WORDS[w]);
          return { entry: s.entry, form, whole };
        }
      }
    }
    return null;
  }

  function tokens(s) {
    return normalize(s).split(/[\s+\-]+/).filter(Boolean);
  }

  // Bounded Levenshtein distance (returns max+1 when exceeded)
  function editDistance(a, b, max) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      let rowMin = i;
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (cur[j] < rowMin) rowMin = cur[j];
      }
      if (rowMin > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  }

  function median(nums) {
    if (!nums.length) return 0;
    const s = [...nums].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function createEngine(dataset) {
    const items = dataset.items;

    // --- Synonyms: alias -> canonical generic word(s)
    const alias = new Map();
    Object.entries(dataset.synonyms || {}).forEach(([generic, list]) => {
      (list || []).forEach((a) => {
        const k = normalize(a);
        if (k && k !== normalize(generic)) alias.set(k, normalize(generic));
      });
    });
    [['acetaminophen', 'paracetamol'], ['apap', 'paracetamol'], ['albuterol', 'salbutamol'], ['dipyrone', 'metamizole'],
      ['novaminsulfon', 'metamizole'], ['analgin', 'metamizole'], ['asa', 'aspirin'], ['co-amoxiclav', 'amoxicillin clavulanic'],
      ['coamoxiclav', 'amoxicillin clavulanic'], ['scopolamine', 'hyoscine'], ['vit', 'vitamin'], ['frusemide', 'furosemide'],
      ['amoxycillin', 'amoxicillin'], ['lignocaine', 'lidocaine'], ['paracetamole', 'paracetamol']]
      .forEach(([a, c]) => alias.set(a, c));

    // --- Precomputed haystacks. Names, formulas, forms and manufacturers repeat thousands of
    // times, so each distinct string is normalized once (this runs on every page load).
    const normMemo = new Map();
    const norm = (s) => {
      let v = normMemo.get(s);
      if (v === undefined) {
        v = normalize(s);
        normMemo.set(s, v);
      }
      return v;
    };
    // The search index is built on first use (or when the app calls warm() right after the home
    // page is on screen), so the first paint never waits for it.
    let hay = null;
    let nameIndex = null;
    let genericIndex = null;
    let nameKeys = null;
    let genericKeys = null;
    function ensureIndex() {
      if (hay) return;
      hay = items.map((m) => ({
        name: norm(m.name),
        product: norm(m.product),
        generic: norm(m.generic),
        strength: norm(m.strength).replace(/\s/g, ''),
        form: norm(m.form),
        mfr: norm(m.manufacturer),
      }));
      buildEntityIndexes();
    }

    // name / generic indexes for entity extraction (assistant)
    function buildEntityIndexes() {
    nameIndex = new Map();
    genericIndex = new Map();
    items.forEach((m, i) => {
      const n = hay[i].name;
      if (n.length >= 3) {
        if (!nameIndex.has(n)) nameIndex.set(n, []);
        nameIndex.get(n).push(m);
        const first = n.split(' ')[0];
        if (first.length >= 4 && first !== n) {
          if (!nameIndex.has(first)) nameIndex.set(first, []);
          nameIndex.get(first).push(m);
        }
      }
      hay[i].generic.split(/\s*\+\s*/).forEach((g) => {
        const key = g.trim();
        if (key.length < 4) return;
        if (!genericIndex.has(key)) genericIndex.set(key, []);
        genericIndex.get(key).push(m);
        const first = key.split(' ')[0];
        if (first.length >= 5 && first !== key) {
          if (!genericIndex.has(first)) genericIndex.set(first, []);
          genericIndex.get(first).push(m);
        }
      });
    });
    nameKeys = [...nameIndex.keys()];
    genericKeys = [...genericIndex.keys()];
    }

    function expandToken(t) {
      const out = [t];
      if (alias.has(t)) out.push(...alias.get(t).split(' '));
      return out;
    }

    function scoreToken(h, t) {
      // returns best score for a single token against one item
      if (/^\d+(\.\d+)?(mg|mcg|g|ml|iu|%)?$/.test(t)) {
        if (h.strength === t || h.strength.startsWith(t + '+') || new RegExp('(^|\\+)' + t.replace('.', '\\.') + '(mg|mcg|g|ml|iu|%)?(\\b|\\+|/|$)').test(h.strength)) return 25;
        if (h.product.includes(t)) return 15;
        return 0;
      }
      if (h.name === t) return 100;
      if (h.name.startsWith(t)) return 85 - Math.min(10, h.name.length - t.length);
      if ((' ' + h.name).includes(' ' + t)) return 70;
      if ((' ' + h.generic).includes(' ' + t)) return h.generic.startsWith(t) ? 60 : 52;
      if (h.product.includes(t)) return 45;
      if (t.length >= 4 && h.generic.includes(t)) return 40;
      if (t.length >= 3 && h.form.startsWith(t)) return 12;
      if (t.length >= 4 && h.mfr.includes(t)) return 10;
      return 0;
    }

    /**
     * Search medicines. Returns [{ med, score }] sorted best-first.
     */
    function search(query, opts) {
      ensureIndex();
      const o = opts || {};
      const limit = o.limit || 50;
      const qt = tokens(query);
      if (!qt.length) return [];
      const expanded = qt.map(expandToken);
      const res = [];
      for (let i = 0; i < items.length; i++) {
        const m = items[i];
        if (o.category && m.category !== o.category) continue;
        const h = hay[i];
        let total = 0;
        let ok = true;
        for (const variants of expanded) {
          let best = 0;
          for (const v of variants) best = Math.max(best, scoreToken(h, v));
          if (best === 0) { ok = false; break; }
          total += best;
        }
        if (!ok) continue;
        if (m.popular) total += 14;
        if (CONSUMER_FORMS.test(m.form)) total += 4;
        res.push({ med: m, score: total });
      }
      res.sort((a, b) => b.score - a.score || a.med.name.localeCompare(b.med.name) || a.med.unitPrice - b.med.unitPrice);
      return res.slice(0, limit);
    }

    /** Autocomplete suggestions: distinct products, compact. */
    function suggest(query, limit) {
      const results = search(query, { limit: 60 });
      const out = [];
      const seen = new Set();
      for (const r of results) {
        const key = r.med.name + '|' + r.med.strength + '|' + r.med.form;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(r.med);
        if (out.length >= (limit || 8)) break;
      }
      return out;
    }

    // Sound-alike index: phoneticKey → names / generic words (built on first use)
    let phonIndex = null;
    let termRank = null;
    function ensurePhonIndex() {
      ensureIndex();
      if (phonIndex) return;
      phonIndex = new Map();
      termRank = new Map();
      const add = (k, kind, list) => {
        // index single words only (and the first word of multi-word names): what people type
        if (k.includes(' ') || k.length < 3 || /\d/.test(k)) return;
        const pk = phoneticKey(k);
        if (pk.replace('_', '').length < 3) return;
        if (!phonIndex.has(pk)) phonIndex.set(pk, []);
        phonIndex.get(pk).push({ term: k, kind });
        const pop = list.some((m) => m.popular) ? 1 : 0;
        const prev = termRank.get(k);
        if (!prev || prev.pop < pop || prev.n < list.length) termRank.set(k, { pop: Math.max(pop, prev ? prev.pop : 0), n: Math.max(list.length, prev ? prev.n : 0) });
      };
      nameIndex.forEach((list, k) => add(k, 'brand', list));
      genericIndex.forEach((list, k) => add(k, 'generic', list));
    }
    const rankOf = (term) => (termRank && termRank.get(term)) || { pop: 0, n: 0 };

    /**
     * Candidate corrections for one word (Latin, or Urdu script transliterated):
     * [{ term, d, sound }] best-first. sound: 2 = same consonant skeleton (panadool ~ panadol),
     * 1 = skeleton one consonant off, 0 = spelling only.
     */
    function wordCandidates(word, wasUrdu) {
      ensurePhonIndex();
      const q = normalize(transliterateUrdu(word)).replace(/[^a-z]/g, '');
      if (q.length < 3) return [];
      const fromUrdu = !!wasUrdu || hasUrdu(word);
      const max = q.length >= 8 ? 2 : 1;
      const found = new Map();
      const put = (term, d, sound) => {
        const prev = found.get(term);
        if (!prev) found.set(term, { term, d, sound });
        else { prev.d = Math.min(prev.d, d); prev.sound = Math.max(prev.sound, sound); }
      };
      // 1. spelling: edit distance on brand and generic words (needs 4+ letters)
      if (q.length >= 4 && !fromUrdu) {
        const scan = (keys) => {
          for (const k of keys) {
            const head = k.slice(0, q.length + max);
            const d = Math.min(editDistance(q, k, max), editDistance(q, head, max));
            if (d <= max) put(k, d, 0);
          }
        };
        scan(nameKeys);
        scan(genericKeys);
      }
      // 2. sound: same consonant skeleton (and, for longer words, one consonant off)
      const pk = phoneticKey(q);
      if (pk.replace('_', '').length >= 3) {
        for (const c of phonIndex.get(pk) || []) put(c.term, editDistance(q, c.term, 9), 2);
        if (pk.replace('_', '').length >= 4) {
          phonIndex.forEach((list, k) => {
            if (k === pk || Math.abs(k.length - pk.length) > 1 || k[0] !== pk[0]) return;
            if (editDistance(pk, k, 1) <= 1) for (const c of list) put(c.term, editDistance(q, c.term, 9) + 1, 1);
          });
        }
      }
      // sounding alike is not enough when the spelling is far off ("zzqqxx" is not "skymox")
      const far = Math.max(2, Math.floor(q.length / 3));
      return [...found.values()].filter((c) => c.d <= far + (c.sound === 1 ? 1 : 0)).sort((a, b) => {
        // Urdu script has no short vowels: rank by sound first, then popularity
        if (fromUrdu) return (b.sound - a.sound) || (rankOf(b.term).pop - rankOf(a.term).pop) || a.d - b.d || rankOf(b.term).n - rankOf(a.term).n;
        return a.d - b.d || (b.sound - a.sound) || (rankOf(b.term).pop - rankOf(a.term).pop) || rankOf(b.term).n - rankOf(a.term).n || a.term.length - b.term.length;
      });
    }

    /** "Did you mean" for misspelled queries (also Urdu script and Roman Urdu spellings). */
    function didYouMean(query, limit) {
      ensureIndex();
      const words = normalize(query).split(' ').filter((w) => w && !FILLER.has(w) && !/^\d/.test(w));
      const uniq = [];
      const seen = new Set();
      for (const w of words) {
        for (const c of wordCandidates(w)) {
          if (seen.has(c.term)) continue;
          seen.add(c.term);
          uniq.push(c.term);
          if (uniq.length >= (limit || 5)) return uniq;
        }
        if (uniq.length) break; // suggestions for the first word that has any
      }
      return uniq;
    }

    /**
     * Search, and when nothing matches, work out what was meant:
     *  - Urdu script (typed or spoken): transliterate, then match by sound (پیناڈول → panadol)
     *  - a symptom in Roman Urdu / English: "bukhar ki dawa" → paracetamol (Pain & Fever)
     *  - a misspelling: "panadool" → panadol, "glucofage" → glucophage
     * Returns { kind: 'exact'|'urdu'|'symptom'|'typo'|'none', query, results, suggestions, symptom? }.
     * `query` is what the results are for; suggestions are other did-you-mean terms.
     */
    function resolve(query, opts) {
      const o = opts || {};
      const direct = search(query, o);
      // "bp" or "sugar" alone mean the condition, unless a brand is called exactly that
      const sym = findSymptom(query);
      const nq = normalize(query);
      const preferSymptom = sym && sym.whole && !direct.some((x) => normalize(x.med.name) === nq);
      if (direct.length && !preferSymptom) return { kind: 'exact', query: String(query), results: direct, suggestions: [] };
      const urdu = hasUrdu(query);
      const latin = urdu ? normalize(transliterateUrdu(query)) : normalize(query);
      if (urdu && latin) {
        const r = search(latin, o);
        if (r.length) return { kind: 'urdu', query: latin, results: r, suggestions: [] };
      }
      // symptom words ("bukhar ki dawa", "khansi ka syrup", "sar dard", "bp")
      if (sym) {
        for (const g of sym.entry.generics) {
          const q2 = sym.form ? g + ' ' + sym.form : g;
          let r = search(q2, o);
          let used = q2;
          if (!r.length && sym.form) { r = search(g, o); used = g; }
          if (r.length) {
            return { kind: 'symptom', query: used, results: r, suggestions: sym.entry.generics.filter((x) => x !== g), symptom: { label: sym.entry.label, category: sym.entry.category } };
          }
        }
      }
      // misspelled / sound-alike words: correct each unknown word, keep numbers and forms
      const words = latin.split(' ').filter(Boolean);
      const fixed = [];
      let changed = false;
      let firstCands = null;
      for (const w of words) {
        if (/^\d/.test(w) || FORM_WORDS[w]) { fixed.push(FORM_WORDS[w] || w); continue; }
        if (FILLER.has(w)) { changed = true; continue; }
        if (search(w, { limit: 1 }).length) { fixed.push(w); continue; }
        const cands = wordCandidates(w, urdu);
        if (!cands.length) { changed = true; continue; } // unknown word: drop it
        if (!firstCands) firstCands = cands;
        fixed.push(cands[0].term);
        changed = true;
      }
      if (changed && fixed.some((w) => !/^\d/.test(w))) {
        const q2 = fixed.join(' ');
        let r = search(q2, o);
        let used = q2;
        if (!r.length && firstCands) { used = firstCands[0].term; r = search(used, o); }
        if (r.length) {
          return { kind: urdu ? 'urdu' : 'typo', query: used, results: r, suggestions: (firstCands || []).map((c) => c.term).filter((t) => t !== used).slice(0, 4) };
        }
      }
      return { kind: 'none', query: String(query), results: [], suggestions: didYouMean(query, 6) };
    }

    function byId(id) {
      return dataset.byId.get(id) || (dataset.aliases && dataset.aliases.get(id)) || null;
    }

    /** "5'sx4ml", "5 's x 4 ml" and "5S X4ML" are the same pack. */
    function packKey(p) {
      return String(p || '').toLowerCase().replace(/[\s'’`´"]/g, '').replace(/x/g, '*');
    }

    /**
     * Can `a` and `b` be compared on price? Counted packs (tablets, ml, doses) compare per unit.
     * When a pack couldn't be counted (unit 'pack', e.g. "5*4ml" ampoules or an inhaler), the
     * "unit price" is the whole pack, so it only compares with exactly the same pack.
     */
    function comparable(a, b) {
      if (a.unit === 'pack' || b.unit === 'pack') return a.unit === b.unit && packKey(a.pack) === packKey(b.pack);
      return a.unit === b.unit;
    }

    /** Same formula (ingredients, strength, form) and a comparable pack. Includes `med`. */
    function alternatives(med, sort) {
      if (!med || !med.group) return med ? [med] : [];
      const list = (dataset.groups.get(med.group) || [med]).filter((m) => m === med || comparable(m, med));
      const s = sort || 'unit';
      list.sort((a, b) => {
        if (s === 'pack') return a.price - b.price;
        if (s === 'name') return a.name.localeCompare(b.name);
        if (s === 'recent') return String(b.effective).localeCompare(String(a.effective));
        return a.unitPrice - b.unitPrice || a.price - b.price;
      });
      return list;
    }

    function cheapest(med) {
      const alts = alternatives(med, 'unit');
      return alts[0] || med;
    }

    function savings(med) {
      const c = cheapest(med);
      if (!c || c === med || c.unitPrice >= med.unitPrice) return null;
      const perUnit = med.unitPrice - c.unitPrice;
      return {
        cheapest: c,
        perUnit,
        percent: Math.round((perUnit / med.unitPrice) * 100),
        perPack: perUnit * med.units,
      };
    }

    /** Other strengths / forms of the same salt combination. */
    function strengths(med) {
      if (!med || !med.saltKey) return [];
      const list = dataset.bySalt.get(med.saltKey) || [];
      const map = new Map();
      for (const m of list) {
        if (m.group && m.group === med.group) continue;
        if (!m.group && m.id === med.id) continue;
        const key = m.group || m.strength + '|' + m.form;
        const prev = map.get(key);
        if (!prev || m.unitPrice < prev.med.unitPrice) map.set(key, { med: m, count: (prev ? prev.count : 0) + 1 });
        else prev.count++;
      }
      return [...map.values()]
        .sort((a, b) => String(a.med.form).localeCompare(String(b.med.form)) || parseFloat(a.med.strength) - parseFloat(b.med.strength))
        .slice(0, 16);
    }

    function groupSummary(med) {
      const alts = alternatives(med, 'unit');
      const prices = alts.map((a) => a.unitPrice);
      return {
        count: alts.length,
        min: prices.length ? Math.min(...prices) : med.unitPrice,
        max: prices.length ? Math.max(...prices) : med.unitPrice,
        median: median(prices),
        cheapest: alts[0] || med,
      };
    }

    /** Medicine "families" (same formula) in a category. */
    function categoryFamilies(catId, opts) {
      const o = opts || {};
      const filter = normalize(o.filter || '');
      const fam = new Map();
      for (const m of items) {
        if (m.category !== catId) continue;
        if (o.form && m.form !== o.form) continue;
        if (filter && !normalize(m.generic + ' ' + m.name).includes(filter)) continue;
        const key = m.group || 'solo:' + m.id;
        let f = fam.get(key);
        if (!f) {
          f = { key, generic: m.generic, strength: m.strength, form: m.form, unit: m.unit, members: [], popular: false };
          fam.set(key, f);
        }
        f.members.push(m);
        if (m.popular) f.popular = true;
      }
      const out = [...fam.values()].map((f) => {
        f.members.sort((a, b) => a.unitPrice - b.unitPrice);
        f.cheapest = f.members[0];
        f.min = f.members[0].unitPrice;
        f.max = f.members[f.members.length - 1].unitPrice;
        f.count = f.members.length;
        f.consumer = CONSUMER_FORMS.test(f.form);
        return f;
      });
      out.sort((a, b) => (b.popular - a.popular) || (b.consumer - a.consumer) || b.count - a.count || a.generic.localeCompare(b.generic));
      return out;
    }

    function categoryForms(catId) {
      const counts = new Map();
      for (const m of items) if (m.category === catId) counts.set(m.form, (counts.get(m.form) || 0) + 1);
      return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([form, count]) => ({ form, count }));
    }

    function categoryCounts() {
      const counts = new Map();
      for (const m of items) counts.set(m.category, (counts.get(m.category) || 0) + 1);
      return counts;
    }

    /** Popular medicines with the biggest same-formula savings. */
    function topSavings(limit) {
      const seenGroups = new Set();
      const out = [];
      const candidates = items.filter((m) => m.popular && m.group && CONSUMER_FORMS.test(m.form));
      for (const m of candidates) {
        const s = savings(m);
        if (!s || s.percent < 15) continue;
        out.push({ med: m, s });
      }
      out.sort((a, b) => b.s.percent - a.s.percent);
      const res = [];
      for (const x of out) {
        if (seenGroups.has(x.med.group)) continue;
        seenGroups.add(x.med.group);
        res.push(x);
        if (res.length >= (limit || 8)) break;
      }
      return res;
    }

    function popular(limit) {
      const seen = new Set();
      const out = [];
      for (const m of items) {
        if (!m.popular || !CONSUMER_FORMS.test(m.form)) continue;
        if (seen.has(m.name)) continue;
        seen.add(m.name);
        out.push(m);
      }
      out.sort((a, b) => (dataset.groups.get(b.group) || []).length - (dataset.groups.get(a.group) || []).length);
      return out.slice(0, limit || 10);
    }

    /**
     * Pick the best product for a set of candidates, using hints from the text
     * (e.g. "panadol 500", "augmentin syrup").
     */
    function pickBest(cands, text) {
      if (!cands || !cands.length) return null;
      const t = normalize(text || '');
      const nums = (t.match(/\d+(\.\d+)?/g) || []).map(Number);
      const formHint = /syrup|syp|sharbat|شربت/.test(t) ? 'syrup' : /susp/.test(t) ? 'suspension' : /drop/.test(t) ? 'drops' : /inj|teeka|injection/.test(t) ? 'injection' : /cream|ointment|gel|marham/.test(t) ? 'cream' : /cap/.test(t) ? 'capsule' : /tab|goli/.test(t) ? 'tablet' : '';
      let best = null;
      let bestScore = -Infinity;
      for (const m of cands) {
        let s = 0;
        const sv = parseFloat(m.strength);
        if (nums.length && nums.some((n) => n === sv || m.strength.includes(String(n)))) s += 30;
        if (formHint && m.form.toLowerCase().includes(formHint)) s += 25;
        if (!formHint && /tablet|capsule/i.test(m.form)) s += 8;
        if (CONSUMER_FORMS.test(m.form)) s += 5;
        if (m.popular) s += 6;
        s += Math.min(10, (dataset.groups.get(m.group) || []).length / 3);
        if (s > bestScore) { bestScore = s; best = m; }
      }
      return best;
    }

    /**
     * Find medicine mentions in free text. Returns
     * [{ term, kind: 'brand'|'generic', items, best }] in order of appearance.
     */
    function findInText(text) {
      ensureIndex();
      const raw = normalize(text);
      const words = raw.split(' ').filter(Boolean);
      const STOP = new Set(['the', 'and', 'for', 'price', 'cost', 'what', 'is', 'of', 'me', 'my', 'a', 'an', 'to', 'in', 'ki', 'ka', 'ke', 'kya', 'hai', 'he', 'tablet', 'tablets', 'tab', 'syrup', 'capsule', 'injection', 'medicine', 'dawa', 'dawai', 'goli', 'cheaper', 'cheap', 'sasta', 'sasti', 'alternative', 'alternatives', 'generic', 'compare', 'vs', 'or', 'ya', 'with', 'than', 'instead', 'formula', 'salt', 'price', 'qeemat', 'kitne', 'kitna', 'kitni', 'add', 'list', 'show', 'tell', 'about', 'please', 'plz', 'mujhe', 'batao', 'bataen', 'chahiye', 'option', 'options', 'brand', 'brands', 'same', 'other', 'any', 'how', 'much', 'rs', 'rupees', 'pkr', 'mg', 'ml', 'per', 'pack', 'box', 'need', 'want', 'buy', 'find', 'search', 'better', 'best', 'which', 'where', 'can', 'i', 'get', 'use', 'used', 'uses', 'doctor', 'prescribed', 'wala', 'wali', 'walay', 'se', 'sy', 'aur', 'or', 'bhi', 'koi', 'hain', 'hy', 'available', 'pakistan', 'tell', 'mein', 'main', 'mai', 'k', 'liye', 'liay', 'lye',
        'dose', 'doses', 'dosage', 'unit', 'units', 'side', 'effect', 'effects', 'safe', 'take', 'taking', 'child', 'children', 'baby', 'kids',
        'day', 'daily', 'time', 'times', 'morning', 'night', 'water', 'food', 'after', 'before', 'pregnancy', 'women', 'woman', 'adult',
        'this', 'that', 'it', 'are', 'was', 'should', 'would', 'could', 'will', 'have', 'has', 'had', 'been', 'do', 'does', 'did', 'give',
        'also', 'very', 'many', 'more', 'less', 'then', 'when', 'who', 'why', 'ilaj', 'bimari', 'salam', 'salaam', 'assalam', 'hello', 'thanks',
        'thank', 'shukriya', 'please', 'mera', 'meri', 'mere', 'hum', 'aap', 'ap', 'yeh', 'ye', 'woh', 'wo', 'kaise', 'kaisa', 'kab', 'kahan',
        'pain', 'dard', 'fever', 'bukhar', 'cough', 'cold', 'sugar', 'acidity', 'virus', 'antigen', 'vaccine', 'strain', 'oral', 'solution',
        'powder', 'cream', 'drops', 'injection', 'infusion', 'suspension', 'sachet', 'gel', 'ointment', 'lotion', 'spray', 'plus', 'forte', 'extra']);
      const found = [];
      const used = new Array(words.length).fill(false);
      for (let n = 3; n >= 1; n--) {
        for (let i = 0; i + n <= words.length; i++) {
          if (used.slice(i, i + n).some(Boolean)) continue;
          const phrase = words.slice(i, i + n).join(' ');
          if (n === 1 && (STOP.has(phrase) || phrase.length < 3 || /^\d/.test(phrase))) continue;
          const canonical = alias.get(phrase) || phrase;
          let hit = null;
          if (n === 1 && STOP.has(canonical)) continue;
          if (genericIndex.has(canonical)) hit = { kind: 'generic', items: genericIndex.get(canonical) };
          else if (nameIndex.has(canonical)) hit = { kind: 'brand', items: nameIndex.get(canonical) };
          if (hit) {
            for (let k = i; k < i + n; k++) used[k] = true;
            found.push({ term: phrase, pos: i, ...hit });
          }
        }
      }
      // Fuzzy pass for leftover longer words (typos like "panadool", "augmentn")
      words.forEach((w, i) => {
        if (used[i] || STOP.has(w) || w.length < 6 || /\d/.test(w)) return;
        const max = w.length >= 8 ? 2 : 1;
        let best = null;
        for (const k of nameKeys) {
          if (Math.abs(k.length - w.length) > max || k[0] !== w[0]) continue;
          const d = editDistance(w, k, max);
          if (d <= max && (!best || d < best.d)) best = { k, d, kind: 'brand' };
        }
        if (!best) {
          for (const k of genericKeys) {
            if (Math.abs(k.length - w.length) > max || k[0] !== w[0]) continue;
            const d = editDistance(w, k, max);
            if (d <= max && (!best || d < best.d)) best = { k, d, kind: 'generic' };
          }
        }
        if (best) {
          used[i] = true;
          found.push({ term: best.k, pos: i, kind: best.kind, fuzzy: true, items: (best.kind === 'brand' ? nameIndex : genericIndex).get(best.k) });
        }
      });
      found.sort((a, b) => a.pos - b.pos);
      // Pick a best product per mention using nearby words as hints
      return found.map((f) => {
        const ctx = words.slice(Math.max(0, f.pos - 1), f.pos + 4).join(' ');
        return { term: f.term, kind: f.kind, fuzzy: !!f.fuzzy, items: f.items, best: pickBest(f.items, ctx) };
      });
    }

    function stats() {
      return {
        products: items.length,
        groups: dataset.groups.size,
        manufacturers: new Set(items.map((m) => m.manufacturer)).size,
      };
    }

    return {
      warm: ensureIndex,
      search,
      suggest,
      didYouMean,
      resolve,
      byId,
      alternatives,
      cheapest,
      savings,
      strengths,
      groupSummary,
      categoryFamilies,
      categoryForms,
      categoryCounts,
      topSavings,
      popular,
      pickBest,
      findInText,
      stats,
      normalize,
    };
  }

  /**
   * Search over registered brands that have no DRAP price (data/registry.json), and find the
   * priced brands with the same salt. `dataset` is the expanded price dataset (for bySalt).
   */
  function createRegistryIndex(registry, dataset) {
    const items = (registry && registry.items) || [];
    let hay = null;
    function ensure() {
      if (hay) return;
      hay = items.map((m) => ({
        name: normalize(m.name),
        product: normalize(m.product),
        generic: normalize(m.generic),
        strength: normalize(m.strength).replace(/\s/g, ''),
      }));
    }

    function scoreToken(h, t) {
      if (/^\d+(\.\d+)?(mg|mcg|g|ml|iu|%)?$/.test(t)) {
        if (h.strength && (h.strength === t || h.strength.startsWith(t))) return 25;
        return h.product.includes(t) ? 15 : 0;
      }
      if (h.name === t) return 100;
      if (h.name.startsWith(t)) return 85 - Math.min(10, h.name.length - t.length);
      if ((' ' + h.name).includes(' ' + t)) return 70;
      if (h.product.startsWith(t)) return 65;
      if ((' ' + h.generic).includes(' ' + t)) return 40;
      return 0;
    }

    /** Brand-name search. Returns [{ med, score }] best-first, one row per brand + strength + form. */
    function search(query, opts) {
      const limit = (opts && opts.limit) || 20;
      const minScore = (opts && opts.minScore) || 0;
      const qn = normalize(query);
      const qt = qn.split(/[\s+\-]+/).filter(Boolean);
      if (!qt.length || !items.length) return [];
      ensure();
      const res = [];
      for (let i = 0; i < items.length; i++) {
        // whole query against the brand name first ("metfo-x", "co-diovan")
        if (qt.length > 1 && hay[i].name.startsWith(qn)) {
          res.push({ med: items[i], score: (hay[i].name === qn ? 100 : 85) * qt.length });
          continue;
        }
        let total = 0;
        let ok = true;
        for (const t of qt) {
          const s = scoreToken(hay[i], t);
          if (!s) { ok = false; break; }
          total += s;
        }
        if (ok && total / qt.length >= minScore) res.push({ med: items[i], score: total });
      }
      res.sort((a, b) => b.score - a.score || a.med.name.localeCompare(b.med.name) || a.med.product.localeCompare(b.med.product));
      const seen = new Set();
      const out = [];
      for (const r of res) {
        const k = r.med.name.toLowerCase() + '|' + r.med.strength + '|' + r.med.form;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(r);
        if (out.length >= limit) break;
      }
      return out;
    }

    function byReg(reg) {
      return registry && registry.byReg ? registry.byReg.get(String(reg)) || null : null;
    }

    /**
     * Priced brands with the same salt, cheapest per unit first. Same strength + form come first
     * (`exact: true`), then other strengths/forms of the same salt.
     */
    function pricedAlternatives(item) {
      if (!item || !item.saltKey || !dataset || !dataset.bySalt) return [];
      const list = dataset.bySalt.get(item.saltKey) || [];
      const strength = normalize(item.strength).replace(/\s/g, '');
      const form = String(item.form || '').toLowerCase();
      const best = new Map();
      for (const m of list) {
        const k = m.name + '|' + m.strength + '|' + m.form;
        const prev = best.get(k);
        if (!prev || m.unitPrice < prev.unitPrice) best.set(k, m);
      }
      return [...best.values()]
        .map((m) => {
          const sameStrength = !!strength && normalize(m.strength).replace(/\s/g, '') === strength;
          const sameForm = !!form && String(m.form).toLowerCase().split(' ')[0] === form.split(' ')[0];
          return { med: m, exact: sameStrength && sameForm, sameStrength, sameForm };
        })
        .sort((a, b) => (b.exact - a.exact) || (b.sameStrength - a.sameStrength) || (b.sameForm - a.sameForm) || a.med.unitPrice - b.med.unitPrice);
    }

    /**
     * Other registered brands with the same salt that have no DRAP price either (for salts like
     * etoricoxib where no brand is priced). Same strength + form first, one row per brand.
     */
    function unpricedAlternatives(item, limit) {
      if (!item || !item.saltKey || !registry || !registry.bySalt) return [];
      const strength = normalize(item.strength).replace(/\s/g, '');
      const form = String(item.form || '').toLowerCase();
      const seen = new Set([item.name.toLowerCase() + '|' + item.strength + '|' + item.form]);
      const out = [];
      for (const m of registry.bySalt.get(item.saltKey) || []) {
        const k = m.name.toLowerCase() + '|' + m.strength + '|' + m.form;
        if (seen.has(k)) continue;
        seen.add(k);
        const sameStrength = !!strength && normalize(m.strength).replace(/\s/g, '') === strength;
        const sameForm = !!form && String(m.form).toLowerCase() === form;
        out.push({ med: m, exact: sameStrength && sameForm, sameStrength, sameForm });
      }
      out.sort((a, b) => (b.exact - a.exact) || (b.sameStrength - a.sameStrength) || (b.sameForm - a.sameForm) || a.med.name.localeCompare(b.med.name));
      return out.slice(0, limit || 30);
    }

    return { warm: ensure, search, byReg, pricedAlternatives, unpricedAlternatives, size: items.length };
  }

  return { createEngine, createRegistryIndex, normalize, editDistance, transliterateUrdu, phoneticKey, hasUrdu, findSymptom };
});
