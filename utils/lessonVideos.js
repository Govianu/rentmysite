// Make-on-first-request AI presenter videos, reused by everyone with the same business type + topic.
// Made with Higgsfield in two steps:
//   1. image: a presenter in a setting that fits the business type (text to image, also kept as the poster)
//   2. video: that image brought to life, speaking the lesson script in up to 6 shots (image to video, native sound)
// A background job finishes videos even if the person closes the page, downloads each finished file
// (Higgsfield deletes outputs about 7 days after they finish) and keeps monthly usage under HIGGSFIELD_MONTHLY_MINUTES.
const fs = require('fs');
const path = require('path');
const LessonVideo = require('../models/LessonVideo');
const higgsfield = require('./higgsfield');
const { DATA_DIR } = require('./jsonModel');

const DIR = path.join(DATA_DIR, 'lesson-videos');
const MAX_PARALLEL = 3;
const MAX_SHOTS = 6;          // Higgsfield/Kling limit per video
const MAX_SHOT_SEC = 15;      // per shot
const WORDS_PER_SEC = 2.6;    // relaxed speaking pace
const MAX_SHOT_WORDS = Math.floor((MAX_SHOT_SEC - 1) * WORDS_PER_SEC);
const monthlyCap = () => Number(process.env.HIGGSFIELD_MONTHLY_MINUTES) || 20;

const words = text => String(text).trim().split(/\s+/).filter(Boolean);
const shotSeconds = text => Math.min(MAX_SHOT_SEC, Math.max(3, Math.ceil(words(text).length / WORDS_PER_SEC) + 1));

// Split a long sentence at commas, then by word count, so each piece fits in one shot
function splitLong(sentence) {
  if (words(sentence).length <= MAX_SHOT_WORDS) return [sentence];
  const out = [];
  let cur = [];
  for (const w of words(sentence)) {
    cur.push(w);
    const atComma = /,$/.test(w) && cur.length >= MAX_SHOT_WORDS / 2;
    if (cur.length >= MAX_SHOT_WORDS || atComma) { out.push(cur.join(' ')); cur = []; }
  }
  if (cur.length) out.push(cur.join(' '));
  return out;
}

// The script as up to 6 spoken lines, each short enough to say within one shot
function scriptToLines(script) {
  const sentences = (String(script).match(/[^.!?]+[.!?]+["')]*\s*/g) || [String(script)]).map(s => s.trim()).filter(Boolean).flatMap(splitLong);
  const lines = [];
  for (const s of sentences) {
    const last = lines[lines.length - 1];
    if (last && words(last).length + words(s).length <= MAX_SHOT_WORDS) lines[lines.length - 1] = `${last} ${s}`;
    else lines.push(s);
  }
  // Too long for one video: keep the opening and the closing call to action
  return lines.length > MAX_SHOTS ? [...lines.slice(0, MAX_SHOTS - 1), lines[lines.length - 1]] : lines;
}

function videoShots(script) {
  return scriptToLines(script).map(line => ({
    line,
    duration: shotSeconds(line),
    prompt: `Medium shot. The presenter looks into the camera and says, warmly and clearly: "${line.replace(/"/g, "'")}"`
  }));
}

const presenter = () => process.env.HIGGSFIELD_PRESENTER || 'a friendly, confident Indian woman in her thirties wearing smart-casual clothes';

function imagePrompt(lesson) {
  return `Photorealistic medium shot of ${presenter()}, standing ${lesson.scene || 'in a bright, modern Indian small business'}, ` +
    'facing the camera with a warm smile, mouth closed, hands relaxed, ready to speak. Natural daylight, shallow depth of field, ' +
    'clean uncluttered background, 16:9 frame with the presenter centred. No text, no logos, no watermarks.';
}

const VIDEO_PROMPT = 'The same presenter speaks directly to the camera in natural Indian English, with small natural hand gestures ' +
  'and lip movements matching the words. Steady camera, same person, clothes and setting throughout. Only the presenter\'s voice: no music, no captions, no on-screen text.';

const estimateMinutes = script => videoShots(script).reduce((sum, s) => sum + s.duration, 0) / 60;

function startOfMonth() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString(); }

async function minutesUsedThisMonth() {
  const rows = await LessonVideo.find({ createdAt: { $gte: startOfMonth() } });
  return rows.filter(v => v.status !== 'failed' && !v.testMode)
    .reduce((sum, v) => sum + (v.durationSec ? v.durationSec / 60 : estimateMinutes(v.script)), 0);
}

function publicView(v) {
  if (!v) return null;
  return {
    id: v._id, key: v.key, topic: v.topic, status: v.status,
    url: v.status === 'ready' ? `/api/lesson-videos/${v._id}/file` : null,
    poster: v.thumbFile ? `/api/lesson-videos/${v._id}/poster` : null,
    durationSec: v.durationSec || null, testMode: Boolean(v.testMode), error: v.status === 'failed' ? 'This video could not be made.' : null
  };
}

async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

function fail(video, error) {
  Object.assign(video, { status: 'failed', error: String(error).slice(0, 300) });
  console.error(`[lesson-video] Higgsfield failed for "${video.key}" at the ${video.stage || 'start'} step:`, video.error);
}

// Ask Higgsfield how one video is doing: when the image is done start the video, when the video is done keep our own copy
async function refresh(video) {
  if (video.status !== 'processing') return video;
  video.checkedAt = new Date().toISOString();
  const requestId = video.stage === 'video' ? video.videoRequestId : video.stage === 'image' ? video.imageRequestId : null;
  if (!requestId) { fail(video, 'Started with an earlier video provider'); await video.save(); return video; }

  const s = await higgsfield.requestStatus(requestId);
  if (!higgsfield.isFinished(s.status)) { await video.save(); return video; }
  if (s.status !== 'completed' || !higgsfield.outputUrl(s)) { fail(video, higgsfield.errorText(s)); await video.save(); return video; }

  if (video.stage === 'image') {
    const imageUrl = higgsfield.outputUrl(s);
    try { await download(imageUrl, path.join(DIR, `${video._id}.jpg`)); video.thumbFile = `${video._id}.jpg`; } catch { /* poster is optional */ }
    const shots = videoShots(video.script);
    try {
      video.videoRequestId = await higgsfield.generateVideo({
        imageUrl, prompt: VIDEO_PROMPT, shots: shots.map(({ prompt, duration }) => ({ prompt, duration })),
        idempotencyKey: `${video._id}-${video.startedAt}-video`
      });
    } catch (err) {
      // Queue full or a server hiccup: try again on the next check (same idempotency key). Anything else won't fix itself.
      if (!err.status || err.status === 429 || err.status >= 500) throw err;
      fail(video, err.message); await video.save(); return video;
    }
    Object.assign(video, { stage: 'video', durationSec: shots.reduce((sum, x) => sum + x.duration, 0) });
    console.log(`[lesson-video] Presenter image ready for "${video.key}"; video started (${video.videoRequestId})`);
  } else {
    await download(higgsfield.outputUrl(s), path.join(DIR, `${video._id}.mp4`));
    Object.assign(video, { status: 'ready', file: `${video._id}.mp4`, readyAt: new Date().toISOString() });
    console.log(`[lesson-video] Ready: "${video.key}"`);
  }
  await video.save();
  return video;
}

// Returns the existing video for this lesson, or starts making one
async function requestVideo({ lesson, user }) {
  const existing = await LessonVideo.findOne({ key: lesson.key });
  if (existing && existing.status !== 'failed') return { video: existing };
  if (!higgsfield.configured()) return { unavailable: 'not_configured' };

  const processing = await LessonVideo.countDocuments({ status: 'processing' });
  if (processing >= MAX_PARALLEL) return { unavailable: 'busy' };
  if ((await minutesUsedThisMonth()) + estimateMinutes(lesson.script) > monthlyCap()) {
    console.warn(`[lesson-video] Monthly cap of ${monthlyCap()} minutes reached; "${lesson.key}" shows the slide version.`);
    return { unavailable: 'monthly_limit' };
  }

  const startedAt = Date.now();
  const fields = { key: lesson.key, sectorId: lesson.sectorId, topic: lesson.topic, kind: lesson.kind, script: lesson.script,
    scene: lesson.scene, status: 'processing', stage: 'image', startedAt, imageRequestId: null, videoRequestId: null,
    file: null, thumbFile: null, durationSec: null, testMode: false, requestedBy: user._id, error: null };
  let video;
  if (existing) { Object.assign(existing, fields); video = await existing.save(); }
  else video = await LessonVideo.create(fields);

  try {
    video.imageRequestId = await higgsfield.generateImage({
      prompt: imagePrompt(lesson), aspectRatio: '16:9', resolution: '1080p',
      seed: Number(process.env.HIGGSFIELD_SEED) || 4242, // same seed keeps the presenter looking alike across lessons
      idempotencyKey: `${video._id}-${startedAt}-image`
    });
  } catch (err) {
    fail(video, err.message);
    await video.save();
    throw err;
  }
  await video.save();
  console.log(`[lesson-video] Started "${lesson.key}" (image ${video.imageRequestId})`);
  return { video };
}

// Background job: finish videos even when nobody is watching the page
let timer = null;
function startWorker() {
  if (timer || !higgsfield.configured()) return;
  timer = setInterval(async () => {
    try {
      const pending = await LessonVideo.find({ status: 'processing' });
      for (const v of pending) {
        try { await refresh(v); } catch (err) { console.error(`[lesson-video] check failed for "${v.key}":`, err.message); }
      }
    } catch (err) { console.error('[lesson-video] worker error:', err.message); }
  }, 20000);
  timer.unref?.();
  console.log(`[lesson-video] AI presenter videos on (Higgsfield); monthly cap ${monthlyCap()} minutes`);
}

module.exports = { requestVideo, refresh, publicView, minutesUsedThisMonth, monthlyCap, startWorker, videoShots, scriptToLines, imagePrompt, DIR };
