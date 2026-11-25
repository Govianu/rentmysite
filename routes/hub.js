// WhatsApp & Calls tab of the team dashboard (admin.html#comms).
// The Govianu Hub (MyOperator WhatsApp + calls, AI replies, reminders) runs as its own process on the VPS.
// This forwards the signed-in team member's requests to it, server to server, always for this site's brand,
// so the browser never sees the Hub key.
//   .env: HUB_URL=http://127.0.0.1:4100   HUB_API_KEY=<same value as in the Hub's .env>
const express = require('express');
const { requireAuth } = require('../middleware/auth');

const BRAND = process.env.HUB_BRAND || 'rentmysite';
const router = express.Router();

router.use(requireAuth('admin'));
router.use(express.text({ type: 'text/*', limit: '25mb' })); // CSV lead uploads

router.use(async (req, res) => {
  const base = (process.env.HUB_URL || '').replace(/\/$/, '');
  if (!base || !process.env.HUB_API_KEY) {
    return res.status(503).json({ error: 'WhatsApp & Calls is not connected yet: set HUB_URL and HUB_API_KEY in .env' });
  }
  const url = new URL(base + '/api' + req.path);
  for (const [k, v] of Object.entries(req.query)) if (k !== 'brand') url.searchParams.set(k, String(v));
  url.searchParams.set('brand', BRAND);

  const headers = {
    'X-Hub-Key': process.env.HUB_API_KEY,
    'X-Hub-Actor': req.user.email,
    'X-Hub-Actor-Name': req.user.name || '',
    Accept: 'application/json',
  };
  let body;
  if (!['GET', 'HEAD'].includes(req.method)) {
    if (typeof req.body === 'string') {
      headers['Content-Type'] = 'text/csv';
      body = req.body;
    } else {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify({ ...(req.body || {}), brand: BRAND });
    }
  }

  try {
    const r = await fetch(url, { method: req.method, headers, body, redirect: 'manual' });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) return res.redirect(r.headers.get('location')); // call recordings
    res.status(r.status).type(r.headers.get('content-type') || 'application/json').send(await r.text());
  } catch (err) {
    console.error('[hub] not reachable:', err.message);
    res.status(502).json({ error: 'The Govianu Hub is not running (pm2 status govianu-hub)' });
  }
});

module.exports = router;
