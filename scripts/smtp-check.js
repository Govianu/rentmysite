// Find the Zoho mail server that accepts SMTP_USER / SMTP_PASS from .env, save it, and send a test email.
//   node scripts/smtp-check.js
require('dotenv').config({ quiet: true });
const nodemailer = require('nodemailer');
const { execFileSync } = require('child_process');
const path = require('path');

const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;
if (!user || !pass) throw new Error('SMTP_USER / SMTP_PASS missing in .env');
const hosts = [...new Set([process.env.SMTP_HOST, 'smtp.zoho.in', 'smtp.zoho.com', 'smtppro.zoho.in', 'smtppro.zoho.com'].filter(Boolean))];

(async () => {
  console.log(`Checking the login for ${user} (password length ${pass.length})…`);
  for (const host of hosts) {
    for (const port of [465, 587]) {
      const t = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass }, connectionTimeout: 10000 });
      try {
        await t.verify();
        console.log(`WORKS: ${host} port ${port}`);
        execFileSync(process.execPath, [path.join(__dirname, 'set-env.js'), path.join(__dirname, '..', '.env'), `SMTP_HOST=${host}`, `SMTP_PORT=${port}`], { stdio: 'inherit' });
        const info = await t.sendMail({ from: process.env.MAIL_FROM || user, to: process.env.TEAM_INBOX || user, subject: 'Test from rentmysite.ai', html: '<p>Website email is working.</p>' });
        console.log(`TEST EMAIL SENT to ${process.env.TEAM_INBOX || user} (${info.response})`);
        console.log('Now run: pm2 restart rentmysite --update-env');
        return;
      } catch (e) {
        console.log(`  no:  ${host} port ${port} – ${String(e.message).slice(0, 90)}`);
      }
    }
  }
  console.log('\nNONE WORKED. The password is not accepted for this mailbox. In Zoho, sign in AS info@rentmysite.ai, then:');
  console.log('  1) Settings → Mail Accounts → IMAP/POP/SMTP: make sure SMTP access is ON');
  console.log('  2) My Account → Security → App Passwords: create a new one and set it again');
})();
