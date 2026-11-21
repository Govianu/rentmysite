(async function () {
  let user = await guard('business');
  if (!user) return;
  const bizName = user.business?.businessName || user.name;
  fillWho(user, bizName);
  document.getElementById('hello').textContent = `Hello, ${firstNameOf(user.name)}`;
  document.getElementById('statusLine').innerHTML = `${esc(bizName)} is live on the network. Your CTA is under <a href="#cta">My CTA</a>.`;
  document.getElementById('bookingLink').href = `/book?h=${encodeURIComponent(user.handle)}`;

  let state = { opportunities: [], bookings: [], stats: {}, meetConfigured: false, industry: {} };

  // ---------- Growth kit (business-type specific) ----------
  const growth = await api('/growth');
  const ctx = Growth.contextFor({ role: 'business', user, industry: growth.industry, skills: growth.skills, watched: growth.lessonsWatched });
  CtaDash.mount(ctx, user);   // My CTA, Save costs, videos and creatives (and financial planning for professionals)
  document.title = `${ctx.display} dashboard: RentMySite.ai`;
  let player = null;
  let growthRendered = false;

  function openLesson(i) {
    location.hash = 'learn';
    setTimeout(() => player && player.select(i, true), 60);
  }
  function editSkills() {
    Growth.openSkillsDialog(ctx, skills => { ctx.skills = skills; growthRendered = false; renderGrowth(); player && player.refresh(ctx); });
  }
  document.getElementById('changeSkills').addEventListener('click', editSkills);

  function renderGrowth() {
    const pending = state.bookings.filter(b => b.status === 'requested').length;
    ctx.pending = pending;
    Growth.renderCtaBar(document.getElementById('ctaBar'), ctx, {
      secondary: `<a class="btn ghost" href="#bookings">Booking requests${pending ? `<span class="count-badge">${pending}</span>` : ''}</a>
        <button class="btn ghost" type="button" data-cta="growth_call">Book a growth call</button>`,
      primary: Growth.launchCta(ctx)
    });
    if (!growthRendered) {
      Growth.renderSlides(document.getElementById('slides'), ctx, { onLesson: openLesson });
      Growth.renderCommunity(document.getElementById('community'), ctx);
      Growth.renderPlanner(document.getElementById('planner'), ctx);
      if (!player) player = Growth.mountPlayer(document.getElementById('player'), document.getElementById('playlist'), ctx, {
        onWatched: async lesson => {
          try { await api('/growth/lessons/watched', { method: 'POST', body: { key: lesson.key } }); } catch { /* progress is a nice-to-have */ }
          renderGrowth();
        }
      });
      growthRendered = true;
    }
    Growth.renderSkills(document.getElementById('skillsBox'), ctx, editSkills);
    Growth.renderLessonStrip(document.getElementById('lessonStrip'), ctx, openLesson);
    document.getElementById('lessonsTitle').textContent = ctx.skills.length ? 'Your video lessons' : `Video lessons for ${ctx.plural}`;
    document.getElementById('learnIntro').textContent = ctx.skills.length
      ? `Built from your skills: ${ctx.skills.slice(0, 4).join(', ')}.`
      : `Lessons for ${ctx.plural}. Choose your skills to make them yours.`;
    document.getElementById('opportunityTitle').textContent = state.industry?.growthTitle || 'Ways to grow your business';
    document.getElementById('opportunityIntro').textContent = state.industry?.growthDescription || 'Ideas picked for your business.';

    const steps = [
      { title: 'Choose your skills', done: ctx.skills.length > 0, act: 'skills', label: 'Choose' },
      { title: 'Watch your first lesson', done: ctx.watched.length > 0, href: '#learn', label: 'Watch' },
      { title: 'Pick a growth idea', done: state.opportunities.some(o => o.status === 'interested'), href: '#learn', label: 'Explore' },
      { title: 'Complete your profile', done: Boolean(user.phone && user.business?.address && user.business?.idleSlots), href: '#profile', label: 'Complete' },
      { title: 'Get your first booking request', done: state.bookings.length > 0, act: 'share', label: 'Share page' }
    ];
    const done = steps.filter(x => x.done).length;
    const pct = Math.round((done / steps.length) * 100);
    document.getElementById('nextSteps').innerHTML = `
      <div class="nextsteps-head"><div class="ring" style="--p:${pct}"><span>${pct}%</span></div>
        <div><h2 style="margin:0">Your next steps</h2><p class="meta" style="margin:0">${done} of ${steps.length} done</p></div></div>
      <ol>${steps.map(x => `<li class="${x.done ? 'done' : ''}"><strong>${esc(x.title)}</strong>${x.done ? '' : (x.href
        ? `<a class="btn ghost small" href="${x.href}">${esc(x.label)}</a>`
        : `<button class="btn ghost small" type="button" data-step="${x.act}">${esc(x.label)}</button>`)}</li>`).join('')}</ol>`;
  }
  document.getElementById('nextSteps').addEventListener('click', e => {
    const b = e.target.closest('[data-step]');
    if (!b) return;
    if (b.dataset.step === 'skills') editSkills();
    if (b.dataset.step === 'share') document.getElementById('shareBookingPage')?.click();
  });

  async function load() {
    state = await api('/business/dashboard');
    render();
  }

  function render() {
    const s = state.stats;
    document.getElementById('stats').innerHTML = `
      <div class="stat"><div class="v">${s.pending}</div><div class="k">requests waiting</div></div>
      <div class="stat"><div class="v">${s.accepted}</div><div class="k">accepted bookings</div></div>
      <div class="stat"><div class="v">${inr(s.yourShare)}</div><div class="k">your share so far</div></div>
      <div class="stat"><div class="v">${inr(s.potentialMonthly)}</div><div class="k">possible extra / month</div></div>`;
    setCount('bookings', s.pending);

    const pending = state.bookings.filter(b => b.status === 'requested');
    document.getElementById('pendingList').innerHTML = pending.length
      ? `<div class="list">${pending.map(bookingItem).join('')}</div>`
      : `<div class="list"><div class="empty"><strong>No requests right now</strong>Share your booking page with event managers to start getting requests.</div></div>`;

    document.getElementById('bookingList').innerHTML = state.bookings.length
      ? `<div class="list">${state.bookings.map(bookingItem).join('')}</div>`
      : `<div class="list"><div class="empty"><strong>No bookings yet</strong>Requests appear here as soon as someone books through your page.</div></div>`;

    document.getElementById('opps').innerHTML = state.opportunities.length
      ? state.opportunities.map(oppCard).join('')
      : `<div class="panel empty"><strong>Ideas are being prepared</strong>Refresh in a minute, or tap “Suggest new ideas”.</div>`;

    renderGrowth();
  }

  function oppCard(o) {
    return `<article class="opp">
      <h3>${esc(o.title)}</h3>
      <div class="earn">${inr(o.estMonthly)} <small>estimated extra per month</small></div>
      <div class="asset">${esc(o.idleAsset)}</div>
      <p>${esc(o.pitch)}</p>
      ${o.videoUrl ? `<a href="${esc(o.videoUrl)}" target="_blank" rel="noopener">Watch the 30-second pitch</a>` : ''}
      ${o.videoScript ? `<details><summary>30-second pitch script</summary><pre>${esc(o.videoScript)}</pre></details>` : ''}
      <div class="actions">
        ${o.status === 'interested'
          ? `<span class="pill approved">Your manager will call you</span>`
          : `<button class="btn small" data-opp="${o._id}" data-status="interested">I’m interested</button>
             <button class="btn ghost small" data-opp="${o._id}" data-status="dismissed">Not for me</button>`}
        <button class="btn ghost small" type="button" data-launch="${esc(o.title)}">Help me launch this</button>
      </div>
    </article>`;
  }

  function bookingItem(b) {
    const share = b.split.lines.find(l => l.party === 'business');
    let action = '';
    if (b.status === 'requested') {
      action = `<div class="accept-row">
        <label class="check"><input type="checkbox" data-agree="${b._id}">
          I agree to host this booking under the RentMySite partner terms, with ${esc(b.split.modelLabel.toLowerCase())}.</label>
      </div>
      <div class="accept-row">
        <button class="btn" data-accept="${b._id}">Accept booking</button>
        <button class="btn warn small" data-decline="${b._id}">Decline</button>
      </div>`;
    } else if (b.status === 'pending_approval') {
      action = '<p class="meta">You accepted: it’s a match. The RentMySite team is approving it now.</p>';
    } else if (b.status === 'awaiting_payment') {
      action = b.share
        ? `<div class="contact-box"><strong>One step left:</strong> pay the RentMySite share of ${inr(b.share.amount)} to confirm the match.${b.share.payUrl ? ` <a class="btn small" href="${esc(b.share.payUrl)}" target="_blank" rel="noopener">Pay ${inr(b.share.amount)}</a>` : ' Your RentMySite manager will send the payment details.'}</div>`
        : '<p class="meta">Approved by the RentMySite team. The match is confirmed as soon as the RentMySite share is received.</p>';
    } else if (b.status === 'matched') {
      action = '<div class="contact-box"><strong>It’s a match.</strong> Your RentMySite manager coordinates everything with the customer for you. Reply to any of our emails or call +91 81039 90990.</div>';
    } else if (b.status === 'accepted') {
      action = b.meetLink
        ? `<p><a class="btn small" href="${esc(b.meetLink)}" target="_blank" rel="noopener">Join onboarding call on Google Meet</a></p>`
        : `<p class="meta">Accepted on ${fmtDate(b.agreementAcceptedAt)}. Your RentMySite manager will send the onboarding call link.</p>`;
    }
    return `<div class="item">
      <div class="item-top">
        <span class="item-title">${esc(b.eventType)} for ${esc(b.requesterName)}</span>
        ${pill(b.status)}
      </div>
      <div class="meta">${fmtDate(b.eventDate)}${b.guests ? `, ${b.guests} guests` : ''}${b.leadGenName ? `, via ${esc(b.leadGenName)}` : ''}</div>
      ${b.message ? `<p class="item-body">${esc(b.message)}</p>` : ''}
      ${b.amount > 0 ? `<div class="meta" style="margin-top:.6rem">Booking value ${inr(b.amount)}. You receive ${inr(share?.amountInr)}.</div>${splitHtml(b.split, 'business')}` : ''}
      ${action}
    </div>`;
  }

  document.addEventListener('click', async e => {
    const t = e.target.closest('button');
    if (!t) return;
    try {
      if (t.dataset.launch) {
        Growth.openCtaDialog(ctx, { action: 'launch_idea', topic: t.dataset.launch });
        return;
      } else if (t.dataset.opp) {
        t.disabled = true;
        await api(`/business/opportunities/${t.dataset.opp}`, { method: 'PATCH', body: { status: t.dataset.status } });
        toast(t.dataset.status === 'interested' ? 'Sent to your RentMySite manager' : 'Idea hidden');
        await load();
      } else if (t.dataset.accept) {
        const box = t.closest('.item').querySelector(`[data-agree="${t.dataset.accept}"]`); // the box beside this button, not the copy on another tab
        if (!box?.checked) { toast('Tick the agreement to accept this booking', true); box?.focus(); return; }
        t.disabled = true;
        const { booking } = await api(`/business/bookings/${t.dataset.accept}/accept`, { method: 'POST', body: { agreementAccepted: true } });
        toast('Accepted. The RentMySite team will approve the match and connect you.');
        await load();
      } else if (t.dataset.decline) {
        if (!confirm('Decline this booking request?')) return;
        await api(`/business/bookings/${t.dataset.decline}/decline`, { method: 'POST' });
        toast('Booking declined');
        await load();
      } else if (t.id === 'shareBookingPage') {
        const url = new URL(document.getElementById('bookingLink').href, location.origin).href;
        if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(url);
        else {
          const input = document.createElement('textarea');
          input.value = url;
          document.body.appendChild(input);
          input.select();
          const copied = document.execCommand('copy');
          input.remove();
          if (!copied) throw new Error('Copy is unavailable in this browser. Use “Open your booking page” instead.');
        }
        toast('Booking page link copied');
      }
    } catch (err) {
      toast(err.message, true);
      t.disabled = false;
    }
  });

  document.getElementById('refreshOpps').addEventListener('click', async e => {
    e.target.disabled = true;
    e.target.textContent = 'Thinking…';
    try { await api('/business/opportunities/refresh', { method: 'POST' }); await load(); toast('New ideas added'); }
    catch (err) { toast(err.message, true); }
    finally { e.target.disabled = false; e.target.textContent = 'Suggest new ideas'; }
  });

  // ---------- Profile ----------
  const pf = document.getElementById('profileForm');
  pf.phone.value = user.phone || '';
  pf.address.value = user.business?.address || '';
  pf.idleSlots.value = user.business?.idleSlots || '';
  pf.razorpayAccountId.value = user.business?.razorpayAccountId || '';
  onSubmit(pf, async data => {
    const result = await api('/business/profile', { method: 'PATCH', body: data });
    user = result.user;
    toast('Profile saved');
    await load();
  });

  const m = user.assignedManager;
  document.getElementById('managerBox').innerHTML = m
    ? `<strong style="color:var(--ink)">${esc(m.name)}</strong><br>${esc(m.phone || '')}<br>${esc(m.email || '')}`
    : 'A RentMySite manager will be assigned once your profile is reviewed.';
  document.getElementById('sopList').innerHTML = (user.business?.sops || []).map(s => `<li>${esc(s)}</li>`).join('') || '<li>Added after review</li>';

  // ---------- Marketplace: sell your spaces, book other partners (RentMySite is the third party) ----------
  let browse = null;
  const spaceIdeas = String(ctx.sector.a || '').split(',').map(x => x.trim()).filter(Boolean)
    .map(x => x.charAt(0).toUpperCase() + x.slice(1)).concat(ctx.sector.s || []);
  function showFindTab(tab) {
    document.querySelectorAll('[data-find-tab]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.findTab === tab)));
    document.getElementById('findBox').hidden = tab !== 'browse';
    document.getElementById('myRequestsBox').hidden = tab !== 'mine';
    if (tab === 'mine') Market.renderMyRequests(document.getElementById('myRequestsBox'));
  }
  document.querySelector('#view-find .view-tabs').addEventListener('click', e => { const b = e.target.closest('[data-find-tab]'); if (b) showFindTab(b.dataset.findTab); });
  document.addEventListener('market:requested', () => showFindTab('mine'));

  initViews(view => {
    if (view !== 'learn' && player) player.pause();
    if ((view === 'bookings' || view === 'overview') && typeof state !== 'undefined' && state.bookings) load().catch(() => {}); // fresh requests each time
    if (view === 'spaces') Market.renderMyListings(document.getElementById('mySpaces'), { role: 'business', suggestions: spaceIdeas, area: user.location || '' });
    if (view === 'find' && !browse) browse = Market.renderBrowse(document.getElementById('findBox'), { user });
  });
  await load();
  if (!ctx.skills.length && !sessionStorage.getItem('pmbSkillsAsked:' + user._id)) {
    sessionStorage.setItem('pmbSkillsAsked:' + user._id, '1');
    editSkills();
  }
})();
