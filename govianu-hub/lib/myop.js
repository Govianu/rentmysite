// MyOperator API client. Request shapes come from MyOperator's official Postman collection
// (documenter.getpostman.com/view/38426694/2sAXqy3evq).
const { randomUUID } = require('crypto');
const { db } = require('./store');

const BASE = process.env.MYOP_BASE || 'https://publicapi.myoperator.co';
const CALL_BASE = 'https://developers.myoperator.co';
const DRY_RUN = String(process.env.MYOP_DRY_RUN).toLowerCase() === 'true';

function configured() {
  return Boolean(process.env.MYOP_API_KEY && process.env.MYOP_COMPANY_ID);
}

async function waRequest(method, pathname, body) {
  const res = await fetch(BASE + pathname, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.MYOP_API_KEY}`,
      'X-MYOP-COMPANY-ID': process.env.MYOP_COMPANY_ID,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok || json.status === 'error') {
    const why = json.errors ? JSON.stringify(json.errors) : json.message || text.slice(0, 200);
    throw new Error(`MyOperator ${res.status}: ${why}`);
  }
  return json;
}

function splitPhone(phone) {
  // phone is "91XXXXXXXXXX"
  return { customer_country_code: phone.slice(0, phone.length - 10), customer_number: phone.slice(-10) };
}

function phoneNumberId() {
  const id = db.settings.waPhoneNumberId || process.env.MYOP_WA_PHONE_NUMBER_ID;
  if (!id) throw new Error('WhatsApp phone_number_id not known yet – it is learned from the first incoming WhatsApp webhook, or set it in Settings');
  return id;
}

// Returns { messageId, refId }
async function send(phone, data) {
  const refId = randomUUID();
  if (DRY_RUN) {
    console.log(`[MYOP DRY RUN] → ${phone}: ${JSON.stringify(data).slice(0, 160)}`);
    return { messageId: `dry-${refId}`, refId };
  }
  const r = await waRequest('POST', '/chat/messages', {
    phone_number_id: phoneNumberId(),
    ...splitPhone(phone),
    data,
    reply_to: null,
    myop_ref_id: refId,
    trail: { name: null },
  });
  return { messageId: r.data?.message_id || null, refId };
}

function sendText(phone, body) {
  return send(phone, { type: 'text', context: { body, preview_url: false } });
}

function sendTemplate(phone, templateName, { language = 'en', body, headerMediaUrl } = {}) {
  const context = { template_name: templateName, language };
  if (headerMediaUrl) context.header = { media_url: headerMediaUrl };
  if (body && Object.keys(body).length) context.body = body;
  return send(phone, { type: 'template', language, context });
}

function sendMedia(phone, kind, link, caption) {
  const filename = link.split('/').pop().split('?')[0] || 'file';
  const mime = { video: 'video/mp4', image: 'image/jpeg', document: 'application/pdf' }[kind];
  return send(phone, { type: kind, context: { link, filename, caption, mime_type: mime } });
}

async function listTemplates() {
  const out = [];
  for (let offset = 0; offset < 500; offset += 20) {
    const r = await waRequest('GET', `/chat/templates?limit=20&offset=${offset}`);
    const rows = r.data?.results || [];
    out.push(...rows);
    if (rows.length < 20) break; // keep paging: new templates are usually at the end
  }
  return out.map((t) => {
    const body = (t.components || []).find((c) => c.type === 'BODY')?.text || '';
    const header = (t.components || []).find((c) => c.type === 'HEADER');
    return {
      name: t.name,
      status: t.waba_template_status || t.status,
      category: t.category,
      language: t.language,
      headerFormat: header?.format || null,
      variables: [...new Set([...body.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))],
      body,
    };
  });
}

// ---- Calling APIs (need the separate "Calling API token": Developer API → Calling APIs) ----
function callingConfigured() {
  return Boolean(process.env.MYOP_CALL_TOKEN);
}

async function recordingLink(file) {
  if (!callingConfigured()) throw new Error('Set MYOP_CALL_TOKEN (Developer API → Calling APIs) to play recordings');
  const url = `${CALL_BASE}/search/recordings/link?token=${encodeURIComponent(process.env.MYOP_CALL_TOKEN)}&file=${encodeURIComponent(file)}`;
  const res = await fetch(url);
  const text = await res.text();
  // Response shape isn't documented beyond "returns a recording link": take the first https URL in it.
  const m = text.replace(/\\\//g, '/').match(/https:\/\/[^"'\s]+/);
  if (!res.ok || !m) throw new Error(`Recording link not available (${res.status})`);
  return m[0];
}

async function listUsers() {
  if (!callingConfigured()) return [];
  const url = `${CALL_BASE}/search/user?token=${encodeURIComponent(process.env.MYOP_CALL_TOKEN)}&page-size=100`;
  const res = await fetch(url);
  const json = await res.json().catch(() => ({}));
  const rows = json?.data?.hits || json?.data || json?.users || [];
  return Array.isArray(rows) ? rows : [];
}

// The WhatsApp Business Account id (needed to create templates). MyOperator's responses carry several ids
// (internal uuid, Meta's WABA id, …) and the field name isn't documented, so collect every candidate:
// MYOP_WABA_ID first, then every waba-like id on the WhatsApp phone numbers.
let goodWaba = null;
function collectWaba(obj, out, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 4) return;
  for (const [k, v] of Object.entries(obj)) {
    if (/waba/i.test(k) && (typeof v === 'string' || typeof v === 'number') && String(v)) out.add(String(v));
    else if (/waba/i.test(k) && v && typeof v === 'object') {
      for (const [k2, v2] of Object.entries(v)) if (/(^id$|waba|meta|account)/i.test(k2) && (typeof v2 === 'string' || typeof v2 === 'number')) out.add(String(v2));
      collectWaba(v, out, depth + 1);
    } else if (v && typeof v === 'object') collectWaba(v, out, depth + 1);
  }
}
async function wabaCandidates() {
  const out = new Set();
  if (goodWaba) out.add(goodWaba);
  if (process.env.MYOP_WABA_ID) out.add(process.env.MYOP_WABA_ID);
  const p = await waRequest('GET', '/chat/phonenumbers?limit=10&offset=0&expand=waba_account').catch(() => null);
  for (const row of p?.data?.results || []) collectWaba(row, out);
  return [...out];
}
async function wabaId() {
  const c = await wabaCandidates();
  if (!c.length) throw new Error('Could not find the WhatsApp Business Account id – add MYOP_WABA_ID to the Hub .env');
  return c.join(' / ');
}

async function createTemplate(t) {
  if (DRY_RUN) {
    console.log('[MYOP DRY RUN] create template', t.name);
    return { data: { id: 'dry' } };
  }
  const cands = await wabaCandidates();
  let last = new Error('no WhatsApp Business Account id found');
  for (const id of cands) {
    try {
      const r = await waRequest('POST', '/chat/templates', { ...t, waba_id: id });
      goodWaba = id;
      console.log('[templates] created', t.name, 'waba', id, JSON.stringify(r).slice(0, 300));
      return r;
    } catch (e) {
      last = e;
      if (!/waba/i.test(e.message)) throw e; // a real error about the template itself
    }
  }
  throw new Error(`${last.message} (tried: ${cands.join(', ')})`);
}

function obdConfigured() {
  return Boolean(process.env.MYOP_OBD_API_KEY && process.env.MYOP_OBD_SECRET && process.env.MYOP_PUBLIC_IVR_ID && process.env.MYOP_COMPANY_ID);
}

// OBD API, type 1: user dialer (agent's MyOperator user id) or anonymous dialer (agent's phone number)
async function clickToCall({ customer, userId, agentPhone, reference }) {
  if (!obdConfigured()) throw new Error('Click-to-call is not set up: add MYOP_OBD_API_KEY, MYOP_OBD_SECRET and MYOP_PUBLIC_IVR_ID to the Hub .env');
  if (!userId && !agentPhone) throw new Error('Your MyOperator user is not linked and no phone is saved on your profile');
  const body = {
    company_id: process.env.MYOP_COMPANY_ID,
    secret_token: process.env.MYOP_OBD_SECRET,
    type: '1',
    number: '+' + customer,
    public_ivr_id: process.env.MYOP_PUBLIC_IVR_ID,
    reference_id: reference || randomUUID(),
    max_call_duration: 1800,
    call_hold: true,
  };
  if (userId) body.user_id = userId;
  else body.number_2 = '+' + agentPhone;
  if (process.env.MYOP_CALLER_ID) body.caller_id = process.env.MYOP_CALLER_ID;
  if (DRY_RUN) {
    console.log('[MYOP DRY RUN] click-to-call', JSON.stringify({ ...body, secret_token: '***' }));
    return { status: 'success', dryRun: true };
  }
  const res = await fetch('https://obd-api.myoperator.co/obd-api-v1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.MYOP_OBD_API_KEY },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.status === 'error') throw new Error(`MyOperator call ${res.status}: ${json.details || json.message || JSON.stringify(json).slice(0, 200)}`);
  return json;
}

module.exports = { wabaCandidates, waRequest, wabaId, createTemplate, obdConfigured, clickToCall, configured, callingConfigured, sendText, sendTemplate, sendMedia, listTemplates, recordingLink, listUsers, DRY_RUN };
