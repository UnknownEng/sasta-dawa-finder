# Engineering Rules & Standards (RULES.md) — Antigracity

## 1. Core Principles
1. **Preserve Documentation & Code Integrity**: Maintain all existing comments, docstrings, and architectural invariants unless explicitly instructed to refactor.
2. **Zero Breaking Regressions**: `npm test` must pass 100% of test suites with zero failures at every stage of development.
3. **Vanilla & Dependency-Light**: Prioritize modern standard Web APIs (HTML5, CSS3, ES2022+) over external dependencies to ensure minimal bundle size and instantaneous loading (<2s).

---

## 2. HTML & Semantic DOM Standards
- **Single `<h1>` Tag**: Exactly one `<h1>` element must exist per page. Sub-sections must strictly follow hierarchical ordering (`<h2>`, `<h3>`, `<h4>`).
- **Semantic Landmarks**: Structure pages using `<header>`, `<nav>`, `<main>`, `<section>`, `<article>`, `<aside>`, and `<footer>`. Avoid `<div>` soup.
- **Valid ARIA & Accessibility (a11y)**:
  - All interactive elements must be focusable with visible `:focus-visible` outlines.
  - Buttons must possess descriptive accessible names or `aria-label` attributes.
  - Form inputs must have matching `<label>` elements or `aria-label`.
  - All `<img>` tags must include explicit, descriptive `alt` attributes (empty `alt=""` only for decorative icons marked with `aria-hidden="true"`).
- **Layout Shift Prevention**:
  - Always specify explicit `width` and `height` (or CSS `aspect-ratio`) on images, SVGs, and iframe embeds.

---

## 3. CSS & Responsive Design Standards
- **Zero Horizontal Scrolling**: Viewports down to 320px must NEVER produce horizontal scrollbars (`overflow-x: hidden` on viewport roots, box-sizing: border-box universally, and flexible media).
- **Mobile Touch Targets**: All interactive elements (buttons, links, pills, inputs) must maintain a minimum touch target size of 44x44px.
- **RTL & Logical Properties**: Write CSS using logical properties (`margin-inline-start`, `padding-inline-end`, `inset-inline`) to support seamless English (LTR) and Urdu (RTL) mode switching without duplicated style definitions.
- **Mobile Overflow Containment**: Tables, code snippets, and cards must use controlled internal scroll or responsive wrap (`overflow-x: auto; -webkit-overflow-scrolling: touch; max-width: 100%`).

---

## 4. JavaScript & Client Engineering Standards
- **Safe DOM Manipulation**:
  - Never inject unsanitized user input into `innerHTML`.
  - Use `textContent`, `setAttribute`, or explicit DOM node construction (`document.createElement`) to prevent Cross-Site Scripting (XSS).
- **Error Handling & Resiliency**:
  - Every asynchronous operation (`fetch`, `navigator.geolocation`) must have explicit `try...catch` or `.catch()` rejection handling.
  - Display clear, non-technical error notifications and success toasts to the user.
- **Progressive Enhancement**:
  - The application must load and render meaningful content even if geolocation is denied, external fonts fail, or JavaScript executes with delay.

---

## 5. Technical SEO & Performance Standards
- **Crawlability & Indexing**:
  - Never block critical resources or bots in `robots.txt` (`Googlebot` must be unblocked).
  - Include `<meta name="robots" content="index, follow">` on canonical indexable pages.
  - Include `<meta name="robots" content="noindex, follow">` on search query parameters, staging pages, and 404 pages.
- **Canonical URLs**:
  - Every page must feature an absolute self-referencing canonical tag:
    `<link rel="canonical" href="https://antigracity.pk/...">`.
- **Meta Descriptions**:
  - Unique, compelling meta descriptions between 140–160 characters per page incorporating relevant primary keywords.
- **Page Titles**:
  - Clear format: `Primary Keyword | Brand Name` (within 50–60 characters).
- **Structured Data**:
  - Validate JSON-LD schemas against Schema.org standards (`FAQPage`, `BreadcrumbList`, `MedicalWebPage`).
- **HTTP Status Codes & Redirects**:
  - Avoid redirect chains (0 intermediate hops).
  - Broken routes must return HTTP 404 with a helpful custom error page linking back to primary hubs.
- **Image Optimization**:
  - Serve modern WebP images with responsive sizing.

---

## 6. Testing & Quality Assurance
- Run `npm test` before any commit.
- Write new unit tests when adding functional modules (e.g., SSR handlers, 404 routing, mobile drawer navigation).
