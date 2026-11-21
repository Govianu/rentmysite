/* Marketplace UI shared by the public "Find" page and every dashboard.
   RentMySite is the third party: listings go live when published, requests go to the seller, and when the seller
   accepts, the RentMySite team approves the match and collects its share. Contact details are never shared between them. */
(function () {
  const UNITS = [['slot', 'per slot'], ['hour', 'per hour'], ['day', 'per day'], ['session', 'per session'], ['event', 'per event'], ['project', 'per project'], ['month', 'per month']];
  const dialog = id => {
    let d = document.getElementById(id);
    if (!d) { d = document.createElement('dialog'); d.id = id; d.className = 'gdialog'; document.body.appendChild(d); }
    return d;
  };

  // ---------- Browse: who is offering what ----------
  function card(l, { canRequest = true } = {}) {
    const facts = [l.area && `📍 ${esc(l.area)}`, l.capacity && `👥 Up to ${l.capacity}`, l.availability && `🗓 ${esc(l.availability)}`].filter(Boolean);
    return `<article class="mk-card" style="--accent:${esc(l.accent)}">
      <div class="mk-card-top"><span class="mk-icon" aria-hidden="true">${l.icon}</span>
        <span class="mk-kind">${l.kind === 'space' ? 'Space' : 'Professional'}</span></div>
      <h3>${esc(l.title)}</h3>
      <p class="mk-seller">${esc(l.seller)}${l.kind === 'space' ? `, ${esc(l.sellerType.toLowerCase())}` : ''}</p>
      ${l.description ? `<p class="mk-desc">${esc(l.description)}</p>` : ''}
      ${facts.length ? `<ul class="mk-facts">${facts.map(f => `<li>${f}</li>`).join('')}</ul>` : ''}
      <div class="mk-foot"><strong>${esc(l.priceText)}</strong>
        ${canRequest ? `<button class="btn small" type="button" data-request="${esc(l.id)}">Request to book</button>` : ''}</div>
    </article>`;
  }

  function renderBrowse(el, { user = null, ownId = null } = {}) {
    el.innerHTML = `
      <form class="mk-search" role="search">
        <div class="mk-tabs" role="group" aria-label="What are you looking for">
          <button type="button" data-kind="" aria-pressed="true">Everything</button>
          <button type="button" data-kind="space" aria-pressed="false">Spaces</button>
          <button type="button" data-kind="service" aria-pressed="false" hidden>Professionals</button>
        </div>
        <div class="mk-fields">
          <label><span class="sr-only">Search</span><input name="q" placeholder="Kiosk slot, dark store, parking, storage, court…"></label>
          <label><span class="sr-only">Area</span><input name="area" placeholder="Area, e.g. Whitefield"></label>
          <label><span class="sr-only">People</span><input name="people" type="number" min="1" placeholder="People"></label>
          <button class="btn" type="submit">Search</button>
        </div>
      </form>
      <p class="meta mk-count" role="status"></p>
      <div class="mk-grid"></div>
      <div class="mk-concierge">
        <div><h3>Can’t find what you need?</h3><p class="meta">Tell us what you’re looking for. Our team finds a site that fits and gets back to you.</p></div>
        <button class="btn" type="button" data-concierge>Find it for me</button>
      </div>`;
    let kind = '', items = [];
    const form = el.querySelector('form');
    async function load() {
      const p = new URLSearchParams({ kind, q: form.q.value, area: form.area.value, people: form.people.value });
      const grid = el.querySelector('.mk-grid');
      grid.innerHTML = '<p class="meta">Loading…</p>';
      try { items = (await api('/market/listings?' + p)).listings; }
      catch (e) { grid.innerHTML = `<p class="error-box">${esc(e.message)}</p>`; return; }
      const shown = ownId ? items.map(l => ({ ...l, own: false })) : items;
      el.querySelector('.mk-count').textContent = `${shown.length} ${shown.length === 1 ? 'listing' : 'listings'}`;
      grid.innerHTML = shown.length ? shown.map(l => card(l)).join('')
        : `<div class="empty"><strong>Nothing matches yet</strong>Try a different search, or press “Find it for me” and our team will look for you.</div>`;
    }
    form.addEventListener('submit', e => { e.preventDefault(); load(); });
    el.addEventListener('click', e => {
      const k = e.target.closest('[data-kind]');
      if (k) { kind = k.dataset.kind; el.querySelectorAll('[data-kind]').forEach(b => b.setAttribute('aria-pressed', String(b === k))); load(); }
      const r = e.target.closest('[data-request]');
      if (r) openRequest(items.find(l => l.id === r.dataset.request), user);
      if (e.target.closest('[data-concierge]')) openConcierge(user);
    });
    load();
    return { reload: load };
  }

  // ---------- Request to book (goes to the RentMySite team first) ----------
  function openRequest(l, user, onDone) {
    if (!l) return;
    const d = dialog('mkRequest');
    d.innerHTML = `<form method="dialog" class="gdialog-body" novalidate>
      <h2>Request to book</h2>
      <p class="meta"><strong>${esc(l.title)}</strong>, ${esc(l.seller)}. ${esc(l.priceText)}</p>
      <p class="mk-note">Your request goes to the seller. When they accept, the RentMySite team approves the match and coordinates everything. Your contact details are never shared with the seller.</p>
      <div class="field"><label for="rqPurpose">What is it for?</label><input id="rqPurpose" maxlength="160" placeholder="${l.kind === 'space' ? 'Product launch for 60 guests' : 'Birthday dinner for 12'}"></div>
      <div class="row">
        <div class="field"><label for="rqDate">Date</label><input id="rqDate" type="date"></div>
        <div class="field"><label for="rqPeople">People</label><input id="rqPeople" type="number" min="1"></div>
      </div>
      <div class="field"><label for="rqBudget">Budget in ₹ <span class="hint">(optional)</span></label><input id="rqBudget" type="number" min="0"></div>
      <div class="field"><label for="rqMsg">Anything else <span class="hint">(optional)</span></label><textarea id="rqMsg" maxlength="1500"></textarea></div>
      ${user ? '' : `<div class="row">
          <div class="field"><label for="rqName">Your name</label><input id="rqName" autocomplete="name"></div>
          <div class="field"><label for="rqType">You are</label><select id="rqType"><option value="individual">An individual</option><option value="company">A company</option><option value="event_manager">An event manager</option></select></div>
        </div>
        <div class="row">
          <div class="field"><label for="rqEmail">Email</label><input id="rqEmail" type="email" autocomplete="email"></div>
          <div class="field"><label for="rqPhone">Phone <span class="hint">(optional)</span></label><input id="rqPhone" type="tel" autocomplete="tel"></div>
        </div>
        <label class="check field"><input type="checkbox" id="rqTerms"><span>I agree to the <a href="/terms" target="_blank" rel="noopener">Terms and Conditions</a>.</span></label>`}
      <p class="error-box" role="alert"></p>
      <div class="gdialog-actions"><button type="button" class="btn ghost" data-close>Cancel</button><button type="button" class="btn" data-send>Send request</button></div>
    </form>`;
    const v = id => d.querySelector('#' + id)?.value.trim();
    d.onclick = async e => {
      if (e.target.closest('[data-close]')) return d.close();
      const send = e.target.closest('[data-send]');
      if (!send) return;
      const err = d.querySelector('.error-box'); err.textContent = '';
      const body = { listingId: l.id, purpose: v('rqPurpose'), date: v('rqDate'), people: v('rqPeople'), budget: v('rqBudget'), message: v('rqMsg') };
      if (!user) Object.assign(body, { name: v('rqName'), email: v('rqEmail'), phone: v('rqPhone'), buyerType: v('rqType'), termsAccepted: d.querySelector('#rqTerms').checked });
      send.disabled = true;
      try {
        const r = await api('/market/requests', { method: 'POST', body });
        d.querySelector('.gdialog-body').innerHTML = `<h2>Request sent</h2>
          <p>It’s with the seller now. When they accept, our team approves the match and connects you. We’ve emailed you a confirmation.</p>
          ${r.loggedIn ? '<p class="meta">You can follow it under “My requests”.</p>' : '<p class="meta">Want to track all your requests in one place? <a href="/login?as=buyer">Create a free buyer account</a> with the same email.</p>'}
          <div class="gdialog-actions"><button type="button" class="btn" data-close>Done</button></div>`;
        onDone && onDone();
        document.dispatchEvent(new CustomEvent('market:requested'));
      } catch (ex) { err.textContent = ex.message; send.disabled = false; }
    };
    d.showModal();
  }

  // ---------- "Find it for me": our team matches by hand ----------
  function openConcierge(user) {
    const d = dialog('mkConcierge');
    d.innerHTML = `<form method="dialog" class="gdialog-body" novalidate>
      <h2>Find it for me</h2>
      <p class="meta">Tell us what you need. Our team will find the right space or professional and get back to you.</p>
      <div class="field"><label for="cnWhat">What are you looking for?</label><input id="cnWhat" maxlength="160" placeholder="Rooftop for 30 people, a baker for 200 cupcakes…"></div>
      <div class="row">
        <div class="field"><label for="cnArea">Area</label><input id="cnArea" maxlength="120"></div>
        <div class="field"><label for="cnDate">When</label><input id="cnDate" type="date"></div>
      </div>
      <div class="row">
        <div class="field"><label for="cnPeople">People</label><input id="cnPeople" type="number" min="1"></div>
        <div class="field"><label for="cnBudget">Budget in ₹</label><input id="cnBudget" type="number" min="0"></div>
      </div>
      <div class="field"><label for="cnDetails">Details <span class="hint">(optional)</span></label><textarea id="cnDetails" maxlength="1500"></textarea></div>
      ${user ? '' : `<div class="row">
        <div class="field"><label for="cnName">Your name</label><input id="cnName" autocomplete="name"></div>
        <div class="field"><label for="cnEmail">Email</label><input id="cnEmail" type="email" autocomplete="email"></div></div>
        <div class="field"><label for="cnPhone">Phone <span class="hint">(optional)</span></label><input id="cnPhone" type="tel"></div>`}
      <p class="error-box" role="alert"></p>
      <div class="gdialog-actions"><button type="button" class="btn ghost" data-close>Cancel</button><button type="button" class="btn" data-send>Send to the team</button></div>
    </form>`;
    const v = id => d.querySelector('#' + id)?.value.trim();
    d.onclick = async e => {
      if (e.target.closest('[data-close]')) return d.close();
      const send = e.target.closest('[data-send]');
      if (!send) return;
      send.disabled = true;
      try {
        await api('/market/concierge', { method: 'POST', body: { what: v('cnWhat'), area: v('cnArea'), date: v('cnDate'), people: v('cnPeople'), budget: v('cnBudget'), details: v('cnDetails'), name: v('cnName'), email: v('cnEmail'), phone: v('cnPhone') } });
        d.close(); toast('Sent. Our team will get back to you.');
      } catch (ex) { d.querySelector('.error-box').textContent = ex.message; send.disabled = false; }
    };
    d.showModal();
  }

  // ---------- Buyer: my requests ----------
  const STEPS = ['Sent to seller', 'Seller accepted', 'Approved by RentMySite', 'Matched'];
  const stepOf = s => ({ pending_review: 1, requested: 1, pending_approval: 2, awaiting_payment: 3, matched: 4, accepted: 4, completed: 4, declined: 2, cancelled: 0 }[s] ?? 1);
  const shareHtml = s => s ? `<div class="contact-box"><strong>One step left:</strong> pay the RentMySite share of ${inr(s.amount)} to confirm the match.${s.payUrl ? ` <a class="btn small" href="${esc(s.payUrl)}" target="_blank" rel="noopener">Pay ${inr(s.amount)}</a>` : ' Your RentMySite manager will send the payment details.'}</div>` : '';
  async function renderMyRequests(el) {
    el.innerHTML = '<p class="meta">Loading…</p>';
    let rows;
    try { rows = (await api('/market/my/requests')).requests; } catch (e) { el.innerHTML = `<p class="error-box">${esc(e.message)}</p>`; return; }
    el.innerHTML = rows.length ? `<div class="list">${rows.map(r => {
      const n = stepOf(r.status), bad = r.status === 'declined' || r.status === 'cancelled';
      return `<div class="item">
        <div class="item-top"><span class="item-title">${esc(r.listing?.title || r.what)}</span><span class="pill ${bad ? 'declined' : ['accepted', 'matched'].includes(r.status) ? 'accepted' : 'pending'}">${esc(r.statusLabel)}</span></div>
        <div class="meta">${esc(r.what)}${r.date ? `, ${fmtDate(r.date)}` : ''}${r.people ? `, ${r.people} people` : ''}${r.listing ? `. ${esc(r.listing.seller)}` : ''}</div>
        ${r.status === 'cancelled' ? '' : `<ol class="mk-steps">${STEPS.map((s, i) => `<li class="${i < n ? (bad && i === n - 1 ? 'bad' : 'done') : ''}">${esc(i === 1 && r.status === 'declined' ? 'Not available' : s)}</li>`).join('')}</ol>`}
        ${r.note ? `<p class="item-body"><strong>From our team:</strong> ${esc(r.note)}</p>` : ''}
        ${r.status === 'pending_approval' ? '<p class="item-body meta">The seller accepted. Our team is approving the match now.</p>' : ''}
        ${r.status === 'awaiting_payment' && !r.share ? '<p class="item-body meta">Approved by our team. The match is confirmed as soon as the RentMySite share is received.</p>' : ''}
        ${shareHtml(r.share)}
        ${r.status === 'matched' ? '<div class="contact-box"><strong>It’s a match.</strong> Your RentMySite manager coordinates everything with the seller for you. Reply to any of our emails or call +91 81039 90990.</div>' : ''}
        ${r.status === 'accepted' ? '<p class="item-body meta">Your RentMySite manager will contact you to confirm the details and payment.</p>' : ''}
        ${r.canCancel ? `<button class="btn ghost small" type="button" data-cancel-req="${esc(r.id)}">Cancel request</button>` : ''}
      </div>`; }).join('')}</div>`
      : '<div class="list"><div class="empty"><strong>No requests yet</strong>Find a space or professional and send a request. You’ll be able to follow it here.</div></div>';
    el.onclick = async e => {
      const b = e.target.closest('[data-cancel-req]');
      if (!b) return;
      if (!confirm('Cancel this request?')) return;
      try { await api(`/market/my/requests/${b.dataset.cancelReq}/cancel`, { method: 'POST' }); toast('Request cancelled'); renderMyRequests(el); }
      catch (ex) { toast(ex.message, true); }
    };
  }

  // ---------- Seller: my listings ----------
  const LISTING_STATUS = { pending_review: ['Being checked by RentMySite', 'pending'], live: ['Live', 'approved'], paused: ['Paused', 'pending'], rejected: ['Taken down by RentMySite: edit to republish', 'declined'] };
  async function renderMyListings(el, { role, suggestions = [], area = '' }) {
    const isSpace = role === 'business';
    el.innerHTML = '<p class="meta">Loading…</p>';
    let rows;
    try { rows = (await api('/market/my/listings')).listings; } catch (e) { el.innerHTML = `<p class="error-box">${esc(e.message)}</p>`; return; }
    el.innerHTML = `<div class="section-title"><h2>${isSpace ? 'Your spaces and free slots' : 'What you offer'}</h2>
        <button class="btn" type="button" data-new-listing>${isSpace ? 'Add a space' : 'Add a service'}</button></div>
      <p class="meta" style="margin-top:-.4rem">Listings are published for buyers straight away. Buyers never see your phone or email until the RentMySite team confirms a match.</p>
      ${rows.length ? `<div class="mk-grid">${rows.map(l => {
        const [label, cls] = LISTING_STATUS[l.status] || [l.status, 'pending'];
        return `<div class="mk-own">${card(l, { canRequest: false })}
          <div class="mk-own-bar"><span class="pill ${cls}">${label}</span>
            <span class="mk-own-actions">
              <button class="btn ghost small" type="button" data-edit-listing="${esc(l.id)}">Edit</button>
              ${l.status === 'live' ? `<button class="btn ghost small" type="button" data-listing-action="pause" data-id="${esc(l.id)}">Pause</button>` : ''}
              ${l.status === 'paused' ? `<button class="btn ghost small" type="button" data-listing-action="resume" data-id="${esc(l.id)}">Resume</button>` : ''}
              <button class="btn ghost small" type="button" data-listing-action="remove" data-id="${esc(l.id)}">Remove</button>
            </span></div>
          ${l.reviewNote ? `<p class="mk-review">From our team: ${esc(l.reviewNote)}</p>` : ''}</div>`; }).join('')}</div>`
        : `<div class="list"><div class="empty"><strong>${isSpace ? 'No spaces listed yet' : 'No services listed yet'}</strong>${isSpace ? 'List a hall, kitchen, room or quiet hours so event managers, companies and professionals can book them.' : 'List what you offer, with a price, so businesses and buyers can book you.'}</div></div>`}`;
    el.onclick = async e => {
      if (e.target.closest('[data-new-listing]')) return openListingForm({ isSpace, suggestions, area, onSaved: () => renderMyListings(el, { role, suggestions, area }) });
      const ed = e.target.closest('[data-edit-listing]');
      if (ed) return openListingForm({ isSpace, suggestions, area, listing: rows.find(x => x.id === ed.dataset.editListing), onSaved: () => renderMyListings(el, { role, suggestions, area }) });
      const act = e.target.closest('[data-listing-action]');
      if (act) {
        if (act.dataset.listingAction === 'remove' && !confirm('Remove this listing?')) return;
        try { await api(`/market/my/listings/${act.dataset.id}`, { method: 'PATCH', body: { action: act.dataset.listingAction } }); renderMyListings(el, { role, suggestions, area }); }
        catch (ex) { toast(ex.message, true); }
      }
    };
  }

  function openListingForm({ isSpace, suggestions, area, listing, onSaved }) {
    const d = dialog('mkListing');
    const l = listing || {};
    d.innerHTML = `<form method="dialog" class="gdialog-body" novalidate>
      <h2>${listing ? 'Edit listing' : isSpace ? 'Add a space or free slot' : 'Add a service'}</h2>
      ${!listing && suggestions.length ? `<p class="meta">Ideas for you:</p><div class="pick" style="margin:.4rem 0 1rem">${suggestions.slice(0, 6).map(s => `<button type="button" class="pick-chip" data-fill="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}
      <div class="field"><label for="lsTitle">Title</label><input id="lsTitle" maxlength="100" value="${esc(l.title || '')}" placeholder="${isSpace ? 'Banquet hall, weekday mornings' : 'Private chef for house parties'}"></div>
      <div class="field"><label for="lsDesc">Description</label><textarea id="lsDesc" maxlength="1500" placeholder="${isSpace ? 'Size, facilities, what’s included' : 'What you do, what’s included, your experience'}">${esc(l.description || '')}</textarea></div>
      <div class="row">
        <div class="field"><label for="lsPrice">Price in ₹ <span class="hint">(0 = on request)</span></label><input id="lsPrice" type="number" min="0" value="${l.price ?? ''}"></div>
        <div class="field"><label for="lsUnit">Charged</label><select id="lsUnit">${UNITS.map(([v, t]) => `<option value="${v}" ${l.priceUnit === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      </div>
      <div class="row">
        <div class="field"><label for="lsAvail">When it’s available</label><input id="lsAvail" maxlength="200" value="${esc(l.availability || '')}" placeholder="Mon–Thu, 9am–1pm"></div>
        ${isSpace ? `<div class="field"><label for="lsCap">How many people it fits</label><input id="lsCap" type="number" min="1" value="${l.capacity ?? ''}"></div>` : `<div class="field"><label for="lsArea">Area you cover</label><input id="lsArea" maxlength="120" value="${esc(l.area || area)}"></div>`}
      </div>
      ${isSpace ? `<div class="field"><label for="lsArea">Area</label><input id="lsArea" maxlength="120" value="${esc(l.area || area)}"></div>` : ''}
      <div class="field"><label for="lsTags">Keywords <span class="hint">(comma separated, helps buyers find you)</span></label><input id="lsTags" maxlength="300" value="${esc((l.tags || []).join(', '))}"></div>
      <p class="error-box" role="alert"></p>
      <div class="gdialog-actions"><button type="button" class="btn ghost" data-close>Cancel</button><button type="button" class="btn" data-save>${listing ? 'Save and publish' : 'Publish'}</button></div>
    </form>`;
    const v = id => d.querySelector('#' + id)?.value.trim();
    d.onclick = async e => {
      const f = e.target.closest('[data-fill]');
      if (f) { d.querySelector('#lsTitle').value = f.dataset.fill; d.querySelector('#lsTitle').focus(); return; }
      if (e.target.closest('[data-close]')) return d.close();
      const save = e.target.closest('[data-save]');
      if (!save) return;
      save.disabled = true;
      const body = { title: v('lsTitle'), description: v('lsDesc'), price: v('lsPrice'), priceUnit: v('lsUnit'), availability: v('lsAvail'), area: v('lsArea'), capacity: isSpace ? v('lsCap') : '', tags: v('lsTags') };
      try {
        await api(listing ? `/market/my/listings/${listing.id}` : '/market/my/listings', { method: listing ? 'PATCH' : 'POST', body });
        d.close(); toast('Published. Buyers can see it now, and our team has been told.'); onSaved && onSaved();
      } catch (ex) { d.querySelector('.error-box').textContent = ex.message; save.disabled = false; }
    };
    d.showModal();
  }

  // ---------- Seller: requests from buyers (professionals; businesses use Booking requests) ----------
  async function renderIncoming(el, { onChange } = {}) {
    el.innerHTML = '<p class="meta">Loading…</p>';
    let rows;
    try { rows = (await api('/market/my/incoming')).requests; } catch (e) { el.innerHTML = `<p class="error-box">${esc(e.message)}</p>`; return; }
    el.innerHTML = rows.length ? `<div class="list">${rows.map(r => `<div class="item">
        <div class="item-top"><span class="item-title">${esc(r.what)}</span><span class="pill ${['accepted', 'matched'].includes(r.status) ? 'accepted' : ['declined', 'cancelled'].includes(r.status) ? 'declined' : 'requested'}">${esc(r.statusLabel)}</span></div>
        <div class="meta">${esc(r.listingTitle)}. From ${esc(r.from)}${r.date ? `, ${fmtDate(r.date)}` : ''}${r.people ? `, ${r.people} people` : ''}${r.budget ? `, budget ${inr(r.budget)}` : ''}</div>
        ${r.message ? `<p class="item-body">${esc(r.message)}</p>` : ''}
        ${r.status === 'requested' ? `<label class="check" style="margin-top:.6rem"><input type="checkbox" data-agree-req="${esc(r.id)}"> I agree to do this under the RentMySite partner terms.</label>
          <div class="accept-row"><button class="btn" type="button" data-accept-req="${esc(r.id)}">Accept</button><button class="btn warn small" type="button" data-decline-req="${esc(r.id)}">Decline</button></div>` : ''}
        ${r.status === 'accepted' ? '<p class="item-body meta">Your RentMySite manager will connect you with the buyer.</p>' : ''}
        ${r.status === 'pending_approval' ? '<p class="item-body meta">You accepted: it’s a match. Our team is approving it now.</p>' : ''}
        ${r.status === 'awaiting_payment' && !r.share ? '<p class="item-body meta">Approved by our team. The match is confirmed as soon as the RentMySite share is received.</p>' : ''}
        ${r.note ? `<p class="item-body"><strong>From our team:</strong> ${esc(r.note)}</p>` : ''}
        ${shareHtml(r.share)}
        ${r.status === 'matched' ? '<div class="contact-box"><strong>It’s a match.</strong> Your RentMySite manager coordinates everything with the buyer for you. Reply to any of our emails or call +91 81039 90990.</div>' : ''}
      </div>`).join('')}</div>`
      : '<div class="list"><div class="empty"><strong>No requests yet</strong>Requests from buyers appear here as soon as they’re sent.</div></div>';
    el.onclick = async e => {
      const a = e.target.closest('[data-accept-req]'), dcl = e.target.closest('[data-decline-req]');
      if (!a && !dcl) return;
      const id = (a || dcl).dataset.acceptReq || (a || dcl).dataset.declineReq;
      if (a && !el.querySelector(`[data-agree-req="${id}"]`).checked) { toast('Tick the agreement to accept', true); return; }
      try {
        await api(`/market/my/incoming/${id}/${a ? 'accept' : 'decline'}`, { method: 'POST', body: { agreementAccepted: Boolean(a) } });
        toast(a ? 'Accepted. Our team will approve the match and connect you.' : 'Declined'); renderIncoming(el, { onChange }); onChange && onChange();
      } catch (ex) { toast(ex.message, true); }
    };
    return rows;
  }

  window.Market = { renderBrowse, openRequest, openConcierge, renderMyRequests, renderMyListings, renderIncoming, card };
})();
