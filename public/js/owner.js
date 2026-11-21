/* Owner dashboard: free site report (journey, estimate, best uses, share tiers), space details, listings,
   requests, the mandate, statements and Profile & KYC. Data: /api/owner, /api/business, /api/market, /api/growth */
(function () {
  const STEPS = [
    ['Mandate, not a lease', 'You sign a mandate. We assess the space and agree the terms and revenue model with you. No upfront cost.'],
    ['Survey and plan', 'We survey frontage, access, power and drainage and draw a plan you approve. Nothing is built before that.'],
    ['Build and activate', 'We arrange approvals and basic infrastructure, and bring in brands and operators you approved.'],
    ['Operate and share', 'Brands run their business; we run the site. Revenue is collected, costs accounted for, and your share paid monthly.'],
    ['Open books', 'A statement every month, line by line, and a yearly audit of the site accounts.'],
    ['Free to sell', 'Sell any time. The buyer steps into the mandate, or the site winds down on notice.']
  ];

  function deck(el, slides) {
    let at = 0;
    el.innerHTML = `<div class="ddeck" tabindex="0" role="region" aria-roledescription="slides" aria-label="From dormant space to payout">
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
          <a class="btn small" href="#feasibility">See my feasibility report</a> <a class="btn ghost small" href="#space">Update my space details</a>
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

  // ---------- Feasibility report (/api/owner/feasibility) ----------
  const RATING = { High: 'feas-high', Medium: 'feas-medium', Low: 'feas-low' };
  const rating = r => `<span class="feas-pill ${RATING[r] || ''}">${esc(r)}</span>`;
  const range = (lo, hi) => (lo === hi ? inr(lo) : `${inr(lo)}–${inr(hi)}`);
  function streamRow(x, i) {
    const money = x.kind === 'core' ? inr(x.monthly) : range(x.low, x.high);
    const detail = x.kind === 'core'
      ? `${x.area ? `${x.area.toLocaleString('en-IN')} sq ft at ₹${x.rate.low}–${x.rate.high} / sq ft. ` : ''}${x.reasons.join('. ')}.`
      : x.kind === 'ai' ? x.why : (x.reasons.join(' ') || '');
    return `<tr><td><strong>${i + 1}. ${esc(x.name)}</strong><small>${esc(detail)}</small><small>Run by: ${esc(x.runBy)}${x.funding ? ` · ${esc(x.funding)}` : ''}</small></td>
      <td data-label="A month">${money}</td><td data-label="Investment">${esc(x.investment)}</td><td data-label="First revenue">${esc(x.time)}</td><td data-label="Feasibility">${rating(x.feasibility)}</td></tr>`;
  }
  const streamTable = (rows, start = 0) => `<div class="feas-table-wrap"><table class="feas-table">
    <thead><tr><th>Revenue stream</th><th>A month</th><th>Investment</th><th>First revenue</th><th>Feasibility</th></tr></thead>
    <tbody>${rows.map((x, i) => streamRow(x, start + i)).join('')}</tbody></table></div>`;

  function renderFeasibility(el, f, name) {
    const v = f.verdict;
    const aiRows = f.ai?.streams || [];
    el.innerHTML = `<div class="feas" id="feasPrint">
      <div class="feas-head"><small>RentMySite.ai · Feasibility report</small><h2>${esc(name)}</h2><span>Prepared ${fmtDate(f.preparedOn)}</span></div>
      <div class="feas-verdict feas-v-${v.level}"><strong>${esc(v.title)}</strong><p>${esc(v.text)}</p>
        ${f.startWith.length ? `<p>Start with: <b>${f.startWith.map(esc).join('</b> and <b>')}</b>.</p>` : ''}
        ${v.level === 'pending' ? '<a class="btn small" href="#space">Add my space details</a>' : ''}</div>

      <h3>1. Feasibility summary</h3>
      <table class="feas-ind"><tbody>${f.indicators.map(([k, val]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(val)}</td></tr>`).join('')}</tbody></table>

      <h3>2. Commercial revenue streams</h3>
      <div class="feas-totals">
        <div><small>Core streams</small><b>${inr(f.totals.core)}</b><small>site revenue a month</small></div>
        <div><small>Add-on streams</small><b>${range(f.totals.addOnLow, f.totals.addOnHigh)}</b><small>on top, a month</small></div>
        <div class="std"><small>All streams together</small><b>${range(f.totals.low, f.totals.high)}</b><small>site revenue a month</small></div>
      </div>
      <h4>Core streams <span class="meta">the main uses, sharing the space</span></h4>
      ${f.core.length && f.totals.core ? streamTable(f.core) : '<p class="meta">Add the size of your space to see what each use earns.</p>'}
      ${f.addOns.length ? `<h4>Add-on streams <span class="meta">need little or no floor space</span></h4>${streamTable(f.addOns, f.core.length)}` : ''}
      ${aiRows.length ? `<h4>Suggested by AI for your site</h4>${f.ai.summary ? `<p>${esc(f.ai.summary)}</p>` : ''}${streamTable(aiRows, f.core.length + f.addOns.length)}`
        : f.aiPending ? '<p class="meta feas-ai-wait">AI is looking at your site for more revenue streams. This takes about a minute…</p>' : ''}
      <p class="fine">Illustrative only, not an offer. Figures are site revenue before running costs (about 45%) and before your share; your share depends on the funding tier in your mandate. Earnings depend on location, approvals and demand and are not guaranteed. A survey sets the real figures.</p>
      <div class="feas-cta"><a class="btn" href="#cta">Read my mandate</a><a class="btn ghost" href="#space">Update my space details</a></div>
    </div>`;
  }

  let feasTimer = null;
  async function loadFeasibility(name) {
    const el = document.getElementById('feasBox');
    try {
      const f = await api('/owner/feasibility');
      renderFeasibility(el, f, name);
      clearTimeout(feasTimer);
      // AI streams arrive in the background: check again while they are being prepared
      if (f.aiPending) feasTimer = setTimeout(() => { if (location.hash === '#feasibility') loadFeasibility(name); }, 15000);
    } catch (e) { el.innerHTML = `<p class="error-box">${esc(e.message)}</p>`; }
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

    document.getElementById('printFeas').addEventListener('click', () => window.print());

    initViews(view => {
      if (view === 'feasibility') loadFeasibility(user.business?.businessName || user.name);
      if (view === 'spaces') Market.renderMyListings(document.getElementById('mySpaces'), { role: 'business', suggestions: report.bestUses.map(u => u.name), area: user.location || '' });
      if (view === 'bookings') Market.renderIncoming(document.getElementById('incomingBox'));
    });
  })();
})();
