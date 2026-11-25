// The owner's feasibility report: can this space earn, and from how many commercial revenue streams.
//
// 1. Core streams: the best uses for the type of space (utils/spaces.js). The space is shared equally between the
//    top uses, so the core streams add up to the same "site revenue" as the indicative estimate.
// 2. Add-on streams: income that needs little or no floor area (hoardings, telecom, solar, EV chargers, ATM,
//    shoots), offered where the space, road and size suit them. Shown as a range on top of the core streams.
// 3. AI streams: when ANTHROPIC_API_KEY is set, Claude reads this owner's own details (type, size, location, hours,
//    notes) and suggests further streams for this exact site. Kept on the user as `feasibilityAi`; without a key,
//    or if the call fails, the report is the rule-based one above.
// Every figure is illustrative: a survey sets the real numbers.
const { usesFor } = require('./spaces');

// What each core use needs. Minimum sizes, roads, who funds the build and build-out times are from the RentMySite
// "For landowners" PDF (utils/spaces.js); `investment` is how much capital the build takes, for ordering only.
const NEEDS = {
  courts:    { minSize: 8000,  road: 'main',      fullTime: true,  investment: 'High',   runBy: 'Sports operators (pickleball, padel, cricket nets)' },
  markets:   { minSize: 10000, road: 'main',      fullTime: false, investment: 'Low',    runBy: 'Event organisers and D2C brands on one-week slots' },
  qsr:       { minSize: 8000,  road: 'main',      fullTime: true,  investment: 'High',   runBy: 'QSR, coffee and auto-service brands' },
  kiosks:    { minSize: 4000,  road: 'main',      fullTime: true,  investment: 'Medium', runBy: 'Food, beverage and quick-retail brands' },
  darkstore: { minSize: 4000,  road: 'inner',     fullTime: true,  investment: 'Medium', runBy: 'Quick-commerce and logistics companies' },
  banquet:   { minSize: 20000, road: 'inner',     fullTime: false, investment: 'Medium', runBy: 'Wedding and event planners' },
  carcare:   { minSize: 5000,  road: 'main',      fullTime: true,  investment: 'Medium', runBy: 'Car care and detailing operators' },
  ev:        { minSize: 3000,  road: 'any',       fullTime: false, investment: 'Medium', runBy: 'EV charging and fleet companies' },
  storage:   { minSize: 5000,  road: 'any',       fullTime: true,  investment: 'Low',    runBy: 'Logistics and storage companies' },
  cottages:  { minSize: 43560, road: 'outskirts', fullTime: true,  investment: 'High',   runBy: 'NomadLivings (Govianu group cottage operator)' }
};

// Income that needs little floor area. `fits` says which spaces, roads and sizes can take it.
const ADD_ONS = [
  { key: 'hoarding', name: 'Hoarding or LED screen for brand ads', low: 15000, high: 60000, investment: 'Low', funding: 'The advertiser pays for the structure', time: '1–3 months', runBy: 'Outdoor advertising agencies',
    fits: s => s.road === 'main', note: 'Subject to local advertising rules and permission.' },
  { key: 'telecom', name: 'Telecom tower or small cell', low: 10000, high: 40000, investment: 'Low', funding: 'The tower company builds it', time: '2–4 months', runBy: 'Telecom infrastructure companies',
    fits: s => /land|vacant|terrace|rooftop|society|institutional/.test(s.typeKey), note: 'Needs structural and municipal clearance.' },
  { key: 'solar', name: 'Solar panels leased to a power company', perSqft: [2, 5], minSize: 1000, investment: 'Low', funding: 'The solar company owns the panels', time: '2–3 months', runBy: 'Solar developers',
    fits: s => /terrace|rooftop|shed|factory|godown|warehouse|land|vacant/.test(s.typeKey), note: 'Rent for roof or ground area used, usually on a long lease.' },
  { key: 'evaddon', name: 'Two to four EV charging points', low: 8000, high: 25000, investment: 'Low', funding: 'The charging company installs them', time: '4–8 weeks', runBy: 'EV charging companies',
    fits: s => !/terrace|rooftop/.test(s.typeKey) && !s.uses.includes('ev'), note: 'Needs a power connection we arrange with the charging company.' },
  { key: 'atm', name: 'ATM or vending kiosk', low: 8000, high: 25000, investment: 'Low', funding: 'The bank or vending company installs it', time: '1–2 months', runBy: 'Banks and vending operators',
    fits: s => s.road === 'main' && /shop|showroom|land|vacant|parking|office/.test(s.typeKey) },
  { key: 'shoots', name: 'Film, photo and ad shoots', low: 5000, high: 30000, investment: 'Low', funding: 'Production houses pay per day', time: '2–4 weeks', runBy: 'Production houses and photographers',
    fits: s => /hall|event|terrace|rooftop|house|shed|factory|land|vacant/.test(s.typeKey), note: 'Occasional, so it varies month to month.' }
];

const keyOf = t => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const ROAD_FACTOR = { main: 1, inner: 0.75, outskirts: 0.55 };
const ROAD_NAME = { main: 'On a main road', inner: 'On an inner road', outskirts: 'Outskirts or industrial area' };
// "all the time", "24x7", "always free" mean the whole space is free; anything else written in is part-time
const isFullTime = hours => !hours || /all|24|full|always|any ?time|vacant|empty|unused/i.test(hours);
const RANK = { High: 3, Medium: 2, Low: 1 };

// Rate one core use for this space: High, Medium or Low, with the reasons
function rateUse(key, { size, road, fullTime }) {
  const n = NEEDS[key];
  const reasons = [];
  let score = 3;
  if (size && size < n.minSize) { score -= size < n.minSize / 2 ? 2 : 1; reasons.push(`Works best from about ${n.minSize.toLocaleString('en-IN')} sq ft`); }
  if (n.road === 'main' && road !== 'main') { score -= road === 'outskirts' ? 2 : 1; reasons.push('Needs main-road visibility'); }
  if (n.road === 'inner' && road === 'outskirts') { score -= 1; reasons.push('Needs to be close to customers'); }
  if (n.road === 'outskirts' && road !== 'outskirts') { score -= 1; reasons.push('Suits quiet sites on the outskirts'); }
  if (n.fullTime && !fullTime) { score -= 1; reasons.push('Needs the space all the time, not only some hours'); }
  const feasibility = score >= 3 ? 'High' : score === 2 ? 'Medium' : 'Low';
  if (!reasons.length) reasons.push('Fits the size, road and hours you gave');
  return { feasibility, reasons };
}

// The best uses for this type of space, ordered by how well they fit, top four (stable: equal fits keep the
// order in utils/spaces.js, so a main-road space gets the same four as the homepage estimate)
// A use rated Low is left out when better ones exist, so it never inflates the estimate.
function rankedUses(type, ctx) {
  const top = usesFor(type).map((u, i) => ({ u, i, r: RANK[rateUse(u.key, ctx).feasibility] }))
    .sort((a, b) => b.r - a.r || a.i - b.i).slice(0, 4);
  const fits = top.filter(x => x.r > RANK.Low);
  return (fits.length ? fits : top.slice(0, 2)).map(x => x.u);
}
// "We do" -> "RentMySite funds the build", in the owner's words
const fundedBy = f => ({ 'We do': 'RentMySite funds the build', 'Brand does': 'The brand funds the build', 'Brands do': 'Brands fund their kiosks',
  'Operator does': 'The operator funds the build', 'We do, or you do': 'RentMySite or you fund the build', 'You do, or we do': 'You or RentMySite fund the build' }[f] || f || '');

const round100 = n => Math.round(n / 100) * 100;
// "2–4 weeks" -> 2, "1–2 months" -> 4: the quicker start, in weeks
const weeksOf = t => (parseInt(t) || 99) * (/month/.test(t) ? 4 : 1);

function feasibilityFor(user) {
  const s = user?.space || {};
  const type = s.type || String(user?.category || '').replace(/_/g, ' ');
  const typeKey = keyOf(type);
  const size = Number(s.size) || 0;
  const road = ROAD_FACTOR[s.road] ? s.road : 'main';
  const fullTime = isFullTime(s.hours);
  const ctx = { size, road, fullTime };

  // Core streams: the four uses that fit best share the space equally (the same basis as the indicative estimate)
  const uses = rankedUses(type, ctx);
  const area = size ? Math.round(size / uses.length) : 0;
  const core = uses.map(u => {
    const n = NEEDS[u.key];
    const rating = rateUse(u.key, ctx);
    return {
      key: u.key, kind: 'core', name: u.name, area, needs: u.needs,
      rate: { low: u.low, high: u.high },
      monthly: area ? round100(area * ((u.low + u.high) / 2) * ROAD_FACTOR[road]) : 0,
      investment: n.investment, funding: fundedBy(u.funder), time: u.build, runBy: n.runBy, ...rating
    };
  });

  // Add-on streams that suit this space
  const sCtx = { typeKey, road, uses: uses.map(u => u.key) };
  const addOns = ADD_ONS.filter(a => a.fits(sCtx) && (!a.minSize || size >= a.minSize)).map(a => {
    // Solar is rent per sq ft on about half the area; the rest are flat monthly ranges
    const low = a.perSqft ? round100(size * 0.5 * a.perSqft[0]) : a.low;
    const high = a.perSqft ? round100(size * 0.5 * a.perSqft[1]) : a.high;
    return { key: a.key, kind: 'addon', name: a.name, low, high, investment: a.investment, funding: a.funding, time: a.time, runBy: a.runBy,
      feasibility: road === 'outskirts' && a.key !== 'solar' && a.key !== 'telecom' ? 'Medium' : 'High', reasons: a.note ? [a.note] : [] };
  });

  const coreTotal = core.reduce((t, c) => t + c.monthly, 0);
  const addOnLow = addOns.reduce((t, a) => t + a.low, 0), addOnHigh = addOns.reduce((t, a) => t + a.high, 0);
  const high = core.filter(c => c.feasibility === 'High');
  const medium = core.filter(c => c.feasibility === 'Medium');
  const missing = [!s.type && 'type of space', !size && 'size', !s.location && !user?.business?.address && 'location'].filter(Boolean);

  let verdict;
  if (!size || !s.type) verdict = { level: 'pending', title: 'Add your space details', text: `Tell us the ${missing.join(', ')} of your space for a full feasibility report.` };
  else if (high.length >= 2) verdict = { level: 'high', title: 'Feasible: recommended to start', text: `${high.length} of the ${core.length} best uses fit your space as it is, and ${addOns.length} add-on stream${addOns.length === 1 ? '' : 's'} can earn on top.` };
  else if (high.length || medium.length >= 2) verdict = { level: 'medium', title: 'Feasible with conditions', text: 'Some uses fit now; others need a change in hours, access or layout. The survey will confirm which.' };
  else verdict = { level: 'low', title: 'Limited: a survey will decide', text: 'Few uses fit the details you gave. A site visit often finds options that the details alone do not show.' };

  // Start with the quickest, cheapest streams that fit well
  const pending = verdict.level === 'pending';
  const startWith = pending ? [] : core.concat(addOns).filter(x => x.feasibility === 'High')
    .sort((a, b) => (RANK[a.investment] || 2) - (RANK[b.investment] || 2) || weeksOf(a.time) - weeksOf(b.time)).slice(0, 2).map(x => x.name);

  const indicators = [
    ['Space size', size ? `${size.toLocaleString('en-IN')} sq ft: ${size >= 10000 ? 'large, can hold several streams at once' : size >= 3000 ? 'medium, fits two or three streams' : 'compact, best for one focused use plus add-ons'}` : 'Not given yet'],
    ['Road and visibility', ROAD_NAME[road]],
    ['When it is free', fullTime ? 'All the time: long-term uses are possible' : `${s.hours}: suits events, markets and parking more than fixed builds`],
    ['Uses that fit well', pending ? 'Shown once you add the type and size' : `${high.length} high, ${medium.length} medium, ${core.length - high.length - medium.length} low`],
    ['Revenue streams', `${core.length} core + ${addOns.length} add-on${user?.feasibilityAi?.streams?.length ? ` + ${user.feasibilityAi.streams.length} suggested by AI` : ''}`],
    ['Investment from you', 'Nothing upfront: brands, operators or RentMySite can fund the build-out (see the share tiers)'],
    ['Time to first revenue', startWith.length ? `${core.concat(addOns).find(x => x.name === startWith[0]).time}, starting with ${startWith[0].toLowerCase()}` : 'After the survey']
  ];

  return {
    verdict, indicators, startWith,
    core, addOns,
    ai: user?.feasibilityAi?.streams?.length && user.feasibilityAi.inputs === inputsKey(user) ? user.feasibilityAi : null,
    totals: { core: coreTotal, addOnLow, addOnHigh, low: coreTotal + addOnLow, high: coreTotal + addOnHigh },
    preparedOn: new Date().toISOString()
  };
}

// ---------- AI streams (Claude) ----------
const aiConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY);
// The details the AI read; when the owner changes them, the AI streams are refreshed
const inputsKey = user => { const s = user?.space || {}; return [s.type, s.size, s.road, s.location, s.hours, s.notes].map(x => String(x ?? '')).join('|'); };

const AI_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'streams'],
  properties: {
    summary: { type: 'string' },
    streams: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'why', 'monthlyLow', 'monthlyHigh', 'investment', 'time', 'feasibility', 'runBy'],
        properties: {
          name: { type: 'string' },
          why: { type: 'string' },
          monthlyLow: { type: 'integer' },
          monthlyHigh: { type: 'integer' },
          investment: { type: 'string', enum: ['Low', 'Medium', 'High'] },
          time: { type: 'string' },
          feasibility: { type: 'string', enum: ['High', 'Medium', 'Low'] },
          runBy: { type: 'string' }
        }
      }
    }
  }
};

function aiPrompt(user, report) {
  const s = user.space || {};
  const have = report.core.concat(report.addOns).map(x => `- ${x.name}`).join('\n');
  return `RentMySite.ai is a Bengaluru company. Owners give it a mandate (not a lease) for an idle space; RentMySite plans, builds and runs commercial uses on it with brands and operators, and shares the profit with the owner every month.

Write further commercial revenue streams for this owner's space, beyond the ones the report already has.

The space:
- Type: ${s.type || 'not given'}
- Size: ${s.size ? `${s.size} sq ft` : 'not given'}
- Road: ${ROAD_NAME[s.road] || 'not given'}
- Location: ${s.location || user.business?.address || user.location || 'Bengaluru'}
- When it is free: ${s.hours || 'not given'}
- Owner's notes: ${s.notes || 'none'}

Streams already in the report (do not repeat these):
${have}

Give 3 to 5 streams that suit this exact space and location, ordered from most to least feasible. For each: a short name; one or two plain sentences on why it suits this space; an indicative monthly revenue range in Indian rupees for the site (whole rupees, realistic for Bengaluru); investment needed (Low, Medium or High); time to first revenue (for example "4–8 weeks"); feasibility (High, Medium or Low); and the kind of partner who would run it. Also give a one-sentence summary of the space's earning potential. Use plain words a property owner understands. Do not promise income.`;
}

async function aiStreamsFor(user) {
  if (!aiConfigured()) return null;
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ timeout: 90000, maxRetries: 1 });
  const report = feasibilityFor({ ...user, feasibilityAi: null });
  const res = await client.beta.messages.create({
    model: process.env.FEASIBILITY_MODEL || 'claude-opus-5-5',
    max_tokens: 16000,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: AI_SCHEMA } },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    messages: [{ role: 'user', content: aiPrompt(user, report) }]
  });
  if (res.stop_reason === 'refusal') throw new Error('The request was declined');
  if (res.stop_reason === 'max_tokens') throw new Error('The reply was cut off');
  const raw = JSON.parse(res.content.filter(b => b.type === 'text').map(b => b.text).join(''));
  const clean = (x, max) => String(x || '').replace(/\s+/g, ' ').trim().slice(0, max);
  const streams = (raw.streams || []).map(x => ({
    kind: 'ai', name: clean(x.name, 90), why: clean(x.why, 300),
    low: Math.max(0, Math.round(Number(x.monthlyLow) || 0)), high: Math.max(0, Math.round(Number(x.monthlyHigh) || 0)),
    investment: x.investment, time: clean(x.time, 30), feasibility: x.feasibility, runBy: clean(x.runBy, 90)
  })).filter(x => x.name && x.high >= x.low).slice(0, 5);
  if (!streams.length) throw new Error('No streams in the reply');
  return { summary: clean(raw.summary, 400), streams, inputs: inputsKey(user), at: new Date().toISOString() };
}

// Refresh the AI streams for a user and save them. Never throws: without them the report is the rule-based one.
async function refreshAi(user) {
  if (!aiConfigured() || !user?.space?.type || !user.space.size) return null;
  try {
    const ai = await aiStreamsFor(user);
    if (ai) { user.feasibilityAi = ai; await user.save(); }
    console.log(`[feasibility] AI streams for ${user.business?.businessName || user.name}: ${ai?.streams.length || 0}`);
    return ai;
  } catch (err) {
    console.error(`[feasibility] AI streams failed for ${user.business?.businessName || user.name}:`, err.message);
    return null;
  }
}

// Should the dashboard ask for new AI streams? Only when the details changed, and at most every 10 minutes
function aiDue(user) {
  if (!aiConfigured() || !user?.space?.type || !user.space.size) return false;
  if (user.feasibilityAi?.inputs === inputsKey(user)) return false;
  return Date.now() - new Date(user.feasibilityAiTriedAt || 0).getTime() > 10 * 60 * 1000;
}

module.exports = { feasibilityFor, rankedUses, refreshAi, aiDue, aiConfigured, inputsKey, isFullTime, rateUse, NEEDS, ADD_ONS };
