/**
 * Sasta Dawa Finder - Dataset Loader
 * Loads medicines from embedded dataset (fast & offline-ready) or fetches from data/medicines.json.
 */

(function (root, factory) {
  const lib = factory();
  if (typeof window !== 'undefined') {
    window.MedicineDataLoader = lib;
  }
  if (typeof module === 'object' && module.exports) {
    module.exports = lib;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  async function loadMedicines() {
    // 1. Check embedded data bundle first (works offline, file://, and instant load)
    const embedded =
      (typeof window !== 'undefined' && (window.__EMBEDDED_MEDICINES__ || window.__EMBEDDED_MEDICINES_DATA__)) ||
      (typeof globalThis !== 'undefined' && (globalThis.__EMBEDDED_MEDICINES__ || globalThis.__EMBEDDED_MEDICINES_DATA__));

    if (Array.isArray(embedded) && embedded.length > 0) {
      return embedded;
    }

    // 2. Fetch from relative path if served via HTTP server
    if (typeof fetch === 'function') {
      try {
        const response = await fetch('data/medicines.json');
        if (response.ok) {
          const data = await response.json();
          if (Array.isArray(data) && data.length > 0) {
            return data;
          }
        }
      } catch (e) {
        console.warn('Fetch failed:', e);
      }
    }

    throw new Error('Unable to load medicines dataset.');
  }

  return {
    loadMedicines,
  };
});
