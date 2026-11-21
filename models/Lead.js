const { createModel } = require('../utils/jsonModel');

const STAGES = ['new', 'contacted', 'meeting', 'cta_sent', 'signed', 'lost'];

const Lead = createModel('Lead', {
  required: ['name'],
  enums: { stage: STAGES },
  defaults: { source: 'manual', stage: 'new', history: [] },
  refs: {
    relatedUser: ['User', false],
    relatedBooking: ['Booking', false],
    owner: ['User', false]
  }
});

Lead.STAGES = STAGES;
module.exports = Lead;
