const { createModel } = require('../utils/jsonModel');

// A plot or space an owner submits from /list-plot (photos, documents and details).
// The RentMySite team checks it (Plot approvals in the team dashboard); once published it shows to everyone looking
// for space. Owner contact details, the exact address, the map pin and the documents are never shown publicly.
module.exports = createModel('Plot', {
  required: ['plotId', 'ownerName', 'ownerPhone', 'title', 'status'],
  enums: { status: ['pending_review', 'live', 'rejected', 'removed'] },
  defaults: { status: 'pending_review', photos: [], documents: [], amenities: [], history: [] },
  unique: ['plotId'],
});
