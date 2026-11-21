# Changes in this update

Compared with the rentmysite-site.zip you sent. Your existing uncommitted work (OTP login,
media uploads, tests) is untouched; run `git status` to see everything not yet committed.

## Emails speak the partner's business type
- `utils/catalog.json` + `utils/catalog.js`: the homepage's 100 business types and professions in one shared file.
- `utils/industry.js`: wording now comes from that catalog ("restaurant", "an electrician").
- `utils/emails.js`: "thank you for telling us about Magic Masala, your restaurant", type-specific ideas and partners,
  tidy first names ("Divyaj.govianu05" becomes "Divyaj").
- `routes/enquiry.js`, `public/index.html`: the homepage now sends the exact type picked, and it's saved on the account.
- `utils/ai.js`: "Ways to earn" ideas built from each type's own data instead of three generic ideas.

## Dashboards
- Photo/media sections removed from `public/business.html` and `public/associate.html` (server upload code kept).
- New `public/js/growth.js` + `public/css/growth.css`: type-specific slides, skills picker, six lessons built from the
  partner's skills, earnings planner, next-steps checklist, and a call to action on every page.
- `routes/growth.js`: saves skills and lesson progress; the call to action creates a CRM lead and emails the team.
- `public/js/business.js`, `public/js/associate.js`, `public/js/api.js`, `routes/*`: wiring for the above.

## CTA as policies only, no direct contact, slides with "Enquire for more", phone required
- The CTA now holds the policies only (no feasibility, revenue or cost-saving sections); those stay in the dashboard
  and emails. Its intro text on the homepage is gone. Terms version 2026-11-20.2.
- No direct contact: buyers, businesses and partners never get each other's phone, email or address, not even after a
  match; the RentMySite team coordinates everything. Match emails and dashboards say so; no joint onboarding call.
- Homepage: every opportunity is a slide (the team's creative, or a text slide) with "Enquire for more", which fills the
  enquiry form; every section ends with "Enquire & sign up".
- Phone number is required on the homepage form and the sign-up page (checked on the server too).

## CTA, cost saving, lead IDs and the team's Drive research
- The agreement is now the **CTA**, viewed (`/cta.html`) and agreed online, with nothing else to sign.
- The CTA brings together feasibility, revenue, cost saving, money split and terms; emailed at sign-up with the lead ID
  and kept in the dashboard (**My CTA**).
- Lead IDs `RMS-NOV26-01` for every sign-up (account, CRM lead, team emails, CTA, dashboard).
- Cost saving for every business type (**Save costs** in the dashboard, the CTA, emails).
- Ten emails alternating revenue and cost saving, using the team's research and creatives.
- The team's Google Drive research (240 types, videos, creatives) on the homepage and dashboards.
- Financial planning for professionals.
- Several one-tap sign-in links can be active at once (welcome and CTA emails both work).

## Agreement, opportunity emails and a human touch (from the boss's review)
- Business and profession dropdowns are A to Z everywhere.
- The homepage's last step is now "Your partnership agreement", with the commercial points; terms version 2026-11-20.1.
- `utils/drip.js`: five business-opportunity emails after sign-up, every 3 days, with unsubscribe.
- Dashboard overview: "people behind your growth" strip (manager, real numbers, example).

## npm run build for Apache/nginx with public_html
- `scripts/build.js` (`npm run build`) writes the pages to `dist/` or `BUILD_OUT` (e.g. public_html), plus an
  `.htaccess` block that forwards `/api` to the Node API (PM2). The API must still run; the pages call it.
- Visitor IPs are now read through every proxy on 127.0.0.1 (`TRUST_PROXY`, default `loopback`), so nginx -> Apache
  -> Node doesn't make every visitor share one rate limit.
- `deploy/nginx-api.conf.example` for sending `/api` to Node from nginx directly.

## Hosting on a VPS instead of Render
- Removed `render.yaml` and `render-paid.yaml.example`, and Render-specific notes in the code and docs.
- Added `ecosystem.config.js` (PM2) and `deploy/nginx.conf.example`; README has the VPS steps.
- Email links now use `APP_URL` only (set it to the live HTTPS address).

## Marketplace deals: publish, match, RentMySite approval, RentMySite share, matched
- Listings go live when a seller publishes them; the team inbox (info@rentmysite.ai) is emailed and can take one down.
- Buyer requests go straight to the seller. When the seller accepts it's a match and goes to the RentMySite team for approval.
- The RentMySite team approves with the agreed amount and split, RentMySite's share is requested (Razorpay payment link if keys are set),
  and once it's received the deal is matched and both sides get each other's contact details.
- New `utils/deal.js` (the steps), deal emails in `utils/emails.js`, payment links in `utils/razorpay.js`,
  approve / decline / share-received in `routes/admin.js` and the RentMySite dashboard (`public/js/admin.js`).
- RentMySite team dashboard limited to Govianu employees (`utils/staff.js`, `STAFF_EMAIL_DOMAINS`); the login page shows the team
  sign-up only for those emails.
- Fixed `public/js/auth.js`, which declared `emailParam` twice and so did not run at all (login and sign-up forms).
- `test/dealFlow.test.js` runs the whole flow through the real routes.

## Higgsfield replaces HeyGen for AI images and presenter videos
- `utils/higgsfield.js` (new API client: text to image, image to video, request status) replaces `utils/heygen.js`.
- Each lesson video is now made in two steps: a presenter image (Soul V2) and then a speaking video from it (Kling 3.0 Pro,
  up to 6 shots with native sound). The image is kept as the poster and shown while the video is made.
- `scripts/higgsfield-check.js` (`npm run higgsfield:check`) checks the keys; `scripts/heygen-list.js` removed.
- Settings: `HIGGSFIELD_*` in `.env.example`, `render.yaml` and `render-paid.yaml.example` replace `HEYGEN_*`.
  No free test mode on Higgsfield, so the monthly cap now defaults to 20 minutes.

## AI presenter videos (HeyGen, since replaced by Higgsfield), made on first view and reused
- `utils/heygen.js`, `utils/lessonVideos.js`, `utils/lessonScript.js`, `models/LessonVideo.js`, `routes/lessonVideos.js`.
- `scripts/heygen-list.js` (`npm run heygen:list -- india`) to choose an avatar and voice.
- Settings in `.env.example` (HEYGEN_*). Off until you add a HeyGen API key.

## Dashboard layout (latest round)
- Supply savings removed from the business dashboard (page, menu item and calculator).
- "Video lessons" and "Ways to earn" merged into one **Learn & earn** section: lessons player on top, growth ideas below.
  Business menu is now Overview, Learn & earn, Booking requests, Profile. Professionals' lessons section is also "Learn & earn".
- Main button is worded for each business type, from its lead service: "Launch dining memberships" (restaurant),
  "Launch preventive care membership" (dental clinic), "Launch subscription laundry" (laundry). "Book a growth call"
  stays beside it; professionals keep "Find me <profession> work".
- Every growth idea card has its own "Help me launch this" button.
- "Copy booking page link" moved to the Booking requests page.
- Old links to #opportunities open Learn & earn; links to removed sections (#savings, #media) open the overview.
- `utils/lessonScript.js` also returns the script in sections (`segments`), ready for subtitles.

## Marketplace: RentMySite as the third party between buyers and sellers
- **Who sells:** businesses list spaces and free slots (My spaces); professionals list services with a price (My offers).
- **Who buys:** anyone. New **buyer accounts** (event managers, companies, individuals: "I want to book" on the sign-up page),
  and businesses and professionals can also book each other from **Find & book** in their dashboards. Guests can request
  without an account.
- **Public page** `/find.html` ("Find a space or professional", linked from the homepage header): search spaces and
  professionals by keyword, area and number of people, see who offers what and at what price.
- **We're in the middle:** every listing and every request goes to the RentMySite team first (admin > Marketplace). The team
  approves listings, and forwards or declines requests. Sellers only see requests we've forwarded, and buyers and sellers only
  ever see each other's first name and type ("Anita, event manager"). After the seller accepts, the RentMySite manager connects them.
- **"Find it for me":** buyers who can't find something tell us what they need; it becomes a lead and an email to the team.
- **Status everywhere:** buyers follow each request (Sent, Checked by RentMySite, Seller replied, Confirmed) in My requests,
  and get an email at every step. Sellers get emails when listings go live and when a request is forwarded.
- The old per-business booking link (`/book.html`) now also goes to the RentMySite team first.
- New: `models/Listing.js`, `routes/market.js`, `public/find.html`, `public/buyer.html`, `public/js/market.js`, `public/js/buyer.js`,
  `public/css/market.css`. Updated: bookings (new statuses `pending_review`, `cancelled`), users (role `buyer`), admin, emails.

## Hosting on Render's free plan (testing)
- `utils/mailer.js` can send through the **Brevo email API** (`BREVO_API_KEY`), because Render's free plan blocks email
  ports (25, 465, 587) since September 2025. SMTP (Zoho) still works on paid hosting.
- `render.yaml`: one-click free test setup. `render-paid.yaml.example`: the paid setup with a disk for the real launch.
