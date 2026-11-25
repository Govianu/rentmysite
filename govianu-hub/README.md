# Govianu Hub

The central team dashboard for **RentMySite** and **PartnerMyBusiness**:

- **Home**: two tiles. Each opens that business's dashboard (Overview · Inbox · Leads · Calls · Team · Campaign), and there's a link to the existing site admin.
- **Every WhatsApp message and call on the MyOperator number (810)** comes in through MyOperator Webhooks v2. Each one is filed under the lead and credited to the employee who handled it.
- **Inbox**: customers waiting for a human. The assigned employee is alerted at once (Hub 🔔, WhatsApp, desktop notification), reminded every 15 minutes, and admins are alerted at 30 minutes.
- **AI** replies to the customer within about 20 seconds while staff are busy, and flags qualified leads.
- **Team**: per employee, the numbers below, plus a full activity timeline.
  - leads assigned and not yet contacted
  - people contacted
  - calls out and in, connected, talk time, missed calls on their leads
  - recordings
  - WhatsApp messages sent and chats replied to, average reply time
  - customers waiting now
  - qualified and signed
- **Campaign**: imports the RentMySite sheet (CSV, Google Sheet, or the website's own sign-ups with emails). Sends an approved WhatsApp template from 810 plus an email, within a daily cap and sending hours.

## How "who did what" is decided

| Action | Credited to |
|---|---|
| WhatsApp reply typed in the Hub | the signed-in employee |
| WhatsApp reply typed in MyOperator's chat panel | the MyOperator user (`message_by`), linked to the employee |
| Call (in or out) via MyOperator | the agent in MyOperator's `call.summary` (auto-linked when the MyOperator user's email = the employee's @govianu.com email) |
| Campaign / AI messages | "Campaign" / "AI assistant" |

MyOperator users who aren't linked yet show up under **Team → MyOperator users not linked**. Link them once, and everything they did earlier is credited to them as well.

## Run locally

```bash
npm install
cp .env.example .env      # fill in values (see comments)
npm run dev               # http://localhost:4100
npm run simulate          # replays MyOperator sample webhooks (WhatsApp in, panel reply, calls)
```

With `MYOP_DRY_RUN=true`, nothing is sent to MyOperator. Without SMTP, the sign-in code is shown on screen (local only).

## How the websites use it

The team works in each website's own dashboard: **rentmysite.ai/admin.html → WhatsApp & Calls** and **partnermybusiness.ai/admin.html → WhatsApp & Calls**. Each site's `routes/hub.js` forwards the signed-in team member's requests to this Hub on `127.0.0.1:4100`, always for that site's brand. The shared secret `HUB_API_KEY` never reaches the browser. The Hub's own page (port 4100) is only for setup and the two tiles.

## Deploy on the VPS (94.136.188.14)

This folder lives inside the rentmysite repo, so `git pull` in the rentmysite folder brings it along.

1. Start the Hub (first time):
   ```sh
   cd /backup/nodejsfiles/rentmysite/govianu-hub      # wherever the rentmysite repo is checked out
   npm ci --omit=dev
   cp .env.example .env && nano .env
   #   JWT_SECRET, ADMIN_EMAILS, MYOP_COMPANY_ID, MYOP_API_KEY, MYOP_WEBHOOK_TOKEN, HUB_API_KEY (random, long)
   #   MYOP_DRY_RUN=false   SMTP_*   ANTHROPIC_API_KEY   MYOP_CALL_TOKEN (recordings)
   #   RMS_DATA_FILE / PMB_DATA_FILE = the two sites' data/app-data.json (their DATA_DIR on the VPS)
   pm2 start ecosystem.config.js && pm2 save
   ```
   Later updates: `cd …/rentmysite && git pull && cd govianu-hub && npm ci --omit=dev && pm2 restart govianu-hub`.
2. In **both** sites' `.env`: `HUB_URL=http://127.0.0.1:4100` and `HUB_API_KEY=<the same value as in the Hub .env>`, then `pm2 restart rentmysite partnermybusiness`.
3. Public HTTPS address for MyOperator's webhooks. `govianu.com` is the live company website, so use **hub.govianu.com**, or `govianu.com/hub` with `BASE_PATH=/hub`:
   - DNS: **A record** `hub` → `94.136.188.14`.
   - Web server: use `deploy/nginx-hub.conf.example` (or the Apache equivalent: a ProxyPass to `127.0.0.1:4100`), then `certbot --nginx -d hub.govianu.com`. MyOperator only calls **https** webhooks.
4. MyOperator → APIs & Webhooks → **Webhooks v2 → Add new**. Don't edit the existing one: it feeds MyOperator's own integration.
   - URL: `https://hub.govianu.com/api/webhooks/myoperator`
   - Additional header: `X-Webhook-Token` = the `MYOP_WEBHOOK_TOKEN` from `.env`
   - Events: **Call events** (call.end, call.summary, disposition) and **WhatsApp events** (all)
5. Each team member opens **WhatsApp & Calls** in the site dashboard once, which adds them to the Hub. Then they enter their WhatsApp number on the Hub profile, so alerts reach them.
6. Send one WhatsApp message to 810 from any phone. The Hub learns the WhatsApp `phone_number_id` from it, and Settings shows it. Then use **Campaign → Send test to this number** before queueing real leads.
7. For call recordings: MyOperator → Developer API → **Calling APIs** → copy the token into `MYOP_CALL_TOKEN`, then restart the hub (`pm2 restart govianu-hub`).

## WhatsApp rules (Meta)

- The first message to someone who hasn't written in the last 24 hours must be an **approved template**. The campaign and the "closed window" reply box only offer templates.
- Staff alerts sent as WhatsApp need either an approved utility template (set it in Settings → Reminders) or the employee having messaged 810 within 24 hours. Alerts always appear in the Hub 🔔 regardless.

## Files

- `lib/engine.js`: webhook processing, attribution, AI, reminders, campaign
- `lib/myop.js`: MyOperator API (send message/template, templates, recordings)
- `lib/metrics.js`: overview and per-employee numbers
- `lib/leads.js`: imports, assignment, DND/skip rules
- `public/index.html`: the dashboard
- `data/hub-data.json`: all data (back it up; keep one PM2 instance)
