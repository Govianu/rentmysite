(async function () {
  const user = await guard('admin');
  if (!user) return;
  document.getElementById('whoName').textContent = user.name;
  document.getElementById('whoStatus').outerHTML = pill('approved');

  let admins = [];
  let stages = ['new', 'contacted', 'meeting', 'cta_sent', 'signed', 'lost'];

  // ---------- Overview ----------
  async function loadOverview() {
    const o = await api('/admin/overview');
    document.getElementById('todayLine').textContent =
      `${o.importedToday} of ${o.importTarget} profiles imported today.`;
    document.getElementById('stats').innerHTML = `
      <div class="stat"><div class="v">${o.importedToday}/${o.importTarget}</div><div class="k">imported today</div></div>
      <div class="stat"><div class="v">${o.requestedBookings}</div><div class="k">matches to approve</div></div>
      <div class="stat"><div class="v">${o.proposedWorkshops}</div><div class="k">workshops to approve</div></div>
      <div class="stat"><div class="v">${(o.users.business || 0)} / ${(o.users.associate || 0)}</div><div class="k">businesses / associates</div></div>`;
    document.getElementById('pipeline').innerHTML = stages
      .map(s => `<div class="stat"><div class="v">${o.leads[s] || 0}</div><div class="k">${pretty(s)}</div></div>`).join('');
  }

  // ---------- Website enquiries ----------
  async function loadEnquiries() {
    const { enquiries } = await api('/admin/enquiries');
    const mail = st => ({ sent: 'sent', outbox: 'saved to outbox', failed: 'failed' }[st] || '—');
    document.getElementById('enquiryRows').innerHTML = enquiries.length ? enquiries.map(e => `<tr>
      <td><strong>${esc(e.name)}</strong>${e.business ? `<div class="meta">${esc(e.business)}</div>` : ''}<div class="meta">${esc(e.email)}<br>${esc(e.phone || '')}</div></td>
      <td>${esc(e.roleName || e.role)}<div class="meta">${esc([e.businessType, e.location].filter(Boolean).join(', '))}</div>${e.message ? `<div class="meta">${esc(e.message.slice(0, 140))}</div>` : ''}</td>
      <td>${new Date(e.termsAcceptedAt).toLocaleString('en-IN')}<div class="meta">Version ${esc(e.termsVersion)}<br>IP ${esc(e.ip || '—')}</div></td>
      <td class="meta">To them: ${mail(e.emailStatus?.person)}<br>To team: ${mail(e.emailStatus?.team)}</td>
      <td>${e.user?.handle ? `<code class="handle">${handleHtml(e.user.handle)}</code><div>${pill(e.user.status)}</div>` : '<span class="meta">Team follow-up</span>'}</td>
    </tr>`).join('') : '<tr><td colspan="5" class="empty"><strong>No enquiries yet</strong>Enquiries from the homepage appear here.</td></tr>';
  }

  // ---------- Import ----------
  onSubmit(document.getElementById('importForm'), async (data, form) => {
    const btn = form.querySelector('button[type="submit"]');
    btn.textContent = 'Importing…';
    try {
      const { results } = await api('/admin/import/bulk', { method: 'POST', body: data });
      document.getElementById('importResults').innerHTML = results.map(r => `<div class="item">
        ${r.ok
          ? `<div class="item-top"><code class="handle">${handleHtml(r.handle)}</code><span class="pill ${r.duplicate ? 'pending' : 'approved'}">${r.duplicate ? 'already imported' : 'created'}</span></div>`
          : `<div class="item-top"><span class="meta" style="word-break:break-all">${esc(r.mapsUrl)}</span><span class="pill rejected">failed</span></div><div class="meta">${esc(r.error)}</div>`}
      </div>`).join('');
      const ok = results.filter(r => r.ok && !r.duplicate).length;
      toast(`${ok} profile${ok === 1 ? '' : 's'} created`);
      form.links.value = '';
      loadOverview();
    } finally {
      btn.textContent = 'Import profiles';
    }
  });

  // ---------- Leads ----------
  const stageFilter = document.getElementById('stageFilter');
  async function loadLeads() {
    const q = stageFilter.value ? `?stage=${stageFilter.value}` : '';
    const d = await api('/admin/leads' + q);
    stages = d.stages;
    if (stageFilter.options.length === 1) stageFilter.innerHTML += stages.map(s => `<option value="${s}">${pretty(s)}</option>`).join('');
    document.getElementById('leadRows').innerHTML = d.leads.length
      ? d.leads.map(l => {
          const last = l.history[l.history.length - 1] || {};
          return `<tr>
            <td><input type="checkbox" data-lead-pick="${l._id}" aria-label="Select ${esc(l.name)}"></td>
            <td>${l.leadId ? `<code class="handle">${esc(l.leadId)}</code><br>` : ''}<strong>${esc(l.name)}</strong>${l.company ? `<div class="meta">${esc(l.company)}</div>` : ''}<div class="meta">${esc(l.phone || '')} ${esc(l.email || '')}</div>
              ${l.relatedUser?.handle ? `<code class="handle">${handleHtml(l.relatedUser.handle)}</code>` : ''}</td>
            <td>${esc(l.source)}</td>
            <td>${pill(l.stage)}</td>
            <td><div class="meta">${fmtDate(last.at)}${l.owner ? `, ${esc(l.owner.name)}` : ''}</div>
              ${last.note ? `<div>${esc(last.note)}</div>` : ''}</td>
            <td style="min-width:230px">
              <select data-stage-for="${l._id}">${stages.map(s => `<option value="${s}" ${s === l.stage ? 'selected' : ''}>${pretty(s)}</option>`).join('')}</select>
              <input data-note-for="${l._id}" placeholder="Note" style="margin-top:.35rem">
              <button class="btn small" data-move="${l._id}" style="margin-top:.35rem">Update stage</button>
              <button class="btn small ghost danger" type="button" data-lead-del="${l._id}" style="margin-top:.35rem">Delete</button>
            </td></tr>`;
        }).join('')
      : '<tr><td colspan="6" class="empty"><strong>No leads here</strong>Imports and booking requests create leads automatically.</td></tr>';
    document.getElementById('leadAll').checked = false;
    syncLeadDelete();
  }

  // Delete leads (e.g. test sign-ups), one or many, optionally with the accounts behind them
  const leadDeleteBtn = document.getElementById('leadDelete');
  const picked = () => [...document.querySelectorAll('[data-lead-pick]:checked')].map(x => x.dataset.leadPick);
  function syncLeadDelete() {
    const n = picked().length;
    leadDeleteBtn.disabled = !n;
    leadDeleteBtn.textContent = n ? `Delete ${n} selected` : 'Delete selected';
  }
  async function deleteLeads(ids) {
    const withAccounts = document.getElementById('leadWithAccounts').checked;
    if (!confirm(`Delete ${ids.length} lead${ids.length === 1 ? '' : 's'}${withAccounts ? ' and the accounts and dashboards behind them' : ''}? This cannot be undone.`)) return;
    const r = await api('/admin/leads/delete', { method: 'POST', body: { ids, withAccounts } });
    toast(`Deleted ${r.leads} lead${r.leads === 1 ? '' : 's'}${r.accounts ? ` and ${r.accounts} account${r.accounts === 1 ? '' : 's'}` : ''}`);
    loadLeads();
  }
  document.getElementById('leadAll').addEventListener('change', e => {
    document.querySelectorAll('[data-lead-pick]').forEach(x => { x.checked = e.target.checked; });
    syncLeadDelete();
  });
  document.getElementById('leadRows').addEventListener('change', e => { if (e.target.matches('[data-lead-pick]')) syncLeadDelete(); });
  document.getElementById('leadRows').addEventListener('click', e => {
    const b = e.target.closest('[data-lead-del]');
    if (b) deleteLeads([b.dataset.leadDel]).catch(err => toast(err.message, true));
  });
  leadDeleteBtn.addEventListener('click', () => deleteLeads(picked()).catch(err => toast(err.message, true)));
  stageFilter.addEventListener('change', loadLeads);
  onSubmit(document.getElementById('leadForm'), async (data, form) => {
    await api('/admin/leads', { method: 'POST', body: data });
    form.reset(); toast('Lead added'); loadLeads();
  });

  // ---------- Profiles ----------
  let searchTimer;
  // KYC: Aadhaar (last 4 only), PAN and bank, with document links, and a button to mark it checked
  function kycCell(u) {
    const k = u.kycStatus;
    if (!k) return '';
    if (!k.complete) return `<span class="pill pending">Missing</span><div class="meta">${esc(k.missing.join(', '))}</div>`;
    const docs = ['aadhaar', 'pan', 'bank'].map(d => `<a href="/api/kyc/docs/${d}?user=${u._id}" target="_blank" rel="noopener">${d === 'bank' ? 'Bank' : d.toUpperCase()}</a>`).join(' · ');
    return `${k.verifiedAt ? '<span class="pill approved">Verified</span>' : `<button class="btn small" type="button" data-kyc-verify="${u._id}">Mark verified</button>`}
      <div class="meta">Aadhaar ${esc(k.aadhaar)} · PAN ${esc(k.pan)}<br>${esc(k.bankName || 'Bank')} ${esc(k.accountNumber)} · ${esc(k.ifsc)}<br>${docs}</div>`;
  }
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-kyc-verify]');
    if (!b) return;
    b.disabled = true;
    try { await api(`/kyc/user/${b.dataset.kycVerify}/verify`, { method: 'POST' }); toast('KYC marked verified'); loadUsers(); if (document.getElementById('kycRows')) loadKyc(); }
    catch (err) { toast(err.message, true); b.disabled = false; }
  });

  async function loadKyc() {
    const { partners } = await api('/kyc/all');
    const docLink = (p, d, label) => p.kyc.docs[d] ? `<a href="/api/kyc/docs/${d}?user=${p._id}" target="_blank" rel="noopener">${label}</a>` : `<span class="meta">${label}: missing</span>`;
    document.getElementById('kycRows').innerHTML = partners.map(p => `<tr>
      <td><strong>${esc(p.business || p.name)}</strong>${p.leadId ? ` <code class="handle">${esc(p.leadId)}</code>` : ''}<div class="meta">${esc(p.name)} · ${esc(p.email)}<br>${esc(p.phone)}</div></td>
      <td>${esc(p.kyc.aadhaar || 'Aadhaar missing')}<br>${esc(p.kyc.pan || 'PAN missing')}</td>
      <td>${esc(p.kyc.accountName || '')}<br>${esc(p.kyc.bankName || '')} ${esc(p.kyc.accountNumber || 'Account missing')}<br>${esc(p.kyc.ifsc || '')}</td>
      <td>${docLink(p, 'aadhaar', 'Aadhaar')}<br>${docLink(p, 'pan', 'PAN card')}<br>${docLink(p, 'bank', 'Cheque/passbook')}</td>
      <td>${p.kyc.verifiedAt ? '<span class="pill approved">Verified</span>' : p.kyc.complete ? `<button class="btn small" type="button" data-kyc-verify="${p._id}">Mark verified</button>` : `<span class="pill pending">Missing</span><div class="meta">${esc(p.kyc.missing.join(', '))}</div>`}</td>
    </tr>`).join('') || '<tr><td colspan="5" class="empty"><strong>No KYC yet</strong>Partners fill it in from their Profile.</td></tr>';
  }

  async function loadUsers() {
    const p = new URLSearchParams();
    const r = document.getElementById('roleFilter').value;
    const q = document.getElementById('userSearch').value.trim();
    if (r) p.set('role', r); else p.set('role', '');
    if (q) p.set('q', q);
    const d = await api('/admin/users?' + [...p].filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&'));
    admins = d.admins;
    document.getElementById('userRows').innerHTML = d.users.filter(u => u.role !== 'admin').map(u => `<tr>
      <td><code class="handle">${handleHtml(u.handle)}</code><div class="meta">${pretty(u.role)}</div></td>
      <td>${esc(u.role === 'business' ? u.business?.businessName : u.name)}${u.business?.mapsUrl ? `<div><a href="${esc(u.business.mapsUrl)}" target="_blank" rel="noopener">Maps</a></div>` : ''}</td>
      <td class="meta">${esc(u.email || 'Not claimed yet')}<br>${esc(u.phone || '')}</td>
      <td>${kycCell(u)}</td>
      <td><select data-user-manager="${u._id}"><option value="">Unassigned</option>${admins.map(a => `<option value="${a._id}" ${u.assignedManager?._id === a._id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></td>
    </tr>`).join('') || '<tr><td colspan="5" class="empty"><strong>No profiles match</strong>Try another filter.</td></tr>';
  }
  ['roleFilter'].forEach(id => document.getElementById(id).addEventListener('change', loadUsers));
  document.getElementById('userSearch').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadUsers, 300); });

  // ---------- Gigs ----------
  async function loadGigs() {
    const { gigs } = await api('/admin/gigs');
    document.getElementById('gigRows').innerHTML = gigs.map(g => `<tr>
      <td><strong>${esc(g.title)}</strong><div class="meta">${g.type === 'workshop' ? `Workshop by ${esc(g.host?.name || '')}` : `Shift for ${pretty(g.category)}`}</div></td>
      <td>${esc(g.venue?.business?.businessName || g.location || '—')}<div class="meta">${fmtDate(g.date)}</div></td>
      <td>${g.type === 'workshop' ? `${inr(g.pricePerSeat)} × ${g.seats} seats<div class="meta">${inr(g.pricePerSeat * g.seats)} potential</div>` : `${inr(g.pay)} per shift`}</td>
      <td>${g.type === 'shift' ? `${g.applicants.length}/${g.slots} applied<div class="meta">${g.applicants.map(a => esc(a.name)).join(', ')}</div>` : '—'}</td>
      <td><select data-gig-status="${g._id}">${['proposed', 'open', 'filled', 'closed', 'cancelled'].map(x => `<option ${x === g.status ? 'selected' : ''}>${x}</option>`).join('')}</select></td>
    </tr>`).join('') || '<tr><td colspan="5" class="empty"><strong>No gigs yet</strong>Post a shift above.</td></tr>';
  }
  onSubmit(document.getElementById('gigForm'), async (data, form) => {
    await api('/admin/gigs', { method: 'POST', body: data });
    form.reset(); toast('Shift posted'); loadGigs();
  });

  // ---------- Bookings ----------
  async function loadBookings() {
    const { bookings } = await api('/admin/bookings');
    if (!bookings.length) {
      document.getElementById('bookingList').innerHTML = '<div class="list"><div class="empty"><strong>No bookings yet</strong>Bookings arrive through each venue’s booking page.</div></div>';
      return;
    }
    const items = await Promise.all(bookings.map(async b => {
      const split = await api('/payments/split-preview', { method: 'POST', body: { amount: b.amount, model: b.splitModel, partnerShare: b.partnerShare } });
      return `<div class="item">
        <div class="item-top"><span class="item-title">${esc(b.eventType)} at ${esc(b.business?.business?.businessName || '')}</span>${pill(b.status)}</div>
        <div class="meta">${esc(b.requesterName)}${b.leadGenName ? ` via ${esc(b.leadGenName)}` : ''}, ${fmtDate(b.eventDate)}${b.payment?.orderId ? `, order ${esc(b.payment.orderId)}` : ''}</div>
        <div class="accept-row">
          <label style="margin:0">Amount <input type="number" min="0" value="${b.amount}" data-b-amount="${b._id}" style="width:130px"></label>
          <label style="margin:0">Model
            <select data-b-model="${b._id}" style="width:auto">
              <option value="four_way" ${b.splitModel === 'four_way' ? 'selected' : ''}>4-way 25% each</option>
              <option value="infra_first" ${b.splitModel === 'infra_first' ? 'selected' : ''}>20% infra first</option>
            </select></label>
          <label style="margin:0">Partner % of remainder <input type="number" min="0" max="100" value="${b.partnerShare}" data-b-share="${b._id}" style="width:90px"></label>
          <button class="btn ghost small" data-b-save="${b._id}">Save split</button>
          ${b.status === 'accepted' ? `<button class="btn small" data-b-order="${b._id}">Create payment order</button>` : ''}
        </div>
        ${splitHtml(split)}
        <pre class="meta" data-b-out="${b._id}" hidden style="white-space:pre-wrap;background:var(--paper);padding:.7rem;border-radius:8px"></pre>
      </div>`;
    }));
    document.getElementById('bookingList').innerHTML = `<div class="list">${items.join('')}</div>`;
  }

  // ---------- Event delegation ----------
  document.addEventListener('click', async e => {
    const t = e.target.closest('button');
    if (!t) return;
    try {
      if (t.dataset.move) {
        const id = t.dataset.move;
        await api(`/admin/leads/${id}`, { method: 'PATCH', body: {
          stage: document.querySelector(`[data-stage-for="${id}"]`).value,
          note: document.querySelector(`[data-note-for="${id}"]`).value
        } });
        toast('Lead updated'); loadLeads();
      } else if (t.dataset.bSave) {
        const id = t.dataset.bSave;
        await api(`/admin/bookings/${id}`, { method: 'PATCH', body: {
          amount: document.querySelector(`[data-b-amount="${id}"]`).value,
          splitModel: document.querySelector(`[data-b-model="${id}"]`).value,
          partnerShare: document.querySelector(`[data-b-share="${id}"]`).value
        } });
        toast('Split saved'); loadBookings();
      } else if (t.dataset.bOrder) {
        const id = t.dataset.bOrder;
        const r = await api(`/payments/orders/${id}`, { method: 'POST' });
        const out = document.querySelector(`[data-b-out="${id}"]`);
        out.hidden = false;
        out.textContent = r.dryRun
          ? `Razorpay keys are not set, so this is a dry run. This order would be created:\n${JSON.stringify(r.payload, null, 2)}${r.missing.length ? `\n\nMissing linked accounts: ${r.missing.join(', ')}` : ''}`
          : `Order ${r.order.id} created. Send the customer to checkout with this order ID.`;
      }
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.addEventListener('change', async e => {
    const el = e.target;
    try {
      if (el.dataset.userManager !== undefined && el.dataset.userManager) {
        await api(`/admin/users/${el.dataset.userManager}`, { method: 'PATCH', body: { assignedManager: el.value } });
        toast('Manager assigned');
      } else if (el.dataset.gigStatus) {
        await api(`/admin/gigs/${el.dataset.gigStatus}`, { method: 'PATCH', body: { status: el.value } });
        toast('Gig updated');
      }
    } catch (err) { toast(err.message, true); }
  });

  // ---------- Marketplace: matches to approve, RentMySite share to collect, listings to watch ----------
  let marketData = { requests: [], listings: [] };
  const PILL_CLASS = { pending_review: 'pending', pending_approval: 'pending', awaiting_payment: 'requested', requested: 'requested',
    matched: 'approved', accepted: 'approved', live: 'approved', completed: 'approved', declined: 'declined', rejected: 'declined', cancelled: 'declined', paused: 'pending' };
  const mpill = (status, label) => `<span class="pill ${PILL_CLASS[status] || 'requested'}">${esc(label)}</span>`;
  // Most urgent first: matches to approve, shares to collect, old-flow reviews, then the rest
  const URGENCY = { pending_approval: 0, awaiting_payment: 1, pending_review: 2, requested: 3 };
  const urgency = r => URGENCY[r.status] ?? 9;

  function dealActions(r) {
    if (r.status === 'pending_approval') {
      return `<div class="deal-box">
        <p class="meta"><strong>Matched: the seller accepted.</strong> Approve to request RentMySite’s share. Buyer and seller never get each other’s details; you coordinate both sides.</p>
        <div class="row">
          <div class="field"><label for="amt-${esc(r.id)}">Agreed amount (₹)</label><input id="amt-${esc(r.id)}" type="number" min="1" value="${r.budget || ''}" data-deal-amount="${esc(r.id)}"></div>
          <div class="field"><label for="mdl-${esc(r.id)}">Split</label><select id="mdl-${esc(r.id)}" data-deal-model="${esc(r.id)}">
            <option value="four_way" ${r.splitModel === 'four_way' ? 'selected' : ''}>4-way (RentMySite 25%)</option>
            <option value="infra_first" ${r.splitModel === 'infra_first' ? 'selected' : ''}>Infrastructure first</option></select></div>
          <div class="field"><label for="pay-${esc(r.id)}">RentMySite share paid by</label><select id="pay-${esc(r.id)}" data-deal-payer="${esc(r.id)}">
            <option value="seller" ${r.sharePayer !== 'buyer' ? 'selected' : ''}>Seller</option><option value="buyer" ${r.sharePayer === 'buyer' ? 'selected' : ''}>Buyer</option></select></div>
        </div>
        <p class="meta" data-deal-preview="${esc(r.id)}">${r.suggestedShare != null ? `RentMySite share: ${inr(r.suggestedShare)}` : 'Enter the amount to see RentMySite’s share.'}</p>
        <div class="accept-row">
          <input placeholder="Note for buyer and seller (needed to decline)" data-mnote="${esc(r.id)}" style="max-width:380px">
          <button class="btn small" type="button" data-deal="approve" data-id="${esc(r.id)}">Approve and request RentMySite share</button>
          <button class="btn warn small" type="button" data-deal="decline-match" data-id="${esc(r.id)}">Decline</button></div>
      </div>`;
    }
    if (r.status === 'awaiting_payment') {
      return `<div class="deal-box">
        <p class="meta"><strong>Approved. Waiting for RentMySite share of ${inr(r.pmbShare)}</strong> from the ${esc(r.sharePayer)} (agreed amount ${inr(r.budget)}).
          ${r.payment?.linkUrl ? `Razorpay link: <a href="${esc(r.payment.linkUrl)}" target="_blank" rel="noopener">${esc(r.payment.linkUrl)}</a>. Checked automatically when you press the button.` : 'No Razorpay link: collect it directly and enter the reference.'}</p>
        <div class="accept-row">
          <input placeholder="Payment reference (UTR / payment ID)" data-mref="${esc(r.id)}" style="max-width:300px">
          <button class="btn small" type="button" data-deal="share-received" data-id="${esc(r.id)}">Share received: confirm match</button>
          <input placeholder="Note (needed to decline)" data-mnote="${esc(r.id)}" style="max-width:220px">
          <button class="btn warn small" type="button" data-deal="decline-match" data-id="${esc(r.id)}">Decline</button></div>
      </div>`;
    }
    if (r.status === 'matched') {
      return `<p class="meta"><strong>Matched.</strong> RentMySite share ${inr(r.pmbShare)} received${r.payment?.reference ? ` (ref ${esc(r.payment.reference)})` : ''}. Neither side has the other’s details: coordinate between them.</p>`;
    }
    if (r.status === 'pending_review') {  // requests from before listings went straight to sellers
      return `<div class="accept-row">
          <input placeholder="Note for the buyer (needed to decline)" data-mnote="${esc(r.id)}" style="max-width:380px">
          <button class="btn small" type="button" data-mreq="${esc(r.id)}" data-decision="forward">Forward to seller</button>
          <button class="btn warn small" type="button" data-mreq="${esc(r.id)}" data-decision="decline">Decline</button></div>`;
    }
    if (r.status === 'requested') return '<p class="meta">With the seller. When they accept, it comes back here for approval.</p>';
    return '';
  }

  async function loadMarket() {
    marketData = await api('/admin/market');
    const toApprove = marketData.requests.filter(r => r.status === 'pending_approval' || r.status === 'pending_review');
    const toCollect = marketData.requests.filter(r => r.status === 'awaiting_payment');
    setCount('market', toApprove.length + toCollect.length);
    const reqEl = document.getElementById('marketRequests');
    const reqs = marketData.requests.slice().sort((a, b) => urgency(a) - urgency(b));
    reqEl.innerHTML = reqs.length ? `<p class="meta">${toApprove.length} to approve, ${toCollect.length} waiting for RentMySite share, ${marketData.requests.filter(r => r.status === 'matched').length} matched</p><div class="list">${reqs.map(r => `<div class="item">
        <div class="item-top"><span class="item-title">${esc(r.what)}</span>${mpill(r.status, r.statusLabel)}</div>
        <div class="meta"><strong>${esc(r.listingTitle)}</strong>${r.price ? `, ${esc(r.price)}` : ''}${r.date ? `, ${fmtDate(r.date)}` : ''}${r.people ? `, ${r.people} people` : ''}${r.budget ? `, ${r.status === 'pending_approval' || r.status === 'requested' ? 'budget' : 'amount'} ${inr(r.budget)}` : ''}</div>
        <div class="two-col" style="margin-top:.6rem;gap:.8rem">
          <div class="meta"><strong>Buyer</strong><br>${esc(r.buyer.name)}${r.buyer.type ? ` (${esc(r.buyer.type)})` : ''}<br>${esc(r.buyer.email || '')}${r.buyer.phone ? `<br>${esc(r.buyer.phone)}` : ''}</div>
          <div class="meta"><strong>Seller</strong><br>${esc(r.seller.name)}<br>${esc(r.seller.email || '')}${r.seller.phone ? `<br>${esc(r.seller.phone)}` : ''}${r.seller.handle ? `<br><code class="handle">${handleHtml(r.seller.handle)}</code>` : ''}</div>
        </div>
        ${r.message ? `<p class="item-body">${esc(r.message)}</p>` : ''}
        ${dealActions(r)}
      </div>`).join('')}</div>` : '<div class="list"><div class="empty"><strong>No requests yet</strong>Buyer requests appear here. When a seller accepts one, it waits here for your approval.</div></div>';

    const listEl = document.getElementById('marketListings');
    const LST = { pending_review: 'Waiting for review', live: 'Live', paused: 'Paused by seller', rejected: 'Taken down' };
    const lorder = l => ({ pending_review: 0, live: 1, paused: 2, rejected: 3 }[l.status] ?? 4);
    const lists = marketData.listings.slice().sort((a, b) => lorder(a) - lorder(b));
    listEl.innerHTML = lists.length ? `<p class="meta">${lists.filter(l => l.status === 'live').length} live. Sellers publish straight away; take a listing down if anything is wrong.</p><div class="list">${lists.map(l => `<div class="item">
        <div class="item-top"><span class="item-title">${esc(l.title)}</span>${mpill(l.status, LST[l.status] || l.status)}</div>
        <div class="meta">${l.kind === 'space' ? 'Space' : 'Professional service'}, ${esc(l.ownerName)} (${esc(l.ownerEmail)}). ${esc(l.priceText)}${l.capacity ? `, up to ${l.capacity} people` : ''}${l.availability ? `, ${esc(l.availability)}` : ''}${l.area ? `, ${esc(l.area)}` : ''}</div>
        ${l.description ? `<p class="item-body">${esc(l.description)}</p>` : ''}
        ${l.reviewNote ? `<p class="meta">Last note: ${esc(l.reviewNote)}</p>` : ''}
        ${['live', 'paused', 'pending_review'].includes(l.status) ? `<div class="accept-row">
          <input placeholder="Note for the seller (needed to take down)" data-lnote="${esc(l.id)}" style="max-width:380px">
          ${l.status === 'pending_review' ? `<button class="btn small" type="button" data-mlist="${esc(l.id)}" data-decision="restore">Publish</button>` : ''}
          <button class="btn warn small" type="button" data-mlist="${esc(l.id)}" data-decision="takedown">Take down</button></div>` : ''}
        ${l.status === 'rejected' ? `<div class="accept-row"><button class="btn ghost small" type="button" data-mlist="${esc(l.id)}" data-decision="restore">Put back live</button></div>` : ''}
      </div>`).join('')}</div>` : '<div class="list"><div class="empty"><strong>No listings yet</strong>Spaces from businesses and services from professionals appear here as soon as they’re published.</div></div>';
  }
  document.querySelector('#view-market .view-tabs').addEventListener('click', e => {
    const b = e.target.closest('[data-mtab]'); if (!b) return;
    document.querySelectorAll('[data-mtab]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    document.getElementById('marketRequests').hidden = b.dataset.mtab !== 'requests';
    document.getElementById('marketListings').hidden = b.dataset.mtab !== 'listings';
  });
  // Live RentMySite share preview while the amount or split changes
  document.getElementById('view-market').addEventListener('input', async e => {
    const id = e.target.dataset.dealAmount || e.target.dataset.dealModel;
    if (!id) return;
    const amount = Number(document.querySelector(`[data-deal-amount="${id}"]`).value);
    const out = document.querySelector(`[data-deal-preview="${id}"]`);
    if (!(amount > 0)) { out.textContent = 'Enter the amount to see RentMySite’s share.'; return; }
    try {
      const s = await api('/payments/split-preview', { method: 'POST', body: { amount, model: document.querySelector(`[data-deal-model="${id}"]`).value } });
      out.textContent = `RentMySite share: ${inr(s.lines.find(x => x.party === 'platform')?.amountInr || 0)}`;
    } catch (ex) { out.textContent = ex.message; }
  });
  document.getElementById('view-market').addEventListener('click', async e => {
    const d = e.target.closest('[data-deal]');
    if (d) {
      const id = d.dataset.id, action = d.dataset.deal;
      const val = sel => document.querySelector(sel)?.value || '';
      const body = action === 'approve'
        ? { amount: Number(val(`[data-deal-amount="${id}"]`)), splitModel: val(`[data-deal-model="${id}"]`), sharePayer: val(`[data-deal-payer="${id}"]`), note: val(`[data-mnote="${id}"]`) }
        : action === 'share-received' ? { reference: val(`[data-mref="${id}"]`) } : { note: val(`[data-mnote="${id}"]`) };
      if (action === 'decline-match' && !confirm('Decline this match? The buyer and seller are both told.')) return;
      d.disabled = true;
      try {
        const r = await api(`/admin/market/requests/${encodeURIComponent(id)}/${action}`, { method: 'POST', body });
        toast(action === 'approve' ? (r.status === 'matched' ? 'Approved and matched' : `Approved. RentMySite share of ${inr(r.pmbShare)} requested${r.payUrl ? ' with a Razorpay link' : ''}`)
          : action === 'share-received' ? 'Share received. It’s a match: both sides have been emailed.' : 'Match declined');
        loadMarket();
      } catch (ex) { toast(ex.message, true); d.disabled = false; }
      return;
    }
    const r = e.target.closest('[data-mreq]'), l = e.target.closest('[data-mlist]');
    if (!r && !l) return;
    const id = (r || l).dataset.mreq || (r || l).dataset.mlist;
    const note = document.querySelector(r ? `[data-mnote="${id}"]` : `[data-lnote="${id}"]`)?.value || '';
    try {
      await api(r ? `/admin/market/requests/${encodeURIComponent(id)}/review` : `/admin/market/listings/${encodeURIComponent(id)}/review`, { method: 'POST', body: { decision: (r || l).dataset.decision, note } });
      toast(r ? ((r.dataset.decision === 'forward') ? 'Forwarded to the seller' : 'Request declined') : (l.dataset.decision === 'restore' ? 'Listing is live' : 'Listing taken down; the seller has been told'));
      loadMarket();
    } catch (ex) { toast(ex.message, true); }
  });

  document.getElementById('marketRefresh').addEventListener('click', () => loadMarket().then(() => toast('Up to date')).catch(err => toast(err.message, true)));
  // Keep the queues fresh while the Marketplace section is open
  setInterval(() => { if (!document.getElementById('view-market').hidden && !document.hidden) loadMarket().catch(() => {}); }, 60000);

  const loaders = { plots: () => window.loadPlots(), comms: () => window.loadComms(), market: loadMarket, overview: loadOverview, enquiries: loadEnquiries, leads: loadLeads, profiles: loadUsers, kyc: loadKyc, gigs: loadGigs, bookings: loadBookings };
  initViews(name => loaders[name] && loaders[name]().catch(err => toast(err.message, true)));
  loadMarket().catch(() => {}); // waiting-review badge in the menu
  loadOverview().catch(() => {});
})();
