const { list, put } = require('@vercel/blob');
const sharp = require('sharp');

const INDEX_PATH = 'fzsm/cover-index.json';
const BASE = 'https://www.piupiuchan.top';
const PKG = 'io.piupiu.chat';
const SIG = '0290F67FD446FD51D54B8188880523EAFD74CB469CC58A880EE24333ED7AF004';

function hasBlob() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function emptyIndex() {
  return {
    v: 1,
    updatedAt: 0,
    crawl: { nextPage: 1, totalPages: 1, done: false, lastRunAt: 0, lastError: null },
    items: [],
  };
}

async function readIndex() {
  if (!hasBlob()) return emptyIndex();
  try {
    const result = await list({ prefix: INDEX_PATH, limit: 20 });
    const file = (result.blobs || []).find((b) => b.pathname === INDEX_PATH) || (result.blobs || [])[0];
    if (!file || !file.url) return emptyIndex();
    const resp = await fetch(file.url, { cache: 'no-store' });
    if (!resp.ok) return emptyIndex();
    const data = await resp.json();
    if (!data || !Array.isArray(data.items)) return emptyIndex();
    data.crawl = data.crawl || emptyIndex().crawl;
    return data;
  } catch (e) {
    return emptyIndex();
  }
}

async function writeIndex(index) {
  const blob = await put(INDEX_PATH, JSON.stringify(index), {
    access: 'public',
    contentType: 'application/json; charset=utf-8',
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  return blob;
}

function integrity() {
  return {
    app_platform: 'android',
    app_package_name: PKG,
    app_signature_sha256: SIG,
  };
}

async function listMarketPage(page, pageSize = 30) {
  const body = Object.assign({
    action: 'list',
    page,
    page_size: pageSize,
    sort: '最新',
    tag: '',
    search: '',
    device_id: 'vercel-index-bot',
  }, integrity());
  const res = await fetch(BASE + '/role_market.php', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'fzsm-index-bot/1.0',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!data || data.status !== 'success') {
    throw new Error((data && data.message) || ('list failed ' + res.status));
  }
  return data.data || {};
}

function proxyImage(url) {
  if (!url) return '';
  const r = String(url).trim();
  if (!r || r.startsWith('data:') || r.includes('/proxy_image.php')) return r;
  return BASE + '/proxy_image.php?url=' + encodeURIComponent(Buffer.from(r, 'utf8').toString('base64'));
}

function ahashToB64(ahash) {
  const bytes = Buffer.alloc(8);
  for (let i = 0; i < 64; i++) {
    if (ahash[i]) bytes[i >> 3] |= (1 << (7 - (i & 7)));
  }
  return bytes.toString('base64');
}

async function featuresFromImageBuffer(buf) {
  const { data, info } = await sharp(buf)
    .resize(32, 32, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const gray8 = new Float32Array(64);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      let sum = 0; let cnt = 0;
      for (let by = 0; by < 4; by++) {
        for (let bx = 0; bx < 4; bx++) {
          const gy = y * 4 + by;
          const gx = x * 4 + bx;
          const idx = (gy * w + gx) * 3;
          const r = data[idx]; const g = data[idx + 1]; const b = data[idx + 2];
          sum += 0.299 * r + 0.587 * g + 0.114 * b;
          cnt++;
        }
      }
      gray8[y * 8 + x] = sum / cnt;
    }
  }
  let avg = 0;
  for (let i = 0; i < 64; i++) avg += gray8[i];
  avg /= 64;
  const ahash = new Uint8Array(64);
  for (let i = 0; i < 64; i++) ahash[i] = gray8[i] >= avg ? 1 : 0;

  const colors = [];
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      let sr = 0, sg = 0, sb = 0, cnt = 0;
      for (let by = 0; by < 8; by++) {
        for (let bx = 0; bx < 8; bx++) {
          const gy = y * 8 + by;
          const gx = x * 8 + bx;
          const idx = (gy * w + gx) * 3;
          sr += data[idx]; sg += data[idx + 1]; sb += data[idx + 2]; cnt++;
        }
      }
      colors.push(Math.round(sr / cnt), Math.round(sg / cnt), Math.round(sb / cnt));
    }
  }
  return { ahashB64: ahashToB64(ahash), colors };
}

async function fetchFeaturesForRole(role) {
  const cover = role.cover_url || role.image || '';
  if (!cover) return null;
  const imgUrl = proxyImage(cover);
  const resp = await fetch(imgUrl, {
    headers: { 'User-Agent': 'fzsm-index-bot/1.0' },
  });
  if (!resp.ok) throw new Error('img ' + resp.status);
  const buf = Buffer.from(await resp.arrayBuffer());
  const feat = await featuresFromImageBuffer(buf);
  return {
    id: role.id,
    name: role.name || '',
    image: imgUrl,
    ahash: feat.ahashB64,
    colors: feat.colors,
    views: role.view_count != null ? role.view_count : (role.views || 0),
    likes: role.like_count != null ? role.like_count : (role.likes || 0),
    updatedAt: Date.now(),
  };
}

async function mapPool(items, limit, worker) {
  const out = new Array(items.length);
  let i = 0; let active = 0; let done = 0;
  return new Promise((resolve) => {
    const next = () => {
      while (active < limit && i < items.length) {
        const idx = i++;
        active++;
        Promise.resolve(worker(items[idx], idx))
          .then((v) => { out[idx] = v; })
          .catch(() => { out[idx] = null; })
          .then(() => {
            active--; done++;
            if (done === items.length) resolve(out);
            else next();
          });
      }
    };
    if (!items.length) resolve([]);
    else next();
  });
}

/**
 * Sync strategy:
 * - always refresh newest pages 1..newestPages (catch new uploads)
 * - continue full crawl from crawl.nextPage for crawlPages pages
 */
async function syncIndex(opts = {}) {
  if (!hasBlob()) {
    return { ok: false, error: 'blob_not_configured' };
  }
  // mode: balanced | fill | newest
  const mode = opts.mode || 'balanced';
  let newestPages = opts.newestPages != null ? opts.newestPages : (mode === 'fill' ? 1 : (mode === 'newest' ? 4 : 3));
  let crawlPages = opts.crawlPages != null ? opts.crawlPages : (mode === 'fill' ? 30 : (mode === 'newest' ? 0 : 12));
  if (mode === 'newest') {
    // only new uploads
    if (opts.newestPages == null) newestPages = 4;
    crawlPages = 0;
  }
  const pageSize = opts.pageSize != null ? opts.pageSize : 50;
  const imgConcurrency = opts.imgConcurrency != null ? opts.imgConcurrency : 18;
  const listConcurrency = opts.listConcurrency != null ? opts.listConcurrency : 6;
  const deadlineMs = opts.deadlineMs != null ? opts.deadlineMs : 52000; // leave headroom under 60s
  const t0 = Date.now();
  const timeLeft = () => deadlineMs - (Date.now() - t0);

  const prev = await readIndex();
  const map = Object.create(null);
  for (const it of prev.items || []) {
    if (it && it.id != null) map[String(it.id)] = it;
  }

  let totalPages = prev.crawl && prev.crawl.totalPages ? prev.crawl.totalPages : 1;
  let added = 0;
  let scannedRoles = 0;
  let scannedPages = 0;
  let errors = 0;

  async function fetchPages(pageNums) {
    const results = await mapPool(pageNums, listConcurrency, async (page) => {
      try {
        const data = await listMarketPage(page, pageSize);
        return { page, data, ok: true };
      } catch (e) {
        errors++;
        return { page, ok: false, error: String(e.message || e) };
      }
    });
    return results.filter(Boolean);
  }

  async function processPageData(data) {
    totalPages = Number(data.total_pages != null ? data.total_pages : data.totalPages) || totalPages;
    const items = Array.isArray(data.items) ? data.items : [];
    const need = [];
    for (const role of items) {
      if (!role || role.id == null) continue;
      scannedRoles++;
      const key = String(role.id);
      const cover = role.cover_url || role.image || '';
      const proxied = proxyImage(cover);
      const old = map[key];
      if (old && old.image === proxied && old.ahash) continue;
      need.push(role);
    }
    if (!need.length) return;
    // if little time left, reduce concurrency still try some
    const conc = timeLeft() < 12000 ? Math.max(6, Math.floor(imgConcurrency / 2)) : imgConcurrency;
    const feats = await mapPool(need, conc, async (role) => {
      if (timeLeft() < 2500) return null;
      try { return await fetchFeaturesForRole(role); }
      catch (e) { errors++; return null; }
    });
    for (const rec of feats) {
      if (!rec) continue;
      map[String(rec.id)] = rec;
      added++;
    }
  }

  // page plan
  const pages = [];
  if (mode !== 'fill') {
    for (let p = 1; p <= newestPages; p++) pages.push(p);
  } else if (newestPages > 0) {
    // still sample page 1 for totalPages + new items
    pages.push(1);
  }

  let nextPage = (prev.crawl && prev.crawl.nextPage) || 1;
  if (nextPage < 1) nextPage = 1;
  // bootstrap totalPages if unknown
  if (!prev.crawl || !prev.crawl.totalPages) {
    try {
      const first = await listMarketPage(1, pageSize);
      totalPages = Number(first.total_pages != null ? first.total_pages : first.totalPages) || totalPages;
    } catch (e) {}
  }

  for (let i = 0; i < crawlPages; i++) {
    const p = nextPage + i;
    if (p > totalPages) break;
    if (pages.indexOf(p) >= 0) continue;
    pages.push(p);
  }

  // process in chunks of listConcurrency to keep pipeline full but stop near deadline
  for (let i = 0; i < pages.length; ) {
    if (timeLeft() < 8000) break; // need time to write blob
    const batch = [];
    while (i < pages.length && batch.length < listConcurrency) {
      batch.push(pages[i++]);
    }
    const listed = await fetchPages(batch);
    scannedPages += listed.length;
    // process feature extraction page by page (images heavy)
    for (const row of listed) {
      if (!row.ok || !row.data) continue;
      if (timeLeft() < 7000) break;
      await processPageData(row.data);
    }
  }

  // advance crawl pointer based on planned crawl pages we intended
  let advancedTo = nextPage;
  const crawlPlanned = [];
  for (let i = 0; i < crawlPages; i++) {
    const p = nextPage + i;
    if (p > totalPages) break;
    crawlPlanned.push(p);
  }
  // if we ran out of time early, still advance by processed crawl pages among planned
  const processedSet = {};
  // heuristic: advance by min(crawlPages, pages scanned beyond nextPage-1)
  // Better: advance nextPage by number of crawl pages fully attempted
  const attemptedCrawl = pages.filter((p) => p >= nextPage);
  if (attemptedCrawl.length) {
    advancedTo = Math.max.apply(null, attemptedCrawl) + 1;
  } else if (nextPage <= newestPages) {
    advancedTo = newestPages + 1;
  }

  let done = advancedTo > totalPages;
  if (mode === 'newest') {
    // do not thrash full-crawl pointer while only syncing newest
    advancedTo = (prev.crawl && prev.crawl.nextPage) || advancedTo || 1;
    done = true;
  } else if (done) {
    advancedTo = 1; // restart continuous refresh loop
  }

  const merged = {
    v: 1,
    updatedAt: Date.now(),
    crawl: {
      nextPage: advancedTo,
      totalPages,
      done,
      lastRunAt: Date.now(),
      lastError: errors ? (errors + ' item errors') : null,
      mode,
      lastAdded: added,
      lastScannedPages: scannedPages,
      lastScannedRoles: scannedRoles,
      elapsedMs: Date.now() - t0,
    },
    items: Object.keys(map).map((k) => map[k]),
  };
  const blob = await writeIndex(merged);
  return {
    ok: true,
    count: merged.items.length,
    added,
    scannedRoles,
    scannedPages,
    errors,
    crawl: merged.crawl,
    url: blob.url,
    updatedAt: merged.updatedAt,
    elapsedMs: Date.now() - t0,
  };
}

module.exports = {
  INDEX_PATH,
  hasBlob,
  emptyIndex,
  readIndex,
  writeIndex,
  syncIndex,
};
