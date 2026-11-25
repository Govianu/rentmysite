// Sends MyOperator-shaped webhook events (copied from MyOperator's Postman docs) to a local Hub.
// Usage: node test/simulate.js [scenario]   scenarios: wa-in | wa-panel-reply | call-in | call-missed | call-out | all
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const URL = `http://127.0.0.1:${process.env.PORT || 4100}${process.env.BASE_PATH || ''}/api/webhooks/myoperator`;
const CUSTOMER = process.env.SIM_CUSTOMER || '919900011122';
const AGENT = { uuid: 'myop-user-zoha', name: 'Zoha Salehi', email: process.env.SIM_AGENT_EMAIL || 'zoha@govianu.com', contact: '+919000000001', extension: '10' };
const iso = (ms = 0) => new Date(Date.now() + ms).toISOString();
const id = () => Math.random().toString(36).slice(2);

const env = (event_type, channel, direction, payload, extra = {}) => ({
  company_id: process.env.MYOP_COMPANY_ID,
  event_id: `event-${id()}`,
  event_type,
  event_sequence: 1,
  event_version: '1',
  timestamp: iso(),
  channel,
  direction,
  session_id: extra.session_id || id(),
  system_identifier: extra.system_identifier ?? '1196177000238423',
  customer_identifier: extra.customer_identifier || CUSTOMER,
  payload,
});

const conversation = { id: 'conv-1', customer_country_code: '91', customer_contact: CUSTOMER.slice(2), customer_name: 'Ravi Kumar', assigned_to: null, status: 'open', expire_at: iso(24 * 3600e3) };

const scenarios = {
  'wa-in': () => [
    env('message.received', 'whatsapp', 'incoming', {
      id: id(), message_by: null, action: 'incoming', status: 'received',
      data: { type: 'text', context: { body: process.env.SIM_TEXT || 'Hi, I have a 2BHK flat in HSR Layout lying empty. What exactly do you do?' } },
      metadata: { myop_ref_id: null }, created: iso(), conversation, phone_number_id: '1196177000238423', mode: 'lc', source: 'lc',
    }),
  ],
  'wa-panel-reply': () => [
    env('message.sent', 'whatsapp', 'outgoing', {
      id: id(), message_by: AGENT.uuid, action: 'outgoing', status: 'sent',
      data: { type: 'text', context: { body: 'Hello Ravi, Zoha here from RentMySite. Can I call you in 10 minutes?' } },
      metadata: { myop_ref_id: id() }, created: iso(), conversation, phone_number_id: '1196177000238423', source: 'lc',
    }),
  ],
  'call-in': () => {
    const sid = `s4.${Date.now()}`;
    const legs = [
      { leg_index: 1, type: 'customer', phone_number: '+' + CUSTOMER, result: 'connected', talk_duration: 95, agent: null },
      { leg_index: 2, type: 'agent', phone_number: AGENT.contact, result: 'answered', dial_status: 'ANSWER', talk_duration: 88, ring_duration: 6, agent: AGENT },
    ];
    const base = { id: sid, direction: 'incoming', customer_number: '+' + CUSTOMER, status: 'bridged', started_at: iso(-100e3), ended_at: iso(), category: 'incoming', duration: 100, recording_filename: 'abc123-v2.mp3', legs };
    return [env('call.end', 'call', 'incoming', base, { session_id: sid, system_identifier: '+918103990990' }), env('call.summary', 'call', 'incoming', { ...base, comments: [] }, { session_id: sid, system_identifier: '' })];
  },
  'call-missed': () => {
    const sid = `s4.${Date.now()}m`;
    const legs = [
      { leg_index: 1, type: 'customer', phone_number: '+' + CUSTOMER, result: 'connected', agent: null },
      { leg_index: 2, type: 'agent', phone_number: AGENT.contact, result: 'not_answered', dial_status: 'NO ANSWER', ring_duration: 25, agent: AGENT },
    ];
    return [env('call.summary', 'call', 'incoming', { id: sid, direction: 'incoming', customer_number: '+' + CUSTOMER, status: 'missed', started_at: iso(-40e3), ended_at: iso(), category: 'incoming', duration: 30, recording_filename: '', legs, comments: [] }, { session_id: sid, system_identifier: '' })];
  },
  'call-out': () => {
    const sid = `s4.${Date.now()}o`;
    const legs = [
      { leg_index: 1, type: 'agent', phone_number: AGENT.contact, result: 'answered', dial_status: 'ANSWER', talk_duration: 140, agent: AGENT },
      { leg_index: 2, type: 'customer', phone_number: '+' + CUSTOMER, result: 'answered', talk_duration: 140, agent: null },
    ];
    return [env('call.summary', 'call', 'outgoing', { id: sid, direction: 'outgoing', customer_number: '+' + CUSTOMER, status: 'bridged', started_at: iso(-150e3), ended_at: iso(), category: 'oneway', duration: 150, recording_filename: 'out456-v2.mp3', legs, comments: [] }, { session_id: sid, system_identifier: '' })];
  },
};

(async () => {
  const which = process.argv[2] || 'all';
  const list = which === 'all' ? ['wa-in', 'wa-panel-reply', 'call-missed', 'call-out', 'call-in'] : [which];
  for (const s of list) {
    for (const ev of scenarios[s]()) {
      const r = await fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Webhook-Token': process.env.MYOP_WEBHOOK_TOKEN || '' }, body: JSON.stringify(ev) });
      console.log(`${s}: ${ev.event_type} → HTTP ${r.status}`);
      await new Promise((res) => setTimeout(res, 400));
    }
  }
})();
