// AI presenter lesson videos for the dashboards. The browser sends only the lesson topic;
// the script is written on the server from the person's business type (utils/lessonScript.js).
const path = require('path');
const fs = require('fs');
const router = require('express').Router();
const LessonVideo = require('../models/LessonVideo');
const { requireAuth } = require('../middleware/auth');
const { lessonScript } = require('../utils/lessonScript');
const { requestVideo, refresh, publicView, DIR } = require('../utils/lessonVideos');
const higgsfield = require('../utils/higgsfield');
const rateLimit = require('../utils/rateLimit');
const { fail, str } = require('../utils/http');

router.use(requireAuth('business', 'associate', 'admin'));

router.get('/config', (req, res) => res.json({ enabled: higgsfield.configured() }));

router.post('/request', rateLimit(30, 60 * 60 * 1000), async (req, res) => {
  const topic = str(req.body?.topic).slice(0, 80);
  if (!topic) throw fail('Missing lesson topic');
  if (!higgsfield.configured()) return res.json({ enabled: false });
  const lesson = lessonScript({ user: req.user, topic });
  if (!lesson) return res.json({ enabled: true, unavailable: 'unknown_type' });
  try {
    const result = await requestVideo({ lesson, user: req.user });
    res.json({ enabled: true, unavailable: result.unavailable || null, video: publicView(result.video) });
  } catch (err) {
    console.error('[lesson-video] request failed:', err.message);
    res.json({ enabled: true, unavailable: 'error', video: null });
  }
});

router.get('/:id', async (req, res) => {
  let v = await LessonVideo.findById(req.params.id);
  if (!v) throw fail('Video not found', 404);
  // Check with Higgsfield at most every 10 seconds while someone is waiting
  if (v.status === 'processing' && (!v.checkedAt || Date.now() - new Date(v.checkedAt) > 10000)) {
    try { v = await refresh(v); } catch (err) { console.error('[lesson-video] status check failed:', err.message); }
  }
  res.json({ video: publicView(v) });
});

function sendStored(kind) {
  return async (req, res) => {
    const v = await LessonVideo.findById(req.params.id);
    const name = kind === 'poster' ? v?.thumbFile : v?.file;
    // The poster (the presenter image) exists before the video does, so it can be shown while the video is made
    if (!v || !name || (kind === 'video' && v.status !== 'ready')) throw fail('Video not ready', 404);
    const file = path.join(DIR, path.basename(name));
    if (!fs.existsSync(file)) throw fail('Video file missing', 404);
    res.set('Cache-Control', 'private, max-age=86400');
    res.sendFile(file); // supports seeking (HTTP range requests)
  };
}
router.get('/:id/file', sendStored('video'));
router.get('/:id/poster', sendStored('poster'));

module.exports = router;
