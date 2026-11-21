const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { isStaffEmail } = require('../utils/staff');

const COOKIE = 'pmb_token';

function issueToken(res, user) {
  const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
}

// requireAuth() -> any logged-in user; requireAuth('admin') -> admins only
function requireAuth(...roles) {
  return async (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = req.cookies[COOKIE] || (header.startsWith('Bearer ') ? header.slice(7) : null);
    if (!token) return res.status(401).json({ error: 'Log in to continue' });

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'Your session has expired. Log in again.' });
    }
    const user = await User.findById(payload.id);
    if (!user) return res.status(401).json({ error: 'Account not found' });
    // The RentMySite team dashboard is only for Govianu employees, even if an older team account has another email
    if (user.role === 'admin' && !isStaffEmail(user.email)) {
      return res.status(403).json({ error: 'The RentMySite team area is only for Govianu employees' });
    }
    if (roles.length && !roles.includes(user.role)) {
      return res.status(403).json({ error: 'This area is for a different account type' });
    }
    req.user = user;
    next();
  };
}

module.exports = { requireAuth, issueToken, COOKIE };
