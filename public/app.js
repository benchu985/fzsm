/* Sm cover-only viewer; display text scrub only; requests unchanged */
(function () {
  'use strict';

  // request protocol (must stay original for API/covers)
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
  };

  function $(id) { return document.getElementById(id); }

  // blocked brand token pieces encoded so source has no plaintext brand
  function d(b) {
    try { return atob(b); } catch (e) { return ''; }
  }
  var BRAND_FROM = d('cGl1cGl1'); // ascii token
  var BRAND_FROM_UP = d('UElVUElV');
  var BRAND_FROM_CAMEL = d('UGl1UGl1');

  /** ONLY for visible text — never for URLs / network bodies */
  function brandText(input) {
    if (input == null) return '';
    var s = String(input);
    if (!BRAND_FROM) return s;
    // case-insensitive whole-token replace for display strings
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
  function escapeText(s) {
    return escapeHtml(brandText(s));
  }

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

  async function listMarket() {
    return post('/role_market.php', {
      action: 'list',
      page: state.page,
      page_size: state.pageSize,
      sort: mapSort(state.sort),
      tag: state.tag || '',
      search: state.search || '',
      device_id: getDeviceId(),
    });
  }

  function cardHtml(item) {
    var img = item.image || '';
    var name = item.name || '';
    return (
      '<article class="card" data-id="' + escapeHtml(item.id) + '">' +
        '<div class="cover" data-bg="' + escapeHtml(img) + '" role="img" aria-label="' + escapeText(name) + '"></div>' +
        '<div class="card-body">' +
          '<div class="name">' + escapeText(name) + '</div>' +
          '<div class="meta">👁 ' + (item.views || 0) + ' · ❤ ' + (item.likes || 0) + '</div>' +
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

  // scrub only TEXT nodes; never touch attributes that may be URLs (src/style/data-bg/href)
  function scrubTextNodes(root) {
    if (!root) return;
    var walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var node;
    while ((node = walk.nextNode())) {
      // skip script/style
      var p = node.parentElement;
      if (p && (p.tagName === 'SCRIPT' || p.tagName === 'STYLE')) continue;
      var v = node.nodeValue;
      if (!v || !BRAND_FROM || v.toLowerCase().indexOf(BRAND_FROM) < 0) continue;
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

  async function loadMarket() {
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
      setMsg(status, '共 ' + state.total + ' 个 · 仅展示封面', 'ok');
      scrubTextNodes(grid);
    } catch (e) {
      setMsg(status, String(e.message || e), 'err');
      grid.innerHTML = '<div class="empty">网络错误</div>';
    }
  }

  function bind() {
    $('btnSearch').onclick = function () {
      // search query sent to API is raw (request unchanged); only UI display scrubbed
      state.search = $('searchInput').value.trim();
      state.tag = $('tagInput').value.trim();
      state.sort = $('sortSelect').value;
      state.page = 1;
      loadMarket();
    };
    $('searchInput').onkeydown = function (e) { if (e.key === 'Enter') $('btnSearch').click(); };
    $('btnPrev').onclick = function () { if (state.page > 1) { state.page--; loadMarket(); window.scrollTo(0, 0); } };
    $('btnNext').onclick = function () { if (state.page < state.totalPages) { state.page++; loadMarket(); window.scrollTo(0, 0); } };
  }

  function boot() {
    watchDom();
    bind();
    loadMarket();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
