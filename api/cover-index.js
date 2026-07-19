const { hasBlob, readIndex, emptyIndex, syncIndex } = require('../lib/cover-index-server');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  // GET stays read-only; the browser compares market/index counts and POSTs seed items in the background.
  if (req.method === 'GET') {
    const blobEnabled = hasBlob();
    const index = blobEnabled ? await readIndex() : emptyIndex();
    res.status(200).json({
      status: 'success',
      data: {
        blobEnabled,
        auto: true,
        count: index.items ? index.items.length : 0,
        crawl: index.crawl || null,
        updatedAt: index.updatedAt || 0,
        index,
        sync: null,
      },
    });
    return;
  }

  if (req.method === 'POST') {
    if (!hasBlob()) {
      res.status(501).json({ status: 'error', code: 'blob_not_configured', message: 'Blob 未配置', data: null });
      return;
    }
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const prev = await readIndex();
      const count = prev.items ? prev.items.length : 0;
      let seedItems = Array.isArray(body.seedItems) ? body.seedItems : [];
      // Keep payload small for serverless body limits.
      if (seedItems.length > 220) seedItems = seedItems.slice(0, 220);
      seedItems = seedItems.map((x) => ({
        id: x && x.id,
        name: x && x.name || '',
        cover_url: (x && (x.cover_url || x.image || x.coverUrl)) || '',
        view_count: x && (x.view_count != null ? x.view_count : x.views),
        like_count: x && (x.like_count != null ? x.like_count : x.likes),
      })).filter((x) => x.id != null && x.cover_url);

      let mode = body.mode;
      if (!mode) {
        if (seedItems.length) mode = 'seed';
        else if (count < 1) mode = 'fill';
        else if (count < 8000) mode = 'balanced';
        else mode = 'newest';
      }
      if (seedItems.length && mode === 'newest') mode = 'seed';
      const nearFull = count >= 8000 || mode === 'newest' || mode === 'seed';
      const result = await syncIndex({
        mode,
        seedItems,
        newestPages: body.newestPages != null ? body.newestPages : (nearFull ? 4 : (mode === 'fill' ? 1 : 2)),
        crawlPages: body.crawlPages != null ? body.crawlPages : (nearFull || mode === 'newest' || mode === 'seed' ? 0 : (mode === 'fill' ? 30 : 12)),
        pageSize: body.pageSize || 50,
        imgConcurrency: body.imgConcurrency || (seedItems.length ? 8 : 18),
        listConcurrency: body.listConcurrency || 6,
      });
      res.status(200).json({ status: 'success', data: result });
    } catch (e) {
      res.status(500).json({ status: 'error', code: 'sync_failed', message: String(e.message || e), data: null });
    }
    return;
  }

  res.status(405).json({ status: 'error', code: 'method_not_allowed', message: 'GET/POST only', data: null });
};

module.exports.config = {
  maxDuration: 60,
};
