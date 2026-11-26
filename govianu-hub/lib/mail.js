// Email via SMTP (Zoho / Gmail / Brevo SMTP relay), from each business's own mailbox:
//   RentMySite (and sign-in codes, staff alerts): SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM
//   PartnerMyBusiness leads:                      PMB_SMTP_HOST, PMB_SMTP_PORT, PMB_SMTP_USER, PMB_SMTP_PASS, PMB_MAIL_FROM
//                                                 (falls back to the RentMySite mailbox when not set)
// Without SMTP settings, emails go to data/outbox/ (dev only).
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { DATA_DIR } = require('./store');

const transports = {};

function settings(brand) {
  const p = brand === 'pmb' && process.env.PMB_SMTP_HOST ? 'PMB_' : '';
  const s = {
    key: p || 'default',
    host: process.env[`${p}SMTP_HOST`],
    port: Number(process.env[`${p}SMTP_PORT`] || 465),
    user: process.env[`${p}SMTP_USER`],
    pass: process.env[`${p}SMTP_PASS`],
  };
  s.from = process.env[`${p}MAIL_FROM`] || s.user;
  return s;
}

function mailConfigured(brand) {
  const s = settings(brand);
  return Boolean(s.host && s.user && s.pass);
}

async function sendMail(to, subject, text, brand) {
  const s = settings(brand);
  if (!(s.host && s.user && s.pass)) {
    const dir = path.join(DATA_DIR, 'outbox');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${Date.now()}-${String(to).replace(/[^\w.@-]/g, '_')}.txt`), `To: ${to}\nSubject: ${subject}\n\n${text}`);
    return;
  }
  transports[s.key] ||= nodemailer.createTransport({ host: s.host, port: s.port, secure: s.port === 465, auth: { user: s.user, pass: s.pass } });
  await transports[s.key].sendMail({ from: s.from, to, subject, text });
}

module.exports = { sendMail, mailConfigured };
