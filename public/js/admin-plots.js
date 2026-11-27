// Team dashboard → Plot approvals: plots owners submitted from /list-plot. Check photos + documents, correct details,
// approve to publish (shown to space seekers on /find and the buyer dashboard), reject with a reason, or take down.
(function () {
  let status = 'pending_review';
  let data = null;
  const LABEL = { pending_review: 'To approve', live: 'Published', rejected: 'Rejected', removed: 'Taken down' };
  const box = () => document.getElementById('plotsAdmin');

  function item(p) {
    const row = (k, v) => (v ? `<div><b>${esc(k)}:</b> ${esc(v)}</div>` : '');
    const actions = {
      pending_review: '<button class="btn small" data-act="approve">✓ Approve &amp; publish</button><button class="btn ghost small" data-act="edit">Edit details</button><button class="btn warn small" data-act="reject">Reject</button>',
      live: '<button class="btn ghost small" data-act="edit">Edit details</button><button class="btn warn small" data-act="remove">Take down</button>',
      rejected: '<button class="btn small" data-act="approve">Approve &amp; publish</button><button class="btn ghost small" data-act="edit">Edit details</button>',
      removed: '<button class="btn small" data-act="approve">Publish again</button>',
    }[p.status];
    return `<article class="pa-item" data-id="${esc(p.id)}">
      <div class="pa-photos">${p.photos.map((src) => `<a href="${esc(src)}" target="_blank" rel="noopener"><img src="${esc(src)}" alt="" loading="lazy"></a>`).join('') || '<span class="meta">No photos</span>'}</div>
      <div>
        <div class="item-top"><h3>${esc(p.title)}</h3><span class="pill ${p.status === 'live' ? 'approved' : p.status === 'pending_review' ? 'pending' : 'rejected'}">${esc(LABEL[p.status])}</span></div>
        <p class="meta">${esc(p.plotId)} · submitted ${new Date(p.createdAt).toLocaleString('en-IN')}${p.enquiries ? ` · <strong>${p.enquiries} enquir${p.enquiries === 1 ? 'y' : 'ies'}</strong>` : ''}</p>
        <div class="pa-cols">
          ${row('Owner', `${p.ownerName} (${p.ownerRole})`)}${row('Phone', p.ownerPhone)}${row('Email', p.ownerEmail)}
          ${row('Type', p.type)}${row('Size', p.sizeText)}${row('Area', [p.locality, p.city].filter(Boolean).join(', '))}
          ${row('Address', p.address)}${row('Survey no.', p.surveyNo)}${row('Road', p.roadText + (p.roadWidthFt ? `, ${p.roadWidthFt} ft` : ''))}
          ${row('Frontage', p.frontageFt ? p.frontageFt + ' ft' : '')}${row('Zoning', p.zoning)}${row('Current use', p.currentUse)}
          ${row('Available', p.availableFrom)}${row('Prefers', p.preferenceText)}${row('Expected / month', p.expectedRent ? inr(p.expectedRent) : '')}
          ${row('Amenities', p.amenities.join(', '))}
        </div>
        ${p.description ? `<p class="item-body">${esc(p.description)}</p>` : ''}
        <div class="pa-docs">${p.mapUrl ? `<a class="btn ghost small" href="${esc(p.mapUrl)}" target="_blank" rel="noopener">📍 Map</a>` : ''}
          ${p.documents.map((d) => `<a class="btn ghost small" href="${esc(d.url)}" target="_blank" rel="noopener">📄 ${esc(d.kindText)}</a>`).join('') || '<span class="meta">No documents uploaded</span>'}
          <a class="btn ghost small" href="https://wa.me/${esc(p.ownerPhone.replace(/\D/g, ''))}" target="_blank" rel="noopener">WhatsApp owner</a></div>
        ${p.reviewNote ? `<p class="meta">Reason given: ${esc(p.reviewNote)}</p>` : ''}
        <div class="pa-actions">${actions}</div>
      </div>
    </article>`;
  }

  async function load() {
    data = await api('/plots/admin/list?status=' + status);
    if (typeof setCount === 'function') setCount('plots', data.counts.pending_review);
    const nav = document.querySelector('[data-view="plots"]');
    if (nav) nav.dataset.count = data.counts.pending_review || '';
    box().innerHTML = `<div class="view-tabs" role="group" aria-label="Status">${Object.entries(LABEL).map(([k, v]) =>
      `<button type="button" data-st="${k}" aria-pressed="${k === status}">${v} (${data.counts[k] || 0})</button>`).join('')}</div>
      ${data.plots.length ? data.plots.map(item).join('') : `<div class="list"><div class="empty"><strong>Nothing here</strong>${status === 'pending_review' ? 'New plots from owners (rentmysite.ai/list-plot) appear here for approval.' : ''}</div></div>`}`;
  }

  function editDialog(p) {
    let d = document.getElementById('plEdit');
    if (!d) { d = document.createElement('dialog'); d.id = 'plEdit'; d.className = 'gdialog'; document.body.appendChild(d); }
    const f = data.format;
    const sel = (name, entries, val) => `<select name="${name}">${entries.map(([k, v]) => `<option value="${esc(k)}" ${k === val ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>`;
    d.innerHTML = `<form class="gdialog-body" style="max-height:85vh;overflow:auto">
      <h2>Edit ${esc(p.plotId)}</h2>
      <div class="field"><label>Title</label><input name="title" value="${esc(p.title)}"></div>
      <div class="row"><div class="field"><label>Type</label>${sel('type', f.types.map((t) => [t, t]), p.type)}</div>
        <div class="field"><label>Size</label><div class="row"><input name="sizeValue" value="${esc(p.sizeValue)}">${sel('sizeUnit', Object.entries(f.units), p.sizeUnit)}</div></div></div>
      <div class="row"><div class="field"><label>Area / locality</label><input name="locality" value="${esc(p.locality)}"></div><div class="field"><label>City</label><input name="city" value="${esc(p.city)}"></div></div>
      <div class="field"><label>Full address (team only)</label><input name="address" value="${esc(p.address)}"></div>
      <div class="field"><label>Google Maps link (team only)</label><input name="mapUrl" value="${esc(p.mapUrl)}"></div>
      <div class="row"><div class="field"><label>Road</label>${sel('road', Object.entries(f.roads), p.road)}</div><div class="field"><label>Road width (ft)</label><input name="roadWidthFt" value="${esc(p.roadWidthFt || '')}"></div><div class="field"><label>Frontage (ft)</label><input name="frontageFt" value="${esc(p.frontageFt || '')}"></div></div>
      <div class="row"><div class="field"><label>Zoning</label>${sel('zoning', f.zoning.map((t) => [t, t]), p.zoning)}</div><div class="field"><label>Owner prefers</label>${sel('preference', Object.entries(f.preferences), p.preference)}</div></div>
      <div class="row"><div class="field"><label>Current use</label><input name="currentUse" value="${esc(p.currentUse)}"></div><div class="field"><label>Available from</label><input name="availableFrom" value="${esc(p.availableFrom)}"></div><div class="field"><label>Expected ₹/month</label><input name="expectedRent" value="${esc(p.expectedRent || '')}"></div></div>
      <div class="field"><label>Description (public)</label><textarea name="description" rows="4">${esc(p.description)}</textarea></div>
      <p class="error-box" role="alert"></p>
      <div class="gdialog-actions"><button type="button" class="btn ghost" data-close>Cancel</button><button type="submit" class="btn">Save</button></div>
    </form>`;
    d.querySelector('[data-close]').onclick = () => d.close();
    d.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api(`/plots/admin/${p.id}`, { method: 'PATCH', body: { fields: Object.fromEntries(new FormData(e.target).entries()) } });
        d.close();
        toast('Saved');
        load();
      } catch (ex) { d.querySelector('.error-box').textContent = ex.message; }
    };
    d.showModal();
  }

  document.addEventListener('click', async (e) => {
    if (!box() || !box().contains(e.target)) return;
    const st = e.target.closest('[data-st]');
    if (st) { status = st.dataset.st; return load().catch((x) => toast(x.message, true)); }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const p = data.plots.find((x) => x.id === b.closest('[data-id]').dataset.id);
    const act = b.dataset.act;
    if (act === 'edit') return editDialog(p);
    let note = '';
    if (act === 'reject') { note = prompt('Reason (sent to the owner if they gave an email):', 'Please share clearer photos and the ownership document'); if (note === null) return; }
    if (act === 'remove' && !confirm('Take this plot down? Space seekers will no longer see it.')) return;
    b.disabled = true;
    try {
      await api(`/plots/admin/${p.id}`, { method: 'PATCH', body: { action: act, note } });
      toast({ approve: 'Published – space seekers can see it now', reject: 'Rejected', remove: 'Taken down' }[act] || 'Done');
      load();
    } catch (ex) { toast(ex.message, true); b.disabled = false; }
  });

  window.loadPlots = load;
  // show how many plots wait for approval in the menu as soon as the dashboard opens
  api('/plots/admin/list?status=pending_review').then((r) => typeof setCount === 'function' && setCount('plots', r.counts.pending_review)).catch(() => {});
})();
