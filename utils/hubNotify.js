// Tell the Govianu Hub about website events (new enquiry, plot uploaded/approved), server to server.
// Never blocks or breaks the website: errors are logged and ignored. Needs HUB_URL + HUB_API_KEY in .env.
async function notifyHub(event) {
  const base = String(process.env.HUB_URL || '').replace(/\/$/, '');
  if (!base || !process.env.HUB_API_KEY) return null;
  try {
    const r = await fetch(`${base}/api/site-event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hub-Key': process.env.HUB_API_KEY },
      body: JSON.stringify({ brand: process.env.HUB_BRAND || 'rentmysite', ...event }),
      signal: AbortSignal.timeout(15000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) console.error('[hub notify]', event.type, r.status, j.error || '');
    return j;
  } catch (e) {
    console.error('[hub notify]', event.type, e.message);
    return null;
  }
}

module.exports = { notifyHub };
