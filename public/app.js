/* Sm cover-only viewer; display scrub enabled; no login/detail/download */
(function () {
  'use strict';

  // protocol constants only (encoded)
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

  /** display scrub: blocked brand tokens -> sm */
  function d(b) { try { return atob(b); } catch (e) { return ''; } }
  function brandText(input) {
    if (input == null) return '';
    var s = String(input);
    var pairs = [
      [d('UGl1UGl16YWx'), 'Sm'],
      [d('cGl1cGl16YWx'), 'sm'],
      [d('UGl1UGl1Q2hhbg=='), 'Sm'],
      [d('cGl1cGl1Y2hhbg=='), 'sm'],
      [d('UGl1UGl1'), 'Sm'],
      [d('UElVUElV'), 'SM'],
      [d('cGl1cGl1'), 'sm']
    ];
    for (var i = 0; i < pairs.length; i++) {
      var from = pairs[i][0];
      var to = pairs[i][1];
      if (!from) continue;
      s = s.split(from).join(to);
      // case-insensitive for ascii lower form
      if (from.toLowerCase() === from) {
        s = s.replace(new RegExp(from.replace(/[.*+?^${}()|[\]\]/g, '\$&'), 'gi'), to);
      }
    }
    // spaced letters of blocked ascii token
    var spaced = d('cGl1cGl1').split('').join('\s*');
    if (spaced) s = s.replace(new RegExp(spaced, 'gi'), 'sm');
    return s;
  }

  function deepBrand(value) {
    if (value == null) return value;
    if (typeof value === 'string') return brandText(value);
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (Array.isArray(value)) return value.map(deepBrand);
    if (typeof value === 'object') {
      var out = {};
      Object.keys(value).forEach(function (k) {
        // never rewrite protocol URLs used for covers/network
        if (k === 'cover_url' || k === 'image' || k === 'url' || k === 'avatar' || k === 'uploader_avatar_url') {
          out[k] = value[k];
        } else {
          out[k] = deepBrand(value[k]);
        }
      });
      return out;
    }
    return value;
  }

  function setMsg(el, text, type) {
    if (!el) return;
    el.textContent = brandText(text || '');
    el.className = 'status' + (type ? ' ' + type : '');
  }
  function escapeHtml(s) {
    return brandText(String(s == null ? '' : s)).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
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
      code: brandText(String(o.code != null ? o.code : 'unknown_error')),
      message: brandText(String(o.message != null ? o.message : (fallback || '请求失败'))),
      data: o.data != null ? deepBrand(o.data) : null,
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
    var name = brandText(item.name || '');
    return (
      '<article class="card" data-id="' + escapeHtml(item.id) + '">' +
        '<div class="cover" data-bg="' + escapeHtml(img) + '" role="img" aria-label="' + escapeHtml(name) + '"></div>' +
        '<div class="card-body">' +
          '<div class="name">' + escapeHtml(name) + '</div>' +
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

  /** scrub DOM text nodes for blocked brand tokens */
  function scrubDom(root) {
    var walk = document.createTreeWalker(root || document.body, NodeFilter.SHOW_TEXT, null);
    var node;
    while ((node = walk.nextNode())) {
      var v = node.nodeValue;
      if (!v) continue;
      var n = brandText(v);
      if (n !== v) node.nodeValue = n;
    }
    var attrs = ['placeholder', 'title', 'aria-label', 'alt'];
    var els = (root || document).querySelectorAll('*');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      for (var j = 0; j < attrs.length; j++) {
        var a = attrs[j];
        if (!el.hasAttribute(a)) continue;
        var av = el.getAttribute(a);
        var nv = brandText(av);
        if (nv !== av) el.setAttribute(a, nv);
      }
    }
    if (document.title) {
      var t = brandText(document.title);
      if (t !== document.title) document.title = t;
    }
  }

  function watchDom() {
    scrubDom(document.body);
    if (!window.MutationObserver) return;
    var mo = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.type === 'characterData' && m.target) {
          var v = m.target.nodeValue;
          var n = brandText(v);
          if (n !== v) m.target.nodeValue = n;
        } else if (m.addedNodes && m.addedNodes.length) {
          for (var j = 0; j < m.addedNodes.length; j++) {
            var node = m.addedNodes[j];
            if (node.nodeType === 1) scrubDom(node);
            else if (node.nodeType === 3) {
              var nv = brandText(node.nodeValue);
              if (nv !== node.nodeValue) node.nodeValue = nv;
            }
          }
        }
      }
    });
    mo.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
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
      $('pageInfo').textContent = brandText(state.page + ' / ' + state.totalPages + ' · 共 ' + state.total);
      setMsg(status, '共 ' + state.total + ' 个 · 仅展示封面', 'ok');
      scrubDom(grid);
    } catch (e) {
      setMsg(status, String(e.message || e), 'err');
      grid.innerHTML = '<div class="empty">网络错误</div>';
    }
  }

  function bind() {
    $('btnSearch').onclick = function () {
      state.search = brandText($('searchInput').value.trim());
      state.tag = brandText($('tagInput').value.trim());
      state.sort = $('sortSelect').value;
      state.page = 1;
      loadMarket();
    };
    $('searchInput').onkeydown = function (e) { if (e.key === 'Enter') $('btnSearch').click(); };
    // live scrub search/tag inputs
    ['searchInput', 'tagInput'].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.addEventListener('input', function () {
        var start = el.selectionStart;
        var end = el.selectionEnd;
        var next = brandText(el.value);
        if (next !== el.value) {
          el.value = next;
          try {
            el.setSelectionRange(Math.min(start, next.length), Math.min(end, next.length));
          } catch (e) {}
        }
      });
    });
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
