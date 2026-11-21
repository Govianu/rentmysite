/* Owner dashboard: free site report (journey, estimate, best uses, share tiers), space details, listings,
   requests, the mandate, statements and Profile & KYC. Data: /api/owner, /api/business, /api/market, /api/growth */
(function () {
  const STEPS = [
    ['Mandate, not a lease', 'You sign a mandate. We assess the plot and agree the terms and revenue model with you. No upfront cost.'],
    ['Survey and plan', 'We survey frontage, access, power and drainage and draw a plan you approve. Nothing is built before that.'],
    ['Build and activate', 'We arrange approvals and basic infrastructure, and bring in brands and operators you approved.'],
    ['Operate and share', 'Brands run their business; we run the site. Revenue is collected, costs accounted for, and your share paid monthly.'],
    ['Open books', 'A statement every month, line by line, and a yearly audit of the site accounts.'],
    ['Free to sell', 'Sell any time. The buyer steps into the mandate, or the site winds down on notice.']
  ];

  function deck(el, slides) {
    let at = 0;
    el.innerHTML = `<div class="ddeck" tabindex="0" role="region" aria-roledescription="slides" aria-label="From plot to payout">
      <div class="ddeck-stage"></div>
      <div class="ddeck-nav"><button class="ddeck-arrow" type="button" aria-label="Previous slide">‹</button><div class="ddeck-dots">${slides.map((s, i) => `<button class="ddeck-dot" type="button" data-i="${i}" aria-label="Slide ${i + 1}"></button>`).join('')}</div><span class="ddeck-count"></span><button class="ddeck-arrow" type="button" aria-label="Next slide">›</button></div></div>`;
    const stage = el.querySelector('.ddeck-stage');
    const show = i => {
      at = (i + slides.length) % slides.length;
      stage.innerHTML = `<div class="ddeck-slide"><div class="ddeck-text"><span class="ddeck-kicker">Step ${at + 1} of ${slides.length}</span><h3 class="ddeck-title">${esc(slides[at][0])}</h3><p class="ddeck-body">${esc(slides[at][1])}</p></div></div>`;
      el.querySelectorAll('.ddeck-dot').forEach((d, k) => d.setAttribute('aria-current', String(k === at)));
      el.querySelector('.ddeck-count').textContent = `${at + 1} / ${slides.length}`;
    };
    const [prev, next] = el.querySelectorAll('.ddeck-arrow');
    prev.onclick = () => show(at - 1); next.onclick = () => show(at + 1);
    el.querySelector('.ddeck-dots').onclick = e => { const d = e.target.closest('[data-i]'); if (d) show(Number(d.dataset.i)); };
    el.querySelector('.ddeck').onkeydown = e => { if (e.key === 'ArrowLeft') show(at - 1); if (e.key === 'ArrowRight') show(at + 1); };
    show(0);
  }

  function renderReport(r) {
    document.getElementById('journey').innerHTML = `<ol class="journey">${r.journey.map(j => `<li class="j-${j.state}"><strong>${esc(j.title)}</strong><span>${esc(j.text)}</span></li>`).join('')}</ol>`;
    const s = r.space;
    const est = r.estimate;
    document.getElementById('reportBox').innerHTML = `
      <div class="report">
        <div class="panel">
          <h2 style="margin-top:0">Your space</h2>
          <p class="meta">${s.type ? esc(s.type) : 'Type not set'}${s.size ? ` · ${s.size.toLocaleString('en-IN')} sq ft` : ''}${s.location ? ` · ${esc(s.location)}` : ''}</p>
          <h3>Best uses for it</h3>
          <ul class="uses-list">${r.bestUses.map(u => `<li><span>${esc(u.name)}</span><b>₹${u.low}–${u.high} / sq ft / month</b></li>`).join('')}</ul>
          <a class="btn ghost small" href="#space">Update my space details</a>
        </div>
        <div class="panel est-panel">
          <h2 style="margin-top:0">Indicative estimate</h2>
          ${est ? `
            <div class="est-row"><span>Site revenue a month</span><b>${inr(est.revenue)}</b></div>
            <div class="est-row"><span>Running costs</span><b>${inr(est.costs)}</b></div>
            <div class="est-row"><span>Site profit a month</span><b>${inr(est.profit)}</b></div>
            <h3>Your share each month</h3>
            <div class="tier-grid">${est.tiers.map(t => `<div class="${t.key === 'brand' ? 'std' : ''}"><small>${esc(t.name)}</small><b>${inr(t.amount)}</b><small>${Math.round(t.share * 100)}%</small></div>`).join('')}</div>`
          : `<p class="meta">Add the size of your space to see an estimate.</p><a class="btn small" href="#space">Add my space details</a>`}
          <p class="fine">Illustrative only, not an offer. Earnings depend on location and demand and are not guaranteed. A survey sets the real figure, and your share is set in the signed mandate.</p>
        </div>
      </div>`;
  }

  (async function () {
    const user = await guard('business');
    if (!user) return;
    fillWho(user, user.business?.businessName || user.name);
    document.getElementById('hello').textContent = `Hello, ${firstNameOf(user.name)}`;

    let report = await api('/owner/report');
    renderReport(report);
    deck(document.getElementById('deckBox'), STEPS);

    // Space details
    const f = document.getElementById('spaceForm');
    f.type.innerHTML = '<option value="">Choose…</option>' + report.types.map(t => `<option>${esc(t)}</option>`).join('');
    f.type.value = report.space.type; f.size.value = report.space.size || ''; f.location.value = report.space.location;
    f.road.value = report.space.road; f.hours.value = report.space.hours; f.notes.value = report.space.notes;
    onSubmit(f, async data => {
      await api('/owner/space', { method: 'POST', body: data });
      report = await api('/owner/report'); renderReport(report);
      toast('Saved. Your report is updated.'); location.hash = '#overview';
    });

    // Profile
    const pf = document.getElementById('profileForm');
    pf.phone.value = user.phone || ''; pf.address.value = user.business?.address || '';
    onSubmit(pf, async data => { await api('/business/profile', { method: 'PATCH', body: data }); toast('Profile saved'); });

    // The mandate (utils/ctaFull.js)
    CtaDash.mount({}, user);

    initViews(view => {
      if (view === 'spaces') Market.renderMyListings(document.getElementById('mySpaces'), { role: 'business', suggestions: report.bestUses.map(u => u.name), area: user.location || '' });
      if (view === 'bookings') Market.renderIncoming(document.getElementById('incomingBox'));
    });
  })();
})();
