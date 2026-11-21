const router = require('express').Router();
const fs = require('fs');
const Media = require('../models/Media');
const { requireAuth } = require('../middleware/auth');
const { fail } = require('../utils/http');
const { mediaFilePath } = require('../utils/mediaUpload');

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'video/mp4', 'video/webm', 'application/pdf'
]);

router.get('/:id/file', requireAuth(), async (req, res) => {
  const media = await Media.findById(req.params.id);
  if (!media || !media.storageKey) throw fail('Media file not found', 404);
  const ownerId = media.owner?._id || media.owner;
  if (req.user.role !== 'admin' && String(ownerId) !== String(req.user._id)) {
    throw fail('Media file not found', 404);
  }
  if (!ALLOWED_MIME_TYPES.has(media.mimeType)) throw fail('Media file not found', 404);

  const filePath = mediaFilePath(media.storageKey);
  try {
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) throw fail('Media file not found', 404);
  } catch (err) {
    if (err.code === 'ENOENT') throw fail('Media file not found', 404);
    throw err;
  }

  res.set({
    'Content-Type': media.mimeType,
    'Content-Disposition': 'inline',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
    'Cross-Origin-Resource-Policy': 'same-origin'
  });
  if (media.mimeType === 'application/pdf') res.set('Content-Security-Policy', 'sandbox');
  res.sendFile(filePath);
});

module.exports = router;
