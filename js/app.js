/**
 * Sasta Dawa Finder - Application Controller with Plain Language & Aeromaverick Branding
 * Handles UI interactions, search autocomplete, category filtering, translation, rendering, and URL states.
 */

(function () {
  'use strict';

  // DOM Elements
  const searchInput = document.getElementById('search-input');
  const clearBtn = document.getElementById('clear-btn');
  const searchBtn = document.getElementById('search-btn');
  const autocompleteList = document.getElementById('autocomplete-list');
  const resultsView = document.getElementById('results-view');
  const selectedMedicineCard = document.getElementById('selected-medicine-card');
  const savingsSpotlight = document.getElementById('savings-spotlight');
  const alternativesToolbar = document.getElementById('alternatives-toolbar');
  const alternativesCount = document.getElementById('alternatives-count');
  const alternativesList = document.getElementById('alternatives-list');
  const zeroAlternativesCard = document.getElementById('zero-alternatives-card');
  const zeroAlternativesDesc = document.getElementById('zero-alternatives-desc');
  const zeroBackBtn = document.getElementById('zero-back-btn');
  const noResultsView = document.getElementById('no-results-view');
  const noResultsQueryMsg = document.getElementById('no-results-query-msg');
  const noResultsResetBtn = document.getElementById('no-results-reset-btn');
  const exploreView = document.getElementById('explore-view');
  const popularGrid = document.getElementById('popular-medicines-grid');
  const sortSelect = document.getElementById('sort-select');
  const categoryPillsContainer = document.getElementById('category-pills-container');
  const langEnBtn = document.getElementById('lang-en-btn');
  const langUrBtn = document.getElementById('lang-ur-btn');
  const copyrightYearEl = document.getElementById('copyright-year');
  const nearbyStoresSection = document.getElementById('nearby-stores-section');
  const storeLocationBar = document.getElementById('store-location-bar');
  const storesGrid = document.getElementById('stores-grid');
  const closeStoresBtn = document.getElementById('close-stores-btn');

  let currentMedicine = null;
  let currentCategory = 'all';
  let activeSuggestionIndex = -1;
  let currentSuggestions = [];
  let cachedUserCoords = null;
  let currentStoresQuery = 'Karachi';

  /**
   * Escape HTML utility to prevent XSS.
   */
  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Translation helper.
   */
  function t(key, params) {
    if (window.SastaI18n && typeof window.SastaI18n.t === 'function') {
      return window.SastaI18n.t(key, params);
    }
    return key;
  }

  /**
   * Format currency in PKR.
   */
  function formatPKR(val) {
    if (typeof val !== 'number' || isNaN(val)) return 'PKR 0.00';
    return `PKR ${val.toFixed(2)}`;
  }

  /**
   * Format unit display label (e.g. tablet, capsule, puff).
   */
  function formatUnitLabel(dosageForm) {
    const form = (dosageForm || '').toLowerCase();
    if (form.includes('tablet')) return t('unit_tablet');
    if (form.includes('capsule')) return t('unit_capsule');
    if (form.includes('inhaler')) return t('unit_puff');
    if (form.includes('syrup') || form.includes('suspension')) return t('unit_syrup');
    if (form.includes('cream') || form.includes('ointment') || form.includes('gel')) return t('unit_cream');
    if (form.includes('drop')) return t('unit_drop');
    if (form.includes('sachet')) return t('unit_sachet');
    if (form.includes('bottle')) return t('unit_bottle');
    return t('unit_generic');
  }

  /**
   * Initialize App.
   */
  async function init() {
    try {
      // Dynamic copyright year
      if (copyrightYearEl) {
        copyrightYearEl.textContent = new Date().getFullYear();
      }

      if (window.SastaI18n) {
        window.SastaI18n.initLanguage();
      }

      const data = await window.MedicineDataLoader.loadMedicines();
      window.SastaSearch.init(data);

      updateLanguageUI();
      renderCategoryPills();
      renderPopularMedicines();
      setupEventListeners();
      checkUrlState();
    } catch (err) {
      console.error('Initialization error:', err);
      if (noResultsQueryMsg) {
        noResultsQueryMsg.textContent = 'Failed to load medicine database. Please refresh the page.';
      }
      showNoResultsView();
    }
  }

  /**
   * Switch Language (en / ur).
   */
  function switchLanguage(lang) {
    if (!window.SastaI18n) return;
    window.SastaI18n.setLanguage(lang);
    updateLanguageUI();
    renderCategoryPills();

    if (currentMedicine) {
      renderSelectedMedicine(currentMedicine);
      renderAlternatives(currentMedicine, sortSelect.value);
    } else {
      renderPopularMedicines();
    }
  }

  /**
   * Updates all DOM text content and dir attribute to match active language.
   */
  function updateLanguageUI() {
    const lang = window.SastaI18n ? window.SastaI18n.getLanguage() : 'en';
    const isUr = lang === 'ur';

    // Set document direction and lang
    document.documentElement.setAttribute('dir', isUr ? 'rtl' : 'ltr');
    document.documentElement.setAttribute('lang', lang);

    // Update Language toggle buttons
    if (langEnBtn && langUrBtn) {
      if (isUr) {
        langUrBtn.classList.add('active');
        langEnBtn.classList.remove('active');
      } else {
        langEnBtn.classList.add('active');
        langUrBtn.classList.remove('active');
      }
    }

    // Update site title
    const siteTitleEl = document.getElementById('site-title-el');
    if (siteTitleEl) {
      if (isUr) {
        siteTitleEl.innerHTML = `اینٹی گریسیٹی <span class="site-title-divider">|</span> سستی دوا تلاش کار <span class="site-title-urdu">پاکستان</span>`;
      } else {
        siteTitleEl.innerHTML = `Antigracity <span class="site-title-divider">|</span> Sasta Dawa Finder <span class="site-title-urdu" dir="rtl">سستی دوا</span>`;
      }
    }

    // Update Search input placeholder
    if (searchInput) {
      searchInput.setAttribute('placeholder', t('search_placeholder'));
    }

    // Update all elements with data-i18n attribute
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (key) {
        el.textContent = t(key);
      }
    });
  }

  /**
   * Renders the category priority filter bar.
   */
  function renderCategoryPills() {
    if (!categoryPillsContainer || !window.SastaSearch) return;

    const categories = window.SastaSearch.getCategories();
    const lang = window.SastaI18n ? window.SastaI18n.getLanguage() : 'en';
    const isUr = lang === 'ur';

    categoryPillsContainer.innerHTML = categories
      .map((cat) => {
        const name = isUr ? cat.name_ur : cat.name_en;
        const isActive = cat.id === currentCategory;
        const activeClass = isActive ? 'cat-pill active' : 'cat-pill';
        return `
          <button type="button" class="${activeClass}" data-cat-id="${cat.id}">
            <span aria-hidden="true">${cat.icon}</span>
            <span>${name}</span>
            <span class="cat-count">${cat.count}</span>
          </button>
        `;
      })
      .join('');

    // Attach click listeners to category pills
    categoryPillsContainer.querySelectorAll('.cat-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        const catId = btn.getAttribute('data-cat-id');
        selectCategory(catId);
      });
    });
  }

  /**
   * Handles user selecting a category.
   */
  function selectCategory(catId) {
    currentCategory = catId;
    renderCategoryPills();

    // If currently on explore view, re-filter popular medicines
    if (exploreView && exploreView.style.display !== 'none') {
      renderPopularMedicines();
    } else if (searchInput.value.trim().length > 0) {
      performSearch(searchInput.value.trim(), true);
    } else {
      showExploreView();
      renderPopularMedicines();
    }
  }

  /**
   * Renders the explore/popular medicines grid on the homepage.
   */
  function renderPopularMedicines() {
    if (!popularGrid) return;
    const popular = window.SastaSearch.getPopularMedicines(8, currentCategory);

    if (popular.length === 0) {
      popularGrid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; color: var(--text-muted); padding: 1.5rem;">
          No common medicines listed in this category yet.
        </div>
      `;
      return;
    }

    popularGrid.innerHTML = popular
      .map((med) => {
        const unit = formatUnitLabel(med.dosage_form);
        return `
        <div class="popular-card" data-med-id="${escapeHtml(med.id)}" role="button" tabindex="0">
          <div class="pop-name">${escapeHtml(med.brand_name)}</div>
          <div class="pop-salt">${escapeHtml(med.generic_name)} ${escapeHtml(med.strength)}</div>
          <div class="pop-meta">
            <span>${escapeHtml(med.manufacturer)}</span>
            <span class="pop-price">${formatPKR(med.unit_price_pkr)} / ${unit}</span>
          </div>
        </div>
      `;
      })
      .join('');
  }

  /**
   * Accessible Toast Notification helper (Success and Error messages)
   */
  function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast-message toast-${type}`;
    const icon = type === 'success' ? '✓' : '⚠️';
    toast.innerHTML = `
      <span class="toast-icon" aria-hidden="true">${icon}</span>
      <div class="toast-content">${escapeHtml(message)}</div>
      <button type="button" class="toast-close-btn" aria-label="Dismiss notification">✕</button>
    `;
    const closeBtn = toast.querySelector('.toast-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => toast.remove());
    }
    container.appendChild(toast);
    setTimeout(() => {
      if (toast.parentNode) {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-10px)';
        setTimeout(() => toast.remove(), 250);
      }
    }, 4000);
  }

  function showSuccessMessage(msg) {
    showToast(msg, 'success');
  }

  function showErrorMessage(msg) {
    showToast(msg, 'error');
  }

  /**
   * Setup UI Event Listeners.
   */
  function setupEventListeners() {
    // Clickable Logo (Fix 17)
    const siteLogoLink = document.getElementById('site-logo-link');
    if (siteLogoLink) {
      siteLogoLink.addEventListener('click', (e) => {
        const isHomePage = window.location.pathname === '/' || window.location.pathname.endsWith('index.html');
        if (isHomePage) {
          e.preventDefault();
          searchInput.value = '';
          if (clearBtn) clearBtn.style.display = 'none';
          closeAutocomplete();
          showExploreView();
          window.location.hash = '';
          window.scrollTo({ top: 0, behavior: 'smooth' });
          showSuccessMessage('Returned to Medicine Finder Home.');
        }
      });
    }

    // Mobile Menu Toggle & Navigation Drawer (Fix 3 & Fix 15)
    const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
    const mobileNavDrawer = document.getElementById('mobile-nav-drawer');
    const mobileNavBackdrop = document.getElementById('mobile-nav-backdrop');
    const drawerCloseBtn = document.getElementById('drawer-close-btn');

    function openMobileMenu() {
      if (!mobileNavDrawer) return;
      mobileNavDrawer.removeAttribute('hidden');
      if (mobileNavBackdrop) mobileNavBackdrop.removeAttribute('hidden');
      requestAnimationFrame(() => {
        mobileNavDrawer.classList.add('active');
        if (mobileNavBackdrop) mobileNavBackdrop.classList.add('active');
      });
      if (mobileMenuToggle) {
        mobileMenuToggle.setAttribute('aria-expanded', 'true');
      }
    }

    function closeMobileMenu() {
      if (!mobileNavDrawer) return;
      mobileNavDrawer.classList.remove('active');
      if (mobileNavBackdrop) mobileNavBackdrop.classList.remove('active');
      if (mobileMenuToggle) {
        mobileMenuToggle.setAttribute('aria-expanded', 'false');
      }
      setTimeout(() => {
        mobileNavDrawer.setAttribute('hidden', '');
        if (mobileNavBackdrop) mobileNavBackdrop.setAttribute('hidden', '');
      }, 300);
    }

    if (mobileMenuToggle) {
      mobileMenuToggle.addEventListener('click', () => {
        const isOpen = mobileMenuToggle.getAttribute('aria-expanded') === 'true';
        if (isOpen) {
          closeMobileMenu();
        } else {
          openMobileMenu();
        }
      });
    }

    if (drawerCloseBtn) {
      drawerCloseBtn.addEventListener('click', closeMobileMenu);
    }

    if (mobileNavBackdrop) {
      mobileNavBackdrop.addEventListener('click', closeMobileMenu);
    }

    document.querySelectorAll('.mobile-nav-link').forEach((link) => {
      link.addEventListener('click', () => {
        closeMobileMenu();
      });
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && mobileMenuToggle && mobileMenuToggle.getAttribute('aria-expanded') === 'true') {
        closeMobileMenu();
      }
    });

    // Language Switch Buttons
    if (langEnBtn) {
      langEnBtn.addEventListener('click', () => switchLanguage('en'));
    }
    if (langUrBtn) {
      langUrBtn.addEventListener('click', () => switchLanguage('ur'));
    }

    // Search input typing
    searchInput.addEventListener('input', handleSearchInput);

    // Keyboard navigation in search input
    searchInput.addEventListener('keydown', handleSearchKeydown);

    // Search button
    searchBtn.addEventListener('click', () => {
      const query = searchInput.value.trim();
      if (query) {
        performSearch(query);
      }
    });

    // Clear button
    clearBtn.addEventListener('click', () => {
      searchInput.value = '';
      clearBtn.style.display = 'none';
      closeAutocomplete();
      searchInput.focus();
      showExploreView();
      window.location.hash = '';
    });

    // Close autocomplete on click outside
    document.addEventListener('click', (e) => {
      if (!searchInput.contains(e.target) && !autocompleteList.contains(e.target)) {
        closeAutocomplete();
      }
    });

    // Quick pills click
    document.querySelectorAll('.pill-btn[data-search]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const query = btn.getAttribute('data-search');
        searchInput.value = query;
        clearBtn.style.display = 'flex';
        performSearch(query);
      });
    });

    // Popular medicine card click
    popularGrid.addEventListener('click', (e) => {
      const card = e.target.closest('.popular-card');
      if (card) {
        const medId = card.getAttribute('data-med-id');
        selectMedicineById(medId);
      }
    });

    popularGrid.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        const card = e.target.closest('.popular-card');
        if (card) {
          e.preventDefault();
          const medId = card.getAttribute('data-med-id');
          selectMedicineById(medId);
        }
      }
    });

    // Sort select change
    sortSelect.addEventListener('change', () => {
      if (currentMedicine) {
        renderAlternatives(currentMedicine, sortSelect.value);
      }
    });

    // Zero alternatives back button
    zeroBackBtn.addEventListener('click', () => {
      searchInput.focus();
      searchInput.select();
    });

    // No results reset button
    noResultsResetBtn.addEventListener('click', () => {
      searchInput.value = '';
      clearBtn.style.display = 'none';
      showExploreView();
      window.location.hash = '';
    });

    // Browser navigation back/forward hash changes
    window.addEventListener('hashchange', checkUrlState);

    // Nearby Stores Section Toggles
    document.addEventListener('click', (e) => {
      const nearbyBtn = e.target.closest('#med-card-nearby-btn') || e.target.closest('#spotlight-nearby-btn') || e.target.closest('.nearby-stores-toggle-btn');
      if (nearbyBtn) {
        e.preventDefault();
        openNearbyStoresSection();
      }

      const closeBtn = e.target.closest('#close-stores-btn');
      if (closeBtn) {
        e.preventDefault();
        closeNearbyStoresSection();
      }
    });
  }

  /**
   * Checks URL hash and displays state (e.g. #med=id or #q=term)
   */
  function checkUrlState() {
    const hash = window.location.hash.slice(1);
    if (!hash) {
      if (!currentMedicine) showExploreView();
      return;
    }

    const params = new URLSearchParams(hash);
    if (params.has('med')) {
      const medId = params.get('med');
      selectMedicineById(medId, false);
    } else if (params.has('q')) {
      const q = params.get('q');
      searchInput.value = q;
      clearBtn.style.display = 'flex';
      performSearch(q, false);
    }
  }

  /**
   * Handles user typing in search input (autocomplete suggestions).
   */
  function handleSearchInput(e) {
    const query = e.target.value;
    activeSuggestionIndex = -1;

    if (query.trim().length > 0) {
      clearBtn.style.display = 'flex';
    } else {
      clearBtn.style.display = 'none';
      closeAutocomplete();
      return;
    }

    const matches = window.SastaSearch.search(query, {
      limit: 8,
      category: currentCategory,
    });
    currentSuggestions = matches;

    if (matches.length === 0) {
      autocompleteList.innerHTML = `
        <div class="suggestion-item" style="cursor: default;">
          <div class="suggestion-info">
            <span class="suggestion-name" style="color: var(--text-muted);">${escapeHtml(query)}</span>
            <span class="suggestion-meta">${t('no_results_title')}</span>
          </div>
        </div>
      `;
      openAutocomplete();
      return;
    }

    autocompleteList.innerHTML = matches
      .map((med, index) => {
        const unit = formatUnitLabel(med.dosage_form);
        return `
        <div class="suggestion-item" data-index="${index}" data-med-id="${escapeHtml(med.id)}" role="option">
          <div class="suggestion-info">
            <span class="suggestion-name">${escapeHtml(med.brand_name)} <span style="font-weight: 400; color: var(--text-muted); font-size: 0.9rem;">(${escapeHtml(med.strength)})</span></span>
            <span class="suggestion-meta">${escapeHtml(med.generic_name)} • ${escapeHtml(med.manufacturer)}</span>
          </div>
          <span class="suggestion-badge">${formatPKR(med.unit_price_pkr)} / ${unit}</span>
        </div>
      `;
      })
      .join('');

    // Attach click handlers to suggestions
    autocompleteList.querySelectorAll('.suggestion-item[data-med-id]').forEach((item) => {
      item.addEventListener('click', () => {
        const medId = item.getAttribute('data-med-id');
        selectMedicineById(medId);
        closeAutocomplete();
      });
    });

    openAutocomplete();
  }

  /**
   * Handles keyboard navigation in search input (ArrowUp, ArrowDown, Enter, Esc).
   */
  function handleSearchKeydown(e) {
    const items = autocompleteList.querySelectorAll('.suggestion-item[data-med-id]');

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isAutocompleteOpen()) {
        handleSearchInput({ target: searchInput });
        return;
      }
      activeSuggestionIndex = (activeSuggestionIndex + 1) % items.length;
      updateActiveSuggestion(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isAutocompleteOpen()) return;
      activeSuggestionIndex = (activeSuggestionIndex - 1 + items.length) % items.length;
      updateActiveSuggestion(items);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (isAutocompleteOpen() && activeSuggestionIndex >= 0 && items[activeSuggestionIndex]) {
        const medId = items[activeSuggestionIndex].getAttribute('data-med-id');
        selectMedicineById(medId);
        closeAutocomplete();
      } else {
        const query = searchInput.value.trim();
        if (query) {
          closeAutocomplete();
          performSearch(query);
        }
      }
    } else if (e.key === 'Escape') {
      closeAutocomplete();
    }
  }

  function updateActiveSuggestion(items) {
    items.forEach((item, idx) => {
      if (idx === activeSuggestionIndex) {
        item.classList.add('active');
        item.scrollIntoView({ block: 'nearest' });
      } else {
        item.classList.remove('active');
      }
    });
  }

  function openAutocomplete() {
    autocompleteList.classList.add('open');
    searchInput.setAttribute('aria-expanded', 'true');
  }

  function closeAutocomplete() {
    autocompleteList.classList.remove('open');
    searchInput.setAttribute('aria-expanded', 'false');
    activeSuggestionIndex = -1;
  }

  function isAutocompleteOpen() {
    return autocompleteList.classList.contains('open');
  }

  /**
   * Performs search for a given string query.
   */
  function performSearch(query, updateHash = true) {
    const results = window.SastaSearch.search(query, {
      category: currentCategory,
    });

    if (results.length === 0) {
      showNoResultsView(query);
      if (updateHash) {
        window.location.hash = `q=${encodeURIComponent(query)}`;
      }
      return;
    }

    const topResult = results[0];
    selectMedicineById(topResult.id, updateHash);
  }

  /**
   * Selects and renders a medicine by its unique ID.
   */
  function selectMedicineById(medId, updateHash = true) {
    const med = window.SastaSearch.getById(medId);
    if (!med) {
      showNoResultsView(medId);
      return;
    }

    currentMedicine = med;
    searchInput.value = med.brand_name;
    clearBtn.style.display = 'flex';
    closeAutocomplete();

    if (updateHash) {
      window.location.hash = `med=${encodeURIComponent(med.id)}`;
    }

    const breadcrumbCurrentLabel = document.getElementById('breadcrumb-current-label');
    if (breadcrumbCurrentLabel) {
      breadcrumbCurrentLabel.textContent = `${med.brand_name} (${med.strength || ''}) - Price & Alternatives`;
    }

    renderSelectedMedicine(med);
    renderAlternatives(med, sortSelect.value);
    showResultsView();
  }

  /**
   * Renders the details card of the searched medicine.
   * Uses simple, plain language with no technical "Formula ID" jargon.
   */
  function renderSelectedMedicine(med) {
    const unit = formatUnitLabel(med.dosage_form);
    let badgeHtml = '';

    if (med.confidence === 'unverified' || !med.verified) {
      badgeHtml = `<span class="badge-status unverified">${t('unverified_warning')}</span>`;
    } else if (med.price_is_estimate) {
      badgeHtml = `<span class="badge-status estimate">${t('approx_estimate')}</span>`;
    }

    selectedMedicineCard.innerHTML = `
      <div class="medicine-header">
        <div class="med-brand-block">
          <h2>${escapeHtml(med.brand_name)} ${badgeHtml}</h2>
          <div class="med-generic">
            <span class="med-generic-label">${t('results_formula')}</span>
            <strong>${escapeHtml(med.generic_name)} (${escapeHtml(med.strength)})</strong>
          </div>
        </div>
        <div class="med-price-block">
          <div class="unit-price-label">${t('results_est_price')}</div>
          <div class="unit-price-val">${formatPKR(med.unit_price_pkr)} <span class="unit-price-sub">/ ${unit}</span></div>
          <div class="pack-price-val">${formatPKR(med.pack_price_pkr)} ${t('results_pack_of')} ${med.pack_size} ${escapeHtml(med.pack_unit)}</div>
        </div>
      </div>

      <div class="medicine-grid">
        <div class="info-item">
          <span class="info-label">${t('results_dosage')}</span>
          <span class="info-value">${escapeHtml(med.dosage_form)}</span>
        </div>
        <div class="info-item">
          <span class="info-label">${t('results_manufacturer')}</span>
          <span class="info-value">${escapeHtml(med.manufacturer)}</span>
        </div>
        <div class="info-item">
          <span class="info-label">${t('results_category')}</span>
          <span class="info-value">${escapeHtml(med.category)}</span>
        </div>
      </div>

      <div class="med-actions-footer">
        <button type="button" class="nearby-stores-toggle-btn" id="med-card-nearby-btn" aria-label="${t('find_nearby_stores_btn')}">
          <span aria-hidden="true">📍</span> <span>${t('find_nearby_stores_btn')}</span>
        </button>
      </div>
    `;
  }

  /**
   * Builds formatted WhatsApp share text in English or Urdu with medicine comparison and medical disclaimer.
   */
  function buildWhatsAppShareText(med, alt, unit) {
    const formulaStr = `${alt.generic_name} ${alt.strength}`;
    let text = t('share_msg_header');
    text += t('share_msg_original', {
      brand: med.brand_name,
      mfg: med.manufacturer,
      price: formatPKR(med.unit_price_pkr),
      unit: unit,
    });
    text += t('share_msg_alt', {
      altBrand: alt.brand_name,
      altMfg: alt.manufacturer,
      altPrice: formatPKR(alt.unit_price_pkr),
      unit: unit,
      percent: alt.percent_savings,
      diff: formatPKR(alt.unit_difference_pkr),
      formula: formulaStr,
    });
    text += t('share_msg_disclaimer');
    return text;
  }

  /**
   * Renders the generic alternatives list, savings banner, and sort controls.
   */
  function renderAlternatives(med, sortBy = 'price_asc') {
    const result = window.SastaSearch.getAlternatives(med, { sortBy });
    const alternatives = result.alternatives;
    const cheapest = result.cheapestAlternative;
    const unit = formatUnitLabel(med.dosage_form);

    // 1. Savings Spotlight Banner (Understandable in under 2 seconds)
    if (cheapest && cheapest.is_cheaper && cheapest.percent_savings > 0) {
      savingsSpotlight.style.display = 'flex';
      const spotlightTitle = t('spotlight_title', { percent: cheapest.percent_savings });
      const spotlightDesc = t('spotlight_desc', {
        from: escapeHtml(med.brand_name),
        to: escapeHtml(cheapest.brand_name),
        mfg: escapeHtml(cheapest.manufacturer),
        savings: formatPKR(cheapest.unit_difference_pkr),
        unit,
      });

      const shareText = buildWhatsAppShareText(med, cheapest, unit);
      const whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}`;

      savingsSpotlight.innerHTML = `
        <div class="spotlight-left">
          <div class="spotlight-icon" aria-hidden="true">💰</div>
          <div>
            <div class="spotlight-title">${spotlightTitle}</div>
            <div class="spotlight-desc">${spotlightDesc}</div>
          </div>
        </div>
        <div class="spotlight-right">
          <div class="spotlight-badge">
            ${t('spotlight_cheapest_label')} ${formatPKR(cheapest.unit_price_pkr)} / ${unit}
          </div>
          <div class="spotlight-action-buttons">
            <a href="${whatsappUrl}" target="_blank" rel="noopener noreferrer" class="whatsapp-share-btn" aria-label="${t('share_whatsapp_title')}">
              <span aria-hidden="true">💬</span> ${t('share_whatsapp')}
            </a>
            <button type="button" class="nearby-stores-toggle-btn spotlight-nearby-btn" id="spotlight-nearby-btn" aria-label="${t('find_nearby_stores_btn')}">
              <span aria-hidden="true">📍</span> <span>${t('find_nearby_stores_btn')}</span>
            </button>
          </div>
        </div>
      `;
    } else {
      savingsSpotlight.style.display = 'none';
      savingsSpotlight.innerHTML = '';
    }

    // 2. Alternatives Toolbar & List
    if (alternatives.length > 0) {
      alternativesToolbar.style.display = 'flex';
      const brandsText = window.SastaI18n && window.SastaI18n.getLanguage() === 'ur'
        ? `${alternatives.length} متبادل ملے`
        : `${alternatives.length} brand${alternatives.length > 1 ? 's' : ''} found`;
      alternativesCount.textContent = brandsText;
      zeroAlternativesCard.style.display = 'none';

      const minPrice = Math.min(...alternatives.map((a) => a.unit_price_pkr));

      alternativesList.innerHTML = alternatives
        .map((alt) => {
          const isCheapestBrand = alt.unit_price_pkr === minPrice && alt.unit_price_pkr < med.unit_price_pkr;
          const altUnit = formatUnitLabel(alt.dosage_form);

          let savingsBadgeHtml = '';
          if (alt.is_cheaper) {
            savingsBadgeHtml = `
              <span class="savings-tag cheaper" role="status">
                <span aria-hidden="true">📉</span>
                <strong>${t('badge_cheaper')}:</strong> ${t('save_percent', { percent: alt.percent_savings, amount: formatPKR(alt.unit_difference_pkr), unit: altUnit })}
              </span>
            `;
          } else if (alt.is_more_expensive) {
            const extra = Math.abs(alt.unit_difference_pkr);
            savingsBadgeHtml = `
              <span class="savings-tag more-expensive" role="status">
                <strong>${t('badge_more_expensive')}:</strong> ${t('more_expensive', { amount: formatPKR(extra), unit: altUnit })}
              </span>
            `;
          } else {
            savingsBadgeHtml = `
              <span class="savings-tag same" role="status">
                <strong>${t('badge_same')}:</strong> ${t('same_price', { amount: formatPKR(alt.unit_price_pkr), unit: altUnit })}
              </span>
            `;
          }

          const cardClass = isCheapestBrand ? 'alt-card is-cheapest' : 'alt-card';
          const ribbonHtml = isCheapestBrand ? `<div class="cheapest-ribbon">${t('badge_best_value')}</div>` : '';

          const altShareText = buildWhatsAppShareText(med, alt, altUnit);
          const altWhatsAppUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(altShareText)}`;

          return `
          <div class="${cardClass}" data-med-id="${escapeHtml(alt.id)}">
            ${ribbonHtml}
            <div class="alt-card-header">
              <div class="alt-brand-group">
                <h4>${escapeHtml(alt.brand_name)}</h4>
                <div class="alt-manufacturer">${escapeHtml(alt.manufacturer)}</div>
              </div>
              <div class="alt-pricing-group">
                <div class="alt-unit-price">${formatPKR(alt.unit_price_pkr)} <span class="alt-unit-price-sub">/ ${altUnit}</span></div>
                <div class="alt-pack-info">${formatPKR(alt.pack_price_pkr)} ${t('results_pack_of')} ${alt.pack_size}</div>
              </div>
            </div>
            <div class="alt-card-footer">
              <div class="same-salt-badge">
                <span aria-hidden="true">✓</span> ${t('same_salt_formula')} <strong>${escapeHtml(alt.generic_name)} ${escapeHtml(alt.strength)}</strong>
              </div>
              <div class="alt-footer-actions">
                <div>${savingsBadgeHtml}</div>
                ${alt.is_cheaper ? `
                <a href="${altWhatsAppUrl}" target="_blank" rel="noopener noreferrer" class="whatsapp-share-btn-mini" aria-label="${t('share_whatsapp_title')}">
                  <span aria-hidden="true">💬</span> ${t('share_whatsapp')}
                </a>` : ''}
              </div>
            </div>
          </div>
        `;
        })
        .join('');
    } else {
      // 3. Zero Alternatives Found
      alternativesToolbar.style.display = 'none';
      alternativesList.innerHTML = '';
      zeroAlternativesCard.style.display = 'block';
      zeroAlternativesDesc.innerHTML = t('zero_alt_desc', {
        formula: `${escapeHtml(med.generic_name)} ${escapeHtml(med.strength)}`,
        mfg: escapeHtml(med.manufacturer),
      });
    }
  }

  /**
   * Opens the nearby stores section and initiates location resolution.
   */
  async function openNearbyStoresSection() {
    if (!nearbyStoresSection) return;
    nearbyStoresSection.style.display = 'block';
    nearbyStoresSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

    if (cachedUserCoords) {
      renderStoresFromCoordinates(cachedUserCoords.latitude, cachedUserCoords.longitude);
    } else {
      renderNearbyStoresLocationPrompt();
    }
  }

  function closeNearbyStoresSection() {
    if (nearbyStoresSection) {
      nearbyStoresSection.style.display = 'none';
    }
  }

  /**
   * Renders the initial friendly location permission prompt.
   */
  function renderNearbyStoresLocationPrompt() {
    if (!storeLocationBar) return;
    const popularCities = ['Karachi', 'Lahore', 'Islamabad', 'Rawalpindi', 'Faisalabad', 'Multan', 'Peshawar', 'Quetta', 'Hyderabad', 'Gujranwala', 'Sialkot', 'Abbottabad'];

    storeLocationBar.innerHTML = `
      <div class="location-prompt-box">
        <div class="location-prompt-content">
          <span class="location-prompt-icon" aria-hidden="true">📍</span>
          <div class="location-prompt-text">
            <strong>${t('location_prompt_text')}</strong>
          </div>
        </div>
        <div class="location-prompt-actions">
          <button type="button" class="btn-location-action" id="request-location-btn">
            <span aria-hidden="true">🎯</span> <span>${t('find_nearby_stores_btn')}</span>
          </button>
          <button type="button" class="btn-location-secondary" id="manual-location-toggle-btn">
            <span>${t('manual_area_btn')}</span>
          </button>
        </div>
      </div>
      <div class="store-quick-cities" style="margin-top: 0.75rem;">
        <span class="store-quick-cities-label">${t('quick_cities_label')}</span>
        <div class="store-city-chips-row">
          ${popularCities
            .map((c) => {
              const isActive = c.toLowerCase() === (currentStoresQuery || '').toLowerCase();
              return `<button type="button" class="store-city-chip ${isActive ? 'active' : ''}" data-city="${c}">${c}</button>`;
            })
            .join('')}
        </div>
      </div>
    `;

    const requestLocationBtn = document.getElementById('request-location-btn');
    if (requestLocationBtn) {
      requestLocationBtn.addEventListener('click', handleRequestLocation);
    }

    const manualLocationToggleBtn = document.getElementById('manual-location-toggle-btn');
    if (manualLocationToggleBtn) {
      manualLocationToggleBtn.addEventListener('click', () => {
        renderNearbyStoresDeniedFallback();
      });
    }

    // Quick city chips listener
    storeLocationBar.querySelectorAll('.store-city-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        const city = btn.getAttribute('data-city');
        if (city) {
          currentStoresQuery = city;
          storeLocationBar.querySelectorAll('.store-city-chip').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          handleManualAreaSearch(city);
        }
      });
    });

    // Pre-populate with default stores while user decides
    handleManualAreaSearch(currentStoresQuery);
  }

  /**
   * Renders fallback manual area search box when location is denied or user opts for manual search.
   */
  function renderNearbyStoresDeniedFallback(msg) {
    if (!storeLocationBar) return;
    const alertMsg = msg || t('location_denied_msg');

    const popularCities = ['Karachi', 'Lahore', 'Islamabad', 'Rawalpindi', 'Faisalabad', 'Multan', 'Peshawar', 'Quetta', 'Hyderabad', 'Gujranwala', 'Sialkot', 'Abbottabad'];

    storeLocationBar.innerHTML = `
      <div class="location-denied-box">
        <p class="location-denied-msg">${alertMsg}</p>
        <form class="manual-area-form" id="manual-area-form" onsubmit="return false;">
          <input
            type="text"
            id="manual-area-input"
            class="manual-area-input"
            placeholder="${t('manual_area_placeholder')}"
            value="${escapeHtml(currentStoresQuery)}"
            aria-label="City or area name in Pakistan"
          />
          <button type="button" id="manual-area-submit-btn" class="manual-area-submit-btn">
            ${t('manual_area_btn')}
          </button>
        </form>
        <div class="store-quick-cities">
          <span class="store-quick-cities-label">${t('quick_cities_label')}</span>
          <div class="store-city-chips-row">
            ${popularCities
              .map((c) => {
                const isActive = c.toLowerCase() === (currentStoresQuery || '').toLowerCase();
                return `<button type="button" class="store-city-chip ${isActive ? 'active' : ''}" data-city="${c}">${c}</button>`;
              })
              .join('')}
          </div>
        </div>
      </div>
    `;

    const manualInput = document.getElementById('manual-area-input');
    const manualSubmitBtn = document.getElementById('manual-area-submit-btn');

    const submitAction = () => {
      const val = manualInput ? manualInput.value.trim() : '';
      if (val) {
        currentStoresQuery = val;
        handleManualAreaSearch(val);
      }
    };

    if (manualSubmitBtn) {
      manualSubmitBtn.addEventListener('click', submitAction);
    }
    if (manualInput) {
      manualInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          submitAction();
        }
      });
    }

    // Quick city chips listener
    storeLocationBar.querySelectorAll('.store-city-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        const city = btn.getAttribute('data-city');
        if (city) {
          currentStoresQuery = city;
          if (manualInput) manualInput.value = city;
          storeLocationBar.querySelectorAll('.store-city-chip').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          handleManualAreaSearch(city);
        }
      });
    });
  }

  /**
   * Handles user tapping "Allow Location".
   */
  async function handleRequestLocation() {
    if (!window.SastaNearbyStores) return;
    if (storeLocationBar) {
      storeLocationBar.innerHTML = `
        <div class="stores-loading-indicator">
          <span class="loading-spinner" aria-hidden="true">⏳</span>
          <span>${t('stores_loading')}</span>
        </div>
      `;
    }

    const res = await window.SastaNearbyStores.requestCurrentPosition();

    if (res.success && res.coords) {
      cachedUserCoords = res.coords;
      if (storeLocationBar) {
        storeLocationBar.innerHTML = `
          <div class="location-success-badge">
            <span aria-hidden="true">✓</span> Location detected. Showing closest medical stores:
          </div>
        `;
      }
      renderStoresFromCoordinates(res.coords.latitude, res.coords.longitude);
    } else {
      // Permission denied or error -> graceful fallback
      renderNearbyStoresDeniedFallback();
      handleManualAreaSearch(currentStoresQuery);
    }
  }

  /**
   * Renders stores based on GPS coordinates.
   */
  function renderStoresFromCoordinates(lat, lng) {
    if (!window.SastaNearbyStores) return;
    const stores = window.SastaNearbyStores.findStoresNearCoordinates(lat, lng, 12);
    renderStoresList(stores, { lat, lng });
  }

  /**
   * Searches stores by city or area name.
   */
  function handleManualAreaSearch(area) {
    if (!window.SastaNearbyStores) return;
    const stores = window.SastaNearbyStores.findStoresByCityOrArea(area, 12);
    renderStoresList(stores, { query: area });
  }

  /**
   * Renders store cards with call buttons (tel:), directions buttons, and Live Google Maps integration.
   */
  function renderStoresList(stores, context = {}) {
    // Generate live Google Maps search URL
    let liveGmapsUrl = 'https://www.google.com/maps/search/pharmacy+medical+store+near+me/';
    if (window.SastaNearbyStores && typeof window.SastaNearbyStores.getLiveGoogleMapsSearchUrl === 'function') {
      if (context.lat && context.lng) {
        liveGmapsUrl = window.SastaNearbyStores.getLiveGoogleMapsSearchUrl(context.lat, context.lng);
      } else {
        liveGmapsUrl = window.SastaNearbyStores.getLiveGoogleMapsSearchUrl(null, null, context.query || currentStoresQuery);
      }
    }

    // Render Live Google Maps CTA banner
    const liveGmapsContainer = document.getElementById('live-gmaps-container');
    if (liveGmapsContainer) {
      const activeLocation = context.query || (context.lat ? 'your current GPS location' : currentStoresQuery);
      liveGmapsContainer.innerHTML = `
        <div class="live-gmaps-banner">
          <div class="live-gmaps-info">
            <span class="live-gmaps-badge">${t('live_gmaps_badge')}</span>
            <h4 class="live-gmaps-title">${t('live_gmaps_title')}</h4>
            <p class="live-gmaps-desc">${t('live_gmaps_desc')}</p>
          </div>
          <a href="${escapeHtml(liveGmapsUrl)}" target="_blank" rel="noopener noreferrer" class="live-gmaps-btn" id="live-gmaps-btn" aria-label="${t('live_gmaps_btn')}">
            <span aria-hidden="true">🗺️</span> <span>${t('live_gmaps_btn')}</span>
          </a>
        </div>
        <div class="stores-meta-bar">
          <span class="stores-count-tag">${t('showing_stores_count', { count: stores ? stores.length : 0, location: escapeHtml(activeLocation) })}</span>
        </div>
      `;
    }

    if (!storesGrid) return;
    if (!stores || stores.length === 0) {
      storesGrid.innerHTML = `
        <div class="no-stores-message">${t('no_stores_found')}</div>
      `;
      return;
    }

    storesGrid.innerHTML = stores
      .map((store) => {
        const distanceText = store.distance_km !== null && store.distance_km !== undefined
          ? t('store_distance_km', { distance: store.distance_km })
          : '';

        // Call Button: Only render if phone number is available
        const callBtnHtml = store.tel_link
          ? `<a href="tel:${escapeHtml(store.tel_link)}" class="store-btn store-call-btn" aria-label="${t('store_call_btn')} ${escapeHtml(store.name)}"><span aria-hidden="true">📞</span> ${t('store_call_btn')}</a>`
          : '';

        // Directions Button: Opens Google Maps with coordinates
        const directionsBtnHtml = `
          <a href="${escapeHtml(store.directions_url)}" target="_blank" rel="noopener noreferrer" class="store-btn store-dir-btn" aria-label="${t('store_directions_btn')} ${escapeHtml(store.name)}"><span aria-hidden="true">🗺️</span> ${t('store_directions_btn')}</a>
        `;

        return `
          <div class="store-card" data-store-id="${escapeHtml(store.id)}">
            <div class="store-card-header">
              <div class="store-name-group">
                <h4 class="store-name">${escapeHtml(store.name)}</h4>
                <div class="store-address">${escapeHtml(store.address)}</div>
              </div>
              ${distanceText ? `<span class="store-distance-badge">${distanceText}</span>` : ''}
            </div>
            <div class="store-card-meta">
              ${store.phone ? `<span class="store-phone"><span aria-hidden="true">☎️</span> ${escapeHtml(store.phone)}</span>` : '<span class="store-phone-na">No phone listed</span>'}
              ${store.open_hours ? `<span class="store-hours"><span aria-hidden="true">🕒</span> ${escapeHtml(store.open_hours)}</span>` : ''}
            </div>
            <div class="store-actions">
              ${callBtnHtml}
              ${directionsBtnHtml}
            </div>
          </div>
        `;
      })
      .join('');
  }

  /**
   * UI View State Toggles.
   */
  function showResultsView() {
    resultsView.classList.add('active');
    noResultsView.style.display = 'none';
    exploreView.style.display = 'none';
    closeNearbyStoresSection();
    window.scrollTo({ top: searchInput.offsetTop - 20, behavior: 'smooth' });
  }

  function showNoResultsView(query = '') {
    resultsView.classList.remove('active');
    noResultsView.style.display = 'block';
    exploreView.style.display = 'none';
    closeNearbyStoresSection();
    if (noResultsQueryMsg) {
      noResultsQueryMsg.textContent = query
        ? t('no_results_desc', { query: escapeHtml(query) })
        : t('no_results_desc', { query: '' });
    }
    showErrorMessage(`No medicine found matching "${query || 'search'}".`);
  }

  function showExploreView() {
    resultsView.classList.remove('active');
    noResultsView.style.display = 'none';
    exploreView.style.display = 'block';
    closeNearbyStoresSection();
    currentMedicine = null;
    const breadcrumbCurrentLabel = document.getElementById('breadcrumb-current-label');
    if (breadcrumbCurrentLabel) {
      breadcrumbCurrentLabel.textContent = 'Pakistan Medicine Price & Generic Guide';
    }
  }

  // Expose for testing & external programmatic use
  window.SastaApp = {
    init,
    performSearch,
    selectMedicineById,
    selectCategory,
    switchLanguage,
    renderAlternatives,
    showResultsView,
    showNoResultsView,
    showExploreView,
    openNearbyStoresSection,
    closeNearbyStoresSection,
    handleRequestLocation,
    handleManualAreaSearch,
    renderStoresList,
    showSuccessMessage,
    showErrorMessage,
  };

  // Initialize and expose promise
  const initPromise = init();
  window.__APP_INIT_PROMISE__ = initPromise;

  // Register Service Worker for offline PWA functionality
  if (typeof window !== 'undefined' && 'serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {
        // SW registration optional / gracefully ignored if blocked
      });
    });
  }
})();
