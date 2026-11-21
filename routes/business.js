const { requireKyc } = require('../utils/kyc');
const router = require('express').Router();
const Booking = require('../models/Booking');
const Opportunity = require('../models/Opportunity');
const Lead = require('../models/Lead');
const Media = require('../models/Media');
const { requireAuth } = require('../middleware/auth');
const { computeSplit } = require('../utils/split');
const { meetConfigured } = require('../utils/meet');
const deal = require('../utils/deal');
const { generateOpportunities } = require('../utils/ai');
const { fail, str } = require('../utils/http');
const { industryFor } = require('../utils/industry');
const { uploadMiddleware } = require('../utils/mediaUpload');
const { createMediaUpload, deleteOwnedMedia } = require('../utils/mediaController');
const rateLimit = require('../utils/rateLimit');

router.use(requireAuth('business'));

router.get('/dashboard', async (req, res) => {
  const [opportunities, bookings, media] = await Promise.all([
    Opportunity.find({ business: req.user._id, status: { $ne: 'dismissed' } }).sort({ createdAt: -1 }),
    Booking.find({ business: req.user._id }).sort({ createdAt: -1 }).limit(100),
    Media.find({ owner: req.user._id }).sort({ createdAt: -1 })
  ]);
  // RentMySite is the third party: sellers never see the buyer's contact details, even once it's a match
  const visible = bookings.filter(b => b.status !== 'pending_review' && b.status !== 'cancelled');
  const withSplit = visible.map(b => {
    const row = { ...b.toJSON(), split: computeSplit(b.amount, b.splitModel, b.partnerShare) };
    delete row.requesterEmail; delete row.requesterPhone; delete row.meetLink;
    delete row.timeline; delete row.termsAcceptedAt; delete row.payment; delete row.approvedBy;
    row.share = b.status === 'awaiting_payment' && b.sharePayer !== 'buyer' ? { amount: b.pmbShare, payUrl: b.payment?.linkUrl || null } : null;
    row.requesterName = `${String(b.requesterName || '').split(/\s+/)[0]}${b.buyerType ? `, ${String(b.buyerType).toLowerCase()}` : ''}`;
    return row;
  });
  const yourShare = withSplit
    .filter(b => ['accepted', 'matched', 'completed'].includes(b.status))
    .reduce((sum, b) => sum + (b.split.lines.find(l => l.party === 'business')?.amountInr || 0), 0);

  res.json({
    opportunities,
    bookings: withSplit,
    media,
    industry: industryFor(req.user),
    stats: {
      pending: visible.filter(b => b.status === 'requested').length,
      accepted: visible.filter(b => ['accepted', 'matched'].includes(b.status)).length,
      yourShare,
      potentialMonthly: opportunities.reduce((s, o) => s + (o.estMonthly || 0), 0)
    },
    meetConfigured: meetConfigured()
  });
});

router.post('/media', rateLimit(10, 60 * 60 * 1000), uploadMiddleware, async (req, res) => {
  const allowedKinds = ['business_video', 'business_image', 'business_menu', 'business_slides'];
  const media = await createMediaUpload({ req, owner: req.user, allowedKinds });
  res.status(201).json({ media });
});

router.delete('/media/:id', async (req, res) => {
  await deleteOwnedMedia({ id: req.params.id, owner: req.user });
  res.json({ ok: true });
});

router.post('/opportunities/refresh', async (req, res) => {
  const u = req.user;
  const ops = await generateOpportunities({ name: u.business?.businessName || u.name, category: u.category, location: u.location });
  await Opportunity.deleteMany({ business: u._id, status: 'suggested' });
  const created = await Opportunity.insertMany(ops.map(o => ({ ...o, business: u._id })));
  res.json({ opportunities: created });
});

router.patch('/opportunities/:id', async (req, res) => {
  const status = req.body?.status;
  if (!['interested', 'dismissed', 'suggested'].includes(status)) throw fail('Unknown status');
  const op = await Opportunity.findOneAndUpdate({ _id: req.params.id, business: req.user._id }, { status }, { new: true });
  if (!op) throw fail('Opportunity not found', 404);
  if (status === 'interested') {
    await Lead.create({
      name: req.user.business?.businessName || req.user.name,
      phone: req.user.phone, email: req.user.email,
      source: 'manual', relatedUser: req.user._id,
      notes: `Interested in: ${op.title}`,
      history: [{ stage: 'new', note: `Business tapped "I'm interested" on ${op.title}` }]
    });
  }
  res.json({ opportunity: op });
});

// Accepting makes it a match: it goes to the RentMySite team for approval, then RentMySite's share, then both sides are connected (utils/deal.js)
router.post('/bookings/:id/accept', async (req, res) => {
  if (req.body?.agreementAccepted !== true) throw fail('Tick the partner agreement to accept this booking');
  requireKyc(req.user, 'accept a booking');
  const booking = await Booking.findOne({ _id: req.params.id, business: req.user._id });
  if (!booking) throw fail('Booking not found', 404);
  if (booking.status !== 'requested') throw fail(`This booking is already ${String(booking.status).replace(/_/g, ' ')}`);
  await deal.sellerAccepted({ booking, seller: req.user });
  const split = computeSplit(booking.amount, booking.splitModel, booking.partnerShare);
  res.json({ booking: { ...booking.toJSON(), split } });
});

router.post('/bookings/:id/decline', async (req, res) => {
  const booking = await Booking.findOne({ _id: req.params.id, business: req.user._id, status: 'requested' });
  if (!booking) throw fail('Booking not found or already handled', 404);
  await deal.sellerDeclined({ booking, seller: req.user });
  res.json({ booking });
});

router.patch('/profile', async (req, res) => {
  const b = req.body || {};
  const u = req.user;
  for (const key of ['address', 'idleSlots', 'razorpayAccountId']) {
    if (typeof b[key] === 'string') u.business[key] = b[key].trim().slice(0, 500);
  }
  if (typeof b.phone === 'string') u.phone = b.phone.trim().slice(0, 40);
  await u.save();
  res.json({ user: u });
});

module.exports = router;
