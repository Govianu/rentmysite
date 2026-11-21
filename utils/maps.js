// Pulls a business name (and coordinates when present) out of a Google Maps link.
// Short links (maps.app.goo.gl) are followed to their full URL first.

async function resolveMapsUrl(input) {
  let url = String(input || '').trim();
  if (!/^https?:\/\//i.test(url)) throw Object.assign(new Error('Paste a full Google Maps link starting with https://'), { status: 400, expose: true });

  if (/goo\.gl|maps\.app/i.test(url)) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      url = res.url || url;
    } catch {
      /* keep the short link; name parsing may fail below */
    }
  }

  const out = { mapsUrl: url, name: null, lat: null, lng: null };

  const place = url.match(/\/maps\/place\/([^/@?]+)/);
  if (place) out.name = decodeURIComponent(place[1].replace(/\+/g, ' ')).split(',')[0].trim();

  if (!out.name) {
    const q = new URL(url).searchParams.get('q') || new URL(url).searchParams.get('query');
    if (q) out.name = q.split(',')[0].trim();
  }

  const at = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (at) {
    out.lat = parseFloat(at[1]);
    out.lng = parseFloat(at[2]);
  }
  return out;
}

module.exports = { resolveMapsUrl };
