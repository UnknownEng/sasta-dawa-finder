# Google Search Console Verification & Submission Guide — Antigracity

## 1. Overview
This document provides the standard operating procedure for submitting and verifying **Antigracity** (`https://antigracity.pk`) on **Google Search Console (GSC)** and **Bing Webmaster Tools** to ensure complete, rapid indexing and crawl health.

---

## 2. Property Verification Methods

### Method 1: HTML Meta Tag (Configured in `<head>` of `index.html`)
The site includes the verification meta tag in `index.html`:
```html
<meta name="google-site-verification" content="google-site-verification-antigracity-pk-2026">
```
*Steps to complete*:
1. Navigate to [Google Search Console](https://search.google.com/search-console).
2. Choose **URL prefix** property: `https://antigracity.pk`.
3. Select **HTML tag** as the verification method.
4. Replace the placeholder token `google-site-verification-antigracity-pk-2026` with your unique GSC verification hash if provided.
5. Click **Verify**.

### Method 2: DNS TXT Record (Recommended for Root Domain)
Add the following TXT record to your DNS provider (Cloudflare / Namecheap / Route53):
```
Type: TXT
Host: @
Value: google-site-verification=<your-unique-token>
TTL: 3600
```

---

## 3. Sitemap Submission
1. In the Search Console dashboard, select **Sitemaps** from the left-hand navigation under **Indexing**.
2. Under "Add a new sitemap", enter:
   ```
   https://antigracity.pk/sitemap.xml
   ```
3. Click **Submit**.
4. Confirm the status changes to **Success** (Green).

---

## 4. URL Inspection & Priority Indexing
To request immediate indexing for high-priority pages:
1. Paste `https://antigracity.pk/` into the top search bar ("Inspect any URL in https://antigracity.pk").
2. Click **Test Live URL** to confirm Googlebot receives:
   - HTTP Status: `200 OK`
   - Page fetch: Successful
   - Mobile Usability: Page is usable on mobile
   - Structured Data: Detected `FAQPage`, `BreadcrumbList`, and `MedicalWebPage`
3. Click **Request Indexing**.

---

## 5. Monitoring & Maintenance Schedule
- **Coverage / Page Indexing**: Review weekly for 0 "Discovered - currently not indexed" or "Soft 404" errors.
- **Core Web Vitals**: Monitor LCP (< 2.5s), INP (< 200ms), and CLS (< 0.1).
- **Rich Results**: Verify that FAQ snippets appear with green valid checkmarks in the Enhancements tab.
- **Robots.txt Tester**: Ensure `User-agent: Googlebot` has full access to `css/`, `js/`, and icon assets.
