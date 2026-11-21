// Shared by the business and professional dashboards: skills, lesson progress and the
// always-visible call to action (which creates a CRM lead and emails the RentMySite team).
const router = require('express').Router();
const Lead = require('../models/Lead');
const { requireAuth } = require('../middleware/auth');
const { industryFor } = require('../utils/industry');
const { sendMail } = require('../utils/mailer');
const { ctaRequest } = require('../utils/emails');
const rateLimit = require('../utils/rateLimit');
const { fail, str } = require('../utils/http');

router.use(requireAuth('business', 'associate'));

const cleanSkills = list => (Array.isArray(list) ? list : String(list || '').split(','))
  .map(x => str(String(x)).slice(0, 60)).filter(Boolean)
  .filter((x, i, all) => all.findIndex(y => y.toLowerCase() === x.toLowerCase()) === i)
  .slice(0, 40);   // "Select all skills" can pick every suggestion

// "People behind your growth" on the dashboard: who their manager is, and real numbers from the network.
// Counts below COMMUNITY_MIN_COUNT (default 10) are left out rather than shown small. Nothing is made up.
router.get('/community', async (req, res) => {
  const User = require('../models/User');
  const { sectorById, sectorFor, data } = require('../utils/catalog');
  const min = Number(process.env.COMMUNITY_MIN_COUNT) || 10;
  const me = req.user;
  const sector = sectorById(me.sectorId) || sectorFor(me);
  const members = (await User.find({})).filter(u => ['business', 'associate'].includes(u.role) && u.status !== 'rejected');
  const area = String(me.location || '').trim().toLowerCase();
  const sameType = sector ? members.filter(u => (sectorById(u.sectorId) || sectorFor(u))?.id === sector.id) : [];
  const partnerIds = new Set((sector?.c || []).map(name => data.sectors.find(s => s.n === name)?.id).filter(Boolean));
  const partners = members.filter(u => partnerIds.has((sectorById(u.sectorId) || sectorFor(u))?.id));
  const show = n => (n >= min ? n : null);
  const manager = me.assignedManager ? await User.findById(me.assignedManager) : null;
  res.json({
    manager: manager ? { name: manager.name, phone: manager.phone || '', email: manager.email || '' } : null,
    team: { phone: '+91 81039 90990', whatsapp: '918103990990', email: process.env.TEAM_INBOX || 'info@rentmysite.ai' },
    numbers: {
      members: show(members.length),
      sameType: show(sameType.length),
      sameTypeNearby: area ? show(sameType.filter(u => String(u.location || '').trim().toLowerCase() === area).length) : null,
      partners: show(partners.length),
      area: me.location || ''
    },
    // Facts about this business type from our research (catalog), not counts of members
    ideas: sector ? (sector.s || []).length + (sector.p || []).length : null,
    partnerTypes: sector ? (sector.c || []).length : null,
    example: sector?.e || null,
    // The three big numbers on the dashboard. NETWORK_MEMBERS is the size of the whole RentMySite / Govianu network
    // (set it on the server to the real figure); the kinds of business come from our catalog.
    headline: [
      [process.env.NETWORK_MEMBERS || '5,000+', 'people have joined RentMySite'],
      [`${Math.floor(data.sectors.length / 10) * 10}+`, 'kinds of businesses and professionals on the network'],
      ['100+', 'opportunities to earn more and spend less']
    ]
  });
});

// This person's own CTA (feasibility, revenue, cost saving, terms they agreed to), the type's media and the
// cost-saving plan for the dashboard
// The detailed CTA (dashboard only): Deal Sheet, 14 sections and the acceptance form (utils/ctaFull.js)
router.post('/cta/accept', async (req, res) => {
  const full = require('../utils/ctaFull');
  const a = full.acceptCta(req.user, req.body || {}, req);
  await req.user.save();
  // A copy to them (and the team), like a signed PDF
  const { sendMail } = require('../utils/mailer');
  const { layout, p, esc, TEAM_INBOX } = require('../utils/emails');
  const body = p(`Hi ${esc(String(req.user.name || '').split(' ')[0])}, thank you. This is your copy of the RentMySite.ai owner mandate you accepted. Keep it for your records.`) + full.acceptedHtml(req.user);
  sendMail({ to: req.user.email, subject: `Your RentMySite.ai owner mandate (${a.version})`, html: layout('Your mandate', body) }).catch(() => {});
  sendMail({ to: TEAM_INBOX(), subject: `Mandate accepted: ${req.user.business?.businessName || req.user.name}${req.user.leadId ? ` [${req.user.leadId}]` : ''}`,
    html: layout('Mandate accepted', p(`${esc(a.name)} accepted ${esc(a.version)} on ${esc(a.atIST)} from IP ${esc(a.ip)}.`) + full.acceptedHtml(req.user)) }).catch(() => {});
  res.json({ full: full.ctaFull(req.user) });
});
router.post('/cta/optional', async (req, res) => {
  const full = require('../utils/ctaFull');
  full.setOptional(req.user, String(req.body?.id || ''), req.body?.value);
  await req.user.save();
  res.json({ full: full.ctaFull(req.user) });
});

router.get('/my-cta', async (req, res) => {
  const { ctaFor, renderCta } = require('../utils/cta');
  const c = ctaFor({ user: req.user });
  const { planFor } = require('../utils/cta'), { waysToEarn } = require('../utils/pitch');
  // Signed up before research existed (or the lookup failed): look the business up in the background, at
  // most once a day; the next dashboard load shows it
  const research = require('../utils/research');
  const u = req.user;
  if (research.researchConfigured() && !u.research && ['business', 'associate'].includes(u.role)
      && Date.now() - new Date(u.researchTriedAt || 0).getTime() > 24 * 3600 * 1000) {
    u.researchTriedAt = new Date().toISOString();
    await u.save();
    research.researchUser(u);
  }
  const plan = planFor(req.user);
  // Researched businesses get their own five ways to save in place of the general ones for their type
  const savings = c?.savings && plan?.researched ? { ...c.savings, levers: plan.savings.levers, topCosts: plan.savings.levers.map(l => l.cost.toLowerCase()).filter(Boolean) } : (c?.savings || null);
  res.json({ agreed: c?.agreed || null, html: renderCta(c), full: require('../utils/ctaFull').ctaFull(req.user), media: c?.media || null, savings,
    about: plan?.researched ? { text: plan.about, busy: plan.busyHours, quiet: plan.quietHours } : null,
    ways: plan?.ways   // type not known: the general five ways
      || waysToEarn({ sector: { t: req.user.role === 'associate' ? 'p' : 'b' }, opportunities: [], moreOpportunities: [] }) });
});

router.get('/', async (req, res) => {
  res.json({ industry: industryFor(req.user), skills: req.user.skills || req.user.associate?.skills || [], lessonsWatched: req.user.lessonsWatched || [] });
});

router.patch('/skills', async (req, res) => {
  const skills = cleanSkills(req.body?.skills);
  if (!skills.length) throw fail('Pick or type at least one skill');
  const u = req.user;
  u.skills = skills;
  if (u.role === 'associate') { u.associate = u.associate || {}; u.associate.skills = skills; }
  await u.save();
  res.json({ skills });
});

router.post('/lessons/watched', async (req, res) => {
  const key = str(req.body?.key).slice(0, 120);
  if (!key) throw fail('Missing lesson');
  const u = req.user;
  const list = Array.isArray(u.lessonsWatched) ? u.lessonsWatched : [];
  if (!list.includes(key)) list.push(key);
  u.lessonsWatched = list.slice(-60);
  await u.save();
  res.json({ lessonsWatched: u.lessonsWatched });
});

// What each call to action asks the team to do
const ACTIONS = {
  growth_call: 'Book a growth call',
  launch_idea: 'Help me launch an idea',
  find_partner: 'Find me a partner',
  find_work: 'Find me paid work',
  run_workshop: 'Help me run a workshop',
  save_costs: 'Get my savings plan',
  financial_plan: 'Plan my finances'
};

router.post('/cta', rateLimit(6, 60 * 60 * 1000), async (req, res) => {
  const action = ACTIONS[req.body?.action] ? req.body.action : 'growth_call';
  const topic = str(req.body?.topic).slice(0, 160);
  const note = str(req.body?.note).slice(0, 1000);
  const preferred = str(req.body?.preferredTime).slice(0, 80);
  const u = req.user;
  const industry = industryFor(u);
  const label = ACTIONS[action];
  const company = u.business?.businessName || '';

  await Lead.create({
    leadId: u.leadId || undefined, name: u.name, company, email: u.email, phone: u.phone, source: 'dashboard', relatedUser: u._id, stage: 'new',
    notes: [label, topic, industry.display, note].filter(Boolean).join(' | '),
    history: [{ stage: 'new', note: `${label}${topic ? `: ${topic}` : ''} (from the ${industry.label} dashboard)`, at: new Date().toISOString() }]
  });
  const mail = await sendMail(ctaRequest({ user: u, industry, label, topic, note, preferred }));
  res.status(201).json({ ok: true, label, emailed: !!mail.sent });
});

module.exports = router;
