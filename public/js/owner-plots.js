// Owner dashboard → "Upload my plot": 1) upload the plot (details, photos, documents)  2) complete KYC  3) team approval.
// The plot is linked to this owner's account; the RentMySite team approves the plot and the KYC together.
(function () {
  const box = document.getElementById('plotsBox');
  if (!box) return;
  let format = null;
  let me = null;
  const STATUS = { pending_review: ['Waiting for approval', 'pending'], live: ['Approved & published', 'ok'], rejected: ['Needs changes', 'warn'] };
  const opts = (list) => list.map((x) => (Array.isArray(x) ? `<option value="${esc(x[0])}">${esc(x[1])}</option>` : `<option>${esc(x)}</option>`)).join('');

  function stepsHtml(plots, k) {
    const uploaded = plots.length > 0;
    const live = plots.some((p) => p.status === 'live');
    const step = (n, done, title, text, action) => `<li class="op-step ${done ? 'done' : ''}"><span class="op-n">${done ? '✓' : n}</span><div><strong>${title}</strong><p class="meta">${text}</p>${action || ''}</div></li>`;
    return `<ol class="op-steps">
      ${step(1, uploaded, 'Upload your plot', uploaded ? `${plots.length} plot${plots.length === 1 ? '' : 's'} uploaded.` : 'Details, photos and documents – about 5 minutes.', uploaded ? '<button class="btn ghost small" type="button" data-new>+ Upload another plot</button>' : '')}
      ${step(2, k.complete, 'Complete your KYC', k.complete ? (k.verifiedAt ? 'Verified by our team.' : 'Complete – our team is checking it.') : `Still needed: ${esc(k.missing.join(', '))}. Aadhaar, PAN and bank details, so we can pay you safely.`, k.complete ? '' : '<a class="btn small" href="#profile">Fill in KYC</a>')}
      ${step(3, live && k.verifiedAt, 'Team approval', live ? 'Your plot is live for businesses and brands looking for space. Our team takes it forward with you.' : 'Our team checks your plot and KYC together, usually within one working day.')}
    </ol>`;
  }

  function plotCard(p) {
    const [label, cls] = STATUS[p.status] || [p.status, ''];
    return `<div class="op-plot">
      ${p.photos[0] ? `<img src="${esc(p.photos[0])}" alt="">` : '<span class="op-ph" aria-hidden="true">🏞️</span>'}
      <div><strong>${esc(p.title)}</strong><p class="meta">${esc(p.plotId)} · ${esc(p.sizeText)} · ${esc(p.locality)}</p>
        <span class="pill ${cls}">${esc(label)}</span>${p.reviewNote ? `<p class="meta">Our team: ${esc(p.reviewNote)}</p>` : ''}</div></div>`;
  }

  function formHtml() {
    const f = format;
    return `<form id="opForm" novalidate>
      <section class="lp-section"><h3>1. About the plot</h3><div class="lp-grid">
        <div class="field"><label for="opType">Type of plot or space *</label><select id="opType" name="type"><option value="">Choose…</option>${opts(f.types)}</select></div>
        <div class="field"><label for="opSize">Size *</label><div class="lp-size"><input id="opSize" name="sizeValue" inputmode="decimal" placeholder="e.g. 10000"><select name="sizeUnit" aria-label="Unit">${opts(Object.entries(f.units))}</select></div></div>
        <div class="field"><label>Zoning / land use</label><select name="zoning">${opts(f.zoning)}</select></div>
        <div class="field"><label>Used for now</label><input name="currentUse" maxlength="200" placeholder="Vacant, parking, farming, old shed…"></div>
        <div class="field"><label>Available from</label><input name="availableFrom" maxlength="40" placeholder="Immediately / Jan 2027"></div>
        <div class="field"><label>Short title <span class="hint">(optional)</span></label><input name="title" maxlength="120" placeholder="Corner plot on Airport Road"></div>
      </div></section>
      <section class="lp-section"><h3>2. Location</h3><p class="meta">Space seekers only see the area. The exact address and map pin stay with our team.</p><div class="lp-grid">
        <div class="field"><label for="opLoc">Area / locality *</label><input id="opLoc" name="locality" maxlength="120" placeholder="KIADB Aerospace Park, Devanahalli"></div>
        <div class="field"><label>City</label><input name="city" value="Bengaluru" maxlength="60"></div></div>
        <div class="field"><label for="opAddr">Full address</label><textarea id="opAddr" name="address" maxlength="400" rows="2" placeholder="Plot no., street, landmark, PIN"></textarea></div>
        <div class="lp-grid"><div class="field"><label for="opMap">Google Maps link</label><input id="opMap" name="mapUrl" type="url" placeholder="https://maps.app.goo.gl/…"><span class="hint">Address or map link: at least one is needed.</span></div>
        <div class="field"><label>Survey / khata number <span class="hint">(optional)</span></label><input name="surveyNo" maxlength="80"></div></div></section>
      <section class="lp-section"><h3>3. Road &amp; access</h3><div class="lp-grid">
        <div class="field"><label>Road type</label><select name="road">${opts(Object.entries(f.roads))}</select></div>
        <div class="field"><label>Road width (ft)</label><input name="roadWidthFt" inputmode="numeric" placeholder="40"></div>
        <div class="field"><label>Frontage on the road (ft)</label><input name="frontageFt" inputmode="numeric" placeholder="100"></div></div>
        <label style="margin-top:.6rem">Facilities on the plot</label>
        <div class="lp-checks">${f.amenities.map((a) => `<label><input type="checkbox" name="amenities" value="${esc(a)}"> ${esc(a)}</label>`).join('')}</div></section>
      <section class="lp-section"><h3>4. What you are looking for</h3><div class="lp-grid">
        <div class="field"><label>I prefer</label><select name="preference">${opts(Object.entries(f.preferences))}</select></div>
        <div class="field"><label>Expected per month in ₹ <span class="hint">(optional)</span></label><input name="expectedRent" inputmode="numeric" placeholder="50000"></div></div>
        <div class="field"><label>Anything else about the plot</label><textarea name="description" maxlength="2000" rows="3" placeholder="Nearby landmarks, power connection, gate, previous use…"></textarea></div></section>
      <section class="lp-section"><h3>5. Photos *</h3><p class="meta">At least 1, up to 12 (JPG or PNG, 10 MB each). Front view, the road, the full plot and any structures.</p>
        <input id="opPhotos" type="file" accept="image/jpeg,image/png,image/webp" multiple><div class="lp-thumbs" id="opThumbs"></div></section>
      <section class="lp-section"><h3>6. Property documents</h3><p class="meta">Title deed, EC, khata… Seen only by the RentMySite team, never published. PDF or photo, 25 MB each.</p>
        <div id="opDocs"></div><button class="btn ghost small" type="button" id="opAddDoc">+ Add a document</button></section>
      <section class="lp-section">
        <div class="field"><label for="opPhone">Your mobile / WhatsApp number</label><input id="opPhone" name="ownerPhone" type="tel" value="${esc(me.phone || '')}"></div>
        <label class="check"><input type="checkbox" name="consent" value="yes"><span>I own this plot or am authorised to list it, and the details are correct.</span></label>
        <p class="error-box" role="alert" id="opErr"></p>
        <button class="btn" type="submit" id="opSend">Upload plot</button>
      </section>
    </form>`;
  }

  function wireForm() {
    const $ = (id) => document.getElementById(id);
    const form = $('opForm');
    form.zoning.value = 'Not sure';
    form.road.value = 'inner';
    form.preference.value = 'open';
    const docRow = () => {
      if ($('opDocs').children.length >= 8) return;
      $('opDocs').insertAdjacentHTML('beforeend', `<div class="lp-doc"><select class="dk" aria-label="Document type">${opts(Object.entries(format.docKinds))}</select>
        <input class="df" type="file" accept="application/pdf,image/jpeg,image/png" aria-label="Document file"><button type="button" class="link-btn" data-rm>Remove</button></div>`);
    };
    docRow();
    $('opAddDoc').onclick = docRow;
    $('opDocs').onclick = (e) => { if (e.target.closest('[data-rm]')) e.target.closest('.lp-doc').remove(); };
    $('opPhotos').onchange = () => { $('opThumbs').innerHTML = [...$('opPhotos').files].slice(0, 12).map((file) => `<img alt="" src="${URL.createObjectURL(file)}">`).join(''); };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const err = $('opErr');
      err.textContent = '';
      if (!form.type.value) return (err.textContent = 'Choose the type of plot');
      if (!form.sizeValue.value.trim()) return (err.textContent = 'Enter the size');
      if (!form.locality.value.trim()) return (err.textContent = 'Enter the area / locality');
      if (!form.address.value.trim() && !form.mapUrl.value.trim()) return (err.textContent = 'Enter the full address or a Google Maps link');
      if (!$('opPhotos').files.length) return (err.textContent = 'Add at least one photo');
      if (!form.consent.checked) return (err.textContent = 'Tick the box to confirm you can list this plot');
      const fd = new FormData();
      for (const [k, v] of new FormData(form).entries()) if (k !== 'amenities' && typeof v === 'string') fd.append(k, v);
      fd.set('amenities', [...form.querySelectorAll('[name="amenities"]:checked')].map((c) => c.value).join(','));
      [...$('opPhotos').files].slice(0, 12).forEach((file) => fd.append('photos', file));
      const kinds = [];
      $('opDocs').querySelectorAll('.lp-doc').forEach((row) => { const file = row.querySelector('.df').files[0]; if (file) { fd.append('documents', file); kinds.push(row.querySelector('.dk').value); } });
      fd.set('docKinds', kinds.join(','));
      const btn = $('opSend');
      btn.disabled = true;
      btn.textContent = 'Uploading… please wait';
      try {
        const r = await api('/plots', { method: 'POST', body: fd });
        toast(`Plot uploaded (${r.plotId}). Next: complete your KYC.`);
        load(false);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (ex) {
        err.textContent = ex.message;
        btn.disabled = false;
        btn.textContent = 'Upload plot';
      }
    };
  }

  async function load(showForm) {
    try {
      [format, { user: me }] = await Promise.all([format || api('/plots/format'), me ? { user: me } : api('/auth/me')]);
      const { plots, kyc } = await api('/plots/mine');
      const openForm = showForm ?? !plots.length;
      box.innerHTML = stepsHtml(plots, kyc)
        + (plots.length ? `<h3>My plots</h3><div class="op-plots">${plots.map(plotCard).join('')}</div>` : '')
        + (openForm ? `<h3 id="opFormHead">${plots.length ? 'Upload another plot' : 'Upload your plot'}</h3>${formHtml()}` : '');
      if (openForm) wireForm();
      box.querySelector('[data-new]')?.addEventListener('click', () => load(true).then(() => document.getElementById('opFormHead')?.scrollIntoView({ behavior: 'smooth' })));
    } catch (e) {
      box.innerHTML = `<p class="error-box" style="display:block">${esc(e.message)}</p>`;
    }
  }
  load();
  window.addEventListener('hashchange', () => { if (location.hash === '#plots') load(); });
})();
