const { createModel } = require('../utils/jsonModel');

module.exports = createModel('Media', {
  required: ['owner', 'kind', 'title'],
  enums: {
    kind: [
      'intro_video', 'training_video', 'course_pdf', 'portfolio_image', 'portfolio_slides',
      'business_video', 'business_image', 'business_menu', 'business_slides'
    ],
    status: ['pending', 'approved', 'rejected']
  },
  defaults: { status: 'approved' },
  refs: {
    owner: ['User', false],
    reviewedBy: ['User', false]
  }
});
