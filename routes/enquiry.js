// Website enquiry for RentMySite.ai: owners (list a space), brands (need a space) and partners (agents, RWAs).
// Terms must be accepted. Owners and brands get a dashboard and a sign-in code by email; every enquiry becomes
// a lead with an ID (RMS-NOV26-01) and a copy goes to the team inbox.
const router = require('express').Router();
const User = require('../models/User');
const Enquiry = require('../models/Enquiry');
const Lead = require('../models/Lead');
const { uniqueHandle } = require('../utils/handle');
const { sendMail, mailConfigured } = require('../utils/mailer');
const { layout, p, button, esc, TEAM_INBOX, APP_URL } = require('../utils/emails');
const { issueOtp } = require('../utils/otp');
const { issueLink } = require('../utils/links');
const { assignLeadId, nextLeadId } = require('../utils/leadId');
const { TERMS_VERSION } = require('../utils/terms');
const { estimateFor } = require('../utils/spaces');
const { feasibilityFor } = require('../utils/feasibility');

// The feasibility summary in the owner's welcome email: verdict and every revenue stream, with a link to the full report
function feasibilityEmail(user, link) {
  if (!user?.space?.size) return '';
  const f = feasibilityFor(user);
  const inr = n => `₹${Math.round(n).toLocaleString('en-IN')}`;
  const money = x => (x.kind === 'core' ? inr(x.monthly) : `${inr(x.low)}–${inr(x.high)}`);
  const cell = 'padding:6px 8px;border-bottom:1px solid #D6E2DC;font-size:14px';
  const rows = f.core.concat(f.addOns).map((x, i) => `<tr><td style="${cell}">${i + 1}. ${esc(x.name)}</td><td style="${cell};white-space:nowrap">${money(x)}</td><td style="${cell}">${esc(x.feasibility)}</td></tr>`).join('');
  return p(`<strong>Your feasibility report: ${esc(f.verdict.title)}.</strong> ${esc(f.verdict.text)}`)
    + `<table style="border-collapse:collapse;width:100%;margin:0 0 12px"><tr><th style="${cell};text-align:left;color:#4D5F57">Revenue stream</th><th style="${cell};text-align:left;color:#4D5F57">A month</th><th style="${cell};text-align:left;color:#4D5F57">Feasibility</th></tr>${rows}</table>`
    + p(`All streams together: about ${inr(f.totals.low)}–${inr(f.totals.high)} of site revenue a month.${f.startWith.length ? ` We suggest starting with ${esc(f.startWith.join(' and ').toLowerCase())}.` : ''}`)
    + (link ? p(`<a href="${link.replace('activate?', 'activate?next=business%23feasibility&')}">Open your full feasibility report</a>`) : '');
}
const rateLimit = require('../utils/rateLimit');
const { fail, str } = require('../utils/http');

const ROLE_NAMES = { owner: 'A space owner', brand: 'A brand or business that needs space', partner: 'An agent or RWA partner' };
const ACCOUNT_ROLE = { owner: 'business', brand: 'buyer', partner: null };

const areaFrom = loc => (!loc || /^https?:\/\//i.test(loc) ? 'bengaluru' : loc.split(',')[0].trim().toLowerCase() || 'bengaluru');
const codeBox = code => `<div style="margin:20px 0;padding:18px;background:#F5F8F6;border:1px solid #D6E2DC;border-radius:12px;text-align:center;font-size:30px;font-weight:700;letter-spacing:8px;color:#0E6B4A">${esc(code)}</div>`;

router.post('/', rateLimit(5, 10 * 60 * 1000), async (req, res) => {
  const b = req.body || {};
  if (str(b['bot-field'])) return res.json({ ok: true });
  const role = str(b.role);
  const name = str(b.name).slice(0, 120);
  const email = str(b.email).toLowerCase().slice(0, 200);
  const phone = str(b.phone).slice(0, 40);
  if (!ROLE_NAMES[role]) throw fail('Choose whether you own a space, need one, or are a partner');
  if (!name) throw fail('Add your name so we know who to reply to.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail('Add a valid email address. We send your sign-in code there.');
  if (phone.replace(/\D/g, '').length < 10) throw fail('Add your phone or WhatsApp number (at least 10 digits).');
  if (b.termsAccepted !== true) throw fail('Please agree to the Terms to continue.');
  const fields = {
    spaceType: str(b.spaceType).slice(0, 80), format: str(b.format).slice(0, 80),
    size: Math.max(0, Math.round(Number(b.size) || 0)), location: str(b.location).slice(0, 500), message: str(b.message).slice(0, 4000)
  };
  if (!fields.location) throw fail('Add the area and city, or a Google Maps link.');
  const termsAcceptedAt = new Date().toISOString();
  const area = areaFrom(fields.location);

  let user = null, existingAccount = false, code = null, link = null;
  const accountRole = ACCOUNT_ROLE[role];
  if (accountRole) {
    user = (await User.find({ email })).find(u => u.role === accountRole) || null;
    if (user) existingAccount = true;
    else {
      const isOwner = accountRole === 'business';
      const title = isOwner ? `${fields.spaceType || 'Space'} in ${area.replace(/\b\w/g, c => c.toUpperCase())}` : name;
      // Short web address: land.hosurroad.ravi
      const SHORT = { 'Open land or vacant site': 'land', 'Terrace or rooftop': 'terrace', 'Godown or warehouse': 'godown', 'Closed shed or factory': 'shed',
        'Institutional or society land': 'campus', 'Shop or showroom': 'shop', 'Spare office seats': 'seats', 'Hall or event space': 'hall',
        'Parking area': 'parking', 'Vacant house': 'house' };
      const category = isOwner ? (SHORT[fields.spaceType] || 'space') : 'brand';
      user = await User.create({
        role: accountRole, name, email, phone, category, location: area, slug: title,
        handle: await uniqueHandle(category, area, name.split(' ')[0]),
        status: 'approved', termsAcceptedAt, termsVersion: TERMS_VERSION, source: 'website_enquiry',
        ...(isOwner
          ? { business: { businessName: title, address: /^https?:/i.test(fields.location) ? '' : fields.location,
              mapsUrl: /^https?:/i.test(fields.location) ? fields.location : '', idleSlots: fields.message.slice(0, 300) },
              space: { type: fields.spaceType, size: fields.size, location: fields.location } }
          : { buyer: { type: 'company', company: '' }, need: { format: fields.format, size: fields.size, location: fields.location } })
      });
    }
    code = await issueOtp(user);
    link = await issueLink(user, 'signin');
  }

  const enquiry = await Enquiry.create({
    role, roleName: ROLE_NAMES[role], name, email, phone, business: user?.business?.businessName || '', businessType: fields.spaceType || fields.format,
    location: fields.location, message: fields.message, size: fields.size,
    termsAccepted: true, termsVersion: TERMS_VERSION, termsAcceptedAt,
    ip: req.ip, userAgent: str(req.get('user-agent')).slice(0, 300), user: user?._id || null
  });
  const leadId = user ? (user.leadId || await assignLeadId(user)) : await nextLeadId();
  await Lead.create({
    leadId, name, company: user?.business?.businessName || '', email, phone, source: 'enquiry', relatedUser: user?._id || null,
    notes: [ROLE_NAMES[role], fields.spaceType || fields.format, fields.size ? `${fields.size.toLocaleString('en-IN')} sq ft` : '', fields.location].filter(Boolean).join(', '),
    stage: 'new', history: [{ stage: 'new', note: `Website enquiry, terms ${TERMS_VERSION} accepted`, at: termsAcceptedAt }]
  });

  // To them: code, dashboard button, and (owners) an indicative first estimate
  const est = role === 'owner' && fields.size ? estimateFor(fields.size, { category: fields.spaceType }) : null;
  const inr = n => `₹${Math.round(n).toLocaleString('en-IN')}`;
  const personBody = p(`Hi ${esc(name.split(' ')[0])}, thank you for contacting RentMySite.ai. ${role === 'owner'
      ? 'Your owner dashboard is ready. We will call you within one working day to plan a free survey.'
      : role === 'brand' ? 'Your dashboard is ready. We will call you within one working day with sites that fit.'
      : 'Thank you for wanting to introduce a dormant space or a brand. Our team will call you within one working day.'}`)
    + (code ? p('Use this code to open your dashboard:') + codeBox(code) + button(link, 'Open my dashboard') : '')
    + (est ? p(`<strong>A first, indicative estimate for ${fields.size.toLocaleString('en-IN')} sq ft:</strong> about ${inr(est.revenue)} of site revenue a month, ${inr(est.profit)} of profit after running costs, and about ${inr(est.share50)} a month to you at the standard 50% tier.`)
      + feasibilityEmail(user, code ? link : null)
      + p('<span style="font-size:13px;color:#4D5F57">Illustrative only, not an offer. A survey sets the real figure. Earnings are not guaranteed.</span>') : '')
    + p('Questions? Reply to this email or WhatsApp +91 81039 90990.');
  const teamRows = [['Lead ID', leadId], ['Who', ROLE_NAMES[role]], ['Name', name], ['Email', email], ['Phone', phone],
    [role === 'brand' ? 'Needs' : 'Space', fields.spaceType || fields.format], ['Size', fields.size ? `${fields.size.toLocaleString('en-IN')} sq ft` : ''],
    ['Location', fields.location], ['Message', fields.message]].filter(([, v]) => v);
  const teamBody = `<table style="border-collapse:collapse;width:100%">${teamRows.map(([k, v]) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #D6E2DC;color:#4D5F57;font-size:13px">${esc(k)}</td><td style="padding:6px 10px;border-bottom:1px solid #D6E2DC">${esc(v)}</td></tr>`).join('')}</table>`
    + button(`${APP_URL()}/admin#leads`, 'Open in the team dashboard');
  const [toPerson] = await Promise.all([
    sendMail({ to: email, subject: role === 'owner' ? 'Your RentMySite.ai dashboard and free report' : 'Welcome to RentMySite.ai', html: layout('Welcome', personBody) }),
    sendMail({ to: TEAM_INBOX(), subject: `[${leadId}] New enquiry: ${ROLE_NAMES[role]}, ${fields.location}`, html: layout('New enquiry', teamBody) })
  ]);
  res.status(201).json({ ok: true, email, hasDashboard: !!accountRole, existingAccount, profileId: user?._id || null, emailSent: toPerson.sent,
    devOtp: !mailConfigured() && process.env.NODE_ENV !== 'production' && code ? code : undefined });
});

module.exports = router;
