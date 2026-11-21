// The RentMySite team can delete leads (e.g. test sign-ups), with or without the accounts behind them
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pmb-leaddel-'));
process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';

const express = require('express');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { initialize } = require('../utils/jsonModel');
const User = require('../models/User');
const Lead = require('../models/Lead');
const Enquiry = require('../models/Enquiry');

let base, server;
async function call(method, url, user, body) {
  const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET)}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

test.before(async () => {
  initialize();
  const app = express();
  app.use(express.json()); app.use(cookieParser());
  app.use('/api/admin', require('../routes/admin'));
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
  await new Promise(r => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
test.after(() => server?.close());

test('team deletes test leads, and with accounts the dashboards go too; team accounts are never deleted', async () => {
  const team = await User.create({ role: 'admin', name: 'Ops', email: 'ops@govianu.com', status: 'approved' });
  const t1 = await User.create({ role: 'business', name: 'Test One', email: 'test1@example.com', status: 'approved', business: { businessName: 'Test Cafe' } });
  const t2 = await User.create({ role: 'business', name: 'Test Two', email: 'test2@example.com', status: 'approved', business: { businessName: 'Test Bakery' } });
  const keep = await User.create({ role: 'business', name: 'Real', email: 'real@example.com', status: 'approved', business: { businessName: 'Real Hall' } });
  const l1 = await Lead.create({ name: 'Test One', email: 'test1@example.com', source: 'signup', relatedUser: t1._id });
  const l2 = await Lead.create({ name: 'Test Two', email: 'test2@example.com', source: 'signup', relatedUser: t2._id });
  const l3 = await Lead.create({ name: 'Real', email: 'real@example.com', source: 'signup', relatedUser: keep._id });
  const lt = await Lead.create({ name: 'Ops', source: 'signup', relatedUser: team._id });
  await Enquiry.create({ role: 'host', name: 'Test One', email: 'test1@example.com', termsAccepted: true, termsVersion: 't', termsAcceptedAt: new Date().toISOString() });

  assert.equal((await call('POST', '/admin/leads/delete', t1, { ids: [l1._id] })).status, 403, 'only the team can delete');
  assert.equal((await call('POST', '/admin/leads/delete', team, { ids: [] })).status, 400);

  const onlyLead = await call('POST', '/admin/leads/delete', team, { ids: [l2._id] });
  assert.deepEqual(onlyLead.body, { leads: 1, accounts: 0 });
  assert.ok(await User.findById(t2._id), 'without the option, the account stays');

  const both = await call('POST', '/admin/leads/delete', team, { ids: [l1._id, lt._id], withAccounts: true });
  assert.deepEqual(both.body, { leads: 2, accounts: 1 });
  assert.equal(await User.findById(t1._id), null, 'the test account is gone');
  assert.equal((await Enquiry.find({ email: 'test1@example.com' })).length, 0, 'and its enquiries');
  assert.ok(await User.findById(team._id), 'a team account is never deleted');
  assert.ok(await Lead.findById(l3._id) && await User.findById(keep._id), 'other leads are untouched');
});
