const { db, save, normPhone, fill, uid, now, employee, logActivity, notify } = require('./store');
const myop = require('./myop');
const { draftReply, aiConfigured } = require('./ai');
const { sendMail, mailConfigured } = require('./mail');
const { upsertLead, autoAssign, skipReason } = require('./leads');

const MIN = 60_000;
const HUMAN = (by) => by && !['ai', 'campaign', 'api', 'myop-campaign', 'unknown', 'system'].includes(by);
const fmtPhone = (p) => (p ? `+${p}` : '');

function employeePhones() {
  return new Set(db.employees.map((e) => normPhone(e.phone)).filter(Boolean));
}
// Shared logins (e.g. support@) never get leads assigned and don't receive customer alerts.
const SHARED = (process.env.TEAM_EXCLUDE_EMAILS ?? 'support@govianu.com').toLowerCase().split(',').map((x) => x.trim()).filter(Boolean);
const isShared = (e) => !e || SHARED.includes(String(e.email).toLowerCase());
// Everyone who should hear about an unanswered customer of this business
function alertTeam(brand) {
  return db.employees.filter((e) => e.active !== false && !isShared(e) && (!brand || (e.brands || []).includes(brand)));
}
function admins() {
  return db.employees.filter((e) => e.role === 'admin' && e.active !== false);
}
function byMyopUser(userId) {
  return userId ? db.employees.find((e) => e.myopUserId && e.myopUserId === userId) || null : null;
}
function trackUnmapped(userId, info = {}) {
  if (!userId) return;
  const u = (db.unmappedAgents[userId] ||= { name: '', email: '', count: 0 });
  Object.assign(u, Object.fromEntries(Object.entries(info).filter(([, v]) => v)));
  u.count++;
  u.lastAt = now();
}
// Record which team member contacted the lead: the first one stays as "contacted by", the latest as "last contact".
function markContact(lead, empId, how, at = now()) {
  if (!lead || !empId || !employee(empId)) return;
  // shared logins (support@) are recorded as "last contact" but never as "contacted by" or "assigned to"
  if (!lead.contactedBy && !isShared(employee(empId))) {
    lead.contactedBy = empId;
    lead.contactedAt = at;
    lead.contactedHow = how;
    logActivity(empId, 'contacted', lead, `Contacted ${lead.name || fmtPhone(lead.phone)} first (${how})`);
  }
  const emp = employee(empId);
  if (!isShared(emp) && lead.assignedBy !== 'manual' && lead.assignedBy !== 'first-contact') {
    lead.assignedTo = empId;
    lead.assignedBy = 'first-contact';
    logActivity(empId, 'assigned', lead, `Assigned to ${emp.name} (replied first)`);
  }
  lead.lastContactBy = empId;
  lead.lastContactAt = at;
  lead.lastContactHow = how;
  advance(lead, 'contacted');
}

const advance = (lead, to) => {
  const order = ['new', 'contacted', 'replied', 'qualified', 'meeting', 'cta_sent', 'signed'];
  if (lead.stage === 'lost') return;
  if (order.indexOf(to) > order.indexOf(lead.stage)) lead.stage = to;
};

// ───────────────────────── staff alerts ─────────────────────────
const HUB_URL = () => (process.env.APP_URL || 'https://hub.govianu.com').replace(/\/$/, '');
async function alertEmployee(emp, text, phone, { email = false } = {}) {
  if (!emp) return;
  notify(emp.id, text, phone);
  // On the phone the alert opens the lead itself (or the "waiting for reply" list for a reminder about several)
  text = `${text}\n\n👉 Open: ${HUB_URL()}/#/${phone ? `lead/${phone}` : 'waiting'}`;
  const p = normPhone(emp.phone);
  if (p && myop.configured()) {
    const { templateName, variable } = db.settings.staffAlert;
    try {
      const r = templateName
        ? await myop.sendTemplate(p, templateName, { body: { [variable || 'details']: text.slice(0, 900) } })
        : await myop.sendText(p, text);
      db.messages.push({ id: uid(), myopId: r.messageId, refId: r.refId, phone: p, dir: 'out', by: 'system', internal: true, text, at: now(), status: 'queued' });
    } catch (e) {
      console.error(`[alert] WhatsApp to ${emp.name} failed: ${e.message}`);
    }
  }
  if (email && mailConfigured()) await sendMail(emp.email, 'Govianu Hub alert', `${text}\n\n${process.env.APP_URL || ''}`).catch(() => {});
}

// ───────────────────────── pending (awaiting a human) ─────────────────────────
function openPending(lead, kind, text, at) {
  const p = db.pending[lead.phone];
  if (p && p.status === 'open') {
    p.lastAt = at;
    p.lastText = text;
    p.count++;
    if (kind === 'missed_call') p.kind = 'missed_call';
    return p;
  }
  return (db.pending[lead.phone] = {
    phone: lead.phone,
    brand: lead.brand,
    assignedTo: lead.assignedTo,
    kind,
    firstAt: at,
    lastAt: at,
    lastText: text,
    count: 1,
    remindersSent: 0,
    lastReminderAt: 0,
    escalated: false,
    status: 'open',
  });
}

function resolvePending(phone, byId, how) {
  const p = db.pending[phone];
  if (!p || p.status !== 'open') return;
  p.status = 'resolved';
  p.resolvedAt = now();
  p.resolvedBy = byId || null;
  p.how = how;
  p.assignedTo = db.leads[phone]?.assignedTo || p.assignedTo;
  db.pendingLog ||= [];
  db.pendingLog.push({ phone, brand: p.brand, assignedTo: p.assignedTo, kind: p.kind, firstAt: p.firstAt, resolvedAt: p.resolvedAt, resolvedBy: p.resolvedBy, how, escalated: p.escalated, remindersSent: p.remindersSent });
  if (db.pendingLog.length > 50000) db.pendingLog.splice(0, db.pendingLog.length - 50000);
  clearTimeout(aiTimers.get(phone));
  if (byId) logActivity(byId, 'replied', db.leads[phone], `Responded (${how}) after ${Math.round((p.resolvedAt - p.firstAt) / MIN)} min`, { responseMs: p.resolvedAt - p.firstAt });
  save();
}

// ───────────────────────── webhook: entry ─────────────────────────
async function handleWebhook(ev) {
  if (!ev || typeof ev !== 'object' || !ev.event_type) return;
  if (ev.event_id) {
    if (db.seenEvents.includes(ev.event_id)) return;
    db.seenEvents.push(ev.event_id);
  }
  const t = String(ev.event_type);
  if (String(ev.channel).toLowerCase() === 'whatsapp' || t.startsWith('message.') || t.startsWith('conversation.')) await handleWhatsApp(ev);
  else await handleCall(ev);
  save();
}

function textOf(data) {
  if (!data) return '';
  const c = data.context || {};
  if (data.type === 'text') return c.body || '';
  if (data.type === 'template') return `[template] ${c.template_name || ''}`.trim();
  if (c.caption) return `${c.caption} [${data.type}]`;
  if (c.body) return c.body;
  return `[${data.type || 'message'}]`;
}

// ───────────────────────── WhatsApp events ─────────────────────────
async function handleWhatsApp(ev) {
  const p = ev.payload || {};
  const conv = p.conversation || {};
  const phone = normPhone(ev.customer_identifier || `${conv.customer_country_code || ''}${conv.customer_contact || ''}`);
  if (!db.settings.waPhoneNumberId && (p.phone_number_id || ev.system_identifier)) {
    db.settings.waPhoneNumberId = String(p.phone_number_id || ev.system_identifier);
    console.log(`[myop] learned WhatsApp phone_number_id ${db.settings.waPhoneNumberId}`);
  }
  if (!phone) return;
  const isStaff = employeePhones().has(phone);
  const find = () => db.messages.find((m) => (p.id && m.myopId === p.id) || (p.metadata?.myop_ref_id && m.refId === p.metadata.myop_ref_id));

  switch (ev.event_type) {
    case 'message.received': {
      if (isStaff) return; // staff replying to an alert
      const text = textOf(p.data);
      const at = Date.parse(p.created || ev.timestamp) || now();
      const { lead } = upsertLead(phone, { name: conv.customer_name, source: db.leads[phone] ? undefined : 'WhatsApp' });
      autoAssign(lead);
      lead.lastInboundAt = at;
      lead.waWindowUntil = Date.parse(conv.expire_at) || at + 24 * 60 * MIN;
      lead.myopConversationId = conv.id || lead.myopConversationId;
      advance(lead, 'replied');
      if (lead.campaign?.state === 'sent') lead.campaign.state = 'replied';
      db.messages.push({ id: uid(), myopId: p.id, phone, brand: lead.brand, dir: 'in', by: 'customer', text, at, status: 'received' });
      const pend = openPending(lead, 'message', text, at);
      const emp = employee(lead.assignedTo);
      if (pend.count === 1) {
        const who = emp && !isShared(emp) ? [emp] : alertTeam(lead.brand);
        const head = emp && !isShared(emp) ? '💬' : '💬 NEW – first to reply gets this lead:';
        for (const e of who) await alertEmployee(e, `${head} ${lead.name || fmtPhone(phone)} messaged on WhatsApp (${lead.brand}): "${text.slice(0, 120)}"`, phone);
      }
      scheduleAi(phone);
      return;
    }
    case 'message.sent': {
      const mine = find();
      if (mine) {
        mine.status = 'sent';
        mine.myopId ||= p.id;
        return;
      }
      if (isStaff) return;
      // Sent outside the Hub: MyOperator chat panel ("lc"), MyOperator campaign ("cmp") or another API client.
      const emp = p.source === 'lc' ? byMyopUser(p.message_by) : null;
      if (p.source === 'lc' && !emp) trackUnmapped(p.message_by);
      const by = emp ? emp.id : p.source === 'cmp' ? 'myop-campaign' : p.source === 'lc' ? `myop:${p.message_by || '?'}` : 'api';
      const { lead } = upsertLead(phone, { name: conv.customer_name, source: db.leads[phone] ? undefined : 'WhatsApp' });
      autoAssign(lead);
      const text = textOf(p.data);
      db.messages.push({ id: uid(), myopId: p.id, phone, brand: lead.brand, dir: 'out', by, via: 'myoperator', text, at: Date.parse(p.created || ev.timestamp) || now(), status: 'sent' });
      lead.lastOutboundAt = now();
      advance(lead, 'contacted');
      if (emp) {
        logActivity(emp.id, 'wa_sent', lead, `WhatsApp (MyOperator panel): ${text.slice(0, 80)}`);
        markContact(lead, emp.id, 'WhatsApp');
        humanTookOver(lead, emp.id);
        resolvePending(phone, emp.id, 'WhatsApp');
      } else if (p.source === 'lc') {
        resolvePending(phone, null, 'WhatsApp from MyOperator panel (user not mapped)');
        humanTookOver(lead, null);
        if (db.pending[phone]) db.pending[phone].myopUser = p.message_by;
      }
      return;
    }
    case 'message.delivered':
    case 'message.read':
    case 'message.failed': {
      const m = find();
      if (m) {
        m.status = ev.event_type.split('.')[1];
        if (m.status === 'failed') m.error = JSON.stringify(p.metadata?.errors || {}).slice(0, 300);
        const lead = db.leads[phone];
        if (m.status === 'failed' && lead && m.by === 'campaign') lead.campaign = { ...lead.campaign, state: 'failed', error: m.error };
      }
      return;
    }
    case 'conversation.assign': {
      const emp = byMyopUser(p.activity?.action_to || conv.assigned_to);
      const lead = db.leads[phone];
      if (emp && lead && lead.assignedTo !== emp.id) {
        lead.assignedTo = emp.id;
        logActivity(emp.id, 'assigned', lead, 'Assigned in MyOperator');
      }
      return;
    }
    default:
      return;
  }
}

// Credit everything a MyOperator user did before they were linked to an employee.
function linkMyopUser(emp, userId) {
  if (!emp || !userId) return;
  emp.myopUserId = userId;
  delete db.unmappedAgents[userId];
  for (const m of db.messages) {
    if (m.by !== `myop:${userId}`) continue;
    m.by = emp.id;
    logActivity(emp.id, 'wa_sent', db.leads[m.phone], `WhatsApp (MyOperator panel): ${String(m.text).slice(0, 80)}`);
    db.activity[db.activity.length - 1].at = m.at;
    markContact(db.leads[m.phone], emp.id, 'WhatsApp', m.at);
  }
  for (const p of Object.values(db.pending)) if (p.how === 'WhatsApp from MyOperator panel (user not mapped)' && p.myopUser === userId) p.resolvedBy = emp.id;
  save();
}

// ───────────────────────── call events ─────────────────────────
function agentToEmployee(agent) {
  if (!agent) return null;
  let emp = byMyopUser(agent.uuid);
  if (!emp && agent.email) {
    emp = db.employees.find((e) => e.email.toLowerCase() === String(agent.email).toLowerCase()) || null;
    if (emp && agent.uuid && !emp.myopUserId) linkMyopUser(emp, agent.uuid); // auto-link by email
  }
  if (!emp && agent.contact) {
    const p = normPhone(agent.contact);
    emp = db.employees.find((e) => normPhone(e.phone) === p) || null;
    if (emp && agent.uuid && !emp.myopUserId) linkMyopUser(emp, agent.uuid);
  }
  // Not known yet: add the MyOperator agent as a team member (name, email and phone from MyOperator), so their
  // calls are credited, the lead is assigned to them and alerts reach their phone. Their own sign-in joins this
  // record later (same email, or same first name – see lib/auth.js).
  if (!emp && agent.uuid && agent.name) {
    emp = {
      id: uid(),
      email: String(agent.email || `myop-${agent.uuid}@myoperator.local`).toLowerCase(),
      name: String(agent.name).trim(),
      role: 'employee',
      phone: normPhone(agent.contact) || '',
      myopUserId: agent.uuid,
      brands: ['rentmysite', 'pmb'],
      active: true,
      source: 'myoperator',
      createdAt: now(),
    };
    db.employees.push(emp);
    delete db.unmappedAgents[agent.uuid];
    console.log(`[hub] added MyOperator agent ${emp.name} as a team member`);
  }
  if (emp && !emp.phone && agent.contact) emp.phone = normPhone(agent.contact) || '';
  if (!emp) trackUnmapped(agent.uuid, { name: agent.name, email: agent.email });
  return emp;
}

// Calls that came in before their agent was known: credit them now and assign the lead (first contact)
function backfillAgents() {
  let n = 0;
  for (const c of Object.values(db.calls)) {
    if (c.employeeId || !c.legs) continue;
    const agents = c.legs.filter((l) => l.type === 'agent');
    const answered = agents.find((l) => l.result === 'answered') || (c.direction === 'outgoing' ? agents[0] : null);
    const emp = answered?.agent ? agentToEmployee(answered.agent) : null;
    if (!emp) continue;
    c.employeeId = emp.id;
    for (const a of db.activity) if (a.callId === c.id && !a.employeeId) a.employeeId = emp.id;
    const lead = db.leads[c.phone];
    if (lead && (c.direction === 'outgoing' || c.status === 'bridged')) markContact(lead, emp.id, c.direction === 'outgoing' ? 'call' : 'answered call', c.startedAt || c.createdAt);
    n++;
  }
  for (const c of Object.values(db.calls)) {
    if (!c.legs || c.missedByIds?.length) continue;
    const ids = c.legs.filter((l) => l.type === 'agent' && l.result !== 'answered' && l.agent).map((l) => agentToEmployee(l.agent)?.id).filter((x) => x && x !== c.employeeId);
    if (ids.length) c.missedByIds = [...new Set(ids)];
  }
  if (n) console.log(`[hub] credited ${n} earlier calls to their agents`);
  save();
}

const finalizeTimers = new Map();

async function handleCall(ev) {
  const p = ev.payload || {};
  const sid = ev.session_id || p.id;
  if (!sid) return;
  const phone = normPhone(p.customer_number || ev.customer_identifier);
  if (phone && employeePhones().has(phone)) return;
  const c = (db.calls[sid] ||= { id: sid, phone, createdAt: now(), events: [] });
  c.phone ||= phone;
  c.events.push(ev.event_type);
  for (const k of ['direction', 'status', 'category', 'duration', 'recording_filename', 'location']) if (p[k] != null && p[k] !== '') c[k] = p[k];
  c.direction ||= ev.direction;
  if (p.started_at) c.startedAt = Date.parse(p.started_at);
  if (p.ended_at) c.endedAt = Date.parse(p.ended_at);
  if (ev.system_identifier) c.did = ev.system_identifier;
  if (Array.isArray(p.legs)) {
    c.legs = p.legs.map((l) => ({ type: l.type, result: l.result, dial: l.dial_status, talk: l.talk_duration, ring: l.ring_duration, agent: l.agent || null, phone: l.phone_number }));
  }
  if (ev.event_type === 'disposition' || ev.event_type === 'call.disposition') {
    c.dispositions = p.dispositions || [];
    c.comments = p.comments || c.comments;
  }
  if (p.comments?.length) c.comments = p.comments;

  if (ev.event_type === 'call.summary') {
    clearTimeout(finalizeTimers.get(sid));
    await finalizeCall(c);
  } else if (ev.event_type === 'call.end') {
    // call.summary normally follows; finalize anyway if it never arrives
    clearTimeout(finalizeTimers.get(sid));
    finalizeTimers.set(sid, setTimeout(() => finalizeCall(c).then(save).catch((e) => console.error('[call]', e.message)), 3 * MIN));
  }
}

async function finalizeCall(c) {
  if (c.finalized || !c.phone) return;
  c.finalized = true;
  const legs = c.legs || [];
  const agents = legs.filter((l) => l.type === 'agent');
  const answered = agents.find((l) => l.result === 'answered') || (c.direction === 'outgoing' ? agents[0] : null);
  const emp = answered ? agentToEmployee(answered.agent) : null;
  for (const l of agents) if (l !== answered && l.agent) agentToEmployee(l.agent); // record tried agents too
  c.employeeId = emp?.id || null;
  c.agentName = answered?.agent?.name || '';
  c.talk = answered?.talk || (c.status === 'bridged' ? c.duration : 0) || 0;
  c.missedBy = agents.filter((l) => l.result !== 'answered').map((l) => l.agent?.name).filter(Boolean);
  c.missedByIds = [...new Set(agents.filter((l) => l.result !== 'answered' && l !== answered).map((l) => agentToEmployee(l.agent)?.id).filter(Boolean))];

  const { lead } = upsertLead(c.phone, { source: db.leads[c.phone] ? undefined : 'Call' });
  autoAssign(lead);
  c.brand = lead.brand;
  const connected = c.status === 'bridged';
  const out = c.direction === 'outgoing';
  logActivity(
    emp?.id,
    out ? 'call_out' : 'call_in',
    lead,
    `${out ? 'Called' : 'Incoming call from'} ${lead.name || fmtPhone(lead.phone)} – ${connected ? `${c.talk || c.duration}s talk` : c.status}`,
    { callId: c.id },
  );
  if (out) {
    lead.lastOutboundAt = now();
    advance(lead, 'contacted');
  }
  if (emp && (out || connected)) markContact(lead, emp.id, out ? (connected ? 'call' : 'call, not answered') : 'answered call', c.startedAt || now());
  if (connected) {
    lead.lastCallAt = now();
    if (emp) humanTookOver(lead, emp.id);
    resolvePending(lead.phone, emp?.id, out ? 'call' : 'answered call');
  } else if (!out) {
    openPending(lead, 'missed_call', `Missed call (${c.status})`, c.startedAt || now());
    await missedCallReply(lead).catch((e) => console.error('[missed-call reply]', lead.phone, e.message));
    const owner = employee(lead.assignedTo);
    for (const e of owner && !isShared(owner) ? [owner] : alertTeam(lead.brand)) await alertEmployee(e, `📞 Missed call from ${lead.name || fmtPhone(lead.phone)} (${lead.brand}). Please call back${owner && !isShared(owner) ? '' : ' – first to call gets this lead'}.`, lead.phone);
  }
}

// WhatsApp to a caller we missed: "busy right now, we will call you back as soon as possible".
// Free text inside the 24-hour window, otherwise the approved template. At most once per repeatAfterHours.
async function missedCallReply(lead) {
  const m = db.settings.missedCall || {};
  if (!m.enabled || !myop.configured()) return;
  if (lead.missedReplyAt && now() - lead.missedReplyAt < (m.repeatAfterHours || 6) * 60 * MIN) return;
  const first = String(lead.name || '').trim().split(/\s+/)[0];
  const name = first && /^[A-Za-z][A-Za-z.]{1,20}$/.test(first) ? first[0].toUpperCase() + first.slice(1).toLowerCase() : 'there';
  const text = String(m.text || '').replace(/^Hi,/, 'Hi {{name}},').replace(/\{\{name\}\}/g, name);
  if (windowOpen(lead) && text) {
    await hubSend(null, lead.phone, { text, by: 'ai' });
  } else if (m.template) {
    const { approvedNames } = require('./followup');
    if (!(await approvedNames().catch(() => new Set())).has(m.template)) {
      console.warn(`[missed-call reply] template ${m.template} not approved yet – skipped ${lead.phone}`);
      return;
    }
    await hubSend(null, lead.phone, { template: m.template, templateBody: { name }, shownText: text || `[template] ${m.template}`, by: 'ai' });
  } else return;
  lead.missedReplyAt = now();
  logActivity(null, 'ai_reply', lead, 'Missed call – sent "busy, will call back" WhatsApp');
  save();
}

// Clients the AI sent the office location to (before that was switched off): a correction asking them to upload
// their plot first. WhatsApp can't delete delivered messages, so this follows up instead. Text only works inside
// the 24-hour window; the others are listed for the team (or reached by the follow-up campaign).
function locationMessage(m) {
  const a = db.settings.ai || {};
  const t = String(m.text || '');
  return m.dir === 'out' && m.by === 'ai' && (/sadashiv/i.test(t) || (a.officeMap && t.includes(a.officeMap)) || /13th Cross|share\.google|office address/i.test(t));
}
async function locationFix(send) {
  const phones = [...new Set(db.messages.filter(locationMessage).map((m) => m.phone))];
  const out = [];
  for (const phone of phones) {
    const lead = db.leads[phone];
    if (!lead) continue;
    const row = { phone, name: lead.name || '', window: Boolean(windowOpen(lead)), done: Boolean(lead.locationFixAt), sent: false, error: '' };
    if (send && !row.done && row.window) {
      const first = String(lead.name || '').trim().split(/\s+/)[0];
      const hi = first && /^[A-Za-z]{2,20}$/.test(first) ? `Hi ${first[0].toUpperCase()}${first.slice(1).toLowerCase()},` : 'Hi,';
      const link = `${(db.settings.ai && db.settings.ai.plotFormUrl) || 'https://rentmysite.ai/list-plot'}?phone=${phone.slice(-10)}&src=wa`;
      const text = `${hi} a small correction to our earlier message: please ignore the office location we shared for now.

As the first step, please upload your plot details, photos and documents here (takes about 5 minutes):
${link}

Our team will review it and take it forward with you once it is approved.`;
      try {
        await hubSend(null, phone, { text, by: 'ai' });
        lead.locationFixAt = now();
        row.sent = true;
        logActivity(null, 'ai_reply', lead, 'Sent correction: ignore office location, upload the plot first');
      } catch (e) { row.error = e.message; }
    }
    out.push(row);
  }
  save();
  return out;
}

// ───────────────────────── sending from the Hub ─────────────────────────
function windowOpen(lead) {
  return lead?.waWindowUntil && lead.waWindowUntil > now();
}

async function hubSend(user, phone, { text, template, templateBody, headerMediaUrl, by, shownText }) {
  const lead = db.leads[phone];
  if (!lead) throw new Error('Unknown lead');
  let r;
  let shown;
  if (template) {
    r = await myop.sendTemplate(phone, template, { body: templateBody, headerMediaUrl });
    shown = shownText || `[template] ${template}`;
  } else {
    if (!windowOpen(lead)) throw new Error('24-hour WhatsApp window is closed for this contact – send an approved template instead');
    r = await myop.sendText(phone, text);
    shown = text;
  }
  const sender = by || user?.id || 'system';
  db.messages.push({ id: uid(), myopId: r.messageId, refId: r.refId, phone, brand: lead.brand, dir: 'out', by: sender, via: 'hub', text: shown, at: now(), status: 'queued' });
  lead.lastOutboundAt = now();
  advance(lead, 'contacted');
  if (HUMAN(sender)) {
    logActivity(sender, 'wa_sent', lead, `WhatsApp: ${shown.slice(0, 80)}`);
    markContact(lead, sender, 'WhatsApp');
    humanTookOver(lead, sender);
    resolvePending(phone, sender, 'WhatsApp');
  }
  save();
  return r;
}

// ───────────────────────── AI meanwhile-reply ─────────────────────────
const aiTimers = new Map();
function scheduleAi(phone) {
  if (!db.settings.ai.enabled || !aiConfigured()) return;
  clearTimeout(aiTimers.get(phone));
  aiTimers.set(phone, setTimeout(() => aiReply(phone).catch((e) => console.error('[ai]', e.message)), db.settings.ai.delaySec * 1000));
}

function humanTookOver(lead, empId) {
  if (!lead || lead.aiPaused) return;
  lead.aiPaused = true;
  lead.aiPausedAt = now();
  lead.aiPausedBy = empId || null;
  clearTimeout(aiTimers.get(lead.phone));
  logActivity(empId, 'ai_paused', lead, `AI stopped – ${employee(empId)?.name || 'a team member'} took over the chat`);
}

// Approved template texts, so the AI sees what our templates actually said (refreshed hourly)
const tplCache = { at: 0, bodies: {} };
async function templateBodies() {
  if (Date.now() - tplCache.at < 3600_000 || !myop.configured()) return tplCache.bodies;
  tplCache.at = Date.now();
  try {
    for (const t of await myop.listTemplates()) tplCache.bodies[t.name] = t.body;
  } catch (e) {
    console.warn('[ai] could not load templates:', e.message);
  }
  return tplCache.bodies;
}

const nameOfSender = (by) => {
  if (by === 'ai') return 'US (assistant)';
  if (by === 'campaign' || by === 'myop-campaign') return 'US (campaign message)';
  const e = employee(by);
  return e ? `US (${e.name})` : 'US';
};

async function aiReply(phone) {
  const pend = db.pending[phone];
  const lead = db.leads[phone];
  if (!pend || pend.status !== 'open' || !lead || !windowOpen(lead) || lead.aiPaused) return;
  const bodies = await templateBodies();
  const timeline = [
    ...db.messages.filter((m) => m.phone === phone && !m.internal).slice(-60).map((m) => {
      let text = m.text || '';
      const tpl = text.match(/^\[template\]\s*(\S+)/);
      if (tpl && bodies[tpl[1]]) text = `(template) ${bodies[tpl[1]]}`;
      if (m.channel === 'email') return { at: m.at, who: 'US (email)', text };
      return { at: m.at, who: m.dir === 'in' ? 'CUSTOMER' : nameOfSender(m.by), text };
    }),
    ...Object.values(db.calls).filter((c) => c.phone === phone).map((c) => ({
      at: c.startedAt || c.createdAt,
      who: 'CALL',
      text: `${c.direction === 'outgoing' ? 'We called them' : 'They called us'} – ${c.status === 'bridged' ? `talked ${c.talk || c.duration || 0}s with ${employee(c.employeeId)?.name || c.agentName || 'our team'}` : 'not answered'}`,
    })),
  ].sort((a, b) => a.at - b.at);
  const notes = (lead.notes || []).slice(-10).map((n) => ({ at: n.at, by: employee(n.by)?.name || 'team', text: n.text }));
  const out = await draftReply({ timeline, lead, notes });
  if (!out || db.pending[phone]?.status !== 'open' || lead.aiPaused) return;
  if (out.brand !== 'unknown' && !lead.brandLocked && lead.stage === 'replied' && !lead.campaign?.sentAt) lead.brand = out.brand;
  lead.aiSummary = out.summary;
  if (out.reply.trim() && out.stage !== 'no_reply_needed') {
    await hubSend(null, phone, { text: out.reply.trim(), by: 'ai' });
    pend.aiReplied = true;
  }
  if (out.stage === 'qualified' && !lead.aiQualifiedAlerted) {
    advance(lead, 'qualified');
    lead.aiQualifiedAlerted = true;
  }
  // the team hears about hot or tricky chats; the AI keeps the conversation going until someone takes over
  if ((out.stage === 'qualified' && lead.aiQualifiedAlerted === true && !lead.aiQualifiedSent) || out.stage === 'needs_human') {
    if (out.stage === 'qualified') lead.aiQualifiedSent = true;
    const owner = employee(lead.assignedTo);
    const msg = `${out.stage === 'qualified' ? '🔥 HOT LEAD' : '🙋 Wants a person'}: ${lead.name || fmtPhone(phone)} (${lead.brand})\n${out.summary}\nThe assistant is chatting with them – reply or call to take over.`;
    for (const e of owner && !isShared(owner) ? [owner] : alertTeam(lead.brand)) await alertEmployee(e, msg, phone, { email: true });
  }
  if (out.stage === 'not_interested') {
    lead.aiFlag = 'not_interested';
    resolvePending(phone, null, 'AI: not interested');
  }
  if (out.stage === 'no_reply_needed') resolvePending(phone, null, 'AI: no reply needed');
  save();
}

// ───────────────────────── reminders & escalation ─────────────────────────
async function reminderTick() {
  const r = db.settings.reminders;
  if (!r.enabled) return;
  const open = Object.values(db.pending).filter((p) => p.status === 'open');
  const overdue = open.filter((p) => now() - p.firstAt >= r.firstAfterMin * MIN);
  if (!overdue.length) return;

  // decide once per round which customers are due, so every recipient gets this round's reminder
  const dueNow = new Set(overdue.filter((p) => now() - (p.lastReminderAt || 0) >= r.repeatEveryMin * MIN));
  const byEmp = new Map();
  for (const p of overdue) {
    const lead = db.leads[p.phone];
    p.assignedTo = lead?.assignedTo || p.assignedTo;
    const owner = employee(p.assignedTo);
    const targets = owner && !isShared(owner) ? [owner.id] : alertTeam(p.brand).map((a) => a.id);
    for (const t of targets) {
      if (!byEmp.has(t)) byEmp.set(t, []);
      byEmp.get(t).push(p);
    }
  }
  for (const [empId, items] of byEmp) {
    if (!items.some((p) => dueNow.has(p))) continue;
    const lines = items
      .sort((a, b) => a.firstAt - b.firstAt)
      .slice(0, 15)
      .map((p, i) => {
        const l = db.leads[p.phone] || {};
        return `${i + 1}. ${l.name || fmtPhone(p.phone)} – ${p.kind === 'missed_call' ? 'missed call' : `"${(p.lastText || '').slice(0, 50)}"`} – ${Math.round((now() - p.firstAt) / MIN)} min`;
      });
    await alertEmployee(employee(empId), `⏰ ${items.length} customer(s) waiting for you:\n${lines.join('\n')}\nReply/call from the Hub or MyOperator.`, items.length === 1 ? items[0].phone : null);
  }
  for (const p of dueNow) {
    p.lastReminderAt = now();
    p.remindersSent++;
  }
  for (const p of overdue.filter((x) => !x.escalated && now() - x.firstAt >= r.escalateAfterMin * MIN)) {
    p.escalated = true;
    const l = db.leads[p.phone] || {};
    const who = employee(p.assignedTo)?.name || 'nobody';
    for (const a of alertTeam(p.brand)) if (a.id !== p.assignedTo) await alertEmployee(a, `🚨 Not attended for ${r.escalateAfterMin}+ min: ${l.name || fmtPhone(p.phone)} (${p.brand}) – assigned to ${who}. Anyone can reply.`, p.phone);
  }
  save();
}

// ───────────────────────── campaign ─────────────────────────
let nextSendAt = 0;
async function campaignTick() {
  const c = db.settings.campaign;
  if (!db.campaignRunning || now() < nextSendAt) return;
  const h = new Date().getHours();
  if (h < c.startHour || h >= c.endHour) return;
  const today = new Date().toISOString().slice(0, 10);
  if (db.sentToday.date !== today) db.sentToday = { date: today, count: 0 };
  if (db.sentToday.count >= c.dailyCap) return;
  const lead = Object.values(db.leads).find((l) => l.campaign?.state === 'queued');
  if (!lead) {
    db.campaignRunning = false;
    save();
    return;
  }
  nextSendAt = now() + c.gapSec * 1000;
  const why = skipReason(lead);
  if (why) {
    lead.campaign = { state: 'skipped', note: why };
    nextSendAt = now();
    return save();
  }
  try {
    let used = c.templateName;
    if (c.mode === 'personal') {
      const f = await require('./followup').build(lead);
      await hubSend(null, lead.phone, { template: f.template, templateBody: f.body, shownText: f.text, by: 'campaign' });
      used = `${f.template} (${f.kind})`;
    } else {
      await hubSend(null, lead.phone, { template: c.templateName, headerMediaUrl: c.headerMediaUrl || undefined, by: 'campaign' });
    }
    lead.campaign = { state: 'sent', sentAt: now(), template: used };
    db.sentToday.count++;
    failStreak = 0;
    if (lead.email && mailConfigured(lead.brand)) {
      const subject = fill(c.emailSubject, lead);
      await sendMail(lead.email, subject, fill(c.emailBody, lead), lead.brand)
        .then(() => {
          lead.campaign.emailedAt = now();
          db.messages.push({ id: uid(), phone: lead.phone, brand: lead.brand, channel: 'email', dir: 'out', by: 'campaign', text: `Email to ${lead.email}: ${subject}`, at: now(), status: 'sent' });
          logActivity(null, 'email_sent', lead, `Campaign email to ${lead.email}`);
        })
        .catch((e) => (lead.campaign.emailError = e.message));
    }
  } catch (e) {
    lead.campaign = { state: 'failed', error: e.message };
    failStreak++;
    // Something is wrong for everyone (number id, template, account): stop instead of failing the whole list.
    if (/phone_number_id/.test(e.message) || failStreak >= 3) {
      db.campaignRunning = false;
      db.campaignPausedReason = `Paused after ${failStreak} failed sends: ${e.message}`;
      for (const a of admins()) notify(a.id, `⚠️ Campaign paused – ${e.message}`);
    }
  }
  save();
}
let failStreak = 0;

// Leads contacted before "contacted by" existed: fill it in from the activity log.
function backfillContacts() {
  const kinds = { call_out: 'call', call_in: 'answered call', wa_sent: 'WhatsApp' };
  const acts = db.activity.filter((a) => a.employeeId && a.phone && kinds[a.type]).sort((a, b) => a.at - b.at);
  let n = 0;
  for (const a of acts) {
    const lead = db.leads[a.phone];
    if (!lead || (lead.contactedBy && lead.lastContactAt >= a.at)) continue;
    if (!lead.contactedBy) {
      Object.assign(lead, { contactedBy: a.employeeId, contactedAt: a.at, contactedHow: kinds[a.type] });
      n++;
    }
    Object.assign(lead, { lastContactBy: a.employeeId, lastContactAt: a.at, lastContactHow: kinds[a.type] });
  }
  if (n) {
    console.log(`[hub] filled in "contacted by" for ${n} earlier leads`);
    save();
  }
}

function syncSites() {
  const { syncFromSite } = require('./leads');
  for (const brand of ['rentmysite', 'pmb']) {
    try {
      const r = syncFromSite(brand);
      if (r.added) console.log(`[hub] ${r.added} new website leads from ${brand}`);
    } catch (e) {
      // data file not configured or not readable: skip quietly, it is logged once at start
      if (!syncSites.warned?.[brand]) {
        syncSites.warned = { ...(syncSites.warned || {}), [brand]: true };
        console.warn(`[hub] website sync ${brand}: ${e.message}`);
      }
    }
  }
}

function unassignAutoAssigned() {
  if (db.migratedFirstContact) return;
  let n = 0;
  for (const l of Object.values(db.leads)) {
    if (l.contactedBy || l.assignedBy || !l.assignedTo) continue;
    const src = String(l.source || '').toLowerCase();
    const fromSheet = src && !src.startsWith('site') && src !== 'whatsapp' && src !== 'call';
    if (!fromSheet || isShared(employee(l.assignedTo))) {
      l.assignedTo = null;
      n++;
    }
  }
  for (const l of Object.values(db.leads)) if (l.contactedBy && !l.assignedBy && !isShared(employee(l.contactedBy))) {
    l.assignedTo = l.contactedBy;
    l.assignedBy = 'first-contact';
  }
  db.migratedFirstContact = true;
  console.log(`[hub] first-reply assignment on: ${n} untouched leads unassigned`);
  save();
}

function startEngine() {
  backfillAgents();
  backfillContacts();
  unassignAutoAssigned();
  syncSites();
  setInterval(syncSites, 5 * 60_000);
  setInterval(() => campaignTick().catch((e) => console.error('[campaign]', e.message)), 1000);
  setInterval(() => reminderTick().catch((e) => console.error('[reminders]', e.message)), 60_000);
  setInterval(() => autopilotTick().catch((e) => console.error('[autopilot]', e.message)), 5 * 60_000);
  setInterval(() => require('./site').retryPendingWelcomes().catch((e) => console.error('[site]', e.message)), 10 * 60_000);
  setTimeout(() => autopilotTick().catch(() => {}), 15_000);
}

// Autopilot: once switched on, it waits for Meta to approve the follow-up templates, then queues every eligible
// lead of the business (including leads uploaded later) and keeps the campaign running within the daily limit.
async function autopilotTick() {
  const c = db.settings.campaign;
  if (!c.autopilot) return;
  if (db.campaignPausedReason) {
    db.autopilotStatus = `paused: ${db.campaignPausedReason}`;
    return save();
  }
  if (c.mode === 'personal') {
    const ok = await require('./followup').approvedNames().catch(() => new Set());
    const missing = [c.planTemplate, c.helloTemplate].filter((t) => !ok.has(t));
    if (missing.length) {
      db.autopilotStatus = `waiting for Meta to approve: ${missing.join(', ')}`;
      return save();
    }
  }
  let n = 0;
  for (const l of Object.values(db.leads)) {
    if (l.brand !== (c.autopilotBrand || 'rentmysite') || (l.campaign?.state || 'none') !== 'none' || skipReason(l)) continue;
    l.campaign = { state: 'queued' };
    n++;
  }
  const queued = Object.values(db.leads).filter((l) => l.campaign?.state === 'queued').length;
  if (queued && !db.campaignRunning) db.campaignRunning = true;
  db.autopilotStatus = queued ? `sending – ${queued} in the queue, up to ${c.dailyCap} a day (${c.startHour}:00–${c.endHour}:00)` : 'everyone has been messaged – new uploads are picked up automatically';
  if (n) console.log(`[autopilot] queued ${n} leads`);
  save();
}

function setCampaignRunning(on) {
  db.campaignRunning = Boolean(on);
  if (on) {
    failStreak = 0;
    db.campaignPausedReason = '';
  }
  save();
}

module.exports = { locationFix, autopilotTick, scheduleAi, setCampaignRunning, handleWebhook, hubSend, resolvePending, startEngine, windowOpen, reminderTick, linkMyopUser, HUMAN };
