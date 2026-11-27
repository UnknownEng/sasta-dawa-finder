# Round 4 plan: 2FA, two apps, last login, CSV imports, input security, legal, backups, voice

This is the shared contract for three parallel workstreams. **Server** owns `lib/`, `api/`, `server.js`, `vercel.json` and server tests. **Web** owns `unonenginerrunon/*`, `js/account.js`, `account.html`, `css/account.css`, the legal pages and web UI tests. **Apps** owns `android/`, `capacitor*.json`, `scripts/build_app*.js`, `js/native.js`, `package.json` deps for Capacitor plugins, and `.github/workflows/*`. `js/app.js`, `index.html` and `js/i18n.js` belong to **Apps**, which may only make minimal app-only changes there. Do NOT run git commands.

## 1. Admin 2FA (TOTP, RFC 6238, works with Google Authenticator)
- Store: `secrets/admin-2fa.json` = `{ enabled, secret (base32, 20 random bytes), recoveryHashes:[sha256], enabledAt }`.
- `POST /api/admin?a=login {password, code?}`:
  - If 2FA is enabled and there is no valid code, return 401 `{ need2fa: true, error: 'Enter the 6-digit code from Google Authenticator' }`.
  - The code is a TOTP (±1 time step, never reused: remember the last used counter) or one of the 10 recovery codes (each single-use).
  - Count failed attempts like password failures.
- `GET a=2fa-status` → `{ enabled }` (authed).
- `POST a=2fa-setup` (authed) → `{ secret, otpauth: 'otpauth://totp/Sasta%20Dawa%20Admin?secret=...&issuer=Sasta%20Dawa' }`. This makes a pending secret and does not enable yet.
- `POST a=2fa-enable {code}` → `{ enabled: true, recoveryCodes: [10 codes, shown once] }`.
- `POST a=2fa-disable {code}` (TOTP or recovery code required).
- Changing `ADMIN_PASSWORD` does not disable 2FA.
- **Emergency off switch:** env `ADMIN_2FA_RESET=1` makes the server ignore and delete the 2FA record. Document this in the admin UI help.

## 2. Last login method
- On every successful password, Google or app-code login, set:
  - `user.lastLogin = { method: 'password'|'google'|'app', at, ua: short device label }`
  - `user.prevLogin = <the previous lastLogin>`
- `publicUser` exposes `lastLogin` and `prevLogin` (method, at, device).
- The browser stores `localStorage.sd_last_method` so the login screen can say "Last time you used Google".

## 3. Login handoff from the browser to the apps (Google login inside apps)
- The app opens `https://sasta-dawa-finder.vercel.app/account?app=customer` (or `app=business`) in the system browser.
- After a successful login there, the web page calls `POST /api/account?a=app-code` (Bearer) → `{ code }`.
  - The code is random, 32 hex characters, stored at `appcodes/<sha>.json` with `{ uid, exp: 5 min, app }`, single use.
  - The page then goes to `sastadawa://auth?code=...` (customer) or `sastadawabiz://auth?code=...` (business).
- The app catches the deep link (`@capacitor/app` `appUrlOpen`) and calls `POST /api/account?a=app-exchange {code}` → `{ token, user }`. This counts as login method `'google'` or `'password'`, whichever was used in the browser (store `via` in the code record).

## 4. Terms acceptance
- Signup and first-time Google signup require `acceptTerms: true`, otherwise 400.
- Store `user.termsAcceptedAt` and `user.termsVersion = '2026-11-27'`.
- `publicUser` exposes `termsVersion`.

## 5. Data export, backups, restore
- `GET /api/account?a=export` (Bearer) → JSON download of everything about the user:
  - the user record without password hash, salt or 2FA fields;
  - their pharmacies, reservations, refills, payments, stats;
  - their company, if they own one.
- Admin:
  - `GET a=backup` → full backup JSON of all store keys, except `secrets/` (the admin downloads it).
  - `POST a=restore {backup, mode:'merge'|'replace-keys'}` → validate the structure, only allow known key prefixes, max 50 MB. Requires 2FA enabled and a fresh TOTP `code` in the body.
  - `GET a=backups` lists automatic backups.
- **Automatic backup:**
  - Vercel Cron calls `GET /api/backup` daily at 02:00 PKT (21:00 UTC). It only runs when env `CRON_SECRET` is set and the `Authorization: Bearer <CRON_SECRET>` header matches.
  - It writes `backups/<yyyy-mm-dd>.json` (excluding `secrets/` and `backups/`) and keeps the last 14.
  - Add the `crons` entry to `vercel.json`.

## 6. CSV imports (strict formats; templates downloadable)
Shared server parser `lib/csv.js`:
- RFC 4180, max 2 MB and 5000 rows.
- Header names must match the template.
- Each row is validated; the response lists row errors `{ row, error }` and the import is all-or-nothing unless `partial: true`.

Templates (exact headers):
- **Pharmacy stock** (`a=import-stock`, pid): `medicine,status,price` (medicine = name or id; status = `in`|`out`; price optional).
- **Refill customers** (`a=import-refills`, pid): `name,phone,medicines,every_days,last_refill_date` (medicines separated by `;`).
- **NGO list** (`a=import-list`): `medicine,quantity`.
- **Company claims:** the existing claims-report accepts `{ csv }` with headers `medicine,quantity,amount_paid`.
- **Admin price corrections** (`a=import-overrides`): `medicine_id,price,hide,note`.
- **Admin pharmacies** (`a=import-pharmacies`): `name,address,area,city,phone,whatsapp,hours,lat,lng,owner_email` (owner must exist and have role pharmacy; listings created as verified).

All CSV **exports** escape formula injection: a cell starting with `=`, `+`, `-`, `@`, tab or CR is prefixed with `'`.

## 7. Input security (server)
- A central `lib/guard.js`:
  - reject JSON bodies containing the keys `__proto__`, `constructor` or `prototype` at any depth;
  - normalise strings (NFC, remove control and bidi-override characters `‪-‮⁦-⁩`);
  - enforce max lengths.
- **Images** (`rx`): check magic bytes (JPEG `FFD8FF`, PNG `89504E47`, WEBP `RIFF....WEBP`) and that the decoded size is ≤ 4 MB; reject SVG, HTML and polyglots.
- Store keys only through `safeKey` (it exists).
- **Security headers:**
  - CSP on all pages: `default-src 'self'`; script `'self' 'wasm-unsafe-eval' https://accounts.google.com/gsi/client`; style `'self' 'unsafe-inline' https://fonts.googleapis.com`; font `https://fonts.gstatic.com`; img `'self' data: blob:`; connect `'self' https://accounts.google.com https://vitals.vercel-insights.com`; frame `https://accounts.google.com`.
  - `frame-ancestors 'none'`, except `/widget`, which uses `*`.
  - Check that inline scripts don't break. Move them to files, or add hashes.
- A new `tests/security.test.js` covering: XSS payloads stored then returned escaped, prototype pollution, path traversal keys, oversized bodies, CSV formula injection on export, fake images (HTML renamed `.jpg`), and bidi characters in names.

## 8. Legal pages (Web)
- `/terms` (Terms of Service), `/privacy` (rewrite: what we collect, why, storage on Vercel, retention, sharing, deletion, contact), `/refund` (Refund & Cancellation), `/disclaimer` (Medical disclaimer: DRAP MRP, not medical advice), `/pharmacy-terms` (listing rules, no drug advertising, accuracy duty), `/delete-account` (how to delete, what is removed).
- All are linked in the footer of every page and from signup (checkbox: "I agree to the Terms of Service and Privacy Policy").
- Same calm design.
- Plain English, plus a short Urdu summary at the top.
- Write a note at the top of each page: "Last updated 27 Nov 2026".
- Say honestly that it has not been reviewed by a lawyer; the founder should get it reviewed. Keep that note out of the public text: put it in the report, not on the page.

## 9. Voice search
- On the website, `SpeechRecognition` (Chrome) already exists. Verify it, and add the `ur-PK` / `en-PK` language based on the UI language.
- In the apps, add the `@capacitor-community/speech-recognition` plugin. `js/native.js` exposes `NATIVE.voice.available()` and `NATIVE.voice.listen(lang) → text`. `app.js` uses it when present (mic shown in the app). Android needs the RECORD_AUDIO permission.

## 10. Two Android apps
- **Customer app:**
  - `appId pk.sastadawa.app`, name "Sasta Dawa Finder" (the existing app; keep its id so updates install over the old one).
  - Bundles the main site plus `account.html`, `css/account.css`, `js/account.js` and the legal pages, so the **Account tab works inside the app**: patient features, My Medicines sync, profile, last login, export data.
  - Google login uses the browser handoff (section 3).
- **Business app:**
  - `appId pk.sastadawa.business`, name "Sasta Dawa for Pharmacies".
  - Its start page is the account portal (`account.html`) with business types preselected.
  - It also has a "Search medicines" screen.
  - Deep link scheme `sastadawabiz`.
- **Build:** one Android Gradle project with two productFlavors (`customer`, `business`), different applicationId, app name, icon tint, web assets folder and deep-link scheme. Or two Capacitor configs, whichever is more reliable. The CI workflow builds both and publishes `SastaDawa.apk` and `SastaDawa-Pharmacies.apk` to the "android" release. Update the website `/download` page with both.
