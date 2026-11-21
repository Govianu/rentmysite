// The CTA: the policies a business or professional views and agrees to online (nothing else to sign).
// Policies only: no revenue streams. Opportunities, cost saving and the team's research stay in the dashboard
// and emails. Used on the website before agreeing (/cta), in the dashboard (My CTA) and by email at sign-up.
// ctaFor() still gathers the type's research, which the dashboard uses for media and cost saving.
const { playbookFor } = require('./playbook');
const { costSavingFor } = require('./costSaving');
const { waysToEarn } = require('./pitch');
const { plural, withArticle } = require('./catalog');
const { TERMS_VERSION } = require('./terms');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = s => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
const lower = s => (/^[A-Z]{2}/.test(s) ? s : String(s || '').charAt(0).toLowerCase() + String(s || '').slice(1));
// "rr nagar" -> "RR Nagar", "hsr layout" -> "HSR Layout": short words without vowels are initials
const titleCase = s => String(s || '').replace(/\b\w+/g, w => (w.length <= 3 && !/[aeiou]/i.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)));
const fmtDate = d => new Date(d || Date.now()).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });

// Desk assessment of one opportunity, the same way the team's feasibility reports rate them
function assess(opportunity) {
  const o = String(opportunity).toLowerCase();
  if (/cloud.kitchen|second|kiosk|franchise|delivery|charging|solar|equipment|stall|counter|\bapp\b/.test(o)) return { investment: 'Medium', time: '4–8 weeks', feasibility: 'High' };
  if (/packaged|retail|private.label|product|merchandise|\bkits?\b|\bmix\b|powder|masala|bases|\bpacks?\b|hamper/.test(o)) return { investment: 'Medium–High', time: '2–3 months', feasibility: 'Medium' };
  return { investment: 'Low', time: '2–4 weeks', feasibility: 'High' };
}

// Everything the CTA says, as data
function ctaFor({ user = {}, sectorId, name, area } = {}) {
  const who = user._id ? user : { ...user, sectorId: sectorId || user.sectorId, business: { businessName: name || user.business?.businessName }, location: area || user.location };
  const pb = playbookFor(who);
  if (!pb) {
    if (!user._id) return null;
    // Type not known (e.g. "other"): the policies are the same for everyone, so show them with general wording
    const isPro = user.role === 'associate';
    return {
      isPro,
      business: isPro ? (user.name || 'You') : (user.business?.businessName || user.name || 'Your business'),
      area: titleCase(user.location || ''), type: isPro ? 'Professional partner' : 'Business partner',
      savings: costSavingFor(user), terms: { version: TERMS_VERSION },
      agreed: user.termsAcceptedAt ? { at: user.termsAcceptedAt, version: user.termsVersion || TERMS_VERSION } : null,
      preparedOn: new Date().toISOString(), media: null
    };
  }
  const s = pb.sector;
  const isPro = s.t === 'p';
  const savings = costSavingFor(who);
  const business = isPro ? (who.name || `You, as ${withArticle(s.noun)}`) : (who.business?.businessName || name || `Your ${s.noun}`);
  const opportunities = pb.opportunities.map(o => ({ name: o, ...assess(o) }));
  const easiest = opportunities.filter(o => o.investment === 'Low').slice(0, 2);
  return {
    business, isPro, area: titleCase(area || who.location || ''),
    type: pb.type, sectorName: s.n, noun: s.noun, nouns: plural(s.noun),
    idle: pb.idle, hook: pb.hook, partners: pb.partners,
    opportunities, moreOpportunities: pb.moreOpportunities,
    startWith: (easiest.length ? easiest : opportunities.slice(0, 2)).map(o => o.name),
    savings,
    terms: { version: TERMS_VERSION },
    agreed: user.termsAcceptedAt ? { at: user.termsAcceptedAt, version: user.termsVersion || TERMS_VERSION } : null,
    preparedOn: new Date().toISOString(),
    media: { video: pb.videos[0] || null, images: pb.images.slice(0, 5) }
  };
}

// ---------- HTML (inline styles, so the same markup works on the website and in email) ----------
const C = { ink: '#0F1B3D', muted: '#47537C', line: '#D5DCEC', soft: '#F6F8FC', navy: '#142C7A', ok: '#1E7F53', okSoft: '#E0F2E9', gold: '#F7B32B' };
const h2 = t => `<h2 style="margin:26px 0 10px;font-size:18px;line-height:1.3;color:${C.navy};font-family:inherit">${t}</h2>`;
const para = t => `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:${C.ink}">${t}</p>`;
const small = t => `<p style="margin:0 0 12px;font-size:13px;line-height:1.5;color:${C.muted}">${t}</p>`;
const list = items => `<ul style="margin:0 0 14px;padding-left:20px;font-size:15px;line-height:1.7;color:${C.ink}">${items.map(x => `<li>${x}</li>`).join('')}</ul>`;
const box = inner => `<div style="margin:6px 0 16px;padding:14px 16px;border-radius:12px;background:${C.okSoft};color:${C.ink};font-size:15px;line-height:1.6">${inner}</div>`;

// The CTA's policies. "No direct contact": partners, buyers and businesses never get each other's details and
// never deal with each other directly; RentMySite is the only point of contact, communication and billing.
function termsList(c) {
  const space = c.isPro ? 'your skills and agreed hours' : 'the space and hours you choose to share';
  return [
    `<strong>Partner in principle.</strong> You join RentMySite as a partner. This CTA is the agreement: there is nothing else to sign. Each opportunity starts only after you approve it in your dashboard.`,
    `<strong>No direct contact.</strong> RentMySite is your only point of contact. We never share your phone number, email or address with buyers, partners or other businesses, and we never share theirs with you. All communication, orders, bookings and payments go only through RentMySite.`,
    `<strong>One point of billing.</strong> Customers pay through RentMySite, and shares are settled with one statement that every party sees.`,
    `<strong>What you bring.</strong> ${cap(space)}, your quality and hygiene standards, and approval of each activity.`,
    `<strong>What we bring.</strong> The partners and customers, the coordination between everyone, the platform, tracking of every transaction, and your dashboard.`,
    `<strong>Group deals.</strong> You let us include ${c.isPro ? 'you' : 'your business'} when we negotiate bulk supplies, brand placements and orders for many partners. Nothing is ordered without your OK.`,
    `<strong>Net, not gross.</strong> Taxes, refunds, payment charges and agreed direct costs come off first. If someone funds equipment, an agreed share (for example 20%) repays it first.`,
    `<strong>How the rest is shared.</strong> The standard split is 25% each to the infrastructure partner, ${c.isPro ? 'you' : 'the business owner'}, the lead generator and RentMySite. Where a party isn’t involved, the split is agreed case by case. Any figures we show are illustrative, not a promise of income.`,
    `<strong>Your brand stays yours.</strong> Marketing that uses your name needs your approval. We show the partnership in our marketing only with your OK.`,
    `<strong>Your details.</strong> We use them to run your dashboard and arrange opportunities for you, keep them private, and never sell them.`,
    `<strong>Leaving.</strong> Any party can exit with 30 days’ notice after dues are settled. Confidential information stays confidential. Disputes are first discussed in good faith, then under the laws of India with courts in Bengaluru.`
  ];
}

function renderCta(c, { preview = false } = {}) {
  if (!c) return '';
  const header = `<div style="padding:18px 20px;border-radius:14px;background:${C.navy};color:#fff">
    <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.85">RentMySite · CTA</div>
    <div style="font-size:22px;font-weight:700;margin:6px 0 4px">${esc(c.business)}</div>
    <div style="font-size:14px;opacity:.9">${esc(c.type)}${c.area ? ` · ${esc(c.area)}` : ''} · ${preview ? 'The policies you agree to' : 'Your policies with RentMySite'}</div>
  </div>`;
  return `<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;color:${C.ink}">${header}`
    + h2('Policies you agree to') + list(termsList(c))
    + (c.agreed ? box(`<strong>Agreed.</strong> Accepted online on ${fmtDate(c.agreed.at)} (terms version ${esc(c.agreed.version)}).`) : '')
    + small(`Full Terms and Privacy Policy: rentmysite.ai/terms. Terms version ${esc(c.terms.version)}.`)
    + '</div>';
}

// The CTA email sent at sign-up: the policies they agreed to, with their lead ID
function ctaEmail({ user, link }) {
  const { layout, button, firstName, TEAM_INBOX } = require('./emails');
  const c = ctaFor({ user });
  if (!c || !user.email) return null;
  const body = para(`Hi ${esc(firstName(user.name))}, here is your CTA: the policies you agreed to with RentMySite. Keep it for your records.`)
    + renderCta(c)
    + (link ? button(link, 'Open my dashboard') : '')
    + small('Reply to this email with any questions. RentMySite is your only point of contact.');
  return {
    to: user.email, replyTo: TEAM_INBOX(),
    subject: `Your CTA: ${c.business}`,
    html: layout('Your CTA', body),
    text: `Your CTA for ${c.business}: the policies you agreed to with RentMySite.${link ? ` Open your dashboard: ${link}` : ''}`
  };
}

// Email someone their CTA, with a one-tap button that opens it in their dashboard. Never throws: a failed email
// must not stop a sign-up.
async function sendCtaEmail(user) {
  try {
    if (!['business', 'associate'].includes(user.role)) return null;
    const { issueLink } = require('./links');
    const { sendMail } = require('./mailer');
    const page = user.role === 'associate' ? 'associate#cta' : 'business#cta';
    const link = (await issueLink(user, 'signin')).replace('activate?', `activate?next=${encodeURIComponent(page)}&`);
    const mail = ctaEmail({ user, link });
    return mail ? await sendMail(mail) : null;
  } catch (err) {
    console.error('[cta] email failed:', err.message);
    return null;
  }
}

// The plan in the sign-up email and the dashboard: 5 different ways to earn and 5 ways to save
// The plan in the sign-up email and the dashboard. When we have looked up this exact business on the web
// (utils/research.js), its own ways and savings replace the general ones for its type.
function planFor(user) {
  const pb = playbookFor(user);
  const r = user?.research;
  if (!pb && !r) return null;
  const savings = costSavingFor(user);
  const general = pb ? waysToEarn(pb) : waysToEarn({ sector: { t: user.role === 'associate' ? 'p' : 'b' }, opportunities: [], moreOpportunities: [] });
  return {
    type: pb?.type || String(user.category || '').replace(/_/g, ' '),
    idle: r?.quietHours || pb?.idle || '',
    about: r?.about || '', busyHours: r?.busyHours || '', quietHours: r?.quietHours || '',
    researched: Boolean(r),
    ways: r ? general.map(g => {
      const w = r.ways.find(x => x.key === g.key);
      return w?.line ? { key: g.key, title: g.title, line: w.line, examples: w.examples.length ? w.examples : g.examples, estMonthly: w.estMonthly || 0 } : g;
    }) : general,
    savings: {
      label: savings.label,
      levers: r ? r.savings.concat(savings.levers).slice(0, 5) : savings.levers.slice(0, 5),
      example: savings.example
    }
  };
}

module.exports = { ctaFor, renderCta, ctaEmail, sendCtaEmail, planFor, assess };
