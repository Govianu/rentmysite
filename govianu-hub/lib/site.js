// Events from the websites (server to server, X-Hub-Key):
//   enquiry – someone filled the website enquiry form: add them to Leads straight away and send the first WhatsApp
//             (owners: upload your plot; space seekers: see the plots), then the AI carries the conversation.
//   plot    – an owner uploaded a plot on /list-plot (or the team approved / rejected it): noted on the lead, so the
//             team and the AI know.
const { db, save, normPhone, now, logActivity } = require('./store');
const myop = require('./myop');
const { upsertLead, autoAssign } = require('./leads');

const FORM = () => (db.settings.ai && db.settings.ai.plotFormUrl) || 'https://rentmysite.ai/list-plot';
const FIND = () => FORM().replace(/\/list-plot.*$/, '/find#plots');

function firstName(name) {
  const f = String(name || '').trim().split(/\s+/)[0];
  return f && /^[A-Za-z]{2,20}$/.test(f) ? f[0].toUpperCase() + f.slice(1).toLowerCase() : 'there';
}

function welcome(lead, role) {
  const seeker = role === 'brand';
  const name = firstName(lead.name);
  const link = seeker ? FIND() : `${FORM()}?phone=${lead.phone.slice(-10)}&src=web`;
  const template = seeker ? 'rms_enquiry_seeker' : 'rms_enquiry_owner';
  const text = seeker
    ? `Hi ${name}, thank you for your enquiry on RentMySite.ai.\n\nYou can see the plots and spaces available right now here: ${link}\n\nTell us what you need – the use, the area and the size – and we will shortlist the right sites for you.`
    : `Hi ${name}, thank you for your enquiry on RentMySite.ai.\n\nTo prepare your free earning plan, please upload your plot or space details, photos and documents here (takes about 5 minutes): ${link}\n\nOur team will review it and take it forward with you. You can also reply here with any questions.`;
  return { template, body: { name, link }, text };
}

async function sendWelcome(lead, role) {
  const engine = require('./engine');
  if (lead.welcomeSentAt || !myop.configured()) return 'skipped';
  const w = welcome(lead, role);
  if (engine.windowOpen(lead)) {
    await engine.hubSend(null, lead.phone, { text: w.text, by: 'ai' });
  } else {
    const ok = await require('./followup').approvedNames().catch(() => new Set());
    if (!ok.has(w.template)) {
      console.warn(`[site] template ${w.template} not approved yet – no welcome WhatsApp for ${lead.phone}`);
      lead.welcomePending = w.template;
      return 'template not approved yet';
    }
    await engine.hubSend(null, lead.phone, { template: w.template, templateBody: w.body, shownText: w.text, by: 'ai' });
  }
  lead.welcomeSentAt = now();
  delete lead.welcomePending;
  logActivity(null, 'ai_reply', lead, 'Website enquiry – sent the welcome WhatsApp');
  return 'sent';
}

async function handleSiteEvent(ev) {
  const phone = normPhone(ev.phone);
  if (!phone) throw new Error('phone missing or not valid');
  const brand = ev.brand === 'pmb' ? 'pmb' : 'rentmysite';
  if (ev.type === 'enquiry') {
    const { lead, isNew } = upsertLead(phone, { name: ev.name, email: ev.email, area: ev.area, source: 'Website enquiry', siteLeadId: ev.leadId }, { brand });
    if (isNew) lead.brand = brand;
    autoAssign(lead);
    lead.notes = [...(lead.notes || []), { at: now(), by: 'website', text: `Website enquiry (${ev.roleName || ev.role || 'enquiry'})${ev.details ? ': ' + String(ev.details).slice(0, 400) : ''}` }];
    logActivity(null, 'imported', lead, `New website enquiry${ev.roleName ? ` – ${ev.roleName}` : ''}`);
    // Never also put them in the 100-a-day follow-up: they get the website welcome instead
    if (['none', 'queued', undefined].includes(lead.campaign?.state)) lead.campaign = { state: 'skipped', reason: 'website enquiry – welcomed directly' };
    save();
    const welcomeResult = ev.welcome === false ? 'not needed' : brand === 'rentmysite' ? await sendWelcome(lead, ev.role).catch((e) => `error: ${e.message}`) : 'not for this brand';
    save();
    return { ok: true, phone, isNew, welcome: welcomeResult };
  }
  if (ev.type === 'plot') {
    const { lead, isNew } = upsertLead(phone, { name: ev.name, email: ev.email, area: ev.area, source: 'Plot upload' }, { brand });
    if (isNew) lead.brand = brand;
    autoAssign(lead);
    const what = {
      submitted: `Uploaded plot ${ev.plotId}: ${ev.title} (${ev.photos || 0} photos, ${ev.documents || 0} documents) – waiting for team approval`,
      approved: `Plot ${ev.plotId} approved and published for space seekers – the team takes it forward now`,
      rejected: `Plot ${ev.plotId} not approved yet${ev.note ? ': ' + ev.note : ''} – ask the owner for what is missing`,
    }[ev.status] || `Plot ${ev.plotId}: ${ev.status}`;
    lead.plots = [...(lead.plots || []).filter((p) => p.plotId !== ev.plotId), { plotId: ev.plotId, title: ev.title, status: ev.status, at: now() }];
    lead.notes = [...(lead.notes || []), { at: now(), by: 'website', text: what }];
    logActivity(null, 'note', lead, what);
    save();
    return { ok: true, phone, isNew };
  }
  throw new Error('unknown event type');
}

// Welcome WhatsApps that were waiting for Meta to approve the template: send them once it is approved
async function retryPendingWelcomes() {
  const waiting = Object.values(db.leads).filter((l) => l.welcomePending && !l.welcomeSentAt && now() - (l.createdAt || 0) < 7 * 24 * 3600_000);
  for (const l of waiting) {
    const r = await sendWelcome(l, l.welcomePending === 'rms_enquiry_seeker' ? 'brand' : 'owner').catch(() => 'error');
    if (r === 'template not approved yet') break;
  }
  if (waiting.length) save();
}

module.exports = { handleSiteEvent, retryPendingWelcomes, welcome };
