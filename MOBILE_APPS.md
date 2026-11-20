# Sasta Dawa — Android & iOS apps

The website is wrapped into real Android and iOS apps with [Capacitor](https://capacitorjs.com). It's the same code: one
codebase, three outputs (website, Play Store app, App Store app).

## What the apps add over the website

- **Works fully offline from the first launch.** The DRAP medicine list ships inside the app, so nothing has to download first.
- **Daily medicine reminders** on the My Medicines screen: up to 4 times a day, local notifications, no server. Tapping
  one opens My Medicines.
- **Native share sheet** (WhatsApp, SMS, anything) for medicines and the My Medicines list.
- Outside links (Google Maps, WhatsApp) open in the phone's browser or apps instead of inside the app.
- Android back button, a status bar that follows dark mode, app icon and splash screen.
- AI chat, feedback and admin price fixes still come from the live site (`sasta-dawa-finder.vercel.app`).

On the website none of this code runs (`js/native.js` switches itself off), so the site behaves as before.

## Files

| Path | What |
|---|---|
| `capacitor.config.json` | App id `pk.sastadawa.app`, name "Sasta Dawa", splash/status bar settings |
| `js/native.js` | The app-only glue (API base URL, share, links, back button, reminders) |
| `scripts/build_app.js` | Copies the site into `www/` for the app (no admin panel, service worker or SEO files) |
| `android/`, `ios/` | Native projects (commit them) |
| `assets/` | Source images for icons and splash screens |
| `.github/workflows/mobile-apps.yml` | Builds the APK, the Play Store AAB and the iOS app on GitHub's machines |
| `privacy.html` | Privacy policy. Both stores require one: `https://sasta-dawa-finder.vercel.app/privacy.html` |
| `lib/api.js` | Now allows the app (origins `https://localhost`, `capacitor://localhost`) to call `/api/config`, `/api/chat`, `/api/feedback`, `/api/health`. Admin stays closed. |

> **Deploy the website first.** The app's AI chat and feedback need the CORS change in `lib/api.js` live on Vercel.
> Merging this branch into `main` does that.

> **Decide the app id now.** `pk.sastadawa.app` can't change after the first store upload. To change it, edit `appId` in
> `capacitor.config.json`, `applicationId` + `namespace` in `android/app/build.gradle`, `PRODUCT_BUNDLE_IDENTIFIER` in
> `ios/App/App.xcodeproj/project.pbxproj`, and move `android/app/src/main/java/pk/sastadawa/app/MainActivity.java` to the
> matching folder and package.

---

## 1. Get a test APK (free, about 10 minutes)

1. Push the `mobile-app` branch and open a pull request (or merge into `main`).
2. GitHub → **Actions** → **Mobile apps** → **Run workflow** (pick the branch).
3. When it finishes, open the run → **Artifacts** → download `android-<number>`. Inside is
   `SastaDawa-1.0.0-<n>-debug.apk`.
4. Send it to your phone and install it (allow "install unknown apps"). This debug APK is for testing only. The Play Store
   needs the signed AAB from step 2.

The same run builds the iOS app for the simulator (`ios-simulator-<n>`) to prove it compiles. Without the Apple secrets
it doesn't sign anything.

## 2. Google Play Store

### a) Create your upload key (once, on your PC)

Android Studio includes Java, so `keytool` is available. In a terminal:

```bash
keytool -genkeypair -v -keystore sastadawa-upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
```

Pick a strong password and **back up the .jks file and password** (Google Drive plus a password manager). Never commit
it (`*.jks` is git-ignored).

Turn it into text for GitHub:

```bash
# Windows PowerShell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("sastadawa-upload.jks")) | Set-Clipboard
# macOS / Linux
base64 -i sastadawa-upload.jks | pbcopy        # or: base64 -w0 sastadawa-upload.jks
```

### b) Add GitHub secrets

Repo → Settings → Secrets and variables → Actions → **New repository secret**:

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | the base64 text from above |
| `ANDROID_KEYSTORE_PASSWORD` | your keystore password |
| `ANDROID_KEY_ALIAS` | `upload` |
| `ANDROID_KEY_PASSWORD` | same as the keystore password (unless you set a different one) |

Run the workflow again. The artifact now also has `SastaDawa-…-playstore.aab` (for the Play Store) and a signed
`…-release.apk`. Each run gets a higher version code automatically (the GitHub run number).

### c) Play Console

1. Create a developer account at play.google.com/console ($25, one-time). A **personal** account must run a **closed
   test with at least 12 testers, opted in for 14 days in a row**, before it can publish to everyone. Line up 15–20
   friends or classmates early (they need Gmail addresses). An **organization** account (needs a D-U-N-S number) skips
   this.
2. **Create app** → name "Sasta Dawa – Medicine Prices", free, App.
3. Turn on **Play App Signing** (the default) and upload the `.aab`.
4. **App content** (Policy → App content):
   - Privacy policy: `https://sasta-dawa-finder.vercel.app/privacy.html`
   - **Health apps declaration**: tick *Medical → Medical reference and education* and *Medication and pain management*
     (reminders). It's not a medical device.
   - **Data safety**: Data collected = *Personal info → Email address / Phone number* (optional, only if typed in the
     feedback form), *App activity → Other user-generated content* (feedback messages and AI assistant messages).
     Not shared for ads, encrypted in transit (HTTPS), users can ask for deletion by email. No location, contacts or
     tracking.
   - Ads: No. Target audience: 18+. Content rating questionnaire: fill it in honestly (no violence etc.).
5. **Store listing**: short description, full description (say the prices are DRAP MRP and it isn't medical advice),
   512×512 icon (`assets/icon-only.png` resized), a 1024×500 feature graphic, and at least 2 phone screenshots.
6. **Testing → Closed testing** → create a track, add testers (email list or Google Group), upload the AAB, roll out.
   Share the opt-in link. After 14 days → **Apply for production**.

## 3. Apple App Store (iPhone)

You **don't need a Mac**. GitHub's macOS machines build and sign the app. You do need:

1. **Apple Developer Program**: $99/year, developer.apple.com/programs. Enrolling as an individual is quickest.
2. **Create the app record**: App Store Connect → Apps → **+** → New App → iOS, name "Sasta Dawa", Bundle ID
   `pk.sastadawa.app` (register it under Certificates, IDs & Profiles → Identifiers first, if it doesn't show up), SKU
   `sastadawa`.
3. **API key for GitHub**: App Store Connect → Users and Access → Integrations → **App Store Connect API** → Team Keys →
   generate a key with **Admin** access (needed so the workflow can create the signing certificate itself). Download
   `AuthKey_XXXX.p8` (you can only download it once) and note the **Key ID** and **Issuer ID**.
4. **Team ID**: developer.apple.com → Account → Membership details.
5. GitHub secrets:

| Secret | Value |
|---|---|
| `ASC_KEY_ID` | Key ID |
| `ASC_ISSUER_ID` | Issuer ID |
| `ASC_KEY_P8` | the **whole text** of the .p8 file, including the `-----BEGIN PRIVATE KEY-----` lines |
| `APPLE_TEAM_ID` | Team ID (10 characters) |

6. Run the workflow. The iOS job archives, signs and **uploads straight to TestFlight**. After Apple processes it (around
   5–30 minutes), install it on your iPhone through the TestFlight app.
7. In App Store Connect fill in: privacy policy URL, **App Privacy** (same answers as Play's Data safety), category
   **Medical**, age rating, screenshots (6.9" iPhone size, at least 3), description, support URL (the website). Pick the
   build → **Submit for Review**.

**App Review tips.** Apple rejects apps that are "just a website" (guideline 4.2), so say what the app does natively in
the review notes. Example:

> Sasta Dawa works fully offline. The complete DRAP medicine price database (~20,000 products) is bundled in the app. It
> adds daily local medicine reminders (My Medicines → Daily reminder), the native share sheet, and English/Urdu with RTL.
> No login is required. Prices are official DRAP maximum retail prices; the app gives no dosing or diagnosis advice and
> shows a "consult your doctor/pharmacist" notice.

## 4. Updating the apps later

Change the website code as usual. Every push to `main` that touches the app rebuilds both apps. Then:

- Play: upload the new AAB to a track (version codes go up automatically).
- iOS: the new build appears in TestFlight. Add it to a new App Store version and submit.
- Medicine price data (`data/medicines.json`) is bundled, so ship app updates now and then. Admin price fixes from the
  admin panel reach the app immediately through `/api/config`.

Before a new store release, bump `MARKETING_VERSION` in `.github/workflows/mobile-apps.yml` and `versionName` in
`android/app/build.gradle` (e.g. `1.1.0`).

## 5. Working on the apps locally (optional)

```bash
npm install
npm run app:sync        # build www/ and copy it into android/ and ios/
npm run app:android     # opens Android Studio → Run ▶ on a phone or emulator
npm run app:ios         # opens Xcode (Mac only) → Run ▶
```

Icons and splash screens come from `assets/`. After changing them run `npx @capacitor/assets generate`.
