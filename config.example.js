/**
 * Sasta Dawa Finder - Application Configuration Template
 * 
 * Instructions:
 * 1. Copy this file to "config.js" in the same directory:
 *    cp config.example.js config.js
 * 2. Add your Google Places API Key from Google Cloud Console below.
 * 3. "config.js" is ignored by git (.gitignore) and will never be pushed to GitHub.
 * 
 * Note: If GOOGLE_PLACES_API_KEY is left empty (""), Sasta Dawa Finder will
 * automatically use its built-in directory of verified Pakistani medical stores
 * with real coordinates, phone numbers, and live GPS distance calculation.
 */

window.APP_CONFIG = {
  // Optional: Replace with your actual Google Cloud Places API key
  GOOGLE_PLACES_API_KEY: ""
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = window.APP_CONFIG;
}
