// Vercel function: /api/health (logic lives in lib/api.js)
module.exports = (req, res) => require('../lib/api').handle('health', req, res);
