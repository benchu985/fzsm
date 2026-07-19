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

  if (req.method === 'GET') {
    const blobEnabled = hasBlob();
    let index = blobEnabled ? await readIndex() : emptyIndex();
    // lazy kick: if empty or stale > 15min, do a small sync inline (best-effort)
    const staleMs = 15 * 60 * 1000;
    const stale = !index.updatedAt || (Date.now() - Number(index.updatedAt) > staleMs);
    const empty = !index.items || index.items.length === 0;
    let wantSync = false;
    try {
      const u = new URL(req.url || '/', 'http://localhost');
      const s = u.searchParams.get('sync');
      wantSync = s === '1' || s === 'true';
    } catch (e) {}
    let sync = null;
    // empty always try; or client asked; or stale
    if (blobEnabled && (empty || wantSync || stale)) {
      try {
        sync = await syncIndex({ newestPages: empty ? 5 : 2, crawlPages: empty ? 10 : 4 });
        index = await readIndex();
      } catch (e) {
        sync = { ok: false, error: String(e.message || e) };
      }
    }
    res.status(200).json({
      status: 'success',
      data: {
        blobEnabled,
        auto: true,
        count: index.items ? index.items.length : 0,
        crawl: index.crawl || null,
        updatedAt: index.updatedAt || 0,
        index,
        sync,
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
      const result = await syncIndex({
        newestPages: body.newestPages,
        crawlPages: body.crawlPages,
        pageSize: body.pageSize,
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
