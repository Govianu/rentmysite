const { createModel } = require('../utils/jsonModel');

module.exports = createModel('Booking', {
  required: ['business', 'requesterName', 'eventType'],
  enums: {
    splitModel: ['four_way', 'infra_first'],
    // Marketplace deal: requested (with the seller) -> pending_approval (seller accepted: a match, waiting for the RentMySite team)
    //   -> awaiting_payment (RentMySite approved, waiting for RentMySite's share) -> matched (share received, both sides connected)
    // pending_review and accepted are from the earlier flow and stay valid for older records.
    status: ['pending_review', 'requested', 'pending_approval', 'awaiting_payment', 'matched', 'accepted', 'declined', 'completed', 'cancelled'],
    'payment.status': ['none', 'created', 'paid'],
    sharePayer: ['buyer', 'seller']
  },
  defaults: {
    amount: 0,
    splitModel: 'four_way',
    partnerShare: 50,
    status: 'requested',
    agreementAccepted: false,
    payment: { status: 'none' }
  },
  // business = the seller (a business or a professional); buyer = logged-in buyer, if any
  refs: { business: ['User', false], buyer: ['User', false], listing: ['Listing', false] }
});
