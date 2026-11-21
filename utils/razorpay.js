// Builds a Razorpay order with Route transfers from the split engine.
// Platform share is not transferred — it stays in the RentMySite account.
const { computeSplit } = require('./split');

function buildOrderPayload(booking, businessAccountId) {
  const split = computeSplit(booking.amount, booking.splitModel, booking.partnerShare);
  const accounts = {
    infrastructure: process.env.RAZORPAY_INFRA_ACCOUNT,
    business: businessAccountId,
    leadgen: booking.leadGenAccountId || process.env.RAZORPAY_LEADGEN_ACCOUNT
  };

  const transfers = [];
  const missing = [];
  for (const line of split.lines) {
    if (line.party === 'platform' || line.paise === 0) continue;
    const account = accounts[line.party];
    if (!account) { missing.push(line.label); continue; }
    transfers.push({
      account,
      amount: line.paise,
      currency: 'INR',
      notes: { booking: String(booking._id), party: line.party },
      on_hold: 0
    });
  }

  return {
    split,
    missing,
    payload: {
      amount: Math.round(booking.amount * 100),
      currency: 'INR',
      receipt: `pmb_${booking._id}`.slice(0, 40),
      notes: { booking: String(booking._id), model: booking.splitModel },
      transfers
    }
  };
}

async function createOrder(payload) {
  const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error?.description || 'Razorpay error'), { status: 502, expose: true });
  return data;
}

const razorpayConfigured = () => !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);

async function razorpay(path, options = {}) {
  const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    ...options,
    headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error?.description || 'Razorpay error'), { status: 502, expose: true });
  return data;
}

// A Razorpay payment link for RentMySite's share of a matched deal. Razorpay emails it to the payer too.
// Docs: https://razorpay.com/docs/api/payments/payment-links/create-standard/
function createPaymentLink({ amountInr, reference, description, customer, notes }) {
  return razorpay('/payment_links', {
    method: 'POST',
    body: JSON.stringify({
      amount: Math.round(Number(amountInr) * 100), currency: 'INR', accept_partial: false,
      reference_id: String(reference).slice(0, 40), description: String(description).slice(0, 2048),
      customer: { name: customer.name, email: customer.email, ...(customer.phone ? { contact: customer.phone } : {}) },
      notify: { email: true, sms: Boolean(customer.phone) }, reminder_enable: true, notes
    })
  });
}

// { status: 'created' | 'partially_paid' | 'paid' | 'expired' | 'cancelled', payments: [...] }
const getPaymentLink = id => razorpay(`/payment_links/${encodeURIComponent(id)}`);

module.exports = { buildOrderPayload, createOrder, razorpayConfigured, createPaymentLink, getPaymentLink };
