// Passwordless sign-in for @govianu.com staff: 6-digit code by email, JWT cookie.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { db, save, uid, now } = require('./store');
const { sendMail, mailConfigured } = require('./mail');

const SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
const DOMAIN = (process.env.STAFF_EMAIL_DOMAIN || 'govianu.com').toLowerCase();
const ADMINS = (process.env.ADMIN_EMAILS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
const COOKIE = 'hub_session';
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');

if (process.env.NODE_ENV === 'production' && SECRET === 'dev-only-secret-change-me') {
  throw new Error('Set JWT_SECRET in .env before running in production');
}

function checkEmail(raw) {
  const email = String(raw || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw Object.assign(new Error('Enter a valid email'), { status: 400 });
  if (!email.endsWith('@' + DOMAIN) && !ADMINS.includes(email)) {
    throw Object.assign(new Error(`Only @${DOMAIN} team emails can sign in`), { status: 403 });
  }
  return email;
}

async function requestCode(rawEmail) {
  const email = checkEmail(rawEmail);
  const last = db.otps[email];
  if (last && now() - last.sentAt < 30_000) throw Object.assign(new Error('Wait 30 seconds before asking for a new code'), { status: 429 });
  const code = String(crypto.randomInt(100000, 1000000));
  db.otps[email] = { hash: hash(code), exp: now() + 10 * 60_000, attempts: 0, sentAt: now() };
  save();
  await sendMail(email, `Your Govianu Hub code: ${code}`, `Your sign-in code is ${code}. It expires in 10 minutes.`);
  // Local testing only: show the code when no email server is configured.
  const devCode = !mailConfigured() && process.env.NODE_ENV !== 'production' ? code : undefined;
  return { sent: true, devCode };
}

function verifyCode(rawEmail, code) {
  const email = checkEmail(rawEmail);
  const o = db.otps[email];
  if (!o || o.exp < now()) throw Object.assign(new Error('Code expired – ask for a new one'), { status: 400 });
  if (o.attempts >= 5) throw Object.assign(new Error('Too many attempts – ask for a new code'), { status: 429 });
  o.attempts++;
  if (o.hash !== hash(String(code || '').trim())) {
    save();
    throw Object.assign(new Error('Wrong code'), { status: 400 });
  }
  delete db.otps[email];
  let emp = db.employees.find((e) => e.email === email);
  const isFirst = db.employees.length === 0;
  if (!emp) {
    emp = {
      id: uid(),
      email,
      name: email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      role: ADMINS.includes(email) || isFirst ? 'admin' : 'employee',
      phone: '',
      myopUserId: '',
      brands: ['rentmysite', 'pmb'],
      active: true,
      createdAt: now(),
    };
    db.employees.push(emp);
  } else if (ADMINS.includes(email)) emp.role = 'admin';
  emp.lastLoginAt = now();
  save();
  return jwt.sign({ id: emp.id }, SECRET, { expiresIn: '30d' });
}

function setCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 86400_000,
    path: '/',
  });
}

// The rentmysite / partnermybusiness servers call the Hub on behalf of their signed-in team member:
// X-Hub-Key (shared secret, server-to-server only) + X-Hub-Actor (that person's @govianu.com email).
function siteActor(req) {
  const key = process.env.HUB_API_KEY;
  const got = req.get('x-hub-key');
  if (!key || !got) return undefined;
  const a = Buffer.from(String(got));
  const b = Buffer.from(key);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const email = String(req.get('x-hub-actor') || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) return null;
  let emp = db.employees.find((e) => e.email === email);
  if (!emp) {
    emp = {
      id: uid(),
      email,
      name: String(req.get('x-hub-actor-name') || email.split('@')[0]).slice(0, 80),
      role: ADMINS.includes(email) ? 'admin' : 'employee',
      phone: '',
      myopUserId: '',
      brands: ['rentmysite', 'pmb'],
      active: true,
      createdAt: now(),
    };
    db.employees.push(emp);
    save();
  }
  return emp.active === false ? null : emp;
}

function requireUser(req, res, next) {
  const viaSite = siteActor(req);
  if (viaSite === null) return res.status(401).json({ error: 'Hub key or team member not accepted' });
  if (viaSite) {
    req.user = viaSite;
    // From the websites, everyone sees only their own records unless the site confirmed the admin code
    // for this person (X-Hub-Admin is only accepted together with the server-to-server key).
    req.isAdmin = req.get('x-hub-admin') === '1';
    return next();
  }
  try {
    const { id } = jwt.verify(req.cookies?.[COOKIE] || '', SECRET);
    const emp = db.employees.find((e) => e.id === id && e.active !== false);
    if (!emp) throw new Error('no user');
    req.user = emp;
    req.isAdmin = emp.role === 'admin';
    next();
  } catch {
    res.status(401).json({ error: 'Please sign in' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.isAdmin) return res.status(403).json({ error: 'Admin view only – enter the admin code' });
  next();
}

module.exports = { requestCode, verifyCode, setCookie, requireUser, requireAdmin, COOKIE };
