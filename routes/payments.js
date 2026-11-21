const router = require('express').Router();
const Booking = require('../models/Booking');
const { requireAuth } = require('../middleware/auth');
const { computeSplit, MODELS } = require('../utils/split');
const { buildOrderPayload, createOrder, razorpayConfigured } = require('../utils/razorpay');
const { fail } = require('../utils/http');

router.get('/models', (req, res) => res.json({ models: MODELS }));

router.post('/split-preview', requireAuth(), (req, res) => {
  const { amount, model, partnerShare } = req.body || {};
  res.json(computeSplit(amount, model, partnerShare ?? 50));
});

// Admin creates the Razorpay order for an accepted booking.
// Without Razorpay keys this is a dry run that returns the exact payload it would send.
router.post('/orders/:bookingId', requireAuth('admin'), async (req, res) => {
  const booking = await Booking.findById(req.params.bookingId).populate('business');
  if (!booking) throw fail('Booking not found', 404);
  if (!['accepted', 'matched'].includes(booking.status)) throw fail('Only accepted or matched bookings can be charged');
  if (!(booking.amount > 0)) throw fail('Set a booking amount first');

  const { split, missing, payload } = buildOrderPayload(booking, booking.business?.business?.razorpayAccountId);
  if (!razorpayConfigured()) return res.json({ dryRun: true, split, missing, payload });
  if (missing.length) throw fail(`Add Razorpay linked accounts for: ${missing.join(', ')}`);

  const order = await createOrder(payload);
  booking.payment = { orderId: order.id, status: 'created' };
  await booking.save();
  res.json({ dryRun: false, split, order, keyId: process.env.RAZORPAY_KEY_ID });
});

module.exports = router;
