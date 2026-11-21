// Marketplace: businesses list spaces and free slots, professionals list services, buyers request them.
// RentMySite is the third party. Listings go live as soon as a seller publishes them (the team is emailed and
// can take one down). A buyer's request goes to the seller; when the seller accepts, the match goes to the RentMySite team
// for approval, and once RentMySite's share is received it's a match. Buyers and sellers never get each other's contact
// details at any stage: the RentMySite team coordinates everything.
// The deal steps live in utils/deal.js.
const { requireKyc } = require('../utils/kyc');
const router = require('express').Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Booking = require('../models/Booking');
const Lead = require('../models/Lead');
const { requireAuth, COOKIE } = require('../middleware/auth');
const { industryFor } = require('../utils/industry');
const { sendMail } = require('../utils/mailer');
const emails = require('../utils/emails');
const rateLimit = require('../utils/rateLimit');
const { fail, str } = require('../utils/http');
const { TERMS_VERSION } = require('../utils/terms');
const deal = require('../utils/deal');

const UNITS = ['hour', 'slot', 'day', 'session', 'event', 'project', 'month'];
const BUYER_TYPES = { event_manager: 'Event manager', company: 'Company', individual: 'Individual', business: 'Business', professional: 'Professional' };

// Logged-in user if there is one; public routes still work without
async function optionalUser(req) {
  const header = req.headers.authorization || '';
  const token = req.cookies?.[COOKIE] || (header.startsWith('Bearer ') ? header.slice(7) : null);
  if (!token) return null;
  try { const { id } = jwt.verify(token, process.env.JWT_SECRET); return await User.findById(id); } catch { return null; }
}

const titleCase = s => String(s || '').replace(/\b\w/g, c => c.toUpperCase());

// What buyers see: never the seller's contact details
function publicListing(l, owner) {
  const industry = owner ? industryFor(owner) : null;
  const isSpace = l.kind === 'space';
  return {
    id: l._id, kind: l.kind, title: l.title, description: l.description || '', area: titleCase(l.area || owner?.location || ''),
    capacity: l.capacity || null, price: Number(l.price) || 0, priceUnit: l.priceUnit, priceText: emails.priceText(l),
    availability: l.availability || '', tags: l.tags || [],
    seller: owner ? (isSpace ? (owner.business?.businessName || 'A partner business') : `${String(owner.name || '').split(/\s+/)[0]}, ${industry?.label || 'professional'}`) : 'Partner',
    sellerType: industry?.display || (isSpace ? 'Business' : 'Professional'),
    accent: industry?.sector?.style?.accent || '#1B3A9E', icon: industry?.sector?.style?.icons?.[0] || (isSpace ? '🏢' : '🙋'),
    status: l.status
  };
}

async function withOwners(listings) {
  const ids = [...new Set(listings.map(l => String(l.owner)))];
  const owners = new Map();
  for (const id of ids) owners.set(id, await User.findById(id));
  return listings.map(l => publicListing(l, owners.get(String(l.owner))));
}

const norm = s => String(s || '').toLowerCase();

// ---------- Public: who is offering what ----------
router.get('/listings', async (req, res) => {
  const q = norm(req.query.q).trim(), area = norm(req.query.area).trim(), kind = req.query.kind;
  const people = Number(req.query.people) || 0;
  let rows = await Listing.find({ status: 'live' });
  if (kind === 'space' || kind === 'service') rows = rows.filter(l => l.kind === kind);
  if (people) rows = rows.filter(l => !l.capacity || Number(l.capacity) >= people);
  let out = await withOwners(rows);
  if (area) out = out.filter(l => norm(l.area).includes(area));
  if (q) out = out.filter(l => [l.title, l.description, l.seller, l.sellerType, ...(l.tags || [])].some(x => norm(x).includes(q)));
  out.sort((a, b) => a.title.localeCompare(b.title));
  res.json({ listings: out.slice(0, 200) });
});

router.get('/listings/:id', async (req, res) => {
  const l = await Listing.findById(req.params.id);
  if (!l || l.status !== 'live') throw fail('This listing isn’t available', 404);
  res.json({ listing: (await withOwners([l]))[0] });
});

// A request to book: logged-in users or guests. It goes to the RentMySite team first.
router.post('/requests', rateLimit(10, 60 * 60 * 1000), async (req, res) => {
  const b = req.body || {};
  const me = await optionalUser(req);
  const listing = await Listing.findById(str(b.listingId));
  if (!listing || listing.status !== 'live') throw fail('This listing isn’t available any more', 404);
  if (me && String(listing.owner) === String(me._id)) throw fail('This is your own listing');
  // Signed-in people book only after KYC; guests go through the RentMySite team, who collect it before confirming
  if (me) requireKyc(me, 'book');
  const seller = await User.findById(listing.owner);
  if (!seller) throw fail('This listing isn’t available any more', 404);

  const name = me ? me.name : str(b.name).slice(0, 120);
  const email = me ? me.email : str(b.email).toLowerCase().slice(0, 200);
  const phone = me ? (me.phone || str(b.phone)) : str(b.phone).slice(0, 40);
  if (!name) throw fail('Enter your name');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail('Enter a valid email so we can update you');
  if (!me && b.termsAccepted !== true) throw fail('Please agree to the Terms and Conditions');
  const what = str(b.purpose).slice(0, 160);
  if (!what) throw fail('Tell us what it’s for');

  const buyerType = me ? (me.role === 'buyer' ? BUYER_TYPES[me.buyer?.type] || 'Buyer' : me.role === 'business' ? 'Business' : 'Professional')
    : (BUYER_TYPES[b.buyerType] || 'Individual');
  const booking = await Booking.create({
    business: seller._id, listing: listing._id, buyer: me?._id || null, buyerType,
    requesterName: name, requesterEmail: email, requesterPhone: phone,
    eventType: what, eventDate: b.date ? new Date(b.date) : undefined,
    guests: Number(b.people) || undefined, amount: Math.max(0, Number(b.budget) || 0),
    message: str(b.message).slice(0, 1500), leadGenName: buyerType === 'Event manager' ? (me?.buyer?.company || str(b.company)) : '',
    status: 'requested', source: 'marketplace',
    termsVersion: me ? undefined : TERMS_VERSION, termsAcceptedAt: me ? undefined : new Date().toISOString(),
    timeline: [{ status: 'requested', at: new Date().toISOString(), note: 'Request sent to the seller' }]
  });
  await Lead.create({
    name, company: me?.buyer?.company || str(b.company), email, phone, source: 'marketplace', relatedUser: seller._id, relatedBooking: booking._id,
    stage: 'new', notes: `${listing.title}: ${what}`, history: [{ stage: 'new', note: `Marketplace request for ${listing.title}`, at: new Date().toISOString() }]
  });
  await sendMail(emails.marketRequestReceived({ booking, listing }));
  if (seller.email) await sendMail(emails.marketRequestForSeller({ seller, booking, listing }));
  await sendMail(emails.marketRequestTeam({ booking, listing, seller }));
  res.status(201).json({ ok: true, bookingId: booking._id, loggedIn: Boolean(me) });
});

// "Can't find it? Find it for me": our team matches by hand
router.post('/concierge', rateLimit(6, 60 * 60 * 1000), async (req, res) => {
  const b = req.body || {};
  const me = await optionalUser(req);
  const who = { name: me?.name || str(b.name).slice(0, 120), email: me?.email || str(b.email).toLowerCase().slice(0, 200), phone: me?.phone || str(b.phone).slice(0, 40), role: me?.role };
  const need = { what: str(b.what).slice(0, 160), area: str(b.area).slice(0, 120), date: str(b.date).slice(0, 40), people: Number(b.people) || '', budget: Number(b.budget) || 0, details: str(b.details).slice(0, 1500) };
  if (!who.name) throw fail('Enter your name');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(who.email)) throw fail('Enter a valid email so we can reply');
  if (!need.what) throw fail('Tell us what you’re looking for');
  await Lead.create({ name: who.name, email: who.email, phone: who.phone, source: 'find_for_me', relatedUser: me?._id || null, stage: 'new',
    notes: `Looking for: ${need.what}${need.area ? `, ${need.area}` : ''}`, history: [{ stage: 'new', note: `Find it for me: ${need.what}`, at: new Date().toISOString() }] });
  await sendMail(emails.marketConcierge({ who, need }));
  res.status(201).json({ ok: true });
});

// ---------- Buyer side (any logged-in account can buy) ----------
const STATUS_LABEL = {
  pending_review: 'Being checked by RentMySite', requested: 'Sent to the seller', pending_approval: 'Accepted, RentMySite approving',
  awaiting_payment: 'Approved, waiting for RentMySite share', matched: 'Matched', accepted: 'Accepted', declined: 'Not available', completed: 'Completed', cancelled: 'Cancelled'
};
const CAN_CANCEL = ['pending_review', 'requested', 'pending_approval'];

router.get('/my/requests', requireAuth(), async (req, res) => {
  const rows = (await Booking.find({ buyer: req.user._id })).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const out = [];
  for (const b of rows) {
    const l = b.listing ? await Listing.findById(b.listing) : null;
    const owner = l ? await User.findById(l.owner) : null;
    out.push({ id: b._id, status: b.status, statusLabel: STATUS_LABEL[b.status] || b.status, what: b.eventType, date: b.eventDate, people: b.guests,
      budget: b.amount, createdAt: b.createdAt, listing: l ? publicListing(l, owner) : null, note: b.buyerNote || '',
      share: b.status === 'awaiting_payment' && b.sharePayer === 'buyer' ? { amount: b.pmbShare, payUrl: b.payment?.linkUrl || null } : null,

      canCancel: CAN_CANCEL.includes(b.status) });
  }
  res.json({ requests: out });
});

router.post('/my/requests/:id/cancel', requireAuth(), async (req, res) => {
  const b = await Booking.findById(req.params.id);
  if (!b || String(b.buyer) !== String(req.user._id)) throw fail('Request not found', 404);
  if (!CAN_CANCEL.includes(b.status)) throw fail('This request can’t be cancelled now. Contact your RentMySite manager.');
  b.status = 'cancelled';
  b.timeline = [...(b.timeline || []), { status: 'cancelled', at: new Date().toISOString(), note: 'Cancelled by the buyer' }];
  await b.save();
  res.json({ ok: true });
});

// ---------- Seller side: businesses list spaces, professionals list services ----------
const seller = requireAuth('business', 'associate');

function listingFields(b, user) {
  const title = str(b.title).slice(0, 100);
  if (!title) throw fail('Give your listing a title');
  const price = b.price === '' || b.price === undefined ? 0 : Number(b.price);
  if (!Number.isFinite(price) || price < 0) throw fail('Enter a price of 0 or more (0 means “price on request”)');
  const capacity = b.capacity === '' || b.capacity === undefined ? null : Number(b.capacity);
  if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1 || capacity > 100000)) throw fail('Enter how many people it fits, or leave it empty');
  return {
    title, description: str(b.description).slice(0, 1500), availability: str(b.availability).slice(0, 200),
    area: str(b.area).slice(0, 120) || user.location || '', price, priceUnit: UNITS.includes(b.priceUnit) ? b.priceUnit : 'slot',
    capacity: user.role === 'business' ? capacity : null,
    tags: (Array.isArray(b.tags) ? b.tags : str(b.tags).split(',')).map(x => str(String(x)).slice(0, 40)).filter(Boolean).slice(0, 8)
  };
}

router.get('/my/listings', seller, async (req, res) => {
  const rows = (await Listing.find({ owner: req.user._id })).filter(l => l.status !== 'removed')
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  res.json({ listings: rows.map(l => ({ ...publicListing(l, req.user), reviewNote: l.reviewNote || '' })), kind: req.user.role === 'business' ? 'space' : 'service' });
});

router.post('/my/listings', seller, rateLimit(20, 60 * 60 * 1000), async (req, res) => {
  const fields = listingFields(req.body || {}, req.user);
  // Published straight away for buyers; the RentMySite team is emailed and can take it down
  const listing = await Listing.create({ ...fields, owner: req.user._id, kind: req.user.role === 'business' ? 'space' : 'service', status: 'live', publishedAt: new Date().toISOString() });
  await sendMail(emails.listingSubmitted({ listing, seller: req.user }));
  res.status(201).json({ listing: publicListing(listing, req.user) });
});

router.patch('/my/listings/:id', seller, async (req, res) => {
  const l = await Listing.findById(req.params.id);
  if (!l || String(l.owner) !== String(req.user._id) || l.status === 'removed') throw fail('Listing not found', 404);
  const action = req.body?.action;
  if (action === 'pause') { if (l.status !== 'live') throw fail('Only live listings can be paused'); l.status = 'paused'; }
  else if (action === 'resume') { if (l.status !== 'paused') throw fail('Only paused listings can be resumed'); l.status = 'live'; }
  else if (action === 'remove') { l.status = 'removed'; }
  else {
    Object.assign(l, listingFields(req.body || {}, req.user));
    if (l.status !== 'paused') l.status = 'live';   // edits publish straight away (including after a take-down); the team is told
    l.reviewNote = '';
    await sendMail(emails.listingSubmitted({ listing: l, seller: req.user, changed: true }));
  }
  await l.save();
  res.json({ listing: publicListing(l, req.user) });
});

// Requests the RentMySite team has forwarded to this seller (businesses also see these on their Booking requests page)
router.get('/my/incoming', seller, async (req, res) => {
  const rows = (await Booking.find({ business: req.user._id })).filter(b => b.status !== 'pending_review')
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const out = [];
  for (const b of rows) {
    const l = b.listing ? await Listing.findById(b.listing) : null;
    out.push({ id: b._id, status: b.status, statusLabel: STATUS_LABEL[b.status] || b.status, what: b.eventType, date: b.eventDate, people: b.guests,
      budget: b.amount, message: b.message, from: `${String(b.requesterName || '').split(/\s+/)[0]}${b.buyerType ? `, ${b.buyerType.toLowerCase()}` : ''}`,
      listingTitle: l?.title || '', createdAt: b.createdAt, note: b.buyerNote || '',
      share: b.status === 'awaiting_payment' && b.sharePayer !== 'buyer' ? { amount: b.pmbShare, payUrl: b.payment?.linkUrl || null } : null,
    });
  }
  res.json({ requests: out });
});

router.post('/my/incoming/:id/:decision', seller, async (req, res) => {
  const { decision } = req.params;
  if (!['accept', 'decline'].includes(decision)) throw fail('Unknown action', 404);
  const b = await Booking.findById(req.params.id);
  if (!b || String(b.business) !== String(req.user._id)) throw fail('Request not found', 404);
  if (b.status !== 'requested') throw fail(`This request is already ${STATUS_LABEL[b.status]?.toLowerCase() || b.status}`);
  if (decision === 'accept' && req.body?.agreementAccepted !== true) throw fail('Tick the partner agreement to accept this request');
  if (decision === 'accept') requireKyc(req.user, 'accept a booking');
  // Accepting is a match: it goes to the RentMySite team for approval
  if (decision === 'accept') await deal.sellerAccepted({ booking: b, seller: req.user });
  else await deal.sellerDeclined({ booking: b, seller: req.user });
  res.json({ ok: true, status: b.status });
});

module.exports = { router, publicListing, STATUS_LABEL };
