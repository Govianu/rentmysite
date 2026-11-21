/* Growth kit shared by the business and professional dashboards.
   Everything is built from the person's business type (one of the 100 in utils/catalog.json)
   and the skills they choose: slides, video lessons, earnings planner and the call to action. */
(function () {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- Business-type context ----------
  const EXTRA_SKILLS = {
    food: ['Catering', 'Takeaway and delivery', 'Event hosting', 'Regional cuisine', 'Baking', 'Food safety'],
    venue: ['Event hosting', 'Room bookings', 'Corporate meetings', 'Weddings', 'Food and beverage'],
    wellness: ['Group classes', 'Personal training', 'Memberships', 'Therapies', 'Workshops'],
    retail: ['Visual merchandising', 'Online orders', 'Loyalty programmes', 'Pop-up events', 'Gift packs'],
    property: ['Facility management', 'Leasing', 'Events in common areas', 'Parking', 'Security'],
    education: ['After-school classes', 'Weekend workshops', 'Coaching', 'Summer camps', 'Online lessons'],
    health: ['Health camps', 'Home visits', 'Teleconsultation', 'Health packages', 'Corporate tie-ups'],
    mobility: ['Servicing', 'Pick-up and drop', 'Fleet contracts', 'Detailing', 'Roadside help'],
    studio: ['Client projects', 'Workshops', 'Retainers', 'Events', 'Content'],
    pro_people: ['One-to-one sessions', 'Group classes', 'Home visits', 'Online sessions', 'Workshops'],
    pro_trades: ['Repairs', 'Installations', 'Annual maintenance', 'Emergency call-outs', 'Site inspections'],
    pro_office: ['Consulting', 'Retainers', 'Audits', 'Training sessions', 'Online services'],
    pro_creative: ['Shoots and projects', 'Events', 'Workshops', 'Brand content', 'Retainers'],
    pro_food: ['Catering', 'Private dining', 'Cooking classes', 'Meal prep', 'Recipe development']
  };
  const GENERIC_STYLE = { accent: '#1B3A9E', soft: '#E6EBFA', ink: '#142C7A', icons: ['✨', '🗓', '📍', '🧾', '💸', '🤝'] };

  function contextFor({ role, user, industry, skills, watched, pending }) {
    const s = industry?.sector;
    const isPro = role === 'associate';
    const sector = s || {
      n: isPro ? 'Professional' : 'Business', noun: isPro ? 'professional' : 'business', t: isPro ? 'p' : 'b', g: isPro ? 'pro_people' : 'studio',
      s: isPro ? ['One-to-one sessions', 'Workshops', 'Project work', 'Retainers'] : ['Workshops and classes', 'Memberships', 'Event hosting', 'Partner promotions'],
      p: ['Gift packs', 'Partner products', 'Merchandise'],
      a: isPro ? 'Partner venues, client sites and online' : 'Your space, quiet hours and customers',
      e: 'A partner business and a professional share one customer base and split the income.',
      f: [30000, 60000, 25000, 15000]
    };
    const style = s?.style || GENERIC_STYLE;
    const partners = industry?.keywords?.partners?.length ? industry.keywords.partners : ['partner businesses'];
    const noun = industry?.label || sector.noun;
    return {
      role, isPro, user, industry, sector, style, partners, noun,
      plural: industry?.plural || noun + 's',
      display: industry?.display || noun.charAt(0).toUpperCase() + noun.slice(1),
      bizName: user.business?.businessName || '',
      firstName: String(user.name || '').split(/\s+/)[0],
      skills: skills || [],
      watched: watched || [],
      pending: pending || 0,
      extra: EXTRA_SKILLS[sector.g] || []
    };
  }

  const lowerFirst = x => (/^[A-Z]{2}/.test(x) ? x : x.charAt(0).toLowerCase() + x.slice(1));
  const listOf = (items, max = 3) => {
    const list = (items || []).slice(0, max).map(x => lowerFirst(String(x)));
    return list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
  };
  const an = n => `${(/^[A-Z]{2}/.test(n) ? /^[AEFHILMNORSX]/.test(n) : /^[aeiou]/i.test(n) && !/^(uni|eu|one)/i.test(n)) ? 'an' : 'a'} ${n}`;
  const roundK = n => Math.max(5000, Math.round(n / 1000) * 1000);

  // ---------- Lessons ----------
  // 6 lessons: the person's own skills first, then the type's services and products, then one partnership lesson.
  function buildLessons(ctx) {
    const { sector, skills, isPro, partners, noun, bizName } = ctx;
    const seen = new Set();
    const topics = [];
    const add = (topic, kind) => {
      const k = String(topic).toLowerCase();
      if (!topic || seen.has(k)) return;
      seen.add(k);
      topics.push({ topic: String(topic), kind });
    };
    skills.slice(0, 4).forEach(t => add(t, 'skill'));
    sector.s.forEach(t => add(t, 'service'));
    sector.p.forEach(t => add(t, 'product'));
    const picked = topics.slice(0, 5);
    picked.push({ topic: `Team up with ${partners[0]}`, kind: 'partner', partner: partners[0] });

    const f = sector.f || [30000, 60000, 25000, 15000];
    const icons = ctx.style.icons;
    const where = sector.a;
    const who = isPro ? 'you' : (bizName || `your ${noun}`);

    return picked.map((t, i) => {
      const partner = t.partner || partners[(i + 1) % partners.length] || partners[0];
      const topicLc = lowerFirst(t.topic);
      const money = t.kind === 'product' ? roundK(f[0] / 4) : t.kind === 'partner' ? roundK((f[2] || 20000) / 2) : roundK((f[1] || 50000) / 4);
      // What we do and what they do. No do-it-yourself recipe: the partner, the split and the numbers come on the RentMySite call.
      const slot = lowerFirst(where.split(',')[0]);
      let steps;
      if (t.kind === 'partner') {
        steps = isPro
          ? [`We find and vet ${partner} who need you.`, 'We agree your fee or share in writing.', 'You do the work you already know.', 'We bring repeat bookings and handle the payments.']
          : [`We find and vet ${partner} for ${who}.`, 'We write the agreement and the split. You approve it.', `You give the slot: ${slot} in quiet hours.`, 'We handle billing and settle every party.'];
      } else if (t.kind === 'product') {
        steps = isPro
          ? [`We shape ${topicLc} with you.`, `We bring ${partner} and their customers to sell through.`, 'We set the price and margins in writing.', 'You get paid on one statement.']
          : [`We bring ${partner} to supply or co-create ${topicLc}.`, 'We set the price and margins in writing.', 'You give the shelf or counter space.', 'We handle billing; your share settles automatically.'];
      } else {
        steps = isPro
          ? ['We list you for partner businesses that need this.', `We line up a first booking with ${partner}.`, 'We sign the agreement before you start.', 'You deliver; we collect and pay you.']
          : [`We package ${topicLc} and set the price.`, `We bring ${partner} to run it.`, 'We bring customers and event companies to book it.', `You give the slot: ${slot} in quiet hours.`, 'We collect the payments; your share settles automatically.'];
      }
      const title = t.topic.charAt(0).toUpperCase() + t.topic.slice(1);
      const icon = t.kind === 'partner' ? '🤝' : icons[[0, 1, 2, 1, 0][i] ?? 0];
      const scenes = [
        { icon, head: title, body: t.kind === 'partner' ? `Why ${partner} are good partners for ${isPro ? 'you' : who}, and how to start.` : (isPro ? `How ${an(noun)} turns this into paid work.` : `How ${an(noun)} like ${who} turns this into income.`), say: `${title}. A short guide for ${ctx.plural}.` },
        { icon: icons[5], head: 'Who pays for it', list: isPro ? partners.slice(0, 3).map(p => p.charAt(0).toUpperCase() + p.slice(1)) : ['Local customers', ...partners.slice(0, 2).map(p => p.charAt(0).toUpperCase() + p.slice(1))], say: `Who pays for it: ${isPro ? listOf(partners) : 'local customers, ' + listOf(partners.slice(0, 2))}.` },
        { icon: icons[1], head: 'Use what you already have', body: where, say: `Use what you already have: ${where}.` },
        { icon: icons[2], head: 'How we launch it with you', steps, say: `How we launch it with you. ${steps.join(' ')}` },
        { icon: icons[4], head: `Up to ${inr(money)} a month`, body: 'An illustrative figure from our sector research, not a promise. Your RentMySite manager checks what fits you.', cta: true, say: `This could be worth up to ${money.toLocaleString('en-IN')} rupees a month. Press "Help me launch this" and your manager will set it up with you.` }
      ];
      const words = scenes.reduce((n, sc) => n + sc.say.split(/\s+/).length, 0);
      return {
        key: `${sector.n}:${t.kind}:${t.topic}`.toLowerCase(),
        kind: t.kind, topic: t.topic, title, money, scenes,
        minutes: Math.max(1, Math.round(words / 150)),
        video: (window.PMB_LESSON_VIDEOS || {})[t.topic.toLowerCase()] || null
      };
    });
  }

  // ---------- Lesson player ----------
  function mountPlayer(root, listRoot, ctx, { onWatched } = {}) {
    let lessons = buildLessons(ctx);
    let li = 0, si = 0, playing = false, voice = 'speechSynthesis' in window, timer = null, startedAt = 0, elapsed = 0;
    const dur = sc => Math.min(12000, Math.max(5000, sc.say.split(/\s+/).length * 420));

    root.innerHTML = `
      <div class="lp" style="--accent:${ctx.style.accent};--accent-soft:${ctx.style.soft};--accent-ink:${ctx.style.ink}">
        <div class="lp-modes" role="group" aria-label="Lesson format" hidden>
          <button type="button" data-lp="mode-presenter" aria-pressed="true">AI presenter</button>
          <button type="button" data-lp="mode-slides" aria-pressed="false">Slides</button>
        </div>
        <div class="lp-screen" tabindex="-1">
          <div class="lp-presenter" hidden></div>
          <div class="lp-bars" aria-hidden="true"></div>
          <div class="lp-stage" aria-live="polite"></div>
          <button class="lp-big" type="button" aria-label="Play lesson"><span aria-hidden="true">▶</span></button>
        </div>
        <div class="lp-controls">
          <div class="lp-buttons">
            <button class="lp-btn" type="button" data-lp="prev" aria-label="Previous scene">⏮</button>
            <button class="lp-btn lp-play" type="button" data-lp="toggle" aria-label="Play">▶</button>
            <button class="lp-btn" type="button" data-lp="next" aria-label="Next scene">⏭</button>
            <button class="lp-btn lp-voice" type="button" data-lp="voice" aria-pressed="true" title="Voice narration">🔊 <span>Voice on</span></button>
          </div>
          <div class="lp-links">
            <button class="btn small" type="button" data-lp="launch">Help me launch this</button>
          </div>
        </div>
        <p class="lp-note" role="status"></p>
        <div class="lp-real" hidden></div>
      </div>`;
    const $ = sel => root.querySelector(sel);
    if (!voice) { $('.lp-voice').hidden = true; }

    // ---------- AI presenter videos (Higgsfield, made on first request and reused) ----------
    const presenter = { enabled: false, mode: 'presenter', byKey: {}, poll: null };
    const lp = root.querySelector('.lp');
    const pane = $('.lp-presenter');
    const note = $('.lp-note');
    const UNAVAILABLE = {
      monthly_limit: 'The AI presenter video for this lesson isn’t available this month, so here’s the slide version.',
      busy: 'The AI presenter is busy recording other lessons. Here’s the slide version; try again in a few minutes.',
      error: 'The AI presenter video couldn’t be loaded, so here’s the slide version.',
      unknown_type: 'Here’s the slide version of this lesson.'
    };
    function showSlides(message) {
      pane.hidden = true; pane.innerHTML = ''; lp.classList.remove('has-video');
      note.textContent = message || '';
    }
    function setMode(mode) {
      presenter.mode = mode;
      $('[data-lp="mode-presenter"]').setAttribute('aria-pressed', String(mode === 'presenter'));
      $('[data-lp="mode-slides"]').setAttribute('aria-pressed', String(mode === 'slides'));
      if (mode === 'slides') { pane.querySelector('video')?.pause(); showSlides(''); }
      else { pause(); loadPresenter(false); }
    }
    function markWatched(l) {
      if (!ctx.watched.includes(l.key)) { ctx.watched.push(l.key); onWatched && onWatched(l); }
      renderList();
    }
    async function loadPresenter(autoplay) {
      clearTimeout(presenter.poll);
      if (!presenter.enabled || presenter.mode !== 'presenter') return showSlides('');
      const l = lessons[li];
      let st = presenter.byKey[l.key];
      if (!st) {
        pane.hidden = false; lp.classList.add('has-video');
        pane.innerHTML = `<div class="lp-wait"><span class="lp-spin" aria-hidden="true"></span><p>Getting your AI presenter ready…</p></div>`;
        try {
          const r = await api('/lesson-videos/request', { method: 'POST', body: { topic: l.topic } });
          st = r.video || { unavailable: r.unavailable || 'error' };
        } catch { st = { unavailable: 'error' }; }
        presenter.byKey[l.key] = st;
        if (lessons[li].key !== l.key || presenter.mode !== 'presenter') return;
      }
      if (st.unavailable) return showSlides(UNAVAILABLE[st.unavailable] || UNAVAILABLE.error);
      if (st.status === 'failed') return showSlides(UNAVAILABLE.error);
      pane.hidden = false; lp.classList.add('has-video');
      if (st.status === 'ready') {
        pane.innerHTML = `<video class="lp-video" src="${esc(st.url)}" ${st.poster ? `poster="${esc(st.poster)}"` : ''} controls playsinline preload="metadata" aria-label="${esc(l.title)}, presented by your AI guide"></video>`;
        const v = pane.querySelector('video');
        v.addEventListener('ended', () => {
          markWatched(l);
          const next = lessons[li + 1];
          note.innerHTML = next ? `Lesson complete. <button class="link-btn" type="button" data-lp="nextlesson">Play next: ${esc(next.title)}</button>` : 'Lesson complete.';
        });
        note.textContent = '';
        if (autoplay) v.play().catch(() => {});
        return;
      }
      // Still being made: offer the slides meanwhile and swap the video in when it's ready
      pane.innerHTML = `<div class="lp-wait" ${st.poster ? `style="background:linear-gradient(rgba(255,255,255,.82),rgba(255,255,255,.82)),url('${esc(st.poster)}') center/cover"` : ''}><span class="lp-spin" aria-hidden="true"></span>
        <p><strong>Your AI presenter is recording this lesson.</strong><br>It usually takes a few minutes. It will appear here when it’s ready.</p>
        <button class="lp-cta" type="button" data-lp="mode-slides">Watch the slide version now</button></div>`;
      note.textContent = '';
      presenter.poll = setTimeout(async () => {
        try {
          const r = await api(`/lesson-videos/${encodeURIComponent(st.id)}`);
          if (r.video) presenter.byKey[l.key] = r.video;
        } catch { /* try again on the next check */ }
        if (lessons[li].key === l.key && presenter.mode === 'presenter') loadPresenter(false);
        else if (presenter.byKey[l.key]?.status === 'processing') presenter.poll = null;
      }, 12000);
    }
    api('/lesson-videos/config').then(c => {
      presenter.enabled = Boolean(c.enabled);
      if (presenter.enabled) { $('.lp-modes').hidden = false; loadPresenter(false); }
    }).catch(() => {});

    function renderList() {
      if (!listRoot) return;
      listRoot.innerHTML = `<ol class="lp-list">${lessons.map((l, i) => `
        <li><button type="button" data-lesson="${i}" class="${i === li ? 'on' : ''}" aria-current="${i === li ? 'true' : 'false'}">
          <span class="lp-thumb" style="background:${ctx.style.soft}">${l.scenes[0].icon}</span>
          <span class="lp-ltext"><strong>${esc(l.title)}</strong><small>${l.minutes} min${ctx.watched.includes(l.key) ? ', watched' : ''}${l.kind === 'skill' ? ', from your skills' : ''}</small></span>
          ${ctx.watched.includes(l.key) ? '<span class="lp-done" aria-hidden="true">✓</span>' : ''}
        </button></li>`).join('')}</ol>`;
    }

    function renderScene(animate = true) {
      const l = lessons[li], sc = l.scenes[si];
      $('.lp-bars').innerHTML = l.scenes.map((_, i) => `<span class="${i < si ? 'full' : ''}"><i></i></span>`).join('');
      let inner = `<div class="lp-icon">${sc.icon}</div><h3 class="lp-head">${esc(sc.head)}</h3>`;
      if (sc.body) inner += `<p class="lp-body">${esc(sc.body)}</p>`;
      if (sc.list) inner += `<ul class="lp-chips">${sc.list.map((x, i) => `<li style="--i:${i}">${esc(x)}</li>`).join('')}</ul>`;
      if (sc.steps) inner += `<ol class="lp-steps">${sc.steps.map((x, i) => `<li style="--i:${i}">${esc(x)}</li>`).join('')}</ol>`;
      if (sc.cta) inner += `<button class="lp-cta" type="button" data-lp="launch">Help me launch this</button>`;
      const stage = $('.lp-stage');
      stage.innerHTML = `<div class="lp-scene ${animate && !reduceMotion ? 'enter' : ''}">${inner}</div>`;
      const real = $('.lp-real');
      if (l.video) {
        real.hidden = false;
        real.innerHTML = `<h4>Video for this lesson</h4><div class="lp-embed"><iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(l.video)}" title="${esc(l.title)}" allow="encrypted-media; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>`;
      } else { real.hidden = true; real.innerHTML = ''; }
    }

    function speak(text) {
      if (!voice || !playing) return;
      try {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        const v = speechSynthesis.getVoices().find(x => /en[-_]IN/i.test(x.lang)) || speechSynthesis.getVoices().find(x => /^en/i.test(x.lang));
        if (v) u.voice = v;
        u.rate = 1.02;
        speechSynthesis.speak(u);
      } catch { /* narration is optional */ }
    }

    function tick() {
      if (!playing) return;
      const l = lessons[li], sc = l.scenes[si];
      const t = elapsed + (performance.now() - startedAt);
      const bar = $('.lp-bars').children[si]?.querySelector('i');
      if (bar) bar.style.width = Math.min(100, (t / dur(sc)) * 100) + '%';
      if (t >= dur(sc)) return advance();
      timer = requestAnimationFrame(tick);
    }

    function startScene() {
      elapsed = 0; startedAt = performance.now();
      renderScene();
      speak(lessons[li].scenes[si].say);
      cancelAnimationFrame(timer); timer = requestAnimationFrame(tick);
    }

    function advance() {
      const l = lessons[li];
      if (si < l.scenes.length - 1) { si++; return startScene(); }
      finish();
    }

    function finish() {
      pause();
      const l = lessons[li];
      if (!ctx.watched.includes(l.key)) { ctx.watched.push(l.key); onWatched && onWatched(l); }
      renderList();
      const next = lessons[li + 1];
      $('.lp-stage').innerHTML = `<div class="lp-scene lp-end">
        <div class="lp-icon">✓</div><h3 class="lp-head">Lesson complete</h3>
        <p class="lp-body">${next ? `Up next: ${esc(next.title)}` : 'You’ve watched all your lessons. Change your skills to get new ones.'}</p>
        <div class="lp-endbtns">${next ? '<button class="lp-cta" type="button" data-lp="nextlesson">Play next lesson</button>' : ''}
        <button class="lp-cta ghost" type="button" data-lp="replay">Replay</button>
        <button class="lp-cta ghost" type="button" data-lp="launch">Help me launch this</button></div></div>`;
      $('.lp-bars').querySelectorAll('span').forEach(s => s.classList.add('full'));
    }

    function play() {
      if (si === 0 && !$('.lp-scene:not(.lp-end)')) si = 0;
      playing = true; root.querySelector('.lp').classList.add('is-playing');
      $('.lp-play').textContent = '❚❚'; $('.lp-play').setAttribute('aria-label', 'Pause');
      if ($('.lp-end')) { si = 0; }
      if (elapsed > 0) { startedAt = performance.now(); if ('speechSynthesis' in window) speechSynthesis.resume(); timer = requestAnimationFrame(tick); }
      else startScene();
    }
    function pause() {
      pane?.querySelector('video')?.pause();
      if (playing) elapsed += performance.now() - startedAt;
      playing = false; cancelAnimationFrame(timer);
      root.querySelector('.lp').classList.remove('is-playing');
      $('.lp-play').textContent = '▶'; $('.lp-play').setAttribute('aria-label', 'Play');
      if ('speechSynthesis' in window) speechSynthesis.pause();
    }
    function select(i, autoplay) {
      if ('speechSynthesis' in window) speechSynthesis.cancel();
      pause(); li = Math.max(0, Math.min(lessons.length - 1, i)); si = 0; elapsed = 0;
      renderList(); renderScene(false);
      if (presenter.enabled && presenter.mode === 'presenter') return loadPresenter(autoplay);
      showSlides('');
      if (autoplay) play();
    }

    root.addEventListener('click', e => {
      const b = e.target.closest('[data-lp], .lp-big');
      if (!b) return;
      const a = b.classList.contains('lp-big') ? 'toggle' : b.dataset.lp;
      if (a === 'toggle') return playing ? pause() : play();
      if (a === 'next') { if ('speechSynthesis' in window) speechSynthesis.cancel(); return playing ? advance() : (si < lessons[li].scenes.length - 1 && (si++, renderScene())); }
      if (a === 'prev') { if ('speechSynthesis' in window) speechSynthesis.cancel(); si = Math.max(0, si - 1); return playing ? startScene() : renderScene(); }
      if (a === 'voice') {
        voice = !voice; b.setAttribute('aria-pressed', String(voice)); b.querySelector('span').textContent = voice ? 'Voice on' : 'Voice off';
        if (!voice && 'speechSynthesis' in window) speechSynthesis.cancel();
        return;
      }
      if (a === 'mode-presenter') return setMode('presenter');
      if (a === 'mode-slides') return setMode('slides');
      if (a === 'nextlesson') return select(li + 1, true);
      if (a === 'replay') return select(li, true);
      if (a === 'launch') { pause(); return openCtaDialog(ctx, { action: 'launch_idea', topic: lessons[li].title }); }
    });
    listRoot && listRoot.addEventListener('click', e => {
      const b = e.target.closest('[data-lesson]');
      if (b) select(Number(b.dataset.lesson), true);
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden && playing) pause(); });

    renderList(); renderScene(false);
    return {
      select,
      pause,
      refresh(newCtx) { Object.assign(ctx, newCtx); lessons = buildLessons(ctx); select(0, false); },
      get lessons() { return lessons; }
    };
  }

  // ---------- Overview strip of lessons ----------
  function renderLessonStrip(el, ctx, onOpen) {
    const lessons = buildLessons(ctx);
    el.innerHTML = `<div class="lstrip">${lessons.map((l, i) => `
      <button type="button" class="lcard" data-open-lesson="${i}" style="--accent:${ctx.style.accent};--accent-soft:${ctx.style.soft}">
        <span class="lcard-art" aria-hidden="true"><span>${l.scenes[0].icon}</span><span class="lcard-play">▶</span></span>
        <strong>${esc(l.title)}</strong>
        <small>${l.minutes} min${l.kind === 'skill' ? ', from your skills' : ''}${ctx.watched.includes(l.key) ? ', watched ✓' : ''}</small>
      </button>`).join('')}</div>`;
    el.onclick = e => { const b = e.target.closest('[data-open-lesson]'); if (b) onOpen(Number(b.dataset.openLesson)); };
  }

  // ---------- Slides ----------
  function renderSlides(el, ctx, { onLesson } = {}) {
    const { sector, isPro, noun, plural, bizName, partners } = ctx;
    const f = sector.f || [30000, 60000, 25000, 15000];
    const name = isPro ? `you` : (bizName || `your ${noun}`);
    const slides = [
      { icon: ctx.style.icons[0], head: isPro ? `Your skills, booked by ${partners[0]}` : `${bizName || 'Your ' + noun} could earn up to ${inr(f[0] + f[1])} more a month`,
        body: isPro ? `Partner businesses need ${plural} for ${listOf(sector.s, 2)}.` : `From ${listOf(sector.s, 2)}, without changing how you run things. An illustrative figure from our ${noun} research.`,
        chips: sector.s.slice(0, 4), btn: 'Show me how', act: 'lesson' },
      { icon: ctx.style.icons[1], head: isPro ? 'Where you can work' : 'Your quiet hours are worth more', body: sector.a, chips: [], btn: 'Help me use them', act: 'cta' },
      { icon: ctx.style.icons[3], head: isPro ? 'Products you can sell' : 'Sell more of what customers already want', body: `Ideas that work for ${plural}:`, chips: sector.p.slice(0, 4), btn: 'Help me launch one', act: 'cta' },
      { icon: ctx.style.icons[5], head: `Team up with ${listOf(partners, 2)}`, body: sector.e, chips: partners.map(p => p.charAt(0).toUpperCase() + p.slice(1)), btn: 'Find me a partner', act: 'partner' }
    ];
    el.innerHTML = `
      <div class="slides" style="--accent:${ctx.style.accent};--accent-soft:${ctx.style.soft};--accent-ink:${ctx.style.ink}" aria-roledescription="carousel" aria-label="Ideas for ${esc(name)}">
        <div class="slides-track">${slides.map((s, i) => `
          <section class="slide" role="group" aria-roledescription="slide" aria-label="${i + 1} of ${slides.length}" ${i ? 'aria-hidden="true"' : ''}>
            <div class="slide-copy">
              <h2>${esc(s.head)}</h2>
              <p>${esc(s.body)}</p>
              ${s.chips.length ? `<ul class="slide-chips">${s.chips.map(c => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
              <button class="btn slide-btn" type="button" data-slide-act="${s.act}" ${i ? 'tabindex="-1"' : ''}>${esc(s.btn)}</button>
            </div>
            <div class="slide-art" aria-hidden="true">${s.icon}</div>
          </section>`).join('')}</div>
        <div class="slides-nav">
          <button type="button" class="slides-arrow" data-dir="-1" aria-label="Previous slide">‹</button>
          <div class="slides-dots">${slides.map((_, i) => `<button type="button" data-dot="${i}" aria-label="Slide ${i + 1}" ${i ? '' : 'aria-current="true"'}></button>`).join('')}</div>
          <button type="button" class="slides-arrow" data-dir="1" aria-label="Next slide">›</button>
        </div>
      </div>`;
    const box = el.querySelector('.slides');
    let i = 0, auto = null;
    const go = n => {
      i = (n + slides.length) % slides.length;
      box.querySelector('.slides-track').style.transform = `translateX(-${i * 100}%)`;
      box.querySelectorAll('.slide').forEach((s, k) => {
        s.setAttribute('aria-hidden', String(k !== i));
        s.querySelectorAll('button').forEach(b => (k === i ? b.removeAttribute('tabindex') : b.setAttribute('tabindex', '-1')));
      });
      box.querySelectorAll('[data-dot]').forEach((d, k) => (k === i ? d.setAttribute('aria-current', 'true') : d.removeAttribute('aria-current')));
    };
    const start = () => { if (!reduceMotion) { clearInterval(auto); auto = setInterval(() => go(i + 1), 7000); } };
    const stop = () => clearInterval(auto);
    box.addEventListener('mouseenter', stop); box.addEventListener('mouseleave', start);
    box.addEventListener('focusin', stop); box.addEventListener('focusout', start);
    box.addEventListener('click', e => {
      const a = e.target.closest('[data-dir]'), d = e.target.closest('[data-dot]'), act = e.target.closest('[data-slide-act]');
      if (a) { go(i + Number(a.dataset.dir)); stop(); }
      if (d) { go(Number(d.dataset.dot)); stop(); }
      if (act) {
        const k = act.dataset.slideAct;
        if (k === 'lesson') onLesson && onLesson(0);
        else if (k === 'partner') openCtaDialog(ctx, { action: 'find_partner', topic: `Partner with ${listOf(partners, 2)}` });
        else openCtaDialog(ctx, { action: 'launch_idea', topic: slides[i].head });
      }
    });
    start();
  }

  // ---------- Skills ----------
  function suggestions(ctx) {
    const all = [...ctx.sector.s, ...ctx.extra, ...ctx.sector.p];
    const seen = new Set();
    return all.filter(x => { const k = x.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 16);
  }

  function renderSkills(el, ctx, onEdit) {
    el.innerHTML = ctx.skills.length
      ? `<div class="skills-row"><div><h2>${ctx.isPro ? 'Your skills' : `What ${esc(ctx.bizName || 'your ' + ctx.noun)} does best`}</h2>
          <ul class="skill-chips">${ctx.skills.map(s => `<li>${esc(s)}</li>`).join('')}</ul></div>
          <button class="btn ghost small" type="button" data-edit-skills>Change skills</button></div>`
      : `<div class="skills-ask" style="--accent:${ctx.style.accent};--accent-soft:${ctx.style.soft}">
          <div><h2>${ctx.isPro ? `What are you best at as ${esc(an(ctx.noun))}?` : `What does ${esc(ctx.bizName || 'your ' + ctx.noun)} do best?`}</h2>
          <p>Pick your skills and we’ll build 6 short video lessons on how to earn from them.</p></div>
          <button class="btn" type="button" data-edit-skills>Choose my skills</button></div>`;
    el.onclick = e => { if (e.target.closest('[data-edit-skills]')) onEdit(); };
  }

  function openSkillsDialog(ctx, onSave) {
    let dlg = document.getElementById('skillsDialog');
    if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'skillsDialog'; dlg.className = 'gdialog'; document.body.appendChild(dlg); }
    const MAX_SKILLS = 40;
    const chosen = new Set(ctx.skills.map(s => s));
    const opts = [...new Set([...ctx.skills, ...suggestions(ctx)])];
    dlg.innerHTML = `<form method="dialog" class="gdialog-body">
      <h2>${ctx.isPro ? `Your skills as ${esc(an(ctx.noun))}` : `What ${esc(ctx.bizName || 'your ' + ctx.noun)} does best`}</h2>
      <p class="meta">Choose as many as fit. Your lessons are built from the first four.</p>
      <p style="margin:0 0 .5rem"><button type="button" class="btn ghost small" data-all>Select all skills</button></p>
      <div class="pick" role="group" aria-label="Skills">${opts.map(o => `<button type="button" class="pick-chip" aria-pressed="${chosen.has(o)}" data-skill="${esc(o)}">${esc(o)}</button>`).join('')}</div>
      <div class="pick-add"><label for="skillAdd" class="sr-only">Add your own skill</label>
        <input id="skillAdd" maxlength="60" placeholder="Add your own, e.g. ${ctx.isPro ? 'Tandoor cooking' : 'Rooftop seating'}">
        <button type="button" class="btn ghost small" data-add>Add</button></div>
      <p class="error-box" role="alert"></p>
      <div class="gdialog-actions"><button type="button" class="btn ghost" data-close>Cancel</button><button type="button" class="btn" data-save>Build my lessons</button></div>
    </form>`;
    const err = dlg.querySelector('.error-box');
    dlg.onclick = async e => {
      const chip = e.target.closest('[data-skill]');
      if (chip) {
        const v = chip.dataset.skill;
        if (chosen.has(v)) chosen.delete(v); else if (chosen.size < MAX_SKILLS) chosen.add(v);
        chip.setAttribute('aria-pressed', String(chosen.has(v)));
      }
      // One tap picks every skill shown (or clears them all if they are all picked already)
      const all = e.target.closest('[data-all]');
      if (all) {
        const chips = [...dlg.querySelectorAll('[data-skill]')];
        const everyOn = chips.every(c => chosen.has(c.dataset.skill));
        chips.forEach(c => { if (everyOn) chosen.delete(c.dataset.skill); else if (chosen.size < MAX_SKILLS) chosen.add(c.dataset.skill); c.setAttribute('aria-pressed', String(chosen.has(c.dataset.skill))); });
        all.textContent = everyOn ? 'Select all skills' : 'Clear all';
      }
      if (e.target.closest('[data-add]')) addCustom();
      if (e.target.closest('[data-close]')) dlg.close();
      if (e.target.closest('[data-save]')) {
        if (!chosen.size) { err.textContent = 'Pick or add at least one skill.'; return; }
        const btn = e.target.closest('[data-save]'); btn.disabled = true;
        try {
          const { skills } = await api('/growth/skills', { method: 'PATCH', body: { skills: [...chosen] } });
          dlg.close(); onSave(skills); toast('Skills saved. Your lessons are ready.');
        } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
      }
    };
    function addCustom() {
      const input = dlg.querySelector('#skillAdd');
      const v = input.value.trim();
      if (!v) return;
      // Already in the list: just pick it, no duplicate chip
      const existing = [...dlg.querySelectorAll('[data-skill]')].find(c => c.dataset.skill.toLowerCase() === v.toLowerCase());
      if (existing) { chosen.add(existing.dataset.skill); existing.setAttribute('aria-pressed', 'true'); input.value = ''; err.textContent = ''; return; }
      if (chosen.size >= MAX_SKILLS) { err.textContent = `You can choose up to ${MAX_SKILLS} skills.`; return; }
      chosen.add(v); err.textContent = '';
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'pick-chip'; b.dataset.skill = v; b.setAttribute('aria-pressed', 'true'); b.textContent = v;
      dlg.querySelector('.pick').prepend(b);
      input.value = '';
    }
    dlg.querySelector('#skillAdd').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } });
    dlg.showModal();
  }

  // ---------- Earnings planner ----------
  function renderPlanner(el, ctx) {
    const f = ctx.sector.f || [30000, 60000, 25000, 15000];
    const rows = ctx.isPro
      ? [['Selling products', f[0], ctx.sector.p[0]], ['Paid services and bookings', f[1], ctx.sector.s[0]], ['Shared space and tools', f[2], 'instead of paying rent'], ['Lower costs', f[3], 'group buying and shared software']]
      : [['Selling products', f[0], ctx.sector.p[0]], ['New services', f[1], ctx.sector.s[0]], ['Shared staff and resources', f[2], 'staff on call and idle-hour use'], ['Lower supply costs', f[3], 'group buying']];
    el.innerHTML = `<div class="planner" style="--accent:${ctx.style.accent};--accent-soft:${ctx.style.soft}">
      <div class="planner-head"><h2>Plan your extra income</h2><p class="meta">Switch streams on and off. Figures are illustrative, from our ${esc(ctx.noun)} research.</p></div>
      <div class="planner-rows">${rows.map((r, i) => `
        <label class="prow"><input type="checkbox" data-amt="${r[1]}" ${i < 2 ? 'checked' : ''}>
          <span class="prow-text"><strong>${esc(r[0])}</strong><small>${esc(r[2] || '')}</small></span>
          <span class="prow-amt">${inr(r[1])}</span></label>`).join('')}</div>
      <div class="planner-pace" role="radiogroup" aria-label="How far along you are">
        ${[['0.3', 'Just starting'], ['0.6', 'Growing'], ['1', 'Fully running']].map(([v, t], i) => `<label><input type="radio" name="pace" value="${v}" ${i === 0 ? 'checked' : ''}><span>${t}</span></label>`).join('')}
      </div>
      <div class="planner-total"><span class="meta">Extra a month</span><strong data-total>₹0</strong></div>
    </div>`;
    const out = el.querySelector('[data-total]');
    let shown = 0;
    const update = animate => {
      const pace = Number(el.querySelector('input[name="pace"]:checked').value);
      const total = [...el.querySelectorAll('input[type="checkbox"]:checked')].reduce((s, c) => s + Number(c.dataset.amt), 0) * pace;
      if (!animate || reduceMotion) { shown = total; out.textContent = inr(total); return; }
      const from = shown, t0 = performance.now();
      const step = now => { const k = Math.min(1, (now - t0) / 450); shown = from + (total - from) * (1 - Math.pow(1 - k, 3)); out.textContent = inr(shown); if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    };
    el.addEventListener('change', () => update(true));
    update(false);
  }

  // ---------- Call to action ----------
  // The main button, worded for each business type: "Launch dining memberships", "Launch subscription laundry"
  function launchCta(ctx) {
    const lead = ctx.sector.s && ctx.sector.s[0];
    return lead ? { action: 'launch_idea', label: `Launch ${lowerFirst(lead)}`, topic: lead } : { action: 'growth_call', label: 'Book a growth call' };
  }

  function renderCtaBar(el, ctx, { secondary, primary: chosen } = {}) {
    const primary = chosen || (ctx.isPro ? { action: 'find_work', label: `Find me ${ctx.noun} work` } : { action: 'growth_call', label: 'Book a growth call' });
    el.innerHTML = `<div class="ctabar" style="--accent:${ctx.style.accent};--accent-soft:${ctx.style.soft}">
      <div class="ctabar-who"><span class="ctabar-icon" aria-hidden="true">${ctx.style.icons[0]}</span>
        <span><strong>${esc(ctx.isPro ? ctx.user.name : (ctx.bizName || ctx.user.name))}</strong><small>${esc(ctx.display)} partner</small></span></div>
      <div class="ctabar-actions">
        ${secondary ? secondary : ''}
        <button class="btn ctabar-main" type="button" data-cta="${primary.action}" data-topic="${esc(primary.topic || '')}">${esc(primary.label)}</button>
      </div></div>`;
    el.onclick = e => { const b = e.target.closest('[data-cta]'); if (b) openCtaDialog(ctx, { action: b.dataset.cta, topic: b.dataset.topic || '' }); };
  }

  const CTA_TEXT = {
    growth_call: ['Book a growth call', 'Your RentMySite manager calls you to plan the ideas that fit.', 'Request the call', 'Call requested. Your RentMySite manager will be in touch.'],
    launch_idea: ['Help me launch this', 'Your RentMySite manager will plan this idea with you and find the right partners.', 'Send to my manager', 'Sent. Your RentMySite manager will plan it with you.'],
    find_partner: ['Find me a partner', 'Tell us who you’d like to work with. We’ll introduce you.', 'Request an introduction', 'Request sent. We’ll suggest partners soon.'],
    find_work: ['Find me paid work', 'We’ll match your skills with partner businesses near you.', 'Find me work', 'Request sent. We’ll match you with partner businesses.'],
    run_workshop: ['Help me run a workshop', 'We’ll find a partner venue and help you price it.', 'Send to my manager', 'Sent. Your RentMySite manager will help you set it up.'],
    save_costs: ['Get my savings plan', 'Your RentMySite manager will look at your top 5 monthly expenses and find partners to bring them down.', 'Send to my manager', 'Sent. Your RentMySite manager will call you about your savings plan.'],
    financial_plan: ['Plan my finances', 'We’ll plan steady work with you and help you apply to a bank for a line of credit.', 'Send to my manager', 'Sent. Your RentMySite manager will call you to plan it.']
  };

  function openCtaDialog(ctx, { action = 'growth_call', topic = '' } = {}) {
    const [title, intro, btn, done] = CTA_TEXT[action] || CTA_TEXT.growth_call;
    let dlg = document.getElementById('ctaDialog');
    if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'ctaDialog'; dlg.className = 'gdialog'; document.body.appendChild(dlg); }
    const topics = [...new Set([topic, ...buildLessons(ctx).map(l => l.title)].filter(Boolean))];
    dlg.innerHTML = `<form method="dialog" class="gdialog-body">
      <h2>${esc(title)}</h2><p class="meta">${esc(intro)}</p>
      <div class="field"><label for="ctaTopic">About</label><select id="ctaTopic">${topics.map(t => `<option ${t === topic ? 'selected' : ''}>${esc(t)}</option>`).join('')}<option value="">Something else</option></select></div>
      <div class="field"><label for="ctaTime">Best time to call <span class="hint">(optional)</span></label>
        <select id="ctaTime"><option value="">Any time</option><option>Morning, 9–12</option><option>Afternoon, 12–4</option><option>Evening, 4–7</option></select></div>
      <div class="field"><label for="ctaNote">Anything we should know <span class="hint">(optional)</span></label><textarea id="ctaNote" maxlength="1000"></textarea></div>
      <p class="meta">We’ll call ${esc(ctx.user.phone || 'you')} or email ${esc(ctx.user.email || '')}.</p>
      <p class="error-box" role="alert"></p>
      <div class="gdialog-actions"><button type="button" class="btn ghost" data-close>Cancel</button><button type="button" class="btn" data-send>${esc(btn)}</button></div>
    </form>`;
    dlg.onclick = async e => {
      if (e.target.closest('[data-close]')) return dlg.close();
      const send = e.target.closest('[data-send]');
      if (!send) return;
      send.disabled = true;
      try {
        await api('/growth/cta', { method: 'POST', body: { action, topic: dlg.querySelector('#ctaTopic').value, preferredTime: dlg.querySelector('#ctaTime').value, note: dlg.querySelector('#ctaNote').value } });
        dlg.close(); toast(done);
      } catch (ex) { dlg.querySelector('.error-box').textContent = ex.message; send.disabled = false; }
    };
    dlg.showModal();
  }


  // ---------- People behind your growth: a named manager, real network numbers, an example ----------
  // Numbers come from /api/growth/community and are real counts; small ones are left out, never invented.
  async function renderCommunity(el, ctx) {
    if (!el) return;
    let d;
    try { d = await api('/growth/community'); } catch { el.innerHTML = ''; return; }
    const m = d.manager;
    const initials = n => (n ? String(n).split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() : 'RentMySite');
    const titleCase = t => String(t || '').replace(/\b\w/g, c => c.toUpperCase());
    const n = d.numbers || {};
    // Big network numbers (e.g. 5,000+ people have joined), not small counts
    const stats = d.headline || [
      n.members && [n.members, 'businesses and professionals have joined RentMySite'],
      n.sameTypeNearby && [n.sameTypeNearby, `${ctx.plural} in ${titleCase(n.area)} are on the network`],
      !n.sameTypeNearby && n.sameType && [n.sameType, `${ctx.plural} are on the network`],
      n.partners && [n.partners, `partners who suit ${ctx.isPro ? 'you' : (ctx.bizName || `your ${ctx.noun}`)} have signed up`],
      d.ideas && [d.ideas, `ways ${ctx.plural} earn with us, ready to start`],
      d.partnerTypes && [d.partnerTypes, `kinds of partners ready to team up with ${ctx.plural}`]
    ].filter(Boolean).slice(0, 3);
    const phone = m?.phone || d.team.phone;
    const wa = (m?.phone || '').replace(/\D/g, '') || d.team.whatsapp;
    el.innerHTML = `<section class="people" style="--accent:${ctx.style.accent};--accent-soft:${ctx.style.soft}" aria-labelledby="peopleTitle">
      <h2 id="peopleTitle" class="sr-only">The people behind your growth</h2>
      <div class="people-manager">
        <span class="people-avatar" aria-hidden="true">${esc(initials(m?.name))}</span>
        <div>
          <strong>${m ? esc(m.name) : 'The RentMySite team'}</strong>
          <small>${m ? 'Your RentMySite manager. I’ll help you launch your first collaboration.' : 'We review every new partner and call you within one working day.'}</small>
          <div class="people-actions">
            <a class="btn small" href="tel:${esc(phone.replace(/\s+/g, ''))}">Call ${esc(phone)}</a>
            <a class="btn ghost small" href="https://wa.me/${esc(wa)}?text=${encodeURIComponent(`Hi, I'm ${ctx.user.name}${ctx.bizName ? ` from ${ctx.bizName}` : ''} on RentMySite.`)}" target="_blank" rel="noopener">WhatsApp</a>
          </div>
        </div>
      </div>
      ${stats.length ? `<ul class="people-stats">${stats.map(([v, t]) => `<li><b>${esc(typeof v === 'number' ? v.toLocaleString('en-IN') : String(v))}</b><span>${esc(t)}</span></li>`).join('')}</ul>` : ''}
      ${d.example ? `<p class="people-example"><span>Example</span>${esc(d.example)}</p>` : ''}
    </section>`;
  }

  window.Growth = { renderCommunity, launchCta, contextFor, buildLessons, mountPlayer, renderLessonStrip, renderSlides, renderSkills, openSkillsDialog, renderPlanner, renderCtaBar, openCtaDialog };
})();
