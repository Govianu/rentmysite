// WhatsApp & Calls tab of the team dashboard (admin.html#comms).
// Data comes from the Govianu Hub through this site's /api/hub/* (routes/hub.js), always for this site's brand.
// Uses api(), esc() and toast() from api.js.
(function () {
  const root = () => document.getElementById('comms');
  const S = { sub: 'overview', range: 'today', me: null, leadQ: '', leadStage: '', leadAssigned: '', leadContacted: '', leadCampaign: '', callEmp: '', inboxMine: false, templates: null };

  const ago = (t) => { if (!t) return ''; const m = Math.round((Date.now() - t) / 60000); return m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h ${m % 60} m` : `${Math.floor(m / 1440)} d`; };
  const when = (t) => (t ? new Date(t).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
  const secs = (s) => { s = Number(s) || 0; return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`; };
  const ph = (p) => (p ? '+' + p : '');
  const isHubAdmin = () => S.me?.me?.role === 'admin';
  const empName = (id) => S.me?.employees.find((e) => e.id === id)?.name || '';
  const empOptions = (sel, first = '') => first + (S.me?.employees || []).map((e) => `<option value="${esc(e.id)}" ${e.id === sel ? 'selected' : ''}>${esc(e.name)}</option>`).join('');
  const hub = (path, opts) => api('/hub' + path, opts);
  async function run(fn, ok) {
    try { const r = await fn(); if (ok) toast(typeof ok === 'function' ? ok(r) : ok); return r; } catch (e) { toast(e.message, true); return undefined; }
  }

  // Per-employee numbers live in the Govianu Hub report (hub.govianu.com), so there is no Team tab here
  const SUBS = [['overview', 'Overview'], ['inbox', 'Waiting for reply'], ['leads', 'Leads'], ['calls', 'Calls'], ['campaign', 'Campaign']];

  window.loadComms = async function () {
    const el = root();
    if (!el) return;
    try {
      S.me = await hub('/me');
    } catch (e) {
      el.innerHTML = `<div class="comms-banner err"><strong>Not connected.</strong> ${esc(e.message)}</div>`;
      return;
    }
    const subs = SUBS.filter(([k]) => k !== 'campaign' || isHubAdmin());
    if (!subs.some(([k]) => k === S.sub)) S.sub = 'overview';
    const c = S.me.configured;
    const warn = [
      c.dryRun && 'Test mode: the Hub is not sending anything to MyOperator (MYOP_DRY_RUN=true).',
      !c.waNumberId && 'WhatsApp number not confirmed yet: it is learned from the first incoming WhatsApp message.',
      !c.calling && 'Call recordings need the MyOperator Calling API token (MYOP_CALL_TOKEN) in the Hub.',
      S.me.campaignPausedReason,
    ].filter(Boolean);
    // No banner: admin view is a small lock at the end of the tab row
    const viewBar = '';
    const adminCtl = isHubAdmin()
      ? '<span class="pill approved" style="align-self:center">Admin view</span><button class="btn ghost small" type="button" id="cLeaveAdmin" style="align-self:center">Leave</button>'
      : `<button type="button" id="cLock" title="Admin view" aria-label="Admin view">🔒</button>
         <form id="cAdminForm" class="comms-admin-form" hidden style="align-self:center"><input type="password" id="cAdminCode" placeholder="Admin code" autocomplete="off" aria-label="Admin code"><button class="btn small" type="submit">Open</button></form>`;
    const askNotif = 'Notification' in window && Notification.permission === 'default'
      ? '<div class="comms-banner"><strong>Turn on desktop alerts</strong> so customer messages and missed calls pop up on your screen, even when this tab is in the background. <button class="btn small" type="button" id="cNotifOn">Turn on</button></div>'
      : '';
    const myPhone = S.me.me.phone || '';
    const phoneBar = `<form id="cMyPhone" class="comms-view" style="justify-content:flex-start;gap:.6rem">
        <span>📱 <strong>My WhatsApp for alerts:</strong></span>
        <input id="cMyPhoneIn" value="${esc(myPhone)}" placeholder="98xxxxxxxx" aria-label="My WhatsApp number for alerts" style="width:150px">
        <button class="btn ${myPhone ? 'ghost ' : ''}small" type="submit">${myPhone ? 'Update' : 'Save'}</button>
        <span class="meta">${myPhone ? 'Customer messages, missed calls and reminders also come to this WhatsApp.' : 'Add it so customer messages, missed calls and reminders reach your phone too.'}</span></form>`;
    el.innerHTML = `${viewBar}${phoneBar}${askNotif}${warn.length && isHubAdmin() ? `<div class="comms-banner">${warn.map(esc).join('<br>')}</div>` : ''}
      <div class="comms-tabs" role="tablist">${subs.map(([k, l]) => `<button type="button" data-sub="${k}" ${k === S.sub ? 'aria-current="page"' : ''}>${l}</button>`).join('')}<span style="flex:1"></span>${adminCtl}</div>
      <div id="commsBody"><p class="meta">Loading…</p></div>`;
    el.querySelectorAll('[data-sub]').forEach((b) => b.addEventListener('click', () => { S.sub = b.dataset.sub; window.loadComms(); }));
    document.getElementById('cMyPhone').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = document.getElementById('cMyPhoneIn').value.trim();
      if (!/^(\+?91)?[6-9]\d{9}$/.test(v.replace(/[\s-]/g, ''))) return toast('Enter a 10-digit Indian mobile number', true);
      run(() => hub(`/employees/${encodeURIComponent(S.me.me.id)}`, { method: 'PATCH', body: { phone: v } }), 'Saved – alerts will come to this WhatsApp').then(window.loadComms);
    });
    document.getElementById('cNotifOn')?.addEventListener('click', () => Notification.requestPermission().then(() => window.loadComms()));
    document.getElementById('cLock')?.addEventListener('click', () => {
      const f = document.getElementById('cAdminForm');
      f.hidden = !f.hidden;
      if (!f.hidden) document.getElementById('cAdminCode').focus();
    });
    document.getElementById('cAdminForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = document.getElementById('cAdminCode').value.trim();
      if (!code) return toast('Enter the admin code', true);
      const ok = await run(() => hub('/admin-view', { method: 'POST', body: { code } }), 'Admin view on for 12 hours');
      if (ok) window.loadComms();
    });
    document.getElementById('cLeaveAdmin')?.addEventListener('click', () => run(() => hub('/admin-view', { method: 'DELETE' }), 'Back to your own view').then(() => { if (S.sub === 'campaign') S.sub = 'overview'; window.loadComms(); }));
    try {
      await ({ overview, inbox, leads, calls, team, campaign }[S.sub])();
    } catch (e) {
      document.getElementById('commsBody').innerHTML = `<div class="comms-banner err">${esc(e.message)}</div>`;
    }
  };
  const body = () => document.getElementById('commsBody');
  const rangeSel = () => `<select id="cRange">${[['today', 'Today'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['all', 'All time']].map(([v, l]) => `<option value="${v}" ${v === S.range ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const wireRange = () => document.getElementById('cRange')?.addEventListener('change', (e) => { S.range = e.target.value; window.loadComms(); });
  const stat = (v, k) => `<div class="stat"><div class="v">${v ?? 0}</div><div class="k">${k}</div></div>`;

  // ───────── Overview ─────────
  async function overview() {
    const o = await hub(`/overview?range=${S.range}`);
    const total = o.leads || 1;
    body().innerHTML = `<div class="comms-bar">${rangeSel()}</div>
      <div class="stats">${stat(o.leads, 'leads')}${stat(o.newLeads, 'new in period')}${stat(o.openNow, 'waiting for a reply now')}${stat(o.unassigned, 'not assigned')}</div>
      <div class="stats">${stat(o.inbound, 'WhatsApp received')}${stat(o.outbound, 'WhatsApp sent')}${stat(o.aiReplies, 'answered by AI')}${stat(o.emails, 'emails sent')}${stat(o.calls, 'calls')}${stat(o.callsConnected, 'calls connected')}${stat(o.callsMissed, 'calls missed')}</div>
      <div class="comms-cols"><div class="comms-card"><h3>Pipeline</h3>${S.me.stages.map((s) => `<div class="meta" style="display:flex"><span style="flex:1">${esc(pretty(s))}</span><strong>${o.stages[s] || 0}</strong></div><div class="comms-bar-chart"><i style="width:${Math.round(((o.stages[s] || 0) / total) * 100)}%"></i></div>`).join('')}</div>
      <div class="comms-card"><h3>WhatsApp campaign</h3><div class="stats" style="margin:0">${stat(o.campaign.queued, 'queued')}${stat(o.campaign.sent, 'sent')}${stat(o.campaign.replied, 'replied')}${stat(o.campaign.failed, 'failed')}</div></div></div>`;
    wireRange();
  }

  // ───────── Waiting for reply ─────────
  function waitingTable(rows) {
    if (!rows.length) return '<p class="empty"><strong>Nobody is waiting</strong>Everyone who wrote or called has been answered.</p>';
    return `<div class="table-wrap"><table><thead><tr><th>Customer</th><th>Waiting</th><th>Last message</th><th>Assigned to</th><th>AI</th><th>Reminders</th><th></th></tr></thead><tbody>${rows.map((p) => `
      <tr class="comms-row" data-ph="${esc(p.phone)}"><td><strong>${esc(p.name || ph(p.phone))}</strong><div class="meta">${esc(ph(p.phone))}</div></td>
      <td><span class="pill ${Date.now() - p.firstAt > 30 * 60000 ? 'rejected' : 'pending'}">${ago(p.firstAt)}</span></td>
      <td>${p.kind === 'missed_call' ? '📞 ' : ''}${esc((p.lastText || '').slice(0, 120))}${p.count > 1 ? ` <span class="meta">(+${p.count - 1})</span>` : ''}</td>
      <td>${esc(p.assignedName || '—')}</td><td class="meta">${p.aiReplied ? 'replied<br>' : ''}${esc(p.aiSummary || '')}</td><td>${p.remindersSent}</td>
      <td><button class="btn ghost small" type="button" data-done="${esc(p.phone)}">Done</button></td></tr>`).join('')}</tbody></table></div>`;
  }
  function wireRows() {
    body().querySelectorAll('tr.comms-row[data-ph]').forEach((tr) => tr.addEventListener('click', (e) => { if (!e.target.closest('[data-done]')) openLead(tr.dataset.ph); }));
    body().querySelectorAll('[data-done]').forEach((b) => b.addEventListener('click', () => run(() => hub(`/inbox/${b.dataset.done}/done`, { method: 'POST', body: {} }), 'Marked done').then(window.loadComms)));
  }
  async function inbox() {
    const rows = await hub(`/inbox${S.inboxMine ? '?mine=1' : ''}`);
    body().innerHTML = `<div class="comms-bar"><label class="check"><input type="checkbox" id="cMine" ${S.inboxMine ? 'checked' : ''}> Only mine</label></div>
      <p class="meta">Someone leaves this list when a team member replies on WhatsApp (here or in MyOperator) or talks to them on a call. The assigned person is reminded on WhatsApp until then.</p>${waitingTable(rows)}`;
    document.getElementById('cMine').addEventListener('change', (e) => { S.inboxMine = e.target.checked; window.loadComms(); });
    wireRows();
  }

  // ───────── Leads ─────────
  async function leads() {
    const q = new URLSearchParams({ q: S.leadQ, stage: S.leadStage, assigned: S.leadAssigned, contactedBy: S.leadContacted, campaign: S.leadCampaign, limit: 300 });
    const res = await hub('/leads?' + q);
    body().innerHTML = `<div class="comms-bar">
        <input id="cQ" placeholder="Search name, phone, email, area…" value="${esc(S.leadQ)}">
        <select id="cStage"><option value="">All stages</option>${S.me.stages.map((s) => `<option value="${s}" ${s === S.leadStage ? 'selected' : ''}>${esc(pretty(s))}</option>`).join('')}</select>
        <select id="cContacted" aria-label="Contacted by"><option value="">Contacted by anyone</option><option value="me" ${S.leadContacted === 'me' ? 'selected' : ''}>Contacted by me</option><option value="none" ${S.leadContacted === 'none' ? 'selected' : ''}>Not contacted yet</option>${S.me.employees.map((e) => `<option value="${esc(e.id)}" ${S.leadContacted === e.id ? 'selected' : ''}>Contacted by ${esc(e.name)}</option>`).join('')}</select>
        <select id="cAssigned" aria-label="Assigned to"><option value="">Assigned to anyone</option><option value="me" ${S.leadAssigned === 'me' ? 'selected' : ''}>Assigned to me</option><option value="none" ${S.leadAssigned === 'none' ? 'selected' : ''}>Not assigned</option>${S.me.employees.map((e) => `<option value="${esc(e.id)}" ${S.leadAssigned === e.id ? 'selected' : ''}>Assigned to ${esc(e.name)}</option>`).join('')}</select>
        <select id="cCamp"><option value="">Any campaign state</option>${['none', 'queued', 'sent', 'replied', 'failed', 'skipped'].map((s) => `<option ${s === S.leadCampaign ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <p class="meta">${res.total} leads${res.total > res.rows.length ? ` (showing ${res.rows.length})` : ''}</p>
      <div class="table-wrap"><table><thead><tr><th>Name</th><th>Phone</th><th>Area</th><th>Stage</th><th>Contacted by</th><th>Last contact</th><th>Assigned to</th><th>WhatsApp campaign</th><th>Notes</th></tr></thead><tbody>
      ${res.rows.map((l) => `<tr class="comms-row" data-ph="${esc(l.phone)}"><td><strong>${esc(l.name || '—')}</strong>${l.waiting ? ' <span class="pill rejected">waiting</span>' : ''}</td><td>${esc(ph(l.phone))}</td><td>${esc(l.area)}</td>
        <td>${pill(l.stage)}</td>
        <td>${l.contactedByName ? `<strong>${esc(l.contactedByName)}</strong><div class="meta">${when(l.contactedAt)} · ${esc(l.contactedHow)}</div>` : '<span class="meta">not yet</span>'}</td>
        <td class="meta">${l.lastContactByName ? `${esc(l.lastContactByName)} · ${when(l.lastContactAt)}` : when(Math.max(l.lastInboundAt || 0, l.lastOutboundAt || 0) || null)}</td>
        <td>${esc(l.assignedName || '—')}</td><td>${pill(l.campaign)}</td>
        <td class="meta">${esc(l.aiSummary || l.skip || l.sheetStatus || '')}</td></tr>`).join('') || '<tr><td colspan="9" class="empty"><strong>No leads yet</strong>Import the sheet in the Campaign tab.</td></tr>'}
      </tbody></table></div>`;
    let t;
    document.getElementById('cQ').addEventListener('input', (e) => {
      clearTimeout(t);
      t = setTimeout(async () => {
        S.leadQ = e.target.value;
        await window.loadComms();
        const i = document.getElementById('cQ');
        if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
      }, 400);
    });
    document.getElementById('cStage').addEventListener('change', (e) => { S.leadStage = e.target.value; window.loadComms(); });
    document.getElementById('cAssigned')?.addEventListener('change', (e) => { S.leadAssigned = e.target.value; window.loadComms(); });
    document.getElementById('cContacted').addEventListener('change', (e) => { S.leadContacted = e.target.value; window.loadComms(); });
    document.getElementById('cCamp').addEventListener('change', (e) => { S.leadCampaign = e.target.value; window.loadComms(); });
    wireRows();
  }

  // ───────── Calls ─────────
  async function calls() {
    const rows = await hub(`/calls?range=${S.range}${S.callEmp ? '&employee=' + encodeURIComponent(S.callEmp) : ''}`);
    body().innerHTML = `<div class="comms-bar">${rangeSel()}<select id="cEmp"><option value="">All team members</option>${empOptions(S.callEmp)}</select></div>
      <div class="table-wrap"><table><thead><tr><th>When</th><th>Customer</th><th>Direction</th><th>Result</th><th>Talk time</th><th>Handled by</th><th>Recording</th></tr></thead><tbody>
      ${rows.map((c) => `<tr><td class="meta">${when(c.startedAt)}</td><td class="comms-row" data-ph="${esc(c.phone)}"><strong>${esc(c.name || ph(c.phone))}</strong></td>
        <td>${c.direction === 'outgoing' ? '↗ outgoing' : '↙ incoming'}</td>
        <td>${pill(c.status === 'bridged' ? 'connected' : c.status || 'ringing')}${c.missedBy.length ? `<div class="meta">rang: ${esc(c.missedBy.join(', '))}</div>` : ''}</td>
        <td>${secs(c.talk)}</td><td>${esc(c.employeeName || '—')}</td>
        <td>${c.hasRecording ? `<a class="btn ghost small" href="https://in.app.myoperator.com/logs" target="_blank" rel="noopener">▶ Play in MyOperator</a>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="empty"><strong>No calls in this period</strong>Calls appear once MyOperator sends them to the Hub.</td></tr>'}
      </tbody></table></div>`;
    wireRange();
    document.getElementById('cEmp')?.addEventListener('change', (e) => { S.callEmp = e.target.value; window.loadComms(); });
    body().querySelectorAll('td[data-ph]').forEach((td) => td.addEventListener('click', () => openLead(td.dataset.ph)));
  }

  // ───────── Team ─────────
  async function team() {
    const t = await hub(`/team?range=${S.range}`);
    const unmapped = Object.entries(t.unmappedAgents || {});
    const n = (v, cls) => (v ? `<span class="pill ${cls}">${v}</span>` : '0');
    body().innerHTML = `<div class="comms-bar">${rangeSel()}</div>
      <div class="table-wrap"><table><thead><tr><th>Team member</th><th>Assigned</th><th>Not contacted yet</th><th>Leads contacted first</th><th>People contacted</th><th>Calls out</th><th>Calls in</th><th>Connected</th><th>Talk time</th><th>Missed (their leads)</th><th>WhatsApp sent</th><th>Emails</th><th>Replied</th><th>Avg reply</th><th>Waiting now</th><th>Qualified</th><th>Signed</th></tr></thead><tbody>
      ${t.rows.map((r) => `<tr class="comms-row" data-emp="${esc(r.id)}"><td><strong>${esc(r.name)}</strong>${r.mapped ? '' : ' <span class="pill pending" title="Not linked to a MyOperator user yet: their calls cannot be credited">not linked</span>'}<div class="meta">${esc(r.email)}</div></td>
        <td>${r.assigned}</td><td>${n(r.untouched, 'pending')}</td><td>${r.contactedFirst || 0}</td><td>${r.contactedInRange}</td><td>${r.callsOut}</td><td>${r.callsIn}</td><td>${r.connected}</td><td>${secs(r.talkSec)}</td>
        <td>${n(r.missedAssigned, 'rejected')}</td><td>${r.waSent}</td><td>${r.emailsSent || 0}</td><td>${r.replied}</td><td>${r.avgResponseMin == null ? '—' : r.avgResponseMin + ' min'}</td>
        <td>${n(r.waitingNow, 'rejected')}</td><td>${r.qualified}</td><td>${r.signed}</td></tr>`).join('') || '<tr><td colspan="17" class="empty"><strong>No team members yet</strong>They appear after they open this tab or the Hub.</td></tr>'}
      </tbody></table></div><p class="meta">Click a person to see everything they did.</p>
      ${isHubAdmin() && unmapped.length ? `<div class="comms-card"><h3>MyOperator users not linked to a team member</h3><p class="meta">Link each one so their calls and WhatsApp replies count for them. Earlier activity is credited too.</p>
        <div class="table-wrap"><table><tbody>${unmapped.map(([id, u]) => `<tr><td><strong>${esc(u.name || id)}</strong><div class="meta">${esc(u.email || '')} · ${esc(id)}</div></td><td class="meta">${u.count}×</td>
        <td><select data-link="${esc(id)}"><option value="">Link to…</option>${empOptions('')}</select></td></tr>`).join('')}</tbody></table></div></div>` : ''}
      <div id="cTimeline"></div>`;
    wireRange();
    body().querySelectorAll('[data-emp]').forEach((tr) => tr.addEventListener('click', () => timeline(tr.dataset.emp)));
    body().querySelectorAll('[data-link]').forEach((s) => s.addEventListener('change', () => s.value && run(() => hub(`/employees/${s.value}`, { method: 'PATCH', body: { myopUserId: s.dataset.link } }), 'Linked').then(window.loadComms)));
  }
  async function timeline(id) {
    const rows = await hub(`/team/${encodeURIComponent(id)}/timeline`);
    const icon = { contacted: '🤝', call_out: '📞↗', call_in: '📞↙', wa_sent: '💬', replied: '✅', stage: '🏷️', note: '📝', assigned: '👤', email_sent: '✉️', test_send: '🧪' };
    const box = document.getElementById('cTimeline');
    box.innerHTML = `<div class="comms-card"><h3>${esc(empName(id))}: activity</h3><div class="table-wrap"><table><tbody>${rows.map((a) => `<tr class="${a.phone ? 'comms-row' : ''}" ${a.phone ? `data-ph="${esc(a.phone)}"` : ''}><td class="meta" style="white-space:nowrap">${when(a.at)}</td><td>${icon[a.type] || '•'}</td><td>${esc(a.text)}</td><td class="meta">${esc(a.leadName || ph(a.phone))}</td></tr>`).join('') || '<tr><td class="meta">No activity yet</td></tr>'}</tbody></table></div></div>`;
    box.querySelectorAll('[data-ph]').forEach((tr) => tr.addEventListener('click', () => openLead(tr.dataset.ph)));
    box.scrollIntoView({ behavior: 'smooth' });
  }

  // ───────── Campaign (Hub admins) ─────────
  async function campaign() {
    const o = await hub('/overview?range=all');
    const c = S.me.settings.campaign;
    body().innerHTML = `<div class="comms-cols">
      <div class="comms-card"><h3>1. Import leads</h3>
        <label>CSV of the “Enq - Owner” tab (Google Sheets → File → Download → CSV)</label><div class="comms-bar"><input type="file" id="cCsv" accept=".csv"><button class="btn ghost" type="button" id="cUp">Upload</button></div>
        <label>Or straight from the Google Sheet ${S.me.configured.sheets ? '' : '<span class="pill pending">service account not set</span>'}</label><div class="comms-bar"><input id="cTab" value="Enq - Owner"><button class="btn ghost" type="button" id="cSheet">Import</button><button class="btn ghost" type="button" id="cDnd">DND tab</button></div>
        <label>This website's own sign-ups and leads (they have emails)</label><button class="btn ghost" type="button" id="cSite">Sync from this website</button></div>
      <div class="comms-card"><h3>2. Message</h3>
        <p class="meta">The first WhatsApp to someone who hasn't written in 24 h must be a template approved by Meta.</p>
        <label>Template</label><div class="comms-bar"><select id="cTpl"><option>${esc(c.templateName)}</option></select><button class="btn ghost small" type="button" id="cLoadTpl">Load approved</button></div>
        <pre id="cTplBody" class="meta" style="white-space:pre-wrap;max-height:150px;overflow:auto"></pre>
        <label>Header media link (only for templates with an image/video/PDF header)</label><input id="cHdr" value="${esc(c.headerMediaUrl)}">
        <label>Email subject (also emailed when the lead has an email)</label><input id="cSub" value="${esc(c.emailSubject)}">
        <label>Email text ({name}, {area}, {area_in})</label><textarea id="cBody" rows="6">${esc(c.emailBody)}</textarea>
        <div class="comms-bar" style="margin-top:.6rem"><label>Per day <input id="cCap" type="number" value="${c.dailyCap}" style="width:90px"></label><label>Gap s <input id="cGap" type="number" value="${c.gapSec}" style="width:70px"></label><label>From <input id="cSh" type="number" value="${c.startHour}" style="width:70px"></label><label>To <input id="cEh" type="number" value="${c.endHour}" style="width:70px"></label></div>
        <label>Never message leads whose status/remarks contain</label><input id="cSkip" value="${esc(c.skipStatuses)}">
        <div style="margin-top:.8rem"><button class="btn" type="button" id="cSave">Save</button></div></div></div>
      <div class="comms-card"><h3>3. Test, then send</h3>
        <div class="comms-bar"><input id="cTestPh" placeholder="Your own WhatsApp number" style="max-width:220px"><button class="btn ghost" type="button" id="cTest">Send test to this number</button></div>
        <p>${S.me.campaignRunning ? '<span class="pill approved">running</span>' : '<span class="pill pending">paused</span>'} · queued <strong>${o.campaign.queued}</strong> · sent <strong>${o.campaign.sent}</strong> · replied <strong>${o.campaign.replied}</strong> · failed <strong>${o.campaign.failed}</strong> · today ${S.me.sentToday.count || 0}/${c.dailyCap}</p>
        <div class="comms-bar"><input id="cN" type="number" value="25" style="max-width:100px"><button class="btn ghost" type="button" id="cQN">Queue next N</button><button class="btn ghost" type="button" id="cQAll">Queue all eligible</button>
          <button class="btn" type="button" id="cStart">Start sending</button><button class="btn warn" type="button" id="cStop">Pause</button><button class="btn ghost" type="button" id="cClr">Clear queue</button></div>
        <p class="meta">Skipped automatically: DND, “not interested” and similar, and anyone already talking to us. Replies go to “Waiting for reply”, the assigned person is alerted, and the AI answers meanwhile.</p></div>`;
    const re = () => window.loadComms();
    const $ = (id) => document.getElementById(id);
    $('cUp').addEventListener('click', async () => {
      const f = $('cCsv').files[0];
      if (!f) return toast('Choose a CSV file first', true);
      const text = await f.text();
      run(async () => {
        const r = await fetch('/api/hub/import/csv?tab=' + encodeURIComponent(f.name), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'text/csv' }, body: text });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'Upload failed');
        return j;
      }, (r) => `+${r.added} new, ${r.updated} updated, ${r.invalid} bad numbers`).then(re);
    });
    $('cSheet').addEventListener('click', () => run(() => hub('/import/sheet', { method: 'POST', body: { tab: $('cTab').value } }), (r) => `+${r.added} new, ${r.updated} updated`).then(re));
    $('cDnd').addEventListener('click', () => run(() => hub('/import/dnd', { method: 'POST', body: {} }), (r) => `DND list: ${r.dnd} numbers`).then(re));
    $('cSite').addEventListener('click', () => run(() => hub('/import/site', { method: 'POST', body: {} }), (r) => `+${r.added} new, ${r.updated} updated`).then(re));
    const showTpl = () => { const t = (S.templates || []).find((x) => x.name === $('cTpl').value); $('cTplBody').textContent = t ? `${t.headerFormat ? `[header: ${t.headerFormat}] ` : ''}${t.variables.length ? `[has variables: ${t.variables.join(', ')} – not for bulk] ` : ''}\n${t.body}` : ''; };
    $('cLoadTpl').addEventListener('click', async () => {
      S.templates = (await run(() => hub('/templates'))) || [];
      $('cTpl').innerHTML = S.templates.filter((t) => t.status === 'approved').map((t) => `<option ${t.name === c.templateName ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
      showTpl();
    });
    $('cTpl').addEventListener('change', showTpl);
    $('cSave').addEventListener('click', () => run(() => hub('/settings', { method: 'POST', body: { campaign: { templateName: $('cTpl').value, headerMediaUrl: $('cHdr').value.trim(), emailSubject: $('cSub').value, emailBody: $('cBody').value, dailyCap: +$('cCap').value, gapSec: +$('cGap').value, startHour: +$('cSh').value, endHour: +$('cEh').value, skipStatuses: $('cSkip').value } } }), 'Saved').then(re));
    $('cTest').addEventListener('click', () => run(() => hub('/campaign/test', { method: 'POST', body: { phone: $('cTestPh').value, template: $('cTpl').value } }), (r) => (r.dryRun ? 'Test mode: logged, not sent' : 'Test sent – check WhatsApp')));
    $('cQN').addEventListener('click', () => run(() => hub('/campaign/queue', { method: 'POST', body: { count: +$('cN').value } }), (r) => `${r.queued} queued`).then(re));
    $('cQAll').addEventListener('click', () => { if (confirm('Queue every eligible lead? They go out within the daily limit.')) run(() => hub('/campaign/queue', { method: 'POST', body: { all: true } }), (r) => `${r.queued} queued`).then(re); });
    $('cStart').addEventListener('click', () => run(() => hub('/campaign/start', { method: 'POST', body: {} }), 'Sending started').then(re));
    $('cStop').addEventListener('click', () => run(() => hub('/campaign/stop', { method: 'POST', body: {} }), 'Paused').then(re));
    $('cClr').addEventListener('click', () => run(() => hub('/campaign/clear', { method: 'POST', body: {} }), (r) => `${r.cleared} removed from the queue`).then(re));
  }

  // ───────── Lead panel ─────────
  function closeLead() {
    document.querySelector('.comms-drawer')?.remove();
    document.querySelector('.comms-drawer-bg')?.remove();
    window.loadComms();
  }
  async function openLead(phone) {
    const d = await run(() => hub('/leads/' + encodeURIComponent(phone)));
    if (!d) return;
    const l = d.lead;
    const items = [
      ...d.messages.map((m) => ({
        at: m.at,
        html: `<div class="comms-msg ${m.channel === 'email' ? 'email' : m.dir}">${m.channel === 'email' ? '✉️ ' : ''}${esc(m.text)}<div class="meta">${m.dir === 'out' ? esc(m.byName || '') + ' · ' : ''}${when(m.at)}${m.dir === 'out' && m.status ? ' · ' + esc(m.status) : ''}</div></div>`,
      })),
      ...d.calls.map((c) => ({
        at: c.startedAt || c.createdAt,
        html: `<div class="comms-msg call">📞 ${c.direction === 'outgoing' ? 'Outgoing' : 'Incoming'} call · <strong>${esc(c.status === 'bridged' ? 'connected' : c.status || '')}</strong> · ${secs(c.talk)} · ${esc(c.employeeName || 'no one answered')}${c.recording_filename ? ` · <a href="https://in.app.myoperator.com/logs" target="_blank" rel="noopener">▶ recording</a>` : ''}<div class="meta">${when(c.startedAt || c.createdAt)}</div></div>`,
      })),
    ].sort((a, b) => a.at - b.at);
    document.querySelector('.comms-drawer')?.remove();
    document.querySelector('.comms-drawer-bg')?.remove();
    const bg = document.createElement('div');
    bg.className = 'comms-drawer-bg';
    const dr = document.createElement('div');
    dr.className = 'comms-drawer';
    dr.setAttribute('role', 'dialog');
    dr.innerHTML = `<div style="display:flex;gap:.6rem;align-items:center"><h2 style="flex:1">${esc(l.name || ph(l.phone))}</h2><button class="btn ghost small" type="button" data-close>Close</button></div>
      <p class="meta">${esc(ph(l.phone))}${l.email ? ' · ' + esc(l.email) : ''}${l.area ? ' · ' + esc(l.area) : ''} · source: ${esc(l.source || '—')}${l.sheetStatus ? ' · sheet: ' + esc(l.sheetStatus) : ''}</p>
      <div class="comms-fields">
        <div><label>Stage</label><select data-f="stage">${S.me.stages.map((s) => `<option value="${s}" ${s === l.stage ? 'selected' : ''}>${esc(pretty(s))}</option>`).join('')}</select></div>
        <div><label>Assigned to</label>${isHubAdmin() ? `<select data-f="assignedTo">${empOptions(l.assignedTo, '<option value="">Nobody</option>')}</select>` : `<p style="margin:.4rem 0">${esc(l.assignedName || 'Nobody')}</p>`}</div></div>
      <p class="comms-contacted">${l.contactedByName
        ? `<strong>Contacted by ${esc(l.contactedByName)}</strong> · ${when(l.contactedAt)} (${esc(l.contactedHow)})${l.lastContactByName && (l.lastContactBy !== l.contactedBy || l.lastContactAt !== l.contactedAt) ? `<br>Last contact: ${esc(l.lastContactByName)} · ${when(l.lastContactAt)} (${esc(l.lastContactHow)})` : ''}`
        : '<span class="meta">Not contacted by the team yet. Call from the MyOperator app or reply below, and it will show your name.</span>'}</p>
      <p class="comms-contacted" style="background:${l.aiPaused ? 'var(--paper)' : 'var(--teal-soft)'}">${l.aiPaused
        ? '👤 <strong>A team member is handling this chat</strong> – the AI is paused. <button class="btn ghost small" type="button" data-ai="on">Hand back to AI</button>'
        : '🤖 <strong>The AI assistant is replying</strong> until a team member replies or calls. <button class="btn ghost small" type="button" data-ai="off">Pause AI</button>'}</p>
      ${l.aiSummary ? `<p><span class="pill">AI summary</span> ${esc(l.aiSummary)}</p>` : ''}
      ${d.pending?.status === 'open' ? `<p><span class="pill rejected">Waiting ${ago(d.pending.firstAt)}</span> <button class="btn ghost small" type="button" data-done-lead>Mark done</button></p>` : ''}
      <h3>Messages, emails &amp; calls</h3>
      <div class="comms-thread">${items.map((i) => i.html).join('') || '<span class="meta">Nothing yet</span>'}</div>
      ${d.windowOpen
        ? `<div class="comms-reply"><textarea data-reply placeholder="Reply on WhatsApp as ${esc(S.me.me.name)}…"></textarea><button class="btn" type="button" data-send>Send</button></div>`
        : `<p class="meta" style="margin-top:.7rem">This person hasn't written in the last 24 h, so WhatsApp only allows an approved template:</p><div class="comms-reply"><select data-tpl><option value="">Choose a template…</option></select><button class="btn" type="button" data-send-tpl>Send template</button></div>`}
      <p class="meta">Calls: dial from the MyOperator app so the call is recorded and counted for you.</p>
      <h3>Notes</h3>
      ${(l.notes || []).map((n) => `<p class="meta"><strong>${esc(empName(n.by))}</strong> · ${when(n.at)}<br>${esc(n.text)}</p>`).join('')}
      <div class="comms-reply"><input data-note placeholder="What was discussed, next step…" style="flex:1"><button class="btn ghost" type="button" data-add-note>Add note</button></div>
      <h3>History</h3>
      <div class="table-wrap"><table><tbody>${d.activity.map((a) => `<tr><td class="meta" style="white-space:nowrap">${when(a.at)}</td><td class="meta">${esc(a.byName)}</td><td>${esc(a.text)}</td></tr>`).join('') || '<tr><td class="meta">Nothing yet</td></tr>'}</tbody></table></div>`;
    document.body.append(bg, dr);
    const th = dr.querySelector('.comms-thread');
    th.scrollTop = th.scrollHeight;
    const patch = (b) => run(() => hub('/leads/' + encodeURIComponent(phone), { method: 'PATCH', body: b }), 'Saved').then(() => openLead(phone));
    bg.addEventListener('click', closeLead);
    dr.querySelector('[data-close]').addEventListener('click', closeLead);
    dr.querySelectorAll('[data-f]').forEach((s) => s.addEventListener('change', () => patch({ [s.dataset.f]: s.value || null })));
    dr.querySelector('[data-ai]')?.addEventListener('click', (e) => patch({ aiPaused: e.target.dataset.ai === 'off' }));
    dr.querySelector('[data-add-note]').addEventListener('click', () => { const v = dr.querySelector('[data-note]').value.trim(); if (v) patch({ note: v }); });
    dr.querySelector('[data-done-lead]')?.addEventListener('click', () => run(() => hub(`/inbox/${phone}/done`, { method: 'POST', body: {} }), 'Marked done').then(() => openLead(phone)));
    dr.querySelector('[data-send]')?.addEventListener('click', () => {
      const v = dr.querySelector('[data-reply]').value.trim();
      if (v) run(() => hub(`/leads/${encodeURIComponent(phone)}/send`, { method: 'POST', body: { text: v } }), 'Sent').then(() => openLead(phone));
    });
    const tplSel = dr.querySelector('[data-tpl]');
    if (tplSel) {
      hub('/templates').then((t) => { tplSel.innerHTML = '<option value="">Choose a template…</option>' + t.filter((x) => x.status === 'approved' && !x.variables.length && !x.headerFormat).map((x) => `<option>${esc(x.name)}</option>`).join(''); }).catch(() => { tplSel.innerHTML = '<option value="">Templates: Hub admins only</option>'; });
      dr.querySelector('[data-send-tpl]').addEventListener('click', () => tplSel.value && run(() => hub(`/leads/${encodeURIComponent(phone)}/send`, { method: 'POST', body: { template: tplSel.value } }), 'Template sent').then(() => openLead(phone)));
    }
  }

  // Desktop notifications while the team dashboard is open (any tab, also in the background): customer messages,
  // missed calls and the repeating reminders, until someone replies. Clicking one opens the chat.
  let seen = 0;
  try { seen = Number(localStorage.getItem('hubNotifSeen')) || Date.now(); } catch { seen = Date.now(); }
  async function checkNotifs() {
    const list = await api('/hub/notifications').catch(() => []);
    if (!Array.isArray(list)) return;
    const fresh = list.filter((n) => !n.read && n.at > seen).sort((a, b) => a.at - b.at).slice(-3);
    if ('Notification' in window && Notification.permission === 'granted') {
      for (const n of fresh) {
        const pop = new Notification('WhatsApp & Calls', { body: n.text, tag: n.id, requireInteraction: true });
        pop.onclick = () => { window.focus(); location.hash = 'comms'; if (n.phone) openLead(n.phone); pop.close(); };
      }
    }
    if (list.length) seen = Math.max(seen, ...list.map((n) => n.at));
    try { localStorage.setItem('hubNotifSeen', String(seen)); } catch {}
  }
  setInterval(() => checkNotifs().catch(() => {}), 30000);
  setTimeout(() => checkNotifs().catch(() => {}), 3000);

  // Keep "Waiting for reply" and Overview fresh while open
  setInterval(() => {
    const sec = document.getElementById('view-comms');
    if (sec && !sec.hidden && !document.hidden && !document.querySelector('.comms-drawer') && ['overview', 'inbox', 'team'].includes(S.sub)) window.loadComms().catch(() => {});
  }, 30000);
})();
