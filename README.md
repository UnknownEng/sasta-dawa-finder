# Sasta Dawa Finder (سستی دوا) 🇵🇰

**Official medicine prices for Pakistan — and cheaper brands with the exact same formula.**

Type a brand (e.g. *Panadol*, *Augmentin*, *Risek*) or a salt (*paracetamol*, *omeprazole*). Sasta Dawa Finder shows the
government-notified maximum retail price (MRP), the price per tablet, and every other DRAP-registered brand with the same
active ingredients, strength and dosage form, cheapest first.

---

## What's new in v2

| | v1 | v2 |
|---|---|---|
| **Data** | 317 hand-typed entries, estimated prices | **~20,000 products from DRAP's official Pharmaceutical Product Price Index**, with registration numbers and the date each price took effect |
| **Matching** | manual `salt_group_id` | automatic: ingredients + strength + form + release type (extended-release is never mixed with normal tablets), typo-tolerant ingredient names |
| **Chat** | — | **Dawa Assistant**: understands English, Urdu and Roman Urdu (*"panadol ka sasta option"*), voice input, medicine cards, works offline; optional AI mode (Claude) grounded in the same data |
| **New** | — | **My Medicines** monthly-cost planner with one-tap switch to the cheapest brand, recently viewed, dark mode, mobile bottom nav, WhatsApp share of your list, printable list |
| **Removed** | hardcoded pharmacy directory, header contact bar, nav drawer, breadcrumb, duplicate disclaimers, 6,400-line embedded data bundle | replaced by a single "Pharmacies near me" (Google Maps) button and a clean footer |

## Features

- **Fast search** with autocomplete, keyboard navigation, "did you mean" for misspellings, synonyms (acetaminophen → paracetamol) and voice search.
- **Medicine page**: formula, pack price, price per tablet/ml/gram, manufacturer, DRAP registration number, price date, savings banner,
  all same-formula brands with a price bar, and other strengths/forms of the same salt.
- **Safety cues**: a warning on medicines where brand switching needs a doctor (levothyroxine, warfarin, anti-epileptics, lithium, …),
  emergency numbers (Rescue 1122, Edhi 115) in the footer and the assistant.
- **Browse by health need**: 15 categories, each listing formulas with brand counts and price ranges, filterable by name and form.
- **My Medicines**: add what you buy every month, set tablets per day, see monthly cost now vs. with the cheapest brands, and the yearly saving.
- **Dawa Assistant** (bottom-right button):
  - *"Risek 40 ki qeemat"*, *"cheaper alternative to Augmentin"*, *"Panadol vs Calpol"*, *"formula of Brufen"*, *"add Concor to my medicines"*.
  - Never gives dose or diagnosis advice; emergency messages get Rescue 1122 / Edhi 115 immediately.
- **English / اردو** with full right-to-left layout, **dark mode**, installable **PWA** that works offline.

## Run it

```bash
npm install
npm start            # http://localhost:3000
```

Any static server also works (e.g. `python3 -m http.server 3000`), but `npm start` adds gzip (the dataset is ~3 MB raw,
~0.5 MB gzipped) and the optional AI chat endpoint.

### Turn on AI answers in the assistant (optional)

The assistant works without any key using its built-in offline engine. To let it answer free-form questions with Claude:

```bash
ANTHROPIC_API_KEY=sk-ant-... npm start
```

- Claude only sees what its two tools return (`search_medicines`, `get_alternatives`), which query the same DRAP dataset, so prices come from data, not memory.
- Model defaults to `claude-opus-5-5`; set `CHAT_MODEL` to change it (e.g. `claude-haiku-5-5` costs much less per message).
- `CHAT_RATE_LIMIT` (default 30 messages per IP per 10 minutes) limits abuse.
- If the API is unavailable, the browser silently falls back to the offline assistant.

## Admin panel

A hidden, password-protected admin panel lives at **`/unonenginerrunon`**. It is not linked anywhere on the site, is not in
`robots.txt` or the sitemap, and is sent with `noindex` headers. The hidden address is only a convenience: the password is
what protects it.

- **Overview**: medicine count, price date, AI status, open visitor reports.
- **Inbox**: reports visitors send from the site ("Report a wrong price" on every medicine page, "Ask us to add it" when a
  search finds nothing, "Send a suggestion" in the footer). Mark done or delete.
- **Price fixes**: search any medicine and set the correct pack price or hide it. Fixes apply on top of the DRAP data for
  every visitor (and the AI assistant) within about a minute, and survive the next DRAP data update.
- **Site settings**: announcement banner (English/Urdu, three styles), AI answers on/off, the quick-search buttons, and the
  footer contact details.

Set the password with the `ADMIN_PASSWORD` environment variable (8+ characters). Changing it signs everyone out.
Sessions are signed, HttpOnly, SameSite=Strict cookies that last 12 hours; sign-in attempts are rate-limited.

```bash
ADMIN_PASSWORD='choose-a-long-password' npm start   # then open http://localhost:3000/unonenginerrunon
```

Locally, settings and reports are saved in `.data/` (git-ignored). On Vercel they are saved in a private Vercel Blob store.

## Deploy on Vercel

The repo is ready for Vercel with no framework: `vercel.json` runs `scripts/build_public.js`, which copies only the website
files into `public/` (server code, scripts, tests and docs are never published), and `api/*.js` become serverless functions.

1. Import the GitHub repo in Vercel (no settings to change).
2. Add environment variables: `ADMIN_PASSWORD` (required for the admin panel) and optionally `ANTHROPIC_API_KEY` (AI answers).
3. Create a **private** Blob store under Storage and connect it to the project (this adds `BLOB_READ_WRITE_TOKEN`).
4. Every `git push` to `main` deploys automatically.

## Update the prices

```bash
npm run sync-data     # downloads DRAP's price index (~1,100 pages, ~1 request/sec) and rebuilds data/medicines.json
npm run build-data    # rebuild from the cached pages in .cache/drap without downloading
```

The pipeline (`scripts/sync_drap.js` + `scripts/drap_normalize.js`):

1. Parses each DRAP row: product, composition, registration no., manufacturer, pack, price, effective date.
2. Extracts ingredients and strengths from free-text compositions (handles "Each tablet contains…", "eq. to", dot leaders, `g`→`mg`, per-5ml syrups).
3. Fixes common misspellings by matching rare spellings to frequent ones ("ceftrixone" → ceftriaxone), with a guard list of real look-alike drugs.
4. Detects dosage form and extended-release, parses pack sizes, computes price per unit.
5. Groups only exact matches and removes pack-parsing outliers so savings are never exaggerated.
6. Writes a compact columnar JSON.

## Tests

```bash
npm test
```

68 tests cover the normalizer, DRAP HTML parsing, search/alternatives/savings, the assistant (intents in English, Urdu and Roman Urdu,
emergency and advice refusals), the server (gzip, blocked paths, chat validation, the tool loop with a mocked client), the
DOM (routing, autocomplete, My Medicines math, Urdu RTL, HTML escaping, theme switch, report form), the admin panel (sign-in,
sessions, settings, price fixes, inbox, blocked paths), the Vercel build output and the integrity of the shipped dataset.

## Project structure

```
index.html              Single-page app
css/style.css           Design system (light/dark, RTL, print)
js/i18n.js              English / Urdu strings
js/data.js              Loads & expands data/medicines.json (browser + Node)
js/search.js            Search, alternatives, savings, entity extraction (browser + Node)
js/assistant.js         Dawa Assistant: offline brain + chat UI
js/app.js               Routing, views, My Medicines
server.js               Local static server (npm start); routes /api/* to lib/api.js
api/*.js                Vercel functions (thin wrappers around lib/api.js)
lib/api.js              API routes: health, chat, config, feedback, admin
lib/chat.js             Dawa Assistant AI mode (Claude tool use over the dataset)
lib/auth.js             Admin password check and signed session cookies
lib/config.js           Site settings (announcement, price fixes, contact)
lib/store.js            JSON storage: Vercel Blob (private) or local .data/
unonenginerrunon/       Hidden admin panel
scripts/build_public.js Vercel build: copies the public website into public/
vercel.json             Vercel build, headers, functions
sw.js                   Offline service worker
scripts/sync_drap.js    DRAP download & dataset build
scripts/drap_normalize.js  Composition / pack / form normalization
data/medicines.json     Generated dataset
tests/                  node:test suites
```

## Disclaimer

Prices are DRAP-notified maximum retail prices and can change; pharmacies may sell for less. This website does not give
medical advice. Always confirm with a licensed pharmacist or doctor before switching or stopping a medicine.

Made by Maverick Tech Ventures.
