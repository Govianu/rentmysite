const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');

const previousDataDir = process.env.DATA_DIR;
const testDataDir = path.join(os.tmpdir(), 'pmb-lesson-video-data');
process.env.DATA_DIR = testDataDir;
const { DIR } = require('../utils/lessonVideos');
if (previousDataDir === undefined) delete process.env.DATA_DIR;
else process.env.DATA_DIR = previousDataDir;

test('lesson videos are stored under the configured data directory', () => {
  assert.equal(DIR, path.join(testDataDir, 'lesson-videos'));
});

test('lesson scripts become at most 6 spoken shots of at most 15 seconds', () => {
  const { videoShots } = require('../utils/lessonVideos');
  const { lessonScript } = require('../utils/lessonScript');
  const lesson = lessonScript({ user: { sectorId: 1 }, topic: 'Dining memberships' });
  assert.ok(lesson.scene.includes('restaurant'));
  const shots = videoShots(lesson.script);
  assert.ok(shots.length >= 1 && shots.length <= 6);
  for (const s of shots) {
    assert.ok(s.duration >= 3 && s.duration <= 15);
    assert.ok(s.prompt.length <= 512);
  }
  assert.ok(shots[0].line.startsWith("Hi, I'm your RentMySite guide."));
  assert.ok(shots[shots.length - 1].line.includes('Help me launch this'));
});

test('a long run-on sentence is split to fit shots', () => {
  const { scriptToLines } = require('../utils/lessonVideos');
  const long = Array.from({ length: 120 }, (_, i) => `word${i}`).join(' ') + '.';
  const lines = scriptToLines(long);
  assert.ok(lines.length > 1 && lines.length <= 6);
  for (const l of lines) assert.ok(l.split(/\s+/).length <= 36);
});
