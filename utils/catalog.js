// The 100 business types and professions shown on the homepage, shared by emails and dashboards.
// Source of truth: utils/catalog.json (sectors, support groups, singular nouns, look per group).
const data = require('./catalog.json');

const byId = new Map(data.sectors.map(s => [s.id, s]));
const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '');

// Older accounts only stored a free-text category (e.g. "restaurant", "restaurantsqsrs", "chef")
const ALIASES = {
  restaurant: 1, restaurants: 1, qsr: 1, hotel: 2, resort: 2, cafe: 3, coffee: 3, gym: 4, fitness: 4, spa: 5, salon: 6, beauty: 6,
  barber: 7, mall: 8, supermarket: 9, grocery: 9, coworking: 11, office: 12, banquetvenue: 15, banquet: 15, banquethall: 15, school: 17,
  college: 18, daycare: 19, hospital: 20, clinic: 21, dental: 22, pharmacy: 24, bakery: 43, cloudkitchen: 44, chef: 52, baker: 53,
  trainer: 55, yoga: 56, beautician: 59, photographer: 62, electrician: 68, plumber: 69, carpenter: 70
};

function sectorById(id) { return byId.get(Number(id)) || null; }

function sectorFor(user) {
  if (!user) return null;
  const direct = sectorById(user.sectorId);
  if (direct) return direct;
  const key = norm(user.category || user.associate?.skill);
  if (!key) return null;
  const exact = data.sectors.find(s => norm(s.n) === key);
  if (exact) return exact;
  if (ALIASES[key]) return sectorById(ALIASES[key]);
  // Generic words say nothing about the type, so they get the general wording
  if (['business', 'professional', 'brand', 'other', 'general', 'partner'].includes(key) || key.length < 4) return null;
  const partial = data.sectors.find(s => norm(s.n).startsWith(key) || key.startsWith(norm(s.noun)));
  return partial || null;
}

// Plain-language summary used in emails: "catering, celebration packages and weekly meal subscriptions"
function listOf(items, max = 3) {
  const lower = x => (/^[A-Z]{2}/.test(x) ? x : x.charAt(0).toLowerCase() + x.slice(1));
  const list = (items || []).slice(0, max).map(x => lower(String(x)));
  if (list.length <= 1) return list.join('');
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

// "restaurant" -> "restaurants", "bakery" -> "bakeries", "laundry business" -> "laundry businesses"
function plural(noun) {
  const n = String(noun || '');
  if (/[^aeiou]y$/i.test(n)) return n.slice(0, -1) + 'ies';
  if (/(s|sh|ch|x)$/i.test(n)) return n + 'es';
  return n + 's';
}

// Partner names from the catalog ("Bakers & Pastry Professionals") as plain plurals ("bakers")
function partnersOf(sector, max = 3) {
  return (sector?.c || []).slice(0, max).map(name => {
    const match = data.sectors.find(s => s.n === name);
    return match ? plural(match.noun) : name.toLowerCase();
  });
}

// "a chef", "an electrician", "an HVAC technician", "an IT consultant"
function withArticle(noun) {
  const n = String(noun || '');
  const acronym = /^[A-Z]{2}/.test(n);
  const vowelSound = acronym ? /^[AEFHILMNORSX]/.test(n) : /^[aeiou]/i.test(n) && !/^(uni|eu|one)/i.test(n);
  return `${vowelSound ? 'an' : 'a'} ${n}`;
}

function publicSector(sector) {
  if (!sector) return null;
  return { ...sector, style: data.styles[sector.g] || data.styles.food, support: data.groups[sector.g] || null };
}

module.exports = { data, sectorById, sectorFor, listOf, plural, partnersOf, withArticle, publicSector };
