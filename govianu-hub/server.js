require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const { db, save, flush, now, employee, logActivity, BRANDS, STAGES } = require('./lib/store');
const auth = require('./lib/auth');
const myop = require('./lib/myop');
const { aiConfigured } = require('./lib/ai');
const { mailConfigured } = require('./lib/mail');
const leadsLib = require('./lib/leads');
const engine = require('./lib/engine');
const metrics = require('./lib/metrics');

const BASE = (process.env.BASE_PATH || '').replace(/\/$/, ''); // e.g. "/hub" for govianu.com/hub
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
app.use(express.text({ limit: '25mb', type: 'text/*' }));
app.use(cookieParser());

const r = express.Router();
const h = (fn) => async (req, res) => {
  try {
    const out = await fn(req, res);
    if (!res.headersSent) res.json(out ?? { ok: true });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
};
const brandOf = (req) => (BRANDS[req.query.brand || req.body?.brand] ? req.query.brand || req.body.brand : '');
const publicEmp = (e) => e && { id: e.id, name: e.name, email: e.email, role: e.role, phone: e.phone, myopUserId: e.myopUserId, brands: e.brands, active: e.active !== false, lastLoginAt: e.lastLoginAt };
const nameOf = (by) => {
  const e = employee(by);
  if (e) return e.name;
  if (String(by).startsWith('myop:')) return 'MyOperator panel (unmapped user)';
  return { ai: 'AI assistant', campaign: 'Campaign', customer: '', 'myop-campaign': 'MyOperator campaign', api: 'API', system: 'System' }[by] || by;
};

// ───── MyOperator webhook (no login; protected by a shared token header) ─────
r.post('/api/webhooks/myoperator', (req, res) => {
  const want = process.env.MYOP_WEBHOOK_TOKEN;
  const got = req.get('x-webhook-token') || req.query.token;
  if (!want && process.env.NODE_ENV === 'production') return res.status(503).json({ error: 'MYOP_WEBHOOK_TOKEN not set' });
  if (want && got !== want) return res.status(401).json({ error: 'bad token' });
  res.json({ ok: true }); // answer fast; process after
  const events = Array.isArray(req.body) ? req.body : [req.body];
  (async () => {
    for (const ev of events) await engine.handleWebhook(ev).catch((e) => console.error('[webhook]', e.message));
  })();
});

// ───── website events (server to server, X-Hub-Key): new enquiry → Leads + welcome WhatsApp; plot uploads ─────
r.post('/api/site-event', h(async (req) => {
  const key = process.env.HUB_API_KEY;
  const got = String(req.get('x-hub-key') || '');
  const crypto = require('crypto');
  if (!key || got.length !== key.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(key))) throw Object.assign(new Error('Hub key not accepted'), { status: 401 });
  return require('./lib/site').handleSiteEvent(req.body || {});
}));

// ───── auth ─────
r.post('/api/auth/request', h((req) => auth.requestCode(req.body.email)));
r.post('/api/auth/verify', h((req, res) => {
  auth.setCookie(res, auth.verifyCode(req.body.email, req.body.code));
  return { ok: true };
}));
r.post('/api/auth/logout', h((req, res) => {
  res.clearCookie(auth.COOKIE, { path: '/' });
  return { ok: true };
}));

r.use('/api', auth.requireUser);
const admin = auth.requireAdmin;

// One shared dashboard: every team member sees every lead, chat, call and recording. Whoever contacts a lead
// is recorded on it ("contacted by X") and every action is kept in the activity log under their name.
// The admin view (admin code on the websites, or a Hub admin) adds everyone's performance numbers and timelines,
// reassigning, imports and the campaign.
function leadFor(req, phone) {
  const lead = db.leads[phone];
  if (!lead) throw Object.assign(new Error('Not found'), { status: 404 });
  return lead;
}

r.get('/api/me', h((req) => ({
  me: { ...publicEmp(req.user), role: req.isAdmin ? 'admin' : 'employee' },
  adminView: Boolean(req.isAdmin),
  brands: BRANDS,
  stages: STAGES,
  employees: db.employees.filter((e) => e.active !== false).map((e) => ({ id: e.id, name: e.name, brands: e.brands })),
  configured: { obd: myop.obdConfigured(), myop: myop.configured(), dryRun: myop.DRY_RUN, waNumberId: Boolean(db.settings.waPhoneNumberId), calling: myop.callingConfigured(), ai: aiConfigured(), email: mailConfigured(), sheets: leadsLib.sheetsConfigured(), webhookToken: Boolean(process.env.MYOP_WEBHOOK_TOKEN) },
  settings: req.isAdmin ? db.settings : undefined,
  campaignRunning: db.campaignRunning,
  campaignPausedReason: db.campaignPausedReason || '',
  autopilot: { on: Boolean(db.settings.campaign.autopilot), status: db.autopilotStatus || '', perDay: db.settings.campaign.dailyCap },
  sentToday: db.sentToday,
  unread: db.notifications.filter((n) => n.employeeId === req.user.id && !n.read).length,
})));

r.get('/api/overview', h((req) => metrics.overview(brandOf(req), req.query.range)));

// Hub home: both websites together
r.get('/api/overview-all', h((req) => metrics.overviewAll(req.query.range)));
// Per-employee report for one website. Team members see their own row; admins see everyone.
r.get('/api/report', h((req) => {
  const rep = metrics.report(brandOf(req), req.query.range);
  if (!req.isAdmin) rep.rows = rep.rows.filter((x) => x.id === req.user.id);
  return rep;
}));
// Every lead activity, newest first (admins: everyone's; team members: their own)
r.get('/api/activity', h((req) => metrics.activityFeed(brandOf(req), Math.min(Number(req.query.limit) || 100, 500), req.isAdmin ? req.query.employee || null : req.user.id)
  .map((a) => ({ ...a, byName: nameOf(a.employeeId) || 'System', leadName: db.leads[a.phone]?.name || '', brandName: BRANDS[a.brand]?.name || '' }))));

// ───── leads ─────
r.get('/api/leads', h((req) => {
  const brand = brandOf(req);
  const { q, stage, assigned, campaign } = req.query;
  let list = Object.values(db.leads).filter((l) => !brand || l.brand === brand);
  if (stage) list = list.filter((l) => l.stage === stage);
  if (campaign) list = list.filter((l) => (l.campaign?.state || 'none') === campaign);
  if (req.query.origin) list = list.filter((l) => metrics.origin(l) === req.query.origin);
  if (req.query.contactedBy === 'me') list = list.filter((l) => l.contactedBy === req.user.id || l.lastContactBy === req.user.id);
  else if (req.query.contactedBy === 'none') list = list.filter((l) => !l.contactedBy);
  else if (req.query.contactedBy) list = list.filter((l) => l.contactedBy === req.query.contactedBy || l.lastContactBy === req.query.contactedBy);
  if (assigned === 'me') list = list.filter((l) => l.assignedTo === req.user.id);
  else if (assigned === 'none') list = list.filter((l) => !l.assignedTo);
  else if (assigned) list = list.filter((l) => l.assignedTo === assigned);
  if (q) {
    const s = String(q).toLowerCase();
    list = list.filter((l) => `${l.name} ${l.phone} ${l.email} ${l.area} ${l.sheetStatus} ${l.remarks}`.toLowerCase().includes(s));
  }
  if (req.query.created && req.query.created !== 'all') {
    const from = metrics.rangeStart(req.query.created);
    list = list.filter((l) => l.createdAt >= from);
  }
  // Status tabs (lead-CRM style), counted before the tab itself is applied
  const late = (db.settings.reminders?.firstAfterMin || 10) * 60000;
  const isWaiting = (l) => db.pending[l.phone]?.status === 'open';
  const VIEWS = {
    active: (l) => !['signed', 'lost'].includes(l.stage),
    new: (l) => l.stage === 'new' && !l.contactedBy,
    waiting: isWaiting,
    overdue: (l) => (isWaiting(l) && Date.now() - db.pending[l.phone].firstAt >= late) || (l.stage === 'new' && !l.contactedBy && Date.now() - l.createdAt >= 86400000),
    contacted: (l) => ['contacted', 'replied'].includes(l.stage),
    qualified: (l) => ['qualified', 'meeting', 'cta_sent'].includes(l.stage),
    closed: (l) => ['signed', 'lost'].includes(l.stage),
  };
  const counts = { all: list.length };
  for (const [k, f] of Object.entries(VIEWS)) counts[k] = list.filter(f).length;
  if (VIEWS[req.query.view]) list = list.filter(VIEWS[req.query.view]);
  list.sort((a, b) => Math.max(b.lastInboundAt || 0, b.lastOutboundAt || 0, b.createdAt) - Math.max(a.lastInboundAt || 0, a.lastOutboundAt || 0, a.createdAt));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const page = list.slice(offset, offset + Math.min(Number(req.query.limit) || 300, 5000));
  // latest activity per lead on this page (one pass over the log)
  const want = new Set(page.map((l) => l.phone));
  const lastAct = {};
  for (const a of db.activity) if (a.phone && want.has(a.phone) && (!lastAct[a.phone] || a.at > lastAct[a.phone].at)) lastAct[a.phone] = a;
  return {
    total: list.length,
    counts,
    offset,
    rows: page.map((l) => ({
      phone: l.phone, name: l.name, email: l.email, area: l.area, brand: l.brand, stage: l.stage, sheetStatus: l.sheetStatus,
      assignedTo: l.assignedTo, assignedName: employee(l.assignedTo)?.name || '', campaign: l.campaign?.state || 'none',
      lastInboundAt: l.lastInboundAt, lastOutboundAt: l.lastOutboundAt, aiSummary: l.aiSummary || '', waiting: db.pending[l.phone]?.status === 'open',
      skip: l.campaign?.state === 'none' ? leadsLib.skipReason(l) : null,
      origin: metrics.origin(l), source: l.source || '',
      contactedBy: l.contactedBy || null, contactedByName: employee(l.contactedBy)?.name || '', contactedAt: l.contactedAt || null, contactedHow: l.contactedHow || '',
      lastContactBy: l.lastContactBy || null, lastContactByName: employee(l.lastContactBy)?.name || '', lastContactAt: l.lastContactAt || null, lastContactHow: l.lastContactHow || '',
      createdAt: l.createdAt, remarks: l.remarks || '',
      waitingSince: db.pending[l.phone]?.status === 'open' ? db.pending[l.phone].firstAt : null, waitingKind: db.pending[l.phone]?.status === 'open' ? db.pending[l.phone].kind : null,
      lastNote: l.notes?.length ? { text: l.notes[l.notes.length - 1].text, by: nameOf(l.notes[l.notes.length - 1].by), at: l.notes[l.notes.length - 1].at } : null,
      lastActivity: lastAct[l.phone] ? { text: lastAct[l.phone].text, by: nameOf(lastAct[l.phone].employeeId) || 'System', at: lastAct[l.phone].at } : null,
    })),
  };
}));

r.get('/api/leads/:phone', h((req) => {
  const lead = leadFor(req, req.params.phone);
  return {
    lead: { ...lead, assignedName: employee(lead.assignedTo)?.name || '', contactedByName: employee(lead.contactedBy)?.name || '', lastContactByName: employee(lead.lastContactBy)?.name || '' },
    windowOpen: engine.windowOpen(lead),
    pending: db.pending[lead.phone] || null,
    messages: db.messages.filter((m) => m.phone === lead.phone && !m.internal).slice(-200).map((m) => ({ ...m, byName: nameOf(m.by) })),
    calls: Object.values(db.calls).filter((c) => c.phone === lead.phone).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0)).map((c) => ({ ...c, employeeName: employee(c.employeeId)?.name || c.agentName || '' })),
    activity: db.activity.filter((a) => a.phone === lead.phone).slice(-100).reverse().map((a) => ({ ...a, byName: nameOf(a.employeeId) || 'System' })),
  };
}));

r.patch('/api/leads/:phone', h((req) => {
  const lead = leadFor(req, req.params.phone);
  const b = req.body;
  if (b.assignedTo !== undefined && b.assignedTo !== lead.assignedTo) {
    if (!req.isAdmin) throw Object.assign(new Error('Only the admin view can reassign leads'), { status: 403 });
    leadsLib.assign(lead, b.assignedTo, req.user.id);
  }
  if (b.stage && STAGES.includes(b.stage) && b.stage !== lead.stage) {
    logActivity(req.user.id, 'stage', lead, `Stage ${lead.stage} → ${b.stage}`);
    lead.stage = b.stage;
  }
  if (b.brand && BRANDS[b.brand]) {
    lead.brand = b.brand;
    lead.brandLocked = true;
  }
  for (const k of ['name', 'email', 'area']) if (typeof b[k] === 'string') lead[k] = b[k].trim();
  if (typeof b.aiPaused === 'boolean' && b.aiPaused !== Boolean(lead.aiPaused)) {
    lead.aiPaused = b.aiPaused;
    logActivity(req.user.id, b.aiPaused ? 'ai_paused' : 'ai_resumed', lead, b.aiPaused ? 'AI paused by hand' : 'Chat handed back to the AI');
    if (!b.aiPaused && db.pending[lead.phone]?.status === 'open') engine.scheduleAi(lead.phone);
  }
  if (b.note) {
    lead.notes = lead.notes || [];
    lead.notes.push({ at: now(), by: req.user.id, text: String(b.note).slice(0, 2000) });
    logActivity(req.user.id, 'note', lead, `Note: ${String(b.note).slice(0, 80)}`);
  }
  save();
  return { ok: true };
}));

// 📞 Call: MyOperator rings the team member first, then connects the customer from the company number
r.post('/api/leads/:phone/call', h(async (req) => {
  const lead = leadFor(req, req.params.phone);
  const { normPhone } = require('./lib/store');
  const r2 = await myop.clickToCall({ customer: lead.phone, userId: req.user.myopUserId || '', agentPhone: normPhone(req.user.phone) || '', reference: `hub-${lead.phone}-${Date.now()}` });
  logActivity(req.user.id, 'call_click', lead, `Started a call to ${lead.name || '+' + lead.phone} through MyOperator`);
  return { ok: true, dryRun: Boolean(r2.dryRun) };
}));

r.post('/api/leads/:phone/send', h(async (req) => {
  const { text, template, templateBody, headerMediaUrl } = req.body;
  if (!text && !template) throw new Error('Type a message or choose a template');
  leadFor(req, req.params.phone);
  await engine.hubSend(req.user, req.params.phone, { text, template, templateBody, headerMediaUrl });
  return { ok: true };
}));

// ───── inbox (customers waiting for a human) ─────
r.get('/api/inbox', h((req) => {
  const brand = brandOf(req);
  return Object.values(db.pending)
    .filter((p) => p.status === 'open' && (!brand || p.brand === brand))
    .map((p) => {
      const l = db.leads[p.phone] || {};
      return { ...p, name: l.name, assignedTo: l.assignedTo, assignedName: employee(l.assignedTo)?.name || '', aiSummary: l.aiSummary || '', stage: l.stage };
    })
    .filter((p) => req.query.mine !== '1' || p.assignedTo === req.user.id)
    .sort((a, b) => a.firstAt - b.firstAt);
}));
r.post('/api/inbox/:phone/done', h((req) => {
  leadFor(req, req.params.phone);
  return engine.resolvePending(req.params.phone, req.user.id, 'marked done');
}));

// ───── calls ─────
r.get('/api/calls', h((req) => {
  const brand = brandOf(req);
  const from = metrics.rangeStart(req.query.range || '7d');
  let list = Object.values(db.calls).filter((c) => (c.startedAt || c.createdAt) >= from && (!brand || c.brand === brand));
  if (req.query.employee) list = list.filter((c) => c.employeeId === req.query.employee);
  return list
    .sort((a, b) => (b.startedAt || b.createdAt) - (a.startedAt || a.createdAt))
    .slice(0, 500)
    .map((c) => ({ id: c.id, phone: c.phone, name: db.leads[c.phone]?.name || '', direction: c.direction, status: c.status, duration: c.duration, talk: c.talk, startedAt: c.startedAt || c.createdAt, employeeId: c.employeeId, employeeName: employee(c.employeeId)?.name || c.agentName || '', missedBy: c.missedBy || [], hasRecording: Boolean(c.recording_filename), brand: c.brand }));
}));
// ▶ Play: MyOperator's link to this call's recording, or MyOperator's call logs when that isn't available
const MYOP_LOGS = 'https://in.app.myoperator.com/logs';
r.get('/api/calls/:id/recording', h(async (req, res) => {
  const c = db.calls[req.params.id];
  if (!c?.recording_filename || !myop.callingConfigured()) return res.redirect(MYOP_LOGS);
  try {
    res.redirect(await myop.recordingLink(c.recording_filename));
  } catch (e) {
    console.warn('[recording]', e.message);
    res.redirect(MYOP_LOGS);
  }
}));

// ───── team ─────
r.get('/api/team', h((req) => {
  const t = metrics.team(brandOf(req), req.query.range);
  if (!req.isAdmin) return { rows: t.rows.filter((x) => x.id === req.user.id), unattributed: {}, unmappedAgents: {} };
  return t;
}));
r.get('/api/team/:id/timeline', h((req) => {
  if (!req.isAdmin && req.params.id !== req.user.id) throw Object.assign(new Error('Admin view only'), { status: 403 });
  return metrics.employeeTimeline(req.params.id).map((a) => ({ ...a, leadName: db.leads[a.phone]?.name || '' }));
}));

// ───── employees ─────
r.get('/api/employees', h(() => db.employees.map(publicEmp)));
r.patch('/api/employees/:id', h((req) => {
  const e = employee(req.params.id);
  if (!e) throw Object.assign(new Error('Not found'), { status: 404 });
  const self = e.id === req.user.id;
  if (!self && !req.isAdmin) throw Object.assign(new Error('Admins only'), { status: 403 });
  const b = req.body;
  if (typeof b.name === 'string' && b.name.trim()) e.name = b.name.trim();
  if (typeof b.phone === 'string') e.phone = b.phone.trim();
  if (req.isAdmin) {
    if (typeof b.myopUserId === 'string' && b.myopUserId.trim() !== e.myopUserId) {
      if (b.myopUserId.trim()) engine.linkMyopUser(e, b.myopUserId.trim());
      else e.myopUserId = '';
    }
    if (Array.isArray(b.brands)) e.brands = b.brands.filter((x) => BRANDS[x]);
    if (['admin', 'employee'].includes(b.role) && !(self && b.role !== 'admin')) e.role = b.role;
    if (typeof b.active === 'boolean' && !self) e.active = b.active;
  }
  save();
  return publicEmp(e);
}));

// ───── notifications ─────
r.get('/api/notifications', h((req) => db.notifications.filter((n) => n.employeeId === req.user.id).slice(-50).reverse()));
r.post('/api/notifications/read', h((req) => {
  for (const n of db.notifications) if (n.employeeId === req.user.id) n.read = true;
  save();
}));

// ───── imports & campaign (admin) ─────
r.post('/api/import/csv', admin, h((req) => leadsLib.importCsv(req.body, { brand: brandOf(req) || 'rentmysite', tab: req.query.tab || 'csv' })));
r.post('/api/import/sheet', admin, h(async (req) => {
  if (!leadsLib.sheetsConfigured()) throw new Error('Google service account not set up – use CSV upload, or see README');
  return leadsLib.importSheet(req.body.tab || 'Enq - Owner', brandOf(req) || 'rentmysite');
}));
r.post('/api/import/dnd', admin, h((req) => leadsLib.importDnd(req.body?.tab)));
r.post('/api/import/site', admin, h((req) => leadsLib.syncFromSite(brandOf(req) || 'rentmysite')));

r.get('/api/templates', admin, h(() => myop.listTemplates()));
r.post('/api/campaign/queue', admin, h((req) => {
  const brand = brandOf(req) || 'rentmysite';
  const pool = Object.values(db.leads).filter((l) => l.brand === brand && (l.campaign?.state || 'none') === 'none' && !leadsLib.skipReason(l));
  const n = req.body.all ? pool.length : Math.min(pool.length, Number(req.body.count) || 25);
  for (const l of pool.slice(0, n)) l.campaign = { state: 'queued' };
  save();
  return { queued: n };
}));
// Send the campaign template to ONE number (your own) to check the WhatsApp setup before a real run.
r.post('/api/campaign/test', admin, h(async (req) => {
  const phone = require('./lib/store').normPhone(req.body.phone);
  if (!phone) throw new Error('Enter a valid Indian mobile number');
  const c = db.settings.campaign;
  const r2 = await myop.sendTemplate(phone, req.body.template || c.templateName, { headerMediaUrl: c.headerMediaUrl || undefined });
  logActivity(req.user.id, 'test_send', null, `Test template "${req.body.template || c.templateName}" to +${phone}`);
  return { ok: true, messageId: r2.messageId, dryRun: myop.DRY_RUN };
}));
// The next personal follow-ups exactly as they would be sent (nothing is sent)
r.post('/api/campaign/preview', admin, h(async (req) => {
  const brand = brandOf(req) || 'rentmysite';
  const n = Math.min(Number(req.body.count) || 5, 10);
  const pool = Object.values(db.leads).filter((l) => l.brand === brand && ['queued', 'none'].includes(l.campaign?.state || 'none') && !leadsLib.skipReason(l))
    .sort((a, b) => (a.campaign?.state === 'queued' ? 0 : 1) - (b.campaign?.state === 'queued' ? 0 : 1));
  const out = [];
  for (const l of pool.slice(0, n)) {
    try {
      const f = await require('./lib/followup').build(l);
      out.push({ name: l.name, phone: l.phone, kind: f.kind, template: f.template, text: f.text });
    } catch (e) {
      out.push({ name: l.name, phone: l.phone, error: e.message });
    }
  }
  save();
  return out;
}));
// Autopilot: personal follow-ups, N a day between 10:00 and 19:00, starting as soon as Meta approves the templates
r.post('/api/campaign/autopilot', admin, h(async (req) => {
  const c = db.settings.campaign;
  const perDay = Math.min(Math.max(Number(req.body.perDay) || 100, 10), 250);
  Object.assign(c, { mode: 'personal', dailyCap: perDay, startHour: 10, endHour: 19, gapSec: Math.max(60, Math.floor((9 * 3600) / perDay)), autopilot: true, autopilotBrand: brandOf(req) || 'rentmysite' });
  db.campaignPausedReason = '';
  const templatesResult = await require('./lib/followup').createTemplates();
  await engine.autopilotTick();
  return { templates: templatesResult, perDay, gapSec: c.gapSec, status: db.autopilotStatus, running: db.campaignRunning };
}));
// Clients who were sent the office location: list them (send=false) or send the "upload first" correction
r.post('/api/ai/location-fix', admin, h(async (req) => ({ rows: await engine.locationFix(Boolean(req.body.send)) })));
r.post('/api/campaign/autopilot/stop', admin, h(() => {
  db.settings.campaign.autopilot = false;
  db.autopilotStatus = 'off';
  engine.setCampaignRunning(false);
  return { ok: true };
}));
r.post('/api/templates/followups', admin, h(() => require('./lib/followup').createTemplates()));
r.post('/api/campaign/clear', admin, h(() => {
  let n = 0;
  for (const l of Object.values(db.leads)) if (l.campaign?.state === 'queued') (l.campaign = { state: 'none' }), n++;
  save();
  return { cleared: n };
}));
r.post('/api/campaign/:action', admin, h((req) => {
  if (req.params.action === 'start' && !db.settings.waPhoneNumberId && !myop.DRY_RUN) throw new Error('WhatsApp number id not known yet: set the MyOperator webhook first and let one customer message come in, or enter it in Settings');
  engine.setCampaignRunning(req.params.action === 'start');
}));

r.post('/api/settings', admin, h((req) => {
  const s = req.body;
  for (const k of ['campaign', 'reminders', 'ai', 'staffAlert']) if (s[k] && typeof s[k] === 'object') Object.assign(db.settings[k], s[k]);
  for (const k of ['waPhoneNumberId', 'waNumberLabel', 'defaultBrand']) if (typeof s[k] === 'string') db.settings[k] = s[k].trim();
  save();
}));

r.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
// The dashboard is one HTML file: never let browsers keep an old copy after an update.
r.use(express.static(path.join(__dirname, 'public'), { setHeaders: (res) => res.setHeader('Cache-Control', 'no-store') }));
app.use(BASE || '/', r);
if (BASE) app.get('/', (req, res) => res.redirect(BASE + '/'));

const PORT = Number(process.env.PORT || 4100);
app.listen(PORT, '127.0.0.1', () => {
  console.log(`Govianu Hub on http://localhost:${PORT}${BASE}/ ${myop.DRY_RUN ? '(MYOP_DRY_RUN – nothing is sent to MyOperator)' : ''}`);
  engine.startEngine();
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => (flush(), process.exit(0)));
