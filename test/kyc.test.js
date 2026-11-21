// KYC in the Profile: Aadhaar (last 4 digits only), PAN and bank details with documents, private to the owner
// and the RentMySite team, and needed before booking.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pmb-kyc-'));
process.env.UPLOAD_DIR = path.join(process.env.DATA_DIR, 'uploads');
process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';

const mailer = require('../utils/mailer');
const sent = [];
mailer.sendMail = async m => { sent.push(m); return { sent: true }; };

const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const { initialize } = require('../utils/jsonModel');
const User = require('../models/User');
const { validAadhaar } = require('../utils/kyc');

let base, server;
const auth = u => ({ authorization: `Bearer ${jwt.sign({ id: u._id, role: u.role }, process.env.JWT_SECRET)}` });
async function call(method, url, user, body) {
  const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(user ? auth(user) : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function upload(url, user, bytes, name) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: name.endsWith('.pdf') ? 'application/pdf' : 'image/png' }), name);
  const res = await fetch(base + url, { method: 'POST', headers: auth(user), body: form });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(32)]);

test.before(async () => {
  initialize();
  const app = express();
  app.use(express.json()); app.use(cookieParser());
  app.use('/api/kyc', require('../routes/kyc'));
  app.use('/api/auth', require('../routes/auth'));
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
  await new Promise(r => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
test.after(() => server?.close());

test('Aadhaar numbers are checked, and only the last 4 digits are kept', async () => {
  assert.equal(validAadhaar('234567890124'), true);
  assert.equal(validAadhaar('234567890123'), false, 'a typo fails the check digit');
  const u = await User.create({ role: 'business', name: 'Ravi', email: 'ravi@example.com', status: 'approved', business: { businessName: 'Ravi Hall' } });
  assert.equal((await call('POST', '/kyc/details', u, { aadhaar: '2345 6789 0123' })).status, 400);
  const r = await call('POST', '/kyc/details', u, { aadhaar: '2345 6789 0124', pan: 'abcde1234f', accountName: 'Ravi Kumar', accountNumber: '50100123456789', ifsc: 'hdfc0001234' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.kyc.aadhaar, '•••• •••• 0124');
  assert.equal(r.body.kyc.accountNumber, '••••••••••6789');
  assert.equal(r.body.kyc.complete, false, 'documents still missing');
  const saved = await User.findById(u._id);
  assert.equal(saved.kyc.aadhaarLast4, '0124');
  assert.ok(!JSON.stringify(saved.kyc).includes('234567890124'), 'the full Aadhaar number is never stored');
  assert.equal(saved.toJSON().kyc, undefined, 'KYC never goes out with the account');
});

test('documents upload privately; KYC is complete once all are in; the team can view and verify', async () => {
  const u = await User.findOne({ email: 'ravi@example.com' });
  assert.equal((await upload('/kyc/docs/aadhaar', u, Buffer.from('not an image'), 'x.png')).status, 400);
  for (const kind of ['aadhaar', 'pan', 'bank']) assert.equal((await upload(`/kyc/docs/${kind}`, u, PNG, `${kind}.png`)).status, 200);
  const me = await call('GET', '/kyc', u);
  assert.equal(me.body.kyc.complete, true, JSON.stringify(me.body.kyc.missing));
  const doc = await fetch(`${base}/kyc/docs/pan`, { headers: auth(u) });
  assert.equal(doc.status, 200); assert.equal(doc.headers.get('cache-control'), 'private, no-store');

  const other = await User.create({ role: 'buyer', name: 'Asha', email: 'asha@example.com', status: 'approved' });
  assert.equal((await fetch(`${base}/kyc/docs/pan?user=${u._id}`, { headers: auth(other) })).status, 404, 'others cannot see it');
  const team = await User.create({ role: 'admin', name: 'Ops', email: 'ops@govianu.com', status: 'approved' });
  assert.equal((await fetch(`${base}/kyc/docs/pan?user=${u._id}`, { headers: auth(team) })).status, 200, 'the RentMySite team can');
  const v = await call('POST', `/kyc/user/${u._id}/verify`, team);
  assert.ok(v.body.kyc.verifiedAt);
  assert.equal((await call('POST', `/kyc/user/${u._id}/verify`, other)).status, 403);
});

test('"All filled, send to RentMySite" emails info@ with the documents, and it shows in the team KYC tab', async () => {
  assert.equal(sent.filter(m => /KYC/.test(m.subject)).length, 0, 'nothing is sent while they are still filling it in');
  const half = await User.create({ role: 'associate', name: 'Half Done', email: 'half@example.com', status: 'approved' });
  const no = await call('POST', '/kyc/submit', half);
  assert.equal(no.status, 400); assert.match(no.body.error, /Fill in everything first/);

  const u = await User.findOne({ email: 'ravi@example.com' });
  const r = await call('POST', '/kyc/submit', u);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.kyc.submittedAt);
  const toTeam = sent.filter(m => String(m.to).includes('info@rentmysite.ai'));
  assert.equal(toTeam.length, 1, 'one email, when they press the button');
  const last = toTeam[0];
  assert.match(last.subject, /KYC (complete|updated): Ravi Hall/);
  assert.match(last.html, /ABCDE1234F/); assert.match(last.html, /50100123456789/); assert.match(last.html, /Last 4 digits: 0124/);
  assert.equal(last.attachments.length, 3, 'Aadhaar, PAN and bank documents attached');
  // Changing anything afterwards means sending again
  await call('POST', '/kyc/details', u, { bankName: 'HDFC Bank' });
  assert.equal((await call('GET', '/kyc', u)).body.kyc.submittedAt, null);

  const team = await User.findOne({ email: 'ops@govianu.com' });
  const all = await call('GET', '/kyc/all', team);
  assert.equal(all.status, 200);
  const row = all.body.partners.find(p => p.email === 'ravi@example.com');
  assert.equal(row.kyc.pan, 'ABCDE1234F'); assert.equal(row.kyc.verifiedAt, null, 'changed after checking: the team checks it again');
  const other = await User.findOne({ email: 'asha@example.com' });
  assert.equal((await call('GET', '/kyc/all', other)).status, 403);
});
