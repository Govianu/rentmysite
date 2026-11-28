/* KYC in the Profile: Aadhaar, PAN and bank account, each with a document. Needed before any booking.
   Shown masked; the full Aadhaar number is never stored (only its last 4 digits). Data: /api/kyc */
(function () {
  const box = document.getElementById('kycBox');
  if (!box) return;

  async function upload(kind, file) {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`/api/kyc/docs/${kind}`, { method: 'POST', body: form, credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    return data.kyc;
  }

  function render(k) {
    const doc = (kind) => {
      const d = k.docs[kind];
      return `<div class="kyc-doc">
        <span>${esc(k.docLabels[kind])}</span>
        ${d ? `<a href="/api/kyc/docs/${kind}" target="_blank" rel="noopener">Uploaded ✓ View</a>` : '<span class="meta">Not uploaded</span>'}
        <label class="btn ghost small">${d ? 'Replace' : 'Upload'}<input type="file" accept="image/jpeg,image/png,application/pdf" data-doc="${kind}" hidden></label>
      </div>`;
    };
    box.innerHTML = `
      <h3>KYC ${k.verifiedAt ? '<span class="pill ok">Verified</span>' : k.idVerifiedAt ? '<span class="pill ok">Aadhaar &amp; PAN verified</span>' : k.idComplete ? '<span class="pill">Aadhaar &amp; PAN done, being checked</span>' : '<span class="pill warn">Aadhaar &amp; PAN needed</span>'}</h3>
      <p class="meta">Aadhaar, PAN and bank details are needed before you can make, accept or apply for any booking, so we can pay you safely.
        We keep only the last 4 digits of your Aadhaar. Your documents are private: only you and the RentMySite team can see them.</p>
      ${k.idComplete ? '' : `<p class="error-box" style="display:block">Needed now: ${esc(k.idMissing.join(', '))}.</p>`}
      <p class="meta"><strong>Now:</strong> Aadhaar and PAN with a photo of each card. <strong>Later:</strong> bank details, only when you get your first customer.</p>
      <form id="kycForm" class="kyc-form">
        <div class="error-box" role="alert"></div>
        <div class="row">
          <div class="field"><label for="kAadhaar">Aadhaar number ${k.aadhaar ? `<span class="hint">saved: ${esc(k.aadhaar)}</span>` : ''}</label>
            <input id="kAadhaar" name="aadhaar" inputmode="numeric" autocomplete="off" maxlength="14" placeholder="${k.aadhaar ? 'Leave blank to keep' : '12 digits'}"></div>
          <div class="field"><label for="kPan">PAN ${k.pan ? `<span class="hint">saved: ${esc(k.pan)}</span>` : ''}</label>
            <input id="kPan" name="pan" autocomplete="off" maxlength="10" style="text-transform:uppercase" placeholder="${k.pan ? 'Leave blank to keep' : 'ABCDE1234F'}"></div>
        </div>
        <div class="row">
        </div>
        <h4 style="margin:1rem 0 .2rem">Bank details <span class="hint">only needed when you get your first customer – you can leave these empty for now</span></h4>
        <div class="row">
          <div class="field"><label for="kName">Account holder name</label><input id="kName" name="accountName" maxlength="120" value="${esc(k.accountName)}"></div>
          <div class="field"><label for="kBank">Bank name</label><input id="kBank" name="bankName" maxlength="80" value="${esc(k.bankName)}"></div>
        </div>
        <div class="row">
          <div class="field"><label for="kAcc">Account number ${k.accountNumber ? `<span class="hint">saved: ${esc(k.accountNumber)}</span>` : ''}</label>
            <input id="kAcc" name="accountNumber" inputmode="numeric" autocomplete="off" maxlength="18" placeholder="${k.accountNumber ? 'Leave blank to keep' : ''}"></div>
          <div class="field"><label for="kIfsc">IFSC</label><input id="kIfsc" name="ifsc" maxlength="11" style="text-transform:uppercase" value="${esc(k.ifsc)}" placeholder="HDFC0001234"></div>
        </div>
        <button class="btn" type="submit">Save KYC details</button>
      </form>
      <h4 style="margin:1.2rem 0 .4rem">Documents <span class="hint">JPG, PNG or PDF, up to 8 MB. Please hide the first 8 digits of your Aadhaar.</span></h4>
      <div class="kyc-docs">${['aadhaar', 'pan'].map(doc).join('')}</div>
      <p class="meta" style="margin:.6rem 0 .2rem">Later, with your bank details:</p><div class="kyc-docs">${doc('bank')}</div>
      <div class="kyc-send">
        ${k.submittedAt
          ? `<p><span class="pill approved">Sent to RentMySite</span> <span class="meta">on ${fmtDate(k.submittedAt)}. The RentMySite team will check it. If you change anything, send it again.</span></p>`
          : `<p class="meta">${k.idComplete ? 'Aadhaar and PAN are filled in. Send it to the RentMySite team to check.' : 'Fill in Aadhaar and PAN and upload both cards, then send it to RentMySite.'}</p>`}
        <button class="btn" type="button" data-kyc-send ${k.idComplete && !k.submittedAt ? '' : 'disabled'}>${k.submittedAt ? 'Sent' : 'All filled, send to RentMySite'}</button>
      </div>`;

    onSubmit(box.querySelector('#kycForm'), async data => {
      const body = Object.fromEntries(Object.entries(data).filter(([, v]) => String(v).trim()));
      const r = await api('/kyc/details', { method: 'POST', body });
      render(r.kyc); toast('KYC details saved');
    });
    box.querySelector('[data-kyc-send]').addEventListener('click', async e => {
      e.target.disabled = true;
      try { render((await api('/kyc/submit', { method: 'POST' })).kyc); toast('Sent to RentMySite. We will check it and let you know.'); }
      catch (ex) { toast(ex.message, true); e.target.disabled = false; }
    });
    box.querySelectorAll('[data-doc]').forEach(input => input.addEventListener('change', async () => {
      if (!input.files[0]) return;
      try { render(await upload(input.dataset.doc, input.files[0])); toast('Document uploaded'); }
      catch (e) { toast(e.message, true); }
    }));
  }

  api('/kyc').then(r => render(r.kyc)).catch(e => { box.innerHTML = `<p class="error-box">${esc(e.message)}</p>`; });
})();
