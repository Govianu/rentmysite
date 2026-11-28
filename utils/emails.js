// Email templates. Inline styles only, because email apps ignore <style> blocks.
const APP_URL = () => (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const TEAM_INBOX = () => process.env.TEAM_INBOX || 'info@rentmysite.ai';
const PHONE = '+91 81039 90990';
// Links in team emails open the RentMySite team dashboard on the right tab, through the login page so a Govianu sign-in
// lands there (and anyone else is told the link is for the RentMySite team)
// A link into one person's dashboard. An email can hold several dashboards (e.g. two businesses), so the link
// names which one; the login page switches to it, or asks for a code for it.
const dashLink = (user, page) => user?._id && user?.email
  ? `${APP_URL()}/login?next=${encodeURIComponent(page)}&email=${encodeURIComponent(user.email)}&profileId=${encodeURIComponent(user._id)}`
  : `${APP_URL()}/login?next=${encodeURIComponent(page)}`;
const sellerPage = (seller, tab) => `${seller?.role === 'associate' ? 'associate' : 'business'}#${tab}`;
// Links in team emails open the RentMySite team sign-in (Govianu emails only), which lands on the right dashboard tab
const teamLink = tab => `${APP_URL()}/team?next=${encodeURIComponent(tab)}`;
const { industryFor } = require('./industry');
const { listOf } = require('./catalog');

// "Divyaj.govianu05" -> "Divyaj", "MAHESH kumar" -> "Mahesh"; falls back to "there"
function firstName(name) {
  let n = String(name || '').trim().split(/\s+/)[0] || '';
  if (n.includes('@')) n = n.split('@')[0];
  n = n.split(/[._]/)[0].replace(/\d+$/, '');
  if (!/[a-z]/i.test(n)) return 'there';
  return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase();
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = n => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const fmtDate = d => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Date to be confirmed');

function layout(title, bodyHtml) {
  return `<!doctype html><html><body style="margin:0;background:#F6F8FC;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#0F1B3D">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F8FC;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:16px;overflow:hidden;border:1px solid #D5DCEC">
<tr><td style="background:#0E6B4A;padding:20px 28px;color:#FFFFFF;font-size:18px;font-weight:700">RentMySite<span style="color:#F2A91D">.ai</span></td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#0F1B3D">${esc(title)}</h1>
${bodyHtml}
</td></tr>
<tr><td style="padding:18px 28px;background:#F6F8FC;color:#47537C;font-size:13px;line-height:1.5">
Questions? Reply to this email or call ${PHONE}.<br>A Govianu venture, Bengaluru, India
</td></tr></table></td></tr></table></body></html>`;
}

const p = text => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#0F1B3D">${text}</p>`;
const button = (href, label) => `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0"><tr><td style="background:#0E6B4A;border-radius:10px">
<a href="${esc(href)}" style="display:inline-block;padding:13px 24px;color:#FFFFFF;font-weight:700;font-size:15px;text-decoration:none">${esc(label)}</a></td></tr></table>
<p style="margin:0 0 14px;font-size:12px;color:#47537C;word-break:break-all">If the button doesn’t work, open this link: ${esc(href)}</p>`;
const table = rows => `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:8px 0 16px;font-size:14px">
${rows.filter(([, v]) => v).map(([k, v]) => `<tr><td style="padding:7px 10px 7px 0;color:#47537C;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:7px 0;color:#0F1B3D;vertical-align:top">${esc(v).replace(/\n/g, '<br>')}</td></tr>`).join('')}
</table>`;

// In the sign-up email (never the lead ID): 5 different ways to earn and 5 ways to save, in plain English
function planBlock(plan) {
  if (!plan) return '';
  const h2 = t => `<h2 style="margin:22px 0 8px;font-size:18px;color:#0E6B4A">${t}</h2>`;
  const ol = items => `<ol style="margin:0 0 16px;padding-left:22px;font-size:15px;line-height:1.6;color:#0F1B3D">${items.join('')}</ol>`;
  const small = t => `<span style="font-size:13px;color:#47537C">${t}</span>`;
  const inr = n => `₹${Math.round(n).toLocaleString('en-IN')}`;
  // What we found when we looked the business up (only when we did)
  const found = plan.researched && plan.about
    ? h2('What we found about you')
      + p(esc(plan.about) + (plan.busyHours ? `<br>${small(`Busy: ${esc(plan.busyHours)}`)}` : '') + (plan.quietHours ? `<br>${small(`Quiet: ${esc(plan.quietHours)}`)}` : ''))
    : '';
  return found + h2('5 ways to earn more')
      + ol(plan.ways.map(w => `<li style="margin-bottom:10px"><strong>${esc(w.title)}</strong><br>${esc(w.line)}${w.examples.length ? `<br>${small(`For example: ${esc(w.examples.join(', '))}.`)}` : ''}${w.estMonthly ? `<br>${small(`Could bring about ${inr(w.estMonthly)} a month.`)}` : ''}</li>`))
      + h2('Where your money goes, and how we cut it')
      + ol(plan.savings.levers.map(l => `<li style="margin-bottom:10px">${l.cost ? `${small(`You spend on: ${esc(l.cost.toLowerCase())}`)}<br>` : ''}${l.leak ? `${small(`Where the money goes: ${esc(l.leak)}`)}<br>` : ''}<strong>${esc(l.title)}</strong>: save ${esc(l.saving)}${l.we ? `<br>${esc(l.we)}` : ''}</li>`))
      + p(small(`For example: ${esc(plan.savings.example)} These numbers are only examples.`))
      + `<div style="margin:0 0 16px;padding:14px 16px;border-left:4px solid #F2A91D;background:#FFF8E8;border-radius:8px;font-size:15px;line-height:1.6;color:#0F1B3D">${esc(PITCH.hook)}<br><strong>${esc(PITCH.deal)}</strong></div>`
      + p(esc(PITCH.call));
}
const { PITCH } = require('./pitch');
const codeBox = code => `<div style="margin:20px 0;padding:18px;background:#F6F8FC;border:1px solid #D5DCEC;border-radius:12px;text-align:center;font-size:30px;font-weight:700;letter-spacing:8px;color:#0E6B4A">${esc(code)}</div>`;

function emailOtp({ name, email, code, role, category, sectorId, businessName = '', link = '', plan = null, welcome = false }) {
  const industry = industryFor({ category, sectorId });
  const audience = role === 'business' ? 'space owner'
    : role === 'associate' ? 'partner' : role === 'buyer' ? 'brand' : 'RentMySite team';
  const body = p(welcome
      ? `Hi ${esc(firstName(name))}, welcome to RentMySite. Your ${esc(audience)} dashboard${businessName ? ` for <strong>${esc(businessName)}</strong>` : ''} is ready. Use this code to verify your email and open it.`
      : `Hi ${esc(firstName(name))}, use this code to verify your email and open your ${esc(audience)} dashboard${businessName ? ` for <strong>${esc(businessName)}</strong>` : ''}.`)
    + codeBox(code)
    + (link ? button(link, businessName ? `Open the ${businessName} dashboard` : 'Open my dashboard') : '')
    + p(`<span style="font-size:13px;color:#47537C">${link ? 'The button signs you in straight away (it works once, within 24 hours). Or type the code: it expires in 10 minutes.' : 'This code expires in 10 minutes and can be used once.'} If you did not request it, you can ignore this email.</span>`)
    + (welcome ? planBlock(plan) + p('Your site report and your mandate are in your dashboard. We will call you within one working day.') : '');
  return {
    to: email,
    subject: welcome
      ? `Welcome${businessName ? `, ${businessName}` : ''}: your dashboard code`
      : `Your ${audience} dashboard sign-in code${businessName ? `: ${businessName}` : ''}`,
    html: layout(welcome ? 'Welcome to RentMySite' : 'Verify your email', body),
    text: `Your RentMySite verification code is ${code}. It expires in 10 minutes.${link ? ` Or open your dashboard directly: ${link}` : ''}`
  };
}

// 1. To the person who enquired: confirmation in their own business type's words + dashboard code
function enquiryWelcome({ name, email, roleName, code, hasDashboard, existingAccount, category, sectorId, businessName, profileId, link, plan = null }) {
  const first = firstName(name);
  const industry = industryFor({ category, sectorId });
  const kw = industry.keywords;
  const biz = String(businessName || '').trim();
  const noun = industry.label;

  // "thank you for telling us about Magic Masala, your restaurant." / "thank you for your enquiry as a chef."
  let opening;
  if (kw && !industry.isProfessional && biz) opening = `thank you for telling us about ${esc(biz)}, your ${esc(noun)}.`;
  else if (kw && !industry.isProfessional) opening = `thank you for your ${esc(noun)} enquiry.`;
  else if (kw) opening = `thank you for your enquiry as ${esc(industry.withArticle)}.`;
  else if (biz) opening = `thank you for your enquiry about ${esc(biz)}.`;
  else opening = `thank you for your enquiry as ${esc(String(roleName || 'a partner').toLowerCase())}.`;

  let body = p(`Hi ${esc(first)}, ${opening} It has reached our team, and we’ve recorded that you agreed to our Terms and Conditions.`);
  if (kw && !plan) {
    const like = industry.isProfessional ? `${esc(industry.plural)} like you` : `${esc(industry.plural)} like ${esc(biz || 'yours')}`;
    body += p(`Ideas that work well for ${like}: ${esc(listOf(kw.services))}. You could also team up with ${esc(listOf(kw.partners))} on the platform.`);
  }
  if (hasDashboard) {
    const what = kw
      ? `It has ${esc(noun)} growth ideas, short video lessons based on your skills, and your booking requests.`
      : 'It has growth ideas, short video lessons based on your skills, and your booking requests.';
    body += p(existingAccount
      ? `Use the code below to sign in to your ${esc(noun)} dashboard. ${what}`
      : `Your ${esc(noun)} dashboard is ready. ${what} Verify your email with this code to open it:`);
    body += codeBox(code);
    // Opens the code box for this exact dashboard (the email may already have other dashboards)
    // One tap signs in to this exact dashboard; without a link, open the code box for it
    const signIn = link || `${APP_URL()}/login?email=${encodeURIComponent(email)}${profileId ? `&profileId=${encodeURIComponent(profileId)}` : ''}&step=code#login`;
    body += button(signIn, biz && !industry.isProfessional ? `Open the ${biz} dashboard` : `Open my ${noun} dashboard`);
    body += p(`<span style="font-size:13px;color:#47537C">${link ? 'The button signs you in straight away (it works once, within 24 hours). On another device, type the code instead: it expires in 10 minutes.' : 'This code expires in 10 minutes. You can request another code from the login page.'}</span>`);
    body += planBlock(plan) + p('Your site report and your mandate are in your dashboard. We will call you within one working day.');
  } else {
    body += p('A member of our partnerships team will contact you within two working days to talk about your territory.');
  }
  const subject = hasDashboard
    ? `${kw && biz && !industry.isProfessional ? `${biz}: your ${noun} dashboard code` : `Your ${noun} dashboard code`}`
    : 'We’ve received your enquiry';
  const title = kw ? (industry.isProfessional ? `Welcome, ${noun}` : `Welcome to RentMySite, ${biz || noun}`) : 'Enquiry received';
  return {
    to: email,
    subject,
    html: layout(title, body),
    text: `Hi ${first}, ${opening.replace(/&amp;/g, '&')} ${hasDashboard ? `Your verification code is ${code}. It expires in 10 minutes. ${link ? `Open your dashboard directly: ${link}` : `Sign in at ${APP_URL()}/login#login`}` : 'Our team will contact you within two working days.'}`
  };
}

// 2. To the RentMySite team inbox: full enquiry + proof of terms acceptance + what we sent them. Sent for every enquiry and
// sign-up, whether or not they picked an opportunity.
function teamEnquiry(e) {
  const asked = String(e.message || '').split('\n').filter(l => /^I'd like to know more about: /.test(l)).map(l => l.replace(/^I'd like to know more about: /, ''));
  const body = p(e.source === 'signup' ? 'Someone signed up on the website.' : 'A new enquiry arrived from the website.') + table([
    ['Lead ID', e.leadId], ['Enquiry type', e.roleName], ['Name', e.name], ['Business or brand', e.business], ['Email', e.email],
    ['Phone or WhatsApp', e.phone], ['Business or profession', e.businessType], ['Location', e.location],
    ['Enquired about', asked.length ? asked.join('; ') : 'No specific opportunity picked'],
    ['Offer', e.offer], ['Territory', e.territory], ['Notes', e.message], ['Dashboard plan', e.plan],
    ['Terms accepted', `Yes, version ${e.termsVersion}, ${new Date(e.termsAcceptedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`],
    ['Dashboard', e.handle ? `${e.handle} (verification code sent${e.existingAccount ? ', existing account' : ''})` : 'Not applicable']
  ]) + button(teamLink('comms'), 'Open this lead in the RentMySite team dashboard')
    + p(`<span style="font-size:13px;color:#47537C">Their own dashboard opens only with the code sent to their email, so it stays private to them.</span>`);
  return {
    to: TEAM_INBOX(),
    replyTo: e.email || undefined,
    subject: `${e.leadId ? `[${e.leadId}] ` : ''}${e.source === 'signup' ? 'New sign-up' : 'RentMySite enquiry'}: ${e.roleName}${e.business ? ', ' + e.business : ''}`,
    html: layout('New website enquiry', body),
    text: `New enquiry from ${e.name} (${e.email || e.phone}).`
  };
}

// 3. Legacy one-time login link for older activation emails
function loginLink({ name, email, link }) {
  const first = firstName(name);
  const body = p(`Hi ${esc(first)}, use this one-time link to verify your email and open your dashboard.`)
    + button(link, 'Open my dashboard')
    + p('<span style="font-size:13px;color:#47537C">This link works once and expires in 72 hours. For a code instead, use the login page. If you didn’t ask for it, you can ignore this email.</span>');
  return { to: email, subject: 'Your RentMySite login link', html: layout('Your login link', body), text: `Open: ${link}` };
}

// 4. To a business: new booking request with an accept CTA
function bookingRequested({ business, booking }) {
  const industry = industryFor(business);
  const body = p(`You have a new ${esc(industry.bookingLabel)} request for ${esc(business.business?.businessName || business.name)}.`) + table([
    ['Booking', booking.eventType], ['From', booking.requesterName + (booking.leadGenName ? `, ${booking.leadGenName}` : '')],
    ['Date', fmtDate(booking.eventDate)], ['Guests', booking.guests], ['Budget', booking.amount ? inr(booking.amount) : ''],
    ['Message', booking.message]
  ]) + p('Review the revenue split and the partner terms, then accept or decline from your dashboard.')
    + button(dashLink(business, 'business#bookings'), 'Review and accept');
  return { to: business.email, subject: `New ${industry.bookingLabel} request: ${booking.eventType}`, html: layout('New booking request', body), text: `New ${industry.bookingLabel} request: ${booking.eventType}` };
}

// 5. To the person who booked + the business: booking confirmed
function bookingAccepted({ business, booking, share }) {
  const venue = business.business?.businessName || business.name;
  const industry = industryFor(business);
  const rows = [['Booking', booking.eventType], ['Venue', venue], ['Date', fmtDate(booking.eventDate)], ['Guests', booking.guests]];
  const meet = booking.meetLink ? button(booking.meetLink, 'Join the onboarding call') : p('Your RentMySite manager will send the onboarding call details shortly.');
  return [
    booking.requesterEmail && {
      to: booking.requesterEmail,
      subject: `${industry.display} booking confirmed: ${booking.eventType} at ${venue}`,
      html: layout('Your booking is confirmed', p(`Hi ${esc(firstName(booking.requesterName))}, ${esc(venue)} has accepted your booking request.`) + table(rows) + meet),
      text: `${venue} accepted your booking.`
    },
    business.email && {
      to: business.email,
      subject: `${industry.display} booking accepted: ${booking.eventType}`,
      html: layout('Booking accepted', p('You accepted this booking under the RentMySite partner terms.') + table([...rows, ['Booking value', booking.amount ? inr(booking.amount) : ''], ['Your share', share != null ? inr(share) : '']]) + meet
        + button(dashLink(business, 'business#bookings'), 'View in your dashboard')),
      text: `You accepted ${booking.eventType}.`
    }
  ].filter(Boolean);
}

module.exports = { firstName, emailOtp, enquiryWelcome, teamEnquiry, loginLink, bookingRequested, bookingAccepted, APP_URL, TEAM_INBOX };

// 6. To the RentMySite team: a partner pressed a call to action in their dashboard
function ctaRequest({ user, industry, label, topic, note, preferred }) {
  const company = user.business?.businessName || '';
  const body = p(`${esc(user.name)} pressed “${esc(label)}” in their ${esc(industry.label)} dashboard.`) + table([
    ['Lead ID', user.leadId], ['Request', label], ['About', topic], ['Name', user.name], ['Business', company], ['Type', industry.display],
    ['Email', user.email], ['Phone', user.phone], ['Area', user.location], ['Best time to call', preferred], ['Note', note],
    ['Skills', (user.skills || user.associate?.skills || []).join(', ')], ['Handle', user.handle]
  ]) + button(teamLink('comms'), 'Open in the RentMySite team dashboard');
  return {
    to: TEAM_INBOX(),
    replyTo: user.email || undefined,
    subject: `${user.leadId ? `[${user.leadId}] ` : ''}${label}: ${company || user.name} (${industry.label})`,
    html: layout(label, body),
    text: `${user.name} (${industry.label}) asked: ${label}${topic ? ` - ${topic}` : ''}.`
  };
}

module.exports.ctaRequest = ctaRequest;

// ---------- Marketplace: RentMySite is the third party between buyer and seller ----------
const PRICE_UNIT = { hour: 'per hour', slot: 'per slot', day: 'per day', session: 'per session', event: 'per event', project: 'per project', month: 'per month' };
const priceText = l => (l && Number(l.price) > 0 ? `${inr(l.price)} ${PRICE_UNIT[l.priceUnit] || ''}`.trim() : 'Price on request');
const requestRows = (b, l) => [
  ['Request', l?.title || b.eventType], ['What for', b.eventType], ['Date', b.eventDate ? fmtDate(b.eventDate) : ''],
  ['People', b.guests], ['Budget', b.amount ? inr(b.amount) : ''], ['Message', b.message]
];

// To the buyer, straight after they send a request
function marketRequestReceived({ booking, listing }) {
  const body = p(`Hi ${esc(firstName(booking.requesterName))}, we’ve received your request for <strong>${esc(listing?.title || booking.eventType)}</strong>.`)
    + table(requestRows(booking, listing))
    + p('It has gone to the seller. Once they accept, our team approves the match and coordinates everything. We stay in the middle the whole way: your contact details are never shared with the seller.')
    + button(`${APP_URL()}/login#login`, 'Track my request');
  return { to: booking.requesterEmail, subject: `Request received: ${listing?.title || booking.eventType}`, html: layout('Request received', body), text: `We received your request for ${listing?.title || booking.eventType}.` };
}

// To the RentMySite team: a new request to check and forward
function marketRequestTeam({ booking, listing, seller }) {
  const body = p('A buyer sent a request on the marketplace. It has gone to the seller; you’ll get another email to approve it if they accept.') + table([
    ...requestRows(booking, listing),
    ['Buyer', `${booking.requesterName}${booking.buyerType ? ` (${booking.buyerType})` : ''}`], ['Buyer email', booking.requesterEmail], ['Buyer phone', booking.requesterPhone],
    ['Seller', seller ? `${seller.business?.businessName || seller.name} (${seller.handle || seller.email})` : ''], ['Listed price', priceText(listing)]
  ]) + button(teamLink('market'), 'Open the RentMySite team dashboard');
  return { to: TEAM_INBOX(), replyTo: booking.requesterEmail || undefined, subject: `New request: ${listing?.title || booking.eventType}`, html: layout('New marketplace request', body), text: `New request for ${listing?.title || booking.eventType}.` };
}

// To the buyer, when RentMySite forwards, the seller accepts, or the request is declined
function marketDecision({ booking, listing, outcome, note }) {
  const what = esc(listing?.title || booking.eventType);
  const lines = {
    forwarded: [`Your request for ${what} has been checked and sent to the seller.`, 'We’ll let you know as soon as they reply.'],
    accepted: [`Good news: your request for ${what} has been accepted.`, 'Your RentMySite manager will contact you to confirm the details and payment.'],
    declined: [`Your request for ${what} couldn’t go ahead this time.`, 'Reply to this email or use “Find it for me” in your dashboard, and we’ll suggest alternatives.']
  }[outcome];
  const body = p(`Hi ${esc(firstName(booking.requesterName))}, ${lines[0]}`) + (note ? p(`Note from our team: ${esc(note)}`) : '') + p(lines[1])
    + button(`${APP_URL()}/login#login`, 'View my requests');
  const subject = { forwarded: 'Sent to the seller', accepted: 'Request accepted', declined: 'Request update' }[outcome];
  return { to: booking.requesterEmail, subject: `${subject}: ${listing?.title || booking.eventType}`, html: layout(subject, body), text: lines.join(' ') };
}

// To the seller, when RentMySite forwards a request (no buyer contact details: RentMySite connects both sides)
function marketRequestForSeller({ seller, booking, listing }) {
  const body = p(`You have a new request for <strong>${esc(listing?.title || booking.eventType)}</strong>.`)
    + table([...requestRows(booking, listing), ['From', firstName(booking.requesterName) + (booking.buyerType ? `, ${booking.buyerType}` : '')]])
    + p('Accept or decline it in your dashboard. Once you accept, our team approves the match and connects you with the buyer.')
    + button(dashLink(seller, sellerPage(seller, seller.role === 'associate' ? 'offers' : 'bookings')), 'Review and accept');
  return { to: seller.email, subject: `New request: ${listing?.title || booking.eventType}`, html: layout('New booking request', body), text: `New request for ${listing?.title || booking.eventType}.` };
}

// To the team when a seller publishes or changes a listing (it is live straight away), and to the seller if it's taken down
function listingSubmitted({ listing, seller, changed = false }) {
  const body = p(`${esc(seller.business?.businessName || seller.name)} ${changed ? 'changed' : 'published'} an opportunity. It is live for buyers now; take it down from the RentMySite team dashboard if anything is wrong.`) + table([
    ['Listing', listing.title], ['Type', listing.kind === 'space' ? 'Space or free slot' : 'Professional service'], ['Price', priceText(listing)],
    ['Available', listing.availability], ['Area', listing.area], ['Details', listing.description],
    ['Seller', `${seller.name}${seller.email ? ` (${seller.email})` : ''}${seller.phone ? `, ${seller.phone}` : ''}`]
  ]) + button(teamLink('market'), 'Open the RentMySite team dashboard');
  return { to: TEAM_INBOX(), replyTo: seller.email || undefined, subject: `${changed ? 'Opportunity changed' : 'New opportunity published'}: ${listing.title}`, html: layout(changed ? 'Opportunity changed' : 'New opportunity published', body), text: `${changed ? 'Changed' : 'New'} opportunity: ${listing.title}` };
}
function listingReviewed({ listing, seller, approved, note }) {
  const body = p(`Hi ${esc(firstName(seller.name))}, your listing <strong>${esc(listing.title)}</strong> ${approved ? 'is now live. Buyers can find it and send requests.' : 'has been taken off the marketplace for now. Edit it to publish it again.'}`)
    + (note ? p(`Note from our team: ${esc(note)}`) : '')
    + button(dashLink(seller, sellerPage(seller, seller.role === 'associate' ? 'offers' : 'spaces')), 'Open my listings');
  return { to: seller.email, subject: approved ? `Live: ${listing.title}` : `Change needed: ${listing.title}`, html: layout(approved ? 'Your listing is live' : 'Your listing needs a change', body), text: listing.title };
}

// To the team: "Can't find it? Find it for me"
function marketConcierge({ who, need }) {
  const body = p('Someone asked us to find something for them.') + table([
    ['Name', who.name], ['Email', who.email], ['Phone', who.phone], ['Account', who.role || 'No account'],
    ['Looking for', need.what], ['Area', need.area], ['Date', need.date], ['People', need.people], ['Budget', need.budget ? inr(need.budget) : ''], ['Details', need.details]
  ]);
  return { to: TEAM_INBOX(), replyTo: who.email || undefined, subject: `Find it for me: ${need.what}`, html: layout('Find it for me', body), text: `${who.name} is looking for ${need.what}.` };
}

Object.assign(module.exports, { priceText, marketRequestReceived, marketRequestTeam, marketDecision, marketRequestForSeller, listingSubmitted, listingReviewed, marketConcierge });

// ---------- Deal flow: match -> RentMySite approval -> RentMySite share received -> matched ----------
const sellerName = s => s?.business?.businessName || s?.name || 'The seller';
const dealRef = b => `RMS-${String(b._id).slice(0, 8).toUpperCase()}`;
const dealRows = (b, l, seller) => [
  ...requestRows(b, l),
  ['Buyer', `${b.requesterName}${b.buyerType ? ` (${b.buyerType})` : ''}`], ['Buyer email', b.requesterEmail], ['Buyer phone', b.requesterPhone],
  ['Seller', seller ? `${sellerName(seller)} (${seller.email || seller.handle || ''})` : ''], ['Seller phone', seller?.phone], ['Listed price', priceText(l)]
];

// To the team: the seller accepted, so buyer and seller match. Needs RentMySite approval.
function dealForApproval({ booking, listing, seller }) {
  const body = p('<strong>A buyer and a seller have matched.</strong> The seller accepted the request under the partner terms. Approve it, set the final amount and request PMB’s share.')
    + table(dealRows(booking, listing, seller)) + button(teamLink('market'), 'Approve in the RentMySite team dashboard');
  return { to: TEAM_INBOX(), replyTo: booking.requesterEmail || undefined, subject: `Approve match: ${listing?.title || booking.eventType}`, html: layout('Match waiting for approval', body), text: `Match waiting for approval: ${listing?.title || booking.eventType}.` };
}

// To buyer and seller as the deal moves on (contact details are never shared between them)
const DEAL_COPY = {
  pending_approval: {
    buyer: what => [`good news: the seller has accepted your request for ${what}.`, 'Our team is approving the match now. We’ll email you the next step, usually within one working day.'],
    seller: what => [`you accepted the request for ${what}.`, 'Our team is approving the match now. We’ll email you the next step.'],
    subject: 'Accepted, RentMySite approving'
  },
  awaiting_payment: {
    buyer: what => [`the RentMySite team has approved your match for ${what}.`, 'As soon as the RentMySite share is received, we confirm the match and your RentMySite manager coordinates the rest.'],
    seller: what => [`the RentMySite team has approved your match for ${what}.`, 'As soon as the RentMySite share is received, we confirm the match and your RentMySite manager coordinates the rest.'],
    subject: 'Match approved'
  },
  declined: {
    buyer: what => [`your request for ${what} couldn’t go ahead this time.`, 'Reply to this email or use “Find it for me” in your dashboard, and we’ll suggest alternatives.'],
    seller: what => [`the match for ${what} won’t go ahead.`, 'Your listing stays live for other buyers.'],
    subject: 'Match update'
  }
};
function dealUpdate({ booking, listing, seller, stage, note, only }) {
  const copy = DEAL_COPY[stage];
  const what = esc(listing?.title || booking.eventType);
  const mails = [];
  for (const who of ['buyer', 'seller']) {
    if (only && only !== who) continue;
    const to = who === 'buyer' ? booking.requesterEmail : seller?.email;
    if (!to) continue;
    const name = who === 'buyer' ? booking.requesterName : seller.name;
    const next = who === 'buyer' ? `${APP_URL()}/login#login` : dashLink(seller, sellerPage(seller, seller.role === 'associate' ? 'offers' : 'bookings'));
    const [first, second] = copy[who](what);
    mails.push({ to, subject: `${copy.subject}: ${listing?.title || booking.eventType}`,
      html: layout(copy.subject, p(`Hi ${esc(firstName(name))}, ${first}`) + (note ? p(`Note from our team: ${esc(note)}`) : '') + p(second) + button(next, 'Open my dashboard')),
      text: `${first} ${second}` });
  }
  return mails;
}

// To whoever pays RentMySite's share
function shareRequest({ booking, listing, seller, payLink }) {
  const toBuyer = booking.sharePayer === 'buyer';
  const to = toBuyer ? booking.requesterEmail : seller?.email;
  if (!to) return null;
  const name = toBuyer ? booking.requesterName : seller.name;
  const body = p(`Hi ${esc(firstName(name))}, your match for <strong>${esc(listing?.title || booking.eventType)}</strong> has been approved by the RentMySite team.`)
    + table([['Agreed amount', inr(booking.amount)], ['RentMySite share', inr(booking.pmbShare)], ['Reference', dealRef(booking)]])
    + (payLink ? p('Pay the RentMySite share using the secure Razorpay link below. The match is confirmed as soon as it is received.') + button(payLink, `Pay ${inr(booking.pmbShare)}`)
      : p('Your RentMySite manager will share the payment details. The match is confirmed as soon as the share is received.'));
  return { to, replyTo: TEAM_INBOX(), subject: `Pay the RentMySite share to confirm: ${listing?.title || booking.eventType}`, html: layout('Match approved: one step left', body), text: `Pay the RentMySite share of ${inr(booking.pmbShare)} to confirm your match.${payLink ? ` ${payLink}` : ''}` };
}

// To buyer, seller and team: share received, it's a match. No direct contact: neither side gets the other's
// details; the RentMySite team coordinates everything between them.
function matchConfirmed({ booking, listing, seller }) {
  const what = listing?.title || booking.eventType;
  const deal = [['Booking', what], ['What for', booking.eventType], ['Date', booking.eventDate ? fmtDate(booking.eventDate) : ''], ['People', booking.guests], ['Agreed amount', booking.amount ? inr(booking.amount) : '']];
  const coordinate = p('Your RentMySite manager will coordinate everything with you: timings, set-up and anything you need. RentMySite is your only point of contact, so you don’t need to contact anyone else. Just reply to this email or call ' + PHONE + '.');
  return [
    booking.requesterEmail && { to: booking.requesterEmail, subject: `It’s a match: ${what}`,
      html: layout('It’s a match', p(`Hi ${esc(firstName(booking.requesterName))}, your booking is confirmed.`) + table(deal) + coordinate), text: `It's a match: ${what}. Your RentMySite manager will coordinate everything.` },
    seller?.email && { to: seller.email, subject: `It’s a match: ${what}`,
      html: layout('It’s a match', p(`Hi ${esc(firstName(seller.name))}, the booking is confirmed.`) + table([...deal, ['Booked by', `${firstName(booking.requesterName)}${booking.buyerType ? `, ${booking.buyerType.toLowerCase()}` : ''}`]]) + coordinate), text: `It's a match: ${what}. Your RentMySite manager will coordinate everything.` },
    { to: TEAM_INBOX(), subject: `Matched: ${what}`, html: layout('Matched', p('PMB’s share was received and the match is confirmed. Neither side has the other’s details: coordinate between them.')
      + table([...dealRows(booking, listing, seller), ['Agreed amount', booking.amount ? inr(booking.amount) : ''], ['RentMySite share', inr(booking.pmbShare)], ['Payment reference', booking.payment?.reference]])), text: `Matched: ${what}.` }
  ].filter(Boolean);
}

Object.assign(module.exports, { dealForApproval, dealUpdate, shareRequest, matchConfirmed, dealRef });

// Building blocks for other email modules (utils/drip.js)
Object.assign(module.exports, { layout, p, button, esc, inr, PHONE });

// ---------- Uploads: plots (RentMySite) / places (PartnerMyBusiness) → team approval → shown to seekers ----------
// Wording comes from utils/plotWords.js, so the same block works on both sites.
const { W: PW } = require('./plotWords');
function plotRows(plot) {
  return [
    [`${PW.Noun} ID`, plot.plotId], ['Title', plot.title], ['Type', plot.type], ['Size', plot.sizeText],
    ['Area', [plot.locality, plot.city].filter(Boolean).join(', ')], ['Road', [plot.roadText, plot.roadWidthFt ? `${plot.roadWidthFt} ft wide` : ''].filter(Boolean).join(', ')],
    ['Frontage', plot.frontageFt ? `${plot.frontageFt} ft` : ''], ['Zoning', plot.zoning], ['Current use', plot.currentUse],
    ['Available from', plot.availableFrom], ['Owner prefers', plot.preferenceText], ['Expected per month', plot.expectedRent ? inr(plot.expectedRent) : ''],
    ['Amenities', (plot.amenities || []).join(', ')], ['Description', plot.description]
  ];
}
function plotSubmitted({ plot }) {
  const body = p(`A ${PW.noun} was uploaded from a dashboard. Check the photos, videos, documents and the owner's KYC, then approve it to publish it for ${PW.seekers}.`)
    + table([['Owner', plot.ownerName], ['Phone', plot.ownerPhone], ['Email', plot.ownerEmail], ['Address', plot.address], ['Google Maps', plot.mapUrl], ['Survey no.', plot.surveyNo],
      ...plotRows(plot), ['Photos', String(plot.photos.length)], ['Videos', String((plot.videos || []).length)], ['Documents', plot.documents.map(d => d.kindText).join(', ') || 'None uploaded']])
    + button(teamLink('plots'), `Review ${PW.noun} and KYC in Approvals`);
  return { to: TEAM_INBOX(), replyTo: plot.ownerEmail || undefined, subject: `[${plot.plotId}] New ${PW.noun} to approve: ${plot.title}`, html: layout(`New ${PW.noun} to approve`, body), text: `New ${PW.noun} ${plot.plotId} from ${plot.ownerName} (${plot.ownerPhone}): ${plot.title}` };
}
function plotReceived({ plot }) {
  const body = p(`Hi ${esc(firstName(plot.ownerName))},`) + p(`Thank you for uploading your ${PW.noun} to ${PW.site}. Our team is checking the details, documents and your KYC, and will publish it for ${PW.seekers}, usually within one working day. If your KYC is not complete yet, please finish it in your dashboard under Profile.`)
    + table(plotRows(plot).slice(0, 6)) + p(`Your reference is <strong>${esc(plot.plotId)}</strong>. Questions? WhatsApp or call us on ${PHONE}.`);
  return { to: plot.ownerEmail, subject: `We received your ${PW.noun} (${plot.plotId})`, html: layout(`${PW.Noun} received`, body), text: `We received your ${PW.noun} ${plot.plotId}. Our team will publish it after checking.` };
}
function plotPublished({ plot }) {
  const body = p(`Hi ${esc(firstName(plot.ownerName))},`) + p(`Good news: your ${PW.noun} <strong>${esc(plot.title)}</strong> (${esc(plot.plotId)}) is now live on ${PW.site} for ${PW.seekers}. When someone is interested, our team will call you and coordinate everything. Your phone number and exact address are never shown publicly.`)
    + button(`${APP_URL()}/find#plots`, `See your ${PW.noun}`);
  return { to: plot.ownerEmail, subject: `Your ${PW.noun} is live on ${PW.site} (${plot.plotId})`, html: layout(`Your ${PW.noun} is live`, body), text: `Your ${PW.noun} ${plot.plotId} is now live on ${PW.site}.` };
}
function plotRejected({ plot }) {
  const body = p(`Hi ${esc(firstName(plot.ownerName))},`) + p(`Thank you for uploading your ${PW.noun} (${esc(plot.plotId)}). We could not publish it yet${plot.reviewNote ? `: ${esc(plot.reviewNote)}` : '.'}`)
    + p(`Please WhatsApp us on ${PHONE} with the missing details or documents and we will publish it.`);
  return { to: plot.ownerEmail, subject: `About your ${PW.noun} (${plot.plotId})`, html: layout(`About your ${PW.noun}`, body), text: `We could not publish ${PW.noun} ${plot.plotId} yet. ${plot.reviewNote || ''}` };
}
function plotEnquiry({ plot, enquiry }) {
  const body = p(`Someone is interested in a published ${PW.noun}. Call them, then coordinate with the owner (no direct contact between them).`)
    + table([['Name', enquiry.name], ['Phone', enquiry.phone], ['Email', enquiry.email], ['What they want it for', enquiry.purpose], ['Message', enquiry.message]])
    + p(`<strong>The ${PW.noun}</strong>`) + table([['Owner', `${plot.ownerName}, ${plot.ownerPhone}`], ['Address', plot.address], ['Google Maps', plot.mapUrl], ...plotRows(plot).slice(0, 6)])
    + button(teamLink('comms'), 'Open WhatsApp & Calls');
  return { to: TEAM_INBOX(), replyTo: enquiry.email || undefined, subject: `[${plot.plotId}] Enquiry from ${enquiry.name}: ${plot.title}`, html: layout(`${PW.Noun} enquiry`, body), text: `${enquiry.name} (${enquiry.phone}) is interested in ${plot.plotId}.` };
}
Object.assign(module.exports, { plotSubmitted, plotReceived, plotPublished, plotRejected, plotEnquiry });
