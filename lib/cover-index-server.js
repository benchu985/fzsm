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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let res;
  try {
    res = await fetch(BASE + '/role_market.php', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'fzsm-index-bot/1.0',
        'Accept': 'application/json, text/plain, */*',
        'Origin': BASE,
        'Referer': BASE + '/',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) {
    throw new Error('list non-json ' + res.status + ' ' + String(text).slice(0, 120));
  }
  if (!data || data.status !== 'success') {
    throw new Error((data && (data.message || data.code)) || ('list failed ' + res.status));
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
function lumaToB64(luma) {
  return Buffer.from(luma).toString('base64');
}

async function featuresFromImageBuffer(buf) {
  if (!buf || !buf.length) throw new Error('empty image');
  // VP8X / animated / alpha WebP covers are common; force first frame + opaque RGB.
  let pipeline = sharp(buf, {
    animated: false,
    pages: 1,
    failOn: 'none',
    sequentialRead: true,
    limitInputPixels: 4096 * 4096,
  }).rotate();
  try {
    pipeline = pipeline.flatten({ background: { r: 255, g: 255, b: 255 } });
  } catch (e) {
    // ignore flatten unsupported edge cases; continue with removeAlpha
  }
  const { data, info } = await pipeline
    .resize(32, 32, { fit: 'fill', kernel: 'lanczos3' })
    .removeAlpha()
    .toColorspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const channels = info.channels || 3;
  if (w < 1 || h < 1 || !data || !data.length) throw new Error('bad raw image');
  const gray8 = new Float32Array(64);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      let sum = 0; let cnt = 0;
      for (let by = 0; by < 4; by++) {
        for (let bx = 0; bx < 4; bx++) {
          const gy = Math.min(h - 1, y * 4 + by);
          const gx = Math.min(w - 1, x * 4 + bx);
          const idx = (gy * w + gx) * channels;
          const r = data[idx] || 0;
          const g = data[idx + Math.min(1, channels - 1)] || 0;
          const b = data[idx + Math.min(2, channels - 1)] || 0;
          sum += 0.299 * r + 0.587 * g + 0.114 * b;
          cnt++;
        }
      }
      gray8[y * 8 + x] = sum / Math.max(1, cnt);
    }
  }
  let avg = 0;
  for (let i = 0; i < 64; i++) avg += gray8[i];
  avg /= 64;
  const luma = new Uint8Array(64);
  for (let i = 0; i < 64; i++) luma[i] = Math.max(0, Math.min(255, Math.round(gray8[i])));
  const ahash = new Uint8Array(64);
  for (let i = 0; i < 64; i++) ahash[i] = gray8[i] >= avg ? 1 : 0;
  // dHash captures local edges/layout, avoiding false positives from shared palettes.
  const dhash = new Uint8Array(64);
  let di = 0;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const lx = Math.min(w - 1, Math.floor(x * w / 9));
      const rx = Math.min(w - 1, Math.floor((x + 1) * w / 9));
      const py = Math.min(h - 1, Math.floor(y * h / 8));
      const li = (py * w + lx) * channels;
      const ri = (py * w + rx) * channels;
      const lv = 0.299 * (data[li] || 0) + 0.587 * (data[li + Math.min(1, channels - 1)] || 0) + 0.114 * (data[li + Math.min(2, channels - 1)] || 0);
      const rv = 0.299 * (data[ri] || 0) + 0.587 * (data[ri + Math.min(1, channels - 1)] || 0) + 0.114 * (data[ri + Math.min(2, channels - 1)] || 0);
      dhash[di++] = lv >= rv ? 1 : 0;
    }
  }

  const colors = [];
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      let sr = 0, sg = 0, sb = 0, cnt = 0;
      for (let by = 0; by < 8; by++) {
        for (let bx = 0; bx < 8; bx++) {
          const gy = Math.min(h - 1, y * 8 + by);
          const gx = Math.min(w - 1, x * 8 + bx);
          const idx = (gy * w + gx) * channels;
          sr += data[idx] || 0;
          sg += data[idx + Math.min(1, channels - 1)] || 0;
          sb += data[idx + Math.min(2, channels - 1)] || 0;
          cnt++;
        }
      }
      colors.push(Math.round(sr / cnt), Math.round(sg / cnt), Math.round(sb / cnt));
    }
  }
  return { ahashB64: ahashToB64(ahash), dhashB64: ahashToB64(dhash), lumaB64: lumaToB64(luma), colors };
}

async function fetchImageBuffer(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'fzsm-index-bot/1.0',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error('img ' + resp.status);
    const buf = Buffer.from(await resp.arrayBuffer());
    if (!buf.length) throw new Error('img empty');
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFeaturesForRole(role) {
  const cover = role.cover_url || role.image || '';
  if (!cover) return null;
  const proxied = proxyImage(cover);
  // Prefer direct cover CDN, fall back to proxy. New VP8X covers sometimes fail one path.
  const candidates = [];
  if (cover && !String(cover).includes('/proxy_image.php')) candidates.push(String(cover).trim());
  if (proxied && proxied !== cover) candidates.push(proxied);
  if (!candidates.length) candidates.push(proxied || cover);

  let lastErr = null;
  let usedUrl = candidates[0];
  let feat = null;
  for (const url of candidates) {
    try {
      const buf = await fetchImageBuffer(url);
      feat = await featuresFromImageBuffer(buf);
      usedUrl = url.startsWith('http') ? (proxied || url) : proxied;
      // Keep stored image URL stable for UI: always prefer proxy form when available.
      if (proxied) usedUrl = proxied;
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!feat) throw (lastErr || new Error('feature failed'));
  return {
    id: role.id,
    name: role.name || '',
    image: usedUrl,
    ahash: feat.ahashB64,
    dhash: feat.dhashB64,
    luma: feat.lumaB64,
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
  const sampleErrors = [];

  async function fetchPages(pageNums) {
    const results = await mapPool(pageNums, listConcurrency, async (page) => {
      try {
        const data = await listMarketPage(page, pageSize);
        return { page, data, ok: true };
      } catch (e) {
        errors++;
        if (sampleErrors.length < 8) {
          sampleErrors.push('page' + page + ':' + String((e && e.message) || e).slice(0, 160));
        }
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
      // Re-fetch only when missing, incomplete, or cover URL changed.
      if (old && old.ahash && old.dhash && old.luma) {
        const oldImg = String(old.image || '');
        const sameCover = !cover || !oldImg || oldImg === proxied || oldImg === cover ||
          (cover && oldImg.includes(encodeURIComponent(Buffer.from(String(cover), 'utf8').toString('base64'))));
        if (sameCover) continue;
      }
      need.push(role);
    }
    if (!need.length) return;
    // Prefer reliability for newest uploads over max throughput.
    const concBase = Math.min(imgConcurrency, mode === 'newest' ? 8 : imgConcurrency);
    const conc = timeLeft() < 12000 ? Math.max(2, Math.floor(concBase / 2)) : concBase;
    const feats = await mapPool(need, conc, async (role) => {
      if (timeLeft() < 2500) return null;
      try { return await fetchFeaturesForRole(role); }
      catch (e) {
        errors++;
        if (sampleErrors.length < 8) {
          sampleErrors.push(String(role && role.id) + ':' + String((e && e.message) || e).slice(0, 160));
        }
        return null;
      }
    });
    for (const rec of feats) {
      if (!rec) continue;
      const key = String(rec.id);
      if (!map[key]) added++;
      map[key] = rec;
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
    // only newest pages; mark full crawl complete so UI never shows fill progress
    done = true;
    const itemCount = Object.keys(map).length;
    if (itemCount >= 8000 || (prev.crawl && prev.crawl.done) || (prev.crawl && prev.crawl.mode === 'local-full')) {
      advancedTo = Math.max(totalPages + 1, 1);
    } else {
      advancedTo = (prev.crawl && prev.crawl.nextPage) || advancedTo || 1;
    }
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
      sampleErrors: sampleErrors.length ? sampleErrors : null,
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
    sampleErrors: sampleErrors.length ? sampleErrors : undefined,
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
