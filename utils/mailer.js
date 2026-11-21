// Sends email in one of two ways:
//  1. Brevo email API over HTTPS (BREVO_API_KEY). Works even on hosts that block outbound email ports.
//  2. Any SMTP provider (SMTP_HOST/SMTP_USER/SMTP_PASS): Zoho, Google Workspace, Brevo SMTP, SendGrid...
// With neither set, emails are saved to data/outbox/ and printed to the console, so the flow can be tested locally.
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const OUTBOX = path.join(__dirname, '..', 'data', 'outbox');
const BREVO_BASE = () => String(process.env.BREVO_API_BASE || 'https://api.brevo.com/v3').replace(/\/+$/, ''); // override only for testing
let transporter = null;

const brevoConfigured = () => Boolean(process.env.BREVO_API_KEY);
const smtpConfigured = () => !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
const mailConfigured = () => brevoConfigured() || smtpConfigured();

function getTransporter() {
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT) || 587;
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
  }
  return transporter;
}

const fromAddress = () => process.env.MAIL_FROM || `RentMySite.ai <${process.env.SMTP_USER || 'info@rentmysite.ai'}>`;

// "RentMySite.ai <info@rentmysite.ai>" -> { name, email }
function parseAddress(value) {
  const m = String(value || '').match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
  return m ? { name: m[1].trim() || undefined, email: m[2].trim() } : { email: String(value || '').trim() };
}

async function sendViaBrevo({ to, subject, html, text, replyTo, headers, attachments }) {
  const body = {
    sender: parseAddress(fromAddress()),
    to: String(to).split(',').map(x => ({ email: x.trim() })).filter(x => x.email),
    subject,
    htmlContent: html,
    ...(text ? { textContent: text } : {}),
    ...(replyTo ? { replyTo: parseAddress(replyTo) } : {}),
    ...(headers ? { headers } : {}),
    ...(attachments?.length ? { attachment: attachments.map(a => ({ name: a.filename, content: require('fs').readFileSync(a.path).toString('base64') })) } : {})
  };
  const res = await fetch(`${BREVO_BASE()}/smtp/email`, {
    method: 'POST',
    headers: { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.code || `Brevo request failed (${res.status})`);
  return data.messageId;
}

// headers: optional extra email headers, e.g. List-Unsubscribe on opportunity emails
// attachments: optional [{ filename, path }] (KYC documents to the team inbox)
async function sendMail({ to, subject, html, text, replyTo, headers, attachments }) {
  if (!to) return { sent: false, reason: 'no recipient' };
  if (!mailConfigured()) {
    fs.mkdirSync(OUTBOX, { recursive: true });
    const file = path.join(OUTBOX, `${Date.now()}-${String(to).replace(/[^a-z0-9@._-]/gi, '_')}.html`);
    fs.writeFileSync(file, `<!-- To: ${to}\n     Subject: ${subject} -->\n${html}`);
    console.log(`[mail:outbox] "${subject}" -> ${to} (saved to ${path.relative(process.cwd(), file)})`);
    return { sent: false, outbox: file };
  }
  try {
    if (brevoConfigured()) return { sent: true, id: await sendViaBrevo({ to, subject, html, text, replyTo, headers, attachments }) };
    const info = await getTransporter().sendMail({ from: fromAddress(), to, subject, html, text, replyTo, ...(headers ? { headers } : {}), ...(attachments?.length ? { attachments } : {}) });
    return { sent: true, id: info.messageId };
  } catch (err) {
    // Email problems must never lose an enquiry: log and carry on
    console.error(`[mail] failed to send "${subject}" to ${to}:`, err.message);
    return { sent: false, error: err.message };
  }
}

async function verifyMail() {
  if (brevoConfigured()) {
    try {
      const res = await fetch(`${BREVO_BASE()}/account`, { headers: { 'api-key': process.env.BREVO_API_KEY, accept: 'application/json' } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`${res.status} ${data.message || ''}`.trim());
      console.log(`[mail] Brevo email API OK (account: ${data.email || 'connected'}); sending as ${fromAddress()}`);
    } catch (err) { console.error('[mail] Brevo API key check failed:', err.message); }
    return;
  }
  if (!smtpConfigured()) return console.log('[mail] Email not set: emails go to data/outbox/ (see .env.example)');
  try { await getTransporter().verify(); console.log('[mail] SMTP connection OK'); }
  catch (err) { console.error('[mail] SMTP connection failed:', err.message, '(if your host blocks email ports, use BREVO_API_KEY instead)'); }
}

// Why a sign-in code could not be sent, in words the person can act on (the full error is in the server log)
function sendFailureMessage(error, to) {
  const e = String(error || '');
  if (/5\.1\.[0-9]|user.*(unknown|not exist|not found)|no such user|mailbox.*(unavailable|not found)|invalid recipient|recipient.*reject|5\.0\.0.*recipient/i.test(e)) {
    return `We could not deliver the code to ${to}. Check the address is correct and the mailbox exists.`;
  }
  if (/unusual sending|blocked|limit|quota|too many|5\.4\.6|4\.7\.|throttl/i.test(e)) {
    return 'Our email account is blocked from sending for now (Zoho sending limit or block). Please try again later or contact info@rentmysite.ai.';
  }
  if (/auth|535|534|credentials|password/i.test(e)) {
    return 'Our email account could not log in to send the code. The RentMySite admin needs to check the email password on the server.';
  }
  if (/relay|553|sender.*not allowed|from address/i.test(e)) {
    return 'Our email server refused the sender address. The RentMySite admin needs to check MAIL_FROM matches the email account on the server.';
  }
  if (/timeout|ETIMEDOUT|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN/i.test(e)) {
    return 'We could not reach our email server just now. Please try again in a minute.';
  }
  return 'We could not send your sign-in code. Please try again later.';
}

module.exports = { sendMail, mailConfigured, verifyMail, sendFailureMessage };
