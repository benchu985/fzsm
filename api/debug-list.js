const { syncIndex } = require('../lib/cover-index-server');
// lightweight remote diagnostics for market list + one cover feature
const BASE = 'https://www.piupiuchan.top';
const PKG = 'io.piupiu.chat';
const SIG = '0290F67FD446FD51D54B8188880523EAFD74CB469CC58A880EE24333ED7AF004';

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const out = { ok: false, steps: [] };
  try {
    const body = {
      action: 'list', page: 1, page_size: 5, sort: '最新', tag: '', search: '',
      device_id: 'vercel-index-bot', app_platform: 'android', app_package_name: PKG,
      app_signature_sha256: SIG,
    };
    const r = await fetch(BASE + '/role_market.php', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'fzsm-index-bot/1.0',
        'Accept': 'application/json',
        'Origin': BASE,
        'Referer': BASE + '/',
      },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    out.steps.push({ step: 'list', status: r.status, body: text.slice(0, 500) });
    let data = null;
    try { data = JSON.parse(text); } catch (e) {}
    const items = data && data.data && data.data.items ? data.data.items : [];
    out.ids = items.map((x) => x.id);
    if (items[0] && items[0].cover_url) {
      const cover = items[0].cover_url;
      for (const url of [cover, BASE + '/proxy_image.php?url=' + encodeURIComponent(Buffer.from(cover, 'utf8').toString('base64'))]) {
        try {
          const ir = await fetch(url, { headers: { 'User-Agent': 'fzsm-index-bot/1.0' } });
          const buf = Buffer.from(await ir.arrayBuffer());
          out.steps.push({ step: 'img', url: url.slice(0, 120), status: ir.status, len: buf.length, head: buf.slice(0, 12).toString('hex') });
        } catch (e) {
          out.steps.push({ step: 'img', url: url.slice(0, 120), error: String(e.message || e) });
        }
      }
      try {
        const sharp = require('sharp');
        const ir = await fetch(cover, { headers: { 'User-Agent': 'fzsm-index-bot/1.0' } });
        const buf = Buffer.from(await ir.arrayBuffer());
        const meta = await sharp(buf, { animated: false, pages: 1, failOn: 'none' }).metadata();
        const raw = await sharp(buf, { animated: false, pages: 1, failOn: 'none' })
          .rotate().flatten({ background: { r: 255, g: 255, b: 255 } })
          .resize(32, 32, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        out.steps.push({ step: 'sharp', meta, rawW: raw.info.width, rawH: raw.info.height, channels: raw.info.channels, bytes: raw.data.length });
      } catch (e) {
        out.steps.push({ step: 'sharp', error: String(e && e.message || e) });
      }
    }
    out.ok = true;
    res.status(200).json(out);
  } catch (e) {
    out.error = String(e && e.message || e);
    res.status(500).json(out);
  }
};
module.exports.config = { maxDuration: 30 };
