const { createModel } = require('../utils/jsonModel');

// Something a seller offers on the marketplace: a business's space or free slot, or a professional's service.
// Every listing is checked by the RentMySite team before it goes live.
module.exports = createModel('Listing', {
  required: ['owner', 'kind', 'title', 'status'],
  enums: {
    kind: ['space', 'service'],
    status: ['pending_review', 'live', 'paused', 'rejected', 'removed'],
    priceUnit: ['hour', 'slot', 'day', 'session', 'event', 'project', 'month']
  },
  defaults: { status: 'pending_review', priceUnit: 'slot' },
  refs: { owner: ['User', false] }
});
