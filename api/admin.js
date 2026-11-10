// Vercel function: /api/admin (logic lives in lib/api.js)
module.exports = (req, res) => require('../lib/api').handle('admin', req, res);
