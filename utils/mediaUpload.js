const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { fail } = require('./http');

const APP_DIR = path.resolve(__dirname, '..');
const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(APP_DIR, process.env.UPLOAD_DIR)
  : path.join(APP_DIR, 'data', 'uploads');
const TEMP_DIR = path.join(UPLOAD_DIR, '.tmp');
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_USER_BYTES = 300 * 1024 * 1024;
const MAX_TOTAL_BYTES = 800 * 1024 * 1024;

const TYPES = [
  { mimeType: 'image/jpeg', extension: 'jpg', group: 'image', matches: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mimeType: 'image/png', extension: 'png', group: 'image', matches: b => b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
  { mimeType: 'image/webp', extension: 'webp', group: 'image', matches: b => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
  { mimeType: 'image/gif', extension: 'gif', group: 'image', matches: b => ['GIF87a', 'GIF89a'].includes(b.toString('ascii', 0, 6)) },
  { mimeType: 'video/mp4', extension: 'mp4', group: 'video', matches: b => b.toString('ascii', 4, 8) === 'ftyp' },
  { mimeType: 'video/webm', extension: 'webm', group: 'video', matches: b => b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) },
  { mimeType: 'application/pdf', extension: 'pdf', group: 'document', matches: b => b.toString('ascii', 0, 5) === '%PDF-' }
];

const KIND_GROUP = {
  business_image: 'image',
  portfolio_image: 'image',
  business_video: 'video',
  intro_video: 'video',
  training_video: 'video',
  business_menu: 'document',
  business_slides: 'document',
  portfolio_slides: 'document',
  course_pdf: 'document'
};
const MAX_BYTES_BY_GROUP = {
  image: 10 * 1024 * 1024,
  video: MAX_FILE_BYTES,
  document: 25 * 1024 * 1024
};

const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, callback) {
      fs.mkdir(TEMP_DIR, { recursive: true }, err => callback(err, TEMP_DIR));
    },
    filename(req, file, callback) {
      callback(null, crypto.randomUUID());
    }
  }),
  limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 5, fieldSize: 4000 },
  fileFilter(req, file, callback) {
    if (!TYPES.some(type => type.mimeType === file.mimetype)) {
      return callback(fail('Choose a JPG, PNG, WebP, GIF, MP4, WebM or PDF file', 415));
    }
    callback(null, true);
  }
});

function uploadMiddleware(req, res, next) {
  upload.single('file')(req, res, err => {
    if (err instanceof multer.MulterError) {
      const tooLarge = err.code === 'LIMIT_FILE_SIZE';
      return next(fail(tooLarge ? 'Files must be 100 MB or smaller' : 'Upload one file at a time', tooLarge ? 413 : 400));
    }
    next(err);
  });
}

async function validateUpload(file, kind) {
  const group = KIND_GROUP[kind];
  if (!group) throw fail('Choose a supported media type');
  const type = TYPES.find(item => item.mimeType === file.mimetype && item.group === group);
  if (!type) throw fail(group === 'image' ? 'Choose an image file' : group === 'video' ? 'Choose an MP4 or WebM video' : 'Choose a PDF file');
  if (file.size > MAX_BYTES_BY_GROUP[group]) {
    const limitMb = Math.round(MAX_BYTES_BY_GROUP[group] / (1024 * 1024));
    throw fail(`This file is too large. The limit for this media type is ${limitMb} MB.`, 413);
  }

  const handle = await fs.promises.open(file.path, 'r');
  const signature = Buffer.alloc(16);
  let bytesRead;
  try {
    ({ bytesRead } = await handle.read(signature, 0, signature.length, 0));
  } finally {
    await handle.close();
  }
  if (!type.matches(signature.subarray(0, bytesRead))) throw fail('The file contents do not match the selected media type');
  return type;
}

async function storeUpload(file, type) {
  const storageKey = `${path.basename(file.filename)}.${type.extension}`;
  await fs.promises.rename(file.path, path.join(UPLOAD_DIR, storageKey));
  return storageKey;
}

function mediaFilePath(storageKey) {
  if (typeof storageKey !== 'string' || path.basename(storageKey) !== storageKey) {
    throw fail('Media file not found', 404);
  }
  const resolved = path.resolve(UPLOAD_DIR, storageKey);
  if (!resolved.startsWith(`${UPLOAD_DIR}${path.sep}`)) throw fail('Media file not found', 404);
  return resolved;
}

async function cleanupFile(filePath) {
  if (!filePath) return;
  try {
    await fs.promises.unlink(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('Media cleanup failed:', err.message);
  }
}

module.exports = {
  MAX_TOTAL_BYTES,
  MAX_USER_BYTES,
  mediaFilePath,
  removeStoredUpload: storageKey => cleanupFile(mediaFilePath(storageKey)),
  removeTemporaryUpload: file => cleanupFile(file?.path),
  storeUpload,
  uploadMiddleware,
  validateUpload
};
