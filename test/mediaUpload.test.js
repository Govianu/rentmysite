const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const previousUploadDir = process.env.UPLOAD_DIR;
const uploadRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmb-media-test-'));
process.env.UPLOAD_DIR = uploadRoot;
const { mediaFilePath, storeUpload, validateUpload } = require('../utils/mediaUpload');

function makeFile(name, bytes, mimetype, declaredSize = bytes.length) {
  const filePath = path.join(uploadRoot, name);
  fs.writeFileSync(filePath, bytes);
  return { path: filePath, filename: name, mimetype, size: declaredSize };
}

test('accepts a supported image with a matching file signature', async () => {
  const file = makeFile('photo.tmp', Buffer.from([0xff, 0xd8, 0xff, 0x00]), 'image/jpeg');
  const type = await validateUpload(file, 'business_image');

  assert.equal(type.mimeType, 'image/jpeg');
  assert.equal(type.extension, 'jpg');
});

test('rejects a spoofed signature, a mismatched media kind, and oversized photos', async () => {
  const spoofed = makeFile('spoof.tmp', Buffer.from('not an image'), 'image/jpeg');
  await assert.rejects(validateUpload(spoofed, 'business_image'), /do not match/);
  await assert.rejects(validateUpload(spoofed, 'business_video'), /MP4 or WebM/);

  const oversized = makeFile('large.tmp', Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg', 10 * 1024 * 1024 + 1);
  await assert.rejects(validateUpload(oversized, 'business_image'), /10 MB/);
});

test('stores files under generated keys and resolves only files within the upload directory', async () => {
  const file = makeFile('upload.tmp', Buffer.from('%PDF-1.7'), 'application/pdf');
  file.filename = '550e8400-e29b-41d4-a716-446655440000';
  const key = await storeUpload(file, { extension: 'pdf' });

  assert.match(key, /^[0-9a-f-]+\.pdf$/i);
  assert.equal(fs.existsSync(mediaFilePath(key)), true);
  assert.throws(() => mediaFilePath(`..${path.sep}outside.pdf`), /not found/);
});

test.after(async () => {
  await fs.promises.rm(uploadRoot, { recursive: true, force: true });
  if (previousUploadDir === undefined) delete process.env.UPLOAD_DIR;
  else process.env.UPLOAD_DIR = previousUploadDir;
});
