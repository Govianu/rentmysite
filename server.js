require('dotenv').config();
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const { initialize } = require('./utils/jsonModel');
const { verifyMail } = require('./utils/mailer');

if (!process.env.JWT_SECRET) {
  console.error('Missing JWT_SECRET in .env (see .env.example)');
  process.exit(1);
}

const app = express();
// Real visitor IPs behind nginx/Apache on this server (used for rate limits and the terms record).
// 'loopback' trusts every proxy hop on 127.0.0.1, so nginx -> Apache -> Node still sees the visitor's IP.
// Set TRUST_PROXY to a number of hops or a list of proxy IPs if your proxies are on other addresses.
const trustProxy = process.env.TRUST_PROXY || 'loopback';
app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
app.use(express.json({ limit: '1mb' }));
app.use(require('./middleware/methodOverride'));   // PATCH/PUT/DELETE sent as POST, past Apache's 403
app.use(cookieParser());

app.use('/api/auth', require('./routes/auth'));
app.use('/api/business', require('./routes/business'));
app.use('/api/associate', require('./routes/associate'));
app.use('/api/media', require('./routes/media'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/public', require('./routes/public'));
app.use('/api/enquiry', require('./routes/enquiry'));
app.use('/api/growth', require('./routes/growth'));
app.use('/api/kyc', require('./routes/kyc'));
app.use('/api/owner', require('./routes/owner'));
app.use('/api/market', require('./routes/market').router);
app.use('/api/plots', require('./routes/plots'));   // Plots & land: owner submissions, team approval, public listing
app.use('/api/lesson-videos', require('./routes/lessonVideos'));
app.use('/api/hub', require('./routes/hub'));   // WhatsApp & Calls tab: the Govianu Hub (MyOperator)
app.use('/api/myoperator-webhook', require('./routes/myoperatorWebhook'));   // MyOperator → Hub (no login; the Hub checks the token)
// The 100 business types and professions, served to the dashboards from the same file the server uses
app.get('/js/catalog.js', (req, res) => {
  res.type('application/javascript').set('Cache-Control', 'public, max-age=3600');
  res.send('window.PMB_CATALOG = ' + JSON.stringify(require('./utils/catalog').data) + ';');
});
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));   // /business -> business.html

// Express 5 forwards rejected promises from async handlers here
app.use((err, req, res, next) => {
  if (err.name === 'ValidationError') {
    return res.status(400).json({ error: Object.values(err.errors).map(e => e.message).join(', ') });
  }
  if (err.code === 11000) {
    return res.status(409).json({ error: 'That record already exists' });
  }
  if (!err.expose) console.error(err);
  res.status(err.status || 500).json({ error: err.expose ? err.message : 'Something went wrong on the server' });
});

const PORT = process.env.PORT || 3000;
initialize();
require('./utils/lessonVideos').startWorker(); // AI presenter videos (only when Higgsfield is set up)
require('./utils/drip').startDripWorker();      // business-opportunity emails after sign-up
require('./utils/leadId').backfillLeadIds().catch(err => console.error('[leads] backfill failed:', err.message));
// Profiles and uploads no longer wait for RentMySite approval: anything still marked pending goes live
(async () => {
  const User = require('./models/User'), Media = require('./models/Media');
  let n = 0;
  for (const M of [User, Media]) for (const d of await M.find({ status: 'pending' })) { d.status = 'approved'; await d.save(); n += 1; }
  if (n) console.log(`[approval] ${n} pending profile(s) and upload(s) are now live`);
})().catch(err => console.error('[approval] update failed:', err.message));
verifyMail();
app.listen(PORT, () => console.log(`rentmysite running on http://localhost:${PORT}`));
