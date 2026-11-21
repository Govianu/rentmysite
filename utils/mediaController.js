const Media = require('../models/Media');
const { fail, str } = require('./http');
const {
  MAX_TOTAL_BYTES,
  MAX_USER_BYTES,
  removeStoredUpload,
  removeTemporaryUpload,
  storeUpload,
  validateUpload
} = require('./mediaUpload');

async function createMediaUpload({ req, owner, allowedKinds }) {
  const file = req.file;
  let storageKey;
  try {
    const body = req.body || {};
    const kind = str(body.kind);
    const title = str(body.title).slice(0, 120);
    if (!file) throw fail('Choose a file to upload');
    if (!allowedKinds.includes(kind)) throw fail('Choose a supported media type');
    if (!title) throw fail('Give this item a title');
    const type = await validateUpload(file, kind);

    const allMedia = await Media.find({});
    const totalBytes = allMedia.reduce((sum, item) => sum + (Number(item.fileSize) || 0), 0);
    const userBytes = allMedia
      .filter(item => String(item.owner) === String(owner._id))
      .reduce((sum, item) => sum + (Number(item.fileSize) || 0), 0);
    if (userBytes + file.size > MAX_USER_BYTES) {
      throw fail('Your dashboard media storage is full. Remove older items or contact RentMySite.', 413);
    }
    if (totalBytes + file.size > MAX_TOTAL_BYTES) {
      throw fail('The site media storage is full. Please contact RentMySite before uploading more.', 507);
    }

    storageKey = await storeUpload(file, type);
    return await Media.create({
      owner: owner._id,
      kind,
      title,
      description: str(body.description).slice(0, 1000),
      storageKey,
      mimeType: type.mimeType,
      fileSize: file.size
    });
  } catch (err) {
    await removeTemporaryUpload(file);
    if (storageKey) await removeStoredUpload(storageKey);
    throw err;
  }
}

async function deleteOwnedMedia({ id, owner }) {
  const media = await Media.findOne({ _id: id, owner: owner._id });
  if (!media) throw fail('Media item not found', 404);
  const result = await Media.deleteMany({ _id: id, owner: owner._id });
  if (!result.deletedCount) throw fail('Media item not found', 404);
  if (media.storageKey) await removeStoredUpload(media.storageKey);
}

module.exports = { createMediaUpload, deleteOwnedMedia };
