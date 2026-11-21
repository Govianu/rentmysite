// How we talk to leads about earning and saving: five different ways to earn (not five versions of renting out
// the same hours) and five ways to save, in plain English anyone can follow. No do-it-yourself steps: the
// partner, the split and the numbers come on the RentMySite manager call.

const PITCH = {
  hook: 'Having the idea is easy. Making it work is hard: you need a partner you can trust, a fair deal, customers and payments on time. We do all of that for you.',
  deal: 'You just say yes. We do the rest.',
  call: 'On a short call, your RentMySite manager shows you who you will work with, how the money is shared and what you can expect in the first month.'
};

const lc = s => (/^[A-Z]{2}/.test(s) ? s : String(s || '').charAt(0).toLowerCase() + String(s || '').slice(1));

// Five different ways to earn. `match` picks this business's own examples from the team's research.
const BUSINESS_WAYS = [
  { key: 'space', title: 'Rent out your space when it is empty',
    line: 'Let other people use your place in the hours you are not busy, and get paid for it.',
    match: /hour|seat|cowork|event|night|workshop|kitchen|room|desk|party|birthday|class|session|exhibition|rent|lunch|meeting|venue|shoot|collection/i,
    fallback: ['workshops and classes', 'small events and meetings'] },
  { key: 'ads', title: 'Let brands advertise in your place',
    line: 'Brands pay to show their name on your walls, counters, screens and bills, or to give free samples to your customers.',
    match: /sampling|display|advert|sponsor|screen|hoarding|co-brand/i,
    fallback: ['posters and screens for local brands', 'free sample counters'] },
  { key: 'sell', title: 'Sell more to the customers you already have',
    line: 'Add products or services your customers already want. You earn on every sale, without finding new customers.',
    match: /packaged|product|kit|mix|sauce|masala|retail|accessor|warrant|membership|package|subscription|pharmacy|counter|device|merch|plan|offer|repair|installation|trade-in|add-on/i,
    fallback: ['packaged products', 'memberships and add-ons'] },
  { key: 'companies', title: 'Get big orders from companies',
    line: 'Offices, colleges and large buyers order in bulk every month. One deal can bring steady money.',
    match: /corporate|bulk|office|college|b2b|tie-up|contract/i,
    fallback: ['monthly orders from offices', 'bulk orders for company events'] },
  { key: 'referrals', title: 'Earn from sending customers to partners',
    line: 'Your customers need other things too. Send them to a trusted business nearby and earn a share of every sale. They send their customers to you.',
    match: null,
    fallback: ['a share from partner businesses nearby', 'new customers sent to you by partners'] }
];

const PRO_WAYS = [
  { key: 'work', title: 'Take paid work in your spare hours',
    line: 'Businesses need your skills for short jobs. Fill your free hours with paid work.',
    match: /custom|service|consult|repair|design|shoot|session|audit|development|automation|home/i,
    fallback: ['short paid jobs for local businesses'] },
  { key: 'teach', title: 'Teach what you know',
    line: 'Run classes, workshops or courses. People pay to learn from someone who does the work every day.',
    match: /course|bootcamp|workshop|class|training|coaching|teach|tutor/i,
    fallback: ['weekend workshops', 'short online courses'] },
  { key: 'products', title: 'Sell something ready-made',
    line: 'Turn what you know into a product people can buy again and again, like templates, kits or tools.',
    match: /template|app|plugin|tool|saas|kit|product|ebook|guide|pack/i,
    fallback: ['templates and ready-made kits'] },
  { key: 'contracts', title: 'Get monthly contracts from companies',
    line: 'Companies pay a fixed amount every month to keep you on call. Steady money you can plan with.',
    match: /retainer|maintenance|corporate|monthly|subscription|contract|small businesses/i,
    fallback: ['monthly support for small businesses'] },
  { key: 'referrals', title: 'Earn from referrals',
    line: 'When your clients need someone else, send them to a trusted partner and earn a share. Partners send work to you too.',
    match: null,
    fallback: ['a share from partner referrals'] }
];

// Each research idea goes to the first way it fits, so the five ways show different ideas
function waysToEarn(pb) {
  if (!pb) return [];
  const isPro = pb.sector?.t === 'p';
  const ways = isPro ? PRO_WAYS : BUSINESS_WAYS;
  const ideas = pb.opportunities.concat(pb.moreOpportunities || []);
  const used = new Set();
  const examples = ways.map(() => []);
  // Specific ways first, so each idea lands where it fits best and the five ways show different ideas
  const order = isPro ? [1, 2, 3, 0] : [1, 3, 0, 2];
  for (const i of order) {
    for (const idea of ideas) {
      if (used.has(idea) || examples[i].length >= 2) continue;
      if (ways[i].match && ways[i].match.test(idea)) { examples[i].push(lc(idea)); used.add(idea); }
    }
  }
  return ways.map((w, i) => ({
    key: w.key, title: w.title,
    line: w.line,
    examples: w.match ? (examples[i].length ? examples[i] : w.fallback) : []
  }));
}

// Plain-English names for the few saving ideas that use business words
const PLAIN = {
  'Cut waste with demand forecasting': 'Waste less by planning from past sales',
  'Smart metering': 'Meters that show where power is wasted',
  'Pooled facility contracts': 'Share cleaning and repair contracts with others',
  'Pooled equipment maintenance': 'Share machine repair costs with others',
  'Pooled maintenance': 'Share repair costs with others',
  'Pooled waste and maintenance contracts': 'Share waste and repair contracts with others',
  'Clustered bookings': 'Group bookings close together to save travel',
  'Brand-sponsored upgrades': 'Let brands pay for your upgrades',
  'Shared transport and return loads': 'Share trucks, and carry loads on the way back',
  'Rent out idle capacity': 'Rent out machines and space you are not using',
  'Group insurance and software': 'Buy insurance and software together at lower prices',
  'Shared software and insurance': 'Buy insurance and software together at lower prices',
  'Group-bought lubricants and consumables': 'Buy oils and supplies together at lower prices',
  'One marketing platform': 'One place to market yourself, at one low cost'
};

// How RentMySite cuts each cost, said as what we do (never do-it-yourself steps). First match wins.
const HOW_WE_CUT = [
  [/waste|forecast|planning/i, 'We give you a simple daily plan from your past sales, so less is thrown away.'],
  [/direct bookings|marketing platform/i, 'Customers come to you through RentMySite, so you pay less to booking sites and ads.'],
  [/brand|sponsor|shelf|wall space|rent out|idle/i, 'We bring brands and partners who pay to use what you have, which covers part of your costs.'],
  [/clustered/i, 'We group your bookings close together, so you spend less time and money on travel.'],
  [/solar|power|energy|cooling|lighting|meter/i, 'We bring a trusted solar and power partner who sets it all up for you.'],
  [/water/i, 'We bring a partner who sets up water reuse for you.'],
  [/direct|farmer|producer|manufacturer|distributor|sourcing/i, 'We connect you straight to the makers, so no middleman takes a cut.'],
  [/group|bulk|pooled|together|contract/i, 'We add your order to other RentMySite partners nearby, so you all get the bulk price.'],
  [/shar(e|ed)|software|insurance|transport|delivery|staff|teacher|technician|trainer|bus/i, 'We find partners nearby to share it with, so you pay only for what you use.']
];
const howWeCut = title => (HOW_WE_CUT.find(([re]) => re.test(title)) || [null, 'We find the right partner and set it all up for you.'])[1];

// "5–10% on raw material" -> "Raw material": the cost this saving cuts
function costOf(saving) {
  const m = /\b(?:on|of|in|offsets|saves) (.+)$/i.exec(String(saving || ''));
  const c = m ? m[1].replace(/^(those|common-area)\s+/i, '') : '';
  return c ? c.charAt(0).toUpperCase() + c.slice(1) : '';
}

// One way to save: the plain name, the cost it cuts, how much, and how RentMySite does it
function savingPitch(lever) {
  return { title: PLAIN[lever.title] || lever.title, saving: lever.saving,
    cost: lever.cost || costOf(lever.saving), we: lever.we || howWeCut(lever.title),
    ...(lever.leak ? { leak: lever.leak } : {}) };
}

module.exports = { PITCH, waysToEarn, savingPitch, costOf, howWeCut };
