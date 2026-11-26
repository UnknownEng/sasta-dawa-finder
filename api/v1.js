// Vercel function: /api/v1 (logic lives in lib/platform.js via lib/api.js)
module.exports = (req, res) => require('../lib/api').handle('v1', req, res);
