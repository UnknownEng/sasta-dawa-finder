/**
 * Sasta Dawa Finder - Search, Synonym Matching & Alternative Engine
 * Handles brand search, generic search, bidirectional synonym resolution,
 * combination drugs, category filtering, autocomplete, and generic alternative resolution.
 */

(function (root, factory) {
  const lib = factory();
  if (typeof window !== 'undefined') {
    window.SastaSearch = lib;
  }
  if (typeof module === 'object' && module.exports) {
    module.exports = lib;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  let dataset = [];
  let saltIndex = new Map();
  let idIndex = new Map();

  // Bidirectional Synonym Map for Regional vs International Chemical Nomenclature
  const SALT_SYNONYMS = {
    metamizole: ['novaminsulfon', 'dipyrone', 'analgin', 'sulpyrine', 'novalgin'],
    novaminsulfon: ['metamizole', 'dipyrone', 'analgin', 'sulpyrine', 'novalgin'],
    dipyrone: ['metamizole', 'novaminsulfon', 'analgin'],
    analgin: ['metamizole', 'novaminsulfon', 'dipyrone'],

    paracetamol: ['acetaminophen', 'apap'],
    acetaminophen: ['paracetamol', 'apap'],
    apap: ['paracetamol', 'acetaminophen'],

    albuterol: ['salbutamol'],
    salbutamol: ['albuterol'],

    scopolamine: ['hyoscine', 'hyoscine butylbromide'],
    hyoscine: ['scopolamine', 'hyoscine butylbromide'],

    aspirin: ['acetylsalicylic acid', 'asa'],
    acetylsalicylic: ['aspirin', 'asa'],
    asa: ['aspirin', 'acetylsalicylic acid'],

    clonazepam: ['rivotril', 'klonopin', 'clonazepamum'],
    rivotril: ['clonazepam'],

    mebeverine: ['colofac'],
    colofac: ['mebeverine'],

    coamoxiclav: ['amoxicillin clavulanate', 'amoxicillin clavulanic acid', 'augmentin'],
    amoxicillin: ['amoxil', 'amoxi'],

    pantoprazole: ['pantoprazole sodium'],
    omeprazole: ['omeprazole magnesium', 'losec', 'risek'],
    esomeprazole: ['esomeprazole magnesium', 'nexium', 'nexum'],
    hydrocortisone: ['cortril', 'hytone', 'dermacort'],
    betamethasone: ['betnovate', 'betaval', 'cortival'],
    fusidic: ['fusidic acid', 'fucidin', 'fuson', 'fucid'],
    clotrimazole: ['canesten', 'cloderm', 'candid'],
    miconazole: ['daktarin', 'mycospor'],
  };

  // Standard category definitions mapping fine-grained categories to broad priorities
  const CATEGORY_MAP = {
    pain: {
      id: 'pain',
      name_en: 'Pain & Fever',
      name_ur: 'درد اور بخار',
      icon: '🩹',
      matchKeys: ['pain', 'fever', 'nsaid', 'spasm', 'muscle'],
    },
    stomach: {
      id: 'stomach',
      name_en: 'Stomach & Acidity (PPI)',
      name_ur: 'معدہ اور تیزابیت',
      icon: '🫄',
      matchKeys: ['stomach', 'acid', 'ppi', 'reflux', 'amoebiasis', 'nausea', 'digestive'],
    },
    antibiotics: {
      id: 'antibiotics',
      name_en: 'Antibiotics',
      name_ur: 'اینٹی بائیوٹکس',
      icon: '🦠',
      matchKeys: ['antibiotic', 'antibacterial', 'cephalosporin'],
    },
    cardiac: {
      id: 'cardiac',
      name_en: 'Blood Pressure & Heart',
      name_ur: 'بلڈ پریشر اور دل',
      icon: '❤️',
      matchKeys: ['blood pressure', 'blood thinner', 'cholesterol', 'heart'],
    },
    diabetes: {
      id: 'diabetes',
      name_en: 'Diabetes / Sugar',
      name_ur: 'ذیابیطس / شوگر',
      icon: '🩸',
      matchKeys: ['diabetes'],
    },
    allergy: {
      id: 'allergy',
      name_en: 'Allergy & Cold',
      name_ur: 'الرجی اور نزلہ زکام',
      icon: '🤧',
      matchKeys: ['allergy', 'antihistamine', 'cold', 'asthma', 'copd', 'congestion'],
    },
    neuro: {
      id: 'neuro',
      name_en: 'Brain & Mental Health',
      name_ur: 'دماغ اور اعصاب',
      icon: '🧠',
      matchKeys: ['neurology', 'mental health', 'psychiatry'],
    },
    skin: {
      id: 'skin',
      name_en: 'Skin & Ointments',
      name_ur: 'جلد اور مرہم',
      icon: '🧴',
      matchKeys: ['skin', 'dermatology', 'cream', 'ointment', 'topical', 'gel', 'fungal', 'antifungal'],
    },
    pediatric: {
      id: 'pediatric',
      name_en: 'Kids & Syrups',
      name_ur: 'بچوں کے شربت',
      icon: '🍼',
      matchKeys: ['pediatric', 'syrup', 'suspension', 'kids', 'drops'],
    },
  };

  /**
   * Normalizes search strings: trims, lowercases, collapses whitespace,
   * strips punctuation except alphanumeric and dashes.
   */
  function normalize(str) {
    if (typeof str !== 'string') return '';
    return str
      .toLowerCase()
      .replace(/[^\w\s-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Expands query tokens to include chemical synonyms and alternate names.
   */
  function expandTokensWithSynonyms(tokens) {
    const expanded = new Set(tokens);
    tokens.forEach((t) => {
      const syns = SALT_SYNONYMS[t];
      if (syns) {
        syns.forEach((s) => {
          normalize(s)
            .split(' ')
            .forEach((st) => expanded.add(st));
        });
      }
    });
    return Array.from(expanded);
  }

  /**
   * Checks if a medicine belongs to a category group ID.
   */
  function matchesCategory(med, catId) {
    if (!catId || catId === 'all') return true;
    const catDef = CATEGORY_MAP[catId];
    if (!catDef) return false;

    const medCat = normalize(med.category);
    return catDef.matchKeys.some((k) => medCat.includes(k));
  }

  /**
   * Initializes the search engine with medicines data.
   */
  function init(medicines) {
    if (!Array.isArray(medicines)) {
      throw new Error('init requires an array of medicines');
    }
    dataset = medicines;
    saltIndex.clear();
    idIndex.clear();

    for (let i = 0; i < dataset.length; i++) {
      const med = dataset[i];
      idIndex.set(med.id, med);

      const salt = med.salt_group_id;
      if (!saltIndex.has(salt)) {
        saltIndex.set(salt, []);
      }
      saltIndex.get(salt).push(med);
    }
  }

  /**
   * Searches medicines by brand name, generic name, synonyms, category, or manufacturer.
   * Supports bidirectional synonym matching (e.g. Metamizole ↔ Novaminsulfon).
   *
   * @param {string} query - user input
   * @param {object} options - { limit: number, category: string }
   * @returns {Array} ranked matches
   */
  function search(query, options = {}) {
    const limit = options.limit || 25;
    const category = options.category || 'all';
    let cleanQuery = normalize(query);

    if (!cleanQuery || cleanQuery.length === 0) {
      return [];
    }

    // Clamp excessive query lengths to prevent ReDoS / CPU freezing
    if (cleanQuery.length > 150) {
      cleanQuery = cleanQuery.slice(0, 150).trim();
    }

    const queryTokens = cleanQuery.split(' ').filter(Boolean);
    const expandedTokens = expandTokensWithSynonyms(queryTokens);
    const results = [];

    for (let i = 0; i < dataset.length; i++) {
      const med = dataset[i];

      // If category filter applied, filter out non-matching medicines
      if (category !== 'all' && !matchesCategory(med, category)) {
        continue;
      }

      const brandNorm = normalize(med.brand_name);
      const genericNorm = normalize(med.generic_name);
      const categoryNorm = normalize(med.category);
      const strengthNorm = normalize(med.strength);
      const synonymsNorm = Array.isArray(med.synonyms)
        ? med.synonyms.map(normalize).join(' ')
        : '';
      const combined = `${brandNorm} ${genericNorm} ${categoryNorm} ${strengthNorm} ${synonymsNorm}`;

      let score = 0;

      // Exact brand match
      if (brandNorm === cleanQuery) {
        score += 1000;
      }
      // Brand starts with query
      else if (brandNorm.startsWith(cleanQuery)) {
        score += 800;
      }
      // Exact generic match
      else if (genericNorm === cleanQuery) {
        score += 600;
      }
      // Brand contains query
      else if (brandNorm.includes(cleanQuery)) {
        score += 500;
      }
      // Generic starts with query
      else if (genericNorm.startsWith(cleanQuery)) {
        score += 400;
      }
      // Generic contains query
      else if (genericNorm.includes(cleanQuery)) {
        score += 200;
      }
      // Synonyms contain query directly
      else if (synonymsNorm.includes(cleanQuery)) {
        score += 100;
      }

      // Check if any synonym matches exactly
      if (Array.isArray(med.synonyms)) {
        for (let s = 0; s < med.synonyms.length; s++) {
          const sNorm = normalize(med.synonyms[s]);
          if (sNorm === cleanQuery) {
            score += 250;
            break;
          }
        }
      }

      // Check tokens (either original query tokens or expanded synonym tokens)
      let allTokensMatch = true;
      for (let j = 0; j < queryTokens.length; j++) {
        const token = queryTokens[j];
        const tokenSynonyms = SALT_SYNONYMS[token] ? [token, ...SALT_SYNONYMS[token]] : [token];

        // Token must match in combined string directly or through one of its synonyms
        const matched = tokenSynonyms.some((syn) => combined.includes(normalize(syn)));

        if (matched) {
          score += 40;
        } else {
          allTokensMatch = false;
          break;
        }
      }

      if (allTokensMatch && score > 0) {
        if (med.popular) {
          score += 15;
        }
        // Boost verified high confidence entries slightly
        if (med.confidence === 'high') {
          score += 5;
        }
        results.push({ medicine: med, score });
      }
    }

    // Sort by relevance score descending, then alphabetical brand
    results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.medicine.brand_name.localeCompare(b.medicine.brand_name);
    });

    return results.slice(0, limit).map((r) => r.medicine);
  }

  /**
   * Retrieves a single medicine by its unique ID.
   */
  function getById(id) {
    if (!id || typeof id !== 'string') return null;
    return idIndex.get(id) || null;
  }

  /**
   * Finds all generic alternatives for a specific medicine.
   * Matches by identical salt_group_id and excludes the target medicine itself.
   */
  function getAlternatives(target, options = {}) {
    const sortBy = options.sortBy || 'price_asc';
    let baseMed = null;

    if (typeof target === 'string') {
      baseMed = getById(target);
    } else if (target && typeof target === 'object' && target.id) {
      baseMed = target;
    }

    if (!baseMed) {
      return {
        medicine: null,
        alternatives: [],
        cheapestAlternative: null,
        totalCount: 0,
      };
    }

    const allInSaltGroup = saltIndex.get(baseMed.salt_group_id) || [];
    // Filter out the selected medicine
    let alternatives = allInSaltGroup.filter((m) => m.id !== baseMed.id);

    // Attach calculated price difference and savings metrics relative to base medicine
    const enrichedAlternatives = alternatives.map((alt) => {
      const unitDiff = baseMed.unit_price_pkr - alt.unit_price_pkr;
      const isCheaper = unitDiff > 0.001;
      const isMoreExpensive = unitDiff < -0.001;
      const percentSavings = isCheaper
        ? Math.round((unitDiff / baseMed.unit_price_pkr) * 100)
        : 0;

      return {
        ...alt,
        unit_difference_pkr: Number(unitDiff.toFixed(2)),
        percent_savings: percentSavings,
        is_cheaper: isCheaper,
        is_more_expensive: isMoreExpensive,
        is_same_price: !isCheaper && !isMoreExpensive,
      };
    });

    // Apply sorting
    const sorted = sortAlternatives(enrichedAlternatives, sortBy);

    const cheaperList = sorted.filter((a) => a.is_cheaper);
    const cheapestAlternative = cheaperList.length > 0 ? cheaperList[0] : null;

    return {
      medicine: baseMed,
      alternatives: sorted,
      cheapestAlternative,
      totalCount: sorted.length,
      cheaperCount: cheaperList.length,
    };
  }

  /**
   * Sorts alternatives based on criteria.
   */
  function sortAlternatives(list, criteria = 'price_asc') {
    const copy = [...list];
    switch (criteria) {
      case 'price_asc':
        return copy.sort((a, b) => a.unit_price_pkr - b.unit_price_pkr);
      case 'price_desc':
        return copy.sort((a, b) => b.unit_price_pkr - a.unit_price_pkr);
      case 'savings_desc':
        return copy.sort((a, b) => (b.percent_savings || 0) - (a.percent_savings || 0));
      case 'name_asc':
        return copy.sort((a, b) => a.brand_name.localeCompare(b.brand_name));
      default:
        return copy.sort((a, b) => a.unit_price_pkr - b.unit_price_pkr);
    }
  }

  /**
   * Returns category definitions with counts of available medicines.
   */
  function getCategories() {
    const categories = [
      { id: 'all', name_en: 'All Medicines', name_ur: 'تمام ادویات', icon: '💊', count: dataset.length },
    ];

    Object.values(CATEGORY_MAP).forEach((cat) => {
      const count = dataset.filter((m) => matchesCategory(m, cat.id)).length;
      categories.push({
        id: cat.id,
        name_en: cat.name_en,
        name_ur: cat.name_ur,
        icon: cat.icon,
        count,
      });
    });

    return categories;
  }

  /**
   * Returns list of popular starter medicines for initial display, optionally filtered by category.
   */
  function getPopularMedicines(limit = 8, categoryId = 'all') {
    let filtered = dataset;
    if (categoryId !== 'all') {
      filtered = dataset.filter((m) => matchesCategory(m, categoryId));
    }
    const popularOnly = filtered.filter((m) => m.popular);
    return (popularOnly.length > 0 ? popularOnly : filtered).slice(0, limit);
  }

  return {
    init,
    normalize,
    search,
    getById,
    getAlternatives,
    sortAlternatives,
    getCategories,
    matchesCategory,
    getPopularMedicines,
    CATEGORY_MAP,
    SALT_SYNONYMS,
    _getSaltIndex: () => saltIndex,
  };
});
