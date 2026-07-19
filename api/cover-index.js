const { list, put, head } = require('@vercel/blob');

const INDEX_PATH = 'fzsm/cover-index.json';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}

function hasBlob() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

async function readIndex() {
  if (!hasBlob()) return null;
  try {
    const result = await list({ prefix: INDEX_PATH, limit: 10 });
    const file = (result.blobs || []).find((b) => b.pathname === INDEX_PATH) || (result.blobs || [])[0];
    if (!file || !file.url) return null;
    const resp = await fetch(file.url, { cache: 'no-store' });
    if (!resp.ok) return null;
    return await resp.json();
  } catch (e) {
    return null;
  }
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method === 'GET') {
    const blobEnabled = hasBlob();
    const index = blobEnabled ? await readIndex() : null;
    res.status(200).json({
      status: 'success',
      data: {
        blobEnabled,
        index: index || { v: 1, updatedAt: 0, items: [] },
        count: index && Array.isArray(index.items) ? index.items.length : 0,
      },
    });
    return;
  }

  if (req.method === 'PUT') {
    if (!hasBlob()) {
      res.status(501).json({
        status: 'error',
        code: 'blob_not_configured',
        message: '未配置 BLOB_READ_WRITE_TOKEN，索引仅保存在浏览器本地',
        data: null,
      });
      return;
    }
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const incoming = body.index || body;
      if (!incoming || !Array.isArray(incoming.items)) {
        res.status(400).json({ status: 'error', code: 'bad_index', message: 'index.items 必填', data: null });
        return;
      }
      // merge with existing
      const prev = (await readIndex()) || { v: 1, items: [] };
      const map = Object.create(null);
      (prev.items || []).forEach((it) => { if (it && it.id != null) map[String(it.id)] = it; });
      (incoming.items || []).forEach((it) => { if (it && it.id != null) map[String(it.id)] = it; });
      const merged = {
        v: 1,
        updatedAt: Date.now(),
        items: Object.keys(map).map((k) => map[k]),
      };
      const blob = await put(INDEX_PATH, JSON.stringify(merged), {
        access: 'public',
        contentType: 'application/json; charset=utf-8',
        addRandomSuffix: false,
        allowOverwrite: true,
      });
      res.status(200).json({
        status: 'success',
        data: { count: merged.items.length, url: blob.url, updatedAt: merged.updatedAt },
      });
    } catch (e) {
      res.status(500).json({ status: 'error', code: 'put_failed', message: String(e.message || e), data: null });
    }
    return;
  }

  res.status(405).json({ status: 'error', code: 'method_not_allowed', message: 'GET/PUT only', data: null });
};
