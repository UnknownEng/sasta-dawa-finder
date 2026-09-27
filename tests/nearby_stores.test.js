const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const nearbyModule = require('../js/nearby_stores.js');

async function createDOM(options = {}) {
  const htmlPath = path.join(__dirname, '../index.html');
  const htmlContent = fs.readFileSync(htmlPath, 'utf8');

  const configJs = fs.existsSync(path.join(__dirname, '../config.js'))
    ? fs.readFileSync(path.join(__dirname, '../config.js'), 'utf8')
    : 'window.APP_CONFIG = { GOOGLE_PLACES_API_KEY: "" };';
  const embedJs = fs.readFileSync(path.join(__dirname, '../js/medicines_data_embed.js'), 'utf8');
  const translationsJs = fs.readFileSync(path.join(__dirname, '../js/translations.js'), 'utf8');
  const nearbyJs = fs.readFileSync(path.join(__dirname, '../js/nearby_stores.js'), 'utf8');
  const searchJs = fs.readFileSync(path.join(__dirname, '../js/search.js'), 'utf8');
  const dataJs = fs.readFileSync(path.join(__dirname, '../js/data.js'), 'utf8');
  const appJs = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');

  const dom = new JSDOM(htmlContent, {
    runScripts: 'outside-only',
    url: 'http://localhost/',
  });

  const { window } = dom;
  window.scrollTo = () => {};
  window.Element.prototype.scrollIntoView = () => {};

  // Mock Geolocation if specified
  if (options.mockGeolocation) {
    window.navigator.geolocation = {
      getCurrentPosition: (success, error) => {
        if (options.mockGeolocation.denied) {
          error({ code: 1, message: 'User denied Geolocation' });
        } else {
          success({
            coords: {
              latitude: options.mockGeolocation.latitude || 24.8607,
              longitude: options.mockGeolocation.longitude || 67.0011,
              accuracy: 10
            }
          });
        }
      }
    };
  }

  window.eval(configJs);
  window.eval(embedJs);
  window.eval(translationsJs);
  window.eval(nearbyJs);
  window.eval(searchJs);
  window.eval(dataJs);
  window.eval(appJs);

  if (window.__APP_INIT_PROMISE__) {
    await window.__APP_INIT_PROMISE__;
  }

  return dom;
}

test('Nearby Medical Store & Pharmacy Finder Test Suite', async (t) => {
  await t.test('Module unit tests: Haversine distance and phone cleaner', () => {
    // Distance between Karachi and Lahore is ~1025-1030 km
    const dist = nearbyModule.calculateDistanceKm(24.8607, 67.0011, 31.5204, 74.3587);
    assert.ok(dist >= 1000 && dist <= 1050, `Distance should be ~1025 km, got: ${dist}`);

    // Identical coords return 0
    assert.strictEqual(nearbyModule.calculateDistanceKm(31.5, 74.3, 31.5, 74.3), 0);

    // Phone cleaner for tel: links
    assert.strictEqual(nearbyModule.cleanPhoneForTel('021-111-1-38246'), '021111138246');
    assert.strictEqual(nearbyModule.cleanPhoneForTel('+92-42-35181050'), '+924235181050');
    assert.strictEqual(nearbyModule.cleanPhoneForTel(null), null);
    assert.strictEqual(nearbyModule.cleanPhoneForTel(''), null);
  });

  await t.test('Store list shows with correct distance sorting (closest first)', () => {
    // Point near Gulberg Lahore (31.5100, 74.3440)
    const stores = nearbyModule.findStoresNearCoordinates(31.5100, 74.3440, 6);
    assert.ok(stores.length >= 3, 'Should return multiple stores');
    
    // Check ascending distance order
    for (let i = 0; i < stores.length - 1; i++) {
      assert.ok(
        stores[i].distance_km <= stores[i + 1].distance_km,
        `Stores must be sorted closest first: index ${i} (${stores[i].distance_km}) > index ${i + 1} (${stores[i + 1].distance_km})`
      );
    }

    // Fazal Din Gulberg should be the closest (< 1 km)
    assert.strictEqual(stores[0].name, 'Fazal Din Pharma Plus');
    assert.ok(stores[0].distance_km < 1.0);
  });

  await t.test('Missing phone number handled without broken button (null tel link)', () => {
    // City Medicos in Karachi has null phone in directory
    const cityMedicos = nearbyModule.PAKISTAN_PHARMACY_DIRECTORY.find(s => s.id === 'city-medicos-khi');
    assert.ok(cityMedicos, 'Test fixture City Medicos must exist');
    assert.strictEqual(cityMedicos.phone, null);
    assert.strictEqual(nearbyModule.cleanPhoneForTel(cityMedicos.phone), null);
  });

  await t.test('UI Integration: "Find Nearby Stores" button appears on medicine search', async () => {
    const dom = await createDOM();
    const { document } = dom.window;

    const searchInput = document.getElementById('search-input');
    const searchBtn = document.getElementById('search-btn');
    searchInput.value = 'Panadol';
    searchBtn.click();

    // Verify trigger buttons exist in DOM
    const medCardNearbyBtn = document.getElementById('med-card-nearby-btn');
    assert.ok(medCardNearbyBtn, 'Button must exist on selected medicine card');
    assert.ok(
      medCardNearbyBtn.textContent.includes('Find Nearby Medical Stores') ||
      medCardNearbyBtn.textContent.includes('قریبی میڈیکل سٹورز')
    );

    const spotlightNearbyBtn = document.getElementById('spotlight-nearby-btn');
    assert.ok(spotlightNearbyBtn, 'Button must exist on savings spotlight card');

    // Nearby stores section is initially hidden until user requests it
    const nearbySection = document.getElementById('nearby-stores-section');
    assert.strictEqual(nearbySection.style.display, 'none');

    // Tap "Find Nearby Stores"
    medCardNearbyBtn.click();
    assert.strictEqual(nearbySection.style.display, 'block', 'Section must expand on tap');

    // Stock availability disclaimer must be visible
    const disclaimer = document.getElementById('store-disclaimer-text');
    assert.ok(disclaimer, 'Stock availability disclaimer exists');
    assert.ok(
      disclaimer.textContent.includes('may not confirm real-time stock') ||
      disclaimer.textContent.includes('اس مخصوص دوا کی فوری موجودگی کی تصدیق نہ کریں'),
      'Must contain explicit stock availability warning'
    );
  });

  await t.test('Location permission allowed: detects GPS and renders stores with Call & Directions buttons', async () => {
    // Mock user GPS in Clifton Karachi
    const dom = await createDOM({
      mockGeolocation: {
        latitude: 24.8140,
        longitude: 67.0305,
        denied: false
      }
    });
    const { document } = dom.window;

    // Search medicine
    const searchInput = document.getElementById('search-input');
    document.getElementById('search-btn').click();
    searchInput.value = 'Risek';
    document.getElementById('search-btn').click();

    // Open stores section
    document.getElementById('med-card-nearby-btn').click();

    // Click "Allow Location" / request location
    const requestLocationBtn = document.getElementById('request-location-btn');
    assert.ok(requestLocationBtn, 'Location request button must exist');
    await requestLocationBtn.click();

    // Wait a tick for async location resolution
    await new Promise(r => setTimeout(r, 50));

    // Verify stores are rendered
    const storeCards = document.querySelectorAll('#stores-grid .store-card');
    assert.ok(storeCards.length >= 3, `Expected stores, got ${storeCards.length}`);

    // Verify closest store is Dvago Clifton (< 1km from 24.8140, 67.0305)
    const firstStore = storeCards[0];
    assert.ok(firstStore.textContent.includes('Dvago Pharmacy (Clifton)'));
    assert.ok(firstStore.textContent.includes('km away') || firstStore.textContent.includes('کلومیٹر'));

    // Verify Call button opens dialer with tel: link
    const callBtn = firstStore.querySelector('.store-call-btn');
    assert.ok(callBtn, 'Store with phone must have Call button');
    assert.ok(callBtn.getAttribute('href').startsWith('tel:021111138246'));

    // Verify Directions button opens Google Maps URL
    const dirBtn = firstStore.querySelector('.store-dir-btn');
    assert.ok(dirBtn, 'Store must have Directions button');
    assert.ok(dirBtn.getAttribute('href').includes('google.com/maps/dir'));
    assert.ok(dirBtn.getAttribute('href').includes('destination=24.8138%2C67.03'));
  });

  await t.test('Graceful fallback when location permission is denied: manual city/area input works', async () => {
    // Mock user denying Geolocation
    const dom = await createDOM({
      mockGeolocation: { denied: true }
    });
    const { document } = dom.window;

    const searchInput = document.getElementById('search-input');
    searchInput.value = 'Panadol';
    document.getElementById('search-btn').click();

    // Open stores section
    document.getElementById('med-card-nearby-btn').click();

    // User attempts location, browser triggers permission denied
    const requestLocationBtn = document.getElementById('request-location-btn');
    await requestLocationBtn.click();
    await new Promise(r => setTimeout(r, 50));

    // Verify graceful fallback UI appears
    const deniedBox = document.querySelector('.location-denied-box');
    assert.ok(deniedBox, 'Denied fallback container must appear');
    assert.ok(
      deniedBox.textContent.includes('Location access was denied') ||
      deniedBox.textContent.includes('لوکیشن کی اجازت نہیں ملی'),
      'Must display helpful fallback message'
    );

    const manualInput = document.getElementById('manual-area-input');
    const submitBtn = document.getElementById('manual-area-submit-btn');
    assert.ok(manualInput, 'Manual area input field exists');
    assert.ok(submitBtn, 'Manual search submit button exists');

    // User types "Lahore"
    manualInput.value = 'Lahore';
    submitBtn.click();
    await new Promise(r => setTimeout(r, 50));

    // Verify Lahore stores are displayed
    const stores = document.querySelectorAll('#stores-grid .store-card');
    assert.ok(stores.length >= 3);
    const storeTexts = Array.from(stores).map(s => s.textContent);
    assert.ok(storeTexts.some(t => t.includes('Fazal Din') || t.includes('Servaid') || t.includes('Clinix')));
  });

  await t.test('Store with NO phone number gracefully omits Call button without broken button', async () => {
    const dom = await createDOM();
    const { window } = dom;

    // Search for Karachi stores where City Medicos is located
    const stores = window.SastaNearbyStores.findStoresByCityOrArea('North Nazimabad', 6);
    const cityMedicos = stores.find(s => s.id === 'city-medicos-khi');
    assert.ok(cityMedicos, 'City Medicos must be in results');

    window.SastaApp.renderStoresList([cityMedicos]);
    const storeCard = window.document.querySelector('#stores-grid .store-card');
    assert.ok(storeCard);

    // Call button must NOT exist
    const callBtn = storeCard.querySelector('.store-call-btn');
    assert.strictEqual(callBtn, null, 'Store with no phone must NOT render broken call button');

    // Directions button MUST exist
    const dirBtn = storeCard.querySelector('.store-dir-btn');
    assert.ok(dirBtn, 'Directions button must still exist');
  });

  await t.test('Urdu UI mode translates Nearby Stores and disclaimer correctly', async () => {
    const dom = await createDOM();
    const { document, window } = dom.window;

    // Switch to Urdu
    document.getElementById('lang-ur-btn').click();

    // Search Augmentin
    const searchInput = document.getElementById('search-input');
    searchInput.value = 'Augmentin';
    document.getElementById('search-btn').click();

    // Open stores section
    document.getElementById('med-card-nearby-btn').click();

    // Verify Urdu title and disclaimer
    const titleEl = document.getElementById('nearby-stores-title-el');
    assert.ok(titleEl.textContent.includes('قریبی میڈیکل سٹورز'));

    const disclaimerEl = document.getElementById('store-disclaimer-text');
    assert.ok(disclaimerEl.textContent.includes('اس مخصوص دوا کی فوری موجودگی کی تصدیق نہ کریں'));

    // Render a store and verify Urdu Call/Directions labels
    window.SastaApp.renderStoresList([
      {
        id: 'test-store',
        name: 'فضل دین فارمیسی',
        address: 'مین بلیوارڈ گلبرگ',
        phone: '042-111-337-337',
        tel_link: '042111337337',
        directions_url: 'https://maps.google.com',
        distance_km: 1.5,
        open_hours: '24 گھنٹے کھلا'
      }
    ]);

    const rendered = document.querySelector('#stores-grid .store-card');
    assert.ok(rendered.textContent.includes('1.5 کلومیٹر دور'));
    assert.ok(rendered.querySelector('.store-call-btn').textContent.includes('فون کریں'));
    assert.ok(rendered.querySelector('.store-dir-btn').textContent.includes('راستہ دیکھیں'));
  });

  await t.test('Live Google Maps search URL generation and multi-city directory scale', () => {
    // 1. Google Maps search URL with GPS coordinates
    const gmapsCoordsUrl = nearbyModule.getLiveGoogleMapsSearchUrl(24.8607, 67.0011);
    assert.ok(gmapsCoordsUrl.includes('google.com/maps/search/pharmacy+medical+store'));
    assert.ok(gmapsCoordsUrl.includes('24.8607,67.0011'));

    // 2. Google Maps search URL with City/Area query
    const gmapsCityUrl = nearbyModule.getLiveGoogleMapsSearchUrl(null, null, 'Rawalpindi Saddar');
    assert.ok(gmapsCityUrl.includes('google.com/maps/search/pharmacy+medical+store+in+Rawalpindi%20Saddar%20Pakistan'));

    // 3. Multi-city directory scale verification (50+ pharmacies across 10+ major cities)
    assert.ok(nearbyModule.PAKISTAN_PHARMACY_DIRECTORY.length >= 40, `Directory should have >= 40 verified stores, got ${nearbyModule.PAKISTAN_PHARMACY_DIRECTORY.length}`);

    const cities = new Set(nearbyModule.PAKISTAN_PHARMACY_DIRECTORY.map(s => s.city.toLowerCase()));
    const expectedCities = ['karachi', 'lahore', 'islamabad', 'rawalpindi', 'peshawar', 'faisalabad', 'multan', 'quetta', 'hyderabad', 'gujranwala', 'sialkot'];
    for (const city of expectedCities) {
      assert.ok(cities.has(city), `Directory must cover ${city}`);
    }
  });

  await t.test('DOM Integration: Live Google Maps Banner and Quick City Chips', async () => {
    const dom = await createDOM();
    const { document, window } = dom.window;

    // Search medicine and open nearby stores
    const searchInput = document.getElementById('search-input');
    searchInput.value = 'Panadol';
    document.getElementById('search-btn').click();
    document.getElementById('med-card-nearby-btn').click();

    // Verify Live Google Maps Banner renders
    const gmapsBanner = document.querySelector('.live-gmaps-banner');
    assert.ok(gmapsBanner, 'Live Google Maps banner must be rendered in DOM');
    assert.ok(gmapsBanner.textContent.includes('Google Maps'));

    const gmapsBtn = document.getElementById('live-gmaps-btn');
    assert.ok(gmapsBtn, 'Live Google Maps button must exist');
    assert.ok(gmapsBtn.getAttribute('href').includes('google.com/maps/search'));

    // Verify Quick City Chips exist in DOM
    const cityChips = document.querySelectorAll('.store-city-chip');
    assert.ok(cityChips.length >= 8, `Expected >= 8 city chips, got ${cityChips.length}`);

    // Click "Peshawar" chip
    const peshawarChip = Array.from(cityChips).find(c => c.textContent.trim() === 'Peshawar');
    assert.ok(peshawarChip, 'Peshawar chip exists');
    peshawarChip.click();
    await new Promise(r => setTimeout(r, 50));

    // Verify Peshawar stores are rendered
    const storeCards = document.querySelectorAll('#stores-grid .store-card');
    assert.ok(storeCards.length >= 2, 'Peshawar stores should be shown');
    const storeTexts = Array.from(storeCards).map(s => s.textContent);
    assert.ok(storeTexts.some(t => t.includes('Khyber') || t.includes('Hayatabad')));
  });
});
