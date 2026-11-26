// Lead import (Google Sheet / CSV / the two websites' data files) and assignment to employees.
const fs = require('fs');
const { parse } = require('csv-parse/sync');
const { db, save, normPhone, uid, now, employee, logActivity, notify } = require('./store');

const SHEET_ID = process.env.SHEET_ID || '1fiWXA-gd2BDXjgjIYBiiHSJ2F8CQNIflMc6vWJuR7vo';

// ---------- assignment ----------
function activeEmployees(brand) {
  return db.employees.filter((e) => e.active !== false && (!brand || (e.brands || []).includes(brand)));
}

function findEmployeeByName(name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return null;
  return activeEmployees().find((e) => e.name.toLowerCase() === n || e.name.toLowerCase().split(' ')[0] === n.split(' ')[0]) || null;
}

// New leads are NOT handed out round-robin any more: the first team member who replies or calls becomes
// "assigned to" (see markContact in engine.js). Only the sheet's "Assign To" name is used up front.
function autoAssign(lead, hintName) {
  if (lead.assignedTo && employee(lead.assignedTo)) return lead.assignedTo;
  const byName = findEmployeeByName(hintName);
  if (byName) {
    lead.assignedTo = byName.id;
    lead.assignedBy = 'sheet';
  }
  return lead.assignedTo || null;
}

function assign(lead, employeeId, byId) {
  lead.assignedTo = employeeId || null;
  lead.assignedBy = employeeId ? 'manual' : null; // a hand-made assignment sticks; first contact no longer changes it
  const emp = employee(employeeId);
  logActivity(byId, 'assigned', lead, `Assigned to ${emp ? emp.name : 'nobody'}`);
  if (emp) notify(emp.id, `New lead assigned: ${lead.name || '+' + lead.phone} (${lead.brand})`, lead.phone);
  save();
}

// ---------- lead upsert ----------
function upsertLead(phone, fields = {}, { brand } = {}) {
  let lead = db.leads[phone];
  const isNew = !lead;
  if (!lead) {
    lead = db.leads[phone] = {
      id: uid(),
      phone,
      name: '',
      email: '',
      area: '',
      brand: brand || db.settings.defaultBrand,
      stage: 'new',
      sheetStatus: '',
      remarks: '',
      source: '',
      assignedTo: null,
      createdAt: now(),
      campaign: { state: 'none' },
      notes: [],
    };
  }
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null || v === '') continue;
    if (k === 'email' || k === 'name' || k === 'area' || k === 'source') {
      if (!lead[k]) lead[k] = v; // never overwrite what the team already has
    } else lead[k] = v;
  }
  return { lead, isNew };
}

// ---------- sheet / CSV ----------
const COLS = {
  phone: /number|phone|mobile|contact/i,
  name: /name/i,
  area: /city|area|location|adress|address/i,
  email: /e-?mail/i,
  status: /status/i,
  remarks: /remark/i,
  source: /source/i,
  assigned: /assign|lead owner/i,
  drive: /drive/i,
  size: /land size|^size|plot size|area \(sq/i,
  road: /road/i,
  map: /gmap|map pin|google map/i,
  date: /^date/i,
};

function importRows(rows, { brand, tab }) {
  const headerIdx = rows.findIndex((r) => r.some((c) => COLS.phone.test(String(c))));
  if (headerIdx < 0) throw new Error('Could not find a header row with a Number/Phone column');
  const header = rows[headerIdx].map((h) => String(h).trim());
  const col = {};
  for (const [k, re] of Object.entries(COLS)) col[k] = header.findIndex((h) => re.test(h) && !(k === 'name' && COLS.phone.test(h)) && !(k === 'size' && /road/i.test(h)));
  const res = { added: 0, updated: 0, invalid: 0, duplicates: 0 };
  const seen = new Set();
  for (const r of rows.slice(headerIdx + 1)) {
    const get = (k) => (col[k] >= 0 ? String(r[col[k]] ?? '').trim() : '');
    const phone = normPhone(get('phone'));
    if (!phone) {
      if (r.some((c) => String(c).trim())) res.invalid++;
      continue;
    }
    if (seen.has(phone)) {
      res.duplicates++;
      continue;
    }
    seen.add(phone);
    const { lead, isNew } = upsertLead(
      phone,
      { name: get('name'), area: get('area'), email: get('email'), sheetStatus: get('status'), remarks: get('remarks'), source: get('source') || tab,
        driveLink: /^https?:\/\//.test(get('drive')) ? get('drive') : undefined, landSize: get('size'), roadSize: get('road'),
        mapLink: /^\s*https?:\/\//.test(get('map')) ? get('map').trim() : undefined, sheetDate: get('date') },
      { brand },
    );
    autoAssign(lead, get('assigned'));
    isNew ? res.added++ : res.updated++;
  }
  save();
  return res;
}

function importCsv(text, opts) {
  return importRows(parse(text, { relax_column_count: true, bom: true }), opts);
}

function sheetsConfigured() {
  const f = process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
  return Boolean(f && fs.existsSync(f));
}

async function readSheet(range) {
  const { GoogleAuth } = require('google-auth-library');
  const auth = new GoogleAuth({ keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_FILE, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const c = await auth.getClient();
  const r = await c.request({ url: `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}` });
  return r.data.values || [];
}

async function importSheet(tab, brand) {
  return importRows(await readSheet(`'${tab}'`), { brand, tab });
}

async function importDnd(tab = 'DND') {
  const rows = await readSheet(`'${tab}'`);
  let n = 0;
  for (const row of rows)
    for (const c of row) {
      const p = normPhone(c);
      if (p && db.leads[p] && !db.leads[p].dnd) {
        db.leads[p].dnd = true;
        n++;
      }
    }
  db.dndList = [...new Set([...(db.dndList || []), ...rows.flat().map(normPhone).filter(Boolean)])];
  save();
  return { dnd: db.dndList.length, markedLeads: n };
}

// ---------- the two websites (read-only) ----------
// On the VPS: RMS_DATA_FILE=/backup/nodejsfiles/rentmysite/data/app-data.json etc.
function syncFromSite(brand) {
  const file = brand === 'pmb' ? process.env.PMB_DATA_FILE : process.env.RMS_DATA_FILE;
  if (!file || !fs.existsSync(file)) throw new Error(`Set ${brand === 'pmb' ? 'PMB_DATA_FILE' : 'RMS_DATA_FILE'} to that site's data/app-data.json`);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const res = { added: 0, updated: 0, noPhone: 0 };
  const rows = [
    ...(data.Lead || []).map((r) => ({ ...r, _src: 'site lead' })),
    ...(data.Enquiry || []).map((r) => ({ ...r, _src: 'site enquiry' })),
    ...(data.User || []).filter((u) => u.role !== 'admin').map((r) => ({ ...r, _src: `site ${r.role || 'user'}` })),
  ];
  for (const r of rows) {
    const phone = normPhone(r.phone);
    if (!phone) {
      res.noPhone++;
      continue;
    }
    const { lead, isNew } = upsertLead(
      phone,
      { name: r.name, email: r.email, area: typeof r.location === 'string' ? r.location : r.location?.city, source: r._src, siteLeadId: r.leadId },
      { brand },
    );
    if (isNew) lead.brand = brand;
    autoAssign(lead);
    isNew ? res.added++ : res.updated++;
  }
  save();
  return res;
}

function skipReason(lead) {
  if (lead.dnd || (db.dndList || []).includes(lead.phone)) return 'on DND list';
  const bad = db.settings.campaign.skipStatuses.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const st = `${lead.sheetStatus} ${lead.remarks}`.toLowerCase();
  const hit = bad.find((b) => st.includes(b));
  if (hit) return `status/remarks say "${hit}"`;
  if (['lost', 'signed'].includes(lead.stage)) return `stage is ${lead.stage}`;
  if (lead.lastInboundAt || lead.lastOutboundAt || lead.lastCallAt) return 'already in contact – the assigned employee follows up';
  return null;
}

module.exports = { upsertLead, autoAssign, assign, importCsv, importSheet, importDnd, syncFromSite, sheetsConfigured, skipReason, activeEmployees };
