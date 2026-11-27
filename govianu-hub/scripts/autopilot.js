// Switch the follow-up autopilot on (or check it) from the server, without the dashboard.
//   node scripts/autopilot.js            → on, 100 a day (RentMySite)
//   node scripts/autopilot.js 150        → on, 150 a day
//   node scripts/autopilot.js status     → show what it is doing
//   node scripts/autopilot.js stop       → off
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const BASE = `http://127.0.0.1:${process.env.PORT || 4100}/api`;
const headers = {
  'Content-Type': 'application/json',
  'X-Hub-Key': process.env.HUB_API_KEY || '',
  'X-Hub-Actor': process.env.AUTOPILOT_ACTOR || 'media@govianu.com',
  'X-Hub-Actor-Name': 'Autopilot',
  'X-Hub-Admin': '1',
};

async function call(method, path, body) {
  const r = await fetch(BASE + path + '?brand=rentmysite', { method, headers, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}

(async () => {
  if (!process.env.HUB_API_KEY) throw new Error('HUB_API_KEY missing in .env');
  const arg = process.argv[2] || '';
  if (arg === 'stop') {
    await call('POST', '/campaign/autopilot/stop', {});
    console.log('Autopilot stopped.');
  } else if (arg !== 'status') {
    const r = await call('POST', '/campaign/autopilot', { perDay: Number(arg) || 100 });
    console.log(`Autopilot ON – ${r.perDay} a day, one every ${Math.round(r.gapSec / 60)} min between 10:00 and 19:00.`);
    for (const t of r.templates) console.log(`  template ${t.name}: ${t.ok ? 'submitted to Meta (or already there)' : 'ERROR ' + t.error}`);
  }
  const me = await call('GET', '/me');
  const o = await call('GET', '/overview?range=all');
  console.log(`Status: ${me.autopilot.on ? me.autopilot.status || 'starting…' : 'off'}`);
  console.log(`Leads: ${o.leads} | queued ${o.campaign.queued} | sent ${o.campaign.sent} | replied ${o.campaign.replied} | failed ${o.campaign.failed} | sent today ${me.sentToday.count || 0}`);
})().catch((e) => {
  console.error('Error:', e.message, '(is the hub running? pm2 status govianu-hub)');
  process.exit(1);
});
