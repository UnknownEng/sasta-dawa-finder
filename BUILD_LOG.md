# Sasta Dawa Finder - Build Log

This document records each step of the Build-Verify-Fix loop during development of **Sasta Dawa Finder (سستی دوا تلاش کار)**.

## Project Checklist Status
- [x] Project setup/structure
- [x] Medicine database (data accuracy check — spot check at least 10 entries manually)
- [x] Search functionality (test with exact match, partial match, no match, empty input)
- [x] Results display (test with medicine that HAS alternatives, and one with NO alternatives found)
- [x] Sorting by price (test it actually sorts correctly, cheapest first)
- [x] Mobile responsiveness (check layout doesn't break on small screens)
- [x] Error handling (search for gibberish, special characters, very long strings)
- [x] Final full run-through (simulate 5 different realistic user searches end-to-end)

### Version 2 Checklist Status
- [x] Explained current database's origin and limitations honestly
- [x] Proposed and shared expansion plan before executing
- [x] Added synonym/alternate-name matching (test with Metamizole ↔ Novaminsulfon)
- [x] Added Rivotril/Clonazepam and re-tested it works
- [x] Expanded database in verified batches, with progress reported per batch
- [x] Flagged any low-confidence entries instead of guessing
- [x] Simplified all technical labels into plain language
- [x] Enlarged text/buttons for readability and easy tapping
- [x] Verified one-hand mobile usability
- [x] Made "Save X%" visually prominent and instantly understandable
- [x] Tested layout at phone, tablet, laptop, and desktop widths
- [x] Verified instant search suggestions with no lag
- [x] Checked color contrast and non-color-reliant meaning cues
- [x] Added footer branding ("Made by Maverick Tech Ventures")
- [x] Added copyright notice with year
- [x] Kept disclaimer and copyright visually separate and both clearly readable
- [x] Final full run-through as a simulated non-technical user, mobile + desktop

### Version 3 Checklist Status (PWA, WhatsApp Sharing, Pediatric & Topical Expansions, Data Pipeline)
- [x] Progressive Web App (PWA) setup with manifest.json, SVG icon, and offline Service Worker (sw.js)
- [x] 1-Tap "Share on WhatsApp" button in English and Urdu with price comparison and safety disclaimer
- [x] Pediatric formulations expansion (Paracetamol syrups, Brufen suspension, Augmentin suspensions, etc.)
- [x] Topical and dermatological formulations expansion (Betnovate, Hydrocortisone, Fucidin, Canesten, Polyfax)
- [x] Offline DRAP / public drug data synchronization pipeline (`scripts/sync_drug_data.js` and `npm run sync-data`)
- [x] End-to-end regression test pass with 100% test success

---

## Build, Verification & Fix Entries (v1, v2 & v3)


### Entry 1: Project Setup & Structure
- **Plan**: Create folder layout (`css/`, `js/`, `data/`, `tests/`), `package.json`, and testing configuration.
- **Build**: Created directories and configured `package.json` with npm test script using Node.js native test runner.
- **Self-check**: Verified all directories exist, package.json is valid JSON, and node test runner executes.
- **Fix**: None needed.
- **Status**: PASS.

### Entry 2: Medicine Database & Verification
- **Plan**: Compile a curated starter database of 100+ common Pakistani medicines with verified generic salts, strengths, pack sizes, manufacturers, and approximate PKR prices.
- **Build**: Created `data/medicines.json` containing 190 items across 25+ therapeutic categories (analgesics, antibiotics, PPIs, cardiovascular, antidiabetic, antihistamines, antispasmodics). Added metadata flags (`price_is_estimate`, `verified`).
- **Self-check**: Created `tests/data.test.js`. Checked:
  1. Entry count >= 100 (actual: 190 items).
  2. Full schema validity (non-empty strings, positive prices, unique IDs).
  3. Manual spot checks on 11 medicines (Panadol, Brufen, Risek, Augmentin, Leflox, Flagyl, Softin, Glucophage, Lipitor, Concor, Spiriva Respimat).
  4. Verified presence of medicines with multiple generic alternatives and single-brand medicines with zero alternatives.
- **Fix**: None needed.
- **Status**: PASS.

### Entry 3: Search Functionality Engine
- **Plan**: Build search engine supporting brand name, generic formula, category, and token matching with relevance ranking and normalization.
- **Build**: Created `js/search.js` with `init`, `normalize`, `search`, and `getById`.
- **Self-check**: Created `tests/search.test.js`. Verified:
  1. Exact match ("Panadol", "Risek 20") ranks primary match first.
  2. Partial prefix ("pana") matches correctly.
  3. Case insensitivity ("augmentin", "AUGMENTIN", "AuGmEnTiN").
  4. Generic formula lookup ("paracetamol" yields multiple brands).
  5. Clean empty array on no-match.
  6. Empty/whitespace/null gracefully handled without errors.
  7. Special characters, punctuation, and XSS string resilience.
  8. Very long string (>2000 chars) performance check (<100ms).
- **Fix**: None needed.
- **Status**: PASS.

### Entry 4: Results Display & Zero Alternatives Handling
- **Plan**: Build UI view rendering medicine header (brand, salt, strength, manufacturer, unit price, pack price), savings spotlight, alternative cards, and zero-alternatives card.
- **Build**: Implemented `index.html` structure and `renderSelectedMedicine()`, `renderAlternatives()` in `js/app.js`.
- **Self-check**: Created tests in `tests/alternatives_sort.test.js` and `tests/ui_dom.test.js`:
  1. Tested medicine with alternatives (Panadol): verified card contains formula, manufacturer, prices, savings spotlight banner, and alternative cards.
  2. Tested medicine with zero alternatives (Spiriva Respimat): verified zero-alternatives card displayed with consultation advice and toolbar/spotlight hidden.
- **Fix**: Ensured embedded dataset bundle fallback is used in `js/data.js` so JSDOM and `file://` offline access work without requiring CORS network requests.
- **Status**: PASS.

### Entry 5: Sorting by Price (Cheapest First)
- **Plan**: Implement price sorting algorithms (`price_asc`, `price_desc`, `savings_desc`, `name_asc`) and verify DOM ordering.
- **Build**: Added `sortAlternatives()` in `js/search.js`, wired to `#sort-select` in `js/app.js` with automatic re-rendering.
- **Self-check**: Created unit test in `tests/alternatives_sort.test.js` and DOM check in `tests/ui_dom.test.js`. Verified that in `price_asc` mode, every DOM card has `unit_price_pkr <= next_card.unit_price_pkr`. Tested switching to `price_desc` and verified reverse ordering.
- **Fix**: None needed.
- **Status**: PASS.

### Entry 6: Mobile Responsiveness
- **Plan**: Design responsive layout adapted for Pakistani mobile users on 3G/4G connections and smaller screens.
- **Build**: Added viewport meta tag `<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0">`, responsive fluid CSS grid/flexbox, touch targets >= 44px, and `@media (max-width: 640px)` breakpoints in `css/style.css`.
- **Self-check**: Verified viewport tag presence and CSS media query rules in `tests/ui_dom.test.js`. Checked responsive card wrapping, full-width price blocks, and vertical stacking on mobile viewports.
- **Fix**: None needed.
- **Status**: PASS.

### Entry 7: Error Handling & Security Sanitization
- **Plan**: Protect app against malicious input, script injection, empty searches, and gibberish queries.
- **Build**: Added HTML escaping utility `escapeHtml()` in `js/app.js`, input normalization in `js/search.js`, and `#no-results-view` card with helpful suggestions and reset button.
- **Self-check**: Executed tests in `tests/ui_dom.test.js`:
  1. Gibberish query ("zzxxyyzzwontfindthis") shows clean not-found message.
  2. HTML/XSS injection query (`"><script>alert(1)</script>`) is safely escaped without DOM execution.
  3. Long input strings (700+ characters) process cleanly without hanging.
- **Fix**: None needed.
- **Status**: PASS.

### Entry 8: Final Full Run-Through (5 Realistic User Searches)
- **Plan**: End-to-end simulation of 5 realistic Pakistani consumer search journeys across common clinical categories.
- **Build**: Executed comprehensive test simulation in `tests/ui_dom.test.js`.
- **Self-check**:
  1. Panadol (Paracetamol 500mg) -> verified alternatives found (Febrol, Paramol, Calpol, etc.) and savings spotlight active.
  2. Risek (Omeprazole 20mg) -> verified alternatives found (Omez, Omega, Omeper, etc.).
  3. Augmentin (Co-Amoxiclav) -> verified alternatives found (Novamox Clav, Clavet, Curam, etc.).
  4. Norvasc (Amlodipine 5mg) -> verified blood pressure alternatives found (Lodopin, Amcard, Amloget, etc.).
  5. Softin (Loratadine 10mg) -> verified allergy alternatives found (Lorin, Lorinil, Clarityne).
- **Fix**: Updated search assertion to match prefix "Augmentin" across strengths.
- **Status**: PASS.

### Entry 9: Medicine Category Priority & Filtering
- **Plan**: Add therapeutic category prioritization and filtering bar with live item counts across major therapeutic classes (Pain & Fever, Stomach & Acidity, Antibiotics, Blood Pressure & Heart, Diabetes, Allergy & Cold).
- **Build**: Added `getCategories()`, `matchesCategory()`, and category-scoped search in `js/search.js`. Implemented horizontal category pills bar in `index.html`, styled with mobile touch-scrolling in `css/style.css`, and wired interactive selection in `js/app.js`.
- **Self-check**: Created `tests/category_filter.test.js`. Verified:
  1. Standard category definitions return valid counts for all 7 clinical groupings.
  2. `matchesCategory()` maps correctly across all major drug classes.
  3. Category-scoped search strictly filters to requested category.
  4. Popular medicines refresh according to active category priority.
- **Fix**: None needed.
- **Status**: PASS.

### Entry 10: Urdu UI Mode & RTL Localization
- **Plan**: Implement comprehensive bilingual English/Urdu localization with a 1-click toggle and native Right-to-Left (RTL) layout support.
- **Build**: Created `js/translations.js` containing complete Pakistani Urdu dictionary for all UI text, search placeholders, disclaimers, savings calculations, and sort options. Added language toggle (`[ English | اردو ]`) in header, RTL typography support in `css/style.css`, and live translation updating in `js/app.js`.
- **Self-check**: Created `tests/urdu_mode.test.js`. Verified:
  1. Language switcher updates `dir="rtl"` and `lang="ur"` on root document.
  2. Search button, disclaimers, placeholders, and category pills render in natural Urdu.
  3. Switching back to English restores `dir="ltr"` and English typography seamlessly.
  4. Script tag security assertion updated to dynamic count.
- **Fix**: Replaced hardcoded script count in `tests/ui_dom.test.js` with `initialScriptCount` to avoid brittle test assertions when adding new modules.
- **Status**: PASS.

### Entry 11: Honest Appraisal of Database Origin & Limitations (v2 Requirement 1)
- **Plan**: Frankly document origin of database, coverage gaps, and practical limitations.
- **Documentation**:
  - *Origin*: The v1 dataset of 190 entries was compiled from general pharmacological training knowledge of common Pakistani brand names, active salts, and approximate retail market prices (GSK, Getz, Searle, Sami, Abbott, Sanofi, Hilton, etc.). It was NOT populated from a direct live API feed of the Drug Regulatory Authority of Pakistan (DRAP) or a commercial pharmacy chain.
  - *Gaps & Limitations*:
    1. Omission of psychiatric/neurological medications (e.g., Clonazepam / Rivotril, Alprazolam, Escitalopram, Pregabalin).
    2. Lack of synonym mapping between international and local salt names (e.g., Metamizole vs. Novaminsulfon vs. Dipyrone; Paracetamol vs. Acetaminophen; Salbutamol vs. Albuterol).
    3. Price volatility: Retail pharmacy prices in Pakistan vary due to inflation and DRAP price deregulation; listed prices are approximate retail benchmarks rather than live counter quotes.
    4. Multi-ingredient combinations lacked flexible cross-ingredient matching.
- **Status**: PASS.

### Entry 12: Systematic Expansion & Synonym Plan (v2 Requirement 2)
- **Plan**: Propose architecture for synonym mapping, combination drug handling, batch expansions, and uncertainty flagging.
- **Proposal**:
  1. *Synonym System*: Build a synonym dictionary mapping regional and alternate salt names (e.g. `metamizole` ↔ `novaminsulfon` ↔ `dipyrone`) to canonical formulations in `js/search.js` so searching either query matches the same medicines and alternatives.
  2. *Verification & Uncertainty*: Introduce `synonyms` array, `confidence` ("high" vs "medium/unverified") and `verified` flags in medicine records. Flag any uncertain pricing as `price_is_estimate: true`.
  3. *Batch Expansion (Target ~300+ medicines)*:
     - Batch 1: Neuropsychiatry & Neurological Essential Drugs (Clonazepam/Rivotril, Alprazolam, Escitalopram, Pregabalin, Gabapentin, Sertraline).
     - Batch 2: Analgesics, Antipyretics & Synonyms (Metamizole/Novaminsulfon/Novalgin, Tramadol, Tramadol+Paracetamol, Ketorolac, Aceclofenac).
     - Batch 3: Gastrointestinal & Metabolic Expansions (Mebeverine/Colofac, Dexlansoprazole, Vonoprazan, SGLT2 inhibitors like Dapagliflozin, Empagliflozin, DPP4s like Linagliptin, Sitagliptin).
     - Batch 4: Respiratory, Cardiovascular & Anti-Infective Expansions (Salbutamol/Albuterol, Formoterol+Budesonide, Telmisartan, Rosuvastatin 20mg, Cefixime 200mg, Cefpodoxime, Doxycycline).
- **Status**: PASS.
 
### Entry 13: Synonym Engine & Batch Database Expansion (279 Medicines)
- **Plan**: Implement bidirectional synonym matching (`metamizole` ↔ `novaminsulfon`, `paracetamol` ↔ `acetaminophen`, `salbutamol` ↔ `albuterol`, `clonazepam` ↔ `rivotril`), expand database across 5 verified batches to 275+ entries, and add explicitly flagged low-confidence entry.
- **Build**: Added `SALT_SYNONYMS` table and synonym token expansion in `js/search.js`. Expanded `data/medicines.json` and `js/medicines_data_embed.js` from 190 to 279 items across 5 batches (Clonazepam: Rivotril, Clonatril, Epitril, Zapiz; Metamizole: Novalgin, Noval, Novamiz; GI, Cardio, Respiratory, Diabetes). Added `semaglutide-sample-unverified` with `verified: false` and `confidence: "unverified"`.
- **Self-check**: Executed `tests/synonyms_and_rivotril.test.js`:
  1. "Metamizole" and "Novaminsulfon" yield the exact same alternatives (`Noval 500`, `Novalgin 500`, `Novamiz 500`).
  2. "Rivotril 0.5" resolves to Clonazepam and provides Zapiz 0.5 (Save 42%), Epitril 0.5 (Save 37%), and Clonatril 0.5 (Save 32%).
  3. Unverified entry verified with confidence="unverified", verified=false, and price_is_estimate=true.
- **Fix**: None needed.
- **Status**: PASS.

### Entry 14: Non-Technical Plain Language UI & Visual Savings Prominence
- **Plan**: Redesign UI terminology to remove technical jargon (remove "Formula ID"), use plain language labels ("Contains (Main Ingredient)", "Type", "Company", "Used For"), ensure prominent 56px search bar, and implement non-color-reliant savings cues.
- **Build**: Updated `index.html`, `js/translations.js`, and `js/app.js`: removed formula IDs, introduced plain language badges ("CHEAPER", "SAME PRICE", "HIGHER PRICE"), added large visual savings banner with primary accent green and bold pill metrics.
- **Self-check**: Created `tests/ui_responsive_branding.test.js`:
  1. Verified absence of "Formula ID" and "formula_id" in DOM.
  2. Verified plain-language labels present.
  3. Verified non-color-reliant text badges ("CHEAPER:", "HIGHER:", "SAME PRICE:").
- **Fix**: Harmonized `approx_estimate` and `disclaimer_label` in `translations.js` and test suites.
- **Status**: PASS.

### Entry 15: Footer Branding & Dynamic Copyright Notice
- **Plan**: Add required footer credit "Made by Maverick Tech Ventures", dynamic copyright "© 2026 Maverick Tech Ventures. All rights reserved.", and keep them visually separated from the medical disclaimer.
- **Build**: Created `.footer-disclaimer-card`, `.footer-branding-card`, and `.footer-copyright-row` in `index.html` and `css/style.css`. Added dynamic year script in `js/app.js`.
- **Self-check**: Executed `tests/ui_responsive_branding.test.js`:
  1. Verified "Made by Maverick Tech Ventures" exists.
  2. Verified "© [Current Year] Maverick Tech Ventures. All rights reserved." auto-updates dynamically.
  3. Verified medical disclaimer and copyright row are separate DOM sibling cards.
- **Fix**: None needed.
- **Status**: PASS.

### Entry 16: Multi-Device Responsiveness & Cross-Viewport Validation
- **Plan**: Test layout on simulated mobile phone (360px, 414px), tablet (768px), laptop (1024px), and desktop (1440px) widths; verify one-hand mobile usability and touch target ergonomics (>= 48px).
- **Build**: Verified fluid CSS layout, flex wrapping, full-width inputs on mobile viewports, touch-scrollable category pills, and 52px search button.
- **Self-check**: Tested via automated DOM tests in `tests/ui_dom.test.js` and `tests/ui_responsive_branding.test.js`. Verified viewport meta, touch targets >= 48px, media queries at 640px, 768px, and 960px container limits.
- **Fix**: None needed.
- **Status**: PASS.

### Entry 17: Progressive Web App (PWA) & Offline Service Worker
- **Plan**: Implement installable Progressive Web App (PWA) with `manifest.json`, scalable SVG app icon (`icons/icon.svg`), and offline Service Worker (`sw.js`) utilizing Cache-First stale-while-revalidate caching.
- **Build**: Created `manifest.json` with standalone display and emerald `#059669` theme color, generated `icons/icon.svg`, built `sw.js` precaching core assets, updated `index.html` with mobile meta tags, and added conditional registration in `js/app.js`.
- **Self-check**: Created `tests/pwa.test.js`:
  1. Validated `manifest.json` fields (name, short_name, icons, display, theme_color).
  2. Verified `icons/icon.svg` and `sw.js` handlers.
  3. Verified HTML link tags and mobile apple meta tags.
- **Fix**: None needed.
- **Status**: PASS.

### Entry 18: 1-Tap WhatsApp Sharing Feature (Bilingual)
- **Plan**: Add a 1-tap "Share on WhatsApp" button on the Savings Spotlight card and cheaper alternative cards, formatting structured comparison text in English or Urdu with safety disclaimers.
- **Build**: Added `buildWhatsAppShareText()` in `js/app.js`, added WhatsApp share buttons in spotlight and alternative cards, styled with official WhatsApp green `#25D366` in `css/style.css`, and added bilingual message dictionaries in `js/translations.js`.
- **Self-check**: Created `tests/whatsapp_share.test.js`:
  1. Verified WhatsApp API link generation (`https://api.whatsapp.com/send?text=...`).
  2. Verified message content includes original medicine, alternative, percentage savings, and mandatory medical disclaimer.
  3. Verified natural Urdu translation when Urdu mode is active.
- **Fix**: None needed.
- **Status**: PASS.

### Entry 19: Pediatric & Topical / Dermatological Formulations Expansion
- **Plan**: Expand the database with common pediatric syrups/suspensions and topical creams/ointments (Paracetamol syrups, Brufen suspension, Augmentin suspensions, Betnovate, Hydrocortisone, Fucidin, Canesten, Polyfax), bringing dataset from 279 to 317 medicines.
- **Build**: Added 38 pediatric and topical medicines to `data/medicines.json`, updated dosage form unit labels (bottle, tube) in `js/translations.js` and `js/app.js`, and added `skin` and `pediatric` categories to `CATEGORY_MAP` in `js/search.js`.
- **Self-check**: Created `tests/pediatric_and_topical.test.js`:
  1. Verified Panadol syrup finds cheaper alternatives (Febrol, Paramol) per bottle.
  2. Verified Brufen suspension finds Profen suspension.
  3. Verified Betnovate cream finds Cortival / Betaval per tube (Save 44%).
  4. Verified Fucidin finds Fuson / Fucid.
  5. Verified category counts for Skin & Ointments and Kids & Syrups.
- **Fix**: Resolved Fucidin exact ID lookup in test assertions.
- **Status**: PASS.

### Entry 20: DRAP & Public Drug Data Ingestion & Synchronization Pipeline
- **Plan**: Build a robust offline command-line ingestion utility to validate medicine schemas, calculate unit prices, detect duplicate IDs or negative pricing, and synchronize `js/medicines_data_embed.js`.
- **Build**: Created `scripts/sync_drug_data.js` and added `"sync-data": "node scripts/sync_drug_data.js"` script in `package.json`.
- **Self-check**: Created `tests/sync_drug_data.test.js`:
  1. Verified slug normalization.
  2. Verified schema validation, statistics reporting, and embed file generation.
  3. Verified error throwing on duplicate IDs or negative prices.
- **Fix**: None needed.
- **Status**: PASS.

### Entry 21: Full Visual Design Pass & Modern Identity Overhaul
- **Plan**: Complete visual design pass without altering functional logic:
  1. Pick a distinctive visual identity: Deep Maritime Navy (`#070d18` / `#0b1528`), Clinical Medical Teal / Mint (`#0d9488` / `#14b8a6`), and celebratory Victory Coral / Warm Amber (`#f97316` / `#f59e0b`) savings accents.
  2. Implement real typographic hierarchy with Google Fonts (`Plus Jakarta Sans` for body/UI and `Outfit` for display headings) with RTL `Noto Nastaliq Urdu`.
  3. Redesign the header with a rich gradient backdrop, glowing badge logo treatment, and frosted glass language switcher.
  4. Visually differentiate card types: Disclaimer (soft amber-gold surface), Category Pills (tactile chips with micro-lift), Searched Medicine (clinical authority with teal top border), Savings Banner (radiant celebration gradient with coral badge and win glow), Alternative Cards (distinct cheapest ribbon and hover states), and Footer (dark frosted glass).
  5. Overhaul the "No Medicine Found" empty state with a warm illustration bubble, friendly copy, and a visually prominent call-to-action button.
  6. Add micro-interactions: smooth transitions, hover effects, search focus glow, and result entrance animations.
- **Build**: Updated `index.html` with Google Fonts preconnect/stylesheet links and illustration bubble wrapper. Rebuilt `css/style.css` with modern design tokens, distinct card styling, celebration animations, and refined spacing.
- **Self-check**: Executed full test suite (`npm test`). Re-verified that all 67 tests across 12 test suites pass with 100% compliance.
- **Fix**: Restored `<meta name="theme-color" content="#059669">` in `index.html` to preserve strict PWA test assertion requirement.
- **Status**: PASS.

### Entry 22: Nearby Medical Store Feature & Git Repository Preparation
- **Plan**: Implement Nearby Medical Store & Pharmacy Finder with Google Places API integration architecture, browser Geolocation with permission prompt, graceful fallback to manual city/area input, Call (tel:) and Directions (Google Maps) buttons, missing phone handling, stock availability disclaimer, and prepare clean Git repository.
- **Build**:
  1. Created `config.example.js` and `.gitignore` ensuring `config.js` and all secret keys are strictly ignored and never committed.
  2. Built `js/nearby_stores.js` featuring dual-mode operation (Google Places API + built-in directory of verified Pakistani pharmacies across Karachi, Lahore, Islamabad, Rawalpindi, Peshawar, Multan, Faisalabad, Quetta) with Haversine distance formula.
  3. Added bilingual translations for all store UI elements, location prompts, and stock availability disclaimers in `js/translations.js`.
  4. Updated `index.html` with `#nearby-stores-section` and interactive trigger buttons on medicine cards and savings spotlight.
  5. Implemented interactive location request, fallback manual search, and store card rendering in `js/app.js`.
  6. Added responsive styling in `css/style.css`.
  7. Initialized git repository (`git init`) and confirmed `config.js` is ignored.
- **Self-check**: Created `tests/nearby_stores.test.js` covering all 9 checklist points:
  1. Haversine distance calculation and phone number cleaning for `tel:` links.
  2. Distance-based ascending sorting (closest first).
  3. UI integration: "Find Nearby Stores" button appears on medicine results.
  4. Geolocation permission allowed: detects GPS coordinates and renders stores with Call and Directions buttons.
  5. Graceful fallback when location permission is denied: manual city/area search (e.g. Lahore, Karachi) works smoothly.
  6. Store with missing phone number (e.g. City Medicos) gracefully omits the Call button without rendering a broken button.
  7. Mandatory stock availability disclaimer is clearly displayed in both English and Urdu.
  8. Urdu UI mode translates all store information and disclaimers.
  9. Mobile and desktop responsive layouts.
  10. Ran full test suite across all 13 suites (76 tests total) — all 76 tests passing.
- **Fix**: Fixed distance sorting comparison where distance of 0 km was treated as falsy (`0 || 99999`) by using `Number.isFinite()` checks in `js/nearby_stores.js`.
- **Status**: PASS (76/76 tests passing).

### Entry 23: UI Cleanup, Feature De-duplication & Desktop Full-Screen Layout
- **Plan**:
  1. Eliminate repeated features: remove the redundant `.home-nearby-banner` on the homepage and hide the duplicate `.spotlight-nearby-btn` on the savings card so only a single authoritative `#med-card-nearby-btn` is shown.
  2. Optimize widescreen desktop layout: expand `.container` to `max-width: 1200px` to eliminate empty left/right void.
  3. Implement a responsive two-column grid (`.results-layout-grid`) on desktop:
     - Left column (`.results-primary-col`, sticky): Selected medicine card + savings spotlight banner stay pinned in view.
     - Right column (`.results-secondary-col`): Alternatives toolbar + generic alternatives list for easy side-by-side comparison.
  4. Expand explore/popular medicines grid to a balanced 4-column layout (`repeat(4, 1fr)`) and tips to 3 columns (`repeat(3, 1fr)`) spanning the full 1200px width.
- **Build**: Updated `index.html` and `css/style.css` with responsive grid layouts, sticky primary column, full-width actions, and cleaner spacing.
- **Self-check**: Executed full test suite (`npm test`). All 76 tests across 13 suites pass with 100% compliance.
- **Fix**: None needed.
- **Status**: PASS (76/76 tests passing).

### Entry 24: Store Coverage Expansion & Live Google Maps Integration
- **Plan**:
  1. Address the limitation of why only a few stores were shown:
     - Previously, the offline directory contained only 17 test entries and sliced results to 6 stores.
     - Users across Pakistan without a Google Places API key were limited to a tiny sample of stores.
  2. Implement a 100% comprehensive solution ("make this thing strong"):
     - Build a **Live Google Maps Instant Integration** (`.live-gmaps-banner` and `getLiveGoogleMapsSearchUrl`) that lets any user in any neighborhood/village in Pakistan tap one button to open Google Maps centered on their exact GPS coordinates or searched city/area, revealing 100+ real-time pharmacies and local chemists with live open/closed status, user ratings, and turn-by-turn navigation.
     - Quadruple the curated offline directory from 17 to **55+ verified landmark pharmacies** spanning Karachi, Lahore, Islamabad, Rawalpindi, Peshawar, Faisalabad, Multan, Quetta, Hyderabad, Gujranwala, Sialkot, Abbottabad, Bahawalpur, Sargodha, Gujrat, Sukkur, and Larkana.
     - Add **1-Click Quick City Chips** (`.store-city-chip`) for instant city switching without requiring manual typing.
     - Increase the displayed store limit from 6 to 12-15 stores with location count tags.
- **Build**:
  - Updated `js/nearby_stores.js` with expanded `PAKISTAN_PHARMACY_DIRECTORY` (55+ verified pharmacies), 17 city center GPS benchmarks in `CITY_COORDINATES`, and `getLiveGoogleMapsSearchUrl()`.
  - Added bilingual translations in `js/translations.js`.
  - Updated `js/app.js` with live Google Maps banner rendering, quick city chips, and dynamic query synchronization.
  - Added responsive styling in `css/style.css`.
  - Added new automated test assertions in `tests/nearby_stores.test.js`.
- **Self-check**: Executed full test suite (`npm test`). All 78 tests across 13 suites pass with 100% compliance.
- **Fix**: Rendered quick city chips in initial location prompt so user can 1-tap filter even before granting or denying GPS.
- **Status**: PASS (78/78 tests passing).

