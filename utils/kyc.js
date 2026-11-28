// KYC for partners and buyers: Aadhaar, PAN and bank account, each with an uploaded document. Needed before
// any booking (making, accepting or applying), because RentMySite collects and pays out money for both sides.
//
// Privacy rules:
//  - Aadhaar: only the last 4 digits are kept (UIDAI rules: never store the full number). People are asked to
//    upload a masked Aadhaar (first 8 digits hidden).
//  - Documents live in their own folder, are never public, and are served only to their owner and the RentMySite team.
//  - `kyc` is in jsonModel's USER_SECRETS, so it never leaves the server except through kycSummary (masked).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { fail } = require('./http');

const KYC_DIR = path.join(process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data'), 'kyc');
const DOCS = { aadhaar: 'Aadhaar card (masked)', pan: 'PAN card', bank: 'Cancelled cheque or bank passbook' };
const MAX_DOC_BYTES = 8 * 1024 * 1024;
const TYPES = [
  { mime: 'image/jpeg', ext: 'jpg', ok: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: 'png', ok: b => b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
  { mime: 'application/pdf', ext: 'pdf', ok: b => b.toString('ascii', 0, 5) === '%PDF-' }
];

// Aadhaar numbers carry a Verhoeff check digit, so typos are caught before saving
const D = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],
  [5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
const P = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],
  [4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
function validAadhaar(n) {
  if (!/^[2-9]\d{11}$/.test(n)) return false;
  let c = 0;
  n.split('').reverse().forEach((d, i) => { c = D[c][P[i % 8][Number(d)]]; });
  return c === 0;
}

const digits = v => String(v || '').replace(/\D/g, '');
const mask = (v, keep = 4) => (v ? `${'•'.repeat(Math.max(0, v.length - keep))}${v.slice(-keep)}` : '');

// Save the typed details. Returns the fields to merge into user.kyc.
function cleanDetails(b = {}) {
  const out = {};
  const aadhaar = digits(b.aadhaar);
  if (aadhaar) {
    if (!validAadhaar(aadhaar)) throw fail('That Aadhaar number does not look right. Check the 12 digits.');
    out.aadhaarLast4 = aadhaar.slice(-4);   // the full number is never stored
  }
  const pan = String(b.pan || '').trim().toUpperCase();
  if (pan) {
    if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(pan)) throw fail('Enter your PAN like ABCDE1234F');
    out.pan = pan;
  }
  const name = String(b.accountName || '').trim().slice(0, 120);
  if (name) out.accountName = name;
  const acc = digits(b.accountNumber);
  if (acc) {
    if (acc.length < 9 || acc.length > 18) throw fail('Enter your bank account number (9 to 18 digits)');
    out.accountNumber = acc;
  }
  const ifsc = String(b.ifsc || '').trim().toUpperCase();
  if (ifsc) {
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) throw fail('Enter your IFSC like HDFC0001234');
    out.ifsc = ifsc;
  }
  const bank = String(b.bankName || '').trim().slice(0, 80);
  if (bank) out.bankName = bank;
  return out;
}

function missing(k = {}) {
  const need = [];
  if (!k.aadhaarLast4) need.push('Aadhaar number');
  if (!k.pan) need.push('PAN');
  if (!k.accountName || !k.accountNumber || !k.ifsc) need.push('bank account details');
  for (const [key, label] of Object.entries(DOCS)) if (!k.docs?.[key]) need.push(label);
  return need;
}
const kycComplete = user => missing(user?.kyc).length === 0;
// Identity part only: what an owner gives when uploading (bank details come later, once there is a customer)
function idMissing(k = {}) {
  const need = [];
  if (!k.aadhaarLast4) need.push('Aadhaar number');
  if (!k.pan) need.push('PAN');
  if (!k.docs?.aadhaar) need.push(DOCS.aadhaar);
  if (!k.docs?.pan) need.push(DOCS.pan);
  return need;
}
const idComplete = user => idMissing(user?.kyc).length === 0;

// What the owner (and the RentMySite team) see: masked, never the full numbers
function kycSummary(user) {
  const k = user?.kyc || {};
  return {
    complete: kycComplete(user), missing: missing(k), verifiedAt: k.verifiedAt || null, submittedAt: k.submittedAt || null,
    idComplete: idComplete(user), idMissing: idMissing(k), idVerifiedAt: k.idVerifiedAt || k.verifiedAt || null,
    aadhaar: k.aadhaarLast4 ? `•••• •••• ${k.aadhaarLast4}` : '',
    pan: k.pan ? `${k.pan.slice(0, 2)}•••••${k.pan.slice(-3)}` : '',
    accountName: k.accountName || '', accountNumber: mask(k.accountNumber), ifsc: k.ifsc || '', bankName: k.bankName || '',
    docs: Object.fromEntries(Object.keys(DOCS).map(d => [d, k.docs?.[d] ? { uploadedAt: k.docs[d].uploadedAt } : null])),
    docLabels: DOCS
  };
}

// Guard for every booking action
function requireKyc(user, action = 'book') {
  if (kycComplete(user)) return;
  const err = fail(`Complete your KYC in your Profile before you ${action}: ${missing(user?.kyc).join(', ')}.`, 403);
  err.code = 'KYC_REQUIRED';
  throw err;
}

async function storeDoc(user, kind, file) {
  if (!DOCS[kind]) throw fail('Choose Aadhaar, PAN or bank document');
  if (!file) throw fail('Choose a photo or PDF of the document');
  try {
    if (file.size > MAX_DOC_BYTES) throw fail('The file must be 8 MB or smaller', 413);
    const head = Buffer.alloc(8);
    const fh = await fs.promises.open(file.path, 'r');
    try { await fh.read(head, 0, 8, 0); } finally { await fh.close(); }
    const type = TYPES.find(t => t.ok(head));
    if (!type) throw fail('Upload a JPG, PNG or PDF');
    await fs.promises.mkdir(KYC_DIR, { recursive: true });
    const key = `${crypto.randomUUID()}.${type.ext}`;
    await fs.promises.copyFile(file.path, path.join(KYC_DIR, key));
    const old = user.kyc?.docs?.[kind]?.key;
    user.kyc = user.kyc || {};
    user.kyc.docs = { ...(user.kyc.docs || {}), [kind]: { key, mime: type.mime, uploadedAt: new Date().toISOString() } };
    delete user.kyc.verifiedAt;   // a changed document needs checking again
    await user.save();
    if (old) fs.promises.unlink(path.join(KYC_DIR, old)).catch(() => {});
  } finally {
    fs.promises.unlink(file.path).catch(() => {});
  }
}

function docPath(user, kind) {
  const d = user?.kyc?.docs?.[kind];
  if (!d || path.basename(d.key) !== d.key) return null;
  return { file: path.join(KYC_DIR, d.key), mime: d.mime };
}

// (Not used by the routes now: KYC is sent with the "All filled, send to RentMySite" button. Kept for scripts.)
const pending = new Map();
function notifyTeam(user) {
  const id = String(user._id);
  clearTimeout(pending.get(id));
  const delay = process.env.KYC_NOTIFY_DELAY_MS !== undefined ? Number(process.env.KYC_NOTIFY_DELAY_MS) : 60000;
  const t = setTimeout(async () => {
    pending.delete(id);
    try {
      const User = require('../models/User');
      const u = await User.findById(id);
      if (u) await sendTeamKyc(u);
    } catch (err) { console.error('[kyc] team email failed:', err.message); }
  }, delay);
  t.unref?.();
  pending.set(id, t);
}

async function sendTeamKyc(u) {
  const { sendMail } = require('./mailer');
  const { layout, p, esc, TEAM_INBOX, APP_URL } = require('./emails');
  const k = u.kyc || {};
  const s = kycSummary(u);
  const who = u.business?.businessName || u.name;
  const rows = [
    ['Partner', `${who}${u.leadId ? ` (${u.leadId})` : ''}`], ['Name', u.name], ['Email', u.email], ['Phone', u.phone || ''],
    ['Type', u.role === 'associate' ? 'Professional' : u.role === 'buyer' ? 'Buyer' : 'Business'],
    ['Aadhaar', k.aadhaarLast4 ? `Last 4 digits: ${k.aadhaarLast4} (the full number is never stored)` : 'Not given'],
    ['PAN', k.pan || 'Not given'], ['Account holder', k.accountName || 'Not given'], ['Bank', k.bankName || ''],
    ['Account number', k.accountNumber || 'Not given'], ['IFSC', k.ifsc || 'Not given'],
    ['Documents', Object.entries(DOCS).map(([d, label]) => `${label}: ${k.docs?.[d] ? 'attached' : 'not uploaded'}`).join('; ')],
    ['Status', s.complete ? 'Complete, ready to verify' : `Still missing: ${s.missing.join(', ')}`]
  ];
  const table = `<table style="border-collapse:collapse;width:100%">${rows.map(([a, b]) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #D5DCEC;color:#47537C;font-size:13px;vertical-align:top">${esc(a)}</td><td style="padding:6px 10px;border-bottom:1px solid #D5DCEC;font-size:14px">${esc(b)}</td></tr>`).join('')}</table>`;
  const attachments = Object.keys(DOCS).map(d => {
    const f = docPath(u, d);
    return f && fs.existsSync(f.file) ? { filename: `${d}-${String(who).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.${path.extname(f.file).slice(1)}`, path: f.file } : null;
  }).filter(Boolean);
  return sendMail({
    to: [...new Set(['info@rentmysite.ai', TEAM_INBOX()])].join(','), subject: `KYC ${s.complete ? 'complete' : 'updated'}: ${who}${u.leadId ? ` [${u.leadId}]` : ''}`,
    html: layout('KYC details', p(`${esc(who)} filled in their KYC and sent it to RentMySite. Check it and mark it verified in the RentMySite team dashboard (KYC tab).`) + table
      + p(`<a href="${APP_URL()}/admin#kyc">Open the KYC tab</a>`) + p('<span style="font-size:12px;color:#47537C">Private: PAN, bank and identity documents. Do not forward outside the RentMySite team.</span>')),
    attachments
  });
}

function kycTeamView(u) {
  const k = u.kyc || {};
  return { ...kycSummary(u), pan: k.pan || '', accountNumber: k.accountNumber || '', updatedDocs: k.docs || {} };
}

module.exports = { idComplete, kycTeamView, notifyTeam, sendTeamKyc, cleanDetails, kycComplete, kycSummary, requireKyc, storeDoc, docPath, validAadhaar, DOCS };
