// WhatsApp & Calls tab of the team dashboard (admin.html#comms).
// The Govianu Hub (MyOperator WhatsApp + calls, AI replies, reminders) runs as its own process on the VPS.
// This forwards the signed-in team member's requests to it, server to server, always for this site's brand,
// so the browser never sees the Hub key.
//   .env: HUB_URL=http://127.0.0.1:4100   HUB_API_KEY=<same value as in the Hub's .env>
//         ADMIN_VIEW_CODE=<secret code that unlocks everyone's records>
//
// Who sees what: one shared dashboard. Every team member sees all leads, chats, calls and recordings; whoever
// contacts a lead is shown on it ("contacted by X") and every action is kept under their name. Entering
// ADMIN_VIEW_CODE gives that person the admin view for 12 hours: everyone's performance numbers and timelines,
// reassigning, imports and the campaign.
const crypto = require('crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const { requireAuth } = require('../middleware/auth');
const rateLimit = require('../utils/rateLimit');

const BRAND = process.env.HUB_BRAND || 'rentmysite';
const ADMIN_COOKIE = 'hub_admin';
const ADMIN_HOURS = 12;
const router = express.Router();

router.use(requireAuth('admin'));
router.use(express.text({ type: 'text/*', limit: '25mb' })); // CSV lead uploads

function sameSecret(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

function hasAdminView(req) {
  try {
    const p = jwt.verify(req.cookies?.[ADMIN_COOKIE] || '', process.env.JWT_SECRET);
    return p.k === 'hub-admin' && String(p.id) === String(req.user._id) && Boolean(process.env.ADMIN_VIEW_CODE);
  } catch {
    return false;
  }
}

// Admin view: unlock with the code, or leave it
router.post('/admin-view', rateLimit(5, 15 * 60 * 1000), (req, res) => {
  const code = String(req.body?.code || '').trim();
  if (!process.env.ADMIN_VIEW_CODE) return res.status(503).json({ error: 'No admin code is set on the server (ADMIN_VIEW_CODE in .env)' });
  if (!code || !sameSecret(code, process.env.ADMIN_VIEW_CODE)) {
    console.warn(`[hub] wrong admin code from ${req.user.email}`);
    return res.status(403).json({ error: 'That admin code is not right' });
  }
  const token = jwt.sign({ id: String(req.user._id), k: 'hub-admin' }, process.env.JWT_SECRET, { expiresIn: `${ADMIN_HOURS}h` });
  res.cookie(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: ADMIN_HOURS * 3600 * 1000,
    path: '/api/hub',
  });
  console.log(`[hub] admin view opened by ${req.user.email}`);
  res.json({ ok: true, adminView: true, hours: ADMIN_HOURS });
});
router.delete('/admin-view', (req, res) => {
  res.clearCookie(ADMIN_COOKIE, { path: '/api/hub' });
  res.json({ ok: true, adminView: false });
});

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
  if (hasAdminView(req)) headers['X-Hub-Admin'] = '1';
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
