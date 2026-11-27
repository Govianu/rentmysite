// Checks the two follow-up templates directly with MyOperator and creates them if missing.
//   node scripts/templates-check.js
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), override: true });
const myop = require('../lib/myop');
const { TEMPLATES } = require('../lib/followup');

(async () => {
  console.log('Test mode (MYOP_DRY_RUN):', process.env.MYOP_DRY_RUN || '(not set = off)');
  console.log('WhatsApp Business Account id:', await myop.wabaId().catch((e) => 'ERROR ' + e.message));
  let list = await myop.listTemplates();
  console.log(`Templates in MyOperator: ${list.length}`);
  for (const t of TEMPLATES) {
    let found = list.find((x) => x.name === t.name);
    if (!found) {
      console.log(`${t.name}: not there – creating now…`);
      try {
        const r = await myop.waRequest('POST', '/chat/templates', { ...t, waba_id: await myop.wabaId() });
        console.log('  MyOperator answered:', JSON.stringify(r).slice(0, 400));
      } catch (e) {
        console.log('  ERROR:', e.message);
      }
      list = await myop.listTemplates();
      found = list.find((x) => x.name === t.name);
    }
    console.log(`RESULT ${t.name}: ${found ? found.status : 'NOT FOUND'}`);
  }
  const similar = list.filter((x) => /follow/i.test(x.name)).map((x) => `${x.name} (${x.status})`);
  if (similar.length) console.log('Other follow-up templates:', similar.join(', '));
})().catch((e) => console.log('ERROR:', e.message));
