// Shared helpers for every page
// PATCH, PUT and DELETE go out as POST with an override header: the live server's Apache blocks those methods
// with a bare 403 before they reach the API. server.js turns them back into the real method.
async function api(path, { method = 'GET', body } = {}) {
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  const override = ['PATCH', 'PUT', 'DELETE'].includes(method);
  const headers = body && !isFormData ? { 'Content-Type': 'application/json' } : {};
  if (override) headers['X-HTTP-Method-Override'] = method;
  const res = await fetch('/api' + path, {
    method: override ? 'POST' : method,
    credentials: 'same-origin',
    headers,
    body: body ? (isFormData ? body : JSON.stringify(body)) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = n => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const fmtDate = d => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
// "Divyaj.govianu05" -> "Divyaj" for greetings
const firstNameOf = name => {
  let n = String(name || '').trim().split(/\s+/)[0] || '';
  if (n.includes('@')) n = n.split('@')[0];
  n = n.split(/[._]/)[0].replace(/\d+$/, '');
  return /[a-z]/i.test(n) ? n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() : 'there';
};
const pretty = s => String(s || '').replace(/_/g, ' ');
const pill = s => `<span class="pill ${esc(s)}">${esc(pretty(s))}</span>`;
const formData = form => Object.fromEntries(new FormData(form).entries());

function toast(msg, isError = false) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.toggle('err', isError);
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3200);
}

// Redirects to login (or the right dashboard) unless the user has the expected role
// Opens a dashboard only for its own kind of account. Otherwise go to the login page, remembering where this
// link was going (e.g. admin.html#leads from a team email), so the right account lands on the right tab.
async function guard(role) {
  const backTo = role === 'admin'
    ? `/team?next=${encodeURIComponent(location.hash.slice(1))}`     // the RentMySite team has its own sign-in
    : `/login?next=${encodeURIComponent(`${role}${location.hash}`)}#login`;
  try {
    const { user } = await api('/auth/me');
    if (user.role !== role) { location.href = backTo; return null; }
    return user;
  } catch {
    location.href = backTo;
    return null;
  }
}

async function logout() {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  location.href = '/login#login';
}

function handleHtml(handle) {
  const parts = String(handle || '').split('.');
  if (parts.length !== 3) return esc(handle || '');
  return `${esc(parts[0])}.${esc(parts[1])}.<em>${esc(parts[2])}</em>`;
}

function fillWho(user, displayName) {
  document.getElementById('whoName').textContent = displayName;
  document.getElementById('whoHandle').innerHTML = handleHtml(user.handle);
  document.getElementById('whoStatus').outerHTML = pill(user.status);
}

// Hash-based view switching: <a href="#x" data-view="x"> + <section id="view-x">
function initViews(onChange) {
  const show = () => {
    const links = [...document.querySelectorAll('.nav a[data-view]')];
    // Old links (#opportunities, #savings, #media) and unknown sections open the closest current section
    const MOVED = { opportunities: 'learn' };
    let name = location.hash.slice(1) || links[0].dataset.view;
    name = MOVED[name] || name;
    // Only sections in the menu open (e.g. Find & book is hidden for now, so #find opens the first section)
    if (!document.getElementById('view-' + name) || !links.some(a => a.dataset.view === name)) name = links[0].dataset.view;
    document.querySelectorAll('section[id^="view-"]').forEach(s => (s.hidden = s.id !== 'view-' + name));
    links.forEach(a => (a.dataset.view === name ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
    onChange && onChange(name);
  };
  window.addEventListener('hashchange', show);
  show();
}

function setCount(view, n) {
  const a = document.querySelector(`.nav a[data-view="${view}"]`);
  if (!a) return;
  let c = a.querySelector('.count');
  if (!n) { c && c.remove(); return; }
  if (!c) { c = document.createElement('span'); c.className = 'count'; a.appendChild(c); }
  c.textContent = n;
}

function splitHtml(split, highlight) {
  return `<div class="split">${split.lines
    .map(l => `<div class="${l.party === highlight ? 'mine' : ''}"><b>${inr(l.amountInr)}</b>${esc(l.label)} (${l.pct}%)</div>`)
    .join('')}</div>`;
}

// Wraps a form submit: disables button, shows errors inline, runs fn(data)
function onSubmit(form, fn) {
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    const errBox = form.querySelector('.error-box');
    if (errBox) errBox.textContent = '';
    if (btn) btn.disabled = true;
    try {
      const data = form.querySelector('input[type="file"]') ? new FormData(form) : formData(form);
      await fn(data, form);
    } catch (err) {
      if (errBox) errBox.textContent = err.message;
      else toast(err.message, true);
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}
