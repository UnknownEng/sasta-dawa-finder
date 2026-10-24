# Sasta Dawa Finder (سستی دوا تلاش کار) 🇵🇰
### Medicine Price & Generic Alternative Finder for Pakistan

**Sasta Dawa Finder** is a fast, clean, mobile-first web tool built for people in Pakistan to search common medicines by brand name, see their active salt/generic formula, compare retail market prices, and find cheaper generic alternatives with the exact same active pharmaceutical ingredient.

---

## 🌟 Features (Version 1)

1. **Instant Autocomplete & Fuzzy Search**:
   - Search by brand name (e.g., *"Panadol"*, *"Risek"*, *"Augmentin"*, *"Brufen"*), generic formula (e.g., *"Paracetamol"*, *"Omeprazole"*, *"Co-Amoxiclav"*), or category.
   - Fast, interactive suggestions dropdown with keyboard navigation (`↑`, `↓`, `Enter`, `Esc`).

2. **Medicine Category Priority & Filtering**:
   - Interactive category pill bar with live medicine counts:
     - 🩹 **Pain & Fever** / درد اور بخار
     - 🫄 **Stomach & Acidity (PPI)** / معدہ اور تیزابیت
     - 🦠 **Antibiotics** / اینٹی بائیوٹکس
     - ❤️ **Blood Pressure & Heart** / بلڈ پریشر اور دل
     - 🩸 **Diabetes / Sugar** / شوگر و ذیابیطس
     - 🤧 **Allergy & Cold** / الرجی اور نزلہ زکام
   - 1-click filtering that prioritizes search queries and explores top medicines in the selected category.

3. **Urdu UI Mode (مکمل اردو موڈ)**:
   - 1-click toggle in the header: **`[ English | اردو ]`**.
   - Native Right-to-Left (RTL) layout with natural Pakistani Urdu translations for search inputs, medical disclaimers, savings calculations, sorting options, and unit labels (گولی, کیپسول, بوتل).

4. **Accurate Formula & Pricing Breakdown**:
   - Displays brand name, manufacturer, exact generic salt formula, strength, and packaging details.
   - Shows both unit price (per tablet / capsule / puff) and pack price in Pakistani Rupees (PKR).
   - Clear flagging of estimates (`Approx. Estimate` badge) for specialized or fluctuating items.

5. **Generic Alternative Matching & Savings Calculator**:
   - Groups identical chemical salts and strengths (`salt_group_id`).
   - Highlights the potential savings in a prominent **Savings Spotlight** banner (e.g., *"Save up to 41% by switching from Panadol to Febrol"*).
   - Shows calculated per-unit price differences and percentage savings for every generic brand.

6. **Multi-Criteria Price Sorting**:
   - **Cheapest First (Recommended)**: instantly identifies the lowest cost quality generic.
   - **Highest Savings %**: ranks brands that maximize your savings.
   - **Price: High to Low**: for full market perspective.
   - **Brand Name (A to Z)**: alphabetical listing.

7. **Handles Zero-Alternative Formulations**:
   - If a medicine is proprietary or single-source with no registered generic in the database (e.g. *Spiriva Respimat*), a friendly notice explains that no cheaper generic equivalents were found and advises consulting a physician.


6. **Mobile-First & Offline Capable**:
   - Responsive design tailored for Pakistani mobile users on Android/iOS phones with touch targets >= 44px.
   - Zero-dependency Vanilla HTML5/CSS3/JavaScript architecture.
   - Dual-loader support: runs instantly over HTTP (`fetch`) or directly via double-clicking `index.html` in browser (`file://`).

7. **Prominent Safety & Medical Disclaimers**:
   - Visible banner and footer stating:
     > *"Prices and information are approximate and for general awareness only. Always confirm with a licensed pharmacist or doctor before switching medicines."*

---

## 🚀 How to Run and View the App

### Option 1: Quick Local Server (Recommended)
You can start a local server using either Python or Node.js:

```bash
# Using Python 3
python3 -m http.server 3000

# Or using npm
npm start
```
Then open your browser at:
👉 **`http://localhost:3000`**

### Option 2: Direct File Open (Offline)
Double-click `index.html` or open it directly in any browser (Chrome, Firefox, Safari, Edge, Android Chrome):
```bash
# In Linux terminal
xdg-open index.html
```

---

## 🧪 Automated Testing & Verification

The project includes an end-to-end automated test suite utilizing Node.js native test runner and JSDOM:

```bash
npm test
```

### Test Coverage (12 Comprehensive Test Suites):
- `tests/data.test.js`: Validates 317 entries, checks schema integrity, unique IDs, positive prices, and spot-checks real medications manually.
- `tests/search.test.js`: Verifies exact matching, partial prefix matching, case insensitivity, generic formula search, no-match handling, and input sanitization.
- `tests/alternatives_sort.test.js`: Verifies generic grouping, unit price calculations, savings percentages, and price sorting logic.
- `tests/synonyms_and_rivotril.test.js`: Verifies bidirectional synonym matching (Metamizole ↔ Novaminsulfon) and psychiatric medications (Rivotril / Clonazepam).
- `tests/category_filter.test.js`: Validates therapeutic category mappings and prioritized category browsing.
- `tests/pediatric_and_topical.test.js`: Verifies pediatric syrups (Paracetamol, Brufen, Augmentin) and topical dermatologicals (Betnovate, Fucidin, Canesten, Polyfax).
- `tests/pwa.test.js`: Verifies Web App Manifest, offline Service Worker, and mobile PWA meta tags.
- `tests/whatsapp_share.test.js`: Verifies 1-tap WhatsApp sharing link generation with price comparisons and safety warnings in English & Urdu.
- `tests/sync_drug_data.test.js`: Verifies offline DRAP data ingestion, normalization, and validation pipeline.
- `tests/urdu_mode.test.js`: Validates English/Urdu bilingual switching, RTL layout, and natural Urdu phrasing.
- `tests/ui_dom.test.js`: Tests DOM rendering, zero-alternatives card, mobile viewport configuration, XSS prevention, and simulates 5 realistic end-to-end user journeys.
- `tests/ui_responsive_branding.test.js`: Verifies plain-language UI without jargon, footer branding ("Made by Maverick Tech Ventures"), auto-updating copyright notice, and non-color-reliant savings cues.

---

## 📁 Project Structure

```
medicine/
├── index.html                   # Mobile-first SPA entrypoint with plain language & Maverick Tech Ventures branding
├── manifest.json                # PWA Web App Manifest for mobile installation
├── sw.js                        # Offline Service Worker with stale-while-revalidate caching
├── icons/
│   └── icon.svg                 # Scalable high-res SVG app icon
├── css/
│   └── style.css                # Accessible CSS with mobile touch targets (>= 48px), RTL, and dark footer
├── js/
│   ├── app.js                   # Application controller, plain language rendering, WhatsApp share & PWA registration
│   ├── search.js                # Search, bidirectional synonym resolution, and ranking algorithms
│   ├── translations.js          # Bilingual English/Urdu plain language dictionary & i18n module
│   ├── data.js                  # Asynchronous data loader with offline fallback
│   └── medicines_data_embed.js  # Embedded dataset for zero-CORS / offline execution (317 medicines)
├── data/
│   └── medicines.json           # Expanded database of 317 common Pakistani medicines across 29 categories
├── scripts/
│   └── sync_drug_data.js        # DRAP / Public drug data validation, normalization and sync pipeline
├── tests/
│   ├── data.test.js             # Dataset schema and accuracy tests
│   ├── search.test.js           # Search engine unit tests
│   ├── alternatives_sort.test.js# Alternative matching & sorting unit tests
│   ├── synonyms_and_rivotril.test.js # Synonym resolution & psychiatric medicine tests
│   ├── category_filter.test.js  # Category priority filtering tests
│   ├── pediatric_and_topical.test.js # Pediatric syrups and topical creams tests
│   ├── pwa.test.js              # PWA manifest, service worker & icons tests
│   ├── whatsapp_share.test.js   # WhatsApp share formatting and DOM tests
│   ├── sync_drug_data.test.js   # Data ingestion pipeline unit tests
│   ├── urdu_mode.test.js        # Urdu RTL mode & i18n tests
│   ├── ui_dom.test.js           # DOM integration and realistic user simulation tests
│   └── ui_responsive_branding.test.js # Plain language, branding & responsive styles tests
├── BUILD_LOG.md                 # Complete Build-Verify-Fix loop log (v1, v2 & v3 entries)
├── package.json                 # Project configuration and test runners
└── README.md                    # Project documentation
```

---

## ⚖️ Legal & Medical Disclaimer
*Prices and pharmaceutical information provided are approximate and for consumer awareness only based on publicly available drug information in Pakistan. This application is not a substitute for professional medical advice, diagnosis, or treatment. Always consult a qualified physician or licensed pharmacist before changing or stopping any prescribed medication.*
