/**
 * Sasta Dawa Finder - Dawa Assistant.
 *
 * Two layers:
 *  1. `createBrain(engine)` — an instant, offline, rule-based assistant that understands
 *     English, Roman Urdu and Urdu phrasing ("panadol ka sasta option", "risek ki qeemat",
 *     "augmentin vs amoxil"). It answers only from the DRAP dataset and never gives
 *     dosing or diagnosis advice. Works in Node too (unit-tested).
 *  2. The chat UI (browser only). When the server exposes /api/chat (Claude, grounded with
 *     tool calls into the same dataset) it uses that, and falls back to the offline brain
 *     whenever the network or API is unavailable.
 */
(function (root, factory) {
  const lib = factory();
  if (typeof module === 'object' && module.exports) module.exports = lib;
  if (typeof window !== 'undefined') window.SDAssistant = lib;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ---------------------------------------------------------------------
  // Intent patterns (English + Roman Urdu + Urdu script)
  // ---------------------------------------------------------------------
  const RX = {
    emergency: /\b(over ?dose|poison(ed|ing)?|zehr|zeher|zehar|suicid|khud ?kushi|kill myself|end my life|chest pain|seen[ea] (mein|me|main) dard|can'?t breathe|cannot breathe|saa?ns (nahi|nai|nhi)|behosh|unconscious|faint(ed)?|seizure|fits?\b|daura|heavy bleeding|khoon (beh|bah)|anaphyla|throat (is )?swelling|swollen (face|throat)|stroke)\b|زہر|خودکشی|بے ہوش|سانس نہیں/i,
    greeting: /^\s*(hi+|hello|hey|salam|salaam|assalam|aoa|asalam|slam|السلام|سلام|hola)\b/i,
    thanks: /\b(thanks?|thank you|shukriya|shukria|jazak|شکریہ)\b/i,
    help: /\b(help|what can you do|kya kar sakt|madad|how (do|does) (this|it) work)\b|مدد/i,
    cabinet: /\b(my (medicines|list|cabinet)|meri (dawai|dawaiyan|dawa|list)|monthly (cost|kharcha)|kharcha)\b|میری دوائیں/i,
    add: /\b(add|save|shamil|daal ?do|dal ?do|list mein)\b|شامل/i,
    pharmacy: /\b(pharmacy|pharmacies|chemist|medical store|near ?by|near me|qareeb|kareeb|nazdeek)\b|قریب|فارمیسی/i,
    advice: /\b(dose|dosage|how (many|much) (should|to|can)|kitni (bar|baar|dafa|martaba|goli|goliyan)|din mein kitn|side ?effects?|nuqsan|nuksan|pregnan|hamla|hamal|breast ?feed|doodh pila|is it safe|safe (for|to|hai)|kya (main|mein|me) (kha|le) sakt|can i (take|give|use)|interaction|alcohol|sharab|khali pait|empty stomach|bachon? (ko|ke liye)|for (kids|children|baby)|which (one )?is better|kaun ?si (behtar|achi)|best medicine for)\b/i,
    compare: /\b(compare|comparison|vs\.?|versus|difference|farq|muqabla)\b|فرق|موازنہ/i,
    alternative: /\b(cheap(er|est)?|sast[aiy]|kam qeemat|alternatives?|substitutes?|generics?|instead|badal|mutabadil|similar|same formula|replace(ment)?|other brands?|options?|koi aur)\b|سستا|سستی|متبادل/i,
    price: /\b(price|prices|qeemat|keemat|qimat|kimat|kitne ka|kitni ki|kitna|cost|rate|mrp|rs\.?|rupees?)\b|قیمت|کتنے/i,
    formula: /\b(formula|salt|ingredients?|contains|composition|generic name|kis cheez|banta|what is|kya hai|kia hai)\b|فارمولا|سالٹ/i,
    more: /^\s*(and|aur|or|more|another|next|phir|then)\b.*\b(cheap|sasta|option|alternative)/i,
  };

  const SYMPTOMS = [
    ['pain', /\b(fever|bukhar|bukhaar|pain|dard|headache|sar ?dard|body ache|migraine|toothache|daant)\b|بخار|درد/i],
    ['stomach', /\b(acidity|tezabiyat|tezabi|heartburn|jalan|gas|stomach|pait|pet|ulcer|loose motion|dast|diarrh|vomit|ulti|qay|constipation|qabz|nausea|matli)\b|تیزابیت|پیٹ|دست|قبض|الٹی/i],
    ['diabetes', /\b(sugar|diabetes|diabetic|shugar)\b|شوگر|ذیابیطس/i],
    ['heart', /\b(bp|blood pressure|hypertension|heart|dil|cholesterol)\b|بلڈ پریشر|دل/i],
    ['respiratory', /\b(cough|khansi|khaansi|flu|nazla|zukam|zukaam|cold|allergy|allergic|asthma|dama|sneez|cheenk)\b|کھانسی|نزلہ|زکام|الرجی|دمہ/i],
    ['antibiotics', /\b(infection|antibiotic|throat infection|gala kharab|typhoid|uti)\b|انفیکشن/i],
    ['skin', /\b(skin|jild|itch|kharish|khujli|rash|daane|acne|pimple|eczema|fungal|daad|scabies)\b|خارش|جلد|دانے/i],
    ['vitamins', /\b(vitamin|weakness|kamzori|calcium|iron|khoon ki kami|anemia)\b|وٹامن|کمزوری/i],
    ['brain', /\b(depression|anxiety|ghabrahat|sleep|neend|insomnia|epilepsy|mirgi)\b|نیند|ڈپریشن|مرگی/i],
    ['women', /\b(thyroid|period|hormone|pcos|contracepti)\b|تھائرائیڈ/i],
    ['urology', /\b(urine|peshab|kidney|gurda|gurde|prostate)\b|پیشاب|گردے/i],
    ['eye', /\b(eye|aankh|ankh|ear|kaan)\b|آنکھ|کان/i],
  ];

  // ---------------------------------------------------------------------
  // Strings
  // ---------------------------------------------------------------------
  const S = {
    en: {
      hello: "Assalam-o-alaikum! I'm the Dawa Assistant. Tell me a medicine name and I'll show its official DRAP price and cheaper brands with the **same formula**.",
      help: 'You can ask me things like:\n- **Panadol ka sasta option?**\n- **Risek 40 price**\n- **Augmentin vs Amoxil**\n- **What is the formula of Brufen?**\n- **Add Glucophage to my medicines**\n\nI only use DRAP-registered prices. I can’t give dosage or diagnosis advice — your doctor or pharmacist can.',
      thanks: 'You’re welcome! Ask me about any other medicine anytime.',
      emergency: '⚠️ **This sounds like an emergency.** Please call **Rescue 1122** or **Edhi 115** right now, or go to the nearest hospital emergency. Don’t wait for an online answer.',
      advice: 'I can’t advise on **dose, safety, side effects or which medicine to take** — that depends on your health and must come from your doctor or pharmacist. Please also read the leaflet inside the pack.',
      advice_med: 'Here is the price and formula information I *can* share for **{name}**:',
      not_found: 'I couldn’t find that medicine in the DRAP price list. Check the spelling, or try the salt name (e.g. *paracetamol*, *omeprazole*).',
      did_you_mean: 'Did you mean: {list}?',
      price: '**{name}** ({form}) costs **{price}** for {pack} — that’s **{unit}** per {u}. Price effective {date}.',
      formula: '**{name}** contains **{generic}**{strength}.',
      alt_found: 'Found **{n} brands** with exactly the same formula ({generic} {strength}, {form}). Cheapest is **{cheap}** at **{cprice}** per {u}{save}.',
      alt_save: ' — about **{pct}% less** than {name}',
      alt_is_cheapest: '**{name}** is already the cheapest of **{n} brands** with this formula. 👍',
      alt_none: 'I didn’t find another brand with exactly the same formula, strength and form as **{name}**.',
      alt_other_strengths: 'Other strengths/forms are available — tap one below. Don’t change strength without your doctor.',
      switch_note: 'Show the cheaper brand to your pharmacist before switching.',
      compare_head: 'Comparing **{a}** and **{b}**:',
      compare_same: 'They have the **same formula** ({generic}). {cheaper} is cheaper by **{pct}%** per {u}.',
      compare_samep: 'They have the same formula and the same price per {u}.',
      compare_diff: 'They are **different medicines** — {a} is *{ga}* and {b} is *{gb}*. They are not substitutes for each other.',
      compare_need_two: 'Tell me two medicine names to compare, e.g. **Panadol vs Calpol**.',
      symptom: 'I can’t tell which medicine is right for your symptoms — please see a doctor or pharmacist. If you already have a prescription, type the medicine name and I’ll find a cheaper same-formula brand.',
      symptom_cat: 'You can also browse **{cat}** medicines with prices:',
      pharmacy: 'I’ll open Google Maps to show pharmacies near you. Call ahead to check stock.',
      cabinet_empty: 'Your **My Medicines** list is empty. Ask me to add one, e.g. *“add Concor 5 to my medicines”*.',
      cabinet_sum: 'You have **{n}** medicine(s) in your list. Monthly cost: **{now}**. With the cheapest same-formula brands: **{best}** — you could save **{save}/month**.',
      added: 'Added **{name}** to My Medicines. 👍',
      already: '**{name}** is already in My Medicines.',
      need_med: 'Which medicine? Type its name, e.g. **Panadol** or **metformin**.',
      a_open: 'Open details',
      a_alts: 'Cheaper options',
      a_add: 'Add to My Medicines',
      a_cabinet: 'Open My Medicines',
      a_maps: 'Open Google Maps',
      a_cat: 'Browse {cat}',
      a_call: 'Call 1122',
      chips: ['Panadol ka sasta option', 'Risek 40 price', 'Augmentin vs Amoxil', 'Formula of Brufen', 'My medicines'],
      u_unit: 'tablet', u_capsule: 'capsule', u_dose: 'dose', u_ml: 'ml', u_g: 'gram', u_pack: 'pack',
    },
    ur: {
      hello: 'السلام علیکم! میں دوا معاون ہوں۔ کسی دوا کا نام لکھیں، میں اس کی ڈریپ قیمت اور **اسی فارمولے** والے سستے برانڈ بتاؤں گا۔',
      help: 'آپ ایسے پوچھ سکتے ہیں:\n- **Panadol ka sasta option?**\n- **Risek 40 کی قیمت**\n- **Augmentin vs Amoxil**\n- **Brufen کا فارمولا کیا ہے؟**\n- **Glucophage میری دواؤں میں شامل کریں**\n\nمیں صرف ڈریپ کی قیمتیں بتاتا ہوں۔ خوراک یا بیماری کے بارے میں مشورہ ڈاکٹر یا فارماسسٹ سے لیں۔',
      thanks: 'خوش آمدید! کسی اور دوا کے بارے میں بھی پوچھ لیں۔',
      emergency: '⚠️ **یہ ایمرجنسی لگتی ہے۔** فوراً **ریسکیو 1122** یا **ایدھی 115** پر کال کریں یا قریبی ہسپتال کی ایمرجنسی جائیں۔',
      advice: 'میں **خوراک، حفاظت، سائیڈ ایفیکٹس یا کون سی دوا لیں** کے بارے میں مشورہ نہیں دے سکتا — یہ آپ کا ڈاکٹر یا فارماسسٹ بتائے گا۔ پیک کے اندر موجود پرچہ بھی ضرور پڑھیں۔',
      advice_med: '**{name}** کی قیمت اور فارمولے کی معلومات یہ ہیں:',
      not_found: 'یہ دوا ڈریپ کی فہرست میں نہیں ملی۔ ہجے چیک کریں یا سالٹ کا نام لکھیں (مثلاً *paracetamol*)۔',
      did_you_mean: 'کیا آپ کا مطلب تھا: {list}؟',
      price: '**{name}** ({form}) کی قیمت **{price}** ہے ({pack}) — یعنی **{unit}** فی {u}۔ قیمت {date} سے لاگو۔',
      formula: '**{name}** میں **{generic}**{strength} ہے۔',
      alt_found: 'بالکل اسی فارمولے ({generic} {strength}، {form}) کے **{n} برانڈ** ملے۔ سب سے سستا **{cheap}** ہے، **{cprice}** فی {u}{save}۔',
      alt_save: ' — {name} سے تقریباً **{pct}% کم**',
      alt_is_cheapest: '**{name}** پہلے ہی اس فارمولے کے **{n} برانڈز** میں سب سے سستا ہے۔ 👍',
      alt_none: '**{name}** جیسے بالکل اسی فارمولے، طاقت اور شکل کا کوئی اور برانڈ نہیں ملا۔',
      alt_other_strengths: 'دوسری طاقتیں/اقسام دستیاب ہیں — نیچے دیکھیں۔ طاقت ڈاکٹر کے مشورے کے بغیر نہ بدلیں۔',
      switch_note: 'دوا بدلنے سے پہلے سستا برانڈ فارماسسٹ کو دکھائیں۔',
      compare_head: '**{a}** اور **{b}** کا موازنہ:',
      compare_same: 'دونوں کا **فارمولا ایک ہے** ({generic})۔ {cheaper} فی {u} **{pct}%** سستی ہے۔',
      compare_samep: 'دونوں کا فارمولا اور فی {u} قیمت ایک جیسی ہے۔',
      compare_diff: 'یہ **مختلف ادویات** ہیں — {a} میں *{ga}* اور {b} میں *{gb}* ہے۔ یہ ایک دوسرے کا متبادل نہیں۔',
      compare_need_two: 'موازنے کے لیے دو دواؤں کے نام لکھیں، مثلاً **Panadol vs Calpol**۔',
      symptom: 'میں علامات کی بنیاد پر دوا تجویز نہیں کر سکتا — براہ کرم ڈاکٹر یا فارماسسٹ سے ملیں۔ اگر نسخہ موجود ہے تو دوا کا نام لکھیں، میں اسی فارمولے کا سستا برانڈ ڈھونڈ دوں گا۔',
      symptom_cat: '**{cat}** کی ادویات قیمتوں کے ساتھ یہاں دیکھیں:',
      pharmacy: 'قریبی فارمیسی دیکھنے کے لیے گوگل میپس کھول رہا ہوں۔ جانے سے پہلے فون کر کے دوا کا پوچھ لیں۔',
      cabinet_empty: 'آپ کی **میری دوائیں** فہرست خالی ہے۔ مثلاً لکھیں *“Concor 5 میری دواؤں میں شامل کریں”*۔',
      cabinet_sum: 'آپ کی فہرست میں **{n}** دوائیں ہیں۔ ماہانہ خرچ: **{now}**۔ سستے برانڈز کے ساتھ: **{best}** — ماہانہ **{save}** کی بچت ممکن ہے۔',
      added: '**{name}** میری دواؤں میں شامل ہو گئی۔ 👍',
      already: '**{name}** پہلے سے میری دواؤں میں ہے۔',
      need_med: 'کون سی دوا؟ نام لکھیں، مثلاً **Panadol** یا **metformin**۔',
      a_open: 'تفصیل دیکھیں',
      a_alts: 'سستے آپشن',
      a_add: 'میری دواؤں میں شامل کریں',
      a_cabinet: 'میری دوائیں کھولیں',
      a_maps: 'گوگل میپس کھولیں',
      a_cat: '{cat} دیکھیں',
      a_call: '1122 پر کال کریں',
      chips: ['Panadol ka sasta option', 'Risek 40 کی قیمت', 'Augmentin vs Amoxil', 'Brufen کا فارمولا', 'میری دوائیں'],
      u_unit: 'گولی', u_capsule: 'کیپسول', u_dose: 'خوراک', u_ml: 'ملی لیٹر', u_g: 'گرام', u_pack: 'پیک',
    },
  };

  function fill(s, p) {
    let out = s;
    Object.keys(p || {}).forEach((k) => (out = out.split('{' + k + '}').join(p[k])));
    return out;
  }

  function rs(v) {
    if (typeof v !== 'number' || !isFinite(v)) return 'Rs —';
    const d = v >= 100 ? 0 : 2;
    return 'Rs ' + v.toLocaleString('en-PK', { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  function createBrain(engine, opts) {
    const o = opts || {};
    const getCabinet = o.getCabinet || (() => []);
    const addToCabinet = o.addToCabinet || (() => false);
    const categories = o.categories || [];

    function L(lang) {
      return S[lang] || S.en;
    }

    function unitWord(med, lang) {
      const s = L(lang);
      if (med.unit === 'unit') return /capsule/i.test(med.form) ? s.u_capsule : s.u_unit;
      return s['u_' + med.unit] || med.unit;
    }

    function title(med) {
      return med.strength && !med.name.includes(med.strength) ? `${med.name} ${med.strength}` : med.name;
    }

    function catLabel(id, lang) {
      const c = categories.find((x) => x.id === id);
      return c ? (lang === 'ur' ? c.ur : c.en) : id;
    }

    function priceText(med, lang) {
      return fill(L(lang).price, {
        name: title(med),
        form: med.form,
        price: rs(med.price),
        pack: med.pack || '1 pack',
        unit: rs(med.unitPrice),
        u: unitWord(med, lang),
        date: med.effective || '—',
      });
    }

    function alternativesBlock(med, lang, reply) {
      const s = L(lang);
      const alts = engine.alternatives(med, 'unit');
      if (alts.length <= 1) {
        reply.text.push(fill(s.alt_none, { name: title(med) }));
        const str = engine.strengths(med).slice(0, 4);
        if (str.length) {
          reply.text.push(s.alt_other_strengths);
          reply.cards.push(...str.map((x) => ({ id: x.med.id, kind: 'alt' })));
        }
        return;
      }
      const sv = engine.savings(med);
      if (!sv) {
        reply.text.push(fill(s.alt_is_cheapest, { name: title(med), n: alts.length }));
        reply.cards.push({ id: med.id, kind: 'cheap' });
        reply.cards.push(...alts.filter((a) => a.id !== med.id).slice(0, 2).map((a) => ({ id: a.id, kind: 'alt' })));
        return;
      }
      reply.text.push(
        fill(s.alt_found, {
          n: alts.length,
          generic: med.generic,
          strength: med.strength,
          form: med.form,
          cheap: sv.cheapest.name,
          cprice: rs(sv.cheapest.unitPrice),
          u: unitWord(med, lang),
          save: sv.percent >= 1 ? fill(s.alt_save, { pct: sv.percent, name: med.name }) : '',
        })
      );
      const cheapOnes = alts.filter((a) => a.id !== med.id).slice(0, 3);
      reply.cards.push(...cheapOnes.map((a, i) => ({ id: a.id, kind: i === 0 ? 'cheap' : 'alt' })));
      reply.cards.push({ id: med.id, kind: 'current' });
      reply.text.push(s.switch_note);
    }

    function medActions(med, lang) {
      const s = L(lang);
      return [
        { label: s.a_open, action: 'open', value: med.id },
        { label: s.a_add, action: 'add', value: med.id },
      ];
    }

    /**
     * Main entry: returns { text: [markdown], cards: [{id, kind}], actions: [{label, action, value}], context }
     */
    function reply(message, ctx) {
      const c = ctx || {};
      const lang = c.lang === 'ur' ? 'ur' : 'en';
      const s = L(lang);
      const text = String(message || '').trim();
      const out = { text: [], cards: [], actions: [], context: { lastMedId: c.lastMedId || null } };
      if (!text) {
        out.text.push(s.hello);
        return out;
      }

      if (RX.emergency.test(text)) {
        out.text.push(s.emergency);
        out.actions.push({ label: s.a_call, action: 'tel', value: '1122' });
        out.urgent = true;
        return out;
      }

      const mentions = engine.findInText(text).filter((m) => m.best);
      const lastMed = c.lastMedId ? engine.byId(c.lastMedId) : null;
      const med = mentions.length ? mentions[0].best : null;
      const isGreeting = RX.greeting.test(text) && !med;
      if (med) out.context.lastMedId = med.id;

      if (isGreeting && text.split(/\s+/).length <= 4) {
        out.text.push(s.hello);
        return out;
      }
      if (RX.thanks.test(text) && !med && text.split(/\s+/).length <= 5) {
        out.text.push(s.thanks);
        return out;
      }
      if (RX.help.test(text) && !med) {
        out.text.push(s.help);
        return out;
      }

      // Dosage / safety questions: decline politely, still show facts
      if (RX.advice.test(text)) {
        out.text.push(s.advice);
        const target = med || lastMed;
        if (target && med) {
          out.text.push(fill(s.advice_med, { name: title(target) }));
          out.text.push(fill(s.formula, { name: title(target), generic: target.generic, strength: target.strength ? ' ' + target.strength : '' }));
          out.cards.push({ id: target.id, kind: 'current' });
          out.actions.push(...medActions(target, lang));
        }
        return out;
      }

      if (RX.pharmacy.test(text) && !RX.price.test(text)) {
        out.text.push(s.pharmacy);
        out.actions.push({ label: s.a_maps, action: 'link', value: 'https://www.google.com/maps/search/pharmacy+near+me' });
        return out;
      }

      // My Medicines
      if (RX.add.test(text) && (med || lastMed) && (RX.cabinet.test(text) || /\b(add|shamil|save)\b|شامل/i.test(text))) {
        const target = med || lastMed;
        const ok = addToCabinet(target.id);
        out.text.push(fill(ok ? s.added : s.already, { name: title(target) }));
        out.actions.push({ label: s.a_cabinet, action: 'route', value: '/my-medicines' });
        out.cards.push({ id: target.id, kind: 'current' });
        return out;
      }
      if (RX.cabinet.test(text) && !med) {
        const list = getCabinet();
        if (!list.length) {
          out.text.push(s.cabinet_empty);
          return out;
        }
        let now = 0;
        let best = 0;
        list.forEach(({ id, qty }) => {
          const m = engine.byId(id);
          if (!m) return;
          const ch = engine.cheapest(m);
          const cost = m.unit === 'unit' ? m.unitPrice * qty * 30 : m.unitPrice * m.units * qty;
          const costB = m.unit === 'unit' ? ch.unitPrice * qty * 30 : ch.unitPrice * m.units * qty;
          now += cost;
          best += Math.min(cost, costB);
        });
        out.text.push(fill(s.cabinet_sum, { n: list.length, now: rs(now), best: rs(best), save: rs(Math.max(0, now - best)) }));
        out.actions.push({ label: s.a_cabinet, action: 'route', value: '/my-medicines' });
        return out;
      }

      // Compare two medicines
      if (mentions.length >= 2 || (RX.compare.test(text) && mentions.length)) {
        if (mentions.length < 2) {
          out.text.push(s.compare_need_two);
          return out;
        }
        const a = mentions[0].best;
        const b = mentions[1].best;
        out.text.push(fill(s.compare_head, { a: title(a), b: title(b) }));
        if (a.saltKey && a.saltKey === b.saltKey) {
          // compare like-for-like on the same strength where possible
          const bSame = a.group ? (engine.alternatives(a).find((x) => x.name === b.name) || b) : b;
          const cheaper = a.unitPrice <= bSame.unitPrice ? a : bSame;
          const dearer = cheaper === a ? bSame : a;
          const pct = dearer.unitPrice > 0 ? Math.round(((dearer.unitPrice - cheaper.unitPrice) / dearer.unitPrice) * 100) : 0;
          out.text.push(pct > 0
            ? fill(s.compare_same, { generic: a.generic, cheaper: cheaper.name, pct, u: unitWord(a, lang) })
            : fill(s.compare_samep, { u: unitWord(a, lang) }));
          out.cards.push({ id: cheaper.id, kind: 'cheap' }, { id: dearer.id, kind: 'alt' });
          const overall = engine.cheapest(a);
          if (overall && overall.id !== cheaper.id && overall.unitPrice < cheaper.unitPrice) {
            out.cards.push({ id: overall.id, kind: 'cheap' });
          }
        } else {
          out.text.push(fill(s.compare_diff, { a: a.name, b: b.name, ga: a.generic, gb: b.generic }));
          out.cards.push({ id: a.id, kind: 'current' }, { id: b.id, kind: 'current' });
        }
        out.context.lastMedId = a.id;
        return out;
      }

      // Follow-ups without a medicine name ("aur sasta?", "price?")
      const target = med || ((RX.alternative.test(text) || RX.price.test(text) || RX.formula.test(text) || RX.more.test(text)) ? lastMed : null);

      if (!target) {
        // symptom → category browse (no recommendation)
        const sym = SYMPTOMS.find(([, re]) => re.test(text));
        if (sym) {
          out.text.push(s.symptom);
          out.text.push(fill(s.symptom_cat, { cat: catLabel(sym[0], lang) }));
          out.actions.push({ label: fill(s.a_cat, { cat: catLabel(sym[0], lang) }), action: 'route', value: '/category/' + sym[0] });
          return out;
        }
        if (RX.alternative.test(text) || RX.price.test(text) || RX.formula.test(text)) {
          out.text.push(s.need_med);
          return out;
        }
        out.text.push(s.not_found);
        const dym = engine.didYouMean(text.split(/\s+/).sort((x, y) => y.length - x.length)[0] || text, 4);
        if (dym.length) {
          out.text.push(fill(s.did_you_mean, { list: dym.map((d) => '**' + d + '**').join(', ') }));
          out.actions.push(...dym.slice(0, 3).map((d) => ({ label: d, action: 'ask', value: d })));
        }
        return out;
      }

      out.context.lastMedId = target.id;
      const wantsAlt = RX.alternative.test(text) || RX.more.test(text);
      const wantsPrice = RX.price.test(text);
      const wantsFormula = RX.formula.test(text);

      if (wantsFormula && !wantsAlt && !wantsPrice) {
        out.text.push(fill(s.formula, { name: title(target), generic: target.generic, strength: target.strength ? ' ' + target.strength : '' }));
        const g = engine.alternatives(target).length;
        if (g > 1) out.actions.push({ label: s.a_alts, action: 'ask', value: (lang === 'ur' ? target.name + ' ka sasta option' : 'cheaper ' + target.name) });
        out.cards.push({ id: target.id, kind: 'current' });
        out.actions.push(...medActions(target, lang));
        return out;
      }

      if (wantsPrice && !wantsAlt) {
        out.text.push(priceText(target, lang));
        const sv = engine.savings(target);
        if (sv && sv.percent >= 5) {
          out.text.push(fill(s.alt_found, {
            n: engine.alternatives(target).length, generic: target.generic, strength: target.strength, form: target.form,
            cheap: sv.cheapest.name, cprice: rs(sv.cheapest.unitPrice), u: unitWord(target, lang),
            save: fill(s.alt_save, { pct: sv.percent, name: target.name }),
          }));
          out.cards.push({ id: target.id, kind: 'current' }, { id: sv.cheapest.id, kind: 'cheap' });
        } else {
          out.cards.push({ id: target.id, kind: 'current' });
        }
        out.actions.push(...medActions(target, lang));
        return out;
      }

      // Default for a medicine: formula + price + alternatives (the most useful answer)
      if (!wantsAlt) {
        out.text.push(fill(s.formula, { name: title(target), generic: target.generic, strength: target.strength ? ' ' + target.strength : '' }));
        out.text.push(priceText(target, lang));
      }
      alternativesBlock(target, lang, out);
      out.actions.push(...medActions(target, lang));
      if (mentions[0] && mentions[0].fuzzy) out.fuzzy = mentions[0].term;
      return out;
    }

    return { reply, chips: (lang) => L(lang).chips, strings: (lang) => L(lang) };
  }

  // ---------------------------------------------------------------------
  // Tiny, safe markdown renderer (bold, italics, lists, paragraphs)
  // ---------------------------------------------------------------------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function inline(s) {
    return esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((#\/[^)\s]+|https:\/\/[^)\s]+)\)/g, (m, label, href) => `<a href="${href}"${href.startsWith('http') ? ' target="_blank" rel="noopener"' : ''}>${label}</a>`);
  }

  function renderMarkdown(md) {
    const lines = String(md || '').split(/\r?\n/);
    let html = '';
    let list = null;
    const flush = () => {
      if (list) { html += `</${list}>`; list = null; }
    };
    for (const raw of lines) {
      const line = raw.trimEnd();
      const ul = line.match(/^\s*[-•*]\s+(.*)$/);
      const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (ul || ol) {
        const type = ul ? 'ul' : 'ol';
        if (list !== type) { flush(); html += `<${type}>`; list = type; }
        html += `<li>${inline((ul || ol)[1])}</li>`;
      } else if (!line.trim()) {
        flush();
      } else {
        flush();
        const h = line.match(/^#{1,4}\s+(.*)$/);
        html += `<p>${h ? '<strong>' + inline(h[1]) + '</strong>' : inline(line)}</p>`;
      }
    }
    flush();
    return html;
  }

  // ---------------------------------------------------------------------
  // Browser UI
  // ---------------------------------------------------------------------
  function createUI() {
    if (typeof document === 'undefined') return null;
    const $ = (s) => document.querySelector(s);
    const ui = {
      engine: null,
      brain: null,
      app: null,
      ai: false,
      history: [], // [{role, content}] for AI mode
      context: {},
      busy: false,
    };

    function lang() {
      return window.SDI18n ? window.SDI18n.getLang() : 'en';
    }

    function persist() {
      try {
        sessionStorage.setItem('sd_chat', JSON.stringify({ log: $('#assistant-log').innerHTML, history: ui.history.slice(-20), context: ui.context }));
      } catch (e) { /* ignore */ }
    }

    function restore() {
      try {
        const saved = JSON.parse(sessionStorage.getItem('sd_chat') || 'null');
        if (saved && saved.log) {
          $('#assistant-log').innerHTML = saved.log;
          ui.history = saved.history || [];
          ui.context = saved.context || {};
          return true;
        }
      } catch (e) { /* ignore */ }
      return false;
    }

    function scrollDown() {
      const log = $('#assistant-log');
      log.scrollTop = log.scrollHeight;
    }

    function addUser(text) {
      const el = document.createElement('div');
      el.className = 'msg user';
      el.innerHTML = `<div class="bubble">${esc(text)}</div>`;
      $('#assistant-log').appendChild(el);
      scrollDown();
    }

    function medCard(card) {
      const m = ui.engine.byId(card.id);
      if (!m) return '';
      const app = ui.app;
      const u = app.unitWord(m);
      return `<a class="mcard${card.kind === 'cheap' ? ' cheap' : ''}" href="#/medicine/${encodeURIComponent(m.id)}" data-close="1">
        <div><b>${esc(app.medTitle(m))}</b></div>
        <div class="mc-meta">${esc(m.generic)} · ${esc(m.form)} · ${esc(m.pack)}</div>
        <div class="mc-price num">${m.unit === 'pack' ? app.rs(m.price) : app.rs(m.unitPrice)}<small>${m.unit === 'pack' ? esc(u) : '/' + esc(u)}</small></div></a>`;
    }

    function addBot(res) {
      const el = document.createElement('div');
      el.className = 'msg bot';
      let html = `<div class="bubble${res.urgent ? ' warn' : ''}">${res.text.map(renderMarkdown).join('')}</div>`;
      const seen = new Set();
      const cards = (res.cards || []).filter((c) => (seen.has(c.id) ? false : seen.add(c.id))).slice(0, 6);
      if (cards.length) html += `<div class="mcards">${cards.map(medCard).join('')}</div>`;
      if (res.actions && res.actions.length) {
        html += `<div class="msg-actions">${res.actions
          .slice(0, 4)
          .map((a) => `<button type="button" class="chip" data-action="${esc(a.action)}" data-value="${esc(a.value)}">${esc(a.label)}</button>`)
          .join('')}</div>`;
      }
      el.innerHTML = html;
      $('#assistant-log').appendChild(el);
      scrollDown();
      persist();
    }

    function typing(on) {
      let el = document.getElementById('as-typing');
      if (on && !el) {
        el = document.createElement('div');
        el.id = 'as-typing';
        el.className = 'msg bot';
        el.innerHTML = '<div class="bubble typing" aria-label="Typing"><i></i><i></i><i></i></div>';
        $('#assistant-log').appendChild(el);
        scrollDown();
      } else if (!on && el) {
        el.remove();
      }
    }

    function updateChips() {
      const box = $('#assistant-suggest');
      const chips = ui.brain.chips(lang());
      box.innerHTML = chips.map((c) => `<button type="button" class="chip" data-action="ask" data-value="${esc(c)}">${esc(c)}</button>`).join('');
    }

    function setMode() {
      const t = window.SDI18n.t;
      $('#assistant-mode').textContent = ui.ai ? t('mode_ai') : t('mode_offline');
    }

    async function askAI(text) {
      const res = await fetch('api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: ui.history.slice(-12), lang: lang(), context: ui.context }),
      });
      if (!res.ok) throw new Error('chat ' + res.status);
      const data = await res.json();
      if (!data || typeof data.reply !== 'string') throw new Error('bad reply');
      return data;
    }

    async function send(text) {
      const msg = String(text || '').trim();
      if (!msg || ui.busy) return;
      addUser(msg);
      $('#assistant-suggest').hidden = true;
      const local = ui.brain.reply(msg, { lang: lang(), lastMedId: ui.context.lastMedId });

      // Emergencies are answered instantly, locally, every time.
      if (local.urgent || !ui.ai) {
        ui.context = local.context;
        addBot(local);
        ui.history.push({ role: 'user', content: msg }, { role: 'assistant', content: local.text.join('\n') });
        return;
      }

      ui.busy = true;
      typing(true);
      ui.history.push({ role: 'user', content: msg });
      try {
        const data = await askAI(msg);
        typing(false);
        ui.history.push({ role: 'assistant', content: data.reply });
        const cards = (data.medicine_ids || []).filter((id) => ui.engine.byId(id)).map((id, i) => ({ id, kind: i === 0 && data.cheapest_first ? 'cheap' : 'alt' }));
        const first = cards[0] ? ui.engine.byId(cards[0].id) : null;
        if (first) ui.context.lastMedId = first.id;
        const actions = first ? [{ label: window.SDI18n.t('view_details'), action: 'open', value: first.id }, { label: window.SDI18n.t('add_cabinet'), action: 'add', value: first.id }] : [];
        addBot({ text: [data.reply], cards, actions });
      } catch (e) {
        typing(false);
        ui.history.pop();
        ui.context = local.context;
        addBot(local);
        ui.history.push({ role: 'user', content: msg }, { role: 'assistant', content: local.text.join('\n') });
      } finally {
        ui.busy = false;
      }
    }

    function open(prefill) {
      const panel = $('#assistant');
      panel.hidden = false;
      document.body.classList.add('as-open');
      $('#assistant-fab').setAttribute('aria-expanded', 'true');
      if (!$('#assistant-log').children.length) {
        addBot({ text: [ui.brain ? ui.brain.strings(lang()).hello : '…'], cards: [], actions: [] });
        $('#assistant-suggest').hidden = false;
      }
      if (prefill) send(prefill);
      setTimeout(() => $('#assistant-text').focus({ preventScroll: true }), 50);
    }

    function close() {
      $('#assistant').hidden = true;
      document.body.classList.remove('as-open');
      $('#assistant-fab').setAttribute('aria-expanded', 'false');
    }

    function reset() {
      $('#assistant-log').innerHTML = '';
      ui.history = [];
      ui.context = {};
      try { sessionStorage.removeItem('sd_chat'); } catch (e) { /* ignore */ }
      $('#assistant-suggest').hidden = false;
      addBot({ text: [ui.brain.strings(lang()).hello], cards: [], actions: [] });
    }

    function handleAction(btn) {
      const { action, value } = btn.dataset;
      if (action === 'ask') send(value);
      else if (action === 'open') { ui.app.go('/medicine/' + encodeURIComponent(value)); if (window.innerWidth < 720) close(); }
      else if (action === 'route') { ui.app.go(value); if (window.innerWidth < 720) close(); }
      else if (action === 'add') {
        const ok = ui.app.cabinet.add(value);
        ui.app.toast(window.SDI18n.t(ok ? 'added' : 'in_cabinet'));
        if (ui.app.state.route.name === 'cabinet' || ui.app.state.route.name === 'medicine') ui.app.render();
      } else if (action === 'link') window.open(value, '_blank', 'noopener');
      else if (action === 'tel') location.href = 'tel:' + value;
    }

    function bind() {
      $('#assistant-fab').addEventListener('click', () => open());
      ['#nav-assistant', '#nav-assistant-m'].forEach((s) => $(s) && $(s).addEventListener('click', () => open()));
      $('#assistant-close').addEventListener('click', close);
      $('#assistant-reset').addEventListener('click', reset);
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !$('#assistant').hidden) close();
      });
      const ta = $('#assistant-text');
      const grow = () => {
        ta.style.height = 'auto';
        ta.style.height = Math.min(140, ta.scrollHeight) + 'px';
      };
      ta.addEventListener('input', grow);
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
          e.preventDefault();
          $('#assistant-form').requestSubmit();
        }
      });
      $('#assistant-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const v = ta.value;
        ta.value = '';
        grow();
        send(v);
      });
      ['#assistant-log', '#assistant-suggest'].forEach((sel) =>
        $(sel).addEventListener('click', (e) => {
          const btn = e.target.closest('[data-action]');
          if (btn) return handleAction(btn);
          const card = e.target.closest('[data-close]');
          if (card && window.innerWidth < 720) close();
        })
      );

      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SR) {
        const mic = $('#assistant-mic');
        mic.hidden = false;
        mic.addEventListener('click', () => {
          const rec = new SR();
          rec.lang = lang() === 'ur' ? 'ur-PK' : 'en-PK';
          rec.interimResults = false;
          mic.classList.add('listening');
          ta.placeholder = window.SDI18n.t('listening');
          rec.onresult = (ev) => send(ev.results[0][0].transcript);
          rec.onend = () => {
            mic.classList.remove('listening');
            ta.placeholder = window.SDI18n.t('as_placeholder');
          };
          rec.onerror = rec.onend;
          rec.start();
        });
      }
    }

    async function detectAI() {
      if (!location.protocol.startsWith('http')) return false;
      try {
        const res = await fetch('api/health', { cache: 'no-store' });
        if (!res.ok) return false;
        const j = await res.json();
        return !!(j && j.ai);
      } catch (e) {
        return false;
      }
    }

    return {
      init(deps) {
        ui.engine = deps.engine;
        ui.app = deps.app;
        ui.brain = createBrain(deps.engine, {
          categories: deps.ds.categories,
          getCabinet: () => deps.app.cabinet.list(),
          addToCabinet: (id) => {
            const ok = deps.app.cabinet.add(id);
            if (deps.app.state.route.name === 'cabinet') deps.app.render();
            return ok;
          },
        });
        bind();
        restore();
        updateChips();
        setMode();
        detectAI().then((ok) => {
          ui.ai = ok;
          setMode();
        });
      },
      open: (prefill) => open(prefill),
      close,
      refresh() {
        if (!ui.brain) return;
        updateChips();
        setMode();
      },
      send,
    };
  }

  const UI = typeof window !== 'undefined' ? createUI() : null;
  if (typeof window !== 'undefined') window.SDAssistantUI = UI;

  return { createBrain, renderMarkdown, RX };
});
