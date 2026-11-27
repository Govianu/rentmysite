// Personal follow-ups for the WhatsApp campaign.
// For each lead: the AI reads the sheet notes (size, road, address, status, remarks) → the RentMySite estimate engine
// (../../utils/feasibility.js, the same one behind rentmysite.ai's estimate and owner reports) picks the best uses and
// the monthly figure → the values fill an approved WhatsApp template with variables.
//   "plan" template  – size known:   name, when, property, plan, amount, link
//   "hello" template – size unknown: name, when, property
// Variables are matched to the template by name, or by position when the template numbers them ({{1}}, {{2}} …).
const { db, save } = require('./store');
const myop = require('./myop');
const { extractProperty, aiConfigured } = require('./ai');

let feasibilityFor = null;
try {
  ({ feasibilityFor } = require('../../utils/feasibility'));
} catch {
  console.warn('[followup] RentMySite estimate engine not found (../../utils/feasibility.js) – plan messages disabled');
}

const ORDER = { plan: ['name', 'when', 'property', 'plan', 'amount', 'link'], hello: ['name', 'when', 'property'] };

// Approved templates and their variables (refreshed every 30 minutes)
const cache = { at: 0, list: [] };
async function templates() {
  if (Date.now() - cache.at > 30 * 60_000) {
    cache.list = await myop.listTemplates().catch(() => cache.list);
    cache.at = Date.now();
  }
  return cache.list;
}

const firstName = (n) => {
  const w = String(n || '').trim().split(/\s+/)[0] || '';
  return /[a-z]/i.test(w) && !/^\d/.test(w) ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : 'Sir/Madam';
};

// "17.09.2026", "2026-09-17", Date → ms
function parseDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (m) return new Date(Number(m[3].length === 2 ? '20' + m[3] : m[3]), Number(m[2]) - 1, Number(m[1])).getTime();
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

function whenText(ms) {
  if (!ms) return 'some time ago';
  const days = Math.round((Date.now() - ms) / 86400000);
  if (days < 10) return 'a few days ago';
  if (days < 25) return 'a few weeks ago';
  if (days < 45) return 'a month ago';
  const months = Math.round(days / 30);
  const words = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
  return months <= 12 ? `${words[months]} months ago` : 'over a year ago';
}

const inr = (n) => '₹' + Math.round(n).toLocaleString('en-IN');
// WhatsApp rejects variables with new lines, tabs or more than 4 spaces in a row
const clean = (v) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, 300);

function fillText(body, vars, keys) {
  let i = 0;
  return String(body || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (all, k) => (k in vars ? vars[k] : vars[keys[i++]] ?? all));
}

// Map our values onto the template's own variable names (named, or numbered in order)
function bodyFor(tplVars, vars, kind) {
  const ours = ORDER[kind];
  const out = {};
  tplVars.forEach((v, i) => {
    out[v] = clean(v in vars ? vars[v] : vars[ours[i]]);
  });
  return out;
}

async function details(lead) {
  if (lead.followup?.ext && lead.followup.extFrom === (lead.remarks || '') + (lead.landSize || '')) return lead.followup.ext;
  const ext = aiConfigured() ? await extractProperty(lead) : null;
  lead.followup = { ...(lead.followup || {}), ext, extFrom: (lead.remarks || '') + (lead.landSize || '') };
  save();
  return ext;
}

/** Builds the follow-up for one lead: { kind, template, body, text, vars } (throws if the templates are not set up) */
async function build(lead) {
  const c = db.settings.campaign;
  const list = await templates();
  const ext = await details(lead);
  const vars = {
    name: firstName(lead.name),
    when: whenText(parseDate(lead.sheetDate) || lead.createdAt),
    property: ext?.property || (lead.area ? `property in ${lead.area}` : 'property'),
  };
  let kind = 'hello';
  if (feasibilityFor && ext && ext.sizeSqft >= 1000) {
    const f = feasibilityFor({ space: { type: ext.type === 'Other' ? '' : ext.type, size: ext.sizeSqft, road: ext.road === 'unknown' ? 'main' : ext.road, location: ext.place } });
    if (f.core.length && f.totals.core > 0) {
      kind = 'plan';
      vars.plan = f.core.slice(0, 3).map((x) => x.name).join(' + ');
      vars.amount = inr(Math.round(f.totals.core / 1000) * 1000);
      vars.link = lead.driveLink || 'https://rentmysite.ai';
    }
  }
  const name = kind === 'plan' ? c.planTemplate : c.helloTemplate;
  const tpl = list.find((t) => t.name === name);
  if (!name || !tpl) throw new Error(`Set the approved "${kind}" follow-up template in Campaign settings (template "${name || '—'}" not found)`);
  const body = bodyFor(tpl.variables, vars, kind);
  const text = fillText(tpl.body, { ...vars, ...body }, ORDER[kind]);
  lead.followup = { ...(lead.followup || {}), kind, template: name, text, at: Date.now() };
  return { kind, template: name, body, text, vars };
}

// The two templates the personal follow-up uses, submitted to Meta through MyOperator (approval: minutes to hours)
const TEMPLATES = [
  {
    name: 'rms_followup_plan',
    language: 'en',
    category: 'marketing',
    type: 'template',
    components: [{
      type: 'BODY',
      format: 'TEXT',
      text: 'Hi {{name}}, Greetings from RentMySite.ai.\n\nThis is a follow-up message since we connected {{when}}.\nWe studied your {{property}} and prepared a free earning plan: {{plan}}, up to {{amount}}/month site revenue.\n\nReport and details here: {{link}}\n\nReply YES to discuss your plan.',
      example: {
        name: 'Venkateshappa', when: 'two months ago', property: '10,000 sq ft plot at KIADB, Airport Road',
        plan: 'Food kiosk court + EV and fleet parking + Car care and detailing', amount: '₹1,81,000',
        link: 'https://drive.google.com/drive/folders/example',
      },
    }],
  },
  {
    name: 'rms_followup_hello',
    language: 'en',
    category: 'marketing',
    type: 'template',
    components: [{
      type: 'BODY',
      format: 'TEXT',
      text: 'Hi {{name}}, Greetings from RentMySite.ai.\n\nThis is a follow-up message since we connected {{when}} about your {{property}}.\nWe turn dormant space into multiple monthly revenue streams – you keep the title, with no upfront cost.\n\nCould you share the size and location of the space so we can prepare your free earning plan?',
      example: { name: 'Ravi', when: 'two months ago', property: 'property in Whitefield' },
    }],
  },
];

async function createTemplates() {
  const out = [];
  for (const t of TEMPLATES) {
    try {
      await myop.createTemplate(t);
      out.push({ name: t.name, ok: true });
    } catch (e) {
      out.push({ name: t.name, ok: /exist/i.test(e.message), error: e.message });
    }
  }
  const c = db.settings.campaign;
  c.planTemplate = 'rms_followup_plan';
  c.helloTemplate = 'rms_followup_hello';
  cache.at = 0; // re-read the template list next time
  save();
  return out;
}

async function approvedNames() {
  cache.at = 0;
  return new Set((await templates()).filter((t) => t.status === 'approved').map((t) => t.name));
}

module.exports = { build, whenText, parseDate, createTemplates, approvedNames, TEMPLATES };
