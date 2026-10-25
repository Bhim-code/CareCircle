/* CareCircle admin panel: plain JavaScript, no build step.
 *
 * Security notes
 * - Everything from the API is put on the page with textContent (the h() helper),
 *   never innerHTML, so a record containing <script> is shown as text.
 * - Tokens are kept in sessionStorage: they disappear when the tab is closed.
 * - Hiding a button is not security. The API refuses supervisors' changes itself.
 */
'use strict';

const API = String(window.CARECIRCLE_API || '').replace(/\/$/, '');
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const STORE = 'carecircle.admin.session';

// ---------------------------------------------------------------- session

const session = {
  get() { try { return JSON.parse(sessionStorage.getItem(STORE)) || null; } catch { return null; } },
  set(value) { try { sessionStorage.setItem(STORE, JSON.stringify(value)); } catch { /* private mode */ } },
  clear() { try { sessionStorage.removeItem(STORE); } catch { /* ignore */ } },
};

class ApiError extends Error {
  constructor(status, body) {
    super((body && body.error && body.error.message) || `Request failed (${status}).`);
    this.status = status;
    this.code = body && body.error && body.error.code;
    this.fields = (body && body.error && body.error.fields) || {};
  }
}

async function refreshTokens() {
  const s = session.get();
  if (!s || !s.refreshToken) return false;
  const res = await fetch(`${API}/auth/refresh`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: s.refreshToken }),
  });
  if (!res.ok) return false;
  const tokens = await res.json();
  session.set({ ...s, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
  return true;
}

let refreshing = null;

async function api(path, { method = 'GET', body, raw = false, retry = true } = {}) {
  const s = session.get();
  const headers = {};
  if (s) headers.Authorization = `Bearer ${s.accessToken}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, { error: { message: `Cannot reach the API at ${API}. Is it running?` } });
  }
  if (res.status === 401 && retry && s) {
    refreshing = refreshing || refreshTokens().finally(() => { refreshing = null; });
    if (await refreshing) return api(path, { method, body, raw, retry: false });
    session.clear();
    go('#/sign-in', 'Your session ended. Please sign in again.');
    throw new ApiError(401, null);
  }
  if (!res.ok) {
    let data = null;
    try { data = await res.json(); } catch { /* not JSON */ }
    throw new ApiError(res.status, data);
  }
  if (raw) return res;
  return res.status === 204 ? null : res.json();
}

// ---------------------------------------------------------------- DOM helpers

/** h('a', {href:'#'}, 'text', child) — builds elements; strings become text nodes. */
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'style') el.style.cssText = value; // CSSOM: allowed by the page's CSP
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

function svg(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

const fmtDateTime = (iso) => iso ? new Date(iso).toLocaleString(undefined,
  { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const fmtDate = (iso) => iso ? new Date(`${iso}T00:00:00`).toLocaleDateString(undefined,
  { dateStyle: 'medium' }) : 'No date';
const pct = (v) => v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`;

const KIND_LABEL = { medical: 'Medical', behavioural: 'Behavioural', incident: 'Incident', medication: 'Medication' };
const CATEGORY_LABEL = { prescription: 'Prescription', lab_report: 'Lab report', imaging: 'Imaging',
  discharge_summary: 'Discharge summary', other: 'Other' };
const ACTION_LABEL = {
  'patient.view': 'Opened patient', 'reminders.view': 'Viewed reminders', 'entries.view': 'Viewed records',
  'documents.view': 'Viewed documents', 'entries.export': 'Exported records',
  'reminders.export': 'Exported reminders', 'entries.list': 'Read records in the app',
  'users.list': 'Listed accounts', 'user.deactivate': 'Turned off account',
  'user.activate': 'Turned on account', 'admin.denied': 'Tried to open the admin panel',
  'admin.change.denied': 'Tried to change an account',
};
const STATUS_CLASS = { taken: 'text-taken', due: 'text-due', missed: 'text-missed', upcoming: 'text-upcoming' };
const STATUS_LABEL = { taken: 'Taken', due: 'Due now', missed: 'Missed', upcoming: 'Upcoming' };

function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.add('hidden'), 4000);
}

function confirmAction(title, body, okLabel) {
  const dialog = document.getElementById('confirm');
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-body').textContent = body;
  document.getElementById('confirm-ok').textContent = okLabel;
  dialog.showModal();
  return new Promise((resolve) => dialog.addEventListener('close',
    () => resolve(dialog.returnValue === 'ok'), { once: true }));
}

function errorBox(err) {
  return h('p', { role: 'alert', class: 'rounded-md border border-missed/30 bg-missed/5 px-4 py-3 text-missed' },
    err.message || 'Something went wrong.');
}

function loading() {
  return h('p', { class: 'py-10 text-muted', 'aria-busy': 'true' }, 'Loading…');
}

/** The adherence circle: the share of doses confirmed. */
function ring(value, size = 168, label = 'doses confirmed, last 7 days') {
  const stroke = Math.round(size / 11);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const box = svg('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, 'aria-hidden': 'true' });
  box.append(svg('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', stroke: '#E1E4EA', 'stroke-width': stroke }));
  const arc = svg('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', stroke: '#2E6A5C',
    'stroke-width': stroke, 'stroke-linecap': 'round', 'stroke-dasharray': c, 'stroke-dashoffset': c,
    transform: `rotate(-90 ${size / 2} ${size / 2})`, class: 'ring-arc' });
  box.append(arc);
  if (value !== null && value !== undefined) {
    requestAnimationFrame(() => requestAnimationFrame(() => arc.setAttribute('stroke-dashoffset', c * (1 - value))));
  }
  return h('figure', { class: 'relative inline-grid place-items-center', style: `width:${size}px;height:${size}px` },
    box,
    h('figcaption', { class: 'absolute inset-0 grid place-content-center text-center' },
      h('span', { class: size >= 180 ? 'text-4xl font-bold' : size > 120 ? 'text-2xl font-bold' : 'text-xl font-bold' },
        value === null || value === undefined ? '—' : pct(value)),
      size > 120 ? h('span', { class: `mx-auto mt-1 text-xs leading-tight text-muted ${size >= 180 ? 'max-w-[7.5rem]' : 'max-w-[5.5rem]'}` },
        value === null || value === undefined ? 'no doses due yet' : label) : null),
    h('span', { class: 'sr-only' }, `${pct(value)} ${label}`));
}

async function download(path, fallbackName) {
  try {
    const res = await api(path, { raw: true });
    const blob = await res.blob();
    const match = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '');
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: match ? match[1] : fallbackName });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Export downloaded. This export is recorded in the access log.');
  } catch (err) {
    if (err.status !== 401) toast(err.message);
  }
}

function query(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== '' && v !== null && v !== undefined) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : '';
}

// ---------------------------------------------------------------- layout

function navLink(href, label, current) {
  const active = current === href;
  return h('a', {
    href, 'aria-current': active ? 'page' : null,
    class: `block rounded-md px-3 py-2 ${active ? 'bg-sage-soft font-bold text-sage-dark' : 'text-ink hover:bg-white'}`,
  }, label);
}

function shell(current, content) {
  const s = session.get();
  const user = s && s.user;
  const nav = h('nav', { 'aria-label': 'Main', class: 'space-y-1' },
    navLink('#/overview', 'Overview', current),
    navLink('#/patients', 'Patients', current),
    navLink('#/accounts', 'All accounts', current),
    navLink('#/access-log', 'Access log', current));
  const signOut = h('button', {
    class: 'text-left text-sm text-muted underline-offset-2 hover:text-ink hover:underline',
    onclick: async () => {
      try { await api('/auth/sign-out', { method: 'POST', retry: false }); } catch { /* already ended */ }
      session.clear();
      go('#/sign-in', 'You are signed out.');
    },
  }, 'Sign out');

  return h('div', { class: 'min-h-screen md:grid md:grid-cols-[15rem_1fr]' },
    h('aside', { class: 'border-b border-rule bg-paper px-4 py-4 md:sticky md:top-0 md:h-screen md:border-b-0 md:border-r md:py-8' },
      h('div', { class: 'flex items-center gap-2 px-3' }, brandMark(), h('span', { class: 'text-lg font-bold' }, 'CareCircle')),
      h('div', { class: 'mt-4 md:mt-8' }, nav),
      user ? h('div', { class: 'mt-4 border-t border-rule px-3 pt-4 md:absolute md:bottom-8 md:w-[13rem]' },
        h('p', { class: 'font-bold' }, user.name),
        h('p', { class: 'text-sm text-muted' }, user.role === 'admin' ? 'Administrator' : 'Supervisor, read only'),
        h('div', { class: 'mt-2' }, signOut)) : null),
    h('main', { id: 'main', tabindex: '-1', class: 'mx-auto w-full max-w-6xl px-4 py-8 md:px-10' }, content));
}

function brandMark() {
  const box = svg('svg', { width: 22, height: 22, viewBox: '0 0 22 22', 'aria-hidden': 'true' });
  box.append(svg('circle', { cx: 11, cy: 11, r: 8, fill: 'none', stroke: '#2E6A5C', 'stroke-width': 4 }));
  return box;
}

function pageTitle(text, ...after) {
  return h('header', { class: 'mb-8 flex flex-wrap items-end justify-between gap-4' },
    h('h1', { class: 'text-3xl font-bold tracking-tight' }, text), ...after);
}

const inputClass = 'rounded-md border border-rule bg-white px-3 py-2 text-ink';
const buttonClass = 'rounded-md border border-rule bg-white px-3 py-2 font-bold hover:border-sage hover:text-sage-dark';

// ---------------------------------------------------------------- pages

function signInPage(notice) {
  const email = h('input', { id: 'email', type: 'email', required: true, autocomplete: 'username', class: `${inputClass} w-full` });
  const password = h('input', { id: 'password', type: 'password', required: true, autocomplete: 'current-password', class: `${inputClass} w-full` });
  const message = h('p', { role: 'alert', class: 'min-h-[1.5rem] text-sm text-missed' });
  const submit = h('button', { type: 'submit', class: 'w-full rounded-md bg-sage px-4 py-2.5 font-bold text-white hover:bg-sage-dark' }, 'Sign in');

  const form = h('form', {
    class: 'mt-8 space-y-4', novalidate: true,
    onsubmit: async (event) => {
      event.preventDefault();
      message.textContent = '';
      if (!email.value || !password.value) { message.textContent = 'Enter your email and password.'; return; }
      submit.disabled = true;
      submit.textContent = 'Signing in…';
      try {
        const res = await fetch(`${API}/auth/sign-in`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.value, password: password.value }),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new ApiError(res.status, body);
        if (!['admin', 'supervisor'].includes(body.user.role)) {
          // Not staff: end that session straight away.
          await fetch(`${API}/auth/sign-out`, { method: 'POST', headers: { Authorization: `Bearer ${body.accessToken}` } });
          throw new Error('This panel is for supervisors and administrators. Patients and caregivers use the CareCircle app.');
        }
        session.set(body);
        go('#/overview');
      } catch (err) {
        message.textContent = err instanceof TypeError ? `Cannot reach the API at ${API}. Is it running?` : err.message;
      } finally {
        submit.disabled = false;
        submit.textContent = 'Sign in';
      }
    },
  },
  h('div', { class: 'space-y-1' }, h('label', { for: 'email', class: 'font-bold' }, 'Email'), email),
  h('div', { class: 'space-y-1' }, h('label', { for: 'password', class: 'font-bold' }, 'Password'), password),
  message, submit);

  return h('main', { id: 'main', class: 'grid min-h-screen place-items-center px-4' },
    h('div', { class: 'w-full max-w-sm' },
      h('div', { class: 'flex items-center gap-2' }, brandMark(), h('span', { class: 'text-lg font-bold' }, 'CareCircle')),
      h('h1', { class: 'mt-8 text-3xl font-bold tracking-tight' }, 'Sign in to the admin panel'),
      h('p', { class: 'mt-2 text-muted' }, 'For supervisors and administrators. Every patient record you open is recorded in the access log.'),
      notice ? h('p', { role: 'status', class: 'mt-6 rounded-md bg-sage-soft px-4 py-3 text-sage-dark' }, notice) : null,
      form));
}

async function overviewPage(root) {
  const data = await api(`/admin/overview${query({ timezone: TZ })}`);
  const t = data.remindersToday;
  const parts = [['taken', t.taken], ['due', t.due], ['missed', t.missed], ['upcoming', t.upcoming]];
  const bar = h('div', { class: 'flex h-3 w-full overflow-hidden rounded-full bg-rule', role: 'img',
    'aria-label': parts.map(([k, n]) => `${n} ${STATUS_LABEL[k].toLowerCase()}`).join(', ') },
  t.total ? parts.filter(([, n]) => n).map(([k, n]) => h('span', {
    class: { taken: 'bg-taken', due: 'bg-due', missed: 'bg-missed', upcoming: 'bg-upcoming/40' }[k],
    style: `width:${(n / t.total) * 100}%`,
  })) : null);

  const figure = (n, label) => h('div', {},
    h('dd', { class: 'text-3xl font-bold' }, n), h('dt', { class: 'text-muted' }, label));

  root.replaceChildren(shell('#/overview', [
    pageTitle('Overview', h('p', { class: 'text-muted' }, `Times shown in ${TZ}`)),
    h('section', { class: 'grid gap-10 border-b border-rule pb-10 md:grid-cols-[auto_1fr] md:items-center' },
      ring(data.adherenceLast7Days, 196),
      h('div', {},
        h('h2', { class: 'text-xl font-bold' }, "Today's doses"),
        h('p', { class: 'mt-1 text-muted' }, t.total ? `${t.total} scheduled across all patients.` : 'No doses are scheduled today.'),
        h('div', { class: 'mt-5' }, bar),
        h('ul', { class: 'mt-4 flex flex-wrap gap-x-6 gap-y-2' },
          parts.map(([k, n]) => h('li', {}, h('span', { class: `font-bold ${STATUS_CLASS[k]}` }, n), ' ', STATUS_LABEL[k].toLowerCase()))),
        t.missed ? h('p', { class: 'mt-4' }, h('a', { href: '#/patients', class: 'text-sage-dark underline underline-offset-2' },
          'Find the patients with missed doses')) : null)),
    h('dl', { class: 'grid grid-cols-2 gap-8 pt-10 md:grid-cols-4' },
      figure(data.patients, 'active patients'),
      figure(data.caregivers, 'active caregivers'),
      figure(data.activeLinks, 'caregiver links'),
      figure(data.entriesLast7Days, 'records written this week')),
  ]));
}

async function peoplePage(root, { role, title, route }) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const state = { q: params.get('q') || '', page: Number(params.get('page')) || 1, role: role || params.get('role') || '' };
  const me = session.get().user;

  const search = h('input', { type: 'search', value: state.q, placeholder: 'Search by name or email',
    'aria-label': 'Search by name or email', class: `${inputClass} w-full sm:w-80` });
  const roleSelect = role ? null : h('select', { 'aria-label': 'Role', class: inputClass },
    [['', 'All roles'], ['patient', 'Patients'], ['caregiver', 'Caregivers'], ['supervisor', 'Supervisors'], ['admin', 'Admins']]
      .map(([v, l]) => h('option', { value: v, selected: v === state.role ? true : null }, l)));
  const tableHost = h('div', { class: 'mt-6' }, loading());

  const apply = () => go(`${route}${query({ q: search.value.trim(), role: roleSelect ? roleSelect.value : '', page: 1 })}`);
  const form = h('form', { role: 'search', class: 'flex flex-wrap gap-3',
    onsubmit: (e) => { e.preventDefault(); apply(); } },
  search, roleSelect, h('button', { class: buttonClass }, 'Search'));
  if (roleSelect) roleSelect.addEventListener('change', apply);

  root.replaceChildren(shell(route, [pageTitle(title), form, tableHost]));

  try {
    const data = await api(`/admin/users${query({ role: state.role, q: state.q, page: state.page, pageSize: 25 })}`);
    if (!data.items.length) {
      tableHost.replaceChildren(h('p', { class: 'py-10 text-muted' },
        state.q ? `No one matches "${state.q}". Check the spelling or search by email.` : 'No accounts yet.'));
      return;
    }
    const rows = data.items.map((u) => {
      const nameCell = u.role === 'patient'
        ? h('a', { href: `#/patients/${u.id}`, class: 'font-bold text-sage-dark underline-offset-2 hover:underline' }, u.name)
        : h('span', { class: 'font-bold' }, u.name);
      let actionCell = null;
      if (me.role === 'admin' && u.id !== me.id) {
        actionCell = h('button', {
          class: 'text-sm underline underline-offset-2 hover:text-sage-dark',
          onclick: async () => {
            const turningOff = u.isActive;
            const ok = await confirmAction(
              turningOff ? `Turn off ${u.name}'s account?` : `Turn on ${u.name}'s account?`,
              turningOff ? 'They are signed out everywhere at once and cannot sign in until the account is turned back on.'
                : 'They will be able to sign in again.',
              turningOff ? 'Turn off account' : 'Turn on account');
            if (!ok) return;
            try {
              await api(`/admin/users/${u.id}`, { method: 'PATCH', body: { isActive: !u.isActive } });
              toast(turningOff ? `${u.name}'s account is turned off.` : `${u.name}'s account is turned on.`);
              render();
            } catch (err) { toast(err.message); }
          },
        }, u.isActive ? 'Turn off' : 'Turn on');
      }
      return h('tr', { class: 'border-t border-rule' },
        h('td', { class: 'py-3 pr-4' }, nameCell),
        h('td', { class: 'py-3 pr-4 text-muted' }, u.email),
        role ? null : h('td', { class: 'py-3 pr-4 capitalize' }, u.role),
        h('td', { class: 'py-3 pr-4' }, u.isActive ? 'Active' : h('span', { class: 'text-missed' }, 'Turned off')),
        h('td', { class: 'py-3 pr-4 text-muted' }, fmtDate(u.createdAt.slice(0, 10))),
        me.role === 'admin' ? h('td', { class: 'py-3 text-right' }, actionCell) : null);
    });
    const head = ['Name', 'Email', role ? null : 'Role', 'Status', 'Joined', me.role === 'admin' ? '' : null].filter((x) => x !== null);
    tableHost.replaceChildren(
      h('div', { class: 'overflow-x-auto' }, h('table', { class: 'w-full text-left' },
        h('thead', {}, h('tr', { class: 'text-sm text-muted' }, head.map((c) => h('th', { scope: 'col', class: 'pb-2 pr-4 font-normal' }, c)))),
        h('tbody', {}, rows))),
      pager(data, (page) => go(`${route}${query({ q: state.q, role: roleSelect ? state.role : '', page })}`)));
  } catch (err) {
    if (err.status !== 401) tableHost.replaceChildren(errorBox(err));
  }
}

function pager(data, goTo) {
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  if (pages === 1) return h('p', { class: 'mt-4 text-sm text-muted' }, `${data.total} shown`);
  return h('nav', { 'aria-label': 'Pages', class: 'mt-6 flex items-center gap-4' },
    h('button', { class: buttonClass, disabled: data.page <= 1 ? true : null, onclick: () => goTo(data.page - 1) }, 'Previous'),
    h('span', { class: 'text-muted' }, `Page ${data.page} of ${pages} (${data.total} total)`),
    h('button', { class: buttonClass, disabled: data.page >= pages ? true : null, onclick: () => goTo(data.page + 1) }, 'Next'));
}

async function patientPage(root, patientId, tab) {
  const detail = await api(`/admin/patients/${encodeURIComponent(patientId)}`);
  const p = detail.patient;
  const tabs = [['records', 'Records'], ['reminders', 'Reminders'], ['documents', 'Documents']];
  const body = h('section', { class: 'mt-6' }, loading());

  const tabNav = h('nav', { 'aria-label': 'Patient data', class: 'mt-10 flex gap-6 border-b border-rule' },
    tabs.map(([key, label]) => h('a', {
      href: `#/patients/${p.id}/${key}`, 'aria-current': tab === key ? 'page' : null,
      class: `-mb-px border-b-2 pb-3 ${tab === key ? 'border-sage font-bold text-sage-dark' : 'border-transparent text-muted hover:text-ink'}`,
    }, label)));

  const facts = h('dl', { class: 'grid gap-x-10 gap-y-4 sm:grid-cols-2' },
    fact('Email', p.email),
    fact('Time zone', p.timezone),
    fact('Caregivers', detail.caregivers.length ? detail.caregivers.map((c) => c.name).join(', ') : 'None linked'),
    fact('Medicines', detail.medicines.length
      ? detail.medicines.map((m) => `${m.name} at ${m.times.join(', ')}${m.stoppedAt ? ` (stopped ${fmtDateTime(m.stoppedAt)})`
        : m.endDate ? ` (until ${fmtDate(m.endDate)})` : ''}`).join('; ')
      : 'None added'),
    fact('Records', String(detail.entriesTotal)),
    fact('Account', p.isActive ? 'Active' : 'Turned off'));

  root.replaceChildren(shell('#/patients', [
    h('p', { class: 'mb-4' }, h('a', { href: '#/patients', class: 'text-muted underline-offset-2 hover:underline' }, 'All patients')),
    h('div', { class: 'grid gap-8 md:grid-cols-[1fr_auto] md:items-start' },
      h('div', {}, h('h1', { class: 'text-3xl font-bold tracking-tight' }, p.name), h('div', { class: 'mt-6' }, facts)),
      ring(detail.adherenceLast7Days, 150)),
    tabNav, body]));

  try {
    if (tab === 'reminders') await remindersTab(body, p);
    else if (tab === 'documents') await documentsTab(body, p);
    else await recordsTab(body, p);
  } catch (err) {
    if (err.status !== 401) body.replaceChildren(errorBox(err));
  }
}

function fact(label, value) {
  return h('div', {}, h('dt', { class: 'text-sm text-muted' }, label), h('dd', { class: 'mt-0.5' }, value));
}

function dateFilters(prefix, values, onApply, extra) {
  const from = h('input', { type: 'date', value: values.from || '', id: `${prefix}-from`, class: inputClass });
  const to = h('input', { type: 'date', value: values.to || '', id: `${prefix}-to`, class: inputClass });
  const form = h('form', { class: 'flex flex-wrap items-end gap-3', onsubmit: (e) => { e.preventDefault(); onApply({ from: from.value, to: to.value, ...(extra ? extra.read() : {}) }); } },
    extra ? extra.el : null,
    h('div', { class: 'flex flex-col gap-1' }, h('label', { for: `${prefix}-from`, class: 'text-sm text-muted' }, 'From'), from),
    h('div', { class: 'flex flex-col gap-1' }, h('label', { for: `${prefix}-to`, class: 'text-sm text-muted' }, 'To'), to),
    h('button', { class: buttonClass }, 'Apply'));
  return form;
}

function hashParams() {
  return Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''));
}

async function recordsTab(host, p) {
  const f = hashParams();
  const kind = h('select', { id: 'kind', class: inputClass },
    [['', 'All kinds'], ...Object.entries(KIND_LABEL)].map(([v, l]) => h('option', { value: v, selected: v === (f.kind || '') ? true : null }, l)));
  const filters = dateFilters('rec', f, (v) => go(`#/patients/${p.id}/records${query(v)}`), {
    el: h('div', { class: 'flex flex-col gap-1' }, h('label', { for: 'kind', class: 'text-sm text-muted' }, 'Kind'), kind),
    read: () => ({ kind: kind.value }),
  });
  const params = query({ kind: f.kind, from: f.from, to: f.to });
  const exportButton = h('button', { class: buttonClass,
    onclick: () => download(`/admin/patients/${p.id}/entries.csv${params}`, 'records.csv') }, 'Export CSV');

  const entries = await api(`/admin/patients/${p.id}/entries${params}`);
  const list = entries.length ? h('ol', { class: 'divide-y divide-rule' }, entries.map((e) => h('li', { class: 'py-5' },
    h('div', { class: 'flex flex-wrap items-baseline justify-between gap-2' },
      h('h3', { class: 'font-bold' }, e.title),
      h('span', { class: 'text-sm text-muted' }, fmtDateTime(e.occurredAt))),
    h('p', { class: 'mt-1 text-sm text-muted' },
      `${KIND_LABEL[e.kind]} record by ${e.recordedBy.name} (${e.recordedBy.role})`,
      e.editedAt ? `, edited ${fmtDateTime(e.editedAt)} by ${e.editedBy.name}` : ''),
    e.notes ? h('p', { class: 'mt-2 max-w-prose whitespace-pre-line' }, e.notes) : null,
    h('dl', { class: 'mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm' },
      [['Severity', e.severity], ['Mood', e.mood], ['Medicine', e.medicineName], ['Location', e.location],
        ['Witness', e.witnessName], ['Action taken', e.actionTaken]]
        .filter(([, v]) => v).map(([k, v]) => h('div', { class: 'flex gap-1' }, h('dt', { class: 'text-muted' }, `${k}:`), h('dd', {}, v)))),
    e.photoUri ? h('p', { class: 'mt-2' }, h('a', {
      href: e.photoUri.startsWith('http') ? e.photoUri : `${API}${e.photoUri}`, target: '_blank', rel: 'noopener noreferrer',
      class: 'text-sm text-sage-dark underline underline-offset-2' }, 'Open photo (link works for a few minutes)')) : null)))
    : h('p', { class: 'py-10 text-muted' }, f.kind || f.from || f.to ? 'No records match these filters.' : 'No written records yet.');

  host.replaceChildren(h('div', { class: 'flex flex-wrap items-end justify-between gap-4' }, filters, exportButton),
    h('div', { class: 'mt-6' }, list));
}

async function remindersTab(host, p) {
  const f = hashParams();
  const params = query({ from: f.from, to: f.to });
  const filters = dateFilters('rem', f, (v) => go(`#/patients/${p.id}/reminders${query(v)}`));
  const exportButton = h('button', { class: buttonClass,
    onclick: () => download(`/admin/patients/${p.id}/reminders.csv${params}`, 'reminders.csv') }, 'Export CSV');
  const reminders = await api(`/admin/patients/${p.id}/reminders${params}`);
  const table = reminders.length ? h('div', { class: 'overflow-x-auto' }, h('table', { class: 'w-full text-left' },
    h('thead', {}, h('tr', { class: 'text-sm text-muted' }, ['Scheduled', 'Medicine', 'Status', 'Confirmed']
      .map((c) => h('th', { scope: 'col', class: 'pb-2 pr-4 font-normal' }, c)))),
    h('tbody', {}, reminders.map((r) => h('tr', { class: 'border-t border-rule' },
      h('td', { class: 'py-3 pr-4' }, fmtDateTime(r.scheduledAt)),
      h('td', { class: 'py-3 pr-4' }, r.medicineName),
      h('td', { class: `py-3 pr-4 font-bold ${STATUS_CLASS[r.status]}` }, STATUS_LABEL[r.status]),
      h('td', { class: 'py-3 pr-4 text-muted' }, r.acknowledgedAt ? fmtDateTime(r.acknowledgedAt) : '—'))))))
    : h('p', { class: 'py-10 text-muted' }, 'No reminders in this period.');
  host.replaceChildren(h('div', { class: 'flex flex-wrap items-end justify-between gap-4' }, filters, exportButton),
    h('div', { class: 'mt-6' }, table));
}

async function documentsTab(host, p) {
  const docs = await api(`/admin/patients/${p.id}/documents`);
  host.replaceChildren(docs.length ? h('ul', { class: 'divide-y divide-rule' }, docs.map((d) => h('li', { class: 'flex flex-wrap justify-between gap-2 py-4' },
    h('span', {}, h('span', { class: 'font-bold' }, d.title), h('span', { class: 'ml-3 text-sm text-muted' }, CATEGORY_LABEL[d.category] || d.category)),
    h('span', { class: 'text-muted' }, fmtDate(d.recordedOn)))))
    : h('p', { class: 'py-10 text-muted' }, 'No documents for this patient.'));
}

async function accessLogPage(root) {
  const f = hashParams();
  const page = Number(f.page) || 1;
  const outcome = h('select', { 'aria-label': 'Outcome', class: inputClass },
    [['', 'Everything'], ['allowed', 'Allowed only'], ['denied', 'Refused only']]
      .map(([v, l]) => h('option', { value: v, selected: v === (f.outcome || '') ? true : null }, l)));
  outcome.addEventListener('change', () => go(`#/access-log${query({ outcome: outcome.value, patientId: f.patientId })}`));
  const host = h('div', { class: 'mt-6' }, loading());
  root.replaceChildren(shell('#/access-log', [
    pageTitle('Access log', outcome),
    h('p', { class: 'max-w-prose text-muted' }, 'Every time a caregiver, supervisor or admin looks at a patient\'s data, a line is added here. Lines cannot be edited or deleted.'),
    host]));
  try {
    const data = await api(`/admin/access-log${query({ outcome: f.outcome, patientId: f.patientId, page, pageSize: 50 })}`);
    if (!data.items.length) { host.replaceChildren(h('p', { class: 'py-10 text-muted' }, 'Nothing recorded yet.')); return; }
    host.replaceChildren(h('div', { class: 'overflow-x-auto' }, h('table', { class: 'w-full text-left' },
      h('thead', {}, h('tr', { class: 'text-sm text-muted' }, ['When', 'Who', 'What', 'Patient']
        .map((c) => h('th', { scope: 'col', class: 'pb-2 pr-4 font-normal' }, c)))),
      h('tbody', {}, data.items.map((row) => h('tr', { class: 'border-t border-rule align-top' },
        h('td', { class: 'py-3 pr-4 whitespace-nowrap' }, fmtDateTime(row.at)),
        h('td', { class: 'py-3 pr-4' }, row.viewer.name, h('span', { class: 'block text-sm capitalize text-muted' }, row.viewer.role)),
        h('td', { class: `py-3 pr-4 ${row.outcome === 'denied' ? 'text-missed' : ''}` },
          ACTION_LABEL[row.action] || row.action, row.outcome === 'denied' ? ' (refused)' : ''),
        h('td', { class: 'py-3 pr-4' }, row.patient
          ? (row.patient.role === 'patient'
            ? h('a', { href: `#/patients/${row.patient.id}`, class: 'text-sage-dark underline-offset-2 hover:underline' }, row.patient.name)
            : row.patient.name)
          : h('span', { class: 'text-muted' }, '—'))))))),
    pager(data, (n) => go(`#/access-log${query({ outcome: f.outcome, patientId: f.patientId, page: n })}`)));
  } catch (err) {
    if (err.status !== 401) host.replaceChildren(errorBox(err));
  }
}

// ---------------------------------------------------------------- router

let pendingNotice = null;

function go(hash, notice) {
  if (notice) pendingNotice = notice;
  if (location.hash === hash) render(); else location.hash = hash;
}

async function render() {
  const root = document.getElementById('app');
  const path = (location.hash.slice(1) || '/overview').split('?')[0];
  const signedIn = Boolean(session.get());

  if (path === '/sign-in' || !signedIn) {
    const notice = pendingNotice;
    pendingNotice = null;
    root.replaceChildren(signInPage(notice));
    if (path !== '/sign-in') history.replaceState(null, '', '#/sign-in');
    document.getElementById('email').focus();
    return;
  }

  root.replaceChildren(shell(path, loading()));
  try {
    const patient = /^\/patients\/([0-9a-f-]{36})(?:\/(records|reminders|documents))?$/i.exec(path);
    if (path === '/overview') await overviewPage(root);
    else if (path === '/patients') await peoplePage(root, { role: 'patient', title: 'Patients', route: '#/patients' });
    else if (path === '/accounts') await peoplePage(root, { title: 'All accounts', route: '#/accounts' });
    else if (path === '/access-log') await accessLogPage(root);
    else if (patient) await patientPage(root, patient[1], patient[2] || 'records');
    else root.replaceChildren(shell(path, [pageTitle('Page not found'), h('a', { href: '#/overview', class: 'underline' }, 'Go to the overview')]));
  } catch (err) {
    if (err.status === 401) return;
    const message = err.status === 404 ? 'This patient does not exist, or the link is wrong.' : err.message;
    root.replaceChildren(shell(path, [pageTitle('Could not load this page'), errorBox({ message })]));
  }
  const main = document.getElementById('main');
  if (main && document.activeElement === document.body) main.focus({ preventScroll: true });
}

window.addEventListener('hashchange', render);
render();
