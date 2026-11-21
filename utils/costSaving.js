// Cost saving ("budget optimisation"), the second vertical next to revenue: five ways each kind of business
// can cut its top costs through RentMySite. Built from the team's research sheets (the "Budget
// optimisation focus" column, one line per category) and expanded into five concrete levers per category.
// Percentages are planning ranges, confirmed with each owner's real bills.
const { sectorById, sectorFor } = require('./catalog');
const playbook = require('./playbook.json');
const { savingPitch } = require('./pitch');

// Where each of the 100 business and professional types loses money, from web research into Indian industry
// data (one entry per type id, with sources). Types without an entry fall back to their broad category below.
const BY_TYPE = (() => {
  try { return Object.fromEntries(require('./savingsByType.json').map(t => [t.id, t])); } catch { return {}; }
})();

const CATEGORIES = {
  food: {
    label: 'Restaurants & food',
    topCosts: ['milk and dairy', 'vegetables', 'cooking oil', 'gas', 'staff'],
    levers: [
      { title: 'Buy direct from farmers and producers', how: 'Milk, vegetables and staples straight from farms, dairies and mills instead of dealers and distributors.', saving: '5–10% on raw material' },
      { title: 'Group buying with other RentMySite restaurants', how: 'Oil, gas cylinders, packaging and cleaning supplies ordered together with nearby partners at bulk rates.', saving: '4–8% on consumables' },
      { title: 'Cut waste with demand forecasting', how: 'Plan daily prep from past sales (POS and delivery data) so less food is thrown away.', saving: '10–20% on food waste' },
      { title: 'Lower energy bills', how: 'Efficient burners, induction for prep, solar water heating and switching off idle equipment in quiet hours.', saving: '10–25% on power and gas' },
      { title: 'Share staff and riders', how: 'Cross-trained staff shared with partner kitchens in quiet hours, and shared delivery riders.', saving: '5–15% on staffing' }
    ],
    example: 'Buying 1,000 litres of milk a day at ₹2 less per litre saves ₹2,000 a day, about ₹60,000 a month.'
  },
  hospitality: {
    label: 'Hotels & stays',
    topCosts: ['linen and laundry', 'toiletries and amenities', 'power', 'staff', 'booking commissions'],
    levers: [
      { title: 'Bulk laundry contracts', how: 'One laundry contract pooled across RentMySite hotels and stays nearby, priced per kilo at volume.', saving: '15–25% on laundry' },
      { title: 'Group buying of amenities', how: 'Toiletries, linen and room supplies bought together with other partners.', saving: '10–15% on amenities' },
      { title: 'Rooftop solar and efficient cooling', how: 'Solar on the roof, heat pumps for hot water and room-wise AC control.', saving: '20–40% on power' },
      { title: 'Shared housekeeping in quiet months', how: 'Housekeeping and maintenance staff shared with partner properties when occupancy is low.', saving: '5–10% on staffing' },
      { title: 'More direct bookings', how: 'Corporate and partner bookings through RentMySite instead of high-commission travel sites.', saving: '10–18% on booking commissions' }
    ],
    example: 'Saving ₹40 on laundry per occupied room a day across 40 rooms is about ₹48,000 a month.'
  },
  fitness: {
    label: 'Fitness, sports & wellness',
    topCosts: ['power', 'equipment maintenance', 'products', 'staff'],
    levers: [
      { title: 'Solar and smart lighting', how: 'Solar panels, LED lights and timers on cardio zones, pools and courts.', saving: '20–35% on power' },
      { title: 'Pooled equipment maintenance', how: 'One annual maintenance contract shared across RentMySite gyms, studios and academies.', saving: '15–25% on maintenance' },
      { title: 'Shared trainers and coaches', how: 'Specialist trainers shared between partner venues instead of full-time hires for every slot.', saving: '10–20% on staffing' },
      { title: 'Direct product sourcing', how: 'Supplements, oils, towels and retail products bought direct from brands.', saving: '8–15% on products' },
      { title: 'Group insurance and software', how: 'Member management software and insurance bought as a group.', saving: '10–20% on subscriptions' }
    ],
    example: 'Cutting a ₹1,20,000 monthly power bill by 25% with solar and timers saves ₹30,000 a month.'
  },
  retail: {
    label: 'Retail & shops',
    topCosts: ['stock purchase', 'rent', 'power', 'packaging', 'delivery'],
    levers: [
      { title: 'Buy direct from manufacturers', how: 'Fast-moving stock straight from manufacturers and brands, skipping a layer of distributors.', saving: '5–12% on stock' },
      { title: 'Shared delivery', how: 'One delivery fleet shared with nearby RentMySite shops for home and bulk orders.', saving: '20–30% on delivery' },
      { title: 'Group-bought packaging', how: 'Bags, boxes and labels ordered together at volume prices.', saving: '10–20% on packaging' },
      { title: 'Lower power bills', how: 'LED lighting, efficient display fridges and rooftop solar.', saving: '15–30% on power' },
      { title: 'Earn from shelf and wall space', how: 'Brands pay for display space and sampling, offsetting rent.', saving: 'Offsets 5–15% of rent' }
    ],
    example: 'Buying ₹5,00,000 of monthly stock 6% cheaper direct from the maker saves ₹30,000 a month.'
  },
  spaces: {
    label: 'Buildings & spaces',
    topCosts: ['maintenance', 'security', 'power', 'water'],
    levers: [
      { title: 'Pooled facility contracts', how: 'Housekeeping, lifts, generators and pest control on one contract with neighbouring RentMySite properties.', saving: '10–20% on maintenance' },
      { title: 'Shared security', how: 'One security agency and control room covering several nearby buildings.', saving: '10–15% on security' },
      { title: 'Rooftop solar', how: 'Solar on the roof, or rented out as a solar site.', saving: '25–40% on common-area power' },
      { title: 'Water reuse', how: 'Sewage and rainwater treated and reused for flushing and gardens.', saving: '20–30% on water' },
      { title: 'Smart metering', how: 'Sub-meters and timers to find and stop waste in common areas.', saving: '5–10% on utilities' }
    ],
    example: 'A building spending ₹2,00,000 a month on common-area power saves about ₹60,000 a month with rooftop solar.'
  },
  services: {
    label: 'Service businesses',
    topCosts: ['materials', 'rent', 'power', 'staff'],
    levers: [
      { title: 'Bulk material buying', how: 'Materials and consumables bought together with other RentMySite service businesses.', saving: '8–15% on materials' },
      { title: 'Shared space', how: 'Share a workshop, store room or counter with a partner instead of renting alone.', saving: '15–30% on rent' },
      { title: 'Shared transport', how: 'One van or pickup route shared with nearby partners.', saving: '20–30% on transport' },
      { title: 'Lower power bills', how: 'Efficient machines, timers and rooftop solar.', saving: '10–25% on power' },
      { title: 'Shared staff for peaks', how: 'Trained part-time staff from the RentMySite network for busy days only.', saving: '5–15% on staffing' }
    ],
    example: 'Sharing a ₹60,000-a-month space with one partner saves ₹30,000 a month.'
  },
  healthcare: {
    label: 'Healthcare',
    topCosts: ['consumables', 'reagents', 'power', 'staff'],
    levers: [
      { title: 'Group purchasing with other clinics', how: 'Consumables, reagents and medicines ordered together with other RentMySite clinics and labs.', saving: '8–15% on consumables' },
      { title: 'Direct from distributors', how: 'Skip a layer of stockists for regular items.', saving: '5–10% on purchases' },
      { title: 'Shared diagnostics and equipment', how: 'Send tests to a partner lab, or share expensive equipment, instead of buying it.', saving: 'Avoids lakhs in equipment' },
      { title: 'Pooled waste and maintenance contracts', how: 'Biomedical waste, AMC and housekeeping contracts pooled with nearby partners.', saving: '10–20% on contracts' },
      { title: 'Solar and efficient cooling', how: 'Solar panels and efficient ACs for clinics open long hours.', saving: '15–30% on power' }
    ],
    example: 'A clinic buying ₹3,00,000 of consumables a month saves about ₹30,000 a month at 10% group pricing.'
  },
  education: {
    label: 'Schools & education',
    topCosts: ['transport', 'power', 'stationery', 'maintenance'],
    levers: [
      { title: 'Shared buses', how: 'Bus routes and drivers shared with nearby RentMySite schools and institutes.', saving: '15–25% on transport' },
      { title: 'Rooftop solar', how: 'Large school roofs turned into solar plants.', saving: '30–50% on power' },
      { title: 'Bulk stationery and uniforms', how: 'Stationery, books and uniforms bought together at volume.', saving: '10–15% on supplies' },
      { title: 'Pooled maintenance', how: 'Housekeeping, security and repairs on one contract with partner campuses.', saving: '10–20% on maintenance' },
      { title: 'Shared specialist teachers', how: 'Teachers for music, sport or coding shared across schools.', saving: '20–30% on those salaries' }
    ],
    example: 'Sharing two bus routes with a nearby school can save ₹40,000–60,000 a month.'
  },
  entertainment: {
    label: 'Entertainment & events',
    topCosts: ['power', 'staff', 'food and drink stock', 'maintenance'],
    levers: [
      { title: 'Solar and efficient cooling', how: 'Solar panels and smarter AC schedules for large halls.', saving: '20–35% on power' },
      { title: 'Shared event staff', how: 'Ushers, technicians and security booked from the RentMySite network per event.', saving: '10–20% on staffing' },
      { title: 'Direct food and drink sourcing', how: 'Snacks and drinks bought direct from producers and brands.', saving: '8–15% on stock' },
      { title: 'Pooled maintenance', how: 'Sound, lighting and AC maintenance contracts shared with other venues.', saving: '10–20% on maintenance' },
      { title: 'Brand-sponsored upgrades', how: 'Brands fund screens, seating or signage in return for visibility.', saving: 'Saves capital spend' }
    ],
    example: 'Buying ₹2,00,000 of snacks and drinks a month 10% cheaper saves ₹20,000 a month.'
  },
  industrial: {
    label: 'Factories, farms & warehouses',
    topCosts: ['raw material', 'power', 'logistics'],
    levers: [
      { title: 'Direct sourcing', how: 'Raw material straight from producers and mills, grouped with other RentMySite units.', saving: '5–10% on raw material' },
      { title: 'Solar on sheds and roofs', how: 'Rooftop or ground solar for daytime machinery.', saving: '25–40% on power' },
      { title: 'Shared transport and return loads', how: 'Trucks shared with partners, and return trips carrying their goods.', saving: '15–30% on logistics' },
      { title: 'Group-bought packaging', how: 'Bags, cartons and labels ordered together at volume.', saving: '10–20% on packaging' },
      { title: 'Rent out idle capacity', how: 'Spare machine hours, floor space or cold rooms rented to partners.', saving: 'Offsets fixed costs' }
    ],
    example: 'Filling empty return trips on four trucks a week can save ₹50,000 or more a month.'
  },
  automotive: {
    label: 'Automotive',
    topCosts: ['spares', 'consumables', 'power', 'staff'],
    levers: [
      { title: 'Direct tie-ups with distributors', how: 'Spares and tyres from authorised distributors at volume rates, grouped with other garages.', saving: '5–12% on spares' },
      { title: 'Group-bought lubricants and consumables', how: 'Oil, coolant and cleaning supplies ordered together.', saving: '8–15% on consumables' },
      { title: 'Solar on the canopy', how: 'Solar on the workshop or forecourt canopy.', saving: '20–35% on power' },
      { title: 'Water recycling for washing', how: 'Recycle wash water instead of buying tankers.', saving: '30–50% on water' },
      { title: 'Shared specialist technicians', how: 'Denting, electrical and EV specialists shared across RentMySite garages.', saving: '10–20% on staffing' }
    ],
    example: 'Buying ₹3,00,000 of spares a month 8% cheaper saves ₹24,000 a month.'
  },
  professional: {
    label: 'Professionals',
    topCosts: ['materials and tools', 'travel', 'marketing', 'workspace'],
    levers: [
      { title: 'Shared venues through RentMySite', how: 'Work from partner spaces in their quiet hours instead of renting your own.', saving: 'Up to 100% of workspace rent' },
      { title: 'Bulk material buying', how: 'Tools, products and materials bought together with other RentMySite professionals.', saving: '8–15% on materials' },
      { title: 'One marketing platform', how: 'Get found and booked through RentMySite instead of paying for several listing sites and ads.', saving: '30–60% on marketing' },
      { title: 'Clustered bookings', how: 'Bookings grouped by area and day so you travel less between jobs.', saving: '15–25% on travel' },
      { title: 'Shared software and insurance', how: 'Billing, scheduling and design software, and insurance, bought as a group.', saving: '10–30% on subscriptions' }
    ],
    example: 'Dropping two paid listing sites and a ₹10,000 monthly ad budget can save ₹15,000 or more a month.'
  }
};

// Team sheet category -> cost category
const FROM_SHEET = {
  'Restaurants & Food': 'food', 'Hospitality': 'hospitality', 'Fitness & Wellness': 'fitness', 'Sports & Fitness': 'fitness',
  'Retail': 'retail', 'Spaces': 'spaces', 'Services': 'services', 'Facility Services': 'services', 'Healthcare': 'healthcare',
  'Education': 'education', 'Entertainment': 'entertainment', 'Events': 'entertainment', 'Industrial & Agri': 'industrial',
  'Automotive': 'automotive'
};
// Website catalog category (utils/catalog.json "cat") -> cost category, for types the sheets don't cover
const FROM_CATALOG = {
  'Food & Hospitality': 'food', 'Food': 'food', 'Hospitality': 'hospitality', 'Fitness': 'fitness', 'Wellness': 'fitness',
  'Sports': 'fitness', 'Beauty': 'services', 'Retail': 'retail', 'Retail Real Estate': 'spaces', 'Mobility Retail': 'automotive',
  'Workspace': 'spaces', 'Commercial Real Estate': 'spaces', 'Residential': 'spaces', 'Entertainment': 'entertainment',
  'Events': 'entertainment', 'Education': 'education', 'Healthcare': 'healthcare', 'Healthcare Retail': 'healthcare',
  'Pet Care': 'healthcare', 'Automotive': 'automotive', 'Mobility': 'automotive', 'Logistics': 'industrial',
  'Logistics Real Estate': 'industrial', 'Cold Chain': 'industrial', 'Manufacturing': 'industrial', 'Construction': 'industrial',
  'Real Estate': 'services', 'Design': 'services', 'Creative': 'services', 'Services': 'services', 'Professional Services': 'services'
};

function costCategoryFor(sector) {
  if (!sector) return 'services';
  if (sector.t === 'p') return 'professional';
  const types = playbook.sectors[String(sector.id)]?.types || [];
  const fromSheet = types.map(t => FROM_SHEET[t.category]).find(Boolean);
  return fromSheet || FROM_CATALOG[sector.cat] || 'services';
}

// Cost-saving plan for a user (or a sector id), as we pitch it: what they save, the hard part alone, and what
// RentMySite does. The internal `how` notes stay with the team (CATEGORIES).
function costSavingFor(userOrSectorId) {
  const sector = typeof userOrSectorId === 'number'
    ? sectorById(userOrSectorId)
    : (sectorById(userOrSectorId?.sectorId) || sectorFor(userOrSectorId || {}));
  const key = costCategoryFor(sector);
  // Researched for this exact type (utils/savingsByType.json): its own costs, money leaks and savings
  const own = sector && BY_TYPE[sector.id];
  if (own) return { key, label: sector.n, topCosts: own.topCosts, example: own.example, levers: own.levers.map(savingPitch), sources: own.sources || [] };
  const c = CATEGORIES[key];
  return { key, label: c.label, topCosts: c.topCosts, example: c.example, levers: c.levers.map(savingPitch) };
}

module.exports = { costSavingFor, CATEGORIES };
