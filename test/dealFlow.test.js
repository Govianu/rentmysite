// End to end through the real routes: seller publishes -> buyer requests -> seller accepts (match)
// -> RentMySite team approves -> RentMySite share received -> matched. Also checks that only Govianu staff reach the RentMySite team routes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pmb-deal-'));
process.env.JWT_SECRET = 'test-secret';
process.env.TEAM_INBOX = 'info@rentmysite.ai';
delete process.env.RAZORPAY_KEY_ID; delete process.env.RAZORPAY_KEY_SECRET;

// Capture emails instead of sending them (must be patched before the routes load)
const mailer = require('../utils/mailer');
const sent = [];
mailer.sendMail = async m => { sent.push(m); return { sent: true }; };

const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const { initialize } = require('../utils/jsonModel');
const User = require('../models/User');

let base, server;
const tokenFor = u => jwt.sign({ id: u._id, role: u.role }, process.env.JWT_SECRET);
async function call(method, url, user, body) {
  const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(user ? { authorization: `Bearer ${tokenFor(user)}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const mailsTo = to => sent.filter(m => m.to === to);

test.before(async () => {
  initialize();
  const app = express();
  app.use(express.json()); app.use(cookieParser());
  app.use('/api/admin', require('../routes/admin'));
  app.use('/api/market', require('../routes/market').router);
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
  await new Promise(r => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
test.after(() => server?.close());

test('seller publishes, buyer requests, RentMySite approves and collects its share, then it is a match', async () => {
  const seller = await User.create({ role: 'business', name: 'Ravi Kumar', email: 'ravi@example.com', phone: '+91 90000 00001', status: 'approved', location: 'indiranagar', business: { businessName: 'Ravi Hall' } });
  const buyer = await User.create({ role: 'buyer', name: 'Asha Rao', email: 'asha@example.com', phone: '+91 90000 00002', status: 'approved', buyer: { type: 'company' } });
  const staff = await User.create({ role: 'admin', name: 'RentMySite Ops', email: 'ops@govianu.com', status: 'approved' });
  // Booking needs KYC on both sides (utils/kyc.js): without it the request is refused
  const KYC = { aadhaarLast4: '9012', pan: 'ABCDE1234F', accountName: 'Test', accountNumber: '123456789012', ifsc: 'HDFC0001234',
    docs: { aadhaar: { key: 'a.jpg' }, pan: { key: 'p.jpg' }, bank: { key: 'b.jpg' } } };
  seller.kyc = KYC; await seller.save();

  // 1. Publish: live straight away and the team inbox is told
  const pub = await call('POST', '/market/my/listings', seller, { title: 'Banquet hall, weekday mornings', price: 20000, priceUnit: 'slot', capacity: 120 });
  assert.equal(pub.status, 201);
  assert.equal(pub.body.listing.status, 'live');
  assert.match(mailsTo('info@rentmysite.ai').at(-1).subject, /New opportunity published/);
  const browse = await call('GET', '/market/listings', buyer);
  assert.ok(browse.body.listings.some(l => l.id === pub.body.listing.id), 'buyers can see it');

  // 2. Buyer requests: goes straight to the seller, no contact details shared
  const blocked = await call('POST', '/market/requests', buyer, { listingId: pub.body.listing.id, purpose: 'Product launch', people: 80, budget: 40000 });
  assert.equal(blocked.status, 403, 'no booking before KYC');
  assert.match(blocked.body.error, /KYC.*Aadhaar number.*PAN/);
  buyer.kyc = KYC; await buyer.save();
  const req = await call('POST', '/market/requests', buyer, { listingId: pub.body.listing.id, purpose: 'Product launch', people: 80, budget: 40000 });
  assert.equal(req.status, 201);
  const id = req.body.bookingId;
  let incoming = await call('GET', '/market/my/incoming', seller);
  assert.equal(incoming.body.requests[0].status, 'requested');
  assert.equal(incoming.body.requests[0].buyer, undefined, 'no buyer contact details');

  // 3. Seller accepts: a match, sent to the RentMySite team for approval
  sent.length = 0;
  assert.equal((await call('POST', `/market/my/incoming/${id}/accept`, seller, { agreementAccepted: true })).body.status, 'pending_approval');
  assert.match(mailsTo('info@rentmysite.ai')[0].subject, /Approve match/);

  // 4. RentMySite approves with the final amount; share requested from the seller (4-way split: 25%)
  sent.length = 0;
  const appr = await call('POST', `/admin/market/requests/${id}/approve`, staff, { amount: 40000, splitModel: 'four_way', sharePayer: 'seller' });
  assert.equal(appr.body.status, 'awaiting_payment');
  assert.equal(appr.body.pmbShare, 10000);
  assert.ok(mailsTo('ravi@example.com').some(m => /Pay the RentMySite share/.test(m.subject)));
  incoming = await call('GET', '/market/my/incoming', seller);
  assert.equal(incoming.body.requests[0].share.amount, 10000);
  assert.equal(incoming.body.requests[0].buyer, undefined, 'still no contact details');

  // 5. Share received without a reference is refused; with one, it's a match and both sides get details
  assert.equal((await call('POST', `/admin/market/requests/${id}/share-received`, staff, {})).status, 400);
  sent.length = 0;
  assert.equal((await call('POST', `/admin/market/requests/${id}/share-received`, staff, { reference: 'UTR123' })).body.status, 'matched');
  // It's a match, but no direct contact: neither side ever gets the other's email or phone
  const buyerMatch = mailsTo('asha@example.com').find(m => /match/.test(m.subject));
  const sellerMatch = mailsTo('ravi@example.com').find(m => /match/.test(m.subject));
  assert.ok(buyerMatch && sellerMatch, 'both told it is a match');
  assert.ok(!/ravi@example\.com|90000 00001/.test(buyerMatch.html), 'buyer does not get the seller’s details');
  assert.ok(!/asha@example\.com|90000 00002/.test(sellerMatch.html), 'seller does not get the buyer’s details');
  assert.match(buyerMatch.html, /RentMySite manager will coordinate/);
  const mine = await call('GET', '/market/my/requests', buyer);
  assert.equal(mine.body.requests[0].status, 'matched');
  assert.equal(mine.body.requests[0].seller, undefined, 'no seller contact in the buyer dashboard');
  const sellerView = await call('GET', '/market/my/incoming', seller);
  assert.equal(sellerView.body.requests[0].buyer, undefined, 'no buyer contact in the seller dashboard');
});

test('only Govianu staff can open the RentMySite team routes', async () => {
  const outsider = await User.create({ role: 'admin', name: 'Old Admin', email: 'someone@gmail.com', status: 'approved' });
  const seller = await User.findOne({ email: 'ravi@example.com' });
  assert.equal((await call('GET', '/admin/market', outsider)).status, 403);
  assert.equal((await call('GET', '/admin/market', seller)).status, 403);
  const staff = await User.findOne({ email: 'ops@govianu.com' });
  assert.equal((await call('GET', '/admin/market', staff)).status, 200);
});
