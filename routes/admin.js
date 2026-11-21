const router = require('express').Router();
const User = require('../models/User');
const Media = require('../models/Media');
const Lead = require('../models/Lead');
const Gig = require('../models/Gig');
const Booking = require('../models/Booking');
const Opportunity = require('../models/Opportunity');
const Enquiry = require('../models/Enquiry');
const { requireAuth } = require('../middleware/auth');
const { uniqueHandle } = require('../utils/handle');
const { resolveMapsUrl } = require('../utils/maps');
const { generateOpportunities, sopsFor } = require('../utils/ai');
const { fail, str } = require('../utils/http');
const deal = require('../utils/deal');
const { pmbShareOf } = deal;

router.use(requireAuth('admin'));

router.get('/overview', async (req, res) => {
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const [byRole, pendingProfiles, pendingMedia, leadStages, requestedBookings, importedToday, proposedWorkshops] = await Promise.all([
    User.aggregate([{ $group: { _id: '$role', n: { $sum: 1 } } }]),
    User.countDocuments({ status: 'pending' }),
    Media.countDocuments({ status: 'pending' }),
    Lead.aggregate([{ $group: { _id: '$stage', n: { $sum: 1 } } }]),
    Booking.countDocuments({ status: 'pending_approval' }),
    User.countDocuments({ status: 'imported', createdAt: { $gte: startOfDay } }),
    Gig.countDocuments({ status: 'proposed' })
  ]);
  res.json({
    users: Object.fromEntries(byRole.map(r => [r._id, r.n])),
    pendingProfiles, pendingMedia, requestedBookings, importedToday, proposedWorkshops,
    importTarget: 100,
    leads: Object.fromEntries(leadStages.map(r => [r._id, r.n]))
  });
});

// ---------- Google Maps importer ----------
async function importOne({ mapsUrl, category, location, adminId }) {
  const info = await resolveMapsUrl(mapsUrl);
  if (!info.name) throw fail('Could not read a business name from that link. Open the place in Maps and copy the full URL.');
  const existing = await User.findOne({ 'business.mapsUrl': info.mapsUrl });
  if (existing) return { user: existing, duplicate: true };

  const cat = str(category).toLowerCase() || 'restaurant';
  const loc = str(location).toLowerCase() || 'bengaluru';
  const user = await User.create({
    role: 'business',
    name: info.name,
    category: cat,
    location: loc,
    slug: info.name,
    handle: await uniqueHandle(cat, loc, info.name),
    status: 'imported',
    importedBy: adminId,
    business: { businessName: info.name, mapsUrl: info.mapsUrl, lat: info.lat, lng: info.lng, sops: sopsFor(cat) }
  });
  const ops = await generateOpportunities({ name: info.name, category: cat, location: loc });
  await Opportunity.insertMany(ops.map(o => ({ ...o, business: user._id })));
  await Lead.create({
    name: info.name, company: info.name, source: 'import', relatedUser: user._id, owner: adminId,
    history: [{ stage: 'new', note: 'Imported from Google Maps', proofUrl: info.mapsUrl, by: adminId }]
  });
  return { user, opportunities: ops.length, duplicate: false };
}

router.post('/import', async (req, res) => {
  const result = await importOne({ ...req.body, adminId: req.user._id });
  res.status(result.duplicate ? 200 : 201).json(result);
});

router.post('/import/bulk', async (req, res) => {
  const links = String(req.body?.links || '').split(/\s+/).filter(Boolean).slice(0, 100);
  if (!links.length) throw fail('Paste at least one Google Maps link, one per line');
  const results = [];
  for (const mapsUrl of links) {
    try {
      const r = await importOne({ mapsUrl, category: req.body.category, location: req.body.location, adminId: req.user._id });
      results.push({ mapsUrl, ok: true, handle: r.user.handle, duplicate: r.duplicate });
    } catch (err) {
      results.push({ mapsUrl, ok: false, error: err.message });
    }
  }
  res.json({ results });
});

// ---------- Website enquiries (with terms acceptance record) ----------
router.get('/enquiries', async (req, res) => {
  const enquiries = await Enquiry.find({}).populate('user', 'handle status').sort({ createdAt: -1 }).limit(300);
  res.json({ enquiries });
});

// ---------- Profiles ----------
router.get('/users', async (req, res) => {
  const q = {};
  if (req.query.role) q.role = req.query.role;
  if (req.query.status) q.status = req.query.status;
  if (req.query.q) q.$or = [{ handle: new RegExp(escapeRx(req.query.q), 'i') }, { name: new RegExp(escapeRx(req.query.q), 'i') }];
  const users = await User.find(q).populate('assignedManager', 'name').sort({ createdAt: -1 }).limit(200);
  const admins = await User.find({ role: 'admin' }, 'name email');
  // KYC stays off the profile itself (never sent); the team gets its status, masked, beside each profile
  const { kycSummary } = require('../utils/kyc');
  res.json({ users: users.map(u => ({ ...u.toJSON(), kycStatus: kycSummary(u) })), admins });
});

router.patch('/users/:id', async (req, res) => {
  const update = {};
  if (['pending', 'approved', 'rejected', 'imported'].includes(req.body?.status)) update.status = req.body.status;
  if (req.body?.assignedManager !== undefined) update.assignedManager = req.body.assignedManager || null;
  const user = await User.findByIdAndUpdate(req.params.id, update, { new: true }).populate('assignedManager', 'name');
  if (!user) throw fail('Profile not found', 404);
  res.json({ user });
});

// ---------- Validation queue ----------
router.get('/media', async (req, res) => {
  const media = await Media.find({ status: req.query.status || 'pending' })
    .populate('owner', 'name handle role')
    .sort({ createdAt: 1 });
  res.json({ media });
});

router.post('/media/:id/review', async (req, res) => {
  const decision = req.body?.decision;
  if (!['approved', 'rejected'].includes(decision)) throw fail('Choose approve or reject');
  if (decision === 'rejected' && !str(req.body.note)) throw fail('Add a note so the media owner knows what to fix');
  const media = await Media.findByIdAndUpdate(
    req.params.id,
    { status: decision, reviewNote: str(req.body.note), reviewedBy: req.user._id, reviewedAt: new Date() },
    { new: true }
  );
  if (!media) throw fail('Upload not found', 404);
  res.json({ media });
});

// ---------- Leads CRM ----------
router.get('/leads', async (req, res) => {
  const q = req.query.stage ? { stage: req.query.stage } : {};
  const leads = await Lead.find(q).populate('owner', 'name').populate('relatedUser', 'handle').sort({ updatedAt: -1 }).limit(300);
  res.json({ leads, stages: Lead.STAGES });
});

router.post('/leads', async (req, res) => {
  const b = req.body || {};
  if (!str(b.name)) throw fail('Enter the lead’s name');
  const lead = await Lead.create({
    name: str(b.name), company: str(b.company), phone: str(b.phone), email: str(b.email),
    source: ['manual', 'referral'].includes(b.source) ? b.source : 'manual',
    notes: str(b.notes), owner: req.user._id,
    history: [{ stage: 'new', note: str(b.notes) || 'Lead added', by: req.user._id }]
  });
  res.status(201).json({ lead });
});

// Move a lead to another stage, with an optional note
router.patch('/leads/:id', async (req, res) => {
  const { stage, note } = req.body || {};
  if (!Lead.STAGES.includes(stage)) throw fail('Unknown stage');
  const lead = await Lead.findById(req.params.id);
  if (!lead) throw fail('Lead not found', 404);
  lead.stage = stage;
  lead.history.push({ stage, note: str(note), by: req.user._id });
  if (!lead.owner) lead.owner = req.user._id;
  await lead.save();
  res.json({ lead });
});

// Delete leads (e.g. test sign-ups). With withAccounts, the dashboards behind them go too: the account, its
// ideas, enquiries, uploads and KYC files. Team (admin) accounts are never deleted here.
router.post('/leads/delete', async (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(String).slice(0, 500);
  if (!ids.length) throw fail('Choose at least one lead');
  const leads = await Lead.find({ _id: { $in: ids } });
  let accounts = 0;
  if (req.body?.withAccounts === true) {
    const { removeStoredUpload } = require('../utils/mediaUpload');
    const kyc = require('../utils/kyc');
    const fs = require('fs');
    const userIds = [...new Set(leads.map(l => String(l.relatedUser?._id || l.relatedUser || '')).filter(Boolean))];
    for (const id of userIds) {
      const u = await User.findById(id);
      if (!u || u.role === 'admin') continue;
      for (const m of await Media.find({ owner: u._id })) if (m.storageKey) await removeStoredUpload(m.storageKey).catch(() => {});
      await Media.deleteMany({ owner: u._id });
      for (const d of Object.keys(kyc.DOCS)) { const f = kyc.docPath(u, d); if (f) fs.promises.unlink(f.file).catch(() => {}); }
      await Opportunity.deleteMany({ business: u._id });
      if (u.email) await Enquiry.deleteMany({ email: u.email });
      await User.deleteMany({ _id: u._id });
      accounts++;
    }
  }
  const { deletedCount } = await Lead.deleteMany({ _id: { $in: leads.map(l => l._id) } });
  console.log(`[admin] ${req.user.email} deleted ${deletedCount} lead(s) and ${accounts} account(s)`);
  res.json({ leads: deletedCount, accounts });
});

// ---------- Gigs ----------
router.get('/gigs', async (req, res) => {
  const gigs = await Gig.find()
    .populate('venue', 'business.businessName handle')
    .populate('host', 'name handle')
    .populate('applicants', 'name handle phone')
    .sort({ createdAt: -1 }).limit(200);
  res.json({ gigs });
});

router.post('/gigs', async (req, res) => {
  const b = req.body || {};
  if (!str(b.title)) throw fail('Give the shift a title');
  let venue;
  if (str(b.venueHandle)) {
    venue = await User.findOne({ handle: str(b.venueHandle).toLowerCase() });
    if (!venue) throw fail('No profile with that venue handle');
  }
  const gig = await Gig.create({
    type: 'shift',
    title: str(b.title),
    description: str(b.description),
    category: str(b.category) || 'cleaning_staff',
    location: str(b.location).toLowerCase() || venue?.location,
    venue: venue?._id,
    date: b.date ? new Date(b.date) : undefined,
    durationHours: Number(b.durationHours) || undefined,
    pay: Number(b.pay) || 0,
    slots: Number(b.slots) || 1,
    status: 'open',
    createdBy: req.user._id
  });
  res.status(201).json({ gig });
});

router.patch('/gigs/:id', async (req, res) => {
  if (!['proposed', 'open', 'filled', 'closed', 'cancelled'].includes(req.body?.status)) throw fail('Unknown status');
  const gig = await Gig.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true });
  if (!gig) throw fail('Gig not found', 404);
  res.json({ gig });
});

// ---------- Marketplace: RentMySite checks every listing and request (third party) ----------
router.get('/market', async (req, res) => {
  const { publicListing, STATUS_LABEL } = require('./market');
  const Listing = require('../models/Listing');
  const listings = (await Listing.find({})).filter(l => l.status !== 'removed').sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const owners = new Map();
  const ownerOf = async id => { if (!owners.has(String(id))) owners.set(String(id), await User.findById(id)); return owners.get(String(id)); };
  const listingRows = [];
  for (const l of listings.slice(0, 300)) {
    const o = await ownerOf(l.owner);
    listingRows.push({ ...publicListing(l, o), ownerName: o?.business?.businessName || o?.name || '', ownerEmail: o?.email || '', ownerHandle: o?.handle || '', reviewNote: l.reviewNote || '' });
  }
  const bookings = (await Booking.find({})).filter(b => b.listing || b.source === 'booking_link' || b.status === 'pending_review')
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 300);
  const requestRows = [];
  for (const b of bookings) {
    const l = b.listing ? await Listing.findById(b.listing) : null;
    const s = await ownerOf(b.business);
    requestRows.push({ id: b._id, status: b.status, statusLabel: STATUS_LABEL[b.status] || b.status, what: b.eventType, date: b.eventDate, people: b.guests,
      budget: b.amount, message: b.message, listingTitle: l?.title || 'Direct booking link', price: l ? require('../utils/emails').priceText(l) : '',
      buyer: { name: b.requesterName, email: b.requesterEmail, phone: b.requesterPhone, type: b.buyerType || '' },
      seller: { name: s?.business?.businessName || s?.name || '', email: s?.email || '', phone: s?.phone || '', handle: s?.handle || '' }, createdAt: b.createdAt,
      splitModel: b.splitModel || 'four_way', partnerShare: b.partnerShare ?? 50, pmbShare: b.pmbShare ?? null, sharePayer: b.sharePayer || 'seller',
      suggestedShare: b.amount > 0 ? pmbShareOf(b.amount, b.splitModel, b.partnerShare).share : null,
      payment: b.payment ? { status: b.payment.status, linkUrl: b.payment.linkUrl || null, reference: b.payment.reference || null } : null,
      timeline: (b.timeline || []).slice(-6) });
  }
  res.json({ listings: listingRows, requests: requestRows });
});

router.post('/market/listings/:id/review', async (req, res) => {
  const Listing = require('../models/Listing');
  const { sendMail } = require('../utils/mailer');
  const { listingReviewed } = require('../utils/emails');
  // Listings are live as soon as sellers publish them; the team can take one down (with a note) or put it back
  const decision = { takedown: 'reject', restore: 'approve' }[req.body?.decision] || req.body?.decision;
  if (!['approve', 'reject'].includes(decision)) throw fail('Choose publish or take down');
  const note = str(req.body?.note).slice(0, 500);
  if (decision === 'reject' && !note) throw fail('Add a note so the seller knows what to change');
  const l = await Listing.findById(req.params.id);
  if (!l) throw fail('Listing not found', 404);
  l.status = decision === 'approve' ? 'live' : 'rejected';
  l.reviewNote = note; l.reviewedBy = req.user._id; l.reviewedAt = new Date().toISOString();
  await l.save();
  const owner = await User.findById(l.owner);
  if (owner?.email) await sendMail(listingReviewed({ listing: l, seller: owner, approved: decision === 'approve', note }));
  res.json({ ok: true, status: l.status });
});

router.post('/market/requests/:id/review', async (req, res) => {
  const Listing = require('../models/Listing');
  const { sendMail } = require('../utils/mailer');
  const { marketDecision, marketRequestForSeller } = require('../utils/emails');
  const decision = req.body?.decision;
  if (!['forward', 'decline'].includes(decision)) throw fail('Choose forward or decline');
  const note = str(req.body?.note).slice(0, 500);
  if (decision === 'decline' && !note) throw fail('Add a note for the buyer');
  const b = await Booking.findById(req.params.id);
  if (!b) throw fail('Request not found', 404);
  if (b.status !== 'pending_review') throw fail('This request has already been reviewed');
  b.status = decision === 'forward' ? 'requested' : 'declined';
  b.buyerNote = note; b.reviewedBy = req.user._id; b.reviewedAt = new Date().toISOString();
  b.timeline = [...(b.timeline || []), { status: b.status, at: b.reviewedAt, note: decision === 'forward' ? 'Checked by RentMySite and sent to the seller' : 'Declined by RentMySite' }];
  await b.save();
  const l = b.listing ? await Listing.findById(b.listing) : null;
  const sellerUser = await User.findById(b.business);
  if (decision === 'forward' && sellerUser?.email) await sendMail(marketRequestForSeller({ seller: sellerUser, booking: b, listing: l }));
  if (b.requesterEmail) await sendMail(marketDecision({ booking: b, listing: l, outcome: decision === 'forward' ? 'forwarded' : 'declined', note }));
  res.json({ ok: true, status: b.status });
});

// ---------- Deals: seller accepted (a match) -> RentMySite approves -> RentMySite share received -> matched ----------
async function dealBooking(id) {
  const b = await Booking.findById(id);
  if (!b) throw fail('Request not found', 404);
  return b;
}
router.post('/market/requests/:id/approve', async (req, res) => {
  const b = req.body || {};
  const booking = await deal.approve({ booking: await dealBooking(req.params.id), admin: req.user, amount: b.amount, splitModel: b.splitModel,
    partnerShare: b.partnerShare, sharePayer: b.sharePayer, note: str(b.note).slice(0, 500) });
  res.json({ ok: true, status: booking.status, pmbShare: booking.pmbShare, payUrl: booking.payment?.linkUrl || null });
});
router.post('/market/requests/:id/decline-match', async (req, res) => {
  const booking = await deal.declineMatch({ booking: await dealBooking(req.params.id), admin: req.user, note: str(req.body?.note).slice(0, 500) });
  res.json({ ok: true, status: booking.status });
});
router.post('/market/requests/:id/share-received', async (req, res) => {
  const booking = await deal.shareReceived({ booking: await dealBooking(req.params.id), admin: req.user, reference: str(req.body?.reference) });
  res.json({ ok: true, status: booking.status });
});

// ---------- Bookings ----------
router.get('/bookings', async (req, res) => {
  const bookings = await Booking.find().populate('business', 'business.businessName handle').sort({ createdAt: -1 }).limit(200);
  res.json({ bookings });
});

router.patch('/bookings/:id', async (req, res) => {
  const b = req.body || {};
  const update = {};
  if (['four_way', 'infra_first'].includes(b.splitModel)) update.splitModel = b.splitModel;
  if (b.partnerShare !== undefined) update.partnerShare = Math.min(100, Math.max(0, Number(b.partnerShare)));
  if (b.amount !== undefined) update.amount = Math.max(0, Number(b.amount));
  if (typeof b.leadGenName === 'string') update.leadGenName = b.leadGenName.trim();
  if (typeof b.leadGenAccountId === 'string') update.leadGenAccountId = b.leadGenAccountId.trim();
  const booking = await Booking.findByIdAndUpdate(req.params.id, update, { new: true });
  if (!booking) throw fail('Booking not found', 404);
  res.json({ booking });
});

function escapeRx(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

module.exports = router;
