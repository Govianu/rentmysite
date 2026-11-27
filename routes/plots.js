// Plots & land: owners submit their plot (details in a fixed format + photos + documents) from /list-plot.
// The RentMySite team approves it in the team dashboard (Plot approvals); once published it is shown to everyone
// looking for space (/find and the buyer dashboard). No direct contact: owner phone/email, exact address, map pin and
// documents stay with the team; space seekers send an enquiry and the team coordinates.
const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const Plot = require('../models/Plot');
const Lead = require('../models/Lead');
const User = require('../models/User');
const { requireAuth, COOKIE } = require('../middleware/auth');
const { fail, str } = require('../utils/http');
const rateLimit = require('../utils/rateLimit');
const { sendMail } = require('../utils/mailer');
const emails = require('../utils/emails');
const { TYPES, UPLOAD_DIR, TEMP_DIR, mediaFilePath } = require('../utils/mediaUpload');
const { notifyHub } = require('../utils/hubNotify');
const kyc = require('../utils/kyc');

// ---------- The format every plot is submitted in ----------
const PLOT_TYPES = ['Vacant plot / land', 'Agricultural land', 'Converted (DC) land', 'Commercial site', 'Industrial plot / KIADB',
  'Terrace or rooftop', 'Godown or warehouse', 'Shed or factory', 'Building / floor', 'Shop or showroom', 'Parking area', 'Other'];
const ROADS = { main: 'Main road / highway', inner: 'Inner road', outskirts: 'Outskirts / village road' };
const ZONING = ['Residential', 'Commercial', 'Industrial', 'Agricultural', 'Converted (DC)', 'Mixed use', 'Not sure'];
const PREFERENCES = { share: 'Revenue share with RentMySite', rent: 'Fixed monthly rent', lease: 'Long-term lease', open: 'Open to all options' };
const AMENITIES = ['Electricity', 'Water / borewell', 'Compound wall', 'Gate', 'Drainage', 'Tar road access', 'Corner plot', 'Clear title', 'Khata available', 'Shed / structure on site'];
const UNITS = { sqft: 1, sqyd: 9, sqm: 10.7639, acre: 43560, gunta: 1089, cent: 435.6 };
const UNIT_LABEL = { sqft: 'sq ft', sqyd: 'sq yd', sqm: 'sq m', acre: 'acre', gunta: 'gunta', cent: 'cent' };
const DOC_KINDS = { title: 'Title / sale deed', ec: 'Encumbrance certificate (EC)', khata: 'Khata / RTC / patta', tax: 'Property tax receipt', conversion: 'DC conversion order', plan: 'Survey sketch / approved plan', other: 'Other document' };
const FORMAT = { types: PLOT_TYPES, roads: ROADS, zoning: ZONING, preferences: PREFERENCES, amenities: AMENITIES, units: UNIT_LABEL, docKinds: DOC_KINDS };

const MAX_PHOTOS = 12;
const MAX_DOCS = 8;
const MB = 1024 * 1024;

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => fs.mkdir(TEMP_DIR, { recursive: true }, (err) => cb(err, TEMP_DIR)),
    filename: (req, file, cb) => cb(null, crypto.randomUUID()),
  }),
  limits: { fileSize: 25 * MB, files: MAX_PHOTOS + MAX_DOCS, fields: 60, fieldSize: 6000 },
  fileFilter(req, file, cb) {
    const ok = file.fieldname === 'photos' ? /^image\/(jpeg|png|webp)$/.test(file.mimetype) : /^(image\/(jpeg|png|webp)|application\/pdf)$/.test(file.mimetype);
    cb(ok ? null : fail(file.fieldname === 'photos' ? 'Photos must be JPG, PNG or WebP' : 'Documents must be PDF, JPG or PNG', 415), ok);
  },
});
function uploadFiles(req, res, next) {
  upload.fields([{ name: 'photos', maxCount: MAX_PHOTOS }, { name: 'documents', maxCount: MAX_DOCS }])(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Each file must be 25 MB or smaller' : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE' ? `Up to ${MAX_PHOTOS} photos and ${MAX_DOCS} documents` : 'Upload failed, please try again';
      return next(fail(msg, 400));
    }
    next(err);
  });
}
const allFiles = (req) => [...(req.files?.photos || []), ...(req.files?.documents || [])];
const cleanup = (files) => Promise.all(files.map((f) => fs.promises.unlink(f.path).catch(() => {})));

async function storeFile(file, { photo }) {
  if (photo && file.size > 10 * MB) throw fail('Each photo must be 10 MB or smaller', 413);
  const type = TYPES.find((t) => t.mimeType === file.mimetype);
  const fh = await fs.promises.open(file.path, 'r');
  const sig = Buffer.alloc(16);
  let n;
  try { ({ bytesRead: n } = await fh.read(sig, 0, 16, 0)); } finally { await fh.close(); }
  if (!type || !type.matches(sig.subarray(0, n))) throw fail(`"${file.originalname}" is not a valid ${photo ? 'photo' : 'PDF or image'}`, 415);
  const key = `plot-${path.basename(file.filename)}.${type.extension}`;
  await fs.promises.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.promises.rename(file.path, path.join(UPLOAD_DIR, key));
  return { key, mimeType: type.mimeType, size: file.size, name: String(file.originalname || '').slice(0, 120) };
}

const phoneOf = (v) => {
  const d = String(v || '').replace(/\D/g, '');
  const ten = d.length >= 10 ? d.slice(-10) : '';
  return /^[6-9]\d{9}$/.test(ten) ? `+91 ${ten.slice(0, 5)} ${ten.slice(5)}` : '';
};
const num = (v, max) => {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 && n <= max ? n : 0;
};
const titleCase = (s) => String(s || '').replace(/\b\w/g, (c) => c.toUpperCase());
const fmtSqft = (n) => Math.round(n).toLocaleString('en-IN') + ' sq ft';

// Plot details from the form (owner submission or team edit)
function plotFields(b, existing = {}) {
  const type = PLOT_TYPES.includes(b.type) ? b.type : existing.type || '';
  const unit = UNITS[b.sizeUnit] ? b.sizeUnit : existing.sizeUnit || 'sqft';
  const sizeValue = b.sizeValue !== undefined ? num(b.sizeValue, 1e8) : existing.sizeValue || 0;
  const amenities = (Array.isArray(b.amenities) ? b.amenities : str(b.amenities).split(',')).map((x) => String(x).trim()).filter((x) => AMENITIES.includes(x));
  const f = {
    type,
    sizeValue,
    sizeUnit: unit,
    sizeSqft: Math.round(sizeValue * UNITS[unit]),
    locality: str(b.locality).slice(0, 120) || existing.locality || '',
    city: str(b.city).slice(0, 60) || existing.city || 'Bengaluru',
    address: b.address !== undefined ? str(b.address).slice(0, 400) : existing.address || '',
    mapUrl: b.mapUrl !== undefined ? (/^https?:\/\//i.test(str(b.mapUrl)) ? str(b.mapUrl).slice(0, 500) : '') : existing.mapUrl || '',
    surveyNo: b.surveyNo !== undefined ? str(b.surveyNo).slice(0, 80) : existing.surveyNo || '',
    road: ROADS[b.road] ? b.road : existing.road || 'inner',
    roadWidthFt: b.roadWidthFt !== undefined ? num(b.roadWidthFt, 1000) : existing.roadWidthFt || 0,
    frontageFt: b.frontageFt !== undefined ? num(b.frontageFt, 100000) : existing.frontageFt || 0,
    zoning: ZONING.includes(b.zoning) ? b.zoning : existing.zoning || 'Not sure',
    currentUse: b.currentUse !== undefined ? str(b.currentUse).slice(0, 200) : existing.currentUse || '',
    availableFrom: b.availableFrom !== undefined ? str(b.availableFrom).slice(0, 40) : existing.availableFrom || '',
    preference: PREFERENCES[b.preference] ? b.preference : existing.preference || 'open',
    expectedRent: b.expectedRent !== undefined ? num(b.expectedRent, 1e9) : existing.expectedRent || 0,
    amenities: b.amenities !== undefined ? [...new Set(amenities)] : existing.amenities || [],
    description: b.description !== undefined ? str(b.description).slice(0, 2000) : existing.description || '',
  };
  f.title = str(b.title).slice(0, 120) || existing.title
    || `${f.sizeSqft ? fmtSqft(f.sizeSqft) + ' ' : ''}${(type || 'plot').toLowerCase().replace(/ \/.*/, '')}${f.locality ? ' in ' + titleCase(f.locality) : ''}`;
  f.title = f.title.charAt(0).toUpperCase() + f.title.slice(1);
  return f;
}

function validatePlot(f) {
  if (!f.type) throw fail('Choose the type of plot or space');
  if (!f.sizeSqft) throw fail('Enter the size of the plot');
  if (!f.locality) throw fail('Enter the area / locality');
  if (!f.address && !f.mapUrl) throw fail('Enter the address or a Google Maps link');
}

const photoUrl = (p, ph) => `/api/plots/${p._id}/photo/${ph.key}`;

// What space seekers see: never the owner's details, the exact address, the map pin or the documents
function publicPlot(p) {
  return {
    id: p._id, plotId: p.plotId, title: p.title, type: p.type, sizeSqft: p.sizeSqft,
    sizeText: p.sizeSqft ? `${fmtSqft(p.sizeSqft)}${p.sizeUnit && p.sizeUnit !== 'sqft' ? ` (${p.sizeValue} ${UNIT_LABEL[p.sizeUnit]}${p.sizeValue === 1 ? '' : 's'})` : ''}` : '',
    locality: titleCase(p.locality), city: titleCase(p.city), road: p.road, roadText: ROADS[p.road] || '', roadWidthFt: p.roadWidthFt || 0,
    frontageFt: p.frontageFt || 0, zoning: p.zoning, currentUse: p.currentUse || '', availableFrom: p.availableFrom || '',
    preference: p.preference, preferenceText: PREFERENCES[p.preference] || '', expectedRent: p.expectedRent || 0,
    amenities: p.amenities || [], description: p.description || '',
    photos: (p.photos || []).map((ph) => photoUrl(p, ph)), publishedAt: p.publishedAt || null,
  };
}

// Everything, for the team
function adminPlot(p) {
  return {
    ...publicPlot(p), status: p.status, reviewNote: p.reviewNote || '', createdAt: p.createdAt,
    ownerName: p.ownerName, ownerPhone: p.ownerPhone, ownerEmail: p.ownerEmail || '', ownerRole: p.ownerRole || '',
    address: p.address || '', mapUrl: p.mapUrl || '', surveyNo: p.surveyNo || '', sizeValue: p.sizeValue, sizeUnit: p.sizeUnit,
    documents: (p.documents || []).map((d) => ({ kind: d.kind, kindText: DOC_KINDS[d.kind] || 'Document', name: d.name, url: `/api/plots/admin/${p._id}/file/${d.key}` })),
    enquiries: p.enquiries || 0, history: p.history || [], ownerId: p.owner ? String(p.owner) : null,
  };
}

async function nextPlotId() {
  const n = (await Plot.find({})).length + 1;
  let id;
  for (let i = n; ; i++) {
    id = `RMS-PLOT-${String(i).padStart(4, '0')}`;
    if (!(await Plot.findOne({ plotId: id }))) return id;
  }
}

async function optionalUser(req) {
  const header = req.headers.authorization || '';
  const token = req.cookies?.[COOKIE] || (header.startsWith('Bearer ') ? header.slice(7) : null);
  if (!token) return null;
  try { const { id } = jwt.verify(token, process.env.JWT_SECRET); return await User.findById(id); } catch { return null; }
}

// ---------- Public ----------
router.get('/format', (req, res) => res.json(FORMAT));

// An owner submits a plot: goes to the team for approval
async function ownerOnly(req, res, next) {
  const u = await optionalUser(req);
  if (!u || u.role !== 'business') return next(fail('Sign in to your owner dashboard to upload your plot', 401));
  req.owner = u;
  next();
}

// The owner's own plots (owner dashboard → Upload my plot)
router.get('/mine', ownerOnly, async (req, res) => {
  const rows = (await Plot.find({ owner: req.owner._id })).filter((p) => p.status !== 'removed').sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  res.json({ plots: rows.map((p) => ({ ...publicPlot(p), status: p.status, reviewNote: p.reviewNote || '', createdAt: p.createdAt })), kyc: kyc.kycSummary(req.owner) });
});

router.post('/', rateLimit(8, 60 * 60 * 1000), ownerOnly, uploadFiles, async (req, res) => {
  const files = allFiles(req);
  try {
    const b = req.body || {};
    const u = req.owner;
    const ownerName = str(b.ownerName).slice(0, 100) || u.name || '';
    const ownerPhone = phoneOf(b.ownerPhone) || phoneOf(u.phone);
    const ownerEmail = u.email || '';
    if (!ownerName) throw fail('Enter your name');
    if (!ownerPhone) throw fail('Enter a valid 10-digit mobile number');
    if (b.consent !== 'yes' && b.consent !== 'on' && b.consent !== 'true') throw fail('Tick the box to confirm you own the plot or are authorised to list it');
    const f = plotFields(b);
    validatePlot(f);
    const photos = req.files?.photos || [];
    if (!photos.length) throw fail('Add at least one photo of the plot');
    const storedPhotos = [];
    for (const file of photos) storedPhotos.push(await storeFile(file, { photo: true }));
    const kinds = (Array.isArray(b.docKinds) ? b.docKinds : str(b.docKinds).split(',')).map((k) => String(k).trim());
    const storedDocs = [];
    for (const [i, file] of (req.files?.documents || []).entries()) storedDocs.push({ ...(await storeFile(file, { photo: false })), kind: DOC_KINDS[kinds[i]] ? kinds[i] : 'other' });

    const plotId = await nextPlotId();
    const plot = await Plot.create({
      ...f, plotId, owner: u._id, ownerName, ownerPhone, ownerEmail, ownerRole: ['owner', 'family', 'agent', 'other'].includes(b.ownerRole) ? b.ownerRole : 'owner',
      photos: storedPhotos, documents: storedDocs, status: 'pending_review', source: str(b.source).slice(0, 40) || 'website',
      history: [{ at: new Date().toISOString(), what: 'Submitted by the owner' }],
    });
    // In the CRM, so the team follows up
    await Lead.create({
      name: ownerName, phone: ownerPhone, email: ownerEmail, company: plot.title, source: 'plot_listing', stage: 'new',
      notes: `${plotId}: ${plot.title}. ${f.address || f.mapUrl}`,
      history: [{ stage: 'new', note: `Listed a plot (${plotId}) – waiting for approval` }],
    }).catch((e) => console.error('[plots] lead:', e.message));
    await sendMail(emails.plotSubmitted({ plot: adminPlot(plot) })).catch((e) => console.error('[plots] team email:', e.message));
    if (ownerEmail) await sendMail(emails.plotReceived({ plot: adminPlot(plot) })).catch((e) => console.error('[plots] owner email:', e.message));
    notifyHub({ type: 'plot', status: 'submitted', phone: ownerPhone, name: ownerName, email: ownerEmail, area: f.locality, plotId, title: plot.title, photos: storedPhotos.length, documents: storedDocs.length });
    res.status(201).json({ plotId, title: plot.title });
  } catch (e) {
    await cleanup(files);
    throw e;
  }
});

// Published plots, for everyone looking for space
router.get('/', async (req, res) => {
  const q = String(req.query.q || '').toLowerCase().trim();
  const area = String(req.query.area || '').toLowerCase().trim();
  const type = String(req.query.type || '');
  const minSqft = Number(req.query.minSqft) || 0;
  let rows = (await Plot.find({ status: 'live' })).map(publicPlot);
  if (type) rows = rows.filter((p) => p.type === type);
  if (minSqft) rows = rows.filter((p) => p.sizeSqft >= minSqft);
  if (area) rows = rows.filter((p) => `${p.locality} ${p.city}`.toLowerCase().includes(area));
  if (q) rows = rows.filter((p) => [p.title, p.type, p.locality, p.description, p.zoning, ...p.amenities].some((x) => String(x).toLowerCase().includes(q)));
  rows.sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
  res.json({ plots: rows.slice(0, 300), types: PLOT_TYPES });
});

// ---------- Team (admins) ----------
const admin = requireAuth('admin');

router.get('/admin/list', admin, async (req, res) => {
  const status = String(req.query.status || 'pending_review');
  const rows = (await Plot.find(status === 'all' ? {} : { status })).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const all = await Plot.find({});
  const counts = Object.fromEntries(['pending_review', 'live', 'rejected', 'removed'].map((s) => [s, all.filter((p) => p.status === s).length]));
  const users = new Map();
  const userOf = async (id) => { if (!id) return null; if (!users.has(String(id))) users.set(String(id), await User.findById(id)); return users.get(String(id)); };
  const plots = [];
  for (const p of rows) {
    const u = await userOf(p.owner);
    plots.push({ ...adminPlot(p), kyc: u ? { ...kyc.kycTeamView(u), userId: String(u._id) } : null });
  }
  // KYC complete but not verified, from people with no plot waiting here (businesses, buyers, partners)
  const withPlot = new Set(all.filter((p) => p.owner && p.status === 'pending_review').map((p) => String(p.owner)));
  const kycWaiting = (await User.find({})).filter((u) => u.role !== 'admin' && u.kyc && kyc.kycComplete(u) && !u.kyc.verifiedAt && !withPlot.has(String(u._id)))
    .map((u) => ({ userId: String(u._id), name: u.name, business: u.business?.businessName || '', role: u.role, email: u.email, phone: u.phone || '', kyc: kyc.kycTeamView(u) }));
  counts.kyc = kycWaiting.length;
  res.json({ plots, kycWaiting, counts, format: FORMAT });
});

router.get('/admin/:id/file/:key', admin, async (req, res) => {
  const p = await Plot.findById(req.params.id);
  const f = p && [...(p.photos || []), ...(p.documents || [])].find((x) => x.key === req.params.key);
  if (!f) throw fail('File not found', 404);
  res.set({ 'Content-Type': f.mimeType, 'Content-Disposition': `inline; filename="${String(f.name || f.key).replace(/[^\w.\- ]/g, '_')}"`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' });
  if (f.mimeType === 'application/pdf') res.set('Content-Security-Policy', 'sandbox');
  res.sendFile(mediaFilePath(f.key));
});

// approve | reject | remove | edit (details can be corrected before approving)
router.patch('/admin/:id', admin, async (req, res) => {
  const p = await Plot.findById(req.params.id);
  if (!p) throw fail('Plot not found', 404);
  const b = req.body || {};
  const by = req.user.name || req.user.email;
  const at = new Date().toISOString();
  if (b.fields && typeof b.fields === 'object') {
    Object.assign(p, plotFields(b.fields, p));
    p.history = [...(p.history || []), { at, what: `Details edited by ${by}` }];
  }
  const was = p.status;
  if (b.action === 'approve') {
    validatePlot(p);
    p.status = 'live';
    p.publishedAt = p.publishedAt || at;
    p.reviewNote = '';
    p.history = [...(p.history || []), { at, what: `Approved and published by ${by}` }];
    if (b.verifyKyc && p.owner) {
      const u = await User.findById(p.owner);
      if (u && kyc.kycComplete(u) && !u.kyc.verifiedAt) {
        u.kyc.verifiedAt = at;
        u.kyc.verifiedBy = String(req.user._id);
        await u.save();
        p.history = [...(p.history || []), { at, what: `Owner KYC verified by ${by}` }];
      }
    }
  } else if (b.action === 'reject') {
    p.status = 'rejected';
    p.reviewNote = str(b.note).slice(0, 500);
    p.history = [...(p.history || []), { at, what: `Rejected by ${by}${p.reviewNote ? ': ' + p.reviewNote : ''}` }];
  } else if (b.action === 'remove') {
    p.status = 'removed';
    p.history = [...(p.history || []), { at, what: `Taken down by ${by}` }];
  } else if (b.action === 'pending') {
    p.status = 'pending_review';
    p.history = [...(p.history || []), { at, what: `Moved back to review by ${by}` }];
  }
  await p.save();
  if (b.action === 'approve' && was !== 'live' && p.ownerEmail) await sendMail(emails.plotPublished({ plot: adminPlot(p) })).catch((e) => console.error('[plots] owner email:', e.message));
  if (b.action === 'reject' && p.ownerEmail) await sendMail(emails.plotRejected({ plot: adminPlot(p) })).catch((e) => console.error('[plots] owner email:', e.message));
  if ((b.action === 'approve' && was !== 'live') || b.action === 'reject') notifyHub({ type: 'plot', status: b.action === 'approve' ? 'approved' : 'rejected', note: p.reviewNote || '', phone: p.ownerPhone, name: p.ownerName, plotId: p.plotId, title: p.title });
  res.json({ plot: adminPlot(p) });
});

// Plots uploaded from one phone number (WhatsApp & Calls → lead drawer), and which numbers have uploads (Leads badges)
const last10 = (v) => String(v || '').replace(/\D/g, '').slice(-10);
router.get('/admin/by-phone/:phone', admin, async (req, res) => {
  const want = last10(req.params.phone);
  const rows = (await Plot.find({})).filter((p) => want && last10(p.ownerPhone) === want).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  res.json({ plots: rows.map(adminPlot) });
});
router.get('/admin/phones', admin, async (req, res) => {
  const out = {};
  for (const p of await Plot.find({})) if (p.status !== 'removed') { const k = last10(p.ownerPhone); out[k] = out[k] === 'live' ? 'live' : p.status; }
  res.json({ phones: out });
});

// ---------- One plot ----------
// Photos are public once the plot is live (admins can always see them)
router.get('/:id/photo/:key', async (req, res) => {
  const p = await Plot.findById(req.params.id);
  const ph = p && (p.photos || []).find((x) => x.key === req.params.key);
  if (!ph) throw fail('Photo not found', 404);
  if (p.status !== 'live') {
    const u = await optionalUser(req);
    const isOwner = u && p.owner && String(u._id) === String(p.owner);
    if (u?.role !== 'admin' && !isOwner) throw fail('Photo not found', 404);
  }
  res.set({ 'Content-Type': ph.mimeType, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': p.status === 'live' ? 'public, max-age=86400' : 'private, no-store' });
  res.sendFile(mediaFilePath(ph.key));
});

router.get('/:id', async (req, res) => {
  const p = await Plot.findById(req.params.id);
  if (!p || p.status !== 'live') throw fail('This plot isn’t available', 404);
  res.json({ plot: publicPlot(p) });
});

// Someone looking for space is interested: the team gets the enquiry and coordinates (no direct contact)
router.post('/:id/enquire', rateLimit(10, 60 * 60 * 1000), async (req, res) => {
  const p = await Plot.findById(req.params.id);
  if (!p || p.status !== 'live') throw fail('This plot isn’t available', 404);
  const b = req.body || {};
  const u = await optionalUser(req);
  const name = str(b.name).slice(0, 100) || u?.name || '';
  const phone = phoneOf(b.phone) || phoneOf(u?.phone);
  const email = str(b.email).slice(0, 160) || u?.email || '';
  if (!name) throw fail('Enter your name');
  if (!phone) throw fail('Enter a valid 10-digit mobile number');
  const purpose = str(b.purpose).slice(0, 200);
  const message = str(b.message).slice(0, 1000);
  await Lead.create({
    name, phone, email, company: str(b.company).slice(0, 120) || u?.buyer?.company || '', source: 'plot_enquiry', stage: 'new',
    relatedUser: u?._id || undefined,
    notes: `Interested in ${p.plotId} (${p.title}). ${purpose ? 'Use: ' + purpose + '. ' : ''}${message}`,
    history: [{ stage: 'new', note: `Enquired about plot ${p.plotId}` }],
  });
  notifyHub({ type: 'enquiry', welcome: false, phone, name, email, role: 'brand', roleName: 'Interested in a plot', details: `Interested in ${p.plotId} (${p.title}) in ${p.locality}${purpose ? '. Use: ' + purpose : ''}${message ? '. ' + message : ''}` });
  p.enquiries = (p.enquiries || 0) + 1;
  await p.save();
  await sendMail(emails.plotEnquiry({ plot: adminPlot(p), enquiry: { name, phone, email, purpose, message } })).catch((e) => console.error('[plots] enquiry email:', e.message));
  res.status(201).json({ ok: true });
});

module.exports = router;
