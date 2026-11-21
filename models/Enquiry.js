const { createModel } = require('../utils/jsonModel');

module.exports = createModel('Enquiry', {
  required: ['role', 'name', 'termsAccepted', 'termsVersion', 'termsAcceptedAt'],
  enums: { role: ['owner', 'brand', 'partner', 'host', 'pro', 'country'] },
  refs: { user: ['User', false] }
});
