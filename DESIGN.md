# Design System & UI Guidelines (DESIGN.md) — Sasta Dawa Finder

## 1. Brand Identity & Design Principles
- **Clarity & Trust**: Medical decisions require utmost clarity, high legibility, and objective presentation without aggressive marketing distractions.
- **Speed & Frictionless UX**: Zero bloat, immediate autocomplete response, and thumb-friendly touch targets.
- **Bilingual Inclusivity**: Equal aesthetic priority for both English and Urdu typography and layouts.

---

## 2. Color Palette & Design Tokens

### Primary & Semantic Colors
- `--color-primary-600`: `#0f766e` (Deep Emerald Teal — Primary Brand)
- `--color-primary-700`: `#115e59` (Dark Teal — Hover & Active states)
- `--color-primary-50`: `#f0fdfa` (Light Mint Teal — Accent backgrounds)
- `--color-accent`: `#0284c7` (Ocean Blue — Interactive links and info chips)
- `--color-accent-subtle`: `#e0f2fe` (Subtle Ice Blue)

### Feedback & Status Colors
- `--color-success`: `#16a34a` (Vibrant Green — Savings, Success banners)
- `--color-success-bg`: `#f0fdf4` (Soft Green background)
- `--color-warning`: `#d97706` (Amber — Estimate notices, Cautionary advice)
- `--color-warning-bg`: `#fffbeb` (Soft Amber background)
- `--color-danger`: `#dc2626` (Red — Medical disclaimers, Error toasts)
- `--color-danger-bg`: `#fef2f2` (Soft Red background)

### Neutral & Surface Grayscale
- `--color-bg-app`: `#f8fafc` (Slate 50 — Page Background)
- `--color-surface`: `#ffffff` (Pure White Card / Modal Surfaces)
- `--color-surface-hover`: `#f1f5f9` (Slate 100)
- `--color-border`: `#e2e8f0` (Slate 200 — Subdued borders)
- `--color-text-primary`: `#0f172a` (Slate 900 — Maximum contrast copy)
- `--color-text-secondary`: `#475569` (Slate 600 — Metadata, labels)
- `--color-text-muted`: `#94a3b8` (Slate 400 — Placeholders, secondary icons)

---

## 3. Typography Scale & Fonts

### Font Families
- **System Sans (English)**: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`
- **Urdu System Sans (RTL)**: `"Noto Nastaliq Urdu", "Jameel Noori Nastaleeq", "Urdu Typesetting", "Arial Unicode MS", Tahoma, sans-serif`
- **Monospace (Formulas/Dosages)**: `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`

### Typography Scale
| Token | Font Size | Line Height | Weight | Usage |
| :--- | :--- | :--- | :--- | :--- |
| `text-xs` | 0.75rem (12px) | 1.0rem (16px) | 400 / 500 | Badges, timestamps, small tags |
| `text-sm` | 0.875rem (14px) | 1.25rem (20px) | 400 / 500 | Body secondary, disclaimers, buttons |
| `text-base` | 1.0rem (16px) | 1.5rem (24px) | 400 / 500 | Body primary copy, search inputs |
| `text-lg` | 1.125rem (18px) | 1.75rem (28px) | 600 | Card titles, pharmacy headers |
| `text-xl` | 1.25rem (20px) | 1.75rem (28px) | 700 | Subsection headers (`<h3>`) |
| `text-2xl` | 1.5rem (24px) | 2.0rem (32px) | 700 | Section headers (`<h2>`) |
| `text-3xl` | 1.875rem (30px) | 2.25rem (36px) | 800 | Main Page Heading (`<h1>`) |

---

## 4. Spacing, Elevation & Radii
- **Grid Baseline**: 4px / 8px spacing steps (`0.25rem`, `0.5rem`, `0.75rem`, `1.0rem`, `1.5rem`, `2.0rem`, `3.0rem`).
- **Border Radii**:
  - `rounded-sm`: 4px (inputs, badges)
  - `rounded-md`: 8px (standard cards, buttons)
  - `rounded-lg`: 12px (modals, spotlight cards)
  - `rounded-full`: 9999px (category pills, circular action buttons)
- **Shadows**:
  - Subtle Elevation: `0 1px 3px 0 rgba(0, 0, 0, 0.05), 0 1px 2px 0 rgba(0, 0, 0, 0.03)`
  - Card Elevation: `0 4px 6px -1px rgba(0, 0, 0, 0.07), 0 2px 4px -1px rgba(0, 0, 0, 0.04)`
  - Elevated Modal / Drawer: `0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)`

---

## 5. UI Component Guidelines

### 5.1 Global Header & Navigation
- **Clickable Logo**: Links to root (`/`). Displays the brand icon and title "Sasta Dawa Finder" with accessible home navigation.
- **Mobile Menu (Hamburger)**:
  - Appears on viewports < 768px.
  - Slide-in responsive drawer or expandable overlay.
  - Keyboard accessible (`Esc` to close, trap focus while open).
  - ARIA attributes: `aria-expanded`, `aria-controls="mobile-nav"`.
- **Language Switcher**: Prominent pill toggle between English and Urdu with live aria updates.

### 5.2 Search & Input Bar
- High-visibility input box with minimum height of 48px.
- Clear search button (`×`) when text is entered.
- Real-time dropdown list with keyboard highlight (`.is-selected`).
- No generic placeholder text — specific, helpful placeholder (`e.g., Panadol, Paracetamol, Omeprazole`).

### 5.3 Feedback Notifications (Toasts)
- **Success Message**: Top-right / bottom-center animated toast with green accent, check icon, and auto-dismiss after 4s.
- **Error Message**: Prominent red toast or banner with clear, helpful guidance and retry action.

### 5.4 Medicine Card & Savings Spotlight
- Reference medicine card clearly distinguishable from generic alternatives.
- Highlight percentage savings in bold green badge.
- Explicit comparison of unit price (per tablet) and total pack price.

### 5.5 Footer & Contact Elements
- Clickable telephone link: `tel:+923273202419` (+92 327 3202419) with clear call icon.
- Clickable email link: `mailto:ahmedmansoorrind1210@gmail.com`.
- Valid footer links (Home, Categories, Disclaimers, Privacy Policy, Terms).
- Developer credit: "Made by Maverick Tech Ventures".
- Dynamic current year copyright (`© <Dynamic Year> Maverick Tech Ventures. All rights reserved.`).

### 5.6 404 Error Page
- Clear, empathetic error message indicating the page was not found.
- Immediate search input or 1-click return to Home button.
- Clean layout consistent with the global header and footer.
