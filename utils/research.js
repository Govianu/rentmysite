// Looks up one specific business on the web (e.g. "Mint Masala, Malleshwaram, cafe") and writes its own
// five ways to earn and five ways to save: what it sells, when it is busy, when it is quiet, and what fits.
// Runs once per sign-up when ANTHROPIC_API_KEY is set; without it (or if the lookup fails) everyone gets the
// general plan for their type of business, as before. The result is kept on the user as `research`.
const Anthropic = require('@anthropic-ai/sdk');
const { savingPitch } = require('./pitch');

const BUSINESS_KEYS = {
  space: 'Rent out your space when it is empty',
  ads: 'Let brands advertise in your place',
  sell: 'Sell more to the customers you already have',
  companies: 'Get big orders from companies',
  referrals: 'Earn from sending customers to partners'
};
const PRO_KEYS = {
  work: 'Take paid work in your spare hours',
  teach: 'Teach what you know',
  products: 'Sell something ready-made',
  contracts: 'Get monthly contracts from companies',
  referrals: 'Earn from referrals'
};

const researchConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY);

function promptFor({ name, kind, area, isPro }) {
  const keys = isPro ? PRO_KEYS : BUSINESS_KEYS;
  return `RentMySite.ai (RentMySite) is a Bengaluru company. RentMySite finds partners, customers and brands for local businesses and professionals, agrees the deal and handles payments, so they earn more and spend less.

Look up this ${isPro ? 'professional' : 'business'} on the web (Google Maps, Zomato, Swiggy, Justdial, Instagram, its website, reviews):
Name: ${name}
Type: ${kind}
Area: ${area}, Bengaluru

Find out what they sell or do, who their customers are, their price range, when they are busy and when they are quiet. If you cannot find this exact ${isPro ? 'person' : 'business'}, use what is typical for a ${kind} in ${area} and set "found" to false.

Then write their plan. The five ways to earn are fixed; write one line and two short examples for each that fit THIS ${isPro ? 'person' : 'business'} (their menu, products, space, hours, area and customers):
${Object.entries(keys).map(([k, t]) => `- ${k}: ${t}`).join('\n')}

Also find their 5 biggest costs (where their money goes each month) and write one way to save on each: the cost, a realistic saving range, and one line on how RentMySite cuts it (RentMySite brings the supplier, partner or group deal; never a do-it-yourself step).

Writing rules:
- Very simple English anyone can read. Short sentences. No business words.
- Never tell them how to do it themselves. Say what can happen and what it can earn or save; RentMySite does the work.
- Do not write "RentMySite" or "with RentMySite" in the lines.
- Rupee amounts as ₹ with Indian grouping (₹25,000).

Reply with ONLY one JSON object, no other text:
{
  "found": true,
  "about": "One or two sentences on what they do and who comes to them.",
  "busyHours": "When they are busy, e.g. weekday mornings 8–11 AM and weekend evenings",
  "quietHours": "When they are quiet, e.g. weekday afternoons 3–6 PM",
  "ways": { ${Object.keys(keys).map(k => `"${k}": { "line": "...", "examples": ["...", "..."], "estMonthly": 20000 }`).join(', ')} },
  "savings": [ { "cost": "Milk", "title": "Buy milk straight from a dairy", "saving": "10–15% on milk", "we": "We connect you to a dairy farm near Bengaluru, so you skip the middleman." } ]
}`;
}

// The last {...} in the reply is the answer (search results may come first)
function parseJson(text) {
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('No JSON in reply');
  return JSON.parse(text.slice(start, end + 1));
}

const clean = (s, max = 300) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);

function normalise(raw, isPro) {
  const keys = isPro ? PRO_KEYS : BUSINESS_KEYS;
  const ways = Object.entries(keys).map(([key, title]) => {
    const w = raw.ways?.[key] || {};
    return {
      key, title,
      line: clean(w.line),
      examples: (Array.isArray(w.examples) ? w.examples : []).map(e => clean(e, 120)).filter(Boolean).slice(0, 2),
      estMonthly: Math.max(0, Math.round(Number(w.estMonthly) || 0))
    };
  });
  const savings = (Array.isArray(raw.savings) ? raw.savings : [])
    .map(s => ({ title: clean(s.title, 90), saving: clean(s.saving, 90), cost: clean(s.cost, 40), we: clean(s.we, 200) }))
    .map(s => savingPitch(s))
    .filter(s => s.title && s.saving).slice(0, 5);
  if (ways.filter(w => w.line).length < 4 || savings.length < 3) throw new Error('Reply was missing ways or savings');
  return {
    found: raw.found !== false,
    about: clean(raw.about, 400), busyHours: clean(raw.busyHours, 160), quietHours: clean(raw.quietHours, 160),
    ways, savings
  };
}

async function researchBusiness({ name, kind, area, isPro = false }) {
  if (!researchConfigured()) return null;
  const client = new Anthropic({ timeout: 120000, maxRetries: 1 });
  const messages = [{ role: 'user', content: promptFor({ name, kind: kind || (isPro ? 'professional' : 'business'), area: area || 'Bengaluru', isPro }) }];
  // Web search can pause a long turn; send it back to let it carry on (at most a few times)
  for (let round = 0; round < 3; round++) {
    const res = await client.beta.messages.create({
      model: process.env.RESEARCH_MODEL || 'claude-opus-5-5',
      max_tokens: 16000,
      output_config: { effort: 'medium' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5,
        user_location: { type: 'approximate', city: 'Bengaluru', region: 'Karnataka', country: 'IN', timezone: 'Asia/Kolkata' } }],
      messages
    });
    if (res.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: res.content }); continue; }
    if (res.stop_reason === 'refusal') throw new Error('The lookup was declined');
    const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('');
    return { ...normalise(parseJson(text), isPro), at: new Date().toISOString() };
  }
  throw new Error('The lookup took too long');
}

// Research a user's own business and keep it on the user. Never throws: a failed lookup just means the
// general plan is used.
async function researchUser(user) {
  if (!researchConfigured() || !user || !['business', 'associate'].includes(user.role)) return null;
  const isPro = user.role === 'associate';
  try {
    const research = await researchBusiness({
      name: isPro ? user.name : (user.business?.businessName || user.name),
      kind: String(isPro ? (user.associate?.skills?.join(', ') || user.category) : user.category || '').replace(/_/g, ' '),
      area: user.location, isPro
    });
    if (research) { user.research = research; await user.save(); }
    console.log(`[research] ${user.business?.businessName || user.name}: ${research?.found ? 'found' : 'not found, typical plan'}`);
    return research;
  } catch (err) {
    console.error(`[research] lookup failed for ${user.business?.businessName || user.name}:`, err.message);
    return null;
  }
}

// Wait for the research, but never longer than `ms`; the lookup carries on (and saves) after that
function within(promise, ms) {
  return Promise.race([promise, new Promise(r => setTimeout(() => r(null), ms).unref?.())]);
}

module.exports = { researchBusiness, researchUser, researchConfigured, within, normalise, parseJson };
