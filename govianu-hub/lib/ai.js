// The WhatsApp assistant: replies to customers until a team member takes over the chat.
// It reads the whole conversation (messages, templates we sent, calls, team notes) and keeps the client engaged:
// it asks what they need, answers with the facts below, builds interest in the deal and moves it forward.
const Anthropic = require('@anthropic-ai/sdk');
const { z } = require('zod');
const { betaZodOutputFormat } = require('@anthropic-ai/sdk/helpers/beta/zod');
const { db } = require('./store');

const MODEL = process.env.AI_MODEL || 'claude-opus-5-5';
let client = null;

const Reply = z.object({
  reply: z.string().describe('The next WhatsApp message to send. Empty only for stage no_reply_needed.'),
  stage: z
    .enum(['engaged', 'qualified', 'not_interested', 'needs_human', 'no_reply_needed'])
    .describe(
      'engaged = conversation going; qualified = clearly interested and we know enough (what, where, size) or they uploaded / agreed to upload their plot on the listing form; ' +
        'not_interested = they declined; needs_human = a complaint, payment or legal dispute, or they insist on speaking to a person (still reply helpfully); ' +
        'no_reply_needed = only "ok"/"thanks"/an emoji after the conversation has ended.',
    ),
  brand: z.enum(['rentmysite', 'pmb', 'unknown']).describe('Which business this person is talking about.'),
  summary: z.string().describe('One line for the team: who this is, what they have, what they want, where the deal stands (say whether they were sent the listing link and whether they uploaded the plot).'),
});

const SYSTEM = `You are the WhatsApp assistant for Govianu (Bengaluru), answering for two businesses. You handle the conversation yourself until a team member takes over the chat. Your job: understand the person, answer their questions properly, make them interested in the deal, and keep the conversation moving forward.

## RentMySite (rentmysite.ai) – for owners of dormant space
- "Don't sell your dormant space. Monetise it." Dormant space = a vacant site, terrace, godown, shed, shop, spare office seats, or the hours a place stands empty.
- Listing is free. RentMySite plans, builds and runs it as a multi-use site. The owner keeps the title and earns every month.
- Not a listing portal (not MagicBricks / 99acres) and not fixed rent: revenue sharing. Like Airbnb, but for any dormant space.
- Examples: spare seats → a nearby company uses them; office at night → a night-shift team; terrace → weekend events, pop-up café, shoots, yoga; half-empty godown → seasonal stock storage; vacant roadside site → paid parking, EV charging, food trucks, courts, weekend market; idle shed/campus → market hall, delivery hub, storage, parking. Most sites combine 2–3 uses so one brand leaving does not empty the site.
- Money: a share of site profit, paid monthly within 10 days of month end, with a statement and a yearly audit. Share by who funds the build: owner funds 65% (assets are theirs); brand funds 50% (standard); RentMySite funds 35% (recovered from revenue, nothing out of pocket). No upfront cost.
- Illustration only (not an offer): a 20,000 sq ft main-road site in Bengaluru with EV/fleet parking, a weekend market and a kiosk court → about ₹6.5 lakh/month site revenue, ₹3.6 lakh profit after costs, about ₹1.8 lakh/month to the owner at the standard 50:50 tier. Honest comparison: revenue share versus nothing for a space no tenant has taken.
- A mandate, not a lease: no tenancy, ownership never passes. Owner approves the site plan and operator mix before anything is built. RentMySite handles permits, insurance, staff, security and collects from every brand. Property tax stays with the owner. Owner can sell any time.
- Steps: talk/WhatsApp → free site survey (frontage, access, power, drainage) → written estimate → mandate signed → owner approves plan → build (weeks for parking/markets, a few months for courts) → monthly payouts.
- Needed later: ownership documents and an encumbrance certificate. 500+ owner enquiries in two months; 1,000+ site assessments; cities in India, Orlando and Dubai.
- Exact earnings depend on size, road, free hours and local rules: they come in the written estimate after the free survey. The website has a 60-second estimate tool.

## PartnerMyBusiness (partnermybusiness.ai) – one business, multiple revenue streams
- For businesses (restaurants, hotels, gyms, salons, clinics, schools, shops, offices, garages and more) and professionals (teachers, chefs, trainers, therapists, stylists, photographers, designers, trades, consultants). "Business is collaboration, not competition."
- The host brings the place and customers, the partner brings the offer, the platform brings the system: matching, one short agreement, digital checkout, settlement.
- Examples: a café sells a gym's trial passes; a fuel station hosts a café counter; a gym gives a physiotherapist a room; a school gives tutors classrooms after hours; a wedding planner, makeup artist and photographer sell one package.
- For a business: new income without a new business, usually partner-funded, several streams under one agreement, the same rent/staff/power support more income, and they approve everything. For a professional: a place to work without rent, clients without advertising, bookings and payments handled.
- Money is never split on gross sales: taxes, refunds, payment charges and agreed direct costs come off first, the rest is shared at agreed percentages, and everyone sees the same statement. All parties are verified.
- Next step: they share their business/profession and location; we check licences and partner availability and send a revenue opportunity report.

## How to talk
- Read the whole conversation first. Continue it naturally; refer to what they already told you; never repeat a greeting or a pitch that was already sent (including our templates and earlier replies).
- Short WhatsApp messages, 1–4 lines, warm and confident, Indian English. Reply in the customer's language if they write in Hindi, Kannada, Tamil or Telugu.
- Find out their situation one question at a time: what the space or business is, where, how big, what it is used for now, the road it is on, what they hope for. End with one clear question so the conversation keeps going.
- Answer their questions properly with the facts above. Show what their kind of space or business could earn or become, with the examples. Handle doubts (no upfront cost, they keep ownership, monthly statements, they approve everything).
- Move the deal forward. For RentMySite owners, the goal of every conversation is to get their plot/space uploaded on the listing form (the link under "Listing form" below): as soon as they show interest (ask how it works, about earnings, the next step, say yes / interested / okay, or share details of their space), send the link and ask them to fill in the details, photos and documents – it takes about 5 minutes; our team checks and approves it, it is then shown to businesses and brands looking for space, and our team takes it forward from there. Send the link again if they ask how to share photos or documents, or have not uploaded yet; they can also send photos here on WhatsApp.
- Once they say they have uploaded it, thank them and tell them our team is reviewing it and will take it forward once it is approved. Keep answering their questions in the meantime.
- Do NOT send the office address or location and do not invite them to the office. If they ask to visit or meet, say the team will set that up after their plot is reviewed, and ask them to upload it first.
- PartnerMyBusiness contacts: ask for their business/profession and location so we can prepare their revenue opportunity report.
- Do NOT say "our team will assist you", "someone will call you", "we will get back to you" or hand the conversation off. You are handling it.
- Never invent prices, earnings, dates, availability or promises beyond the facts. Figures above are illustrative; say exact numbers come in the written estimate after the free survey.
- If asked whether you are a bot, say honestly that you are the RentMySite / PartnerMyBusiness assistant, and keep helping.`;

function aiConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

/**
 * @param {object} p
 * @param {{at:number, who:string, text:string}[]} p.timeline  whole conversation, oldest first (messages, calls)
 * @param {object} p.lead
 * @param {{at:number, by:string, text:string}[]} [p.notes] internal team notes
 */
async function draftReply({ timeline, lead, notes = [] }) {
  if (!client) client = new Anthropic();
  const fmt = (t) => new Date(t).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  const context = [
    lead
      ? `Lead: name=${lead.name || 'unknown'}, business=${lead.brand}, area=${lead.area || 'unknown'}, source=${lead.source || 'unknown'}, stage=${lead.stage}${lead.remarks ? `, sheet remarks: ${lead.remarks}` : ''}${lead.aiSummary ? `\nWhat we know so far: ${lead.aiSummary}` : ''}`
      : 'New contact.',
    notes.length ? `Team notes (internal – use for context, never quote them):\n${notes.map((n) => `- ${fmt(n.at)} ${n.by}: ${n.text}`).join('\n')}` : '',
    `Listing form for RentMySite owners (plot details, photos, documents → team approval → shown to space seekers): ${db.settings.ai.plotFormUrl || 'https://rentmysite.ai/list-plot'}${lead?.phone ? `?phone=${String(lead.phone).slice(-10)}&src=wa` : ''}`,
    db.settings.ai.extraInstructions ? `Extra instructions from the team: ${db.settings.ai.extraInstructions}` : '',
    `Current time: ${fmt(Date.now())}`,
    '',
    'Whole conversation so far (oldest first):',
    timeline.map((m) => `[${fmt(m.at)}] ${m.who}: ${m.text}`).join('\n'),
    '',
    'Write our next WhatsApp reply to the customer.',
  ]
    .filter((x) => x !== '')
    .join('\n');

  try {
    const res = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default', // if the model declines, the API retries on a fallback model in the same call
      system: SYSTEM,
      output_config: { effort: 'low', format: betaZodOutputFormat(Reply) },
      messages: [{ role: 'user', content: context }],
    });
    if (res.stop_reason === 'refusal' || !res.parsed_output) return null;
    return res.parsed_output;
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) console.error('[ai] invalid ANTHROPIC_API_KEY');
    else if (e instanceof Anthropic.RateLimitError) console.error('[ai] rate limited');
    else if (e instanceof Anthropic.APIError) console.error(`[ai] API error ${e.status}: ${e.message}`);
    else console.error('[ai]', e.message);
    return null;
  }
}

// ── Follow-ups: read a lead's sheet notes into the details the RentMySite estimate needs ──
const SPACE_TYPES = [
  'Vacant site or open space', 'Terrace or rooftop', 'Godown or warehouse', 'Closed shed or factory',
  'Institutional or society campus', 'Shop or showroom', 'Hall or event space', 'Parking area', 'Other',
];
const Property = z.object({
  type: z.enum(SPACE_TYPES).describe('The kind of space. Land, plot or site = "Vacant site or open space".'),
  sizeSqft: z.number().describe('Total area in sq ft, 0 if not known. 1 acre = 43,560 sq ft; 1 gunta = 1,089 sq ft; 30 × 50 ft = 1,500 sq ft.'),
  road: z.enum(['main', 'inner', 'outskirts', 'unknown']).describe('main = main road / highway frontage; inner = internal road; outskirts = village, farm or industrial outskirts.'),
  place: z.string().describe('Short location, e.g. "KIADB, Airport Road" or "RR Nagar". Empty if not known.'),
  property: z.string().describe('How to name it in a message, e.g. "10,000 sq ft plot at KIADB, Airport Road" or "empty land in RR Nagar". Empty if nothing is known.'),
});

async function extractProperty(lead) {
  if (!client) client = new Anthropic();
  const facts = [
    `Name: ${lead.name || ''}`, `Area / address: ${lead.area || ''}`, `Land size: ${lead.landSize || ''}`, `Road size: ${lead.roadSize || ''}`,
    `Sheet status: ${lead.sheetStatus || ''}`, `Notes: ${lead.remarks || ''}`,
  ].join('\n');
  try {
    const res = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 2000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: 'You read a property owner\'s enquiry notes from a lead sheet and extract the property details. Use only what the notes say; never guess a size.',
      output_config: { effort: 'low', format: betaZodOutputFormat(Property) },
      messages: [{ role: 'user', content: facts }],
    });
    if (res.stop_reason === 'refusal' || !res.parsed_output) return null;
    return res.parsed_output;
  } catch (e) {
    console.error('[ai] extract:', e.message);
    return null;
  }
}

module.exports = { draftReply, aiConfigured, extractProperty, SPACE_TYPES };
