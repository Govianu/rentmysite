const { createModel } = require('../utils/jsonModel');

module.exports = createModel('Opportunity', {
  required: ['business', 'title'],
  enums: {
    source: ['ai', 'template'],
    status: ['suggested', 'interested', 'dismissed']
  },
  defaults: { source: 'template', status: 'suggested' },
  refs: { business: ['User', false] }
});
