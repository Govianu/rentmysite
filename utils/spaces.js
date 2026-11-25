// What a space can become, and the indicative estimate. The same figures and formula as the homepage's
// 60-second estimate (public/index.html), from the RentMySite landowner deck: indicative ₹ per sq ft per month on
// a Bengaluru main-road dormant space, before operating costs. Illustrative only; a survey sets the real figure.
const USES = [
  // needs: what the use needs; funder: who pays for the build-out; build: weeks from approval to opening
  // (RentMySite "For landowners" PDF, November 2026)
  { key: 'courts', name: 'Pickleball and padel courts', low: 30, high: 50, needs: '8,000 sq ft and up', funder: 'We do', build: '6–8 weeks' },
  { key: 'markets', name: 'Weekend markets and events', low: 20, high: 45, needs: '10,000 sq ft and up', funder: 'We do', build: '1–2 weeks' },
  { key: 'qsr', name: 'Drive-through QSR pad', low: 25, high: 40, needs: '8,000 sq ft, highway or main road', funder: 'Brand does', build: '8–12 weeks' },
  { key: 'kiosks', name: 'Food kiosk court', low: 20, high: 35, needs: '4,000 sq ft, frontage', funder: 'Brands do', build: '4–6 weeks' },
  { key: 'darkstore', name: 'Dark store and delivery hub', low: 15, high: 25, needs: '4,000 sq ft, paved or built', funder: 'Brand does', build: '3–6 weeks' },
  { key: 'banquet', name: 'Banquet lawn and weddings', low: 12, high: 25, needs: '20,000 sq ft, quiet surroundings', funder: 'We do, or you do', build: '4–8 weeks' },
  { key: 'carcare', name: 'Car care and detailing', low: 14, high: 22, needs: '5,000 sq ft, frontage', funder: 'Operator does', build: '3–5 weeks' },
  { key: 'ev', name: 'EV and fleet parking', low: 12, high: 20, needs: '3,000 sq ft and up', funder: 'We do', build: '2–4 weeks' },
  { key: 'storage', name: 'Container storage and yard', low: 8, high: 15, needs: '5,000 sq ft and up', funder: 'You do, or we do', build: '1–3 weeks' },
  { key: 'cottages', name: 'Cottages and glamping, with NomadLivings', low: 4, high: 8, needs: '1 acre and up, outskirts', funder: 'We do', build: '3–6 months' }
];

// Best uses for each kind of space (shown in the owner's free report)
const FIT = {
  'vacant-site-or-open-space': ['kiosks', 'ev', 'markets', 'courts', 'qsr', 'storage', 'cottages'],
  'terrace-or-rooftop': ['markets', 'courts', 'banquet'],
  'godown-or-warehouse': ['darkstore', 'storage'],
  'closed-shed-or-factory': ['darkstore', 'storage', 'markets', 'ev'],
  'institutional-or-society-campus': ['markets', 'ev', 'storage', 'courts'],
  'shop-or-showroom': ['kiosks', 'darkstore'],
  'hall-or-event-space': ['banquet', 'markets'],
  'parking-area': ['ev', 'carcare', 'markets'],
  default: ['kiosks', 'darkstore', 'ev', 'storage']
};

const TIERS = [
  { key: 'we', name: 'We fund the build', share: 0.35, note: 'Nothing out of pocket. A smaller share while we recover the build cost.' },
  { key: 'brand', name: 'The brand funds (standard)', share: 0.5, note: 'Brands or partners pay for the build-out.' },
  { key: 'you', name: 'You fund the build', share: 0.65, note: 'A larger share, because no build cost is recovered from your site.' }
];

// "Terrace or rooftop", "terrace_or_rooftop" and "terrace-or-rooftop" all find the same entry
// Accounts saved under older names ("Empty plot or open land", "Open land or vacant site",
// "Institutional or society land") get the same uses as the current names
const keyOf = t => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  .replace(/^(empty-plot-or-open-land|empty-plot|open-land-or-vacant-site)$/, 'vacant-site-or-open-space')
  .replace(/^institutional-or-society-land$/, 'institutional-or-society-campus');
function usesFor(category) {
  return (FIT[keyOf(category)] || FIT.default).map(k => USES.find(u => u.key === k));
}

// Site revenue = size x the average indicative rate of the chosen uses x a location factor (1 on a main road).
// Operating costs about 45% of revenue (₹2.9L of ₹6.5L in the deck's 20,000 sq ft example).
function estimateFor(size, { road = 1, uses = null, category = null } = {}) {
  const chosen = uses || usesFor(category).slice(0, 4);
  const avg = chosen.reduce((s, u) => s + (u.low + u.high) / 2, 0) / chosen.length;
  const revenue = size * avg * road;
  const costs = revenue * 0.45, profit = revenue - costs;
  return { revenue, costs, profit, share35: profit * 0.35, share50: profit * 0.5, share65: profit * 0.65, uses: chosen.map(u => u.name) };
}

module.exports = { USES, TIERS, usesFor, estimateFor };
