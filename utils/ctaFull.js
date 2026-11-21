// The owner's mandate, shown in the dashboard (My mandate): a mandate sheet with this owner's terms, the mandate
// in plain sections, and acceptance with one "I agree" box. From the RentMySite landowner, NRI and institutions
// decks: a mandate, not a lease; title stays with the owner; profit shared monthly by funding tier; monthly
// statements and a yearly audit; exit on sale. Tier percentages are illustrative until the mandate template is
// finalised, and the legal text should be reviewed by RentMySite's lawyer before it is used with owners.
const crypto = require('crypto');

const CTA_VERSION = 'Owner mandate v1.1, 21 November 2026';
const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
const words = t => String(t).replace(/\b\w+/g, w => (w.length <= 3 && !/[aeiou]/i.test(w) ? w.toUpperCase() : cap(w)));

function dealSheet(user) {
  const s = user.space || {};
  return [
    ['Owner', user.name],
    ['Space', s.type || user.business?.businessName || 'To be confirmed after the survey'],
    ['Size', s.size ? `${Number(s.size).toLocaleString('en-IN')} sq ft` : 'To be confirmed after the survey'],
    ['Location', s.location || words(user.location || 'Bengaluru')],
    ['What this is', 'A mandate, not a lease. RentMySite.ai may place operators and license space on the site. No tenancy is created.'],
    ['Your share of site profit', 'We fund the build: 35%. The brand funds (standard): 50%. You fund the build: 65%. The tier is confirmed in writing after the survey.'],
    ['When you are paid', 'Every month, within ten days of month end, with a statement of revenue, costs and your share.'],
    ['Checks', 'Monthly statement, and one audit of the site accounts each year at your request.'],
    ['Upfront fee', 'None.'],
    ['Who pays what', 'RentMySite.ai: permits, insurance, staff, security and running costs. You: taxes on the land.'],
    ['Selling', 'Sell any time. The buyer steps into the mandate, or the site winds down on notice.']
  ];
}

const SECTIONS = [
  { title: '1. What this mandate is', points: [
    'You appoint RentMySite.ai to plan, build and run your space as a site that earns, and to share the profit with you.',
    'It is a mandate, not a lease. It gives us the exclusive right, for the term, to find, contract and place brands and operators on the site, and to sub-license space to them. No tenancy is created.',
    'The title stays with you. Ownership never transfers to RentMySite.ai.'] },
  { title: '2. Survey and plan', points: [
    'We survey the space: frontage, access, power, drainage and local demand, and give you a written estimate.',
    'We share a site plan and the mix of uses and operators. Nothing is built until you approve it.',
    'Every estimate is indicative. Earnings are not promised or guaranteed.'] },
  { title: '3. Build and activate', points: [
    'We arrange approvals, basic infrastructure and the operators and brands you approved.',
    'Who funds the build sets your share: we fund it (35%), a brand funds it (50%, standard) or you fund it (65%).',
    'Build costs and any recovery are shown openly in your statements.',
    'Assets belong to whoever paid for them, and are removed or handed over at the end of the term.'] },
  { title: '4. Running the site', points: [
    'We run the site day to day: staff, security, power, cleaning, permits and insurance.',
    'Brands and operators pay deposits; if one leaves, we replace them from our pipeline.',
    'Every use follows local rules, building bye-laws and, for societies and institutions, your own approvals.',
    'We obtain and pay for the operating permits and licences for the uses.'] },
  { title: '5. Money and statements', points: [
    'We collect from every brand and operator on the site. You do not need to chase anyone for rent.',
    'Site profit is site revenue minus operating costs. Your share of the profit is paid every month, within ten days of month end, to your verified bank account (NRO account for NRIs).',
    'You get a monthly statement, line by line, and one audit of the site accounts each year at your request.'] },
  { title: '6. Your responsibilities', points: [
    'Give true details about the land and its ownership, and tell us about any dispute, loan or charge on it.',
    'Taxes on the land stay with you, as with any tenant.',
    'Give us access to the site for the survey and the build-out.',
    'Make no parallel arrangement on the plot while this mandate runs, unless we agree in writing.'] },
  { title: '7. KYC and documents', points: [
    'We need your PAN, Aadhaar (we keep only the last 4 digits), bank details and the land documents (ownership documents and an encumbrance certificate) before the site goes live.',
    'NRIs sign through a registered power of attorney in India.',
    'Your documents are private and seen only by you and the RentMySite.ai team.'] },
  { title: '8. Selling or ending', points: [
    'You can sell any time. The buyer steps into the mandate, or the site winds down on the notice set out in your mandate sheet.',
    'Either side may end the mandate for a material breach that is not put right within thirty days of written notice.',
    'Force majeure suspends the obligations of both sides while it lasts.',
    'On ending, we hand the space back in the condition agreed in the plan.'] },
  { title: '9. Insurance and responsibility', points: [
    'We hold public liability cover for the site, and require every operator to insure its own activity. The cover and the insurer are listed in your mandate sheet once confirmed.',
    'We are responsible for injury, loss or damage caused by how we run the site.',
    'You are responsible for problems that come from the title or the land itself (for example a dispute over ownership).',
    'Neither side is liable to the other for indirect losses.'] },
  { title: '10. Privacy, changes and disputes', points: [
    'We use your details only to run the mandate, pay you and meet tax and legal duties, and never sell them.',
    'Changes to your share or tier need your written agreement.',
    'Disputes are first discussed in good faith, then go to a sole arbitrator in Bengaluru under Indian law.'] }
];

const CONSENTS = [
  { id: 'terms', required: true, label: 'I have read and agree to this mandate and my mandate sheet.' },
  { id: 'owner', required: true, label: 'I own this space, or I am authorised to sign for its owner (with written consent, if I am a tenant).' },
  { id: 'details', required: true, label: 'The details and documents I give about the land and myself are true, and I will keep them updated.' },
  { id: 'payments', required: true, label: 'RentMySite.ai collects from operators and pays me my share of the site profit every month.' },
  { id: 'approval', required: true, label: 'Nothing is built until I approve the plan, and estimates are not guaranteed.' },
  { id: 'privacy', required: true, label: 'I agree RentMySite.ai may use my details to run this mandate, pay me and meet tax and legal duties.' },
  { id: 'disputes', required: true, label: 'Disputes go first to talks, then to arbitration in Bengaluru under Indian law.' },
  { id: 'marketing', required: false, label: 'Optional: send me updates on WhatsApp, SMS or email.' },
  { id: 'filming', required: false, label: 'Optional: RentMySite.ai may photograph or film the site for marketing.' }
];

const termsText = () => SECTIONS.map(s => s.title + '\n' + s.points.join('\n')).join('\n\n');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');

function ctaFull(user) {
  return {
    version: CTA_VERSION, dealSheet: dealSheet(user), sections: SECTIONS,
    consents: CONSENTS.map(({ id, required, label }) => ({ id, required, label })),
    accepted: user.ctaAcceptance && user.ctaAcceptance.version === CTA_VERSION ? {
      at: user.ctaAcceptance.at, name: user.ctaAcceptance.name, designation: user.ctaAcceptance.designation,
      optional: user.ctaAcceptance.consents.filter(c => !c.required).map(c => ({ id: c.id, value: c.value }))
    } : null
  };
}

// Record the acceptance: who, when (UTC and IST), from where, which version (and a hash of the exact text), each box
function acceptCta(user, body, req) {
  const { fail } = require('./http');
  if (body.version !== CTA_VERSION) throw fail('These terms were updated. Reload the page and read them again.', 409);
  // One box at the end ("I agree to all of the above") ticks every required point; optional ones start off
  const ticked = body.agreeAll === true
    ? Object.fromEntries(CONSENTS.map(c => [c.id, c.required || body.consents?.[c.id] === true]))
    : (body.consents || {});
  const missing = CONSENTS.filter(c => c.required && ticked[c.id] !== true);
  if (missing.length) throw fail(body.agreeAll !== undefined ? 'Tick "I agree" to accept.' : `Tick all the required boxes to accept (${missing.length} left).`);
  const name = String(body.name || '').trim().slice(0, 120);
  if (name.length < 3) throw fail('Type your full name to sign');
  const at = new Date();
  const sheet = dealSheet(user);
  user.ctaAcceptance = {
    version: CTA_VERSION, termsHash: hash(termsText()), dealSheetHash: hash(JSON.stringify(sheet)), dealSheet: sheet,
    name, designation: String(body.designation || '').trim().slice(0, 80),
    at: at.toISOString(), atIST: at.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST',
    ip: String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim(), userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
    email: user.email,
    consents: CONSENTS.map(c => ({ id: c.id, label: c.label, required: c.required, value: ticked[c.id] === true }))
  };
  user.ctaAcceptanceLog = (user.ctaAcceptanceLog || []).concat([{ version: CTA_VERSION, at: user.ctaAcceptance.at }]).slice(-20);
  return user.ctaAcceptance;
}

// Change an optional consent later (marketing, filming), with the time it changed
function setOptional(user, id, value) {
  const { fail } = require('./http');
  const c = user.ctaAcceptance?.consents?.find(x => x.id === id && !x.required);
  if (!c) throw fail('Not found', 404);
  c.value = value === true;
  c.changedAt = new Date().toISOString();
}

// The copy emailed after accepting
function acceptedHtml(user) {
  const a = user.ctaAcceptance;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const row = ([k, v]) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #D6E2DC;color:#4D5F57;font-size:13px;vertical-align:top">${esc(k)}</td><td style="padding:6px 10px;border-bottom:1px solid #D6E2DC;font-size:14px">${esc(v)}</td></tr>`;
  return `<h2 style="font-size:18px;color:#0E6B4A;margin:18px 0 8px">Your mandate sheet</h2><table style="border-collapse:collapse;width:100%">${a.dealSheet.map(row).join('')}</table>`
    + SECTIONS.map(s => `<h3 style="font-size:15px;color:#0E6B4A;margin:16px 0 6px">${esc(s.title)}</h3><ul style="margin:0;padding-left:20px;font-size:14px;line-height:1.6">${s.points.map(p => `<li>${esc(p)}</li>`).join('')}</ul>`).join('')
    + `<h3 style="font-size:15px;color:#0E6B4A;margin:16px 0 6px">What you ticked</h3><ul style="margin:0;padding-left:20px;font-size:14px;line-height:1.6">${a.consents.map(c => `<li>${c.value ? '☑' : '☐'} ${esc(c.label)}</li>`).join('')}</ul>`
    + `<p style="font-size:13px;color:#4D5F57;margin-top:14px">Signed by ${esc(a.name)}${a.designation ? `, ${esc(a.designation)}` : ''}, on ${esc(a.atIST)}. ${esc(a.version)}. Record ${esc(a.termsHash.slice(0, 16))}.</p>`;
}

module.exports = { ctaFull, acceptCta, setOptional, acceptedHtml, CTA_VERSION, CONSENTS, SECTIONS };
