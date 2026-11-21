// RentMySite team sign-in (team.html): only Govianu emails, a code to that inbox, and the code opens the team dashboard.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pmb-team-'));
process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';

const mailer = require('../utils/mailer');
const sent = [];
mailer.sendMail = async m => { sent.push(m); return { sent: true }; };
const codeIn = m => /letter-spacing:8px[^>]*>(\d{6})</.exec(m.html)[1];

const express = require('express');
const cookieParser = require('cookie-parser');
const { initialize } = require('../utils/jsonModel');
const User = require('../models/User');
const Lead = require('../models/Lead');

let base, server;
async function call(method, url, body, cookie) {
  const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => ({})), cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
}

test.before(async () => {
  initialize();
  const app = express();
  app.use(express.json()); app.use(cookieParser()); app.use(require('../middleware/methodOverride'));
  app.use('/api/auth', require('../routes/auth'));
  app.use('/api/admin', require('../routes/admin'));
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
  await new Promise(r => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
test.after(() => server?.close());

test('only Govianu emails can ask for a team sign-in code', async () => {
  const r = await call('POST', '/auth/team/request-otp', { email: 'someone@gmail.com' });
  assert.equal(r.status, 403);
  assert.equal(sent.length, 0);
  assert.equal((await User.find({ email: 'someone@gmail.com' })).length, 0, 'no account created');
});

test('a Govianu email gets a code that opens the RentMySite team dashboard', async () => {
  const r = await call('POST', '/auth/team/request-otp', { email: 'Priya.Sharma@govianu.com' });
  assert.equal(r.status, 200);
  const mail = sent.at(-1);
  assert.equal(mail.to, 'priya.sharma@govianu.com');
  assert.match(mail.subject, /RentMySite team dashboard sign-in code/);

  const signedIn = await call('POST', '/auth/verify-otp', { email: 'priya.sharma@govianu.com', code: codeIn(mail) });
  assert.equal(signedIn.status, 200);
  assert.equal(signedIn.body.user.role, 'admin');
  assert.equal(signedIn.body.user.name, 'Priya Sharma');
  assert.equal((await call('GET', '/admin/market', null, signedIn.cookie)).status, 200, 'team dashboard opens');

  // Signing in again uses the same team account
  await call('POST', '/auth/team/request-otp', { email: 'priya.sharma@govianu.com' });
  assert.equal((await User.find({ email: 'priya.sharma@govianu.com', role: 'admin' })).length, 1);
});

test('a Govianu employee who is also a partner gets the team dashboard from team sign-in', async () => {
  await User.create({ role: 'business', name: 'Ravi', email: 'ravi@govianu.com', status: 'approved', business: { businessName: 'Ravi Cafe' } });
  sent.length = 0;
  await call('POST', '/auth/team/request-otp', { email: 'ravi@govianu.com' });
  const r = await call('POST', '/auth/verify-otp', { email: 'ravi@govianu.com', code: codeIn(sent[0]) });
  assert.equal(r.body.user.role, 'admin');
});

test('the team moves a lead and changes a profile, sent as POST like the live site (no proof link needed)', async () => {
  sent.length = 0;
  await call('POST', '/auth/team/request-otp', { email: 'priya.sharma@govianu.com' });
  const { cookie } = await call('POST', '/auth/verify-otp', { email: 'priya.sharma@govianu.com', code: codeIn(sent[0]) });
  const lead = await Lead.create({ name: 'Mint Masala', source: 'enquiry', stage: 'new', history: [] });
  const asPost = (url, body, method) => fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-http-method-override': method, cookie }, body: JSON.stringify(body) });

  const moved = await asPost(`/admin/leads/${lead._id}`, { stage: 'contacted', note: 'Called' }, 'PATCH');
  assert.equal(moved.status, 200, 'stage changes without a proof link');
  assert.equal((await Lead.findById(lead._id)).stage, 'contacted');

  const partner = await User.create({ role: 'business', name: 'Sana', email: 'sana.team@example.com', business: { businessName: 'Sana Salon' } });
  assert.equal(partner.status, 'approved', 'new partners are live straight away');
  const priya = await User.findOne({ email: 'priya.sharma@govianu.com' });
  const assigned = await asPost(`/admin/users/${partner._id}`, { assignedManager: priya._id }, 'PATCH');
  assert.equal(assigned.status, 200, 'profiles update too');
});
