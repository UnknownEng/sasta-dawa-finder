// Vercel function: /api/account (logic lives in lib/platform.js via lib/api.js)
module.exports = (req, res) => require('../lib/api').handle('account', req, res);
