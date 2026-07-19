/* Sm cover-only viewer + cover feature index (local IDB / optional Vercel Blob) */
(function () {
  'use strict';

  var BASE = atob('aHR0cHM6Ly93d3cucGl1cGl1Y2hhbi50b3A=');
  var PKG = atob('aW8ucGl1cGl1LmNoYXQ=');
  var SIG = '0290F67FD446FD51D54B8188880523EAFD74CB469CC58A880EE24333ED7AF004';
  var DEVICE_KEY = 'sm_web_device_id';
  var IDB_NAME = 'fzsm_cover_index';
  var IDB_STORE = 'items';
  var FEAT_CONCURRENCY = 14;
  var LIST_CONCURRENCY = 4;
  // fast reject: aHash similarity below this => skip (0..1)
  var HASH_GATE = 0.70; // structure-only coarse gate; reject color-only lookalikes

  var state = {
    page: 1,
    pageSize: 18,
    sort: '最新',
    tag: '',
    search: '',
    totalPages: 1,
    total: 0,
    mode: 'browse', // browse | img
    imgQueryFeat: null,
    imgQueryUrl: '',
    imgResults: [],
    imgBusy: false,
    imgToken: 0,
    indexCount: 0,
    blobEnabled: false,
    indexMap: Object.create(null), // id -> {id,name,image,ahash,dhash,colors}
  };

  function $(id) { return document.getElementById(id); }
  function d(b) { try { return atob(b); } catch (e) { return ''; } }
  var BRAND_FROM = d('cGl1cGl1');
  var BRAND_FROM_UP = d('UElVUElV');
  var BRAND_FROM_CAMEL = d('UGl1UGl1');

  function brandText(input) {
    if (input == null) return '';
    var s = String(input);
    if (!BRAND_FROM) return s;
    try {
      var re = new RegExp(BRAND_FROM.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      s = s.replace(re, function (m) {
        if (m === BRAND_FROM_UP) return 'SM';
        if (m === BRAND_FROM_CAMEL) return 'Sm';
        if (m[0] && m[0] === m[0].toUpperCase()) return 'Sm';
        return 'sm';
      });
    } catch (e) {}
    return s;
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function escapeText(s) { return escapeHtml(brandText(s)); }
  function setMsg(el, text, type) {
    if (!el) return;
    el.textContent = brandText(text || '');
    el.className = 'status' + (type ? ' ' + type : '');
  }
  function integrity() {
    return { app_platform: 'android', app_package_name: PKG, app_signature_sha256: SIG };
  }
  function getDeviceId() {
    var id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = 'web-' + (crypto.randomUUID ? crypto.randomUUID() : (Date.now() + '-' + Math.random().toString(16).slice(2)));
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  }
  function normalize(e, fallback) {
    var o = e && typeof e === 'object' ? e : {};
    return {
      status: o.status === 'success' ? 'success' : 'error',
      code: String(o.code != null ? o.code : 'unknown_error'),
      message: brandText(String(o.message != null ? o.message : (fallback || '请求失败'))),
      data: o.data != null ? o.data : null,
    };
  }
  async function post(path, body) {
    var res = await fetch(BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({}, body || {}, integrity())),
    });
    var data = await res.json().catch(function () {
      return { status: 'error', code: 'invalid_response', message: 'invalid ' + res.status, data: null };
    });
    return normalize(data);
  }
  function mapSort(n) {
    if (n === '随机') return 'random';
    if (n === '浏览榜') return '最多浏览';
    if (n === '下载榜') return '最多下载';
    if (n === '点赞榜') return '最多点赞';
    return n || '最新';
  }
  function proxyImage(url) {
    if (!url) return '';
    var r = String(url).trim();
    if (!r || r.indexOf('data:') === 0 || r.indexOf('blob:') === 0) return r;
    if (!/^https?:\/\//i.test(r) || r.indexOf('/proxy_image.php') >= 0) return r;
    var bin = new TextEncoder().encode(r);
    var s = '';
    for (var i = 0; i < bin.length; i++) s += String.fromCharCode(bin[i]);
    return BASE + '/proxy_image.php?url=' + encodeURIComponent(btoa(s));
  }
  function sanitizeRole(role) {
    if (!role || typeof role !== 'object') return null;
    return {
      id: role.id,
      name: brandText(role.name || ''),
      image: proxyImage(role.cover_url || role.image || ''),
      views: role.view_count != null ? role.view_count : (role.views || 0),
      likes: role.like_count != null ? role.like_count : (role.likes || 0),
    };
  }
  async function listMarketPage(page, pageSize) {
    return post('/role_market.php', {
      action: 'list',
      page: page,
      page_size: pageSize || state.pageSize,
      sort: mapSort(state.sort),
      tag: state.tag || '',
      search: state.search || '',
      device_id: getDeviceId(),
    });
  }
  async function listMarket() { return listMarketPage(state.page, state.pageSize); }

  /* ---------- feature codec ---------- */
  function ahashToB64(ahash) {
    var bytes = new Uint8Array(8);
    for (var i = 0; i < 64; i++) {
      if (ahash[i]) bytes[i >> 3] |= (1 << (7 - (i & 7)));
    }
    var s = '';
    for (var j = 0; j < bytes.length; j++) s += String.fromCharCode(bytes[j]);
    return btoa(s);
  }
  function b64ToAhash(b) {
    var bin = atob(b || '');
    var ahash = new Uint8Array(64);
    for (var i = 0; i < 64; i++) {
      var byte = bin.charCodeAt(i >> 3) || 0;
      ahash[i] = (byte >> (7 - (i & 7))) & 1;
    }
    return ahash;
  }
  function b64ToDhash(b) { return b ? b64ToAhash(b) : null; }
  function b64ToLuma(b) {
    if (!b) return null;
    var bin = atob(b); var out = new Uint8Array(64);
    for (var i = 0; i < 64; i++) out[i] = bin.charCodeAt(i) || 0;
    return out;
  }
  function colorsToArr(colors) {
    var out = new Array(colors.length);
    for (var i = 0; i < colors.length; i++) out[i] = Math.round(colors[i]);
    return out;
  }

  /* ---------- image features ---------- */
  var featCache = Object.create(null);

  function loadImageEl(src) {
    return new Promise(function (resolve, reject) {
      if (typeof createImageBitmap === 'function') {
        fetch(src, { mode: 'cors', credentials: 'omit', cache: 'force-cache' })
          .then(function (r) {
            if (!r.ok) throw new Error('fetch ' + r.status);
            return r.blob();
          })
          .then(function (blob) {
            var opts = { resizeWidth: 32, resizeHeight: 32, resizeQuality: 'low' };
            return createImageBitmap(blob, opts).catch(function () { return createImageBitmap(blob); });
          })
          .then(resolve)
          .catch(function () {
            var img = new Image();
            img.crossOrigin = 'anonymous';
            img.decoding = 'async';
            img.onload = function () { resolve(img); };
            img.onerror = function () { reject(new Error('image load failed')); };
            img.src = src;
          });
        return;
      }
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('image load failed')); };
      img.src = src;
    });
  }

  function extractFeaturesFromImage(img) {
    var c = document.createElement('canvas');
    c.width = 32; c.height = 32;
    var ctx = c.getContext('2d', { willReadFrequently: true, alpha: false });
    ctx.drawImage(img, 0, 0, 32, 32);
    if (img.close) { try { img.close(); } catch (e) {} }
    var data = ctx.getImageData(0, 0, 32, 32).data;
    var gray8 = new Float32Array(64);
    var i, y, x, by, bx, gy, gx, idx, r, g, b, sum, cnt, avg;
    for (y = 0; y < 8; y++) {
      for (x = 0; x < 8; x++) {
        sum = 0; cnt = 0;
        for (by = 0; by < 4; by++) {
          for (bx = 0; bx < 4; bx++) {
            gy = y * 4 + by; gx = x * 4 + bx; idx = (gy * 32 + gx) * 4;
            r = data[idx]; g = data[idx + 1]; b = data[idx + 2];
            sum += 0.299 * r + 0.587 * g + 0.114 * b; cnt++;
          }
        }
        gray8[y * 8 + x] = sum / cnt;
      }
    }
    avg = 0; for (i = 0; i < 64; i++) avg += gray8[i]; avg /= 64;
    var luma = new Uint8Array(64);
    for (i = 0; i < 64; i++) luma[i] = Math.max(0, Math.min(255, Math.round(gray8[i])));
    var ahash = new Uint8Array(64);
    for (i = 0; i < 64; i++) ahash[i] = gray8[i] >= avg ? 1 : 0;
    // dHash preserves local edge/layout information and rejects same-color lookalikes.
    var dhash = new Uint8Array(64); var di = 0;
    for (y = 0; y < 8; y++) {
      for (x = 0; x < 8; x++) {
        var lx = Math.floor(x * 32 / 9), rx = Math.floor((x + 1) * 32 / 9);
        var py = Math.floor(y * 32 / 8);
        var li = (py * 32 + lx) * 4, ri = (py * 32 + rx) * 4;
        var lv = 0.299 * data[li] + 0.587 * data[li + 1] + 0.114 * data[li + 2];
        var rv = 0.299 * data[ri] + 0.587 * data[ri + 1] + 0.114 * data[ri + 2];
        dhash[di++] = lv >= rv ? 1 : 0;
      }
    }
    var colors = new Float32Array(48); var ci = 0;
    for (y = 0; y < 4; y++) {
      for (x = 0; x < 4; x++) {
        var sr = 0, sg = 0, sb = 0; cnt = 0;
        for (by = 0; by < 8; by++) {
          for (bx = 0; bx < 8; bx++) {
            gy = y * 8 + by; gx = x * 8 + bx; idx = (gy * 32 + gx) * 4;
            sr += data[idx]; sg += data[idx + 1]; sb += data[idx + 2]; cnt++;
          }
        }
        colors[ci++] = sr / cnt; colors[ci++] = sg / cnt; colors[ci++] = sb / cnt;
      }
    }
    return { ahash: ahash, dhash: dhash, luma: luma, colors: colors };
  }

  async function featuresFromSrc(src) {
    if (featCache[src]) return featCache[src];
    var img = await loadImageEl(src);
    var feat = extractFeaturesFromImage(img);
    featCache[src] = feat;
    return feat;
  }

  function hamming(a, b) {
    var dlt = 0;
    for (var i = 0; i < 64; i++) if (a[i] !== b[i]) dlt++;
    return dlt;
  }
  function colorDistance(a, b) {
    var s = 0, n = Math.min(a.length, b.length);
    for (var i = 0; i < n; i++) s += Math.abs(a[i] - b[i]);
    return s / (n * 255);
  }
  function hashSimilarity(q, t) {
    var aSim = 1 - hamming(q.ahash, t.ahash) / 64;
    // Legacy records are accepted temporarily; rebuilt records use both hashes.
    if (!q.dhash || !t.dhash) return aSim;
    var dSim = 1 - hamming(q.dhash, t.dhash) / 64;
    return 0.45 * aSim + 0.55 * dSim;
  }
  function lumaSimilarity(q, t) {
    if (!q.luma || !t.luma) return null;
    var sum = 0;
    for (var i = 0; i < 64; i++) sum += Math.abs(q.luma[i] - t.luma[i]);
    return 1 - sum / (64 * 255);
  }
  function similarityScore(q, t) {
    var structureSim = hashSimilarity(q, t);
    var colSim = 1 - colorDistance(q.colors, t.colors);
    var lumaSim = lumaSimilarity(q, t);
    // The luminance profile tracks what the eye sees after resize/compression.
    // Structural hashes still prevent same-colour but unrelated covers ranking high.
    if (lumaSim != null) return Math.max(0, Math.min(1, 0.75 * lumaSim + 0.20 * structureSim + 0.05 * colSim)) * 100;
    return Math.max(0, Math.min(1, 0.94 * structureSim + 0.06 * colSim)) * 100;
  }

  function mapPool(items, limit, worker, onProgress) {
    return new Promise(function (resolve) {
      var out = new Array(items.length);
      var i = 0, active = 0, done = 0;
      function next() {
        while (active < limit && i < items.length) {
          (function (idx) {
            active++;
            Promise.resolve(worker(items[idx], idx))
              .then(function (v) { out[idx] = v; })
              .catch(function () { out[idx] = null; })
              .then(function () {
                active--; done++;
                if (onProgress) onProgress(done, items.length, out[idx]);
                if (done === items.length) resolve(out);
                else next();
              });
          })(i++);
        }
      }
      if (!items.length) resolve([]);
      else next();
    });
  }

  async function fetchListPagesParallel(fromPage, toPage, pageSize) {
    fromPage = Math.max(1, fromPage | 0);
    toPage = Math.max(fromPage, toPage | 0);
    if (toPage - fromPage + 1 > 80) toPage = fromPage + 79;
    var probe = await listMarketPage(fromPage, pageSize);
    if (probe.status !== 'success') return { error: probe.message || '列表失败', items: [], fromPage: fromPage, toPage: toPage, totalPages: 0 };
    var data = probe.data || {};
    var totalPages = Number(data.total_pages != null ? data.total_pages : data.totalPages) || 1;
    if (fromPage > totalPages) return { error: '起始页超过总页数 ' + totalPages, items: [], fromPage: fromPage, toPage: toPage, totalPages: totalPages };
    toPage = Math.min(toPage, totalPages);
    var pages = [probe];
    if (fromPage === toPage) return { items: pages, fromPage: fromPage, toPage: toPage, totalPages: totalPages };
    var rest = [];
    for (var p = fromPage + 1; p <= toPage; p++) rest.push(p);
    var restResults = await mapPool(rest, LIST_CONCURRENCY, function (p) { return listMarketPage(p, pageSize); });
    for (var i = 0; i < restResults.length; i++) pages.push(restResults[i]);
    return { items: pages, fromPage: fromPage, toPage: toPage, totalPages: totalPages };
  }

  /* ---------- IndexedDB + cloud manual index ---------- */
  function idbOpen() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE, { keyPath: 'id' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('idb open failed')); };
    });
  }
  async function idbPutMany(items) {
    if (!items || !items.length) return;
    var db = await idbOpen();
    await new Promise(function (resolve, reject) {
      var tx = db.transaction(IDB_STORE, 'readwrite');
      var store = tx.objectStore(IDB_STORE);
      for (var i = 0; i < items.length; i++) store.put(items[i]);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error || new Error('idb put failed')); };
    });
    db.close();
  }
  async function idbGetAll() {
    var db = await idbOpen();
    var items = await new Promise(function (resolve, reject) {
      var tx = db.transaction(IDB_STORE, 'readonly');
      var req = tx.objectStore(IDB_STORE).getAll();
      req.onsuccess = function () { resolve(req.result || []); };
      req.onerror = function () { reject(req.error || new Error('idb getAll failed')); };
    });
    db.close();
    return items;
  }
  function itemFromIndexRec(rec) {
    if (!rec || rec.id == null || !rec.ahash) return null;
    return {
      id: rec.id,
      name: brandText(rec.name || ''),
      image: rec.image || '',
      ahash: typeof rec.ahash === 'string' ? b64ToAhash(rec.ahash) : rec.ahash,
      dhash: typeof rec.dhash === 'string' ? b64ToDhash(rec.dhash) : (rec.dhash || null),
      luma: typeof rec.luma === 'string' ? b64ToLuma(rec.luma) : (rec.luma || null),
      colors: rec.colors || [],
      views: rec.views || 0,
      likes: rec.likes || 0,
    };
  }
  function refreshIndexMap(recs) {
    state.indexMap = Object.create(null);
    for (var i = 0; i < recs.length; i++) {
      var it = itemFromIndexRec(recs[i]);
      if (it) state.indexMap[String(it.id)] = it;
    }
    state.indexCount = Object.keys(state.indexMap).length;
  }
  function fmtTime(ts) {
    if (!ts) return '-';
    try { return new Date(ts).toLocaleString(); } catch (e) { return String(ts); }
  }
  function updateIndexInfo(extra) {
    var el = $('indexInfo');
    if (!el) return;
    var crawl = state.crawl || {};
    var prog = '';
    var mode = crawl.mode || '';
    var nearFull = state.indexCount >= 8000 || crawl.done || mode === 'newest' || mode === 'local-full';
    if (nearFull) {
      prog = ' · 仅同步新图';
    } else if (crawl.totalPages) {
      prog = ' · 全库进度 ' + (crawl.nextPage || 1) + '/' + crawl.totalPages;
    }
    el.textContent = '云端索引：' + state.indexCount + ' 条' + prog +
      (state.indexUpdatedAt ? (' · 更新 ' + fmtTime(state.indexUpdatedAt)) : '') +
      (extra ? (' · ' + extra) : '');
  }
  async function loadLocalIndex() {
    try {
      var recs = await idbGetAll();
      refreshIndexMap(recs);
      updateIndexInfo('本地缓存');
    } catch (e) {
      updateIndexInfo('本地缓存不可用');
    }
  }
  async function loadCloudIndex() {
    try {
      updateIndexInfo('拉取云端…');
      var res = await fetch('/api/cover-index', { cache: 'no-store' });
      var data = await res.json();
      state.blobEnabled = !!(data && data.data && data.data.blobEnabled);
      var index = data && data.data && data.data.index;
      var items = index && Array.isArray(index.items) ? index.items : [];
      state.crawl = (data && data.data && data.data.crawl) || (index && index.crawl) || null;
      state.indexUpdatedAt = (data && data.data && data.data.updatedAt) || (index && index.updatedAt) || 0;
      if (items.length) {
        await idbPutMany(items);
        refreshIndexMap(items);
      }
      var extra = state.blobEnabled ? '已读取云端' : 'Blob未配置';
      updateIndexInfo(extra);
      return true;
    } catch (e) {
      updateIndexInfo('云端读取失败');
      return false;
    }
  }
  async function manualSyncIndex() {
    if (state.syncBusy) return;
    state.syncBusy = true;
    var btn = $('btnSyncIndex');
    if (btn) { btn.disabled = true; btn.textContent = '同步中…'; }
    try {
      updateIndexInfo('同步中…');
      setMsg($('status'), '正在同步云端索引（仅抓新图）…');
      var res = await fetch('/api/cover-index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: state.indexCount >= 8000 ? 'newest' : (state.indexCount < 1 ? 'fill' : 'balanced') }),
        cache: 'no-store',
      });
      var data = await res.json();
      if (!res.ok || (data && data.status === 'error')) {
        throw new Error((data && data.message) || ('HTTP ' + res.status));
      }
      var result = data && data.data ? data.data : {};
      // re-pull full index for IDB
      await loadCloudIndex();
      var added = result.added != null ? result.added : 0;
      updateIndexInfo('已同步 +' + added);
      setMsg($('status'), '索引同步完成 · +' + added + ' · 共 ' + (result.count != null ? result.count : state.indexCount) + ' 条', 'ok');
    } catch (e) {
      updateIndexInfo('同步失败');
      setMsg($('status'), '同步失败：' + (e.message || e), 'err');
    } finally {
      state.syncBusy = false;
      if (btn) { btn.disabled = false; btn.textContent = '同步索引'; }
    }
  }
  function cancelWork(msg) {
    state.imgToken = (state.imgToken || 0) + 1;
    state.imgBusy = false;
    if (msg) setMsg($('status'), msg, 'ok');
  }
  function getMinScore() {
    var n = parseInt(($('imgMinScore') && $('imgMinScore').value) || '60', 10);
    if (!isFinite(n)) n = 60;
    if (n < 30) n = 30;
    if (n > 95) n = 95;
    return n;
  }

  /* ---------- render ---------- */
  function cardHtml(item) {
    var img = item.image || '';
    var name = item.name || '';
    var scoreHtml = '';
    var rankClass = '';
    if (item.score != null) {
      scoreHtml = '<div class="score-pill">相关 ' + Math.round(item.score) + '%</div>';
      if (item._rank === 1) rankClass = ' rank-1';
    }
    return (
      '<article class="card' + rankClass + '" data-id="' + escapeHtml(item.id) + '">' +
        '<div class="cover" data-bg="' + escapeHtml(img) + '" role="img" aria-label="' + escapeText(name) + '"></div>' +
        '<div class="card-body">' +
          '<div class="name">' + escapeText(name) + '</div>' +
          '<div class="meta">👁 ' + (item.views || 0) + ' · ❤ ' + (item.likes || 0) + '</div>' +
          scoreHtml +
        '</div>' +
      '</article>'
    );
  }
  function paintCovers(root) {
    var nodes = (root || document).querySelectorAll('.cover[data-bg]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var bg = el.getAttribute('data-bg') || '';
      if (bg) el.style.backgroundImage = 'url("' + bg.replace(/"/g, '%22') + '")';
      el.removeAttribute('data-bg');
    }
  }
  function scrubTextNodes(root) {
    if (!root || !BRAND_FROM) return;
    var walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var node;
    while ((node = walk.nextNode())) {
      var p = node.parentElement;
      if (p && (p.tagName === 'SCRIPT' || p.tagName === 'STYLE')) continue;
      var v = node.nodeValue;
      if (!v || v.toLowerCase().indexOf(BRAND_FROM) < 0) continue;
      var n = brandText(v);
      if (n !== v) node.nodeValue = n;
    }
  }
  function watchDom() {
    scrubTextNodes(document.body);
    if (!window.MutationObserver) return;
    var mo = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.type === 'characterData' && m.target && m.target.nodeType === 3) {
          var v = m.target.nodeValue; var n = brandText(v);
          if (n !== v) m.target.nodeValue = n;
        } else if (m.addedNodes) {
          for (var j = 0; j < m.addedNodes.length; j++) {
            var node = m.addedNodes[j];
            if (node.nodeType === 1) scrubTextNodes(node);
            else if (node.nodeType === 3) {
              var nv = brandText(node.nodeValue);
              if (nv !== node.nodeValue) node.nodeValue = nv;
            }
          }
        }
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  }
  function setImgModeUI(on) {
    var clearBtn = $('btnClearImgSearch');
    var pager = $('pager');
    if (clearBtn) clearBtn.classList.toggle('hidden', !on);
    if (pager) pager.style.display = on ? 'none' : '';
  }
  function renderImgResults(list) {
    var grid = $('grid');
    if (!list.length) {
      grid.innerHTML = '<div class="empty">没有达到阈值的高相似封面</div>';
      return;
    }
    var top = list.slice(0, 60);
    top.forEach(function (it, idx) { it._rank = idx + 1; });
    grid.innerHTML = top.map(cardHtml).join('');
    paintCovers(grid);
    scrubTextNodes(grid);
  }

  /* ---------- search against index (no re-download) ---------- */
  async function runImageSearch() {
    if (state.imgBusy) return;
    if (!state.imgQueryFeat) {
      setMsg($('status'), '请先选择一张图片', 'err');
      return;
    }
    if (state.indexCount < 1) {
      setMsg($('status'), '本地无索引，请先点「同步索引」', 'err');
      return;
    }

    state.imgBusy = true;
    state.mode = 'img';
    state.imgToken += 1;
    var token = state.imgToken;
    setImgModeUI(true);
    var status = $('status');
    var grid = $('grid');
    grid.innerHTML = '<div class="empty">索引比对中…</div>';

    try {
      var minScore = getMinScore();
      var q = state.imgQueryFeat;
      var ids = Object.keys(state.indexMap);
      var live = [];
      var t0 = Date.now();
      var checked = 0, passedHash = 0;

      // pure CPU compare, chunked to keep UI responsive
      for (var i = 0; i < ids.length; i++) {
        if (token !== state.imgToken) return;
        var it = state.indexMap[ids[i]];
        checked++;
        var hs = hashSimilarity(q, it);
        if (hs < HASH_GATE) continue; // 低相似直接丢弃，不算颜色
        passedHash++;
        var score = similarityScore(q, it);
        if (score < minScore) continue; // 只保留高相似
        live.push({
          id: it.id,
          name: it.name,
          image: it.image,
          views: it.views || 0,
          likes: it.likes || 0,
          score: score,
        });
        if (checked % 200 === 0) {
          setMsg(status, '索引比对 ' + checked + '/' + ids.length + ' · 高相似 ' + live.length);
          await new Promise(function (r) { setTimeout(r, 0); });
        }
      }
      if (token !== state.imgToken) return;
      live.sort(function (a, b) { return b.score - a.score; });
      state.imgResults = live;
      renderImgResults(live);
      var best = live[0] ? Math.round(live[0].score) : 0;
      var sec = ((Date.now() - t0) / 1000).toFixed(2);
      setMsg(status, '完成：索引 ' + checked + ' · 粗筛通过 ' + passedHash + ' · 高相似 ' + live.length + ' · 最高 ' + best + '% · ' + sec + 's', 'ok');
    } catch (e) {
      if (token === state.imgToken) {
        setMsg(status, String(e.message || e), 'err');
        grid.innerHTML = '<div class="empty">搜图失败</div>';
      }
    } finally {
      if (token === state.imgToken) state.imgBusy = false;
    }
  }

  async function loadMarket() {
    if (state.mode === 'img') return;
    var status = $('status');
    var grid = $('grid');
    setMsg(status, '加载中…');
    try {
      var r = await listMarket();
      if (r.status !== 'success') {
        setMsg(status, r.message || '加载失败', 'err');
        grid.innerHTML = '<div class="empty">加载失败</div>';
        return;
      }
      var data = r.data || {};
      var raw = Array.isArray(data.items) ? data.items : (Array.isArray(data.list) ? data.list : []);
      var items = raw.map(sanitizeRole).filter(Boolean);
      state.total = Number(data.total != null ? data.total : items.length) || 0;
      state.totalPages = Number(data.total_pages != null ? data.total_pages : data.totalPages) || 1;
      if (state.totalPages < 1) state.totalPages = 1;
      if (!items.length) grid.innerHTML = '<div class="empty">暂无角色</div>';
      else {
        grid.innerHTML = items.map(cardHtml).join('');
        paintCovers(grid);
      }
      $('pageInfo').textContent = state.page + ' / ' + state.totalPages + ' · 共 ' + state.total;
      var pageInput = $('pageInput');
      if (pageInput) {
        pageInput.max = String(state.totalPages);
        pageInput.value = String(state.page);
        pageInput.placeholder = '1-' + state.totalPages;
      }
      setMsg(status, '共 ' + state.total + ' 个 · 仅展示封面', 'ok');
      scrubTextNodes(grid);
    } catch (e) {
      setMsg(status, String(e.message || e), 'err');
      grid.innerHTML = '<div class="empty">网络错误</div>';
    }
  }

  function bind() {
    function goPage(raw) {
      if (state.mode === 'img') return;
      var n = parseInt(raw, 10);
      if (!isFinite(n)) { setMsg($('status'), '请输入有效页码', 'err'); return; }
      if (n < 1) n = 1;
      if (state.totalPages > 0 && n > state.totalPages) n = state.totalPages;
      if (n === state.page) { setMsg($('status'), '已在第 ' + n + ' 页', 'ok'); return; }
      state.page = n; loadMarket(); window.scrollTo(0, 0);
    }

    $('btnSearch').onclick = function () {
      state.search = $('searchInput').value.trim();
      state.tag = $('tagInput').value.trim();
      state.sort = $('sortSelect').value;
      state.page = 1;
      if (state.mode === 'img') { runImageSearch(); return; }
      state.mode = 'browse'; setImgModeUI(false); loadMarket();
    };
    $('searchInput').onkeydown = function (e) { if (e.key === 'Enter') $('btnSearch').click(); };
    $('btnPrev').onclick = function () { if (state.page > 1) { state.page--; loadMarket(); window.scrollTo(0, 0); } };
    $('btnNext').onclick = function () { if (state.page < state.totalPages) { state.page++; loadMarket(); window.scrollTo(0, 0); } };
    $('btnGoPage').onclick = function () { goPage($('pageInput').value); };
    $('pageInput').onkeydown = function (e) { if (e.key === 'Enter') goPage($('pageInput').value); };

    $('imgSearchFile').onchange = async function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        if (state.imgQueryUrl) URL.revokeObjectURL(state.imgQueryUrl);
        state.imgQueryUrl = URL.createObjectURL(file);
        var prev = $('imgSearchPreview');
        prev.src = state.imgQueryUrl; prev.classList.remove('hidden');
        state.imgQueryFeat = await featuresFromSrc(state.imgQueryUrl);
        setMsg($('status'), '图片已就绪：建议先「同步索引」，再「以图搜图」', 'ok');
      } catch (err) {
        state.imgQueryFeat = null;
        setMsg($('status'), '图片读取失败：' + (err.message || err), 'err');
      }
    };

    $('btnImgSearch').onclick = function () { runImageSearch(); };
    if ($('btnSyncIndex')) $('btnSyncIndex').onclick = function () { manualSyncIndex(); };
    $('btnCancelImg').onclick = function () {
      cancelWork('已取消');
      if (state.mode === 'img' && state.imgResults && state.imgResults.length) {
        renderImgResults(state.imgResults);
      }
    };
    $('btnClearImgSearch').onclick = function () {
      cancelWork('已退出搜图');
      state.mode = 'browse';
      state.imgResults = [];
      setImgModeUI(false);
      loadMarket();
    };
  }

  async function boot() {
    watchDom();
    bind();
    await loadLocalIndex();
    loadCloudIndex();
    loadMarket();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
