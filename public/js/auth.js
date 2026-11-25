(async function () {
  const params = new URLSearchParams(location.search);
  // Older emails say business.html#cta; pages now live at /business (no .html, so the server never caches them)
  const next = (params.get('next') || '').replace(/^(business|associate|admin|buyer)\.html/, '$1');
  const emailParam = params.get('email') || '';
  const profileIdParam = params.get('profileId') || '';
  const switchMode = params.get('switch') === '1';
  // Links for the RentMySite team dashboard go to the team's own sign-in page
  if (/^admin(#|$)/.test(next)) { location.replace(`/team?next=${encodeURIComponent(next.split('#')[1] || '')}`); return; }
  const goTo = redirect => {
    const safe = /^(business|associate|admin|buyer)(#[a-z-]+)?$/.test(next) && redirect.startsWith('/' + next.split('#')[0]);
    location.href = safe ? '/' + next : redirect;
  };

  // Keep the requested sign-in flow when an email link names a different account.
  let wrongAccount = null;   // signed in, but the link is for another kind of dashboard (e.g. the RentMySite team's)
  let signedIn = null;
  try {
    const { user } = await api('/auth/me');
    signedIn = user;
    const expectedRole = /^(business|associate|admin|buyer)(#|$)/.exec(next)?.[1];
    const sameEmail = user.email?.toLowerCase() === emailParam.toLowerCase();
    const sameRequestedProfile = sameEmail
      && (!profileIdParam || String(user._id) === profileIdParam)
      && (!expectedRole || user.role === expectedRole);
    // An email can hold several dashboards: a link for another one of yours switches straight to it
    if (sameEmail && profileIdParam && String(user._id) !== profileIdParam) {
      try {
        const { redirect } = await api('/auth/switch-profile', { method: 'POST', body: { profileId: profileIdParam } });
        goTo(redirect);
        return;
      } catch { /* not one of this email's dashboards: fall through to signing in */ }
    }
    if (!emailParam && !switchMode && expectedRole && user.role !== expectedRole) wrongAccount = { user, expectedRole };
    else if ((!emailParam && !switchMode) || (emailParam && sameRequestedProfile)) {
      goTo(`/${user.role}`);
      return;
    }
  } catch { /* not logged in */ }
  // Which dashboard a requested code is for (when the email has more than one)
  let codeFor = profileIdParam;

  const form = document.getElementById('signupForm');
  const roleInput = form.querySelector('input[name="role"]');
  const tabs = document.querySelectorAll('.tabs button');
  const loginForm = document.getElementById('loginForm');
  const otpForm = document.getElementById('otpForm');
  const otpMessage = document.getElementById('otpMsg');

  function showOtpForm(email, devOtp, message) {
    document.getElementById('loginPane').hidden = false;
    document.getElementById('signupPane').hidden = true;
    loginForm.hidden = true;
    otpForm.hidden = false;
    otpForm.elements.email.value = email;
    document.getElementById('otpEmail').textContent = email;
    document.getElementById('otpCode').value = '';
    otpMessage.textContent = message || 'Check your inbox and spam folder. The code expires in 10 minutes.';
    if (devOtp) otpMessage.textContent += ` Local test code: ${devOtp}`;
    document.getElementById('otpCode').focus();
  }

  function resetOtpForm() {
    otpForm.hidden = true;
    loginForm.hidden = false;
    otpMessage.textContent = '';
    loginForm.elements.email.focus();
  }

  const { businessCategories, associateSkills, staffDomains = ['govianu.com'] } = await api('/auth/options').catch(() => ({
    businessCategories: ['restaurant'], associateSkills: ['chef'], staffDomains: ['govianu.com']
  }));
  // The RentMySite team sign-up is shown only to Govianu employees: it appears once a staff email is typed
  const isStaffEmail = email => staffDomains.includes(String(email || '').trim().toLowerCase().split('@')[1] || '');
  // A to Z, with "other" last
  const az = list => list.slice().sort((a, b) => (a === 'other') - (b === 'other') || pretty(a).localeCompare(pretty(b)));
  document.getElementById('category').innerHTML = az(businessCategories).map(c => `<option value="${c}">${pretty(c)}</option>`).join('');
  document.getElementById('skill').innerHTML = az(associateSkills).map(c => `<option value="${c}">${pretty(c)}</option>`).join('');

  const copy = {
    business: {
      title: "Don't sell your dormant space. Monetise it.",
      text: 'List your dormant space free: a vacant site, a terrace, godown, shed or spare seats. We plan it, build it and run it. You keep the title and earn every month.',
      sample: ['site', 'hosurroad', 'myspace'], catLabel: 'your dormant space'
    },
    associate: {
      title: 'Earn from your days off.',
      text: 'Run paid workshops in partner kitchens or pick up nearby shifts. Upload a 30-second intro and a RentMySite manager gets you live.',
      sample: ['chef', 'sadashivnagar', 'mahesh'], catLabel: 'your skill'
    },
    buyer: {
      title: 'Prime location. Without rent.',
      text: 'Kiosks, drive-through pads, courts, market slots, hubs and storage on operated sites. Pay a share of what you sell. Up to ten sites, one agreement.',
      sample: ['brand', 'bengaluru', 'you'], catLabel: 'you need space'
    },
    admin: {
      title: 'RentMySite operations team.',
      text: 'Import profiles, validate uploads and track every lead to a signed agreement.',
      sample: ['team', 'rms', 'you'], catLabel: 'team'
    }
  };

  // Toggle fields for the chosen role; disabled inputs are left out of the submit
  function setRole(role) {
    roleInput.value = role;
    tabs.forEach(t => t.setAttribute('aria-selected', String(t.dataset.role === role)));
    form.querySelectorAll('[data-for]').forEach(group => {
      const on = group.dataset.for === role;
      group.hidden = !on;
      group.querySelectorAll('input, select').forEach(i => (i.disabled = !on));
    });
    document.getElementById('storyTitle').textContent = copy[role].title;
    document.getElementById('storyText').textContent = copy[role].text;
    document.getElementById('segCatLabel').textContent = copy[role].catLabel;
    updateHandle();
  }

  const slug = (s, keepUnderscore) =>
    String(s || '').toLowerCase().normalize('NFKD').replace(keepUnderscore ? /[^a-z0-9_]+/g : /[^a-z0-9]+/g, '').slice(0, 40);

  function setSeg(id, value, fallback) {
    const seg = document.getElementById(id);
    seg.querySelector('b').textContent = value || fallback;
    seg.classList.toggle('filled', !!value);
    seg.classList.toggle('empty', !value);
  }

  function updateHandle() {
    const role = roleInput.value;
    const sample = copy[role].sample;
    const v = formData(form);
    if (role === 'admin' || role === 'buyer') {
      setSeg('segCat', '', sample[0]); setSeg('segLoc', '', sample[1]);
      setSeg('segName', slug((v.name || '').split(' ')[0]), sample[2]);
      return;
    }
    setSeg('segCat', slug(role === 'business' ? v.category : v.skill, true), sample[0]);
    setSeg('segLoc', slug(v.location), sample[1]);
    setSeg('segName', slug(role === 'business' ? v.businessName : (v.name || '').split(' ')[0]), sample[2]);
  }

  tabs.forEach(t => t.addEventListener('click', () => setRole(t.dataset.role)));
  // Govianu emails get a pointer to the RentMySite team sign-in (team.html)
  const staffSwitch = document.getElementById('adminSwitch');
  const syncStaff = () => {
    const staff = isStaffEmail(form.elements.email.value);
    staffSwitch.hidden = !staff;
    if (!staff && roleInput.value === 'admin') setRole('business');
  };
  form.elements.email.addEventListener('input', syncStaff);
  syncStaff();
  form.addEventListener('input', updateHandle);
  // The CTA link opens the CTA for what's chosen in the form
  const ctaLink = document.getElementById('ctaLink');
  const syncCta = () => {
    const v = formData(form);
    const q = new URLSearchParams({ category: roleInput.value === 'associate' ? v.skill || '' : v.category || '',
      name: roleInput.value === 'business' ? v.businessName || '' : '', area: v.location || '', person: v.name || '' });
    ctaLink.href = `/cta?${q}`;
  };
  form.addEventListener('input', syncCta); form.addEventListener('change', syncCta); syncCta();
  form.addEventListener('change', updateHandle);

  onSubmit(form, async data => {
    if (!form.querySelector('[name="termsAccepted"]').checked) throw new Error('Please agree to the Terms and Conditions to create your profile');
    const result = await api('/auth/signup', { method: 'POST', body: { ...data, termsAccepted: true } });
    codeFor = result.profileId || '';
    showOtpForm(result.email, result.devOtp, 'We sent a verification code. Check your inbox and spam folder.');
  });

  onSubmit(loginForm, async data => {
    // A link for one dashboard keeps asking for that dashboard's code; a typed-in other email doesn't
    if (codeFor && String(data.email || '').trim().toLowerCase() !== emailParam.toLowerCase()) codeFor = '';
    const result = await api('/auth/request-otp', { method: 'POST', body: { ...data, profileId: codeFor || undefined } });
    showOtpForm(data.email, result.devOtp, result.message || 'Check your inbox and spam folder.');
  });

  onSubmit(otpForm, async data => {
    const { redirect } = await api('/auth/verify-otp', { method: 'POST', body: data });
    goTo(redirect);
  });

  document.getElementById('resendOtp').addEventListener('click', async () => {
    otpMessage.textContent = '';
    try {
      const email = otpForm.elements.email.value;
      const result = await api('/auth/request-otp', { method: 'POST', body: { email, profileId: codeFor || undefined } });
      otpMessage.textContent = result.message || 'If that email has a dashboard, a new code is on its way.';
      if (result.devOtp) otpMessage.textContent += ` Local test code: ${result.devOtp}`;
    } catch (err) {
      otpMessage.textContent = err.message;
    }
  });
  document.getElementById('changeEmail').addEventListener('click', resetOtpForm);

  document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => {
    resetOtpForm();
    const login = button.dataset.go === 'login';
    document.getElementById('loginPane').hidden = !login;
    document.getElementById('signupPane').hidden = login;
    (login ? document.getElementById('loginEmail') : document.getElementById('name')).focus();
  }));

  const asRole = new URLSearchParams(location.search).get('as');
  setRole(['associate', 'buyer'].includes(asRole) ? asRole : 'business');
  if (emailParam) document.getElementById('loginEmail').value = emailParam;
  // From a welcome email that already holds the code: go straight to the code box
  if (emailParam && params.get('step') === 'code') {
    showOtpForm(emailParam, null, 'Enter the 6-digit code from your email. It expires 10 minutes after it was sent; if it has, press “Send a new code”.');
  }
  // Switch dashboard: every dashboard on this email, one click each
  if (switchMode && signedIn) {
    try {
      const { profiles, current } = await api('/auth/profiles');
      const box = document.createElement('div');
      box.className = 'panel';
      box.style.marginBottom = '1rem';
      box.innerHTML = `<h3 style="margin:0 0 .3rem">Your dashboards</h3>
        <p class="meta" style="margin:0 0 .8rem">Signed in as ${esc(signedIn.email)}. Choose which one to open.</p>
        <div style="display:grid;gap:.5rem">${profiles.map(pf => `<button type="button" class="btn ${String(pf.id) === String(current) ? '' : 'ghost'} wide" data-profile="${esc(pf.id)}" style="justify-content:space-between">
          <span>${esc(pf.label)}</span>${String(pf.id) === String(current) ? '<small>open now</small>' : ''}</button>`).join('')}</div>
        <p class="meta" style="margin:.8rem 0 0">Another business on the same email? <button class="link-btn" type="button" data-go-add>Add it</button>. To use a different email, sign in below.</p>`;
      const pane = document.getElementById('loginPane');
      pane.insertBefore(box, pane.querySelector('#loginForm'));
      box.addEventListener('click', async e => {
        const pick = e.target.closest('[data-profile]');
        if (pick) {
          pick.disabled = true;
          try { const { redirect } = await api('/auth/switch-profile', { method: 'POST', body: { profileId: pick.dataset.profile } }); location.href = redirect; }
          catch (err) { toast(err.message, true); pick.disabled = false; }
        }
        if (e.target.closest('[data-go-add]')) {
          document.getElementById('loginPane').hidden = true;
          document.getElementById('signupPane').hidden = false;
          form.elements.email.value = signedIn.email; syncStaff();
          document.getElementById('name').value = signedIn.name || '';
          document.getElementById('businessName').focus();
        }
      });
    } catch { /* fall back to the normal sign-in form */ }
  }
  if (location.hash === '#login' || next) {
    document.getElementById('signupPane').hidden = true;
    document.getElementById('loginPane').hidden = false;
  }

  // Say why the link didn't open: it's for another dashboard than the one signed in
  if (wrongAccount) {
    const LABEL = { admin: 'RentMySite team', business: 'business', associate: 'professional', buyer: 'buyer' };
    const { user, expectedRole } = wrongAccount;
    const note = document.createElement('div');
    note.className = 'panel';
    note.setAttribute('role', 'status');
    note.style.marginBottom = '1rem';
    note.innerHTML = expectedRole === 'admin'
      ? `<p><strong>This link opens the RentMySite team dashboard.</strong> It is only for Govianu employees.</p>
         <p class="meta">You’re signed in as ${esc(user.email || user.name)} (${esc(LABEL[user.role] || user.role)} dashboard). Sign in below with your @${esc((staffDomains[0] || 'govianu.com'))} email to open it, or <a href="/${esc(user.role)}">go back to your own dashboard</a>.</p>`
      : `<p><strong>This link opens a ${esc(LABEL[expectedRole])} dashboard.</strong></p>
         <p class="meta">You’re signed in as ${esc(user.email || user.name)} (${esc(LABEL[user.role] || user.role)} dashboard). Sign in below with the account the link was meant for, or <a href="/${esc(user.role)}">go back to your own dashboard</a>.</p>`;
    const pane = document.getElementById('loginPane');
    pane.insertBefore(note, pane.querySelector('#loginForm'));
  }
})();
