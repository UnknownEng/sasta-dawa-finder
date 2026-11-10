// Vercel function: /api/chat (logic lives in lib/api.js)
module.exports = (req, res) => require('../lib/api').handle('chat', req, res);
