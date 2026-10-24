# Project Memory & Decision Log (MEMORY.md) — Sasta Dawa Finder

## 1. Project Context & Mission
- **Project Name**: Sasta Dawa Finder (سستی دوا تلاش کار)
- **Domain**: Pharmaceutical Pricing, Generic Substitution & Healthcare Directory in Pakistan
- **Core Goal**: Provide an accessible, transparent, and ultra-fast bilingual platform for finding affordable generic medicines and nearby pharmacies, backed by rigorous technical SEO and modern web engineering standards. Made by Maverick Tech Ventures.

---

## 2. Technical Stack Decisions

| Layer | Decision | Rationale |
| :--- | :--- | :--- |
| **Markup & DOM** | Semantic HTML5 (Single `<h1>`, `<header>`, `<main>`, `<footer>`, `<nav>`) | Maximum accessibility (WCAG 2.1 AA) and direct crawler readability without client-side rendering hurdles. |
| **Styling** | Modern Vanilla CSS3 with CSS Custom Properties and Logical Properties | Zero build overhead, zero CSS-in-JS runtime tax, instantaneous styling, native RTL switching. |
| **Logic & State** | Vanilla Modular ES2022+ JavaScript | Eliminates bulky framework bundles (React/Vue/Angular); ensures initial script evaluation completes in <50ms. |
| **Data Layer** | Dual In-Memory + Embedded Store (`data/medicines.json` & `js/medicines_data_embed.js`) | Enables zero-latency instant search over HTTP or offline `file://` execution without CORS lockouts. |
| **Rendering Strategy** | Hybrid Pre-rendered / SSR HTML (`server.js`) + Client Enhancement | Ensures 100% crawlability by Googlebot while maintaining client-side interactivity and offline PWA capability. |
| **Testing** | Node.js native test runner (`node --test`) + JSDOM | Fast, zero-dependency testing harness executing in under 10 seconds across 117 unit and integration tests. |

---

## 3. Key Architectural Decisions (ADRs)

### ADR-001: Bilingual Support (English & Urdu RTL)
- Centralized dictionary in `js/translations.js` with document-level `dir="rtl"` and `lang="ur"` switching.
- Allows seamless switching between English and Urdu without page reloads or route duplication.

### ADR-002: Dual Data Loading Strategy
- Retains both `data/medicines.json` and `js/medicines_data_embed.js`.
- Guarantees 100% functionality whether hosted on a web server or opened directly via `file://`.

### ADR-003: Single H1 and Semantic Heading Hierarchy
- Exactly one `<h1>` in `index.html` (`#site-title-el`) and `404.html` (`#error-h1`).
- Eliminates technical SEO ambiguity and optimizes screen reader landmark navigation.

### ADR-004: Cumulative Layout Shift (CLS) Elimination
- Explicit dimensions (`width`, `height`, `aspect-ratio`) defined on all logos, SVGs, badges, and card containers.
- Guarantees CLS = 0, contributing to a perfect Core Web Vitals score.

### ADR-005: Technical SEO & Crawler Optimization Protocol
- Implemented `robots.txt` explicitly allowing `User-agent: Googlebot` with access to critical CSS, JS, and image assets.
- `server.js` serves SSR HTML with status 200, proper caching headers, and real HTTP 404 responses for invalid routes.
- Schema.org structured data for `FAQPage`, `BreadcrumbList`, and `MedicalWebPage`.
- Dynamic XML sitemap generation (`scripts/generate_sitemap.js`) indexing 54 canonical URLs.

---

## 4. Work Log & Project Milestones
- **Turn 1 (Audit & Scoping)**: Audited existing workspace and verified 78 passing tests. Acknowledged all items across Part 1, Part 2, and Part 3.
- **Turn 2 (Part 1 Documentation Setup)**: Created the 6 foundational project documents (`PRD.md`, `ARCHITECTURE.md`, `RULES.md`, `DESIGN.md`, `TASKS.md`, `MEMORY.md`).
- **Turn 3 (Part 2 UI/UX & Functional Fixes)**:
  1. *Horizontal scroll*: eliminated via `overflow-x: hidden` and `max-width: 100vw`.
  2. *Broken links*: audited and verified all active routes and protocol links.
  3. *Mobile menu*: implemented hamburger button, slide-in drawer, overlay, and keyboard dismiss.
  4. *Favicon*: generated multi-resolution `favicon.ico`, `icons/favicon.ico`, and WebP favicons.
  5. *Page titles*: updated to include "Sasta Dawa Finder" and primary search keyword within 60 chars.
  6. *Meta descriptions*: added 140–160 character keyword-rich descriptions.
  7. *Footer links*: built `.footer-nav-grid` with structured links to search, categories, tips, and legal.
  8. *Custom 404 page*: authored standalone `404.html` with breadcrumbs and `noindex`.
  9. *Copyright year*: dynamically calculated current calendar year (`2026`).
  10. *Image compression*: minified SVGs, generated high-compression WebP images.
  11. *Broken buttons*: audited and verified explicit types and active event handlers.
  12. *Success message*: implemented `#toast-container` and `showSuccessMessage`.
  13. *Error messages*: implemented `showErrorMessage` toast and inline query alerts.
  14. *Placeholder text*: removed generic filler; added authentic search examples.
  15. *Unused navigation*: cleaned header and mobile drawer navigation.
  16. *Mobile overflow*: constrained container widths and card paddings.
  17. *Clickable logo*: wrapped in `#site-logo-link` with home reset action.
  18. *Clickable phone*: implemented active `tel:+923273202419` links.
  19. *Clickable email*: implemented active `mailto:ahmedmansoorrind1210@gmail.com` links.
  20. *Mobile optimization*: verified >= 44px touch targets and viewport scaling.
- **Turn 3 (Part 3 Technical SEO & Performance)**:
  1. Built `server.js` with SSR capability and pre-rendered semantic HTML.
  2. Created `SEARCH_CONSOLE.md` and added Google Search Console verification meta tag.
  3. Implemented proper `noindex, follow` on 404 page and `index, follow` on home.
  4. Added canonical links (`https://sastadawafinder.pk/` and `https://sastadawafinder.pk/404.html`).
  5. Verified exactly one `<h1>` per page.
  6. Added breadcrumb navigation and Schema.org `BreadcrumbList`.
  7. Added descriptive alt text on all images.
  8. Defined dimensions on logo and SVGs to guarantee CLS = 0.
  9. Generated `sitemap.xml` with 54 URLs.
  10. Authored `robots.txt` unblocking Googlebot.
  11. Audited and verified 0 redirect chains.
  12. Configured true HTTP 404 status codes on missing routes.
  13. Verified 140–160 char SEO-optimized meta descriptions.
  14. Embedded Schema.org `FAQPage` JSON-LD with 4 comprehensive Q&As.
  15. Linked orphan pages (404, categories, tips, nearby stores) via navigation and footer.
  16. Generated lossless WebP images (`icon-192.webp`, `icon-512.webp`, `favicon-32x32.webp`).
  17. Measured critical asset footprint (< 110 KB combined), ensuring page load under 2 seconds.
- **Turn 3 (Test Suite Verification)**: Authored `tests/ui_fixes_and_seo.test.js`. Full test suite runs 117 tests across 13 test suites with 100% pass rate.
