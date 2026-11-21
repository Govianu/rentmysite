// Business-type wording for emails and dashboards, built from the homepage catalog (utils/catalog.json).
// Accepts a user/business object ({ sectorId, category }) or, for older callers, a category string.
const { sectorFor, publicSector, listOf, plural, partnersOf, withArticle } = require('./catalog');

const cap = s => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);

const GENERIC = {
  label: 'business',
  display: 'Business',
  bookingLabel: 'booking',
  growthTitle: 'Ways to grow your business',
  growthDescription: 'Explore practical ways to earn from available space, services and quiet hours.',
  isProfessional: false,
  sector: null,
  keywords: null
};

function industryFor(input) {
  const who = input && typeof input === 'object' ? input : { category: input };
  const sector = sectorFor(who);
  if (!sector) return { ...GENERIC };
  const noun = sector.noun;
  const isProfessional = sector.t === 'p';
  return {
    label: noun,
    withArticle: withArticle(noun),
    plural: plural(noun),
    display: cap(noun),
    bookingLabel: `${noun} booking`,
    growthTitle: isProfessional ? `Ways to earn as ${withArticle(noun)}` : `${cap(noun)} growth ideas`,
    growthDescription: isProfessional
      ? `Earn through ${listOf(sector.s)}, with partners like ${listOf(sector.c, 3)}.`
      : `Earn from ${listOf(sector.s)}, and team up with ${listOf(sector.c, 3)}.`,
    isProfessional,
    sector: publicSector(sector),
    keywords: { services: sector.s, products: sector.p, partners: partnersOf(sector), assets: sector.a, example: sector.e }
  };
}

module.exports = { industryFor };
