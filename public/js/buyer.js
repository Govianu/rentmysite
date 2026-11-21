// Buyer dashboard: event managers, companies and individuals who book spaces and professionals.
(async function () {
  const user = await guard('buyer');
  if (!user) return;
  const TYPES = { event_manager: 'Event manager', company: 'Company', individual: 'Individual' };
  const type = TYPES[user.buyer?.type] || 'Buyer';
  fillWho(user, user.name);
  document.getElementById('whoHandle').textContent = user.buyer?.company ? `${type}, ${user.buyer.company}` : type;
  document.getElementById('hello').textContent = `Hello, ${firstNameOf(user.name)}`;

  // Always-on call to action: our team finds it for you
  document.getElementById('ctaBar').innerHTML = `<div class="ctabar" style="--accent:#1B3A9E;--accent-soft:#E6EBFA">
    <div class="ctabar-who"><span class="ctabar-icon" aria-hidden="true">🔎</span>
      <span><strong>${esc(user.buyer?.company || user.name)}</strong><small>${esc(type)}</small></span></div>
    <div class="ctabar-actions">
      <a class="btn ghost" href="#requests">My requests</a>
      <button class="btn ctabar-main" type="button" data-find-for-me>Find it for me</button>
    </div></div>`;
  document.getElementById('ctaBar').addEventListener('click', e => { if (e.target.closest('[data-find-for-me]')) Market.openConcierge(user); });

  document.getElementById('profileBox').innerHTML = `
    <p><strong>${esc(user.name)}</strong></p>
    <p class="meta">${esc(user.email)}${user.phone ? `<br>${esc(user.phone)}` : ''}</p>
    <p class="meta">${esc(type)}${user.buyer?.company ? `, ${esc(user.buyer.company)}` : ''}${user.location ? `. ${esc(user.location)}` : ''}</p>
    <p class="meta">To change these details, reply to any of our emails or call +91 81039 90990.</p>`;

  let browse = null;
  document.addEventListener('market:requested', () => { location.hash = 'requests'; });
  initViews(view => {
    if (view === 'find' && !browse) browse = Market.renderBrowse(document.getElementById('findBox'), { user });
    if (view === 'requests') Market.renderMyRequests(document.getElementById('myRequestsBox'));
  });
})();
