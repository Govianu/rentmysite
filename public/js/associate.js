(async function () {
  const user = await guard('associate');
  if (!user) return;
  fillWho(user, user.name);
  document.getElementById('hello').textContent = `Hello, ${firstNameOf(user.name)}`;

  // ---------- Growth kit (profession specific) ----------
  const growth = await api('/growth');
  const ctx = Growth.contextFor({ role: 'associate', user, industry: growth.industry, skills: growth.skills, watched: growth.lessonsWatched });
  CtaDash.mount(ctx, user);   // My CTA, Save costs, videos and creatives (and financial planning for professionals)
  document.title = `${ctx.display} dashboard: RentMySite.ai`;
  let player = null;
  let lastData = null;

  function openLesson(i) {
    location.hash = 'learn';
    setTimeout(() => player && player.select(i, true), 60);
  }
  function editSkills() {
    Growth.openSkillsDialog(ctx, skills => {
      ctx.skills = skills;
      renderGrowth();
      player && player.refresh(ctx);
      load();
    });
  }
  document.getElementById('changeSkills').addEventListener('click', editSkills);
  document.getElementById('profileSkillsBtn').addEventListener('click', editSkills);

  Growth.renderCtaBar(document.getElementById('ctaBar'), ctx, {
    secondary: `<a class="btn ghost" href="#gigs">Shifts near you</a>
      <button class="btn ghost" type="button" data-cta="run_workshop">Run a workshop</button>`
  });
  Growth.renderSlides(document.getElementById('slides'), ctx, { onLesson: openLesson });
  Growth.renderCommunity(document.getElementById('community'), ctx);
  Growth.renderPlanner(document.getElementById('planner'), ctx);
  player = Growth.mountPlayer(document.getElementById('player'), document.getElementById('playlist'), ctx, {
    onWatched: async lesson => {
      try { await api('/growth/lessons/watched', { method: 'POST', body: { key: lesson.key } }); } catch { /* progress is a nice-to-have */ }
      renderGrowth();
      load();
    }
  });

  function renderGrowth() {
    Growth.renderSkills(document.getElementById('skillsBox'), ctx, editSkills);
    Growth.renderLessonStrip(document.getElementById('lessonStrip'), ctx, openLesson);
    document.getElementById('lessonsTitle').textContent = ctx.skills.length ? 'Your video lessons' : `Video lessons for ${ctx.plural}`;
    document.getElementById('learnIntro').textContent = ctx.skills.length
      ? `Built from your skills: ${ctx.skills.slice(0, 4).join(', ')}.`
      : `Lessons for ${ctx.plural}. Choose your skills to make them yours.`;
    document.getElementById('profileSkills').innerHTML = ctx.skills.length
      ? ctx.skills.map(s => `<li>${esc(s)}</li>`).join('')
      : '<li>No skills chosen yet</li>';
  }

  async function load() {
    const d = await api('/associate/dashboard');
    lastData = d;

    const done = d.steps.filter(s => s.done).length;
    const pct = Math.round((done / d.steps.length) * 100);
    const actions = { skills: ['Choose', 'skills'], lesson: ['Watch', '#learn'], profile: ['Complete', '#profile'], live: ['See profile', '#profile'] };
    document.getElementById('steps').innerHTML = `
      <div class="nextsteps-head"><div class="ring" style="--p:${pct}"><span>${pct}%</span></div>
        <div><h2 style="margin:0">Your next steps</h2><p class="meta" style="margin:0">${done} of ${d.steps.length} done</p></div></div>
      <ol>${d.steps.map(s => {
        const [label, target] = actions[s.key] || ['Open', '#profile'];
        const btn = s.done ? '' : (target === 'skills'
          ? `<button class="btn ghost small" type="button" data-step="skills">${label}</button>`
          : `<a class="btn ghost small" href="${target}">${label}</a>`);
        return `<li class="${s.done ? 'done' : ''}"><strong>${esc(s.label)}</strong>${btn}</li>`;
      }).join('')}</ol>`;

    const m = d.user.assignedManager;
    document.getElementById('managerBox').innerHTML = m
      ? `<strong style="color:var(--ink)">${esc(m.name)}</strong><br>${esc(m.phone || '')}<br>${esc(m.email || '')}`
      : 'A manager is assigned once the team reviews your profile.';

    document.getElementById('myGigs').innerHTML = d.myGigs.length
      ? d.myGigs.map(g => `<div style="margin-bottom:.7rem"><strong>${esc(g.title)}</strong> ${pill(g.status)}<div class="meta">${g.type === 'workshop' ? 'Your workshop' : 'Shift applied'}, ${fmtDate(g.date)}</div></div>`).join('')
      : '<p class="meta">Nothing yet. Apply for a shift or propose a workshop.</p>';

    document.getElementById('openGigs').innerHTML = d.openGigs.length
      ? `<div class="list">${d.openGigs.map(g => `<div class="item">
          <div class="item-top"><span class="item-title">${esc(g.title)}</span><strong>${g.type === 'shift' ? inr(g.pay) + ' per shift' : inr(g.pricePerSeat) + ' per seat'}</strong></div>
          <div class="meta">${esc(g.venue?.business?.businessName || g.location || 'Venue to be confirmed')}, ${fmtDate(g.date)}${g.durationHours ? `, ${g.durationHours} hours` : ''}</div>
          ${g.description ? `<p class="item-body">${esc(g.description)}</p>` : ''}
          ${g.type === 'shift' ? `<button class="btn small" data-apply="${g._id}">Apply for this shift</button>` : ''}
        </div>`).join('')}</div>`
      : `<div class="list"><div class="empty"><strong>No open shifts in ${esc(user.location)} right now</strong>Tap “Find me ${esc(ctx.noun)} work” and we’ll match you with partner businesses.</div></div>`;
  }

  document.getElementById('steps').addEventListener('click', e => {
    if (e.target.closest('[data-step="skills"]')) editSkills();
  });

  document.addEventListener('click', async e => {
    const id = e.target.dataset?.apply;
    if (!id) return;
    e.target.disabled = true;
    try { await api(`/associate/gigs/${id}/apply`, { method: 'POST' }); toast('Applied. Your manager will confirm.'); await load(); }
    catch (err) { toast(err.message, true); e.target.disabled = false; }
  });

  const profileForm = document.getElementById('associateProfileForm');
  profileForm.phone.value = user.phone || '';
  profileForm.skill.value = user.associate?.skill || ctx.display;
  profileForm.experienceYears.value = user.associate?.experienceYears || 0;
  profileForm.availability.value = user.associate?.availability || '';
  profileForm.bio.value = user.associate?.bio || '';
  onSubmit(profileForm, async data => {
    await api('/associate/profile', { method: 'PATCH', body: data });
    toast('Professional profile saved');
    await load();
  });

  const wf = document.getElementById('workshopForm');
  async function preview() {
    const amount = (Number(wf.pricePerSeat.value) || 0) * (Number(wf.seats.value) || 0);
    document.getElementById('wTotal').innerHTML = `${inr(amount)}<small>ticket revenue if every seat sells</small>`;
    try {
      const split = await api('/payments/split-preview', { method: 'POST', body: { amount, model: 'four_way' } });
      document.getElementById('wSplit').innerHTML = splitHtml(split);
    } catch { /* ignore preview errors */ }
  }
  wf.addEventListener('input', preview);
  onSubmit(wf, async (data, form) => {
    await api('/associate/gigs/workshop', { method: 'POST', body: data });
    form.reset();
    toast('Workshop sent for approval');
    preview();
    await load();
  });

  // ---------- Marketplace: offer your services, book spaces (RentMySite is the third party) ----------
  let browse = null;
  function showFindTab(tab) {
    document.querySelectorAll('[data-find-tab]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.findTab === tab)));
    document.getElementById('findBox').hidden = tab !== 'browse';
    document.getElementById('myRequestsBox').hidden = tab !== 'mine';
    if (tab === 'mine') Market.renderMyRequests(document.getElementById('myRequestsBox'));
  }
  document.querySelector('#view-find .view-tabs').addEventListener('click', e => { const b = e.target.closest('[data-find-tab]'); if (b) showFindTab(b.dataset.findTab); });
  document.addEventListener('market:requested', () => showFindTab('mine'));
  document.getElementById('incomingRefresh').addEventListener('click', () => Market.renderIncoming(document.getElementById('incomingBox')));
  const offerIdeas = (ctx.sector.s || []).concat(ctx.sector.p || []);

  initViews(view => {
    if (view !== 'learn' && player) player.pause();
    if (view === 'offers') {
      Market.renderMyListings(document.getElementById('myOffers'), { role: 'associate', suggestions: offerIdeas, area: user.location || '' });
      Market.renderIncoming(document.getElementById('incomingBox'));
    }
    if (view === 'find' && !browse) browse = Market.renderBrowse(document.getElementById('findBox'), { user });
  });
  renderGrowth();
  preview();
  await load();
  if (!ctx.skills.length && !sessionStorage.getItem('pmbSkillsAsked:' + user._id)) {
    sessionStorage.setItem('pmbSkillsAsked:' + user._id, '1');
    editSkills();
  }
})();
