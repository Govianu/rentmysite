// RentMySite.ai: owner, brand and partner enquiries, the owner's site report, sign-up with a type of space, and
// the owner mandate
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rms-'));
process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';

const mailer = require('../utils/mailer');
const sent = [];
mailer.sendMail = async m => { sent.push(m); return { sent: true }; };

const express = require('express');
const cookieParser = require('cookie-parser');
const { initialize } = require('../utils/jsonModel');
const User = require('../models/User');
const Lead = require('../models/Lead');
const { estimateFor } = require('../utils/spaces');
const { CTA_VERSION } = require('../utils/ctaFull');

let base, server;
async function call(method, url, body, cookie) {
  const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => ({})), cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
}
const codeIn = html => /letter-spacing:8px[^>]*>(\d{6})</.exec(html)[1];

test.before(async () => {
  initialize();
  const app = express();
  app.use(express.json()); app.use(cookieParser());
  for (const r of ['auth', 'enquiry', 'owner', 'growth']) app.use(`/api/${r}`, require(`../routes/${r}`));
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
  await new Promise(r => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
test.after(() => server?.close());

const owner = { role: 'owner', name: 'Ravi Kumar', email: 'ravi@example.com', phone: '9876543210', spaceType: 'Empty plot or open land',
  size: 20000, location: 'Hosur Road, Bengaluru', termsAccepted: true };

test('the estimate uses the deck figures: size x average rate of the uses, costs about 45%', () => {
  const e = estimateFor(20000);   // kiosks, dark store, EV parking, storage
  assert.equal(Math.round(e.revenue), 375000);
  assert.equal(Math.round(e.profit), 206250);
  assert.equal(Math.round(e.share50), 103125);
});

test('an owner enquiry gets a dashboard, an RMS lead ID, a first estimate by email, and the team is told', async () => {
  assert.equal((await call('POST', '/enquiry', { ...owner, termsAccepted: false })).status, 400);
  const r = await call('POST', '/enquiry', owner);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.hasDashboard, true);
  const u = await User.findOne({ email: 'ravi@example.com' });
  assert.equal(u.role, 'business');
  assert.equal(u.space.size, 20000);
  assert.match(u.leadId, /^RMS-[A-Z]{3}\d{2}-\d{2,}$/);
  assert.ok(await Lead.findOne({ leadId: u.leadId }));
  const mail = sent.find(m => m.to === 'ravi@example.com');
  assert.match(mail.html, /indicative estimate for 20,000 sq ft/);
  assert.match(mail.html, /₹1,59,500 a month to you at the standard 50% tier/, 'the same figure as the dashboard: best uses for an empty plot');
  assert.ok(!mail.html.includes(u.leadId), 'the lead ID stays with the team');
  const team = sent.find(m => m.to === 'info@rentmysite.ai');
  assert.match(team.subject, new RegExp(`\\[${u.leadId}\\] New enquiry: A space owner`));
});

test('a brand gets a brand dashboard; a partner reaches the team without an account', async () => {
  const b = await call('POST', '/enquiry', { role: 'brand', name: 'Asha', email: 'asha@brand.com', phone: '9876500000', format: 'Food kiosk court', size: 300, location: 'Whitefield', termsAccepted: true });
  assert.equal(b.status, 201);
  assert.equal((await User.findOne({ email: 'asha@brand.com' })).role, 'buyer');
  const p = await call('POST', '/enquiry', { role: 'partner', name: 'Kiran', email: 'kiran@agent.com', phone: '9876511111', location: 'Sarjapur Road', termsAccepted: true });
  assert.equal(p.status, 201);
  assert.equal(p.body.hasDashboard, false);
  assert.equal(await User.findOne({ email: 'kiran@agent.com' }), null);
  assert.ok(await Lead.findOne({ email: 'kiran@agent.com' }), 'but a lead is created');
});

test('the owner sees their site report and journey, updates the space, and signs the mandate', async () => {
  const code = codeIn(sent.filter(m => m.to === 'ravi@example.com').pop().html);
  const v = await call('POST', '/auth/verify-otp', { email: 'ravi@example.com', code });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  const r = await call('GET', '/owner/report', null, v.cookie);
  assert.equal(r.status, 200);
  assert.equal(r.body.estimate.revenue, 580000, 'kiosks, EV parking, markets and courts on an empty plot');
  assert.equal(r.body.estimate.tiers.map(t => t.amount).join(','), '111650,159500,207350');
  assert.equal(r.body.journey[0].state, 'now');
  assert.ok(r.body.bestUses.some(u => u.name === 'Food kiosk court'));

  const up = await call('POST', '/owner/space', { type: 'Terrace or rooftop', size: 5000, road: 'inner', location: 'Jayanagar' }, v.cookie);
  assert.equal(up.status, 200);
  assert.ok(up.body.bestUses.some(u => u.name === 'Weekend markets and events'), 'best uses follow the type of space');
  assert.equal((await call('POST', '/owner/space', { type: 'Castle' }, v.cookie)).status, 400);

  const m = await call('GET', '/growth/my-cta', null, v.cookie);
  assert.equal(m.body.full.version, CTA_VERSION);
  assert.ok(m.body.full.dealSheet.some(([k, val]) => k === 'What this is' && /mandate, not a lease/.test(val)));
  const ok = await call('POST', '/growth/cta/accept', { version: CTA_VERSION, agreeAll: true, name: 'Ravi Kumar', designation: 'Owner' }, v.cookie);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.ok(sent.some(m2 => m2.to === 'ravi@example.com' && /owner mandate/.test(m2.subject)));
  const after = await call('GET', '/owner/report', null, v.cookie);
  assert.equal(after.body.journey[3].state, 'now', 'after signing, the next step is approving the plan');
});

test('signing up on the sign-up page as an owner records the type of space', async () => {
  const r = await call('POST', '/auth/signup', { role: 'business', name: 'Meera', email: 'meera@example.com', phone: '9876522222', businessName: 'Rooftop in Indiranagar', category: 'terrace', location: 'Indiranagar', termsAccepted: true });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const u = await User.findOne({ email: 'meera@example.com' });
  assert.equal(u.space.type, 'Terrace or rooftop');
  const mail = sent.filter(m => m.to === 'meera@example.com').pop();
  assert.doesNotMatch(mail.html, /5 ways to earn/, 'no Partnermybusiness plan in the email');
});
