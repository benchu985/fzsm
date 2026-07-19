const { publicConfig } = require('../lib/sm');
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ status: 'ok', service: 'fzsm', ...publicConfig() });
};
