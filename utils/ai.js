// Generates "ways to earn more" pitch cards for a business.
// Uses the Anthropic API when ANTHROPIC_API_KEY is set; otherwise falls back to templates.

const TEMPLATES = {
  restaurant: [
    { title: 'Rent your idle kitchen as a cloud kitchen', idleAsset: 'Kitchen, 3pm–6pm and after 11pm', estMonthly: 45000,
      pitch: 'Delivery brands need a licensed kitchen for a few hours a day. Your kitchen already has the equipment and FSSAI licence — earn rent without changing your menu.' },
    { title: 'Host kids’ birthday parties on slow mornings', idleAsset: 'Dining hall, Mon–Thu 10am–1pm', estMonthly: 60000,
      pitch: '15-kid birthday packages with a fixed menu fill your quietest hours. Event managers bring the guests; you provide the space and food.' },
    { title: 'Let a chef run a paid cooking workshop', idleAsset: 'Kitchen, one weekend morning a month', estMonthly: 50000,
      pitch: 'A partner chef teaches a signature recipe to paying students in your kitchen. You earn a venue share and new regulars.' }
  ],
  cafe: [
    { title: 'Coffee tastings during quiet hours', idleAsset: 'Cafe tables, weekday afternoons', estMonthly: 22000,
      pitch: 'Host small tasting sessions featuring your beans and signature drinks. Sell reserved seats and introduce visitors to your menu.' },
    { title: 'Local pop-ups and community meetups', idleAsset: 'Cafe floor, weekday evenings', estMonthly: 28000,
      pitch: 'Give local makers and community groups a place to meet. Set a minimum spend or a simple venue fee.' },
    { title: 'Breakfast and meeting bundles', idleAsset: 'Tables, weekday mornings', estMonthly: 35000,
      pitch: 'Offer nearby teams a bookable breakfast meeting package with coffee, food and reliable seating.' }
  ],
  hotel: [
    { title: 'Day-use rooms for business travellers', idleAsset: 'Unsold rooms, 10am–5pm', estMonthly: 80000,
      pitch: 'Rooms that sit empty between checkout and check-in can be sold by the hour to travellers and freelancers.' },
    { title: 'Small corporate offsites in your banquet hall', idleAsset: 'Banquet hall, weekdays', estMonthly: 120000,
      pitch: 'Startups need 20–40 person spaces for a day. Bundle the hall, Wi-Fi and lunch into one price.' },
    { title: 'Weekend workshops and classes', idleAsset: 'Conference room, weekends', estMonthly: 40000,
      pitch: 'Yoga, art and cooking instructors pay for a clean, central room. You earn without adding staff.' }
  ],
  salon: [
    { title: 'Bridal and event packages with partner artists', idleAsset: 'Chairs, weekday mornings', estMonthly: 35000,
      pitch: 'Freelance makeup artists use your chairs for bridal trials and pay per slot.' },
    { title: 'Grooming workshops for beginners', idleAsset: 'Salon floor, Sunday afternoons', estMonthly: 25000,
      pitch: 'Host paid beginner classes taught by your senior stylists on your slowest day.' },
    { title: 'Corporate wellness days', idleAsset: 'Staff time, weekdays', estMonthly: 40000,
      pitch: 'Send stylists to nearby offices for on-site grooming days booked through RentMySite.' }
  ],
  gym: [
    { title: 'Small-group off-peak classes', idleAsset: 'Studio floor, weekday afternoons', estMonthly: 30000,
      pitch: 'Offer beginner-friendly strength, mobility or dance sessions when the studio is quieter. Cap seats and promote a clear class schedule.' },
    { title: 'Weekend wellness workshops', idleAsset: 'Training space, weekend afternoons', estMonthly: 25000,
      pitch: 'Partner with qualified trainers to host paid workshops. Your studio earns from space and can meet future members.' },
    { title: 'Corporate fitness sessions', idleAsset: 'Trainer availability, weekdays', estMonthly: 40000,
      pitch: 'Nearby teams can book a guided group session at your studio or their office. Offer a simple per-session package.' }
  ],
  banquet_hall: [
    { title: 'Weekday meetings and training days', idleAsset: 'Banquet hall, weekdays', estMonthly: 65000,
      pitch: 'Businesses need reliable spaces for training and team events. Package the room, seating, AV and refreshments.' },
    { title: 'Small celebrations in flexible layouts', idleAsset: 'Available hall dates', estMonthly: 55000,
      pitch: 'Show smaller event packages for birthdays, engagement gatherings and family functions. Clear guest limits and inclusions help customers decide.' },
    { title: 'Photo and video shoot bookings', idleAsset: 'Decorated event spaces, non-event days', estMonthly: 35000,
      pitch: 'Photographers and local brands can book attractive spaces for short shoots. Set hours, access rules and a venue fee.' }
  ],
  office: [
    { title: 'Bookable meeting rooms', idleAsset: 'Meeting rooms, unscheduled hours', estMonthly: 40000,
      pitch: 'Nearby teams need private rooms for interviews and client meetings. Publish room capacity, AV and hourly availability.' },
    { title: 'Day desks for visiting teams', idleAsset: 'Unused desks, selected weekdays', estMonthly: 35000,
      pitch: 'Offer a limited number of desks to visiting professionals. Include Wi-Fi, access hours and a clear day rate.' },
    { title: 'Training and workshop space', idleAsset: 'Conference room, evenings or weekends', estMonthly: 30000,
      pitch: 'Trainers and community groups can book your conference room for short sessions. Keep a simple rate card and access checklist.' }
  ],
  default: [
    { title: 'Rent out idle space by the hour', idleAsset: 'Unused space during slow hours', estMonthly: 30000,
      pitch: 'Event managers and instructors are looking for small, central spaces. List your slow hours and accept bookings with one tap.' },
    { title: 'Host community workshops', idleAsset: 'Space, weekends', estMonthly: 25000,
      pitch: 'Partner associates run paid workshops at your venue; you earn a share of every seat sold.' },
    { title: 'Cut supply costs by buying direct', idleAsset: 'Monthly purchasing', estMonthly: 20000,
      pitch: 'Group purchasing with nearby businesses lets you buy directly from producers and skip distributor margins.' }
  ]
};

function scriptFor(name, o) {
  return `[0–5s] ${name}, your ${o.idleAsset.split(',')[0].toLowerCase()} sits idle more than you think.\n` +
    `[5–20s] ${o.pitch}\n` +
    `[20–30s] That’s up to ₹${o.estMonthly.toLocaleString('en-IN')} extra a month. Tap Accept on rentmysite.ai to start.`;
}

// For the 100 homepage types without a hand-written template, build ideas from the type's own
// services, products, partners and idle assets (utils/catalog.json)
function fromCatalog({ name, category, sectorId }) {
  const { sectorFor, partnersOf, plural } = require('./catalog');
  const sector = sectorFor({ category, sectorId });
  if (!sector || sector.t !== 'b') return null;
  const lower = x => (/^[A-Z]{2}/.test(x) ? x : x.charAt(0).toLowerCase() + x.slice(1));
  const round = n => Math.max(5000, Math.round(n / 1000) * 1000);
  const partners = partnersOf(sector, 2);
  const f = sector.f || [30000, 60000, 25000, 15000];
  const who = name || `your ${sector.noun}`;
  return [
    { title: `Offer ${lower(sector.s[0])}`, idleAsset: sector.a, estMonthly: round(f[1] / 3),
      pitch: `${plural(sector.noun).replace(/^./, c => c.toUpperCase())} like ${who} earn from ${lower(sector.s[0])}. Start with one pilot, priced and agreed with your RentMySite manager.` },
    { title: `Sell ${lower(sector.p[0])}`, idleAsset: 'Customers who already visit you', estMonthly: round(f[0] / 3),
      pitch: `Put ${lower(sector.p[0])} in front of the customers you already have. A partner supplies the stock; margins are agreed upfront.` },
    { title: `Team up with ${partners[0]}`, idleAsset: sector.a, estMonthly: round(f[2] / 2),
      pitch: `${sector.e} Your RentMySite manager introduces you to ${partners.join(' and ')}.` }
  ];
}

function fromTemplates({ name, category, sectorId }) {
  const list = TEMPLATES[category] || fromCatalog({ name, category, sectorId }) || TEMPLATES.default;
  return list.map(o => ({ ...o, videoScript: scriptFor(name, o), source: 'template' }));
}

async function generateOpportunities({ name, category, location, sectorId }) {
  if (!process.env.ANTHROPIC_API_KEY) return fromTemplates({ name, category, sectorId });

  const prompt = `You write opportunity pitch cards for rentmysite.ai, a Bengaluru platform that helps local businesses earn from idle space and time.
Business: "${name}", category: ${category}, area: ${location}, Bengaluru.
Return ONLY a JSON array of 3 objects, no markdown, each with:
"title" (max 60 chars), "idleAsset" (what is idle and when), "pitch" (2 sentences, plain language),
"estMonthly" (realistic extra INR per month as an integer), "videoScript" (a 30-second voiceover script with [0–5s] style timestamps).`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!res.ok) throw new Error(`Anthropic API ${res.status}`);
    const data = await res.json();
    const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    if (!Array.isArray(parsed) || !parsed.length) throw new Error('Empty AI response');
    return parsed.slice(0, 5).map(o => ({
      title: String(o.title || 'New opportunity'),
      idleAsset: String(o.idleAsset || ''),
      pitch: String(o.pitch || ''),
      estMonthly: Number(o.estMonthly) || 0,
      videoScript: String(o.videoScript || ''),
      source: 'ai'
    }));
  } catch (err) {
    console.warn('AI generation failed, using templates:', err.message);
    return fromTemplates({ name, category, sectorId });
  }
}

const SOPS = {
  restaurant: ['Kitchen hand-over checklist', 'Hygiene & FSSAI compliance for guest chefs', 'Birthday party run sheet (15 kids)', 'Damage & deposit policy'],
  cafe: ['Cafe opening and closing checklist', 'Food safety and allergen information', 'Coffee tasting session run sheet', 'Booking and minimum-spend policy'],
  hotel: ['Day-use room turnover SOP', 'Banquet booking checklist', 'Guest ID & safety policy'],
  salon: ['Chair rental agreement', 'Hygiene SOP for visiting artists', 'Workshop run sheet'],
  gym: ['Class capacity and equipment checklist', 'Trainer credential verification', 'Participant safety and waiver process'],
  banquet_hall: ['Event layout and capacity checklist', 'AV and catering hand-over', 'Damage, deposit and cancellation policy'],
  office: ['Visitor access and security checklist', 'Meeting room equipment hand-over', 'Workspace booking and cancellation policy'],
  default: ['Venue hand-over checklist', 'Booking & cancellation policy', 'Safety & insurance checklist']
};
const sopsFor = category => SOPS[category] || SOPS.default;

module.exports = { generateOpportunities, sopsFor };
