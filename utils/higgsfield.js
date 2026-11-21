// Higgsfield API client for AI images and videos.
// Docs: https://docs.higgsfield.ai/docs/quickstart.md
//   POST /<model endpoint>                -> { status: 'queued', request_id, status_url, cancel_url }
//   GET  /requests/{request_id}/status    -> { status, images: [{ url }] | video: { url }, error }
//   Statuses: queued, in_progress (working); completed, failed, nsfw, canceled (finished)
// Output URLs are deleted about 7 days after a request finishes, so keep your own copy of anything you need.
const BASE = String(process.env.HIGGSFIELD_API_BASE || 'https://api.higgsfield.ai').replace(/\/+$/, ''); // override only for testing

// Models used. Each can be swapped in .env for another Higgsfield endpoint with the same inputs.
const IMAGE_MODEL = () => process.env.HIGGSFIELD_IMAGE_MODEL || '/higgsfield-ai/soul/v2/standard';
const VIDEO_MODEL = () => process.env.HIGGSFIELD_VIDEO_MODEL || '/kling-video/v3.0/pro/image-to-video';

const configured = () => Boolean(process.env.HIGGSFIELD_API_KEY_ID && process.env.HIGGSFIELD_API_KEY_SECRET);
const DONE = ['completed', 'failed', 'nsfw', 'canceled'];
const isFinished = status => DONE.includes(status);

async function call(path, { method = 'GET', body, idempotencyKey } = {}) {
  const headers = {
    Authorization: `Key ${process.env.HIGGSFIELD_API_KEY_ID}:${process.env.HIGGSFIELD_API_KEY_SECRET}`,
    Accept: 'application/json'
  };
  if (body) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey; // safe retries: same key, same request
  const res = await fetch(BASE + (path.startsWith('/') ? path : '/' + path), { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = Array.isArray(data.detail) ? data.detail.map(d => d.msg || JSON.stringify(d)).join('; ') : data.detail;
    throw Object.assign(new Error(detail || data.message || `Higgsfield request failed (${res.status})`), { status: res.status });
  }
  return data;
}

async function submit(path, body, idempotencyKey) {
  const data = await call(path, { method: 'POST', body, idempotencyKey });
  if (!data?.request_id) throw new Error('Higgsfield did not return a request ID');
  return data.request_id;
}

// Text to image. Returns a request ID; the finished status has images[].url
function generateImage({ prompt, aspectRatio = '16:9', resolution = '1080p', seed, idempotencyKey }) {
  const body = { prompt: String(prompt).slice(0, 2000), aspect_ratio: aspectRatio, resolution, batch_size: 1 };
  if (seed) body.seed = Number(seed);
  return submit(IMAGE_MODEL(), body, idempotencyKey);
}

// Image to video with native sound. `shots` (up to 6, each up to 15 seconds) become one continuous video.
// Returns a request ID; the finished status has video.url
function generateVideo({ imageUrl, prompt, shots = [], idempotencyKey }) {
  const body = { image_url: imageUrl, prompt: String(prompt).slice(0, 2500), sound: 'on' };
  if (shots.length) {
    body.multi_shots = true;
    body.multi_prompt = shots.slice(0, 6).map(s => ({ prompt: String(s.prompt).slice(0, 512), duration: Math.min(15, Math.max(1, Math.round(s.duration))) }));
  } else body.duration = 10;
  return submit(VIDEO_MODEL(), body, idempotencyKey);
}

const requestStatus = requestId => call(`/requests/${encodeURIComponent(requestId)}/status`);

// The first image/video URL from a finished status, whichever kind it is
function outputUrl(status) {
  return status?.video?.url || status?.images?.[0]?.url || null;
}

function errorText(status) {
  if (status?.status === 'nsfw') return 'Rejected by Higgsfield content moderation';
  if (status?.status === 'canceled') return 'Canceled';
  const e = status?.error;
  return String((typeof e === 'string' ? e : e?.message || e?.detail) || 'failed').slice(0, 300);
}

module.exports = { configured, isFinished, generateImage, generateVideo, requestStatus, outputUrl, errorText, IMAGE_MODEL, VIDEO_MODEL };
