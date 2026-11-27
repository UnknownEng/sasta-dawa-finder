// Vercel function: /api/backup, the daily automatic backup called by Vercel Cron (logic in lib/api.js + lib/backup.js)
module.exports = (req, res) => require('../lib/api').handle('backup', req, res);
