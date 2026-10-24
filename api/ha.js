/* ==========================================================================
   /api/ha — server-side proxy from Home Deck to Home Assistant (Vercel function)

   The HA token lives only here, in Vercel's environment variables:
     NABU_CASA_URL  https://xxxx.ui.nabu.casa
     HA_TOKEN       Home Assistant long-lived access token
     APP_KEY        any long random string; the glasses send it to prove it's you

   Only the calls the app needs are allowed through.
   ========================================================================== */
const crypto = require('crypto');

const SERVICE_DOMAINS = new Set([
  'light', 'switch', 'fan', 'climate', 'scene', 'script',
  'media_player', 'remote', 'homeassistant',
]);

function isAllowed(method, path) {
  if (path === 'states') return method === 'GET';
  if (path === 'template') return method === 'POST';
  const m = /^services\/([a-z_]+)\/([a-z_]+)$/.exec(path);
  return method === 'POST' && !!m && SERVICE_DOMAINS.has(m[1]);
}

function keyMatches(given, expected) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(String(expected || ''));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const { NABU_CASA_URL, HA_TOKEN, APP_KEY } = process.env;

  if (!NABU_CASA_URL || !HA_TOKEN || !APP_KEY) {
    return res.status(500).json({ error: 'Server setup incomplete: set NABU_CASA_URL, HA_TOKEN and APP_KEY' });
  }
  if (!keyMatches(req.headers['x-app-key'], APP_KEY)) {
    return res.status(401).json({ error: 'App key missing or wrong' });
  }

  const path = String(req.query.path || '');
  if (!isAllowed(req.method, path)) {
    return res.status(403).json({ error: 'Not allowed' });
  }

  try {
    const upstream = await fetch(`${NABU_CASA_URL.replace(/\/+$/, '')}/api/${path}`, {
      method: req.method,
      headers: { Authorization: `Bearer ${HA_TOKEN}`, 'Content-Type': 'application/json' },
      body: req.method === 'POST' ? JSON.stringify(req.body ?? {}) : undefined,
    });
    const text = await upstream.text();

    if (upstream.status === 401) {
      return res.status(502).json({ error: 'Home Assistant rejected the token' });
    }
    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
    return res.send(text);
  } catch (err) {
    return res.status(502).json({ error: 'Can’t reach Home Assistant' });
  }
};
