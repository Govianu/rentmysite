// Public endpoints: anyone with a business's handle can view it and request a booking.
const router = require('express').Router();
const User = require('../models/User');
const Booking = require('../models/Booking');
const Lead = require('../models/Lead');
const { fail, str } = require('../utils/http');
const { sendMail } = require('../utils/mailer');
const { marketRequestReceived, marketRequestTeam } = require('../utils/emails');

router.get('/profile/:handle', async (req, res) => {
  const user = await User.findOne({ handle: req.params.handle.toLowerCase(), role: { $in: ['business', 'associate'] } });
  if (!user) throw fail('No profile with that handle', 404);
  res.json({
    profile: {
      handle: user.handle,
      role: user.role,
      name: user.role === 'business' ? user.business?.businessName : user.name,
      category: user.category,
      location: user.location,
      idleSlots: user.business?.idleSlots,
      skill: user.associate?.skill,
      bio: user.associate?.bio
    }
  });
});

router.post('/bookings/:handle', async (req, res) => {
  const b = req.body || {};
  const business = await User.findOne({ handle: req.params.handle.toLowerCase(), role: 'business' });
  if (!business) throw fail('No business with that handle', 404);
  if (!str(b.requesterName)) throw fail('Enter your name');
  if (!str(b.requesterEmail) && !str(b.requesterPhone)) throw fail('Enter an email or phone number so the venue can reach you');
  if (!str(b.eventType)) throw fail('Tell the venue what the booking is for');

  const booking = await Booking.create({
    business: business._id,
    requesterName: str(b.requesterName),
    requesterEmail: str(b.requesterEmail),
    requesterPhone: str(b.requesterPhone),
    eventType: str(b.eventType),
    eventDate: b.eventDate ? new Date(b.eventDate) : undefined,
    guests: Number(b.guests) || undefined,
    amount: Math.max(0, Number(b.amount) || 0),
    message: str(b.message),
    leadGenName: str(b.leadGenName),
    status: 'pending_review', source: 'booking_link',
    timeline: [{ status: 'pending_review', at: new Date().toISOString(), note: 'Request sent to the RentMySite team' }]
  });
  await Lead.create({
    name: booking.requesterName, company: booking.leadGenName, email: booking.requesterEmail, phone: booking.requesterPhone,
    source: 'booking', relatedUser: business._id, relatedBooking: booking._id,
    history: [{ stage: 'new', note: `Booking request: ${booking.eventType} at ${business.handle}` }]
  });
  // RentMySite is the third party: the team checks the request before it reaches the business
  if (booking.requesterEmail) await sendMail(marketRequestReceived({ booking, listing: null }));
  await sendMail(marketRequestTeam({ booking, listing: null, seller: business }));
  res.status(201).json({ ok: true, bookingId: booking._id });
});


// ---------- Stop opportunity emails (link and List-Unsubscribe header in utils/drip.js) ----------
const { validUnsubscribe } = require('../utils/drip');
const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} | RentMySite.ai</title><link rel="icon" type="image/svg+xml" href="/favicon.svg"><meta name="robots" content="noindex">
<link rel="stylesheet" href="/css/site.css"></head><body><header class="top"><a href="/">RentMySite<span>.ai</span></a></header>
<main class="wrap" style="max-width:520px"><section class="card">${body}</section></main></body></html>`;
async function optOutUser(req) {
  const id = str(req.query.u), token = str(req.query.t);
  if (!id || !validUnsubscribe(id, token)) return null;
  return User.findById(id);
}
// Opening the link shows a button (email scanners open links on their own); pressing it, or the inbox's own
// one-click unsubscribe (a POST), stops the emails.
router.get('/unsubscribe', async (req, res) => {
  const user = await optOutUser(req);
  if (!user) return res.status(400).type('html').send(page('Link not valid', '<h1>This link isn’t valid</h1><p class="muted">Reply to any of our emails and we’ll stop them for you.</p>'));
  if (user.emailOptOut) return res.type('html').send(page('Emails stopped', '<h1>You won’t get these emails any more</h1><p class="muted">Sign-in codes and booking emails still arrive as usual.</p>'));
  const q = `u=${encodeURIComponent(req.query.u)}&t=${encodeURIComponent(req.query.t)}`;
  res.type('html').send(page('Stop emails', `<h1>Stop opportunity emails?</h1>
    <p class="muted">You’ll stop getting business opportunity emails for ${String(user.business?.businessName || user.name).replace(/[<>&"]/g, '')}. Sign-in codes and booking emails still arrive.</p>
    <form method="post" action="/api/public/unsubscribe?${q}"><button class="btn wide" type="submit">Stop these emails</button></form>`));
});
router.post('/unsubscribe', async (req, res) => {
  const user = await optOutUser(req);
  if (!user) return res.status(400).type('html').send(page('Link not valid', '<h1>This link isn’t valid</h1>'));
  user.emailOptOut = true;
  user.emailOptOutAt = new Date().toISOString();
  await user.save();
  res.type('html').send(page('Emails stopped', '<h1>Done. You won’t get these emails any more.</h1><p class="muted">Changed your mind? Reply to any of our emails or call +91 81039 90990.</p>'));
});

// ---------- The CTA before signing up, and each business type's research for the homepage ----------
const { ctaFor, renderCta } = require('../utils/cta');
const { playbookFor } = require('../utils/playbook');
const { sectorFor } = require('../utils/catalog');
// Preview of the CTA for the business type chosen in a form (nothing personal is stored)
router.get('/cta-preview', (req, res) => {
  const sectorId = Number(req.query.sector) || (sectorFor({ category: str(req.query.category) })?.id) || null;
  if (!sectorId) throw fail('Choose your type of business first', 400);
  const c = ctaFor({ sectorId, name: str(req.query.name).slice(0, 120), area: str(req.query.area).split(',')[0].slice(0, 80),
    user: { name: str(req.query.person).slice(0, 120) } });
  if (!c) throw fail('Unknown business type', 404);
  res.json({ business: c.business, type: c.type, html: renderCta(c, { preview: true }) });
});
// Videos, creatives and research for one business type (shown when it is picked on the homepage)
router.get('/playbook/:sectorId', (req, res) => {
  const pb = playbookFor(Number(req.params.sectorId));
  if (!pb) throw fail('Unknown business type', 404);
  res.set('Cache-Control', 'public, max-age=3600');
  const { costSavingFor } = require('../utils/costSaving');
  const sv = costSavingFor(pb.sector.id);
  const { assess } = require('../utils/cta');
  const all = pb.opportunities.concat(pb.moreOpportunities);
  const { waysToEarn } = require('../utils/pitch');
  res.json({ type: pb.type, idle: pb.idle, hook: pb.hook, ways: waysToEarn(pb), opportunities: all, details: all.map(o => ({ name: o, ...assess(o) })), partners: pb.partners,
    videos: pb.videos.slice(0, 3), images: pb.images.slice(0, 10),
    savings: { label: sv.label, topCosts: sv.topCosts, levers: sv.levers, example: sv.example } });
});

// ---------- Creatives from the team's Google Drive, fetched once and kept on this server ----------
const fsm = require('fs');
const pathm = require('path');
const { knownIds } = require('../utils/playbook');
const { DATA_DIR } = require('../utils/jsonModel');
const MEDIA_DIR = pathm.join(DATA_DIR, 'media-cache');
const fetching = new Map();
router.get('/media/:id', async (req, res) => {
  const id = String(req.params.id);
  if (!knownIds.has(id)) throw fail('Not found', 404);
  const width = [600, 1000, 1200].includes(Number(req.query.w)) ? Number(req.query.w) : 600;
  const file = pathm.join(MEDIA_DIR, `${id}-w${width}.png`);
  if (!fsm.existsSync(file)) {
    // One download per image even if many people open it at once
    if (!fetching.has(file)) {
      fetching.set(file, (async () => {
        const r = await fetch(`https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w${width}`, { redirect: 'follow' });
        const type = r.headers.get('content-type') || '';
        if (!r.ok || !/^image\//.test(type)) throw new Error(`Drive returned ${r.status} ${type}`);
        fsm.mkdirSync(MEDIA_DIR, { recursive: true });
        fsm.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
      })().finally(() => setTimeout(() => fetching.delete(file), 1000)));
    }
    try { await fetching.get(file); }
    catch (err) { console.error('[media] could not fetch', id, err.message); throw fail('Image not available right now', 502); }
  }
  res.set('Cache-Control', 'public, max-age=604800');
  res.type('png').sendFile(file);
});

module.exports = router;
