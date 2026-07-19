#!/usr/bin/env node
/**
 * Local zero-dep server that mimics Vercel public/ + api/ routing.
 * Usage:
 *   node dev-server.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

function send(res, code, body, headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body || '');
  res.writeHead(code, {
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(buf);
}

function contentType(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.json')) return 'application/json; charset=utf-8';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return { raw }; }
}

function loadApi(name) {
  const p = path.join(ROOT, 'api', name + '.js');
  delete require.cache[require.resolve(p)];
  return require(p);
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    // API
    if (u.pathname.startsWith('/api/')) {
      const name = u.pathname.replace(/^\/api\//, '').replace(/\/$/, '') || 'health';
      const file = path.join(ROOT, 'api', name + '.js');
      if (!fs.existsSync(file)) {
        send(res, 404, JSON.stringify({ status: 'error', message: 'not found' }), { 'Content-Type': 'application/json' });
        return;
      }
      const handler = loadApi(name);
      // minimal Vercel-like req
      const q = Object.fromEntries(u.searchParams.entries());
      const body = req.method === 'POST' || req.method === 'PUT' ? await readBody(req) : undefined;
      const vReq = {
        method: req.method,
        query: q,
        body,
        headers: req.headers,
        url: req.url,
      };
      const vRes = {
        statusCode: 200,
        headers: {},
        setHeader(k, v) { this.headers[k] = v; },
        status(code) { this.statusCode = code; return this; },
        json(obj) {
          send(res, this.statusCode || 200, JSON.stringify(obj), {
            'Content-Type': 'application/json; charset=utf-8',
            ...this.headers,
          });
        },
        end(data) {
          send(res, this.statusCode || 200, data || '', this.headers);
        },
      };
      await handler(vReq, vRes);
      return;
    }

    // static
    let rel = u.pathname === '/' ? '/index.html' : u.pathname;
    rel = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
    const file = path.join(PUBLIC, rel);
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      send(res, 404, 'Not Found', { 'Content-Type': 'text/plain; charset=utf-8' });
      return;
    }
    send(res, 200, fs.readFileSync(file), { 'Content-Type': contentType(file) });
  } catch (e) {
    send(res, 500, JSON.stringify({ status: 'error', message: String(e.message || e) }), {
      'Content-Type': 'application/json; charset=utf-8',
    });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Sm Vercel-like dev server: http://127.0.0.1:${PORT}/`);
  });
