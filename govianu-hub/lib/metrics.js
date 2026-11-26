// Per-brand overview and per-employee performance numbers.
const { db, now } = require('./store');

const DAY = 86400_000;
function rangeStart(range) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (range === 'today') return d.getTime();
  if (range === '7d') return d.getTime() - 6 * DAY;
  if (range === '30d') return d.getTime() - 29 * DAY;
  return 0;
}

const inBrand = (brand) => (x) => !brand || x.brand === brand;

// employeeId set = that person's own view: their leads, their calls, their customers waiting
function overview(brand, range = 'today', employeeId = null) {
  const from = rangeStart(range);
  const mine = (phone) => !employeeId || db.leads[phone]?.assignedTo === employeeId;
  const leads = Object.values(db.leads).filter(inBrand(brand)).filter((l) => !employeeId || l.assignedTo === employeeId);
  const msgs = db.messages.filter((m) => !m.internal && m.at >= from && inBrand(brand)(m) && mine(m.phone));
  const calls = Object.values(db.calls).filter((c) => (c.startedAt || c.createdAt) >= from && inBrand(brand)(c) && (!employeeId || c.employeeId === employeeId || mine(c.phone)));
  const stages = {};
  for (const l of leads) stages[l.stage] = (stages[l.stage] || 0) + 1;
  return {
    leads: leads.length,
    newLeads: leads.filter((l) => l.createdAt >= from).length,
    unassigned: leads.filter((l) => !l.assignedTo).length,
    stages,
    inbound: msgs.filter((m) => m.dir === 'in').length,
    outbound: msgs.filter((m) => m.dir === 'out' && m.channel !== 'email').length,
    emails: msgs.filter((m) => m.channel === 'email').length,
    aiReplies: msgs.filter((m) => m.by === 'ai').length,
    calls: calls.length,
    callsConnected: calls.filter((c) => c.status === 'bridged').length,
    callsMissed: calls.filter((c) => c.status && c.status !== 'bridged').length,
    openNow: Object.values(db.pending).filter((p) => p.status === 'open' && inBrand(brand)(p) && mine(p.phone)).length,
    campaign: {
      queued: leads.filter((l) => l.campaign?.state === 'queued').length,
      sent: leads.filter((l) => ['sent', 'replied'].includes(l.campaign?.state)).length,
      replied: leads.filter((l) => l.campaign?.state === 'replied').length,
      failed: leads.filter((l) => l.campaign?.state === 'failed').length,
    },
  };
}

function team(brand, range = 'today') {
  const from = rangeStart(range);
  const leads = Object.values(db.leads).filter(inBrand(brand));
  const calls = Object.values(db.calls).filter((c) => (c.startedAt || c.createdAt) >= from && inBrand(brand)(c));
  const msgs = db.messages.filter((m) => !m.internal && m.dir === 'out' && m.at >= from && inBrand(brand)(m));
  const acts = db.activity.filter((a) => a.at >= from && inBrand(brand)(a));
  const pend = Object.values(db.pending).filter((p) => p.status === 'open' && inBrand(brand)(p));

  const rows = db.employees
    .filter((e) => e.active !== false && (!brand || (e.brands || []).includes(brand)))
    .map((e) => {
      const mine = leads.filter((l) => l.assignedTo === e.id);
      const myCalls = calls.filter((c) => c.employeeId === e.id);
      const replies = acts.filter((a) => a.employeeId === e.id && a.type === 'replied' && a.responseMs != null);
      const touchedPhones = new Set([...myCalls.map((c) => c.phone), ...msgs.filter((m) => m.by === e.id).map((m) => m.phone)]);
      return {
        id: e.id,
        name: e.name,
        email: e.email,
        role: e.role,
        mapped: Boolean(e.myopUserId),
        assigned: mine.length,
        untouched: mine.filter((l) => l.stage === 'new').length,
        contactedInRange: touchedPhones.size,
        contactedFirst: leads.filter((l) => l.contactedBy === e.id && (l.contactedAt || 0) >= from).length,
        callsOut: myCalls.filter((c) => c.direction === 'outgoing').length,
        callsIn: myCalls.filter((c) => c.direction !== 'outgoing').length,
        connected: myCalls.filter((c) => c.status === 'bridged').length,
        talkSec: myCalls.reduce((s, c) => s + (Number(c.talk) || 0), 0),
        missedAssigned: calls.filter((c) => c.direction !== 'outgoing' && c.status !== 'bridged' && db.leads[c.phone]?.assignedTo === e.id).length,
        waSent: msgs.filter((m) => m.by === e.id && m.channel !== 'email').length,
        emailsSent: msgs.filter((m) => m.by === e.id && m.channel === 'email').length,
        replied: replies.length,
        avgResponseMin: replies.length ? Math.round(replies.reduce((s, a) => s + a.responseMs, 0) / replies.length / 60000) : null,
        waitingNow: pend.filter((p) => (db.leads[p.phone]?.assignedTo || p.assignedTo) === e.id).length,
        qualified: mine.filter((l) => ['qualified', 'meeting', 'cta_sent', 'signed'].includes(l.stage)).length,
        signed: mine.filter((l) => l.stage === 'signed').length,
      };
    });
  const unattributed = {
    callsNoAgent: calls.filter((c) => !c.employeeId && c.status === 'bridged').length,
    waFromUnmappedPanelUsers: msgs.filter((m) => String(m.by).startsWith('myop:')).length,
  };
  return { rows, unattributed, unmappedAgents: db.unmappedAgents };
}

function employeeTimeline(employeeId, limit = 200) {
  return db.activity
    .filter((a) => a.employeeId === employeeId)
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);
}

// Where a lead first came from
function origin(lead) {
  const s = String(lead.source || '').toLowerCase();
  if (s.startsWith('site')) return 'Website';
  if (s === 'whatsapp') return 'WhatsApp';
  if (s === 'call') return 'Call';
  if (s === 'email') return 'Email';
  if (!s) {
    // Leads from before sources were recorded: judge by how they first reached us
    if (lead.lastInboundAt) return 'WhatsApp';
    if (lead.lastCallAt || Object.values(db.calls).some((c) => c.phone === lead.phone)) return 'Call';
  }
  return 'Sheet / ads';
}
const ORIGINS = ['Website', 'WhatsApp', 'Call', 'Email', 'Sheet / ads'];

// Both websites together: every lead, where they came from, and today's (or the period's) activity
function overviewAll(range = 'today') {
  const from = rangeStart(range);
  const leads = Object.values(db.leads);
  const count = (list, key) => list.reduce((m, x) => ((m[key(x)] = (m[key(x)] || 0) + 1), m), {});
  const msgs = db.messages.filter((m) => !m.internal && m.at >= from);
  const calls = Object.values(db.calls).filter((c) => (c.startedAt || c.createdAt) >= from);
  const fresh = leads.filter((l) => l.createdAt >= from);
  return {
    origins: ORIGINS,
    total: leads.length,
    byBrand: count(leads, (l) => l.brand),
    byOrigin: count(leads, origin),
    newInPeriod: fresh.length,
    newByOrigin: count(fresh, origin),
    byStage: count(leads, (l) => l.stage),
    notContacted: leads.filter((l) => !l.contactedBy && l.stage === 'new').length,
    waIn: msgs.filter((m) => m.dir === 'in').length,
    waOut: msgs.filter((m) => m.dir === 'out' && m.channel !== 'email').length,
    aiReplies: msgs.filter((m) => m.by === 'ai').length,
    emails: msgs.filter((m) => m.channel === 'email').length,
    calls: calls.length,
    callsConnected: calls.filter((c) => c.status === 'bridged').length,
    callsMissed: calls.filter((c) => c.status && c.status !== 'bridged').length,
    waitingNow: Object.values(db.pending).filter((p) => p.status === 'open').length,
  };
}

// Per-employee report for one website (lead-CRM style): leads by stage, calls attended / missed,
// WhatsApp messages attended / missed, response time, results.
function report(brand, range = 'today') {
  const from = rangeStart(range);
  const late = (db.settings.reminders?.firstAfterMin || 10) * 60000;
  const leads = Object.values(db.leads).filter(inBrand(brand));
  const calls = Object.values(db.calls).filter((c) => (c.startedAt || c.createdAt) >= from && inBrand(brand)(c));
  const msgs = db.messages.filter((m) => !m.internal && m.dir === 'out' && m.at >= from && inBrand(brand)(m));
  const episodes = (db.pendingLog || []).filter((p) => p.firstAt >= from && inBrand(brand)(p) && p.kind === 'message');
  const openNow = Object.values(db.pending).filter((p) => p.status === 'open' && inBrand(brand)(p));
  const acts = db.activity.filter((a) => inBrand(brand)(a));

  const rows = db.employees
    .filter((e) => e.active !== false && (!brand || (e.brands || []).includes(brand)))
    .map((e) => {
      const mine = leads.filter((l) => l.assignedTo === e.id);
      const stages = {};
      for (const l of mine) stages[l.stage] = (stages[l.stage] || 0) + 1;
      const answered = calls.filter((c) => c.employeeId === e.id && c.status === 'bridged');
      const missedCalls = calls.filter((c) => (c.missedByIds || []).includes(e.id) || (!c.missedByIds && (c.missedBy || []).includes(e.name)));
      const attended = episodes.filter((p) => p.resolvedBy === e.id);
      const missedMsgs = episodes.filter((p) => p.assignedTo === e.id && (p.resolvedBy !== e.id || p.escalated)).length
        + openNow.filter((p) => p.kind === 'message' && (db.leads[p.phone]?.assignedTo || p.assignedTo) === e.id && Date.now() - p.firstAt >= late).length;
      const last = acts.filter((a) => a.employeeId === e.id).reduce((m, a) => Math.max(m, a.at), 0);
      return {
        id: e.id,
        name: e.name,
        email: e.email,
        linked: Boolean(e.myopUserId),
        totalLeads: mine.length,
        newLeads: mine.filter((l) => l.createdAt >= from).length,
        notContacted: mine.filter((l) => !l.contactedBy && l.stage === 'new').length,
        contactedFirst: leads.filter((l) => l.contactedBy === e.id && (l.contactedAt || 0) >= from).length,
        stages,
        callsAttended: answered.length,
        callsMissed: missedCalls.length,
        callsOut: calls.filter((c) => c.employeeId === e.id && c.direction === 'outgoing').length,
        talkSec: calls.filter((c) => c.employeeId === e.id).reduce((s, c) => s + (Number(c.talk) || 0), 0),
        msgsAttended: attended.length,
        msgsMissed: missedMsgs,
        waSent: msgs.filter((m) => m.by === e.id && m.channel !== 'email').length,
        emailsSent: msgs.filter((m) => m.by === e.id && m.channel === 'email').length,
        avgReplyMin: attended.length ? Math.round(attended.reduce((s, p) => s + (p.resolvedAt - p.firstAt), 0) / attended.length / 60000) : null,
        waitingNow: openNow.filter((p) => (db.leads[p.phone]?.assignedTo || p.assignedTo) === e.id).length,
        lastActivityAt: last || null,
      };
    });

  const sum = (k) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const totals = Object.fromEntries(['totalLeads', 'newLeads', 'notContacted', 'contactedFirst', 'callsAttended', 'callsMissed', 'callsOut', 'talkSec', 'msgsAttended', 'msgsMissed', 'waSent', 'emailsSent', 'waitingNow'].map((k) => [k, sum(k)]));
  totals.stages = {};
  for (const l of leads) totals.stages[l.stage] = (totals.stages[l.stage] || 0) + 1;
  totals.unassigned = leads.filter((l) => !l.assignedTo).length;
  totals.allLeads = leads.length;
  totals.callsNotAnsweredByAnyone = calls.filter((c) => c.status && c.status !== 'bridged').length;
  totals.aiReplies = db.messages.filter((m) => m.by === 'ai' && m.at >= from && inBrand(brand)(m)).length;
  return { rows, totals };
}

// Every lead activity, newest first
function activityFeed(brand, limit = 100, employeeId = null) {
  return db.activity
    .filter((a) => inBrand(brand)(a) && (!employeeId || a.employeeId === employeeId))
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);
}

module.exports = { overview, team, employeeTimeline, rangeStart, overviewAll, report, activityFeed, origin };
