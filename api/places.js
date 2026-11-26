// Vercel function: /api/places (logic lives in lib/platform.js via lib/api.js)
module.exports = (req, res) => require('../lib/api').handle('places', req, res);
