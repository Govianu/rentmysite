// Plots & land for space seekers: every plot the RentMySite team has approved, from every owner.
// Used on /find and in the buyer dashboard. Owner details are never shown: enquiries go to the team.
(function () {
  const dialog = (id) => {
    let d = document.getElementById(id);
    if (!d) { d = document.createElement('dialog'); d.id = id; d.className = 'gdialog pl-dialog'; document.body.appendChild(d); }
    return d;
  };
  const inr = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');

  function card(p) {
    const facts = [p.sizeText, p.roadText + (p.roadWidthFt ? `, ${p.roadWidthFt} ft road` : ''), p.zoning && p.zoning !== 'Not sure' ? p.zoning : ''].filter(Boolean);
    return `<article class="pl-card">
      <button type="button" class="pl-photo" data-plot="${esc(p.id)}" aria-label="View ${esc(p.title)}">
        ${p.photos[0] ? `<img src="${esc(p.photos[0])}" alt="" loading="lazy">` : '<span aria-hidden="true">🏞️</span>'}
        ${p.photos.length > 1 ? `<span class="pl-count">📷 ${p.photos.length}</span>` : ''}
      </button>
      <div class="pl-body">
        <span class="pl-type">${esc(p.type)}</span>
        <h3>${esc(p.title)}</h3>
        <p class="pl-where">📍 ${esc([p.locality, p.city].filter(Boolean).join(', '))}</p>
        <ul class="pl-facts">${facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
        <div class="pl-foot"><span class="meta">${esc(p.plotId)}</span><button class="btn small" type="button" data-plot="${esc(p.id)}">View details</button></div>
      </div>
    </article>`;
  }

  function renderBrowse(el, { user = null } = {}) {
    const W0 = { noun: 'plot', nouns: 'plots', browseTitle: 'Plots & land available', formPath: '/list-plot', team: 'RentMySite' };
    el.innerHTML = `<section class="pl-wrap" id="plots">
      <div class="pl-head"><div><h2 data-w="title">${esc(W0.browseTitle)}</h2><p class="meta" data-w="sub">Approved by our team. Tell us what you need and we coordinate with the owner.</p></div>
        <a class="btn ghost small" data-w="cta" href="${W0.formPath}">List yours free</a></div>
      <div class="pl-filters">
        <label><span class="sr-only">Search</span><input data-f="q" placeholder="Search by use, type or facility…"></label>
        <label><span class="sr-only">Area</span><input data-f="area" placeholder="Area, e.g. Yelahanka"></label>
        <label><span class="sr-only">Type</span><select data-f="type"><option value="">All types</option></select></label>
        <label><span class="sr-only">Minimum size</span><select data-f="minSqft"><option value="">Any size</option><option value="1000">1,000+ sq ft</option><option value="5000">5,000+ sq ft</option><option value="10000">10,000+ sq ft</option><option value="43560">1 acre+</option></select></label>
      </div>
      <p class="meta pl-n"></p>
      <div class="pl-grid"><p class="meta">Loading…</p></div>
    </section>`;
    let plots = [];
    let timer;
    const load = async () => {
      const qs = new URLSearchParams();
      el.querySelectorAll('[data-f]').forEach((i) => i.value && qs.set(i.dataset.f, i.value.trim()));
      const r = await api('/plots?' + qs);
      const sel = el.querySelector('[data-f="type"]');
      if (sel.options.length === 1) sel.insertAdjacentHTML('beforeend', r.types.map((t) => `<option>${esc(t)}</option>`).join(''));
      plots = r.plots;
      const w = r.words || W0;
      el.querySelector('[data-w="title"]').textContent = w.browseTitle;
      el.querySelector('[data-w="cta"]').setAttribute('href', w.formPath);
      el.querySelector('[data-w="cta"]').textContent = `Have a ${w.noun}? List it free`;
      renderBrowse.w = w;
      el.querySelector('.pl-n').textContent = `${plots.length} ${plots.length === 1 ? w.noun : w.nouns}`;
      el.querySelector('.pl-grid').innerHTML = plots.length ? plots.map(card).join('')
        : `<p class="pl-empty"><strong>Nothing matches yet.</strong> New ${w.nouns} are added every week. Change the filters, or use “Find it for me”.</p>`;
    };
    el.addEventListener('input', (e) => { if (e.target.dataset.f) { clearTimeout(timer); timer = setTimeout(() => load().catch(() => {}), 300); } });
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-plot]');
      if (b) openPlot(plots.find((p) => p.id === b.dataset.plot), user);
    });
    load().catch((e) => { el.querySelector('.pl-grid').innerHTML = `<p class="error-box">${esc(e.message)}</p>`; });
    return { reload: load };
  }

  function openPlot(p, user) {
    if (!p) return;
    const d = dialog('plDetail');
    const rows = [
      ['Plot ID', p.plotId], ['Type', p.type], ['Size', p.sizeText], ['Area', [p.locality, p.city].filter(Boolean).join(', ')],
      ['Road', p.roadText + (p.roadWidthFt ? `, ${p.roadWidthFt} ft wide` : '')], ['Frontage', p.frontageFt ? `${p.frontageFt} ft` : ''],
      ['Zoning', p.zoning], ['Current use', p.currentUse], ['Available from', p.availableFrom], ['Owner prefers', p.preferenceText],
      ['Expected per month', p.expectedRent ? inr(p.expectedRent) : ''],
    ].filter((r) => r[1]);
    d.innerHTML = `<div class="gdialog-body">
      <div class="pl-gallery">${p.photos.map((src) => `<a href="${esc(src)}" target="_blank" rel="noopener"><img src="${esc(src)}" alt="Photo of ${esc(p.title)}" loading="lazy"></a>`).join('') || '<span class="meta">No photos</span>'}</div>
      ${(p.videos || []).map((src) => `<video src="${esc(src)}" controls preload="metadata" style="width:100%;max-height:320px;border-radius:12px;margin-bottom:.6rem;background:#000"></video>`).join('')}
      <h2>${esc(p.title)}</h2>
      <table class="pl-table">${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>
      ${p.amenities.length ? `<p class="pl-tags">${p.amenities.map((a) => `<span>${esc(a)}</span>`).join('')}</p>` : ''}
      ${p.description ? `<p>${esc(p.description)}</p>` : ''}
      <form class="pl-enq" novalidate>
        <h3>Interested in this ${(renderBrowse.w || { noun: 'plot' }).noun}?</h3>
        <p class="mk-note">Send your details: the ${esc((renderBrowse.w || { team: "RentMySite" }).team)} team calls you, arranges a site visit and coordinates with the owner. Your details are not shared with the owner.</p>
        ${user ? '' : `<div class="row"><div class="field"><label>Your name</label><input name="name" autocomplete="name" required></div>
          <div class="field"><label>Mobile number</label><input name="phone" type="tel" autocomplete="tel" required></div></div>
          <div class="field"><label>Email <span class="hint">(optional)</span></label><input name="email" type="email" autocomplete="email"></div>`}
        ${user && !user.phone ? '<div class="field"><label>Mobile number</label><input name="phone" type="tel" required></div>' : ''}
        <div class="field"><label>What do you want to use it for?</label><input name="purpose" maxlength="200" placeholder="EV charging, warehouse, food court, parking…"></div>
        <div class="field"><label>Anything else <span class="hint">(optional)</span></label><textarea name="message" maxlength="1000"></textarea></div>
        <p class="error-box" role="alert"></p>
        <div class="gdialog-actions"><button type="button" class="btn ghost" data-close>Close</button><button type="submit" class="btn">I’m interested</button></div>
      </form>
    </div>`;
    d.onclick = (e) => { if (e.target.closest('[data-close]') || e.target === d) d.close(); };
    d.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      const err = f.querySelector('.error-box');
      err.textContent = '';
      const btn = f.querySelector('[type="submit"]');
      btn.disabled = true;
      try {
        await api(`/plots/${p.id}/enquire`, { method: 'POST', body: Object.fromEntries(new FormData(f).entries()) });
        f.innerHTML = `<h3>Thank you!</h3><p>Our team will call you shortly about <strong>${esc(p.title)}</strong> (${esc(p.plotId)}) and arrange a site visit.</p>
          <div class="gdialog-actions"><button type="button" class="btn" data-close>Done</button></div>`;
      } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
    };
    d.showModal();
  }

  window.Plots = { renderBrowse, openPlot };
})();
