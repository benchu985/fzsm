const { syncIndex, hasBlob } = require('../lib/cover-index-server');

module.exports = async function handler(req, res) {
  // Vercel Cron sends GET with Authorization: Bearer <CRON_SECRET> if set
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.authorization || '';
    if (auth !== 'Bearer ' + cronSecret) {
      res.status(401).json({ status: 'error', message: 'unauthorized' });
      return;
    }
  }

  if (!hasBlob()) {
    res.status(501).json({ status: 'error', message: 'blob_not_configured' });
    return;
  }

  try {
    // frequent: refresh newest + advance full crawl
    const result = await syncIndex({ newestPages: 4, crawlPages: 12, pageSize: 30, imgConcurrency: 10 });
    res.status(200).json({ status: 'success', data: result });
  } catch (e) {
    res.status(500).json({ status: 'error', message: String(e.message || e) });
  }
};

module.exports.config = {
  maxDuration: 60,
};
