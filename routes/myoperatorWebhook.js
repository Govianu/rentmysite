// MyOperator Webhooks v2 → Govianu Hub.
// MyOperator only calls public https:// addresses, and this site already has one, so the webhook URL is
//   https://<this site>/api/myoperator-webhook   with the header X-Webhook-Token: <MYOP_WEBHOOK_TOKEN from the Hub .env>
// This passes each event, untouched, to the Hub on this server (HUB_URL). The Hub checks the token.
const express = require('express');

const router = express.Router();

router.post('/', async (req, res) => {
  const base = (process.env.HUB_URL || '').replace(/\/$/, '');
  if (!base) return res.status(503).json({ error: 'HUB_URL is not set' });
  try {
    const r = await fetch(base + '/api/webhooks/myoperator', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Webhook-Token': req.get('x-webhook-token') || String(req.query.token || '') },
      body: JSON.stringify(req.body ?? {}),
    });
    res.status(r.status).type('application/json').send(await r.text());
  } catch (err) {
    console.error('[myoperator-webhook] hub not reachable:', err.message);
    res.status(502).json({ error: 'Hub not reachable' });
  }
});

module.exports = router;
