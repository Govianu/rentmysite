// What a space can become, and the indicative estimate. The same figures and formula as the homepage's
// 60-second estimate (public/index.html), from the RentMySite landowner deck: indicative ₹ per sq ft per month on
// a Bengaluru main-road plot, before operating costs. Illustrative only; a survey sets the real figure.
const USES = [
  { key: 'courts', name: 'Pickleball and padel courts', low: 30, high: 50 },
  { key: 'markets', name: 'Weekend markets and events', low: 20, high: 45 },
  { key: 'qsr', name: 'Drive-through QSR pad', low: 25, high: 40 },
  { key: 'kiosks', name: 'Food kiosk court', low: 20, high: 35 },
  { key: 'darkstore', name: 'Dark store and delivery hub', low: 15, high: 25 },
  { key: 'banquet', name: 'Banquet lawn and weddings', low: 12, high: 25 },
  { key: 'carcare', name: 'Car care and detailing', low: 14, high: 22 },
  { key: 'ev', name: 'EV and fleet parking', low: 12, high: 20 },
  { key: 'storage', name: 'Container storage and yard', low: 8, high: 15 }
];

// Best uses for each kind of space (shown in the owner's free report)
const FIT = {
  'empty-plot-or-open-land': ['kiosks', 'ev', 'markets', 'courts', 'qsr', 'storage'],
  'terrace-or-rooftop': ['markets', 'courts', 'banquet'],
  'godown-or-warehouse': ['darkstore', 'storage'],
  'closed-shed-or-factory': ['darkstore', 'storage', 'markets', 'ev'],
  'institutional-or-society-land': ['markets', 'ev', 'storage', 'courts'],
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
const keyOf = t => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
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
