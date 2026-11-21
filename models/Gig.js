const { createModel } = require('../utils/jsonModel');

module.exports = createModel('Gig', {
  required: ['type', 'title'],
  enums: {
    type: ['workshop', 'shift'],
    status: ['proposed', 'open', 'filled', 'closed', 'cancelled']
  },
  defaults: { slots: 1, applicants: [], status: 'open' },
  refs: {
    venue: ['User', false],
    host: ['User', false],
    applicants: ['User', true],
    createdBy: ['User', false]
  }
});
