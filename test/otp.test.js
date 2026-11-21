const test = require('node:test');
const assert = require('node:assert/strict');
const { clearOtp, issueOtp, otpIsActive, otpMatches, recordOtpFailure, MAX_OTP_ATTEMPTS } = require('../utils/otp');

process.env.JWT_SECRET = 'test-secret-for-otp-only';

test('issues a one-time six-digit code and stores only its digest', async () => {
  const user = { email: ' Partner@example.com ', async save() {} };
  const code = await issueOtp(user);

  assert.match(code, /^\d{6}$/);
  assert.notEqual(user.emailOtpHash, code);
  assert.equal(otpMatches(user, code), true);
  const wrongCode = code === '000000' ? '000001' : '000000';
  assert.equal(otpMatches(user, wrongCode), false);
  assert.equal(user.emailOtpAttempts, 0);
  assert.equal(otpIsActive(user), true);
});

test('rejects expired codes and clears one-time state', async () => {
  const user = {
    email: 'partner@example.com',
    emailOtpHash: 'a'.repeat(64),
    emailOtpExpiresAt: new Date(Date.now() - 1).toISOString(),
    emailOtpAttempts: 4
  };

  assert.equal(otpIsActive(user), false);
  clearOtp(user);
  assert.equal(user.emailOtpHash, null);
  assert.equal(user.emailOtpExpiresAt, null);
  assert.equal(user.emailOtpAttempts, 0);
});

test('invalid attempts invalidate a code at the configured limit', () => {
  const user = {
    emailOtpHash: 'a'.repeat(64),
    emailOtpExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    emailOtpAttempts: 0
  };
  for (let attempt = 1; attempt < MAX_OTP_ATTEMPTS; attempt++) {
    recordOtpFailure(user);
    assert.ok(user.emailOtpHash);
  }
  recordOtpFailure(user);
  assert.equal(user.emailOtpHash, null);
  assert.equal(user.emailOtpExpiresAt, null);
});
