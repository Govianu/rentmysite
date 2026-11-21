// One-time links: the "Open my dashboard" buttons in sign-up, CTA, code and opportunity emails (purpose 'signin'),
// and older activation links. Each link opens one exact dashboard, works once, and expires.
// Several can be active at once (e.g. the welcome email and the CTA email), so one doesn't cancel another.
// Only a SHA-256 hash of each token is stored, so a leaked data file can't be used to log in.
const crypto = require('crypto');
const { APP_URL } = require('./emails');

const TTL_MS = 72 * 60 * 60 * 1000;
const SIGNIN_TTL_MS = 24 * 60 * 60 * 1000;   // the button in an email
const MAX_ACTIVE = 8;
const hash = token => crypto.createHash('sha256').update(String(token)).digest('hex');
const live = t => t && t.hash && new Date(t.expires) > new Date();

async function issueLink(user, purpose = 'activate', ttlMs = purpose === 'signin' ? SIGNIN_TTL_MS : TTL_MS) {
  const token = crypto.randomBytes(32).toString('hex');
  const entry = { hash: hash(token), expires: new Date(Date.now() + ttlMs).toISOString(), purpose };
  user.linkTokens = [...(user.linkTokens || []).filter(live), entry].slice(-MAX_ACTIVE);
  user.linkTokenPurpose = purpose;
  await user.save();
  return `${APP_URL()}/activate?token=${token}`;
}

async function findByToken(User, token) {
  if (!/^[a-f0-9]{64}$/.test(String(token || ''))) return null;
  const h = hash(token);
  // Older single-token accounts
  const legacy = await User.findOne({ linkTokenHash: h });
  if (legacy && legacy.linkTokenExpires && new Date(legacy.linkTokenExpires) > new Date()) return legacy;
  const user = (await User.find({})).find(u => (u.linkTokens || []).some(t => t.hash === h && live(t)));
  if (user) user.linkTokenPurpose = (user.linkTokens.find(t => t.hash === h) || {}).purpose || user.linkTokenPurpose;
  return user || null;
}

// After a link is used: that link stops working; the others stay valid
function spendLink(user, token) {
  const h = hash(token);
  user.linkTokens = (user.linkTokens || []).filter(t => t.hash !== h && live(t));
  if (user.linkTokenHash === h) { user.linkTokenHash = null; user.linkTokenExpires = null; }
}

module.exports = { issueLink, findByToken, spendLink };
