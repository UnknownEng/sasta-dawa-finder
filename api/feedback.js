// Vercel function: /api/feedback (logic lives in lib/api.js)
module.exports = (req, res) => require('../lib/api').handle('feedback', req, res);
