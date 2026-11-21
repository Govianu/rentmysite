// The team's research for one business type (utils/playbook.json, built from Google Drive by
// scripts/build-playbook — see README): what sits idle, five opportunities, partners, a 30-second hook,
// and link-shared Drive videos and creatives. Types the sheets don't cover fall back to utils/catalog.json.
const { sectorById, sectorFor, listOf } = require('./catalog');
const data = require('./playbook.json');

const norm = s => ` ${String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;

// Creatives are served by our own server (routes/public.js /media/:id fetches each from Drive once and keeps a
// copy): browsers block Google's image redirects when Google throttles hotlinking, so direct Drive links are
// unreliable. Videos play in Drive's own player.
const APP_URL = () => (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const driveImage = (id, width = 1200) => `${APP_URL()}/api/public/media/${encodeURIComponent(id)}?w=${width}`;
const localImage = (id, width = 600) => `/api/public/media/${encodeURIComponent(id)}?w=${width}`;
const driveVideo = id => `https://drive.google.com/file/d/${encodeURIComponent(id)}/preview`;
// Only files from the team's research can be fetched through our server
const knownIds = new Set(Object.values(data.sectors).flatMap(s => [...s.images, ...s.videos].map(m => m.id)));

function sectorOf(userOrSector) {
  if (userOrSector && userOrSector.n && userOrSector.t) return userOrSector;
  if (typeof userOrSector === 'number' || /^\d+$/.test(String(userOrSector || ''))) return sectorById(Number(userOrSector));
  return sectorById(userOrSector?.sectorId) || sectorFor(userOrSector || {});
}

// The closest research row for this person: by words in their business name or category, else the first row
function bestType(types, user, sector) {
  if (!types.length) return null;
  // Their own words (business name, category, skills) count twice as much as the type's general name
  const own = norm(`${user?.business?.businessName || ''} ${user?.category || ''} ${(user?.skills || []).join(' ')}`);
  const general = norm(sector?.noun || '');
  let best = types[0], score = 0;
  for (const t of types) {
    const words = norm(t.name).trim().split(' ').filter(w => w.length > 1 && !['and', 'the', 'for'].includes(w));
    const s = words.reduce((n, w) => n + (own.includes(` ${w} `) ? 2 : general.includes(` ${w} `) ? 1 : 0), 0);
    if (s > score) { best = t; score = s; }
  }
  return best;
}

// Media made for this exact research type first, then the rest of the business type's media
function ownFirst(list, type) {
  if (!type) return list;
  const want = norm(type.name).trim();
  const mine = m => { const t = norm(m.type).trim(); return t === want || t.includes(want) || want.includes(t); };
  return [...list.filter(mine), ...list.filter(m => !mine(m))];
}

function playbookFor(userOrSector) {
  const sector = sectorOf(userOrSector);
  if (!sector) return null;
  const entry = data.sectors[String(sector.id)] || { types: [], videos: [], images: [] };
  const type = bestType(entry.types, userOrSector && !userOrSector.n ? userOrSector : null, sector);
  const opportunities = type ? type.opportunities.slice() : (sector.s || []).concat(sector.p || []).slice(0, 5);
  // Individually owned businesses see 10 ideas: the research five plus the catalog's services and products
  const extra = (sector.s || []).concat(sector.p || []).filter(x => !opportunities.some(o => norm(o) === norm(x)));
  return {
    sector,
    type: type?.name || sector.n,
    chain: Boolean(type?.chain),
    idle: type?.idle || sector.a,
    opportunities,
    moreOpportunities: type?.chain ? [] : extra.slice(0, 10 - opportunities.length),
    partners: type?.partners || listOf(sector.c || [], 3),
    hook: type?.hook || '',
    types: entry.types.map(t => t.name),
    // This exact type's own video and creatives first (e.g. a family restaurant before a fine-dine one)
    videos: ownFirst(entry.videos, type).map(v => ({ ...v, url: driveVideo(v.id) })),
    images: ownFirst(entry.images, type).map(i => ({ ...i, url: driveImage(i.id, 1200), thumb: localImage(i.id, 600) }))
  };
}

// Creatives that match one of the opportunities by name, for emails and slides
function imageFor(pb, opportunity) {
  const o = norm(opportunity);
  return pb.images.find(i => norm(i.title).includes(o.trim()) || o.includes(norm(i.title).trim())) || null;
}

module.exports = { playbookFor, imageFor, driveImage, driveVideo, knownIds };
