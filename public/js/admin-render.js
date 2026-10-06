import { api } from './api.js';
import {
  state, replaceState, SHARE_DEFAULT, RATE_DEFAULT, TAX_DEFAULT, OVERVIEW_ID, MONTHLY_ID, JOBS_ID,
  calcWorkerTotals, calcAllWorkersTotals, isWorkerClockedIn, calcEntryRow, findJob,
  groupEntriesByPeriod, currentPeriod, calcAllPeriodsTotals, computePaymentDate,
} from './state.js';
import { fmtCAD, fmtNGN, fmtDuration, fmtClockBoth, fmtDayTZ, fmtWhenCell, fmtPaymentDate, fmtDateLong, escapeHtml, TZ_QC } from './format.js';
import { openModal, modalOpen } from './modal.js';
import {
  saveSettings, fetchExchangeRate, addWorker, addPeriod, updateWorkerShare, resetWorkerPassword,
  addEntryAdmin, deleteEntryAdmin, setEntryPaid, markAllPaid, addPaymentAdmin, deletePaymentAdmin,
  setTimerLogged, deleteWorker, loginAdmin, signupAdmin, addJob, updateJob,
} from './admin-data.js';

let selectedWorkerId = null;
let adminAuthenticated = false;
let pollTimer = null;
let adminWorkerTab = 'overview';
let currentAccountSlug = null;

/* ---------------- Admin: boot + polling ---------------- */

export async function bootAdmin(){
  try{
    const session = await api('/api/admin/session');
    adminAuthenticated = session.authenticated;
    currentAccountSlug = session.slug || null;
  }catch(e){
    adminAuthenticated = false;
  }
  if(!adminAuthenticated){
    renderAdminLogin();
    return;
  }
  await loadAdminState();
}

async function loadAdminState(){
  replaceState(await api('/api/admin/state'));
  if(!state.settings.exchangeManual) fetchExchangeRate();
  render();
  startAdminPolling();
}

function startAdminPolling(){
  stopAdminPolling();
  pollTimer = setInterval(async () => {
    if(modalOpen || !adminAuthenticated) return;
    try{
      replaceState(await api('/api/admin/state'));
      render();
    }catch(e){ /* transient network error, try again next tick */ }
  }, 30000);
}
function stopAdminPolling(){
  if(pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

function renderAdminLogin(mode = 'login', errorMsg){
  stopAdminPolling();
  const isSignup = mode === 'signup';
  document.getElementById('app').innerHTML = `
    <div class="worker-view-wrap">
      <div class="worker-view-card">
        <h2 class="wv-title">${isSignup ? 'Create a profile' : 'Admin sign-in'}</h2>
        <p class="wv-sub">${isSignup ? 'Set up a new, fully separate business profile.' : 'Enter your business handle and password to continue.'}</p>
        ${isSignup ? `
        <div class="field">
          <label>Business name</label>
          <input type="text" id="adminSignupName" autofocus>
        </div>
        <div class="field">
          <label>Business handle</label>
          <input type="text" id="adminSignupSlug" placeholder="your-business">
          <div class="hint">Your worker link will be .../w/your-handle</div>
        </div>
        <div class="field">
          <label>Invite code</label>
          <input type="password" id="adminSignupCode">
        </div>
        <div class="field">
          <label>Password</label>
          <input type="password" id="adminSignupPassword">
        </div>
        <div class="field">
          <label>Confirm password</label>
          <input type="password" id="adminSignupConfirm">
        </div>
        ${errorMsg ? `<p class="error-text">${escapeHtml(errorMsg)}</p>` : ''}
        <button class="btn-primary" id="adminSignupBtn" style="width:100%;">Create profile</button>
        <button class="settings-toggle" id="adminModeToggle" style="margin-top:10px;">← Back to sign in</button>
        ` : `
        <div class="field">
          <label>Business handle</label>
          <input type="text" id="adminSlug" autofocus>
        </div>
        <div class="field">
          <label>Password</label>
          <input type="password" id="adminPassword">
        </div>
        ${errorMsg ? `<p class="error-text">${escapeHtml(errorMsg)}</p>` : ''}
        <button class="btn-primary" id="adminLoginBtn" style="width:100%;">Sign in</button>
        <button class="settings-toggle" id="adminModeToggle" style="margin-top:10px;">New business? Create a profile</button>
        `}
      </div>
    </div>
  `;
  document.getElementById('adminModeToggle').onclick = () => renderAdminLogin(isSignup ? 'login' : 'signup');

  if(isSignup){
    const submit = async () => {
      const name = document.getElementById('adminSignupName').value.trim();
      const slug = document.getElementById('adminSignupSlug').value.trim();
      const code = document.getElementById('adminSignupCode').value;
      const password = document.getElementById('adminSignupPassword').value;
      const confirm = document.getElementById('adminSignupConfirm').value;
      if(password !== confirm){
        renderAdminLogin('signup', 'Passwords do not match.');
        return;
      }
      try{
        const session = await signupAdmin(name, slug, password, code);
        adminAuthenticated = true;
        currentAccountSlug = session.slug || slug;
        await loadAdminState();
      }catch(e){
        renderAdminLogin('signup', e.message || 'Could not create profile.');
      }
    };
    document.getElementById('adminSignupBtn').onclick = submit;
  }else{
    const submit = async () => {
      const slug = document.getElementById('adminSlug').value.trim();
      const password = document.getElementById('adminPassword').value;
      try{
        await loginAdmin(slug, password);
        adminAuthenticated = true;
        currentAccountSlug = slug;
        await loadAdminState();
      }catch(e){
        renderAdminLogin('login', 'Wrong business handle or password.');
      }
    };
    document.getElementById('adminLoginBtn').onclick = submit;
    document.getElementById('adminPassword').addEventListener('keydown', (e) => { if(e.key === 'Enter') submit(); });
  }
}

/* ---------------- Admin: rendering ---------------- */

// Reminder about Ebenezer's own invoice payment from his client (not worker pay) — shows
// only when the current period's computed payment date is within a week, or overdue.
function renderPaymentBanner(){
  const current = currentPeriod();
  if(!current) return '';
  const paymentDate = computePaymentDate(current.startedAt);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const pd = new Date(paymentDate);
  pd.setHours(0, 0, 0, 0);
  const daysUntil = Math.round((pd - today) / 86400000);
  if(daysUntil > 7) return '';
  const overdue = daysUntil < 0;
  const dateStr = fmtDateLong(paymentDate);
  const message = overdue
    ? `Payment for <strong>${escapeHtml(current.label)}</strong> was expected ${dateStr} — check if it's arrived.`
    : `Payment for <strong>${escapeHtml(current.label)}</strong> expected ${dateStr}${daysUntil === 0 ? ' (today)' : ` (in ${daysUntil} day${daysUntil === 1 ? '' : 's'})`}.`;
  return `<div class="payment-banner${overdue ? ' overdue' : ''}">📅 ${message}</div>`;
}

export function render(){
  document.getElementById('app').innerHTML = `
    ${renderPaymentBanner()}
    <div class="mobile-topbar">
      <button class="hamburger-btn" id="hamburgerBtn" aria-label="Open menu">☰</button>
      <span class="mobile-topbar-title">Ledger</span>
    </div>
    <div class="sidebar-backdrop" id="sidebarBackdrop"></div>
    <div class="app-inner">
      <div class="sidebar" id="sidebar">
        <div class="brand">Ledger<small>Work hours portal</small></div>
        <ul class="worker-list" id="workerList"></ul>
        <button class="add-worker-btn" id="addWorkerBtn">+ Add worker</button>
        <a class="settings-toggle" href="/w/${encodeURIComponent(currentAccountSlug || 'default')}" target="_blank" rel="noopener">Open worker view ↗</a>
        <button class="settings-toggle" id="logoutBtn">Log out</button>
      </div>
      <div class="main" id="main"></div>
    </div>
  `;
  wireStaticButtons();
  renderSidebar();
  renderMain();
}

// Mobile-only: the sidebar becomes a slide-in drawer instead of a stacked block, closed by
// default on every render (so picking a worker/page naturally closes it behind you).
function openSidebarDrawer(){
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebarBackdrop').classList.add('open');
}
function closeSidebarDrawer(){
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarBackdrop').classList.remove('open');
}

function wireStaticButtons(){
  document.getElementById('addWorkerBtn').onclick = () => {
    openModal(`
      <h3>Add worker</h3>
      <div class="field">
        <label>Name</label>
        <input type="text" id="modalName" placeholder="Worker name" autofocus>
      </div>
      <div class="field">
        <label>Worker share of gross (%)</label>
        <input type="number" id="modalShare" value="${SHARE_DEFAULT}" min="0" max="100">
        <div class="hint">Percentage of gross earnings this worker receives. You can change this later.</div>
      </div>
    `, async () => {
      const name = document.getElementById('modalName').value.trim();
      let share = parseFloat(document.getElementById('modalShare').value);
      if(!name) return false;
      if(isNaN(share)) share = SHARE_DEFAULT;
      share = Math.min(100, Math.max(0, share));
      const w = await addWorker(name, share);
      selectedWorkerId = w.id;
      adminWorkerTab = 'overview';
      render();
      alert(`Share this password with ${w.name} so they can log in at the worker link:\n\n${w.password}\n\nThey can change it themselves later.`);
      return true;
    });
  };

  document.getElementById('logoutBtn').onclick = async () => {
    try{ await api('/api/admin/logout', { method: 'POST' }); }catch(e){}
    adminAuthenticated = false;
    currentAccountSlug = null;
    renderAdminLogin();
  };

  document.getElementById('hamburgerBtn').onclick = openSidebarDrawer;
  document.getElementById('sidebarBackdrop').onclick = closeSidebarDrawer;
}

function renderSidebar(){
  const ul = document.getElementById('workerList');
  ul.innerHTML = '';

  const overviewLi = document.createElement('li');
  overviewLi.className = selectedWorkerId === OVERVIEW_ID ? 'active' : '';
  overviewLi.innerHTML = `<span>📊 All workers overview</span>`;
  overviewLi.onclick = () => { selectedWorkerId = OVERVIEW_ID; render(); };
  ul.appendChild(overviewLi);

  const monthlyLi = document.createElement('li');
  monthlyLi.className = selectedWorkerId === MONTHLY_ID ? 'active' : '';
  monthlyLi.innerHTML = `<span>📅 Monthly totals</span>`;
  monthlyLi.onclick = () => { selectedWorkerId = MONTHLY_ID; render(); };
  ul.appendChild(monthlyLi);

  const jobsLi = document.createElement('li');
  jobsLi.className = selectedWorkerId === JOBS_ID ? 'active' : '';
  jobsLi.innerHTML = `<span>💼 Jobs</span>`;
  jobsLi.onclick = () => { selectedWorkerId = JOBS_ID; render(); };
  ul.appendChild(jobsLi);

  state.workers.forEach(w => {
    const totals = calcWorkerTotals(w.id);
    const clockedIn = isWorkerClockedIn(w.id);
    const li = document.createElement('li');
    li.className = w.id === selectedWorkerId ? 'active' : '';
    li.innerHTML = `<span>${clockedIn ? '🟢 ' : ''}${escapeHtml(w.name)}</span><span class="hrs">${totals.totalHours.toFixed(1)}h</span>`;
    li.onclick = () => { selectedWorkerId = w.id; adminWorkerTab = 'overview'; render(); };
    ul.appendChild(li);
  });
}

function renderMain(){
  const main = document.getElementById('main');

  if(selectedWorkerId === OVERVIEW_ID){
    main.classList.remove('has-tabs');
    renderOverviewMain(main);
    return;
  }

  if(selectedWorkerId === MONTHLY_ID){
    main.classList.remove('has-tabs');
    renderMonthlyMain(main);
    return;
  }

  if(selectedWorkerId === JOBS_ID){
    main.classList.remove('has-tabs');
    renderJobsMain(main);
    return;
  }

  const worker = state.workers.find(w => w.id === selectedWorkerId);

  if(!worker){
    main.classList.remove('has-tabs');
    main.innerHTML = `<div class="empty-state"><h2>No worker selected</h2><p>Add a worker on the left to start logging hours.</p></div>`;
    return;
  }
  main.classList.add('has-tabs');

  const totals = calcWorkerTotals(worker.id);
  const entries = (state.entries[worker.id] || []).slice().sort((a,b) => b.date.localeCompare(a.date));
  const entryGroups = groupEntriesByPeriod(entries, state.periods);
  const curPeriod = currentPeriod();
  const timerSessions = (state.timers[worker.id] || []).slice().sort((a,b) => b.startedAt - a.startedAt);
  const payments = (state.payments[worker.id] || []).slice().sort((a,b) => b.createdAt - a.createdAt);
  const paymentsTotal = payments.reduce((sum, p) => sum + p.amount, 0);
  main.innerHTML = `
    <div class="worker-header">
      <div>
        <h1>${escapeHtml(worker.name)}</h1>
        <div class="sub">${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} logged · ${worker.sharePercent}% share</div>
      </div>
      <div class="share-field">
        Worker share of gross
        <input type="number" id="shareInput" min="0" max="100" step="1" value="${worker.sharePercent}">%
        <button class="settings-toggle" id="resetPasswordBtn">Reset password</button>
        <button class="settings-toggle" id="deleteWorkerBtn" style="color:var(--rust);">Delete worker</button>
      </div>
    </div>

    <div class="wv-tabs">
      <button class="wv-tab ${adminWorkerTab === 'overview' ? 'active' : ''}" data-worker-tab="overview"><span class="wv-tab-icon">🏠</span><span class="wv-tab-label">Overview</span></button>
      <button class="wv-tab ${adminWorkerTab === 'hours' ? 'active' : ''}" data-worker-tab="hours"><span class="wv-tab-icon">📋</span><span class="wv-tab-label">Hours</span></button>
      <button class="wv-tab ${adminWorkerTab === 'payments' ? 'active' : ''}" data-worker-tab="payments"><span class="wv-tab-icon">💵</span><span class="wv-tab-label">Payments</span></button>
      <button class="wv-tab ${adminWorkerTab === 'timer' ? 'active' : ''}" data-worker-tab="timer"><span class="wv-tab-icon">⏱️</span><span class="wv-tab-label">Timer log</span></button>
    </div>

    ${adminWorkerTab === 'overview' ? `
    <div class="receipt">
      <div class="receipt-grid">
        <div class="receipt-item">
          <div class="label">Hours logged</div>
          <div class="value">${totals.totalHours.toFixed(1)}</div>
        </div>
        <div class="receipt-item">
          <div class="label">Gross earned</div>
          <div class="value">${fmtCAD(totals.gross)}</div>
        </div>
        <div class="receipt-item deduction">
          <div class="label">Tax</div>
          <div class="value">-${fmtCAD(totals.tax)}</div>
        </div>
        <div class="receipt-item highlight">
          <div class="label">Worker pay</div>
          <div class="value">${fmtCAD(totals.workerPay)}</div>
        </div>
        <div class="receipt-item highlight">
          <div class="label">Worker pay (₦)</div>
          <div class="value">${fmtNGN(totals.workerPayNGN)}</div>
        </div>
      </div>
      <hr class="receipt-divider">
      <div class="receipt-item">
        <div class="label">Your take (after tax &amp; worker pay)</div>
        <div class="value">${fmtCAD(totals.myTake)}</div>
      </div>
      <div class="receipt-item deduction">
        <div class="label">Still owed to worker</div>
        <div class="value">${fmtCAD(totals.unpaidWorkerPay)} · ${fmtNGN(totals.unpaidWorkerPayNGN)}</div>
      </div>
      <div class="receipt-item deduction">
        <div class="label">Owed back to you (paid from personal funds)</div>
        <div class="value">${fmtCAD(totals.personalAdvance)} · ${fmtNGN(totals.personalAdvanceNGN)}</div>
      </div>
    </div>
    ` : ''}

    ${adminWorkerTab === 'hours' ? `
    <div class="entries-card">
      <div class="add-entry-row">
        <input type="date" name="date" id="entryDate" value="${new Date().toISOString().slice(0,10)}">
        <input type="number" name="hours" id="entryHours" step="0.01" min="0.01" max="24" placeholder="Hours">
        <input type="text" name="note" id="entryNote" placeholder="Note (optional)">
        <select id="entryJob" title="Which job this entry was for">
          ${state.jobs.map(j => `<option value="${j.id}">${escapeHtml(j.name)}</option>`).join('')}
        </select>
        <select id="entryPeriod" title="Which period this entry counts toward">
          ${state.periods.slice().sort((a,b) => b.startedAt - a.startedAt).map(p => `<option value="${p.id}" ${curPeriod && p.id === curPeriod.id ? 'selected' : ''}>${escapeHtml(p.label)}</option>`).join('')}
        </select>
        <button class="btn-primary" id="addEntryBtn">Add entry</button>
      </div>
      ${entries.length ? entryGroups.map(g => {
        const groupHours = g.entries.reduce((s,e) => s + e.hours, 0);
        const groupWorkerPay = g.entries.reduce((s,e) => s + calcEntryRow(e, worker.sharePercent).workerPay, 0);
        const groupHasUnpaid = g.entries.some(e => !e.paid);
        return `
      <div style="padding:10px 16px;border-bottom:1px solid var(--line);font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--ink-soft);font-weight:600;background:#FCFBF8;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
        <span>${escapeHtml(g.period.label)}</span>
        <span style="display:flex;align-items:center;gap:10px;text-transform:none;letter-spacing:normal;">
          ${groupHours.toFixed(2)}h · ${fmtCAD(groupWorkerPay)}
          ${groupHasUnpaid && g.period.id !== '__none__' ? `<button class="settings-toggle mark-period-paid-btn" data-period-id="${g.period.id}">Mark month as paid</button>` : ''}
        </span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Date</th><th>Job</th><th>Hours</th><th>Gross</th><th>Worker pay</th><th>Worker pay ₦</th><th>Note</th><th>Paid</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${g.entries.map(e => {
            const c = calcEntryRow(e, worker.sharePercent);
            const job = findJob(e.jobId);
            return `<tr>
              <td data-label="Date">${e.date}</td>
              <td data-label="Job">${escapeHtml(job ? job.name : 'Unknown')}</td>
              <td data-label="Hours">${e.hours.toFixed(2)}</td>
              <td data-label="Gross">${fmtCAD(c.gross)}</td>
              <td data-label="Worker pay">${fmtCAD(c.workerPay)}</td>
              <td data-label="Worker pay ₦">${fmtNGN(c.workerPayNGN)}</td>
              <td class="note-col" data-label="Note">${escapeHtml(e.note || '')}</td>
              <td data-label="Paid">
                <select class="paid-select" data-id="${e.id}">
                  <option value="unpaid" ${!e.paid ? 'selected' : ''}>Unpaid</option>
                  <option value="personal" ${e.paid && e.paymentSource === 'personal' ? 'selected' : ''}>Paid (personal)</option>
                  <option value="official" ${e.paid && e.paymentSource === 'official' ? 'selected' : ''}>Paid (official)</option>
                </select>
              </td>
              <td data-label=""><button class="del-btn" data-id="${e.id}">Delete</button></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;
      }).join('') : `<div class="empty-entries">No hours logged yet. Add the first entry above.</div>`}
      ${entries.length ? `
      <div class="add-entry-row">
        <button class="settings-toggle" id="markAllPaidPersonalBtn">Mark all as paid (personal funds)</button>
        <button class="settings-toggle" id="markAllPaidOfficialBtn">Mark all as paid (official)</button>
      </div>
      ` : ''}
    </div>
    ` : ''}

    ${adminWorkerTab === 'payments' ? `
    <div class="entries-card">
      <div style="padding:12px 16px;border-bottom:1px solid var(--line);font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--ink-soft);font-weight:600;background:#FCFBF8;display:flex;justify-content:space-between;align-items:center;">
        <span>Payments logged <span style="text-transform:none;letter-spacing:normal;font-weight:400;">— typing an amount marks whichever unpaid entries add up to it as paid</span></span>
        ${payments.length ? `<span style="text-transform:none;letter-spacing:normal;font-weight:600;color:var(--ink);">${fmtCAD(paymentsTotal)}</span>` : ''}
      </div>
      ${payments.length ? `
      <table>
        <thead><tr><th>Date</th><th>Amount</th><th>Source</th><th>Note</th><th></th></tr></thead>
        <tbody>
          ${payments.map(p => `<tr>
            <td data-label="Date">${fmtPaymentDate(p.createdAt)}</td>
            <td data-label="Amount">${fmtCAD(p.amount)}</td>
            <td data-label="Source">${p.paymentSource ? (p.paymentSource === 'personal' ? 'Personal' : 'Official') : '—'}</td>
            <td class="note-col" data-label="Note">${escapeHtml(p.note || '')}</td>
            <td data-label=""><button class="timer-del-btn payment-del-btn" data-id="${p.id}">Delete</button></td>
          </tr>`).join('')}
        </tbody>
      </table>
      ` : `<div class="empty-entries">No payments logged yet.</div>`}
      <div class="add-entry-row">
        <input type="number" name="paymentAmount" id="paymentAmount" step="0.01" min="0.01" placeholder="Amount (CAD)" style="width:130px;">
        <select id="paymentSource" style="font-family:'Inter', sans-serif;border:1px solid var(--line);border-radius:6px;padding:8px 10px;font-size:13px;">
          <option value="">Source (optional)</option>
          <option value="personal">Personal</option>
          <option value="official">Official</option>
        </select>
        <input type="text" name="paymentNote" id="paymentNote" placeholder="Note (optional)">
        <button class="btn-primary" id="logPaymentBtn">Log payment</button>
      </div>
    </div>
    ` : ''}

    ${adminWorkerTab === 'timer' ? `
    <div class="entries-card">
      <div style="padding:12px 16px;border-bottom:1px solid var(--line);font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--ink-soft);font-weight:600;background:#FCFBF8;">
        Timer log <span style="text-transform:none;letter-spacing:normal;font-weight:400;">— self-reported by ${escapeHtml(worker.name)}, informational only, doesn't affect hours or pay</span>
      </div>
      ${timerSessions.length ? `
      <table>
        <thead><tr><th>Start</th><th>Stop</th><th>Job</th><th>Duration</th><th>Note</th><th>Added</th><th></th></tr></thead>
        <tbody>
          ${timerSessions.map(t => `<tr>
            <td data-label="Start">${fmtWhenCell(t.startedAt)}</td>
            <td data-label="Stop">${t.endedAt ? fmtWhenCell(t.endedAt) : '<span class="timer-running-tag">running…</span>'}</td>
            <td data-label="Job">${escapeHtml(findJob(t.jobId)?.name || '—')}</td>
            <td data-label="Duration">${fmtDuration((t.endedAt || Date.now()) - t.startedAt)}</td>
            <td class="note-col" data-label="Note">${escapeHtml(t.note || '')}</td>
            <td data-label="Added"><input type="checkbox" class="timer-logged-checkbox" data-id="${t.id}" ${t.logged ? 'checked' : ''} title="I've checked this session and added its hours as a work hour entry"></td>
            <td data-label="">
              ${!t.endedAt ? `<button class="settings-toggle timer-stop-btn" data-id="${t.id}">Stop</button>` : ''}
              <button class="timer-del-btn" data-id="${t.id}">Delete</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
      ` : `<div class="empty-entries">No timer sessions logged yet.</div>`}
    </div>
    ` : ''}
  `;

  main.querySelectorAll('.wv-tab').forEach(btn => {
    btn.onclick = () => {
      adminWorkerTab = btn.dataset.workerTab;
      renderMain();
    };
  });

  document.getElementById('shareInput').onchange = async (e) => {
    let v = parseFloat(e.target.value);
    if(isNaN(v)) v = SHARE_DEFAULT;
    v = Math.min(100, Math.max(0, v));
    await updateWorkerShare(worker.id, v);
    render();
  };

  document.getElementById('deleteWorkerBtn').onclick = () => {
    openModal(`
      <h3>Delete ${escapeHtml(worker.name)}?</h3>
      <p style="font-size:13px;color:var(--ink-soft);margin:0 0 14px;">This permanently deletes this worker and all their logged hours. Enter the admin password to confirm.</p>
      <div class="field">
        <label>Admin password</label>
        <input type="password" id="modalDeletePassword" autofocus>
      </div>
    `, async () => {
      const password = document.getElementById('modalDeletePassword').value;
      try{
        await deleteWorker(worker.id, password);
        selectedWorkerId = null;
        render();
        return true;
      }catch(e){
        alert('Could not delete: ' + e.message);
        return false;
      }
    }, 'Delete');
  };

  document.getElementById('resetPasswordBtn').onclick = async () => {
    if(!confirm(`Reset ${worker.name}'s password? Their old password will stop working immediately.`)) return;
    try{
      const { password } = await resetWorkerPassword(worker.id);
      alert(`New password for ${worker.name}:\n\n${password}\n\nShare this with them directly.`);
    }catch(e){
      alert('Could not reset password: ' + e.message);
    }
  };

  const addEntryBtn = document.getElementById('addEntryBtn');
  if(addEntryBtn) addEntryBtn.onclick = async () => {
    const date = document.getElementById('entryDate').value;
    const note = document.getElementById('entryNote').value.trim();
    const hours = parseFloat(document.getElementById('entryHours').value);
    const periodEl = document.getElementById('entryPeriod');
    const periodId = periodEl ? periodEl.value : undefined;
    const jobEl = document.getElementById('entryJob');
    const jobId = jobEl ? jobEl.value : undefined;
    if(!date || !hours || hours <= 0){
      alert('Enter a date and number of hours.');
      return;
    }
    try{
      await addEntryAdmin(worker.id, { date, hours, note, periodId, jobId });
      render();
    }catch(e){
      alert('Could not save entry: ' + e.message);
    }
  };

  main.querySelectorAll('.del-btn').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.id;
      try{
        await deleteEntryAdmin(worker.id, id);
        render();
      }catch(e){
        alert('Could not delete entry: ' + e.message);
      }
    };
  });

  main.querySelectorAll('.paid-select').forEach(sel => {
    const prevValue = sel.value;
    sel.onchange = async () => {
      const id = sel.dataset.id;
      const paid = sel.value !== 'unpaid';
      const paymentSource = paid ? sel.value : undefined;
      try{
        await setEntryPaid(worker.id, id, paid, paymentSource);
        render();
      }catch(e){
        alert('Could not update paid status: ' + e.message);
        sel.value = prevValue;
      }
    };
  });

  const markAllPaidPersonalBtn = document.getElementById('markAllPaidPersonalBtn');
  if(markAllPaidPersonalBtn){
    markAllPaidPersonalBtn.onclick = async () => {
      try{
        await markAllPaid(worker.id, 'personal');
        render();
      }catch(e){
        alert('Could not mark entries as paid: ' + e.message);
      }
    };
  }
  const markAllPaidOfficialBtn = document.getElementById('markAllPaidOfficialBtn');
  if(markAllPaidOfficialBtn){
    markAllPaidOfficialBtn.onclick = async () => {
      try{
        await markAllPaid(worker.id, 'official');
        render();
      }catch(e){
        alert('Could not mark entries as paid: ' + e.message);
      }
    };
  }

  main.querySelectorAll('.mark-period-paid-btn').forEach(btn => {
    btn.onclick = () => {
      const periodId = btn.dataset.periodId;
      const period = state.periods.find(p => p.id === periodId);
      const label = period ? period.label : 'this period';
      openModal(`
        <h3>Mark ${escapeHtml(label)} as paid?</h3>
        <p style="font-size:13px;color:var(--ink-soft);margin:0 0 14px;">Marks every unpaid hour entry for ${escapeHtml(worker.name)} in this period as paid.</p>
        <div class="field">
          <label>Payment source (optional)</label>
          <select id="modalMarkPeriodPaidSource">
            <option value="">Not specified</option>
            <option value="personal">Personal</option>
            <option value="official">Official</option>
          </select>
        </div>
      `, async () => {
        const paymentSource = document.getElementById('modalMarkPeriodPaidSource').value || undefined;
        try{
          await markAllPaid(worker.id, paymentSource, periodId);
          render();
          return true;
        }catch(e){
          alert('Could not mark period as paid: ' + e.message);
          return false;
        }
      }, 'Mark paid');
    };
  });

  const logPaymentBtn = document.getElementById('logPaymentBtn');
  if(logPaymentBtn) logPaymentBtn.onclick = async () => {
    const amount = parseFloat(document.getElementById('paymentAmount').value);
    const paymentSource = document.getElementById('paymentSource').value || undefined;
    const note = document.getElementById('paymentNote').value.trim();
    if(!amount || amount <= 0){
      alert('Enter an amount greater than 0.');
      return;
    }
    try{
      const p = await addPaymentAdmin(worker.id, { amount, paymentSource, note });
      render();
      const matchedCount = (p.matchedEntryIds || []).length;
      if(matchedCount){
        if(p.unappliedAmount > 0.005){
          alert(`Marked ${matchedCount} ${matchedCount === 1 ? 'entry' : 'entries'} as paid (${fmtCAD(p.appliedAmount)}). ${fmtCAD(p.unappliedAmount)} of this payment didn't match any combination of unpaid entries and wasn't applied.`);
        }
      }else{
        alert(`Payment logged, but no combination of unpaid entries matched ${fmtCAD(amount)}, so nothing was marked as paid.`);
      }
    }catch(e){
      alert('Could not log payment: ' + e.message);
    }
  };

  main.querySelectorAll('.payment-del-btn').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.id;
      if(!confirm('Delete this payment record? Any entries it marked as paid will revert to unpaid. This cannot be undone.')) return;
      try{
        await deletePaymentAdmin(worker.id, id);
        render();
      }catch(e){
        alert('Could not delete payment: ' + e.message);
      }
    };
  });

  main.querySelectorAll('.timer-stop-btn').forEach(btn => {
    btn.onclick = async () => {
      const sessionId = btn.dataset.id;
      try{
        const updated = await api(`/api/admin/timers/${worker.id}/${sessionId}/stop`, { method: 'POST' });
        const list = state.timers[worker.id] || [];
        const idx = list.findIndex(t => t.id === sessionId);
        if(idx !== -1) list[idx] = updated;
        render();
      }catch(e){
        alert('Could not stop timer: ' + e.message);
      }
    };
  });

  main.querySelectorAll('.timer-del-btn').forEach(btn => {
    btn.onclick = async () => {
      const sessionId = btn.dataset.id;
      if(!confirm('Delete this timer session? This cannot be undone.')) return;
      try{
        await api(`/api/admin/timers/${worker.id}/${sessionId}`, { method: 'DELETE' });
        state.timers[worker.id] = (state.timers[worker.id] || []).filter(t => t.id !== sessionId);
        render();
      }catch(e){
        alert('Could not delete timer session: ' + e.message);
      }
    };
  });

  main.querySelectorAll('.timer-logged-checkbox').forEach(cb => {
    cb.onchange = async () => {
      const sessionId = cb.dataset.id;
      const logged = cb.checked;
      cb.disabled = true;
      try{
        await setTimerLogged(worker.id, sessionId, logged);
        render();
      }catch(e){
        alert('Could not update: ' + e.message);
        cb.checked = !logged;
        cb.disabled = false;
      }
    };
  });
}

function renderOverviewMain(main){
  const totals = calcAllWorkersTotals();
  const rows = totals.perWorker.slice().sort((a,b) => b.totals.gross - a.totals.gross);
  const timerRows = state.workers.map(w => {
    const sessions = (state.timers[w.id] || []).slice().sort((a,b) => b.startedAt - a.startedAt);
    return { worker: w, running: sessions.find(t => !t.endedAt) || null, last: sessions[0] || null };
  }).filter(r => r.running || r.last);

  main.innerHTML = `
    <div class="worker-header">
      <div>
        <h1>All workers overview</h1>
        <div class="sub">${state.jobs.length} job${state.jobs.length === 1 ? '' : 's'} · ${state.workers.length} worker${state.workers.length === 1 ? '' : 's'}</div>
      </div>
    </div>

    <div class="receipt">
      <div class="receipt-grid">
        <div class="receipt-item">
          <div class="label">Hours logged</div>
          <div class="value">${totals.totalHours.toFixed(1)}</div>
        </div>
        <div class="receipt-item">
          <div class="label">Gross earned</div>
          <div class="value">${fmtCAD(totals.gross)}</div>
        </div>
        <div class="receipt-item deduction">
          <div class="label">Tax</div>
          <div class="value">-${fmtCAD(totals.tax)}</div>
        </div>
        <div class="receipt-item highlight">
          <div class="label">Worker pay (all)</div>
          <div class="value">${fmtCAD(totals.workerPay)}</div>
        </div>
        <div class="receipt-item highlight">
          <div class="label">Worker pay (₦)</div>
          <div class="value">${fmtNGN(totals.workerPayNGN)}</div>
        </div>
      </div>
      <hr class="receipt-divider">
      <div class="receipt-item">
        <div class="label">Your take (after tax &amp; worker pay)</div>
        <div class="value">${fmtCAD(totals.myTake)}</div>
      </div>
      <div class="receipt-item deduction">
        <div class="label">Still owed across all workers</div>
        <div class="value">${fmtCAD(totals.unpaidWorkerPay)} · ${fmtNGN(totals.unpaidWorkerPayNGN)}</div>
      </div>
      <div class="receipt-item deduction">
        <div class="label">Owed back to you (paid from personal funds)</div>
        <div class="value">${fmtCAD(totals.personalAdvance)} · ${fmtNGN(totals.personalAdvanceNGN)}</div>
      </div>
    </div>

    <div class="entries-card">
      ${rows.length ? `
      <table>
        <thead>
          <tr>
            <th>Worker</th><th>Hours</th><th>Gross</th><th>Worker pay</th><th>Still owed</th><th>Owed back to you</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `<tr>
            <td data-label="Worker">${escapeHtml(r.worker.name)}</td>
            <td data-label="Hours">${r.totals.totalHours.toFixed(2)}</td>
            <td data-label="Gross">${fmtCAD(r.totals.gross)}</td>
            <td data-label="Worker pay">${fmtCAD(r.totals.workerPay)}</td>
            <td data-label="Still owed">${fmtCAD(r.totals.unpaidWorkerPay)}</td>
            <td data-label="Owed back to you">${fmtCAD(r.totals.personalAdvance)}</td>
          </tr>`).join('')}
        </tbody>
      </table>` : `<div class="empty-entries">No workers added yet.</div>`}
    </div>

    <div class="entries-card" style="margin-top:16px;">
      <div style="padding:12px 16px;border-bottom:1px solid var(--line);font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--ink-soft);font-weight:600;background:#FCFBF8;">
        Timer activity <span style="text-transform:none;letter-spacing:normal;font-weight:400;">— self-reported, informational only, doesn't affect hours or pay</span>
      </div>
      ${timerRows.length ? `
      <table>
        <thead><tr><th>Worker</th><th>Status</th><th>Last session</th></tr></thead>
        <tbody>
          ${timerRows.map(r => `<tr>
            <td data-label="Worker">${escapeHtml(r.worker.name)}</td>
            <td data-label="Status">${r.running ? `<span class="timer-running-tag">🟢 Running since ${fmtClockBoth(r.running.startedAt)}</span>` : '—'}</td>
            <td data-label="Last session">${r.last ? `${fmtDayTZ(r.last.startedAt, TZ_QC)} · ${fmtClockBoth(r.last.startedAt)} · ${fmtDuration((r.last.endedAt || Date.now()) - r.last.startedAt)}${r.last.endedAt ? '' : ' (running)'}` : '—'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      ` : `<div class="empty-entries">No timer activity logged yet.</div>`}
    </div>
  `;
}

function renderMonthlyMain(main){
  const allTime = calcAllWorkersTotals();
  const periodRows = calcAllPeriodsTotals();

  const receiptCard = (label, t, paymentDate) => `
    <div style="margin: 20px 0 10px; font-size:13px; font-weight:600; color: var(--ink-soft); text-transform:uppercase; letter-spacing:0.06em;">${escapeHtml(label)}</div>
    <div class="receipt">
      <div class="receipt-grid">
        <div class="receipt-item">
          <div class="label">Hours logged</div>
          <div class="value">${t.totalHours.toFixed(1)}</div>
        </div>
        <div class="receipt-item">
          <div class="label">Gross earned</div>
          <div class="value">${fmtCAD(t.gross)}</div>
        </div>
        <div class="receipt-item deduction">
          <div class="label">Tax</div>
          <div class="value">-${fmtCAD(t.tax)}</div>
        </div>
        <div class="receipt-item highlight">
          <div class="label">Worker pay</div>
          <div class="value">${fmtCAD(t.workerPay)}</div>
        </div>
        <div class="receipt-item highlight">
          <div class="label">Worker pay (₦)</div>
          <div class="value">${fmtNGN(t.workerPayNGN)}</div>
        </div>
      </div>
      <hr class="receipt-divider">
      ${paymentDate ? `
      <div class="receipt-item">
        <div class="label">Expected payment from client</div>
        <div class="value">${fmtDateLong(paymentDate)}</div>
      </div>
      ` : ''}
      <div class="receipt-item">
        <div class="label">Your take (after tax &amp; worker pay)</div>
        <div class="value">${fmtCAD(t.myTake)}</div>
      </div>
      <div class="receipt-item deduction">
        <div class="label">Still owed</div>
        <div class="value">${fmtCAD(t.unpaidWorkerPay)} · ${fmtNGN(t.unpaidWorkerPayNGN)}</div>
      </div>
      <div class="receipt-item deduction">
        <div class="label">Owed back to you (paid from personal funds)</div>
        <div class="value">${fmtCAD(t.personalAdvance)} · ${fmtNGN(t.personalAdvanceNGN)}</div>
      </div>
    </div>
  `;

  main.innerHTML = `
    <div class="worker-header">
      <div>
        <h1>Monthly totals</h1>
        <div class="sub">${state.periods.length} period${state.periods.length === 1 ? '' : 's'}</div>
      </div>
      <button class="btn-primary" id="startPeriodBtn">+ Start new period</button>
    </div>

    ${receiptCard('All-time', allTime)}

    ${periodRows.length ? periodRows.map(r => receiptCard(r.period.label, r.totals, computePaymentDate(r.period.startedAt))).join('') : `<div class="entries-card"><div class="empty-entries">No periods yet. Start one to begin grouping hours by month.</div></div>`}
  `;

  document.getElementById('startPeriodBtn').onclick = () => {
    const suggested = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });
    openModal(`
      <h3>Start a new period</h3>
      <div class="field">
        <label>Label</label>
        <input type="text" id="modalPeriodLabel" value="${escapeHtml(suggested)}" autofocus>
        <div class="hint">New entries default to this period from now on. Existing entries aren't affected, and you can still pick an older period when adding an entry.</div>
      </div>
    `, async () => {
      const label = document.getElementById('modalPeriodLabel').value.trim();
      if(!label) return false;
      await addPeriod(label);
      render();
      return true;
    });
  };
}

function renderJobsMain(main){
  const s = state.settings;
  main.innerHTML = `
    <div class="worker-header">
      <div>
        <h1>Jobs</h1>
        <div class="sub">${state.jobs.length} job${state.jobs.length === 1 ? '' : 's'}</div>
      </div>
      <button class="btn-primary" id="addJobBtn">+ Add job</button>
    </div>

    <div class="fx-bar">
      <span>Default 1 CAD → ₦</span>
      <input type="number" id="fxQuickInput" step="0.01" min="0" value="${s.exchangeRate ? s.exchangeRate.toFixed(2) : ''}">
      <span class="fx-tag">${s.exchangeManual ? 'manual' : 'live'}</span>
      ${s.exchangeManual ? `<button class="fx-live-btn" id="fxUseLiveBtn">Use live rate</button>` : ''}
    </div>
    <p class="fx-note" style="margin: 4px 0 16px;">Used by any job below set to "shared" exchange rate.</p>

    <div class="entries-card">
      ${state.jobs.length ? `
      <table>
        <thead><tr><th>Name</th><th>Rate (CAD/hr)</th><th>Tax %</th><th>Exchange rate</th><th></th></tr></thead>
        <tbody>
          ${state.jobs.map(j => `<tr>
            <td data-label="Name">${escapeHtml(j.name)}</td>
            <td data-label="Rate (CAD/hr)">${fmtCAD(j.rate)}</td>
            <td data-label="Tax %">${j.taxPercent}%</td>
            <td data-label="Exchange rate">${j.fxMode === 'custom' ? `Custom (₦${j.exchangeRate ? j.exchangeRate.toFixed(2) : '—'})` : 'Shared default'}</td>
            <td data-label=""><button class="settings-toggle edit-job-btn" data-id="${j.id}">Edit</button></td>
          </tr>`).join('')}
        </tbody>
      </table>
      ` : `<div class="empty-entries">No jobs yet.</div>`}
    </div>
  `;

  const fxQuickInput = document.getElementById('fxQuickInput');
  fxQuickInput.onchange = async (e) => {
    let v = parseFloat(e.target.value);
    if(isNaN(v) || v <= 0) return;
    state.settings.exchangeRate = v;
    state.settings.exchangeManual = true;
    await saveSettings();
    render();
  };
  const fxLiveBtn = document.getElementById('fxUseLiveBtn');
  if(fxLiveBtn){
    fxLiveBtn.onclick = async () => {
      state.settings.exchangeManual = false;
      await saveSettings();
      fetchExchangeRate();
    };
  }

  const openJobModal = (job) => {
    const fxCustom = !!(job && job.fxMode === 'custom');
    openModal(`
      <h3>${job ? 'Edit job' : 'Add job'}</h3>
      <div class="field">
        <label>Job name</label>
        <input type="text" id="modalJobName" value="${job ? escapeHtml(job.name) : ''}" placeholder="e.g. Client B" autofocus>
      </div>
      <div class="field">
        <label>Hourly rate (CAD)</label>
        <input type="number" id="modalJobRate" value="${job ? job.rate : RATE_DEFAULT}" step="0.01" min="0">
      </div>
      <div class="field">
        <label>Tax (%)</label>
        <input type="number" id="modalJobTax" value="${job ? job.taxPercent : TAX_DEFAULT}" min="0" max="100">
      </div>
      <div class="field">
        <label>CAD → NGN exchange rate</label>
        <select id="modalJobFxMode">
          <option value="shared" ${!fxCustom ? 'selected' : ''}>Use the shared default rate</option>
          <option value="custom" ${fxCustom ? 'selected' : ''}>Use a custom rate for this job</option>
        </select>
        <input type="number" id="modalJobFxRate" style="margin-top:8px;${fxCustom ? '' : 'display:none;'}" value="${fxCustom && job.exchangeRate ? job.exchangeRate.toFixed(2) : ''}" step="0.01" min="0" placeholder="Custom CAD → NGN rate">
      </div>
    `, async () => {
      const name = document.getElementById('modalJobName').value.trim();
      const rate = parseFloat(document.getElementById('modalJobRate').value);
      const taxPercent = parseFloat(document.getElementById('modalJobTax').value);
      const fxMode = document.getElementById('modalJobFxMode').value;
      const exchangeRate = fxMode === 'custom' ? parseFloat(document.getElementById('modalJobFxRate').value) : undefined;
      if(!name){ alert('Enter a job name.'); return false; }
      if(isNaN(rate) || rate <= 0){ alert('Enter a rate greater than 0.'); return false; }
      if(isNaN(taxPercent) || taxPercent < 0 || taxPercent > 100){ alert('Tax must be between 0 and 100.'); return false; }
      if(fxMode === 'custom' && (isNaN(exchangeRate) || exchangeRate <= 0)){ alert('Enter a custom exchange rate greater than 0.'); return false; }
      try{
        if(job) await updateJob(job.id, { name, rate, taxPercent, fxMode, exchangeRate });
        else await addJob({ name, rate, taxPercent, fxMode, exchangeRate });
        render();
        return true;
      }catch(e){
        alert('Could not save job: ' + e.message);
        return false;
      }
    }, job ? 'Save' : 'Add');

    document.getElementById('modalJobFxMode').onchange = (e) => {
      document.getElementById('modalJobFxRate').style.display = e.target.value === 'custom' ? '' : 'none';
    };
  };

  document.getElementById('addJobBtn').onclick = () => openJobModal(null);
  main.querySelectorAll('.edit-job-btn').forEach(btn => {
    btn.onclick = () => {
      const job = state.jobs.find(j => j.id === btn.dataset.id);
      if(job) openJobModal(job);
    };
  });
}
