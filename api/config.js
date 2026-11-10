// Vercel function: /api/config (logic lives in lib/api.js)
module.exports = (req, res) => require('../lib/api').handle('config', req, res);
