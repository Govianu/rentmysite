const router = require('express').Router();
const { industryFor } = require('../utils/industry');
const User = require('../models/User');
const Opportunity = require('../models/Opportunity');
const { issueToken, requireAuth, COOKIE } = require('../middleware/auth');
const { uniqueHandle, slugify } = require('../utils/handle');
const { sectorFor } = require('../utils/catalog');
const { generateOpportunities, sopsFor } = require('../utils/ai');
const { fail, str } = require('../utils/http');
const { TERMS_VERSION } = require('../utils/terms');
const { issueLink, findByToken, spendLink } = require('../utils/links');
const { sendMail, mailConfigured, sendFailureMessage } = require('../utils/mailer');
const { researchUser, within } = require('../utils/research');
const { emailOtp, loginLink, teamEnquiry } = require('../utils/emails');
const { clearOtp, issueOtp, otpIsActive, otpMatches, recordOtpFailure } = require('../utils/otp');
const rateLimit = require('../utils/rateLimit');
const { isStaffEmail, staffDomains } = require('../utils/staff');
const drip = require('../utils/drip');
const { assignLeadId } = require('../utils/leadId');
const { planFor } = require('../utils/cta');

// RentMySite: owners choose a type of space (labels match routes/owner.js)
const SPACE_LABELS = { open_land: 'Vacant site or open space', terrace: 'Terrace or rooftop', godown: 'Godown or warehouse',
  shed: 'Closed shed or factory', institutional_land: 'Institutional or society campus', shop: 'Shop or showroom',
  office_seats: 'Spare office seats', hall: 'Hall or event space', parking: 'Parking area', house: 'Vacant house', other: 'Other' };
const BUSINESS_CATEGORIES = Object.keys(SPACE_LABELS);
const ASSOCIATE_SKILLS = ['chef', 'steward', 'cleaning_staff', 'bartender', 'baker', 'beautician', 'trainer', 'other'];

const BUYER_LABEL = { event_manager: 'event manager', company: 'company', individual: 'individual' };
function profileSummary(user) {
  const industry = industryFor(user);
  const title = user.role === 'business'
    ? `${user.business?.businessName || user.name} — ${industry.display} business`
    : user.role === 'associate' ? `${user.name} — ${industry.display} professional`
    : user.role === 'buyer' ? `${user.buyer?.company || user.name} — buyer (${BUYER_LABEL[user.buyer?.type] || 'individual'})`
    : `${user.name} — RentMySite team`;
  return { id: user._id, role: user.role, label: title, handle: user.handle || '', status: user.status };
}

// One email can hold several dashboards: different businesses, a professional profile, a buyer account.
// These pick which one a sign-in code is for, and find the dashboard a code belongs to.
const sameName = v => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
const profilesFor = email => User.find({ email }).sort({ createdAt: 1 });
function newestSignIn(profiles) {
  return profiles.slice().sort((a, b) => String(b.lastLoginAt || b.createdAt || '').localeCompare(String(a.lastLoginAt || a.createdAt || '')))[0];
}
// The code email says which dashboard it opens, and its button signs in to that dashboard in one tap
// welcome: the one email after signing up, which also carries the lead ID, 5 opportunities and 5 ways to save
const otpMail = async (user, code, { welcome = false, plan = null } = {}) => emailOtp({
  name: user.name, email: user.email, code, role: user.role, category: user.category, sectorId: user.sectorId,
  businessName: user.role === 'business' ? user.business?.businessName : '',
  link: await issueLink(user, 'signin'),
  welcome, plan
});

// staffDomains: the login page shows the RentMySite team sign-up only for these email domains
// teamInviteCode: whether the team sign-up asks for ADMIN_INVITE_CODE (the box is hidden when it is not set)
router.get('/options', (req, res) => res.json({ businessCategories: BUSINESS_CATEGORIES, associateSkills: ASSOCIATE_SKILLS, staffDomains: staffDomains(),
  teamInviteCode: Boolean(process.env.ADMIN_INVITE_CODE) }));

router.post('/signup', rateLimit(5, 15 * 60 * 1000), async (req, res) => {
  const b = req.body || {};
  const role = str(b.role);
  const name = str(b.name).slice(0, 120);
  const email = str(b.email).toLowerCase().slice(0, 200);
  const location = str(b.location).slice(0, 200);

  if (!['business', 'associate', 'admin', 'buyer'].includes(role)) throw fail('Choose whether you are a business, a professional or a buyer');
  if (!name) throw fail('Enter your name');
  if (!/^\S+@\S+\.\S+$/.test(email)) throw fail('Enter a valid email address');
  if (b.termsAccepted !== true && b.termsAccepted !== 'true' && b.termsAccepted !== 'on') throw fail('Please agree to the Terms and Conditions to create your profile');
  if (role === 'admin' && !isStaffEmail(email)) {
    throw fail(`The RentMySite team dashboard is only for Govianu employees. Sign up with your @${staffDomains()[0]} email.`, 403);
  }
  // Optional extra gate: with ADMIN_INVITE_CODE set, team sign-ups must also give it. Without it, the Govianu email
  // (confirmed by the one-time code sent to that inbox) is enough.
  if (role === 'admin' && process.env.ADMIN_INVITE_CODE && b.inviteCode !== process.env.ADMIN_INVITE_CODE) {
    throw fail('That team invite code is not valid', 403);
  }
  if (role !== 'admin' && !location) throw fail('Enter your area, for example Sadashivnagar');
  if (role !== 'admin' && str(b.phone).replace(/\D/g, '').length < 10) throw fail('Enter your phone or WhatsApp number (at least 10 digits)');
  if (!mailConfigured() && process.env.NODE_ENV === 'production') {
    throw fail('Email verification is not configured. Please contact support.', 503);
  }
  // The same email may add another dashboard (e.g. a second business). Only the same one twice is refused.
  const existingUser = (await profilesFor(email)).find(p => p.role === role && (
    role === 'business' ? sameName(p.business?.businessName) === sameName(b.businessName)
      : role === 'associate' ? p.category === (ASSOCIATE_SKILLS.includes(b.skill) ? b.skill : 'other')
      : true));
  if (existingUser) {
    if (!existingUser.emailVerifiedAt) {
      const code = await issueOtp(existingUser);
      const result = await sendMail(await otpMail(existingUser, code));
      if (result.error || (!result.sent && process.env.NODE_ENV === 'production' && !mailConfigured())) {
        throw fail('We could not send your verification code. Please try again later.', 503);
      }
      return res.status(200).json({
        ok: true, verificationRequired: true, email, profileId: existingUser._id,
        devOtp: !mailConfigured() && process.env.NODE_ENV !== 'production' ? code : undefined
      });
    }
    throw fail(role === 'business'
      ? `You already have a dashboard for ${existingUser.business?.businessName || 'this business'}. Log in with an email code instead.`
      : 'You already have this kind of dashboard with this email. Log in with an email code instead.', 409);
  }

  const doc = {
    role, name, email,
    phone: str(b.phone).slice(0, 40),
    location: location.toLowerCase(),
    status: 'approved',
    termsAcceptedAt: new Date().toISOString(),
    termsVersion: TERMS_VERSION
  };

  if (role === 'business') {
    const businessName = str(b.businessName).slice(0, 160);
    const known = sectorFor({ category: str(b.category) });
    const category = BUSINESS_CATEGORIES.includes(b.category) ? b.category : known ? slugify(known.noun, true) : 'other';
    if (known) doc.sectorId = known.id;
    if (!businessName) throw fail('Give your space a name, for example Hosur Road site');
    doc.space = { type: SPACE_LABELS[category] || 'Other', location: str(b.mapsUrl) || location };
    Object.assign(doc, {
      category,
      slug: businessName,
      handle: await uniqueHandle(category, location, businessName),
      business: {
        businessName,
        address: str(b.address),
        mapsUrl: str(b.mapsUrl),
        idleSlots: str(b.idleSlots),
        sops: sopsFor(category)
      }
    });
  } else if (role === 'buyer') {
    const type = ['event_manager', 'company', 'individual'].includes(b.buyerType) ? b.buyerType : 'individual';
    doc.buyer = { type, company: str(b.company).slice(0, 160) };
  } else if (role === 'associate') {
    const skill = ASSOCIATE_SKILLS.includes(b.skill) ? b.skill : 'other';
    const years = b.experienceYears === undefined || b.experienceYears === '' ? 0 : Number(b.experienceYears);
    const suppliedSkills = Array.isArray(b.skills) ? b.skills.slice(0, 40) : str(b.skills).slice(0, 800).split(',');
    if (!Number.isInteger(years) || years < 0 || years > 60) throw fail('Enter experience from 0 to 60 years');
    Object.assign(doc, {
      category: skill,
      slug: name,
      handle: await uniqueHandle(skill, location, name.split(' ')[0]),
      associate: {
        skill,
        skills: suppliedSkills.map(str).map(s => s.slice(0, 60)).filter(Boolean),
        experienceYears: years,
        availability: str(b.availability).slice(0, 200),
        bio: str(b.bio).slice(0, 1000)
      }
    });
  }

  const user = await User.create(doc);
  // (RentMySite: no business-opportunity drip emails; the team calls owners within a working day)
  // Every registration is a lead in the RentMySite team dashboard, with its own ID (e.g. RMS-NOV26-01)
  if (role !== 'admin') {
    await assignLeadId(user, {
      name: user.name, company: user.business?.businessName || user.buyer?.company || '', email, phone: user.phone || '',
      source: 'signup', stage: 'new', notes: [role === 'associate' ? 'Professional' : role === 'buyer' ? 'Buyer' : 'Business', user.category, user.location].filter(Boolean).join(', '),
      history: [{ stage: 'new', note: 'Signed up on the website', at: new Date().toISOString() }]
    });
  }
  // Seed the opportunity feed in the background so signup stays fast
  if (role === 'business') {
    generateOpportunities({ name: user.business.businessName, category: user.category, sectorId: user.sectorId, location: user.location })
      .then(ops => Opportunity.insertMany(ops.map(o => ({ ...o, business: user._id }))))
      .catch(err => console.error('Opportunity seeding failed:', err.message));
  }

  // Look this exact business up on the web, so the 5 ways to earn and save fit it. The email waits for it up to
  // RESEARCH_WAIT_MS (25s); a slower lookup still lands in the dashboard when it finishes.
  // One email: code, dashboard, 5 ways to earn and 5 ways to save (their CTA is in the dashboard)
  const plan = null;   // RentMySite: the owner's site report is in the dashboard
  const code = await issueOtp(user);
  const mailResult = await sendMail(await otpMail(user, code, { welcome: true, plan }));
  if (mailResult.error) throw fail('We could not send your verification code. Please try again later.', 503);
  // The team gets every sign-up too, with what we sent them
  if (role !== 'admin') {
    await sendMail(teamEnquiry({
      source: 'signup', leadId: user.leadId, roleName: role === 'associate' ? 'A professional' : role === 'buyer' ? 'A buyer' : 'A business',
      name: user.name, business: user.business?.businessName || user.buyer?.company || '', email, phone: user.phone,
      businessType: user.category ? user.category.replace(/_/g, ' ') : '', location: user.location,
      message: role === 'associate' ? [user.associate?.skills?.join(', '), user.associate?.availability].filter(Boolean).join(' · ') : (user.business?.idleSlots || ''),
      termsVersion: user.termsVersion, termsAcceptedAt: user.termsAcceptedAt, handle: user.handle
    })).catch(err => console.error('[signup] team email failed:', err.message));
  }

  res.status(201).json({
    ok: true, verificationRequired: true, email, profileId: user._id,
    devOtp: !mailConfigured() && process.env.NODE_ENV !== 'production' ? code : undefined
  });
});

router.post('/login', async (req, res) => {
  throw fail('Password login is no longer available. Request a sign-in code by email.', 410);
});

router.post('/request-otp', rateLimit(5, 15 * 60 * 1000), async (req, res) => {
  const email = str(req.body?.email).toLowerCase().slice(0, 200);
  if (!/^\S+@\S+\.\S+$/.test(email)) throw fail('Enter a valid email address');
  const profiles = await profilesFor(email);
  const user = profiles.find(p => String(p._id) === str(req.body?.profileId)) || newestSignIn(profiles);
  let devOtp;
  if (user) {
    if (!mailConfigured() && process.env.NODE_ENV === 'production') {
      throw fail('Email sign-in is temporarily unavailable. Please contact support.', 503);
    }
    const code = await issueOtp(user);
    const mail = await otpMail(user, code);
    const result = await sendMail(mail);
    if (result.error) throw fail(sendFailureMessage(result.error, mail.to), 503);
    if (!mailConfigured() && process.env.NODE_ENV !== 'production') devOtp = code;
  }

  res.json({
    ok: true,
    message: 'If that email has a dashboard, a sign-in code is on its way.',
    devOtp
  });
});

// RentMySite team sign-in (team.html): Govianu emails only. Owning the @govianu.com inbox is the proof, so the first
// sign-in creates that person's team account; the code (and one-tap button) goes to that inbox.
router.post('/team/request-otp', rateLimit(5, 15 * 60 * 1000), async (req, res) => {
  const email = str(req.body?.email).toLowerCase().slice(0, 200);
  if (!/^\S+@\S+\.\S+$/.test(email)) throw fail('Enter your Govianu email address');
  if (!isStaffEmail(email)) throw fail(`The RentMySite team sign-in is only for Govianu employees. Use your @${staffDomains()[0]} email.`, 403);
  if (!mailConfigured() && process.env.NODE_ENV === 'production') {
    throw fail('Email sign-in is temporarily unavailable. Please contact support.', 503);
  }
  let user = (await profilesFor(email)).find(p => p.role === 'admin');
  if (!user) {
    const fromEmail = email.split('@')[0].split(/[._-]+/).filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    user = await User.create({
      role: 'admin', name: str(req.body?.name).slice(0, 120) || fromEmail || 'RentMySite team', email,
      status: 'approved', termsAcceptedAt: new Date().toISOString(), termsVersion: TERMS_VERSION, source: 'team_sign_in'
    });
  }
  const code = await issueOtp(user);
  const mail = await otpMail(user, code);
  const result = await sendMail(mail);
  if (result.error) throw fail(sendFailureMessage(result.error, mail.to), 503);
  res.json({
    ok: true, email, profileId: user._id,
    devOtp: !mailConfigured() && process.env.NODE_ENV !== 'production' ? code : undefined
  });
});

router.post('/verify-otp', rateLimit(10, 15 * 60 * 1000), async (req, res) => {
  const email = str(req.body?.email).toLowerCase().slice(0, 200);
  const code = str(req.body?.code);
  if (!/^\S+@\S+\.\S+$/.test(email)) throw fail('Enter a valid email address');
  // Each dashboard on this email holds its own code; the code entered decides which one opens
  const profiles = await profilesFor(email);
  for (const p of profiles) if (p.emailOtpHash && !otpIsActive(p)) { clearOtp(p); await p.save(); }
  const waiting = profiles.filter(p => otpIsActive(p));
  const user = waiting.find(p => otpMatches(p, code));
  if (!user) {
    for (const p of waiting) { recordOtpFailure(p); await p.save(); }
    throw fail('That code has expired or is incorrect. Request a new code.', 401);
  }
  user.emailVerifiedAt = user.emailVerifiedAt || new Date().toISOString();
  user.lastLoginAt = new Date().toISOString();
  clearOtp(user);
  await user.save();
  if (user.role === 'admin' && !isStaffEmail(user.email)) throw fail('The RentMySite team dashboard is only for Govianu employees.', 403);
  issueToken(res, user);
  res.json({ user, redirect: `/${user.role}` });
});

router.get('/profiles', requireAuth(), async (req, res) => {
  const profiles = (await profilesFor(req.user.email))
    .filter(p => p.role !== 'admin' || isStaffEmail(p.email));
  res.json({ current: req.user._id, profiles: profiles.map(profileSummary) });
});

router.post('/switch-profile', requireAuth(), async (req, res) => {
  const profile = await User.findById(str(req.body?.profileId));
  if (!profile || profile.email !== req.user.email) throw fail('Dashboard not found', 404);
  if (profile.role === 'admin' && !isStaffEmail(profile.email)) throw fail('The RentMySite team dashboard is only for Govianu employees.', 403);
  profile.lastLoginAt = new Date().toISOString();
  await profile.save();
  issueToken(res, profile);
  res.json({ user: profile, redirect: `/${profile.role}` });
});

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});

router.get('/me', requireAuth(), async (req, res) => {
  await req.user.populate('assignedManager', 'name email phone');
  res.json({ user: req.user, industry: industryFor(req.user) });
});

// Older email links remain valid, but now verify the address and open the dashboard without a password.
router.get('/link/:token', async (req, res) => {
  const user = await findByToken(User, req.params.token);
  if (!user) throw fail('This link has expired or was already used. Request a new one below.', 410);
  res.json({ name: user.name, email: user.email, purpose: user.linkTokenPurpose || 'activate', role: user.role });
});

router.post('/activate', async (req, res) => {
  const user = await findByToken(User, req.body?.token);
  if (!user) throw fail('This link has expired or was already used. Request a new one below.', 410);
  if (user.role === 'admin' && !isStaffEmail(user.email)) throw fail('The RentMySite team dashboard is only for Govianu employees.', 403);
  user.emailVerifiedAt = user.emailVerifiedAt || new Date().toISOString();
  user.lastLoginAt = new Date().toISOString();
  clearOtp(user);
  spendLink(user, req.body.token);   // this link stops working; other emails' buttons still do
  user.linkTokenPurpose = null;
  await user.save();
  issueToken(res, user);
  res.json({ user, redirect: `/${user.role}` });
});

// Always answers the same way, so it can't be used to find out who has an account
router.post('/request-link', rateLimit(5, 15 * 60 * 1000), async (req, res) => {
  const email = str(req.body?.email).toLowerCase();
  const user = email ? await User.findOne({ email }) : null;
  let devLink;
  if (user) {
    const purpose = user.passwordHash ? 'reset' : 'activate';
    const link = await issueLink(user, purpose);
    await sendMail(loginLink({ name: user.name, email: user.email, link, purpose }));
    if (!mailConfigured() && process.env.NODE_ENV !== 'production') devLink = link;
  }
  res.json({ ok: true, devLink });
});

module.exports = router;
