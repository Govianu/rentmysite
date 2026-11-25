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

module.exports = { overview, team, employeeTimeline, rangeStart };
