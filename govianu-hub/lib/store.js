// JSON-file store (same approach as the rentmysite / partnermybusiness apps).
// Keep ONE hub process running (PM2 instances: 1).
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const DATA_DIR = path.resolve(__dirname, '..', process.env.DATA_DIR || 'data');
const FILE = path.join(DATA_DIR, 'hub-data.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

const BRANDS = {
  rentmysite: { key: 'rentmysite', name: 'RentMySite', site: process.env.RMS_DASHBOARD_URL || 'https://rentmysite.ai/admin.html', color: '#0f766e' },
  pmb: { key: 'pmb', name: 'PartnerMyBusiness', site: process.env.PMB_DASHBOARD_URL || 'https://partnermybusiness.ai/admin.html', color: '#4338ca' },
};

const STAGES = ['new', 'contacted', 'replied', 'qualified', 'meeting', 'cta_sent', 'signed', 'lost'];

function defaults() {
  return {
    settings: {
      waPhoneNumberId: process.env.MYOP_WA_PHONE_NUMBER_ID || '',
      waNumberLabel: process.env.WA_NUMBER_LABEL || '8103990990',
      defaultBrand: 'rentmysite',
      campaign: {
        templateName: 'copy_rentmysite_lead_gen_april_14_utility',
        mode: 'template', // 'template' = the same template for everyone; 'personal' = follow-up built from each lead's sheet notes
        planTemplate: '', // approved template with variables: name, when, property, plan, amount, link
        helloTemplate: '', // approved template with variables: name, when, property
        templateLang: 'en',
        headerMediaUrl: '',
        dailyCap: 250,
        gapSec: 4,
        startHour: 10,
        endHour: 19,
        skipStatuses: 'not interested, dnd, wrong number, sold, rented, do not call',
        emailSubject: 'Earn more from your property{area_in} – RentMySite revenue sharing',
        emailBody:
          'Dear {name},\n\nThis is from RentMySite. You had shared your property{area_in} with us earlier.\n\n' +
          "We are not a listing portal like MagicBricks or 99acres and we don't work on fixed rent. We work on revenue sharing: " +
          'using AI we put your dormant space to work across multiple income streams – events, short stays, service apartments, ' +
          'co-working, or an additional business alongside your existing one.\n\n' +
          'Reply to this email or WhatsApp us on 8103990990 and our team will call you.\n\nRegards,\nTeam RentMySite',
      },
      reminders: { enabled: true, firstAfterMin: 10, repeatEveryMin: 15, escalateAfterMin: 30 },
      ai: {
        enabled: true, delaySec: 20, extraInstructions: '',
        officeAddress: process.env.OFFICE_ADDRESS || 'Govianu office, Sadashivanagar, Bengaluru',
        officeMap: process.env.OFFICE_MAP_URL || 'https://www.google.com/maps/search/?api=1&query=Govianu+Sadashivanagar+Bengaluru',
        officeHours: process.env.OFFICE_HOURS || 'Monday to Saturday, 10 am to 7 pm',
      },
      staffAlert: { templateName: '', variable: 'details' },
      // WhatsApp sent automatically to anyone whose call was missed (template outside the 24-hour window)
      missedCall: { enabled: true, template: 'govianu_missed_call', text: 'Hi {{name}}, thank you for calling Govianu (RentMySite.ai and PartnerMyBusiness.ai). We could not take your call right now as our team is busy with other clients. We will call you back as soon as possible.\n\nMeanwhile, you can reply here with your question or the details of your space or business.', repeatAfterHours: 6 },
    },
    employees: [], // {id,email,name,role,phone,myopUserId,brands,active,createdAt}
    leads: {}, // phone(91XXXXXXXXXX) -> lead
    messages: [],
    calls: {}, // session id -> call
    pending: {}, // phone -> open item awaiting a human
    activity: [],
    notifications: [],
    unmappedAgents: {}, // MyOperator user id -> {name,email,count,lastAt}
    seenEvents: [],
    otps: {},
    rr: 0,
    campaignRunning: false,
    sentToday: { date: '', count: 0 },
  };
}

function load() {
  const base = defaults();
  if (!fs.existsSync(FILE)) return base;
  const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const s = saved.settings || {};
  return {
    ...base,
    ...saved,
    settings: {
      ...base.settings,
      ...s,
      campaign: { ...base.settings.campaign, ...(s.campaign || {}) },
      reminders: { ...base.settings.reminders, ...(s.reminders || {}) },
      ai: { ...base.settings.ai, ...(s.ai || {}) },
      staffAlert: { ...base.settings.staffAlert, ...(s.staffAlert || {}) },
      missedCall: { ...base.settings.missedCall, ...(s.missedCall || {}) },
    },
  };
}

const db = load();
let timer = null;
function save() {
  clearTimeout(timer);
  timer = setTimeout(flush, 250);
}
function flush() {
  clearTimeout(timer);
  // keep the file bounded
  if (db.messages.length > 60000) db.messages.splice(0, db.messages.length - 60000);
  if (db.activity.length > 60000) db.activity.splice(0, db.activity.length - 60000);
  if (db.notifications.length > 5000) db.notifications.splice(0, db.notifications.length - 5000);
  if (db.seenEvents.length > 5000) db.seenEvents.splice(0, db.seenEvents.length - 5000);
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, FILE);
}

// Indian mobile -> "91XXXXXXXXXX" or null
function normPhone(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length < 10) return null;
  const last10 = d.slice(-10);
  if (!/^[6-9]/.test(last10)) return null;
  return '91' + last10;
}

function fill(tpl, lead) {
  const name = (lead.name || '').trim();
  const area = (lead.area || '').trim();
  return String(tpl || '')
    .replaceAll('{name}', name && !/^\d+$/.test(name) ? name : 'Sir/Madam')
    .replaceAll('{area_in}', area ? ` in ${area}` : '')
    .replaceAll('{area}', area)
    .trim();
}

const uid = () => randomUUID();
const now = () => Date.now();

function employee(id) {
  return db.employees.find((e) => e.id === id) || null;
}

function logActivity(employeeId, type, lead, text, extra = {}) {
  db.activity.push({ id: uid(), at: now(), employeeId: employeeId || null, type, phone: lead?.phone || null, brand: lead?.brand || null, text, ...extra });
  save();
}

function notify(employeeId, text, phone) {
  db.notifications.push({ id: uid(), at: now(), employeeId, text, phone: phone || null, read: false });
  save();
}

module.exports = { db, save, flush, normPhone, fill, uid, now, employee, logActivity, notify, BRANDS, STAGES, DATA_DIR };
