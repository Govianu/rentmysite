/* The CTA in the business and professional dashboards: the person's own CTA, the cost-saving vertical, the
   business type's videos and creatives (team research, link-shared from Google Drive), and, for professionals,
   financial planning. Data comes from /api/growth/my-cta. */
(function () {
  let cache = null;
  const load = () => (cache = cache || api('/growth/my-cta'));
  const money = n => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');

  // The detailed CTA (dashboard only): status, Deal Sheet, 14 sections, and the acceptance form with separate
  // tick-boxes, a typed signature and a record of when and where it was accepted (utils/ctaFull.js)
  async function renderMyCta(el) {
    if (!el) return;
    el.innerHTML = '<p class="meta">Loading your CTA…</p>';
    try {
      const d = await load();
      draw(el, d.full);
    } catch (e) { el.innerHTML = `<p class="error-box">${esc(e.message)}</p>`; }
  }
  function draw(el, f) {
    const a = f.accepted;
    el.innerHTML = `<div class="cta-status">${a
        ? `<span class="pill approved">Accepted</span> <span class="meta">Signed by ${esc(a.name)}${a.designation ? `, ${esc(a.designation)}` : ''} on ${fmtDate(a.at)}. ${esc(f.version)}. A copy was emailed to you.</span>`
        : `<span class="pill pending">Not accepted yet</span> <span class="meta">Read your mandate sheet and the mandate, then accept at the bottom. ${esc(f.version)}.</span>`}</div>
      <div class="cta-full">
        <h3>Your mandate sheet</h3>
        <table class="cta-sheet"><tbody>${f.dealSheet.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table>
        <h3>The mandate</h3>
        <div class="cta-sections">${f.sections.map((s, i) => `<details ${i === 0 ? 'open' : ''}><summary>${esc(s.title)}</summary>
          <ul>${s.points.map(p => `<li>${esc(p)}</li>`).join('')}</ul></details>`).join('')}</div>
        ${a ? `<h3>Your choices</h3><div class="cta-optional">${f.consents.filter(c => !c.required).map(c => {
            const on = a.optional.find(o => o.id === c.id)?.value;
            return `<label class="cta-check"><input type="checkbox" data-optional="${c.id}" ${on ? 'checked' : ''}> <span>${esc(c.label.replace(/^Optional: /, ''))}</span></label>`;
          }).join('')}<p class="meta">You can change these any time.</p></div>`
        : `<form class="cta-accept" novalidate>
          <h3>Accept your mandate</h3>
          <p class="meta">By accepting, you agree that:</p>
          <ul class="cta-points">${f.consents.filter(c => c.required).map(c => `<li>${esc(c.label)}</li>`).join('')}</ul>
          <label class="cta-check cta-agree"><input type="checkbox" name="agreeAll"> <span><strong>I have read my mandate sheet and the mandate above, and I agree to all of it.</strong></span></label>
          <div class="row">
            <div class="field"><label for="ctaName">Type your full name to sign</label><input id="ctaName" name="signName" autocomplete="name" maxlength="120"></div>
            <div class="field"><label for="ctaRole">Your role <span class="hint">e.g. Owner, Partner, Manager</span></label><input id="ctaRole" name="designation" maxlength="80"></div>
          </div>
          <p class="error-box" role="alert"></p>
          <button class="btn" type="submit" disabled>Accept the mandate</button>
          <p class="meta">We record your name, the time, your device and IP address, and the exact version you accepted, and email you a copy.</p>
        </form>`}
      </div>`;
    const form = el.querySelector('.cta-accept');
    if (form) {
      const btn = form.querySelector('button[type=submit]');
      const sync = () => { btn.disabled = !form.agreeAll.checked || form.signName.value.trim().length < 3; };
      form.addEventListener('input', sync); form.addEventListener('change', sync);
      form.addEventListener('submit', async e => {
        e.preventDefault();
        btn.disabled = true;
        try {
          const r = await api('/growth/cta/accept', { method: 'POST', body: { version: f.version, agreeAll: form.agreeAll.checked, name: form.signName.value, designation: form.designation.value } });
          cache = null; draw(el, r.full); toast('Mandate accepted. A copy is in your email.');
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (ex) { form.querySelector('.error-box').textContent = ex.message; sync(); }
      });
    }
    el.querySelectorAll('[data-optional]').forEach(box => box.addEventListener('change', async () => {
      try { await api('/growth/cta/optional', { method: 'POST', body: { id: box.dataset.optional, value: box.checked } }); toast('Saved'); }
      catch (ex) { toast(ex.message, true); box.checked = !box.checked; }
    }));
  }

  const PITCH = 'Having the idea is easy. Making it work is hard: you need a partner you can trust, a fair deal, customers and payments on time. We do all of that for you. You just say yes.';

  // A slide deck like the homepage one: one idea per slide, arrows, dots, keyboard, a button on each slide
  function deck(el, slides, label) {
    let at = 0;
    el.innerHTML = `<div class="ddeck" tabindex="0" role="region" aria-roledescription="slides" aria-label="${esc(label)}">
      <div class="ddeck-stage"></div>
      <div class="ddeck-nav"><button class="ddeck-arrow" type="button" aria-label="Previous slide">‹</button>
        <div class="ddeck-dots">${slides.map((s, i) => `<button class="ddeck-dot" type="button" aria-label="Slide ${i + 1}: ${esc(s.title)}" data-i="${i}"></button>`).join('')}</div>
        <span class="ddeck-count"></span><button class="ddeck-arrow" type="button" aria-label="Next slide">›</button></div></div>`;
    const root = el.querySelector('.ddeck'), stage = el.querySelector('.ddeck-stage');
    function show(i) {
      at = (i + slides.length) % slides.length;
      const s = slides[at];
      const media = s.video ? `<div class="ddeck-media ddeck-video"><iframe src="${esc(s.video.url)}" title="${esc(s.video.title || s.title)}" allow="autoplay" loading="lazy" allowfullscreen></iframe></div>`
        : s.img ? `<img class="ddeck-media" src="${esc(s.img.thumb)}" alt="${esc(s.title)}" onerror="this.remove()">` : '';
      stage.innerHTML = `<div class="ddeck-slide ${s.kind ? 'ddeck-' + s.kind : ''} ${media ? 'has-media' : ''}">
        <div class="ddeck-text"><span class="ddeck-kicker">${esc(s.kicker)}</span><h3 class="ddeck-title">${esc(s.title)}</h3>
          ${s.body ? `<p class="ddeck-body">${esc(s.body)}</p>` : ''}
          ${(s.facts || []).length ? `<ul class="ddeck-facts">${s.facts.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
          ${s.button ? `<button class="btn btn-gold" type="button" data-slide-go>${esc(s.button)}</button>` : ''}</div>${media}</div>`;
      const go = stage.querySelector('[data-slide-go]');
      if (go && s.onClick) go.addEventListener('click', s.onClick);
      el.querySelectorAll('.ddeck-dot').forEach((d, k) => d.setAttribute('aria-current', String(k === at)));
      el.querySelector('.ddeck-count').textContent = `${at + 1} / ${slides.length}`;
    }
    const [prev, next] = el.querySelectorAll('.ddeck-arrow');
    prev.onclick = () => show(at - 1); next.onclick = () => show(at + 1);
    el.querySelector('.ddeck-dots').onclick = e => { const d = e.target.closest('[data-i]'); if (d) show(Number(d.dataset.i)); };
    root.onkeydown = e => { if (e.key === 'ArrowLeft') show(at - 1); if (e.key === 'ArrowRight') show(at + 1); };
    show(0);
  }
  const norm = x => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const imgFor = (imgs, words) => imgs.find(i => words.some(w => w && (norm(i.title) === norm(w) || norm(i.title).includes(norm(w)))));

  // 5 different ways to earn, the same as in their welcome email and on the homepage, as slides
  async function renderWays(el, ctx) {
    if (!el) return;
    try {
      const { ways, about, media } = await load();
      if (!ways || !ways.length) { el.innerHTML = ''; return; }
      const inr = n => `₹${Math.round(n).toLocaleString('en-IN')}`;
      const imgs = media?.images || [];
      const talk = topic => () => Growth.openCtaDialog(ctx, { action: 'launch_idea', topic });
      const slides = [{ kind: 'intro', kicker: 'Earn more', title: about?.text ? 'What we found about you' : '5 ways to earn more',
        body: about?.text || 'Five different ways to earn more, one per slide. Press the arrows to see each one.',
        facts: [about?.busy && `Busy: ${about.busy}`, about?.quiet && `Quiet: ${about.quiet}`].filter(Boolean),
        video: media?.video || null, button: 'Talk to my RentMySite manager', onClick: talk('Ways to earn more') }]
        .concat(ways.map((w, i) => ({ kind: 'way', kicker: `Way ${i + 1} of ${ways.length}`, title: w.title, body: w.line,
          facts: [w.examples.length && `For example: ${w.examples.join(', ')}.`, w.estMonthly && `About ${inr(w.estMonthly)} a month`].filter(Boolean),
          img: imgFor(imgs, w.examples || []), button: 'I want this', onClick: talk(w.title) })))
        .concat([{ kind: 'close', kicker: 'Next step', title: 'Ready to start?', body: PITCH, button: 'Talk to my RentMySite manager', onClick: talk('Ways to earn more') }]);
      el.innerHTML = '<div class="section-title"><h2>5 ways to earn more</h2></div><div data-deck></div>';
      deck(el.querySelector('[data-deck]'), slides, '5 ways to earn more');
    } catch (e) { el.innerHTML = `<p class="error-box">${esc(e.message)}</p>`; }
  }

  // Where their money goes and 5 ways we cut it, as slides (same as the homepage and the email), with the video
  async function renderSavings(el, ctx) {
    if (!el) return;
    try {
      const { savings: s, media } = await load();
      if (!s) { el.innerHTML = ''; return; }
      const plan = topic => () => Growth.openCtaDialog(ctx, { action: 'save_costs', topic });
      const slides = [{ kind: 'save-intro', kicker: 'Spend less', title: 'Where your money goes',
        body: `Your biggest costs each month: ${s.topCosts.join(', ')}.`, facts: ['Next: 5 ways we cut them, one per slide.'],
        video: media?.video || null, button: 'Get my savings plan', onClick: plan('Cost-saving plan') }]
        .concat(s.levers.map((l, i) => ({ kind: 'save', kicker: `Save ${i + 1} of ${s.levers.length}${l.cost ? ': ' + l.cost.toLowerCase() : ''}`,
          title: l.title, body: l.we || '', facts: [l.leak && `Where the money goes: ${l.leak}`, `Save ${l.saving}.`].filter(Boolean),
          img: imgFor(media?.images || [], [l.cost, l.title]), button: 'Save on this', onClick: plan(`Saving: ${l.title}`) })))
        .concat([{ kind: 'close', kicker: 'Example', title: 'What it can add up to', body: s.example,
          facts: ['These numbers are only examples. Send us your 5 biggest monthly bills and we will show you what you can really save. We find the suppliers and partners and set it all up.'],
          button: 'Get my savings plan', onClick: plan('Cost-saving plan') }]);
      el.innerHTML = '<div data-deck></div>';
      deck(el.querySelector('[data-deck]'), slides, 'Ways to save');
    } catch (e) { el.innerHTML = `<p class="error-box">${esc(e.message)}</p>`; }
  }

  // The type's 30-second video and creatives (shown only when the team has made some for this type)
  async function renderMedia(el) {
    if (!el) return;
    try {
      const { media } = await load();
      const v = media?.video, imgs = media?.images || [];
      if (!v && !imgs.length) { el.hidden = true; return; }
      el.hidden = false;
      el.innerHTML = `<div class="section-title"><h2>See it in action</h2></div>
        <div class="media-row">
          ${v ? `<div class="media-video"><iframe src="${esc(v.url)}" title="${esc(v.title)}" allow="autoplay" loading="lazy" allowfullscreen></iframe></div>` : ''}
          ${imgs.length ? `<div class="media-slides">${imgs.map(i => `<a href="https://drive.google.com/file/d/${esc(i.id)}/view" target="_blank" rel="noopener" title="${esc(i.title)}">
            <img src="${esc(i.thumb)}" alt="${esc(i.title)}" loading="lazy" onerror="this.parentNode.remove()"></a>`).join('')}</div>` : ''}
        </div>`;
    } catch { el.hidden = true; }
  }

  // Professionals: steady work from RentMySite, then a line of credit from a bank on that basis
  function renderFinance(el, ctx) {
    if (!el) return;
    const start = Math.max(20000, Math.round(((ctx.sector.f || [])[1] || 60000) / 4 / 1000) * 1000);
    el.innerHTML = `<p class="meta" style="margin:0 0 1rem">When we bring you steady work, we can commit to it for six months. That steady income is what banks look for before giving you a line of credit, so you can buy equipment, a vehicle or stock.</p>
      <div class="fin-grid">
        <div class="panel">
          <label for="finMonthly">Monthly income from RentMySite work (₹)</label>
          <input id="finMonthly" type="number" min="0" step="1000" value="${start}">
          <label for="finMonths" style="margin-top:.8rem;display:block">Months we commit to</label>
          <select id="finMonths"><option>3</option><option selected>6</option><option>12</option></select>
          <div class="fin-out" id="finOut"></div>
        </div>
        <div class="panel">
          <h3 style="margin-top:0">How it works</h3>
          <ol class="fin-steps">
            <li>We bring you orders and commit to a steady monthly amount.</li>
            <li>We give you a work-commitment letter for the bank.</li>
            <li>You share your PAN, Aadhaar and six months of bank statements.</li>
            <li>The bank decides your line of credit. We help you apply.</li>
          </ol>
          <button class="btn" type="button" data-fin>Plan my finances</button>
        </div>
      </div>
      <p class="meta" style="margin-top:.8rem">Illustrative only. The bank decides any credit; we don’t lend money or promise approval.</p>`;
    const calc = () => {
      const m = Number(el.querySelector('#finMonthly').value) || 0, n = Number(el.querySelector('#finMonths').value) || 6;
      el.querySelector('#finOut').innerHTML = `<div><span>Committed income over ${n} months</span><b>${money(m * n)}</b></div>`;
    };
    el.addEventListener('input', calc); calc();
    el.querySelector('[data-fin]').addEventListener('click', () => Growth.openCtaDialog(ctx, { action: 'financial_plan', topic: `Financial planning: ${money(el.querySelector('#finMonthly').value)} a month` }));
  }

  function mount(ctx, user) {
    renderMyCta(document.getElementById('myCta'));
    renderWays(document.getElementById('waysBox'), ctx);
    renderSavings(document.getElementById('savingsBox'), ctx);
    renderMedia(document.getElementById('mediaBox'));
    if (ctx.isPro) renderFinance(document.getElementById('financeBox'), ctx);
  }

  window.CtaDash = { mount };
})();
