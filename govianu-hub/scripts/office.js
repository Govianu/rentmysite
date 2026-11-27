// Set the office the AI invites interested clients to:
//   node scripts/office.js "Full address" "https://maps.app.goo.gl/xxxx" ["Mon-Sat 10am-7pm"]
//   node scripts/office.js            -> show the current office
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const BASE = `http://127.0.0.1:${process.env.PORT || 4100}/api`;
const headers = { 'Content-Type': 'application/json', 'X-Hub-Key': process.env.HUB_API_KEY || '', 'X-Hub-Actor': process.env.AUTOPILOT_ACTOR || 'media@govianu.com', 'X-Hub-Admin': '1' };
(async () => {
  const [address, map, hours] = process.argv.slice(2);
  if (address) {
    const ai = { officeAddress: address };
    if (map) ai.officeMap = map;
    if (hours) ai.officeHours = hours;
    const r = await fetch(BASE + '/settings', { method: 'POST', headers, body: JSON.stringify({ ai }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  }
  const me = await (await fetch(BASE + '/me', { headers })).json();
  const a = me.settings?.ai || {};
  console.log('Office address:', a.officeAddress);
  console.log('Map link:      ', a.officeMap);
  console.log('Hours:         ', a.officeHours);
})().catch((e) => { console.error('Error:', e.message); process.exit(1); });
