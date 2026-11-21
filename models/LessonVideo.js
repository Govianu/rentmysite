const { createModel } = require('../utils/jsonModel');

// One AI presenter video per business type + lesson topic, made on first request and reused by everyone.
// Made with Higgsfield: stage 'image' (presenter picture, imageRequestId) then 'video' (videoRequestId).
module.exports = createModel('LessonVideo', {
  required: ['key', 'topic', 'status'],
  enums: { status: ['processing', 'ready', 'failed'], stage: ['image', 'video'] },
  refs: { requestedBy: ['User', false] }
});
