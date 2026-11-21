# RentMySite.ai

The public website (homepage, enquiry form, terms) plus partner dashboards, in one Node.js app.
Data is stored in `data/app-data.json` (created on first start).

## Run it

```bash
cp .env.example .env     # fill in JWT_SECRET, ADMIN_INVITE_CODE, APP_URL and email settings
npm install
npm run dev              # http://localhost:3000
```

For local testing, set `APP_URL=http://localhost:3000` and remove `NODE_ENV=production`. Without `BREVO_API_KEY` or SMTP settings, every email is saved to `data/outbox/` (open the .html files in a browser), and the sign-in flow shows a local test code. Never enable this test-code response in production.

## Passwordless email sign-in

1. A new partner creates a profile and enters their email address.
2. The app emails a six-digit verification code. Codes expire in 10 minutes, can be used once, and allow at most five verification attempts.
3. Entering a valid code verifies the email and signs the user into the correct dashboard. Existing accounts also use this flow; passwords are no longer accepted.
4. The login page uses the same email-code flow. Responses for unknown emails do not disclose whether an account exists.

## How an enquiry works

1. A visitor fills the form on the homepage and presses **Continue**. Email is required so we can send the dashboard verification code.
2. A **terms step** appears with the key terms, links to the full Terms and Privacy Policy, and a checkbox. **Agree and continue** stays disabled until the box is ticked. Nothing is sent before that.
3. The server (`POST /api/enquiry`) checks the terms were accepted, then:
   - stores the enquiry with the terms version, time, IP and browser as proof of consent;
   - creates a business dashboard for "A business" or an associate dashboard for "A professional";
   - adds a lead to the admin CRM;
   - emails the team inbox with every detail, and emails the visitor a one-time verification code to open their dashboard.
4. Visitors can enter that code on `/login.html`. Existing activation links remain compatible and now open the dashboard without setting a password.
5. To resend, use **Email another code** after enquiring or **Send a new code** on the login page.

## Dashboard profiles and media

- Business accounts get category-specific growth suggestions, booking emails, onboarding steps and media prompts for restaurants, cafes, hotels, salons, gyms, banquet venues and offices.
- Business owners can upload menu/service PDFs, photos, promo videos and PDF slide decks.
- Associates can maintain a professional bio, skillset and availability, and upload intro videos, portfolio photos, PDF slides and course materials.
- Uploads are actual files stored on disk, privately served to the owner and RentMySite reviewers, and shown in dashboard galleries. New items enter the RentMySite review queue.
- Supported uploads: JPG/PNG/WebP/GIF images (10 MB), MP4/WebM videos (100 MB), and PDF menus/slides/course files (25 MB). Each account has a 300 MB quota; the site-wide limit is 800 MB.
- Local files are stored under `data/uploads/` by default. On the VPS, set `DATA_DIR` and `UPLOAD_DIR` to a folder outside the code, such as `DATA_DIR=/var/lib/rentmysite` and `UPLOAD_DIR=/var/lib/rentmysite/uploads`, and back it up.
- Both dashboards keep quick actions visible for common tasks.

## Booking emails

- New booking request (from `/book.html?h=<handle>`): the business gets an email with a **Review and accept** button that opens the bookings tab after login.
- The business ticks the partner agreement and presses **Accept** on the dashboard. Both the business and the person who booked get a confirmation email (with the Meet link when Google is connected).

## Pages

| Page | What it is |
|---|---|
| `/` | Homepage (the existing site), with the terms step on the enquiry form and a Log in link |
| `/login.html` | Create a profile or sign in with a one-time email code |
| `/activate.html` | Open an older one-time email link without setting a password |
| `/terms.html` | Terms and Conditions + Privacy Policy (draft: have it reviewed by a lawyer) |
| `/business.html`, `/associate.html`, `/admin.html` | Dashboards. Admin has a new **Website enquiries** tab |
| `/book.html?h=<handle>` | Public booking request page for a venue |

When you change the terms, update `TERMS_VERSION` in `utils/terms.js`.

OTP attempt and request limits currently use in-memory rate limiting. Run a single application instance or replace that limiter with shared storage before scaling horizontally.

Run the focused upload and OTP tests with `node --test`.

## Deploying on a VPS (Apache + nginx, public_html)

The site has two parts:
- **Pages** (HTML, CSS, JS): `npm run build` writes them as static files, which Apache/nginx serve from `public_html`.
- **The API** (sign-in, dashboards, email, uploads, deals, lesson videos): a Node.js process (Node 20 or newer) kept
  running by PM2. The `.htaccess` that the build writes forwards every `/api/...` request to it on `127.0.0.1:PORT`.

Both are needed: the pages alone load, but sign-in and every dashboard button call `/api`.

1. Install Node 20 and PM2 (Rocky/Alma/CentOS shown; on Ubuntu use `deb.nodesource.com` and `apt`):
   ```sh
   curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
   dnf install -y nodejs git
   npm install -g pm2
   ```
2. Get the code **outside** `public_html` (the code and `.env` must not be downloadable), and install it:
   ```sh
   git clone https://github.com/Govianu/rentmysite.git /home/<user>/rentmysite
   cd /home/<user>/rentmysite && npm ci --omit=dev
   ```
3. Create `.env` in that folder from `.env.example`. Set at least `NODE_ENV=production`, a long random `JWT_SECRET`,
   `ADMIN_INVITE_CODE`, `APP_URL=https://rentmysite.ai`, `PORT` (a free local port, e.g. 3000),
   `DATA_DIR`/`UPLOAD_DIR` (a folder outside `public_html`, e.g. `/home/<user>/pmb-data`), the email settings
   (`SMTP_*` or `BREVO_API_KEY`, `MAIL_FROM`, `TEAM_INBOX`) and `HIGGSFIELD_API_KEY_ID`/`HIGGSFIELD_API_KEY_SECRET`.
4. Start the API and keep it running after reboots:
   ```sh
   pm2 start ecosystem.config.js && pm2 save && pm2 startup
   ```
5. Build the pages into `public_html`:
   ```sh
   BUILD_OUT=/home/<user>/public_html npm run build
   ```
   This writes the pages, `js/catalog.js` and the `# BEGIN rentmysite` block of `public_html/.htaccess`.
   Other files in `public_html` and the rest of `.htaccess` are left alone. Written files get 644 and folders 755, and
   when root runs the build they are given to `public_html`'s own owner and group (on CWP, e.g. `partner:nobody`),
   so don't `chown` them to `user:user` afterwards: Apache reads them through the `nobody` group. (`npm run build` alone writes to `dist/`;
   then copy it with `cp -a dist/. /home/<user>/public_html/`, including the hidden `.htaccess`.)
6. Apache needs `mod_rewrite`, `mod_proxy` and `mod_proxy_http` for the `/api` forwarding (on cPanel/WHM:
   EasyApache, usually already on). Check it: `curl https://rentmysite.ai/api/auth/options` should return JSON.
   A 404 there means the proxy modules are off, and a 503 means the API isn't running (`pm2 status`).
   If you can edit the nginx site config instead, `deploy/nginx-api.conf.example` sends `/api` straight to Node.
7. To deploy an update:
   ```sh
   cd /home/<user>/rentmysite && git pull && npm ci --omit=dev
   BUILD_OUT=/home/<user>/public_html npm run build && pm2 reload rentmysite
   ```

Check `pm2 logs rentmysite` for `[mail] SMTP connection OK` and `[lesson-video]` lines. Back up `DATA_DIR`
regularly: it holds accounts, bookings, uploads and lesson videos. Some VPS providers block outbound email ports; if
the log shows `SMTP connection failed`, try `SMTP_PORT=587` or ask the provider to open it. Rate limits are kept in
memory, so run a single API instance (as the PM2 config does). Visitor IPs are read through nginx and Apache on
`127.0.0.1`; if your proxies use other addresses, set `TRUST_PROXY` (see `.env.example`).

The Node server also serves the pages itself (as on a laptop with `npm start`), so a plain reverse proxy to it without
`public_html` works too: see `deploy/nginx.conf.example`.

## Dashboards: business-type specific, with skills and video lessons

Everything a partner sees is built from their exact business type, one of the 100 on the homepage (`utils/catalog.json`):
emails ("Magic Masala, your restaurant"), slides, skill suggestions, lessons, earnings planner and "Ways to earn" ideas.

- On first visit the dashboard asks for skills. Six lessons are built from them: who pays, what you already have,
  a step-by-step workflow, an illustrative earnings figure and a "Help me launch this" button.
- The call to action stays on screen on every page (bottom bar on phones). Pressing it adds a lead to the
  admin CRM and emails the team inbox (`routes/growth.js`).
- The photo/media sections and Supply savings were removed; the upload code stays on the server.
- Business menu: Overview, Learn & earn (lessons + growth ideas), Booking requests, Profile.
- The main button is worded for each business type ("Launch dining memberships"), and every idea card has its own launch button.

### AI presenter videos (Higgsfield)

Lessons can be real videos of an AI presenter speaking the lesson. Videos are made **only when someone opens a
lesson**, then saved on your server and reused for everyone with the same business type and topic, so each one is
paid for once. Until a video is ready, the person sees "Your AI presenter is recording this lesson" with the slide
version available; it swaps in automatically.

Each video is made with [Higgsfield](https://docs.higgsfield.ai) in two steps:
1. **Image:** a photo of the presenter in a setting that fits the business type (Soul V2, text to image). It is also
   the video's poster, and it shows behind the "recording" message while the video is made.
2. **Video:** that photo brought to life, speaking the lesson in up to 6 shots of up to 15 seconds each
   (Kling 3.0 Pro, image to video with native sound).

Setup:
1. Sign up at console.higgsfield.ai, create an API key (you get a key ID and a secret) and add credit.
2. Add `HIGGSFIELD_API_KEY_ID` and `HIGGSFIELD_API_KEY_SECRET` to `.env`, then run `npm run higgsfield:check`
   to check them. It makes one small image and prints its link.
3. `HIGGSFIELD_MONTHLY_MINUTES` caps new video minutes per month (default 20). Above it, lessons show the slides instead.
   Higgsfield has no free test mode, so watch a first video before raising it.
4. Optional: `HIGGSFIELD_PRESENTER` describes the presenter, and `HIGGSFIELD_SEED` keeps them looking alike across lessons.
   `HIGGSFIELD_IMAGE_MODEL` and `HIGGSFIELD_VIDEO_MODEL` switch to other Higgsfield models with the same inputs.

Speech comes from the video model's own audio, guided by the script in each shot's prompt, so check that a first
video says the lines clearly before relying on it. Scripts are written on the server (`utils/lessonScript.js`), never
sent from the browser, so nobody can create videos of their own text. Finished videos and posters are stored in
`data/lesson-videos/` (Higgsfield deletes its own copies about 7 days after they are made), so keep `data/` on a
persistent disk. Videos made earlier with HeyGen keep playing.

## Marketplace (buyers and sellers, with RentMySite in the middle)

| Who | Where | What they do |
|---|---|---|
| Business | My spaces, Booking requests, Find & book | Publish spaces and free slots; accept or decline requests; book professionals or other spaces |
| Professional | My offers, Find & book | Publish services with a price; accept or decline requests; book spaces for workshops |
| Buyer (event manager, company, individual) | `/buyer.html` | Search, request, follow each request; "Find it for me" |
| Anyone | `/find.html` | Search and request without an account |
| RentMySite team (Govianu employees only) | `/admin.html` > Marketplace | Approve matches, collect RentMySite's share, take listings down |

Flow (`utils/deal.js`):
1. **Seller publishes** an opportunity: it is live for buyers straight away, and the team inbox (`TEAM_INBOX`,
   info@rentmysite.ai) gets an email. The team can take a listing down with a note.
2. **Buyer requests** it: the request goes straight to the seller (the team inbox gets a copy).
3. **Seller accepts**: buyer and seller match. The team inbox gets "Approve match" and the deal waits in the RentMySite dashboard.
4. **RentMySite approves**, setting the agreed amount, the split and who pays RentMySite's share. RentMySite's share is the platform line of
   the split (25% on the 4-way split). With Razorpay keys set, a Razorpay payment link is created and emailed.
5. **Share received**: press "Share received" (with Razorpay the link's status is checked; otherwise enter the UTR or
   reference). It's a match: buyer and seller get each other's email and phone, and the team gets a copy.

Until step 5, buyers and sellers never see each other's email or phone.

### After sign-up: opportunity emails and the human touch
- **Agreement:** the homepage form's last step is a short partnership agreement (partner in principle, group deals,
  RentMySite as the single point of contact and billing, net not gross, equipment funding repaid first). The full text is in
  `/terms.html`; each sign-up records the terms version it agreed to (`utils/terms.js`).
- **Opportunity emails** (`utils/drip.js`): five emails, `DRIP_INTERVAL_DAYS` apart (default 3), built from each
  person's business type: services, products, partners, spare space and quiet hours, then "shall we set this up?".
  Sent 9am–7pm IST, each with a one-tap dashboard button, replies to the team inbox and a one-click unsubscribe
  (`/api/public/unsubscribe`). New sign-ups start automatically; set `DRIP_ENROLL_EXISTING=true` once to add
  earlier partners.
- **Dashboard strip:** the overview shows the person's RentMySite manager (call and WhatsApp), real network numbers
  (hidden below `COMMUNITY_MIN_COUNT`) and an example for their business type. Nothing shown there is invented.

### The CTA, cost saving and the team's research
- **CTA** (`utils/cta.js`): one document per business or professional that brings it all together: feasibility
  (what sits idle, verdict), revenue opportunities with investment and time to first revenue, cost saving, how money
  is shared (25% each to infrastructure partner, owner, lead generator and RentMySite, on net), and the commercial terms
  they view and agree to online. Before signing up, `/cta.html` shows it for the chosen business type; at sign-up it
  is emailed with their lead ID; in the dashboard it is under **My CTA**.
- **Lead IDs** (`utils/leadId.js`): `RMS-NOV26-01` style, given at sign-up, on the account, the CRM lead, team email
  subjects, the CTA and the dashboard.
- **Cost saving** (`utils/costSaving.js`): five ways to save per kind of business (top costs, how, typical saving,
  worked example), in the dashboard under **Save costs**, in the CTA and in the emails.
- **Opportunity emails** (`utils/drip.js`): ten emails, three days apart, alternating revenue and cost saving.
- **Team research from Google Drive** (`utils/playbook.json`, built by `scripts/build-playbook.py` from the
  "Business.network.revenue" folder): 240 business/professional types matched to the 100 website types, with what
  sits idle, five opportunities, partners, a 30-second hook, and the type's videos and creatives. Prospect names and
  contact details are not copied. Creatives are fetched from Drive once and served from `DATA_DIR/media-cache`
  (`/api/public/media/:id`, research files only); videos play in Drive's player, so keep those files link-shared.
- **Financial planning** for professionals (dashboard): committed income over 3–12 months and help applying to a bank.

### RentMySite team access
Only accounts with a Govianu email (`STAFF_EMAIL_DOMAINS`, default `govianu.com`) can open the RentMySite team dashboard.
The team signs in at **`/team.html`**: enter a @govianu.com email, get a one-time code (and a one-tap button) in that
inbox, and land on the dashboard. The first sign-in creates that person's team account, since owning the inbox proves
they work at Govianu. Buttons in team emails open this page on the right tab (Leads, Marketplace, Enquiries).
Older team accounts with other emails are refused. Govianu employees can keep business, professional or buyer
dashboards on the same email and switch between them.

