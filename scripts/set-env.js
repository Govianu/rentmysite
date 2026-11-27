// Set values in a .env file safely (adds or replaces lines; nothing else changes).
//   node scripts/set-env.js .env TEAM_INBOX=info@rentmysite.ai MAIL_FROM="RentMySite.ai <info@rentmysite.ai>"
//   SECRET=xyz node scripts/set-env.js .env SMTP_PASS=ENV:SECRET     (value read from an environment variable)
const fs = require('fs');
const [file, ...pairs] = process.argv.slice(2);
if (!file || !pairs.length) throw new Error('usage: node scripts/set-env.js <.env file> KEY=VALUE ...');
let text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
for (const pair of pairs) {
  const i = pair.indexOf('=');
  if (i < 1) throw new Error(`not KEY=VALUE: ${pair}`);
  const key = pair.slice(0, i);
  let value = pair.slice(i + 1);
  if (value.startsWith('ENV:')) value = process.env[value.slice(4)] || '';
  if (!value) { console.log(`${key}: empty – not changed`); continue; }
  // dotenv reads quoted values literally, so pick a quote character the value doesn't contain
  const q = !/[\s#"'<>`]/.test(value) ? '' : !value.includes("'") ? "'" : !value.includes('"') ? '"' : '`';
  const line = `${key}=${q}${value}${q}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  text = re.test(text) ? text.replace(re, () => line) : `${text.replace(/\n?$/, '\n')}${line}\n`;
  console.log(`${key}: set${/PASS|KEY|SECRET|TOKEN/.test(key) ? ' (hidden)' : ' to ' + value}`);
}
fs.writeFileSync(file, text);
