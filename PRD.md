# Product Requirements Document (PRD) — Antigracity

## 1. Project Overview & Vision
**Antigracity** (incorporating Sasta Dawa Finder / سستی دوا تلاش کار) is a modern, high-performance, mobile-first web platform designed to empower healthcare consumers, patients, caregivers, and pharmacists across Pakistan. The platform provides instant access to verified medicine pricing, active pharmaceutical ingredients (salt formulas), cheaper generic alternatives, and local pharmacy directories, while adhering to the highest standards of technical SEO, accessibility (a11y), and web performance.

---

## 2. Problem Statement
In developing healthcare markets, medicine costs fluctuate significantly, and branded medications often carry a 40%–80% price premium over bioequivalent generic alternatives with identical chemical compositions. Patients frequently lack transparent pricing data, awareness of generic substitutes, and quick access to nearby open pharmacies. Furthermore, many existing health resources suffer from poor mobile optimization, slow load times, lack of technical SEO, and missing local language (Urdu) support.

---

## 3. Goals & Success Metrics
- **Core Value Proposition**: Allow any user to type a brand name or formula and instantly discover cheaper bioequivalent alternatives with transparent per-unit savings.
- **Performance**: Site must load under 2.0 seconds on standard 3G/4G mobile connections with Largest Contentful Paint (LCP) < 1.8s, First Input Delay (FID) / INP < 100ms, and Cumulative Layout Shift (CLS) = 0.
- **Mobile Experience**: 100% mobile-optimized layout with zero horizontal overflow, touch targets >= 44x44px, and full offline/PWA capability.
- **Accessibility & Localization**: Full WCAG 2.1 AA compliance with seamless English and native Pakistani Urdu (RTL) localization.
- **Technical SEO**: 100% search engine indexability, verified canonicalization, server-side pre-rendering, XML sitemaps, structured schema markup (FAQ, MedicalEntity, Breadcrumbs), and zero broken links.

---

## 4. User Personas
1. **Caregiver / Chronic Disease Patient (Tariq, 52, Lahore)**: Manages ongoing monthly prescriptions for hypertension and diabetes; needs to identify trusted generic brands that reduce household medical expenses without compromising efficacy.
2. **Acute Care Consumer (Ayesha, 28, Karachi)**: Searching on mobile for fever or antibiotic formulations; requires quick price checks, WhatsApp sharing for family consultation, and direct contact with nearby pharmacies.
3. **Retail Pharmacist / Healthcare Worker (Hamza, 34, Rawalpindi)**: Uses the tool as a rapid reference desk to verify generic equivalents registered with the Drug Regulatory Authority of Pakistan (DRAP).

---

## 5. Functional Requirements

### 5.1 Search & Autocomplete
- **FR-1.1**: Real-time fuzzy prefix search matching brand names, generic active salts, and strengths.
- **FR-1.2**: Interactive suggestion dropdown with complete keyboard navigation (`Up`, `Down`, `Enter`, `Escape`).
- **FR-1.3**: Robust input sanitization preventing script injection or crash on special characters.
- **FR-1.4**: Bidirectional synonym resolution (e.g., Metamizole ↔ Novaminsulfon, Rivotril ↔ Clonazepam).

### 5.2 Category Filtering & Exploration
- **FR-2.1**: Curated category pills with live medicine counts:
  - Pain & Fever (*درد اور بخار*)
  - Stomach & Acidity / PPI (*معدہ اور تیزابیت*)
  - Antibiotics (*اینٹی بائیوٹکس*)
  - Blood Pressure & Heart (*بلڈ پریشر اور دل*)
  - Diabetes / Sugar (*شوگر و ذیابیطس*)
  - Allergy & Cold (*الرجی اور نزلہ زکام*)
  - Skin & Ointments (*جلد اور مرہم*)
  - Kids & Syrups (*بچوں کے سیرپ*)
- **FR-2.2**: 1-click filtering that repopulates search results with top medications in the selected category.

### 5.3 Generic Alternative Matching & Savings Calculator
- **FR-3.1**: Grouping by unique `salt_group_id` matching chemical formula, dosage form, and strength.
- **FR-3.2**: Prominent **Savings Spotlight** highlighting maximum percentage savings and absolute PKR difference compared to the reference brand.
- **FR-3.3**: Transparent breakdown of unit price (per tablet, capsule, or ml) and full pack price.
- **FR-3.4**: Graceful handling of zero-alternative proprietary formulations with clear patient guidance.

### 5.4 Multi-Criteria Sorting
- **FR-4.1**: User-selectable sorting orders:
  - Cheapest First (`price_asc` — default recommended)
  - Highest Savings % (`savings_desc`)
  - Price: High to Low (`price_desc`)
  - Brand Name: A to Z (`name_asc`)

### 5.5 Nearby Pharmacy & Medical Store Locator
- **FR-5.1**: Geolocation detection via HTML5 Geolocation API with distance calculation using the Haversine formula.
- **FR-5.2**: Manual city and area selector fallback when location permissions are denied.
- **FR-5.3**: Clickable telephone links (`tel:`) and live Google Maps directions links for each pharmacy.

### 5.6 Social Sharing & Collaboration
- **FR-6.1**: 1-tap WhatsApp sharing generating localized formatted comparison summaries with mandatory safety disclaimers.

### 5.7 Internationalization (English & Urdu RTL)
- **FR-7.1**: Instant UI toggle switching language and text direction (`ltr` vs `rtl`).
- **FR-7.2**: Complete dictionary translation for all buttons, disclaimers, badges, and medical units.

---

## 6. Non-Functional & Technical SEO Requirements
- **NFR-1 (SSR / Pre-rendering)**: Core pages and medicine detail views rendered server-side/pre-rendered to ensure fast TTFB and crawler discoverability.
- **NFR-2 (Meta & Canonical)**: Every page must specify a descriptive `<title>`, an SEO-optimized meta description (150–160 chars), and a self-referential `<link rel="canonical">`.
- **NFR-3 (Heading Structure)**: Exactly one `<h1>` per page reflecting the primary topic.
- **NFR-4 (Structured Data)**: JSON-LD schemas for `FAQPage`, `BreadcrumbList`, and `MedicalWebPage`.
- **NFR-5 (Robots & Sitemaps)**: Search engines unblocked via `robots.txt`, XML sitemap generated dynamically or statically, proper HTTP 404 status codes.
- **NFR-6 (Image Optimization)**: Next-gen formats (WebP), lossless compression, explicit `width` and `height` dimensions, and descriptive `alt` tags.
- **NFR-7 (Zero Breakage)**: All existing automated tests (`npm test`) must pass at all times.
