const { createModel } = require('../utils/jsonModel');

module.exports = createModel('User', {
  required: ['name', 'role'],
  unique: ['handle'],
  enums: {
    role: ['business', 'associate', 'admin', 'buyer'],
    status: ['pending', 'approved', 'rejected', 'imported']
  },
  defaults: {
    status: 'approved',
    business: { sops: [] },
    associate: {}
  },
  refs: {
    assignedManager: ['User', false],
    importedBy: ['User', false]
  }
});
