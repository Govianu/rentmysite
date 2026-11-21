// Location suggestions for the homepage "Location" box. With GOOGLE_MAPS_API_KEY set, Google Places
// Autocomplete (Places API, New) restricted to India; without it, OpenStreetMap search through Photon, which needs
// no key. Called from the server so the Google key never reaches the browser.
const cache = new Map();
const CACHE_MAX = 500;

async function fromGoogle(q, key) {
  const r = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': key },
    body: JSON.stringify({ input: q, includedRegionCodes: ['in'] }),
    signal: AbortSignal.timeout(4000)
  });
  if (!r.ok) throw new Error(`Google Places ${r.status}`);
  const d = await r.json();
  return (d.suggestions || []).map(s => s.placePrediction?.text?.text).filter(Boolean);
}

async function fromOsm(q) {
  // Biased towards Bengaluru, where the first sites are
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lang=en&lat=12.97&lon=77.59`;
  const r = await fetch(url, { headers: { 'User-Agent': 'RentMySite/1.0' }, signal: AbortSignal.timeout(4000) });
  if (!r.ok) throw new Error(`Photon ${r.status}`);
  const d = await r.json();
  return (d.features || []).map(f => {
    const p = f.properties || {};
    return [p.name, p.street, p.district || p.locality, p.city || p.county, p.state, p.country]
      .filter((v, i, a) => v && a.indexOf(v) === i).join(', ');
  }).filter(Boolean);
}

async function suggest(q) {
  q = String(q || '').trim().slice(0, 120);
  if (q.length < 3) return [];
  const k = q.toLowerCase();
  if (cache.has(k)) return cache.get(k);
  const key = process.env.GOOGLE_MAPS_API_KEY;
  let list;
  try { list = key ? await fromGoogle(q, key) : await fromOsm(q); }
  catch (e) { if (!key) throw e; console.warn('[places]', e.message, '- falling back to OpenStreetMap'); list = await fromOsm(q); }
  list = [...new Set(list)].slice(0, 6);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(k, list);
  return list;
}

module.exports = { suggest, source: () => (process.env.GOOGLE_MAPS_API_KEY ? 'google' : 'osm') };
