// Marketplace deal flow, with RentMySite as the third party:
//   requested         buyer sent a request; the seller sees it straight away
//   pending_approval  the seller accepted: buyer and seller match, and the RentMySite team is asked to approve
//   awaiting_payment  the RentMySite team approved and set the amount; RentMySite's share is requested (Razorpay link if set up)
//   matched           RentMySite's share is received: it's a match. Neither side ever gets the other's contact details;
//                     the RentMySite team coordinates everything between them.
// Either side can drop out before the match; the RentMySite team can decline at approval.
const Booking = require('../models/Booking');
const Listing = require('../models/Listing');
const User = require('../models/User');
const Lead = require('../models/Lead');
const { computeSplit, MODELS } = require('./split');
const { razorpayConfigured, createPaymentLink, getPaymentLink } = require('./razorpay');
const { sendMail } = require('./mailer');
const emails = require('./emails');
const { fail } = require('./http');

const now = () => new Date().toISOString();
const step = (b, status, note, by) => { b.status = status; b.timeline = [...(b.timeline || []), { status, at: now(), note, ...(by ? { by } : {}) }]; };

async function parties(b) {
  const [listing, seller] = await Promise.all([b.listing ? Listing.findById(b.listing) : null, User.findById(b.business)]);
  return { listing, seller };
}
async function sendAll(mails) {
  for (const m of [].concat(mails).filter(Boolean)) {
    try { await sendMail(m); } catch (err) { console.error('[deal] email failed:', err.message); }
  }
}

// RentMySite's share: the platform line of the revenue split
function pmbShareOf(amount, splitModel = 'four_way', partnerShare = 50) {
  const split = computeSplit(amount, splitModel, partnerShare);
  return { split, share: split.lines.find(l => l.party === 'platform')?.amountInr || 0 };
}

// 1. Seller accepts a request: that's a match, and it goes to the RentMySite team for approval
async function sellerAccepted({ booking, seller }) {
  if (booking.status !== 'requested') throw fail(`This request is already ${String(booking.status).replace(/_/g, ' ')}`);
  booking.agreementAccepted = true;
  booking.agreementAcceptedAt = now();
  step(booking, 'pending_approval', 'Accepted by the seller: matched, waiting for RentMySite approval', seller._id);
  await booking.save();
  await Lead.updateOne({ relatedBooking: booking._id },
    { $set: { stage: 'meeting' }, $push: { history: { stage: 'meeting', note: 'Seller accepted: waiting for RentMySite approval', proofUrl: `booking:${booking._id}`, at: now() } } }).catch(() => {});
  const { listing } = await parties(booking);
  await sendAll([emails.dealForApproval({ booking, listing, seller }), ...emails.dealUpdate({ booking, listing, seller, stage: 'pending_approval' })]);
  return booking;
}

async function sellerDeclined({ booking, seller }) {
  if (booking.status !== 'requested') throw fail(`This request is already ${String(booking.status).replace(/_/g, ' ')}`);
  step(booking, 'declined', 'Declined by the seller', seller._id);
  await booking.save();
  const { listing } = await parties(booking);
  await sendAll(emails.dealUpdate({ booking, listing, seller, stage: 'declined', only: 'buyer' }));
  return booking;
}

// 2. RentMySite team approves the match, sets the final amount, and requests RentMySite's share
async function approve({ booking, admin, amount, splitModel, partnerShare, sharePayer, note }) {
  if (booking.status !== 'pending_approval') throw fail('Only matches waiting for approval can be approved');
  const total = Number(amount ?? booking.amount);
  if (!(total > 0)) throw fail('Enter the agreed amount for this booking');
  const model = MODELS[splitModel] ? splitModel : booking.splitModel || 'four_way';
  const pShare = partnerShare === undefined || partnerShare === '' ? booking.partnerShare ?? 50 : Math.min(100, Math.max(0, Number(partnerShare)));
  const { share } = pmbShareOf(total, model, pShare);
  Object.assign(booking, { amount: total, splitModel: model, partnerShare: pShare, pmbShare: share, sharePayer: sharePayer === 'buyer' ? 'buyer' : 'seller',
    approvedBy: admin._id, approvedAt: now(), buyerNote: note || booking.buyerNote || '' });
  const { listing, seller } = await parties(booking);

  let payLink = null;
  if (razorpayConfigured() && share > 0) {
    const payer = booking.sharePayer === 'buyer'
      ? { name: booking.requesterName, email: booking.requesterEmail, phone: booking.requesterPhone }
      : { name: seller?.name, email: seller?.email, phone: seller?.phone };
    const link = await createPaymentLink({ amountInr: share, reference: `${emails.dealRef(booking)}-${Date.now().toString(36)}`,
      description: `RentMySite share: ${listing?.title || booking.eventType}`, customer: payer, notes: { booking: String(booking._id) } });
    payLink = link.short_url;
    booking.payment = { status: 'created', linkId: link.id, linkUrl: link.short_url };
  }
  step(booking, share > 0 ? 'awaiting_payment' : 'matched', share > 0 ? `Approved by RentMySite; share of ₹${share} requested from the ${booking.sharePayer}` : 'Approved by RentMySite (no share due)', admin._id);
  await booking.save();
  if (booking.status === 'matched') return confirmMatch({ booking, listing, seller });
  await sendAll([emails.shareRequest({ booking, listing, seller, payLink }), ...emails.dealUpdate({ booking, listing, seller, stage: 'awaiting_payment', note })]);
  return booking;
}

async function declineMatch({ booking, admin, note }) {
  if (!['pending_approval', 'awaiting_payment'].includes(booking.status)) throw fail('This match can’t be declined now');
  if (!note) throw fail('Add a note for the buyer and seller');
  booking.buyerNote = note;
  step(booking, 'declined', `Declined by RentMySite: ${note}`, admin._id);
  await booking.save();
  const { listing, seller } = await parties(booking);
  await sendAll(emails.dealUpdate({ booking, listing, seller, stage: 'declined', note }));
  return booking;
}

// 3. RentMySite's share is received: it's a match. With a Razorpay link, its status is checked; otherwise a reference is required.
async function shareReceived({ booking, admin, reference }) {
  if (booking.status !== 'awaiting_payment') throw fail('This match isn’t waiting for a payment');
  let ref = String(reference || '').trim().slice(0, 120);
  if (booking.payment?.linkId && razorpayConfigured()) {
    const link = await getPaymentLink(booking.payment.linkId);
    if (link.status === 'paid') ref = ref || link.payments?.[0]?.payment_id || booking.payment.linkId;
    else if (!ref) throw fail(`Razorpay shows this payment as “${link.status}”. Enter a payment reference if it was paid another way.`);
  }
  if (!ref) throw fail('Enter the payment reference (UTR, Razorpay payment ID or receipt number)');
  booking.payment = { ...(booking.payment || {}), status: 'paid', reference: ref, paidAt: now(), recordedBy: admin._id };
  const { listing, seller } = await parties(booking);
  step(booking, 'matched', `RentMySite share received (${ref}): matched`, admin._id);
  await booking.save();
  return confirmMatch({ booking, listing, seller });
}

async function confirmMatch({ booking, listing, seller }) {
  await Lead.updateOne({ relatedBooking: booking._id },
    { $set: { stage: 'signed' }, $push: { history: { stage: 'signed', note: 'Matched: RentMySite share received', proofUrl: `booking:${booking._id}`, at: now() } } }).catch(() => {});
  await sendAll(emails.matchConfirmed({ booking, listing, seller }));
  return booking;
}

module.exports = { sellerAccepted, sellerDeclined, approve, declineMatch, shareReceived, pmbShareOf, Booking };
