// Checks your Higgsfield keys by making one small image (uses a little credit) and printing its link.
// Run: npm run higgsfield:check            or   npm run higgsfield:check -- "your own image prompt"
require('dotenv').config();
const higgsfield = require('../utils/higgsfield');

(async () => {
  if (!higgsfield.configured()) { console.error('Set HIGGSFIELD_API_KEY_ID and HIGGSFIELD_API_KEY_SECRET in .env first.'); process.exitCode = 1; return; }
  const prompt = process.argv.slice(2).join(' ') ||
    `Photorealistic medium shot of ${process.env.HIGGSFIELD_PRESENTER || 'a friendly, confident Indian woman in her thirties wearing smart-casual clothes'}, ` +
    'standing inside a welcoming Indian restaurant, facing the camera with a warm smile. Natural daylight. No text.';
  console.log(`Image model: ${higgsfield.IMAGE_MODEL()}\nVideo model: ${higgsfield.VIDEO_MODEL()}\n\nMaking a test image...`);
  const id = await higgsfield.generateImage({ prompt, aspectRatio: '16:9', resolution: '720p', seed: Number(process.env.HIGGSFIELD_SEED) || 4242 });
  console.log(`Request ${id}`);
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const s = await higgsfield.requestStatus(id);
    if (!higgsfield.isFinished(s.status)) { process.stdout.write('.'); continue; }
    if (s.status !== 'completed') throw new Error(higgsfield.errorText(s));
    console.log(`\nDone. Your keys work. Image (link expires in about 7 days):\n${higgsfield.outputUrl(s)}`);
    return;
  }
  console.log('\nStill working after 3 minutes; your keys work. Check the request in the Higgsfield console.');
})().catch(err => { console.error(`\nHiggsfield error: ${err.message}`); process.exitCode = 1; return; });
