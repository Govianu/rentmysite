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
const advance = (lead, to) => {
  const order = ['new', 'contacted', 'replied', 'qualified', 'meeting', 'cta_sent', 'signed'];
  if (lead.stage === 'lost') return;
  if (order.indexOf(to) > order.indexOf(lead.stage)) lead.stage = to;
};

// ───────────────────────── staff alerts ─────────────────────────
async function alertEmployee(emp, text, phone, { email = false } = {}) {
  if (!emp) return;
  notify(emp.id, text, phone);
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
      const { lead } = upsertLead(phone, { name: conv.customer_name });
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
        await alertEmployee(emp, `💬 ${lead.name || fmtPhone(phone)} messaged on WhatsApp (${lead.brand}): "${text.slice(0, 120)}"\nReply from the Hub.`, phone);
      }
      if (!emp) for (const a of admins()) notify(a.id, `Unassigned contact ${fmtPhone(phone)} messaged: "${text.slice(0, 80)}"`, phone);
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
      const { lead } = upsertLead(phone, { name: conv.customer_name });
      autoAssign(lead);
      const text = textOf(p.data);
      db.messages.push({ id: uid(), myopId: p.id, phone, brand: lead.brand, dir: 'out', by, via: 'myoperator', text, at: Date.parse(p.created || ev.timestamp) || now(), status: 'sent' });
      lead.lastOutboundAt = now();
      advance(lead, 'contacted');
      if (emp) {
        logActivity(emp.id, 'wa_sent', lead, `WhatsApp (MyOperator panel): ${text.slice(0, 80)}`);
        resolvePending(phone, emp.id, 'WhatsApp');
      } else if (p.source === 'lc') {
        resolvePending(phone, null, 'WhatsApp from MyOperator panel (user not mapped)');
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
  if (!emp) trackUnmapped(agent.uuid, { name: agent.name, email: agent.email });
  return emp;
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

  const { lead } = upsertLead(c.phone, {});
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
  if (connected) {
    lead.lastCallAt = now();
    resolvePending(lead.phone, emp?.id, out ? 'call' : 'answered call');
  } else if (!out) {
    openPending(lead, 'missed_call', `Missed call (${c.status})`, c.startedAt || now());
    await alertEmployee(employee(lead.assignedTo), `📞 Missed call from ${lead.name || fmtPhone(lead.phone)} (${lead.brand}). Please call back.`, lead.phone);
  }
}

// ───────────────────────── sending from the Hub ─────────────────────────
function windowOpen(lead) {
  return lead?.waWindowUntil && lead.waWindowUntil > now();
}

async function hubSend(user, phone, { text, template, templateBody, headerMediaUrl, by }) {
  const lead = db.leads[phone];
  if (!lead) throw new Error('Unknown lead');
  let r;
  let shown;
  if (template) {
    r = await myop.sendTemplate(phone, template, { body: templateBody, headerMediaUrl });
    shown = `[template] ${template}`;
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

async function aiReply(phone) {
  const pend = db.pending[phone];
  const lead = db.leads[phone];
  if (!pend || pend.status !== 'open' || !lead || !windowOpen(lead)) return;
  const history = db.messages.filter((m) => m.phone === phone && !m.internal).slice(-15);
  const out = await draftReply({ history, lead });
  if (!out || db.pending[phone]?.status !== 'open') return;
  if (out.brand !== 'unknown' && !lead.brandLocked && lead.stage === 'replied' && !lead.campaign?.sentAt) lead.brand = out.brand;
  lead.aiSummary = out.summary;
  if (out.reply.trim() && out.stage !== 'no_reply_needed') {
    await hubSend(null, phone, { text: out.reply.trim(), by: 'ai' });
    pend.aiReplied = true;
  }
  if (out.stage === 'qualified') advance(lead, 'qualified');
  if (out.stage === 'qualified' || out.stage === 'needs_human') {
    const msg = `${out.stage === 'qualified' ? '🔥 QUALIFIED' : '🙋 Needs you'}: ${lead.name || fmtPhone(phone)} (${lead.brand})\n${out.summary}\nCall them now.`;
    await alertEmployee(employee(lead.assignedTo), msg, phone, { email: true });
    for (const a of admins()) notify(a.id, msg, phone);
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

  const byEmp = new Map();
  for (const p of overdue) {
    const lead = db.leads[p.phone];
    p.assignedTo = lead?.assignedTo || p.assignedTo;
    const targets = p.assignedTo ? [p.assignedTo] : admins().map((a) => a.id);
    for (const t of targets) {
      if (!byEmp.has(t)) byEmp.set(t, []);
      byEmp.get(t).push(p);
    }
  }
  for (const [empId, items] of byEmp) {
    const due = items.filter((p) => now() - (p.lastReminderAt || 0) >= r.repeatEveryMin * MIN);
    if (!due.length) continue;
    const lines = items
      .sort((a, b) => a.firstAt - b.firstAt)
      .slice(0, 15)
      .map((p, i) => {
        const l = db.leads[p.phone] || {};
        return `${i + 1}. ${l.name || fmtPhone(p.phone)} – ${p.kind === 'missed_call' ? 'missed call' : `"${(p.lastText || '').slice(0, 50)}"`} – ${Math.round((now() - p.firstAt) / MIN)} min`;
      });
    await alertEmployee(employee(empId), `⏰ ${items.length} customer(s) waiting for you:\n${lines.join('\n')}\nReply/call from the Hub or MyOperator.`, null);
    for (const p of due) {
      p.lastReminderAt = now();
      p.remindersSent++;
    }
  }
  for (const p of overdue.filter((x) => !x.escalated && now() - x.firstAt >= r.escalateAfterMin * MIN)) {
    p.escalated = true;
    const l = db.leads[p.phone] || {};
    const who = employee(p.assignedTo)?.name || 'nobody';
    for (const a of admins()) await alertEmployee(a, `🚨 Not attended for ${r.escalateAfterMin}+ min: ${l.name || fmtPhone(p.phone)} (${p.brand}) – assigned to ${who}.`, p.phone);
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
    await hubSend(null, lead.phone, { template: c.templateName, headerMediaUrl: c.headerMediaUrl || undefined, by: 'campaign' });
    lead.campaign = { state: 'sent', sentAt: now(), template: c.templateName };
    db.sentToday.count++;
    failStreak = 0;
    if (lead.email && mailConfigured()) {
      const subject = fill(c.emailSubject, lead);
      await sendMail(lead.email, subject, fill(c.emailBody, lead))
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

function startEngine() {
  setInterval(() => campaignTick().catch((e) => console.error('[campaign]', e.message)), 1000);
  setInterval(() => reminderTick().catch((e) => console.error('[reminders]', e.message)), 60_000);
}

function setCampaignRunning(on) {
  db.campaignRunning = Boolean(on);
  if (on) {
    failStreak = 0;
    db.campaignPausedReason = '';
  }
  save();
}

module.exports = { setCampaignRunning, handleWebhook, hubSend, resolvePending, startEngine, windowOpen, reminderTick, linkMyopUser, HUMAN };
