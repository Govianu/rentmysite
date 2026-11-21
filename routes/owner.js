// Owner dashboard: the free site report (best uses, indicative estimate, share tiers, where the site is in the
// journey) and the owner's own space details.
const router = require('express').Router();
const Lead = require('../models/Lead');
const { requireAuth } = require('../middleware/auth');
const { fail, str } = require('../utils/http');
const { USES, TIERS, usesFor, estimateFor } = require('../utils/spaces');

router.use(requireAuth('business'));

const SPACE_TYPES = ['Empty plot or open land', 'Terrace or rooftop', 'Godown or warehouse', 'Closed shed or factory', 'Institutional or society land',
  'Shop or showroom', 'Spare office seats', 'Hall or event space', 'Parking area', 'Vacant house', 'Other'];
const ROADS = { main: 1, inner: 0.75, outskirts: 0.55 };
// Where the owner is, from first call to first payout (the lead's stage in the team dashboard)
const JOURNEY = [
  ['Talk to us', 'We call you within one working day.'],
  ['Survey and estimate', 'Frontage, access, power and drainage checked; a written estimate follows.'],
  ['Sign the mandate', 'Terms and funding tier agreed. No upfront cost.'],
  ['Approve the plan', 'You approve the site plan and operator mix.'],
  ['Build and activate', 'Weeks for parking or a market; a few months for courts or pads.'],
  ['Earn monthly', 'Profit share and a statement every month.']
];
const STAGE_STEP = { new: 0, contacted: 1, meeting: 1, cta_sent: 2, signed: 3, lost: 0 };

function report(user) {
  const s = user.space || {};
  const category = s.type || user.category;
  const size = Number(s.size) || 0;
  const road = ROADS[s.road] || 1;
  // The same uses as the feasibility report: the best fits for this space, size, road and hours
  const { rankedUses, isFullTime } = require('../utils/feasibility');
  const fit = rankedUses(category, { size, road: s.road || 'main', fullTime: isFullTime(s.hours) });
  const est = size ? estimateFor(size, { road, uses: fit }) : null;
  return {
    space: { type: s.type || '', size, location: s.location || user.business?.address || '', road: s.road || 'main', hours: s.hours || '', notes: s.notes || '' },
    types: SPACE_TYPES,
    bestUses: usesFor(category),
    allUses: USES,
    estimate: est && { revenue: Math.round(est.revenue), costs: Math.round(est.costs), profit: Math.round(est.profit),
      tiers: TIERS.map(t => ({ ...t, amount: Math.round(est.profit * t.share) })) },
    tiers: TIERS
  };
}

router.get('/report', async (req, res) => {
  const lead = req.user.leadId ? await Lead.findOne({ leadId: req.user.leadId }) : null;
  const stage = lead?.stage || 'new';
  const step = req.user.ctaAcceptance ? Math.max(STAGE_STEP[stage] ?? 0, 3) : (STAGE_STEP[stage] ?? 0);
  res.json({ ...report(req.user), journey: JOURNEY.map(([title, text], i) => ({ title, text, state: i < step ? 'done' : i === step ? 'now' : 'next' })) });
});

// The feasibility report: verdict, key indicators and every commercial revenue stream for this space.
// With an Anthropic key, AI streams for this exact site are fetched in the background; the page asks again
// (refresh=1) to pick them up.
router.get('/feasibility', async (req, res) => {
  const f = require('../utils/feasibility');
  const u = req.user;
  let aiPending = false;
  if (f.aiDue(u)) {
    u.feasibilityAiTriedAt = new Date().toISOString();
    await u.save();
    f.refreshAi(u);
    aiPending = true;
  } else if (f.aiConfigured() && u.feasibilityAiTriedAt && u.feasibilityAi?.inputs !== f.inputsKey(u)
      && Date.now() - new Date(u.feasibilityAiTriedAt).getTime() < 2 * 60 * 1000) {
    aiPending = true;   // still working on it
  }
  res.json({ ...f.feasibilityFor(u), aiConfigured: f.aiConfigured(), aiPending });
});

router.post('/space', async (req, res) => {
  const b = req.body || {};
  const u = req.user;
  const type = str(b.type).slice(0, 80);
  if (type && !SPACE_TYPES.includes(type)) throw fail('Choose a type of space');
  const size = b.size === '' || b.size === undefined ? (u.space?.size || 0) : Math.round(Number(b.size));
  if (!Number.isFinite(size) || size < 0 || size > 50000000) throw fail('Enter the size in sq ft');
  u.space = {
    ...(u.space || {}), type: type || u.space?.type || '', size,
    location: str(b.location).slice(0, 300) || u.space?.location || '',
    road: ROADS[b.road] ? b.road : (u.space?.road || 'main'),
    hours: str(b.hours).slice(0, 200), notes: str(b.notes).slice(0, 1000)
  };
  if (u.space.type) u.business = { ...(u.business || {}), businessName: u.business?.businessName || u.space.type };
  await u.save();
  res.json(report(u));
});

module.exports = router;
