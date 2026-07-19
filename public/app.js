/* Sm cover-only viewer; text scrub on display only; image similarity search */
(function () {
  'use strict';

  var BASE = atob('aHR0cHM6Ly93d3cucGl1cGl1Y2hhbi50b3A=');
  var PKG = atob('aW8ucGl1cGl1LmNoYXQ=');
  var SIG = '0290F67FD446FD51D54B8188880523EAFD74CB469CC58A880EE24333ED7AF004';
  var DEVICE_KEY = 'sm_web_device_id';

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
  async function listMarket() {
    return listMarketPage(state.page, state.pageSize);
  }

  /* ---------- image features: aHash(8x8) + color grid(4x4 RGB means) ---------- */
  function loadImageEl(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('image load failed')); };
      img.src = src;
    });
  }
  function extractFeaturesFromImage(img) {
    var c = document.createElement('canvas');
    c.width = 32;
    c.height = 32;
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, 32, 32);
    var data = ctx.getImageData(0, 0, 32, 32).data;

    // aHash on 8x8 grayscale averages of 4x4 blocks
    var gray8 = [];
    var y, x, by, bx, i, sum, cnt, gy, gx, idx, r, g, b, gray;
    for (y = 0; y < 8; y++) {
      for (x = 0; x < 8; x++) {
        sum = 0; cnt = 0;
        for (by = 0; by < 4; by++) {
          for (bx = 0; bx < 4; bx++) {
            gy = y * 4 + by;
            gx = x * 4 + bx;
            idx = (gy * 32 + gx) * 4;
            r = data[idx]; g = data[idx + 1]; b = data[idx + 2];
            gray = 0.299 * r + 0.587 * g + 0.114 * b;
            sum += gray; cnt++;
          }
        }
        gray8.push(sum / cnt);
      }
    }
    var avg = 0;
    for (i = 0; i < gray8.length; i++) avg += gray8[i];
    avg /= gray8.length;
    var ahash = [];
    for (i = 0; i < gray8.length; i++) ahash.push(gray8[i] >= avg ? 1 : 0);

    // 4x4 mean RGB (each cell 8x8 on 32 canvas)
    var colors = [];
    for (y = 0; y < 4; y++) {
      for (x = 0; x < 4; x++) {
        var sr = 0, sg = 0, sb = 0; cnt = 0;
        for (by = 0; by < 8; by++) {
          for (bx = 0; bx < 8; bx++) {
            gy = y * 8 + by;
            gx = x * 8 + bx;
            idx = (gy * 32 + gx) * 4;
            sr += data[idx]; sg += data[idx + 1]; sb += data[idx + 2]; cnt++;
          }
        }
        colors.push(sr / cnt, sg / cnt, sb / cnt);
      }
    }
    return { ahash: ahash, colors: colors };
  }
  async function featuresFromSrc(src) {
    var img = await loadImageEl(src);
    return extractFeaturesFromImage(img);
  }
  function hamming(a, b) {
    var d = 0;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
    return d;
  }
  function colorDistance(a, b) {
    // normalized L1 over 0..255 channels
    var s = 0;
    for (var i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
    return s / (a.length * 255);
  }
  function similarityScore(q, t) {
    // 0..100, higher better
    var ham = hamming(q.ahash, t.ahash); // 0..64
    var hashSim = 1 - ham / 64;
    var colSim = 1 - colorDistance(q.colors, t.colors);
    var score = 0.62 * hashSim + 0.38 * colSim;
    return Math.max(0, Math.min(1, score)) * 100;
  }

  function mapPool(items, limit, worker) {
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
          var v = m.target.nodeValue;
          var n = brandText(v);
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
      grid.innerHTML = '<div class="empty">未找到相似封面（可增大扫描页数或换图）</div>';
      return;
    }
    // highest relevance first (already sorted)
    var top = list.slice(0, 60);
    top.forEach(function (it, idx) { it._rank = idx + 1; });
    grid.innerHTML = top.map(cardHtml).join('');
    paintCovers(grid);
    scrubTextNodes(grid);
  }

  async function runImageSearch() {
    if (state.imgBusy) return;
    if (!state.imgQueryFeat) {
      setMsg($('status'), '请先选择一张图片', 'err');
      return;
    }
    var scanPages = parseInt(($('imgScanPages') && $('imgScanPages').value) || '8', 10);
    if (!isFinite(scanPages) || scanPages < 1) scanPages = 8;
    if (scanPages > 50) scanPages = 50;

    state.imgBusy = true;
    state.mode = 'img';
    setImgModeUI(true);
    var status = $('status');
    var grid = $('grid');
    grid.innerHTML = '<div class="empty">搜图中…</div>';

    try {
      // use current filters
      state.search = $('searchInput').value.trim();
      state.tag = $('tagInput').value.trim();
      state.sort = $('sortSelect').value;

      var pageSize = 24;
      var all = [];
      var seen = {};
      var totalPages = scanPages;

      for (var p = 1; p <= scanPages; p++) {
        setMsg(status, '拉取列表 ' + p + '/' + scanPages + ' …');
        var r = await listMarketPage(p, pageSize);
        if (r.status !== 'success') {
          setMsg(status, r.message || ('第 ' + p + ' 页失败'), 'err');
          break;
        }
        var data = r.data || {};
        var tp = Number(data.total_pages != null ? data.total_pages : data.totalPages) || scanPages;
        if (tp > 0 && tp < totalPages) totalPages = tp;
        if (p > totalPages) break;
        var raw = Array.isArray(data.items) ? data.items : [];
        for (var i = 0; i < raw.length; i++) {
          var role = sanitizeRole(raw[i]);
          if (!role || !role.image) continue;
          var key = String(role.id);
          if (seen[key]) continue;
          seen[key] = 1;
          all.push(role);
        }
        if (p >= totalPages) break;
      }

      setMsg(status, '比对封面 0/' + all.length + ' …');
      var done = 0;
      var scored = await mapPool(all, 6, async function (item) {
        try {
          var feat = await featuresFromSrc(item.image);
          item.score = similarityScore(state.imgQueryFeat, feat);
        } catch (e) {
          item.score = -1;
        }
        done++;
        if (done % 4 === 0 || done === all.length) {
          setMsg(status, '比对封面 ' + done + '/' + all.length + ' …');
        }
        return item;
      });

      scored = scored.filter(function (x) { return x && x.score >= 0; });
      scored.sort(function (a, b) { return b.score - a.score; }); // 相关性最高放前面
      state.imgResults = scored;
      renderImgResults(scored);
      var best = scored[0] ? Math.round(scored[0].score) : 0;
      setMsg(status, '搜图完成：扫描 ' + all.length + ' 张，按相关度排序（最高 ' + best + '%）', 'ok');
    } catch (e) {
      setMsg(status, String(e.message || e), 'err');
      grid.innerHTML = '<div class="empty">搜图失败</div>';
    } finally {
      state.imgBusy = false;
    }
  }

  async function loadMarket() {
    if (state.mode === 'img') {
      // browsing returns from img mode only via clear
      return;
    }
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
      if (!items.length) {
        grid.innerHTML = '<div class="empty">暂无角色</div>';
      } else {
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
      if (!isFinite(n)) {
        setMsg($('status'), '请输入有效页码', 'err');
        return;
      }
      if (n < 1) n = 1;
      if (state.totalPages > 0 && n > state.totalPages) n = state.totalPages;
      if (n === state.page) {
        setMsg($('status'), '已在第 ' + n + ' 页', 'ok');
        return;
      }
      state.page = n;
      loadMarket();
      window.scrollTo(0, 0);
    }

    $('btnSearch').onclick = function () {
      state.search = $('searchInput').value.trim();
      state.tag = $('tagInput').value.trim();
      state.sort = $('sortSelect').value;
      state.page = 1;
      if (state.mode === 'img' && state.imgQueryFeat) {
        runImageSearch();
        return;
      }
      state.mode = 'browse';
      setImgModeUI(false);
      loadMarket();
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
        prev.src = state.imgQueryUrl;
        prev.classList.remove('hidden');
        state.imgQueryFeat = await featuresFromSrc(state.imgQueryUrl);
        setMsg($('status'), '图片已就绪，点击「以图搜图」', 'ok');
      } catch (err) {
        state.imgQueryFeat = null;
        setMsg($('status'), '图片读取失败：' + (err.message || err), 'err');
      }
    };
    $('btnImgSearch').onclick = function () { runImageSearch(); };
    $('btnClearImgSearch').onclick = function () {
      state.mode = 'browse';
      state.imgResults = [];
      setImgModeUI(false);
      loadMarket();
    };
  }

  function boot() {
    watchDom();
    bind();
    loadMarket();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
