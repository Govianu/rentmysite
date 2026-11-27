// Clients the AI sent the office location to: see who (default) or send them the "upload your plot first" correction.
//   node scripts/location-fix.js          -> list
//   node scripts/location-fix.js send     -> send the correction (only possible within WhatsApp's 24-hour window)
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const BASE = `http://127.0.0.1:${process.env.PORT || 4100}/api`;
const headers = { 'Content-Type': 'application/json', 'X-Hub-Key': process.env.HUB_API_KEY || '', 'X-Hub-Actor': process.env.AUTOPILOT_ACTOR || 'media@govianu.com', 'X-Hub-Admin': '1' };
(async () => {
  const send = process.argv[2] === 'send';
  const r = await fetch(BASE + '/ai/location-fix', { method: 'POST', headers, body: JSON.stringify({ send }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  if (!j.rows.length) return console.log('Nobody was sent the office location. Nothing to do.');
  console.log(`${j.rows.length} client(s) were sent the office location:`);
  for (const x of j.rows) {
    const st = x.sent ? 'correction SENT' : x.done ? 'correction already sent' : x.error ? 'ERROR ' + x.error : x.window ? 'can be sent now' : 'chat closed (over 24 h) - team should call or WhatsApp them';
    console.log(`  +${x.phone}  ${x.name || ''}  ->  ${st}`);
  }
  if (!send && j.rows.some((x) => x.window && !x.done)) console.log('\nTo send the correction now: node scripts/location-fix.js send');
})().catch((e) => { console.error('Error:', e.message); process.exit(1); });
