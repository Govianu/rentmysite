// Small in-memory limiter so the email-sending endpoints can't be used to spam inboxes.
const hits = new Map();
module.exports = (max, windowMs) => (req, res, next) => {
  const key = `${req.baseUrl}${req.path}:${req.ip}`;
  const now = Date.now();
  const list = (hits.get(key) || []).filter(t => now - t < windowMs);
  if (list.length >= max) return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' });
  list.push(now);
  hits.set(key, list);
  next();
};
