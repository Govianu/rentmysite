const { requireKyc } = require('../utils/kyc');
const router = require('express').Router();
const Gig = require('../models/Gig');
const Media = require('../models/Media');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');
const { computeSplit } = require('../utils/split');
const { fail, str } = require('../utils/http');
const { industryFor } = require('../utils/industry');
const { uploadMiddleware } = require('../utils/mediaUpload');
const { createMediaUpload, deleteOwnedMedia } = require('../utils/mediaController');
const rateLimit = require('../utils/rateLimit');

router.use(requireAuth('associate'));

router.get('/dashboard', async (req, res) => {
  const me = req.user;
  await me.populate('assignedManager', 'name email phone');
  const [media, openGigs, myGigs] = await Promise.all([
    Media.find({ owner: me._id }).sort({ createdAt: -1 }),
    Gig.find({ status: 'open', $or: [{ location: me.location }, { location: { $exists: false } }, { location: '' }] })
      .populate('venue', 'business.businessName handle location')
      .sort({ date: 1 }).limit(50),
    Gig.find({ $or: [{ host: me._id }, { applicants: me._id }] })
      .populate('venue', 'business.businessName handle location')
      .sort({ createdAt: -1 })
  ]);

  const skillSet = Array.isArray(me.skills) && me.skills.length ? me.skills : (Array.isArray(me.associate?.skills) ? me.associate.skills : []);
  const steps = [
    { key: 'skills', label: 'Choose your skills', done: skillSet.length > 0 },
    { key: 'lesson', label: 'Watch your first lesson', done: (me.lessonsWatched || []).length > 0 },
    { key: 'profile', label: 'Add a short bio and availability', done: Boolean(me.associate?.bio && me.associate?.availability) },
    { key: 'live', label: 'Profile live for bookings', done: me.status === 'approved' }
  ];

  res.json({
    user: me,
    industry: industryFor(me),
    steps,
    media,
    openGigs: openGigs.filter(g => !g.applicants.some(a => String(a) === String(me._id))),
    myGigs
  });
});

router.post('/media', rateLimit(10, 60 * 60 * 1000), uploadMiddleware, async (req, res) => {
  const allowedKinds = ['intro_video', 'training_video', 'course_pdf', 'portfolio_image', 'portfolio_slides'];
  const media = await createMediaUpload({ req, owner: req.user, allowedKinds });
  res.status(201).json({ media });
});

router.delete('/media/:id', async (req, res) => {
  await deleteOwnedMedia({ id: req.params.id, owner: req.user });
  res.json({ ok: true });
});

router.post('/gigs/workshop', async (req, res) => {
  const b = req.body || {};
  const pricePerSeat = Number(b.pricePerSeat);
  const seats = Number(b.seats);
  if (!str(b.title)) throw fail('Give your workshop a title');
  if (!(pricePerSeat > 0) || !(seats > 0)) throw fail('Enter a seat price and number of seats');

  let venue;
  if (str(b.venueHandle)) {
    venue = await User.findOne({ handle: str(b.venueHandle).toLowerCase(), role: 'business' });
    if (!venue) throw fail('No partner venue with that handle');
  }
  const gig = await Gig.create({
    type: 'workshop',
    title: str(b.title),
    description: str(b.description),
    location: req.user.location,
    category: req.user.category,
    host: req.user._id,
    venue: venue?._id,
    date: b.date ? new Date(b.date) : undefined,
    durationHours: Number(b.durationHours) || undefined,
    pricePerSeat, seats,
    status: 'proposed',
    createdBy: req.user._id
  });
  res.status(201).json({ gig, split: computeSplit(pricePerSeat * seats, 'four_way') });
});

router.post('/gigs/:id/apply', async (req, res) => {
  const gig = await Gig.findOne({ _id: req.params.id, type: 'shift', status: 'open' });
  if (!gig) throw fail('This shift is no longer open', 404);
  if (gig.applicants.some(a => String(a) === String(req.user._id))) throw fail('You have already applied');
  requireKyc(req.user, 'apply for a shift');
  gig.applicants.push(req.user._id);
  await gig.save();
  res.json({ gig });
});

router.patch('/profile', async (req, res) => {
  const b = req.body || {};
  const u = req.user;
  for (const key of ['availability', 'bio', 'skill']) if (typeof b[key] === 'string') u.associate[key] = b[key].trim().slice(0, 1000);
  if (b.experienceYears !== undefined) {
    const years = Number(b.experienceYears);
    if (!Number.isInteger(years) || years < 0 || years > 60) throw fail('Enter experience from 0 to 60 years');
    u.associate.experienceYears = years;
  }
  if (b.skills !== undefined) {
    const skills = Array.isArray(b.skills) ? b.skills.slice(0, 12) : String(b.skills).slice(0, 800).split(',');
    u.associate.skills = skills.map(item => str(item).trim().slice(0, 60)).filter(Boolean).slice(0, 12);
  }
  if (typeof b.phone === 'string') u.phone = b.phone.trim().slice(0, 40);
  await u.save();
  res.json({ user: u });
});

module.exports = router;
