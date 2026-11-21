// Writes the spoken script for an AI presenter lesson, from the business type's catalog data.
// Scripts are always written here on the server, never taken from the browser, so nobody can
// make the platform pay for videos of arbitrary text.
const { sectorById, sectorFor, partnersOf, plural, withArticle, listOf } = require('./catalog');

const lowerFirst = x => (/^[A-Z]{2}/.test(x) ? x : x.charAt(0).toLowerCase() + x.slice(1));
const cap = x => x.charAt(0).toUpperCase() + x.slice(1);
const roundK = n => Math.max(5000, Math.round(n / 1000) * 1000);
const rupees = n => `${Number(n).toLocaleString('en-IN')} rupees`;
const norm = s => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();

// Same order and kinds as the dashboard's lesson list (public/js/growth.js)
function kindOf(sector, topic) {
  const t = norm(topic);
  if (t.startsWith('team up with ')) return 'partner';
  if ((sector.s || []).some(x => norm(x) === t)) return 'service';
  if ((sector.p || []).some(x => norm(x) === t)) return 'product';
  return 'skill';
}

function lessonScript({ user, topic }) {
  const sector = sectorById(user.sectorId) || sectorFor(user);
  if (!sector) return null;
  const isPro = sector.t === 'p';
  const kind = kindOf(sector, topic);
  const partners = partnersOf(sector, 3);
  const partner = kind === 'partner' ? norm(topic).replace(/^team up with /, '') : partners[1] || partners[0];
  const noun = sector.noun;
  const f = sector.f || [30000, 60000, 25000, 15000];
  const money = kind === 'product' ? roundK(f[0] / 4) : kind === 'partner' ? roundK((f[2] || 20000) / 2) : roundK((f[1] || 50000) / 4);
  const topicLc = lowerFirst(String(topic));
  const where = lowerFirst(sector.a);

  let steps;
  if (kind === 'partner') {
    steps = isPro
      ? [`your RentMySite manager introduces you to ${partner}`, 'you agree one pilot, and your fee or share, in writing', 'you deliver it, collect feedback and improve', 'and it becomes a regular slot with repeat bookings']
      : [`your RentMySite manager introduces you to ${partner}`, 'you agree one pilot on a one-page opportunity sheet', `you use ${lowerFirst(sector.a.split(',')[0])} during quiet hours`, 'and you split the income after taxes and agreed costs'];
  } else if (kind === 'product') {
    steps = isPro
      ? [`turn what you know into ${topicLc}`, `sell through ${partner} and their customers`, 'agree price and margins before you start', 'and get paid digitally on one shared statement']
      : [`start with one or two ${topicLc}`, 'display them where customers already wait or pay', `let ${partner} supply or co-create them`, 'and sell by QR or at billing, with margins agreed upfront'];
  } else {
    steps = isPro
      ? [`add ${topicLc} to your skills so partner businesses can find you`, `pick where it works best: ${where}`, `run one pilot with ${partner}`, 'get booked through RentMySite, with the agreement in place before you start', 'and get paid digitally, building ratings for repeat work']
      : [`package ${topicLc}: fix the price and what is included`, 'show it on your booking page so customers and event companies can request it', 'accept requests on your dashboard after checking the split', `bring in ${partner} when you need extra hands`, 'and get paid digitally, with your share settled automatically'];
  }
  const ordinals = ['First', 'Second', 'Third', 'Fourth', 'Finally'];
  const workflow = steps.map((s, i) => `${i === steps.length - 1 ? 'Finally' : ordinals[i]}, ${s.replace(/^and /, '')}.`).join(' ');
  const buyers = isPro ? listOf(partners) : `local customers, plus ${listOf(partners.slice(0, 2))}`;
  const intro = kind === 'partner'
    ? `Hi, I'm your RentMySite guide. Let's talk about teaming up with ${partner}, and why it works for ${plural(noun)}.`
    : `Hi, I'm your RentMySite guide. In the next minute, I'll show you how ${withArticle(noun)} can earn from ${topicLc}.`;

  // Sections: what is said, plus the heading and points shown on screen while it's said (used for captions too)
  const segments = [
    { say: intro, head: `${cap(String(topic).trim())}`, sub: `For ${plural(noun)}` },
    { say: `Who pays for it? ${cap(buyers)}.`, head: 'Who pays for it', list: (isPro ? partners : ['local customers', ...partners.slice(0, 2)]).map(cap) },
    { say: `You can start with what you already have: ${where}.`, head: 'Use what you already have', list: sector.a.split(',').map(x => cap(x.trim())).slice(0, 4) },
    { say: "Here's how it works.", head: 'How it works', steps: steps.map(x => cap(x.replace(/^and /, ''))), reveal: 0 },
    ...steps.map((x, i) => ({ say: `${i === steps.length - 1 ? 'Finally' : ordinals[i]}, ${x.replace(/^and /, '')}.`, head: 'How it works', steps: steps.map(y => cap(y.replace(/^and /, ''))), reveal: i + 1 })),
    { say: `Done well, this could be worth up to ${rupees(money)} a month. That's an illustrative figure from our research, and your manager will check what fits you.`, head: `Up to ₹${money.toLocaleString('en-IN')} a month`, sub: 'Illustrative figure' },
    { say: 'When you are ready, press "Help me launch this", and we will set it up with you.', head: 'Help me launch this', sub: 'Your RentMySite manager sets it up with you' }
  ];
  const script = segments.map(x => x.say).join(' ');

  return {
    key: `${sector.id}:${norm(topic)}`,
    sectorId: sector.id,
    topic: String(topic).trim(),
    kind,
    title: `${cap(String(topic).trim())} for ${plural(noun)}`,
    script: script.length > 1450 ? script.slice(0, 1447).replace(/\s+\S*$/, '') + '.' : script,
    // Where the AI presenter stands in the video (used for the image prompt)
    scene: isPro ? `a bright workspace used by ${plural(noun)} in India` : `inside a welcoming, well-run Indian ${noun}`,
    segments
  };
}

module.exports = { lessonScript, kindOf };
