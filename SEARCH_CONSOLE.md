# Getting Sasta Dawa Finder on Google (free)

Live site: `https://sasta-dawa-finder.vercel.app/`

## What Google can index

The app itself uses `#/` routes, which Google ignores. So the build (`scripts/build_seo.js`, run by
`scripts/build_public.js`) also writes plain static pages that Google can read:

| URL | What it is |
| --- | --- |
| `/dawa/<brand>` | One page per brand, e.g. `/dawa/panadol`: DRAP price for every strength and cheaper brands with the same formula |
| `/formula/<salt>` | One page per formula, e.g. `/formula/atorvastatin`: every brand, cheapest first |
| `/browse/<letter>`, `/formula` | A–Z indexes so every page is reachable by links |
| `/sitemap.xml` | Every page above, regenerated on every deploy |

`vercel.json` has `cleanUrls: true`, so `/dawa/panadol.html` is served as `/dawa/panadol`.

## Search Console setup (one time)

1. Open https://search.google.com/search-console and sign in.
2. Add property → **URL prefix** → `https://sasta-dawa-finder.vercel.app/`
   (a Domain property is not possible on a `vercel.app` address).
3. Verify with **HTML tag**: copy the `content="..."` value Google gives and add this line inside `<head>` of `index.html`:
   `<meta name="google-site-verification" content="PASTE_TOKEN_HERE">`
   Push, wait for Vercel to deploy, then press **Verify**.
4. **Sitemaps** → submit `sitemap.xml`.
5. **URL Inspection** → paste `https://sasta-dawa-finder.vercel.app/` and a few brand pages (e.g. `/dawa/panadol`) → **Request indexing**.

Then do the same on Bing Webmaster Tools (https://www.bing.com/webmasters): choose **Import from Google Search Console**.
Bing also feeds DuckDuckGo and Yahoo.

## What to expect

New sites usually take days to weeks to get indexed, and 11k pages are crawled gradually.
Check **Pages** (indexed vs not) and **Performance** (searches that show the site) every week.

## Analytics

- Website: Vercel → project → **Analytics**. Pages show as `/`, `/medicine/[id]`, `/search`, `/dawa/...`.
  Search words are never sent.
- App installs: the page `/app/installed` (each visitor = one install that was actually opened).
- App daily users: the page `/app/active` (visitors per day = daily active users).
