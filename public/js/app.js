const $ = id => document.getElementById(id);
const token = localStorage.getItem('token');
if (!token) location.href = '/index.html';

let user = JSON.parse(localStorage.getItem('user') || '{}');
let config = { departments: [], leaveTypes: [] };
let view = 'dashboard';
let charts = [];
let filter = 'All';

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = d => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtShort = d => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const range = l => `${fmtShort(l.fromDate)} — ${fmt(l.toDate)}`;

async function api(url, opts = {}) {
  opts.headers = Object.assign({ Authorization: 'Bearer ' + token }, opts.headers || {});
  if (opts.body && !(opts.body instanceof FormData)) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  const r = await fetch(url, opts);
  if (r.status === 401) { signOut(); throw new Error('Session expired'); }
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d.error || 'Something went wrong.');
  }
  return r;
}
const getJSON = async url => (await api(url)).json();

function signOut() { localStorage.clear(); location.href = '/index.html'; }

function toast(text) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

async function download(url, name) {
  try {
    const blob = await (await api(url)).blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  } catch (e) { toast(e.message); }
}

// ---------- navigation ----------
const NAV = {
  student: [['dashboard', '▦', 'Dashboard'], ['apply', '📝', 'Apply Leave'], ['history', '🕘', 'Leave History'], ['report', '⬇', 'Download Report'], ['notifications', '🔔', 'Notifications'], ['profile', '👤', 'Profile']],
  faculty: [['dashboard', '▦', 'Dashboard'], ['history', '🕘', 'Leave Requests'], ['report', '⬇', 'Download Report'], ['notifications', '🔔', 'Notifications'], ['profile', '👤', 'Profile']],
  admin: [['dashboard', '▦', 'Dashboard'], ['history', '🕘', 'Leave History'], ['report', '⬇', 'Download Report'], ['notifications', '🔔', 'Notifications'], ['profile', '👤', 'Profile']]
};

function buildNav() {
  $('nav').innerHTML = NAV[user.role].map(([id, ico, label]) =>
    `<button data-v="${id}" class="${id === view ? 'active' : ''}"><span>${ico}</span>${label}${id === 'notifications' ? '<span class="count hidden" id="navCount"></span>' : ''}</button>`).join('');
  $('nav').querySelectorAll('button').forEach(b => b.onclick = () => go(b.dataset.v));
}

function go(v) {
  if (v === 'report') { download('/api/report', 'leave-report.csv'); toast('Report downloaded'); return; }
  view = v; filter = 'All'; $('search').value = '';
  $('sidebar').classList.remove('open');
  buildNav(); render(); refreshBell();
}

function fillUser() {
  $('portal').textContent = { student: 'Student Portal', faculty: 'Faculty Portal', admin: 'Admin Portal' }[user.role];
  $('sName').textContent = user.name; $('sEmail').textContent = user.email;
  $('avatar').textContent = (user.name || '?')[0].toUpperCase();
  $('tName').textContent = user.name; $('tRole').textContent = user.role;
}

async function refreshBell() {
  try {
    const { unread } = await getJSON('/api/notifications');
    $('bellDot').textContent = unread; $('bellDot').classList.toggle('hidden', !unread);
    const c = $('navCount'); if (c) { c.textContent = unread; c.classList.toggle('hidden', !unread); }
  } catch {}
}

// ---------- small renderers ----------
const badge = s => `<span class="badge ${s}">${s === 'Pending' ? '⏱ ' : s === 'Approved' ? '✔ ' : '✖ '}${s}</span>`;
const head = (t, s) => `<div class="page-head"><h1>${t}</h1><p>${s}</p></div>`;
const stat = (label, n, ico, bg, fg) =>
  `<div class="card stat"><div><div class="label">${label}</div><div class="num">${n}</div></div><div class="ico" style="background:${bg};color:${fg}">${ico}</div></div>`;

function destroyCharts() { charts.forEach(c => c.destroy()); charts = []; }

function reqRow(l, showStudent) {
  return `<div class="req data-row" data-text="${esc((l.studentName + ' ' + l.type + ' ' + l.status + ' ' + l.reason).toLowerCase())}">
    <div><b>${esc(showStudent ? l.studentName : l.type)}</b><small>${range(l)}${showStudent ? ' · ' + esc(l.department) : ''}</small></div>
    <div class="badges">${showStudent ? `<span class="badge type">${esc(l.type)}</span>` : ''}${badge(l.status)}</div></div>`;
}

// ---------- views ----------
async function render() {
  destroyCharts();
  const el = $('view');
  el.innerHTML = '<div class="empty">Loading...</div>';
  try {
    if (view === 'dashboard') return await ({ student: studentDash, faculty: facultyDash, admin: adminDash }[user.role])(el);
    if (view === 'apply') return applyView(el);
    if (view === 'history') return await historyView(el);
    if (view === 'notifications') return await notifView(el);
    if (view === 'profile') return profileView(el);
  } catch (e) { el.innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
}

async function studentDash(el) {
  const [s, { leaves }] = await Promise.all([getJSON('/api/stats'), getJSON('/api/leaves')]);
  el.innerHTML = head('Student Dashboard', `Welcome back, ${esc(user.name)} · ${esc(user.department)}`) +
    `<div class="grid stats">
      ${stat('Total Leaves', s.total, '📄', '#dcfce7', '#16a34a')}
      ${stat('Pending', s.pending, '⏱', '#fef3c7', '#d97706')}
      ${stat('Approved', s.approved, '✔', '#dcfce7', '#16a34a')}
      ${stat('Rejected', s.rejected, '✖', '#fee2e2', '#dc2626')}
    </div>
    <div class="card" style="margin-top:16px">
      <div class="head-row"><h3>Recent Requests</h3><button class="link" onclick="go('history')">View All →</button></div>
      ${leaves.slice(0, 5).map(l => reqRow(l, false)).join('') || '<div class="empty">No leave requests yet. Click “Apply Leave” to create one.</div>'}
    </div>
    <p><button class="btn" style="margin-top:16px" onclick="go('apply')">+ Apply for Leave</button></p>`;
}

async function facultyDash(el) {
  const [s, { leaves }] = await Promise.all([getJSON('/api/stats'), getJSON('/api/leaves')]);
  const pending = leaves.filter(l => l.status === 'Pending');
  el.innerHTML = head('Faculty Dashboard', `Leave requests from ${esc(user.department)} students`) +
    `<div class="grid stats">
      ${stat('Total Requests', s.total, '📄', '#eef2ff', '#4338ca')}
      ${stat('Pending Review', s.pending, '⏱', '#fef3c7', '#d97706')}
      ${stat('Approved', s.approved, '✔', '#dcfce7', '#16a34a')}
      ${stat('Rejected', s.rejected, '✖', '#fee2e2', '#dc2626')}
    </div>
    <div class="card" style="margin-top:16px">
      <div class="head-row"><h3>Pending Review</h3><button class="link" onclick="go('history')">View All →</button></div>
      ${pending.length ? tableHTML(pending, true) : '<div class="empty">🎉 No pending requests.</div>'}
    </div>`;
}

async function adminDash(el) {
  const [s, { leaves }] = await Promise.all([getJSON('/api/stats'), getJSON('/api/leaves')]);
  el.innerHTML = head('Admin Dashboard', 'System overview and analytics') +
    `<div class="grid stats">
      ${stat('Students', s.students, '🎓', '#eef2ff', '#4338ca')}
      ${stat('Faculty', s.faculty, '👩‍🏫', '#e0f2fe', '#0369a1')}
      ${stat('Departments', s.departments, '🏢', '#f3e8ff', '#7e22ce')}
      ${stat('Total Leaves', s.total, '📄', '#dcfce7', '#16a34a')}
      ${stat('Pending', s.pending, '⏱', '#fef3c7', '#d97706')}
    </div>
    <div class="grid two">
      <div class="card"><h3>Leave Types Distribution</h3><div class="chart-box"><canvas id="c1"></canvas></div></div>
      <div class="card"><h3>Status Overview</h3><div class="chart-box"><canvas id="c2"></canvas></div></div>
    </div>
    <div class="card">
      <div class="head-row"><h3>Recent Requests</h3><button class="link" onclick="go('history')">View All →</button></div>
      ${leaves.slice(0, 5).map(l => reqRow(l, true)).join('') || '<div class="empty">No requests yet.</div>'}
    </div>`;
  const types = config.leaveTypes;
  charts.push(new Chart($('c1'), {
    type: 'bar',
    data: { labels: types.map(t => t.replace(' Leave', '')), datasets: [{ data: types.map(t => s.byType[t] || 0), backgroundColor: '#4338ca', borderRadius: 6, maxBarThickness: 70 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
  }));
  charts.push(new Chart($('c2'), {
    type: 'doughnut',
    data: { labels: [`Pending (${s.pending})`, `Approved (${s.approved})`, `Rejected (${s.rejected})`], datasets: [{ data: [s.pending, s.approved, s.rejected], backgroundColor: ['#4338ca', '#16a34a', '#dc2626'], borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'bottom' } } }
  }));
}

function applyView(el) {
  const today = new Date().toISOString().slice(0, 10);
  el.innerHTML = head('Apply for Leave', 'Fill in the details and submit for faculty approval') +
    `<form class="card" id="applyForm" style="max-width:720px">
      <label>Leave Type</label>
      <select id="lType">${config.leaveTypes.map(t => `<option>${t}</option>`).join('')}</select>
      <div class="form-grid">
        <div><label>From Date</label><input type="date" id="lFrom" min="${today}" value="${today}" required></div>
        <div><label>To Date</label><input type="date" id="lTo" min="${today}" value="${today}" required></div>
      </div>
      <label>Reason for Leave</label>
      <textarea id="lReason" placeholder="Explain why you need this leave..." required></textarea>
      <label>Upload PDF / Document (optional)</label>
      <div class="file-drop"><input type="file" id="lFile" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"><br><small style="color:var(--muted)">PDF, DOC, DOCX, JPG or PNG · max 5 MB</small></div>
      <div id="applyMsg"></div>
      <div style="margin-top:18px;display:flex;gap:10px">
        <button class="btn" id="applyBtn">Submit Request</button>
        <button type="button" class="btn outline" onclick="go('dashboard')">Cancel</button>
      </div>
    </form>`;
  $('lFrom').onchange = () => { $('lTo').min = $('lFrom').value; if ($('lTo').value < $('lFrom').value) $('lTo').value = $('lFrom').value; };
  $('applyForm').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData();
    fd.append('type', $('lType').value); fd.append('fromDate', $('lFrom').value);
    fd.append('toDate', $('lTo').value); fd.append('reason', $('lReason').value);
    if ($('lFile').files[0]) fd.append('document', $('lFile').files[0]);
    $('applyBtn').disabled = true;
    try {
      await api('/api/leaves', { method: 'POST', body: fd });
      toast('Leave request submitted ✔'); go('history');
    } catch (err) {
      $('applyMsg').innerHTML = `<div class="msg err">${esc(err.message)}</div>`;
      $('applyBtn').disabled = false;
    }
  };
}

function tableHTML(list, withActions) {
  const isReviewer = user.role !== 'student';
  return `<div class="table-wrap"><table><thead><tr>
    ${isReviewer ? '<th>Student</th>' : ''}<th>Type</th><th>Dates</th><th>Reason</th><th>Document</th><th>Status</th>${withActions ? '<th>Action</th>' : ''}
  </tr></thead><tbody>${list.map(l => `<tr class="data-row" data-text="${esc((l.studentName + ' ' + l.type + ' ' + l.status + ' ' + l.reason).toLowerCase())}">
    ${isReviewer ? `<td><b>${esc(l.studentName)}</b><br><small style="color:var(--muted)">${esc(l.department)}</small></td>` : ''}
    <td><span class="badge type">${esc(l.type)}</span></td>
    <td>${range(l)}</td>
    <td style="max-width:260px">${esc(l.reason)}${l.remark ? `<br><small style="color:var(--muted)">Remark: ${esc(l.remark)}</small>` : ''}</td>
    <td>${l.hasDocument ? `<a href="#" onclick="download('/api/leaves/${l.id}/document','${esc(l.documentName).replace(/'/g, '')}');return false">📎 View</a>` : '—'}</td>
    <td>${badge(l.status)}</td>
    ${withActions ? `<td>${l.status === 'Pending' ? `<div class="actions"><button class="btn green sm" onclick="review(${l.id},'Approved')">Approve</button><button class="btn red sm" onclick="review(${l.id},'Rejected')">Reject</button></div>` : '—'}</td>` : ''}
  </tr>`).join('')}</tbody></table></div>`;
}

async function historyView(el) {
  const { leaves } = await getJSON('/api/leaves');
  const canReview = user.role !== 'student';
  const title = user.role === 'student' ? 'Leave History' : user.role === 'faculty' ? 'Leave Requests' : 'Leave History';
  const sub = user.role === 'student' ? 'All your leave applications' : user.role === 'faculty' ? `Review requests from ${esc(user.department)}` : 'All leave requests in the system';
  const list = filter === 'All' ? leaves : leaves.filter(l => l.status === filter);
  el.innerHTML = head(title, sub) +
    `<div class="filters">${['All', 'Pending', 'Approved', 'Rejected'].map(f => `<button class="chip ${f === filter ? 'active' : ''}" onclick="setFilter('${f}')">${f}${f === 'All' ? ` (${leaves.length})` : ` (${leaves.filter(l => l.status === f).length})`}</button>`).join('')}</div>
    <div class="card">${list.length ? tableHTML(list, canReview) : '<div class="empty">No requests found.</div>'}</div>`;
}
function setFilter(f) { filter = f; render(); }

let pendingReview = null;
function review(id, status) {
  pendingReview = { id, status };
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal"><h3>${status === 'Approved' ? 'Approve' : 'Reject'} request</h3>
    <p style="color:var(--muted);margin:4px 0 0">Add an optional remark for the student.</p>
    <textarea id="remark" placeholder="Remark (optional)" style="margin-top:12px"></textarea>
    <div style="display:flex;gap:10px;margin-top:16px;justify-content:flex-end">
      <button class="btn outline" id="mCancel">Cancel</button>
      <button class="btn ${status === 'Approved' ? 'green' : 'red'}" id="mOk">Confirm ${status === 'Approved' ? 'Approval' : 'Rejection'}</button></div></div>`;
  document.body.appendChild(bg);
  $('mCancel').onclick = () => bg.remove();
  $('mOk').onclick = async () => {
    try {
      await api('/api/leaves/' + id, { method: 'PATCH', body: { status, remark: $('remark').value } });
      bg.remove(); toast(`Request ${status.toLowerCase()} ✔`); render();
    } catch (e) { bg.remove(); toast(e.message); }
  };
}

async function notifView(el) {
  const { notifications } = await getJSON('/api/notifications');
  el.innerHTML = head('Notifications', 'Updates about your leave requests') +
    `<div class="card">${notifications.map(n => `<div class="notif ${n.read ? '' : 'unread'}"><span class="bullet"></span><div><b>${esc(n.message)}</b><br><small style="color:var(--muted)">${new Date(n.createdAt).toLocaleString('en-IN')}</small></div></div>`).join('') || '<div class="empty">No notifications.</div>'}</div>`;
  await api('/api/notifications/read', { method: 'POST' });
  refreshBell();
}

function profileView(el) {
  el.innerHTML = head('Profile', 'Manage your account details') +
    `<form class="card" id="pForm" style="max-width:560px">
      <label>Full name</label><input id="pName" value="${esc(user.name)}">
      <label>Email</label><input value="${esc(user.email)}" disabled>
      <label>Role</label><input value="${esc(user.role)}" disabled style="text-transform:capitalize">
      ${user.role !== 'admin' ? `<label>Department</label><select id="pDept">${config.departments.map(d => `<option ${d === user.department ? 'selected' : ''}>${d}</option>`).join('')}</select>` : ''}
      <label>Phone</label><input id="pPhone" value="${esc(user.phone)}" placeholder="Phone number">
      <label>${user.provider === 'google' ? 'Set a password (optional)' : 'New password (leave blank to keep)'}</label>
      <input id="pPass" type="password" placeholder="Minimum 6 characters" autocomplete="new-password">
      <div id="pMsg"></div>
      <button class="btn" style="margin-top:18px">Save changes</button>
    </form>`;
  $('pForm').onsubmit = async e => {
    e.preventDefault();
    try {
      const body = { name: $('pName').value, phone: $('pPhone').value, newPassword: $('pPass').value };
      if ($('pDept')) body.department = $('pDept').value;
      const { user: u } = await (await api('/api/me', { method: 'PUT', body })).json();
      user = u; localStorage.setItem('user', JSON.stringify(u)); fillUser();
      $('pMsg').innerHTML = '<div class="msg ok">Profile updated.</div>'; $('pPass').value = '';
    } catch (err) { $('pMsg').innerHTML = `<div class="msg err">${esc(err.message)}</div>`; }
  };
}

// ---------- global handlers ----------
$('signout').onclick = signOut;
$('bell').onclick = () => go('notifications');
$('menu').onclick = () => $('sidebar').classList.toggle('open');
$('theme').onclick = () => {
  document.body.classList.toggle('dark');
  localStorage.setItem('dark', document.body.classList.contains('dark') ? '1' : '');
};
$('search').oninput = e => {
  const q = e.target.value.toLowerCase();
  document.querySelectorAll('.data-row').forEach(r => r.classList.toggle('hidden', !!q && !r.dataset.text.includes(q)));
};

(async function init() {
  if (localStorage.getItem('dark')) document.body.classList.add('dark');
  try {
    config = await (await fetch('/api/config')).json();
    user = (await getJSON('/api/me')).user;
    localStorage.setItem('user', JSON.stringify(user));
  } catch { return; }
  fillUser(); buildNav(); render(); refreshBell();
  setInterval(refreshBell, 30000);
})();
