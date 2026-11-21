const test = require('node:test');
const assert = require('node:assert/strict');
const { after } = require('node:test');

const originalEnv = {
  BREVO_API_KEY: process.env.BREVO_API_KEY,
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: process.env.SMTP_PASS,
  MAIL_FROM: process.env.MAIL_FROM
};
const originalFetch = global.fetch;

process.env.BREVO_API_KEY = 'test-brevo-key';
process.env.MAIL_FROM = 'RentMySite.ai <info@rentmysite.ai>';
delete process.env.SMTP_HOST;
delete process.env.SMTP_USER;
delete process.env.SMTP_PASS;

const { mailConfigured, sendMail } = require('../utils/mailer');

after(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  global.fetch = originalFetch;
});

test('sends through Brevo HTTPS API with verified sender and reply-to', async () => {
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, status: 201, json: async () => ({ messageId: 'brevo-message-id' }) };
  };

  assert.equal(mailConfigured(), true);
  const result = await sendMail({
    to: 'partner@example.com',
    subject: 'Your verification code',
    html: '<p>123456</p>',
    text: '123456',
    replyTo: 'help@example.com'
  });

  assert.deepEqual(result, { sent: true, id: 'brevo-message-id' });
  assert.equal(request.url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(request.options.headers['api-key'], 'test-brevo-key');
  assert.deepEqual(JSON.parse(request.options.body), {
    sender: { name: 'RentMySite.ai', email: 'info@rentmysite.ai' },
    to: [{ email: 'partner@example.com' }],
    subject: 'Your verification code',
    htmlContent: '<p>123456</p>',
    textContent: '123456',
    replyTo: { email: 'help@example.com' }
  });
});

test('returns a Brevo API rejection as a mail delivery error', async () => {
  global.fetch = async () => ({
    ok: false,
    status: 401,
    json: async () => ({ message: 'Invalid API key' })
  });
  const originalError = console.error;
  console.error = () => {};
  try {
    const result = await sendMail({
      to: 'partner@example.com',
      subject: 'Verification',
      html: '<p>123456</p>'
    });
    assert.deepEqual(result, { sent: false, error: 'Invalid API key' });
  } finally {
    console.error = originalError;
  }
});
