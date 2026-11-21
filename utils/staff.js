// Who counts as RentMySite team staff: only Govianu employees (by email domain) can open the RentMySite team dashboard.
// STAFF_EMAIL_DOMAINS can list more than one domain, comma separated.
const staffDomains = () => String(process.env.STAFF_EMAIL_DOMAINS || 'govianu.com')
  .split(',').map(d => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);

function isStaffEmail(email) {
  const domain = String(email || '').trim().toLowerCase().split('@')[1];
  return Boolean(domain) && staffDomains().includes(domain);
}

module.exports = { staffDomains, isStaffEmail };
