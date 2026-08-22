import { api } from './api.js';
import {
  state, replaceState, SHARE_DEFAULT, OVERVIEW_ID, MONTHLY_ID,
  calcWorkerTotals, calcAllWorkersTotals, isWorkerClockedIn, calcEntryRow,
  groupEntriesByPeriod, currentPeriod, calcAllPeriodsTotals, computePaymentDate,
} from './state.js';
import { fmtCAD, fmtNGN, fmtDuration, fmtClockBoth, fmtDayTZ, fmtWhenCell, fmtPaymentDate, fmtDateLong, escapeHtml, TZ_QC } from './format.js';
import { openModal, modalOpen } from './modal.js';
import {
  saveSettings, fetchExchangeRate, addWorker, addPeriod, updateWorkerShare, resetWorkerPassword,
  addEntryAdmin, deleteEntryAdmin, setEntryPaid, markAllPaid, addPaymentAdmin, deletePaymentAdmin,
  setTimerLogged, deleteWorker,
} from './admin-data.js';

let selectedWorkerId = null;
let adminAuthenticated = false;
let pollTimer = null;

/* ---------------- Admin: boot + polling ---------------- */

export async function bootAdmin(){
  try{
    const session = await api('/api/admin/session');
    adminAuthenticated = session.authenticated;
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

function renderAdminLogin(errorMsg){
  stopAdminPolling();
  document.getElementById('app').innerHTML = `
    <div class="worker-view-wrap">
      <div class="worker-view-card">
        <h2 class="wv-title">Admin sign-in</h2>
        <p class="wv-sub">Enter the admin password to continue.</p>
        <div class="field">
          <label>Password</label>
          <input type="password" id="adminPassword" autofocus>
        </div>
        ${errorMsg ? `<p class="error-text">${escapeHtml(errorMsg)}</p>` : ''}
        <button class="btn-primary" id="adminLoginBtn" style="width:100%;">Sign in</button>
      </div>
    </div>
  `;
  const submit = async () => {
    const password = document.getElementById('adminPassword').value;
    try{
      await api('/api/admin/login', { method: 'POST', body: { password } });
      adminAuthenticated = true;
      await loadAdminState();
    }catch(e){
      renderAdminLogin('Wrong password.');
    }
  };
  document.getElementById('adminLoginBtn').onclick = submit;
  document.getElementById('adminPassword').addEventListener('keydown', (e) => { if(e.key === 'Enter') submit(); });
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
    <div class="app-inner">
      <div class="sidebar">
        <div class="brand">Ledger<small>Work hours portal</small></div>
        <ul class="worker-list" id="workerList"></ul>
        <button class="add-worker-btn" id="addWorkerBtn">+ Add worker</button>
        <button class="settings-toggle" id="settingsToggle">Rate, tax &amp; exchange settings</button>
        <a class="settings-toggle" href="/" target="_blank" rel="noopener">Open worker view ↗</a>
        <button class="settings-toggle" id="logoutBtn">Log out</button>
      </div>
      <div class="main" id="main"></div>
    </div>
  `;
  wireStaticButtons();
  renderSidebar();
  renderMain();
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
      render();
      alert(`Share this password with ${w.name} so they can log in at the worker link:\n\n${w.password}\n\nThey can change it themselves later.`);
      return true;
    });
  };

  document.getElementById('settingsToggle').onclick = () => {
    const s = state.settings;
    openModal(`
      <h3>Rate, tax &amp; exchange</h3>
      <div class="field">
        <label>Your hourly rate (CAD)</label>
        <input type="number" id="modalRate" value="${s.rate}" step="0.01" min="0">
      </div>
      <div class="field">
        <label>Tax (%)</label>
        <input type="number" id="modalTax" value="${s.taxPercent}" min="0" max="100">
      </div>
      <div class="field">
        <label>CAD → NGN exchange rate</label>
        <input type="number" id="modalFx" value="${s.exchangeRate ? s.exchangeRate.toFixed(2) : ''}" step="0.01" min="0">
        <div class="fx-note">Leave as-is to keep using the live rate. Edit it to lock a manual rate.</div>
      </div>
    `, async () => {
      let rate = parseFloat(document.getElementById('modalRate').value);
      let tax = parseFloat(document.getElementById('modalTax').value);
      let fx = parseFloat(document.getElementById('modalFx').value);
      if(!isNaN(rate)) s.rate = rate;
      if(!isNaN(tax)) s.taxPercent = Math.min(100, Math.max(0, tax));
      if(!isNaN(fx) && fx !== s.exchangeRate){
        s.exchangeRate = fx;
        s.exchangeManual = true;
      }
      await saveSettings();
      render();
      return true;
    });
  };

  document.getElementById('logoutBtn').onclick = async () => {
    try{ await api('/api/admin/logout', { method: 'POST' }); }catch(e){}
    adminAuthenticated = false;
    renderAdminLogin();
  };
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

  state.workers.forEach(w => {
    const totals = calcWorkerTotals(w.id);
    const clockedIn = isWorkerClockedIn(w.id);
    const li = document.createElement('li');
    li.className = w.id === selectedWorkerId ? 'active' : '';
    li.innerHTML = `<span>${clockedIn ? '🟢 ' : ''}${escapeHtml(w.name)}</span><span class="hrs">${totals.totalHours.toFixed(1)}h</span>`;
    li.onclick = () => { selectedWorkerId = w.id; render(); };
    ul.appendChild(li);
  });
}

function renderMain(){
  const main = document.getElementById('main');

  if(selectedWorkerId === OVERVIEW_ID){
    renderOverviewMain(main);
    return;
  }

  if(selectedWorkerId === MONTHLY_ID){
    renderMonthlyMain(main);
    return;
  }

  const worker = state.workers.find(w => w.id === selectedWorkerId);

  if(!worker){
    main.innerHTML = `<div class="empty-state"><h2>No worker selected</h2><p>Add a worker on the left to start logging hours.</p></div>`;
    return;
  }

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
        <div class="sub">CA$${state.settings.rate}/hr · ${state.settings.taxPercent}% tax</div>
      </div>
      <div class="share-field">
        Worker share of gross
        <input type="number" id="shareInput" min="0" max="100" step="1" value="${worker.sharePercent}">%
        <button class="settings-toggle" id="resetPasswordBtn">Reset password</button>
        <button class="settings-toggle" id="deleteWorkerBtn" style="color:var(--rust);">Delete worker</button>
      </div>
    </div>

    <div class="fx-bar">
      <span>1 CAD → ₦</span>
      <input type="number" id="fxQuickInput" step="0.01" min="0" value="${state.settings.exchangeRate ? state.settings.exchangeRate.toFixed(2) : ''}">
      <span class="fx-tag">${state.settings.exchangeManual ? 'manual' : 'live'}</span>
      ${state.settings.exchangeManual ? `<button class="fx-live-btn" id="fxUseLiveBtn">Use live rate</button>` : ''}
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
          <div class="label">Tax (${state.settings.taxPercent}%)</div>
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

    <div class="entries-card">
      ${entries.length ? entryGroups.map(g => {
        const groupHours = g.entries.reduce((s,e) => s + e.hours, 0);
        const groupWorkerPay = g.entries.reduce((s,e) => s + calcEntryRow(e.hours, worker.sharePercent).workerPay, 0);
        return `
      <div style="padding:10px 16px;border-bottom:1px solid var(--line);font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--ink-soft);font-weight:600;background:#FCFBF8;display:flex;justify-content:space-between;align-items:center;">
        <span>${escapeHtml(g.period.label)}</span>
        <span style="text-transform:none;letter-spacing:normal;">${groupHours.toFixed(2)}h · ${fmtCAD(groupWorkerPay)}</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Date</th><th>Hours</th><th>Gross</th><th>Worker pay</th><th>Worker pay ₦</th><th>Note</th><th>Paid</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${g.entries.map(e => {
            const c = calcEntryRow(e.hours, worker.sharePercent);
            return `<tr>
              <td>${e.date}</td>
              <td>${e.hours.toFixed(2)}</td>
              <td>${fmtCAD(c.gross)}</td>
              <td>${fmtCAD(c.workerPay)}</td>
              <td>${fmtNGN(c.workerPayNGN)}</td>
              <td class="note-col">${escapeHtml(e.note || '')}</td>
              <td>
                <select class="paid-select" data-id="${e.id}">
                  <option value="unpaid" ${!e.paid ? 'selected' : ''}>Unpaid</option>
                  <option value="personal" ${e.paid && e.paymentSource === 'personal' ? 'selected' : ''}>Paid (personal)</option>
                  <option value="official" ${e.paid && e.paymentSource === 'official' ? 'selected' : ''}>Paid (official)</option>
                </select>
              </td>
              <td><button class="del-btn" data-id="${e.id}">Delete</button></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;
      }).join('') : `<div class="empty-entries">No hours logged yet. Add the first entry below.</div>`}
      ${entries.length ? `
      <div class="add-entry-row">
        <button class="settings-toggle" id="markAllPaidPersonalBtn">Mark all as paid (personal funds)</button>
        <button class="settings-toggle" id="markAllPaidOfficialBtn">Mark all as paid (official)</button>
      </div>
      ` : ''}
      <div class="add-entry-row">
        <input type="date" name="date" id="entryDate" value="${new Date().toISOString().slice(0,10)}">
        <input type="number" name="hours" id="entryHours" step="0.01" min="0.01" max="24" placeholder="Hours">
        <input type="text" name="note" id="entryNote" placeholder="Note (optional)">
        <select id="entryPeriod" title="Which period this entry counts toward">
          ${state.periods.slice().sort((a,b) => b.startedAt - a.startedAt).map(p => `<option value="${p.id}" ${curPeriod && p.id === curPeriod.id ? 'selected' : ''}>${escapeHtml(p.label)}</option>`).join('')}
        </select>
        <button class="btn-primary" id="addEntryBtn">Add entry</button>
      </div>
    </div>

    <div class="entries-card" style="margin-top:16px;">
      <div style="padding:12px 16px;border-bottom:1px solid var(--line);font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--ink-soft);font-weight:600;background:#FCFBF8;display:flex;justify-content:space-between;align-items:center;">
        <span>Payments logged <span style="text-transform:none;letter-spacing:normal;font-weight:400;">— typing an amount marks whichever unpaid entries add up to it as paid</span></span>
        ${payments.length ? `<span style="text-transform:none;letter-spacing:normal;font-weight:600;color:var(--ink);">${fmtCAD(paymentsTotal)}</span>` : ''}
      </div>
      ${payments.length ? `
      <table>
        <thead><tr><th>Date</th><th>Amount</th><th>Source</th><th>Note</th><th></th></tr></thead>
        <tbody>
          ${payments.map(p => `<tr>
            <td>${fmtPaymentDate(p.createdAt)}</td>
            <td>${fmtCAD(p.amount)}</td>
            <td>${p.paymentSource ? (p.paymentSource === 'personal' ? 'Personal' : 'Official') : '—'}</td>
            <td class="note-col">${escapeHtml(p.note || '')}</td>
            <td><button class="timer-del-btn payment-del-btn" data-id="${p.id}">Delete</button></td>
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

    <div class="entries-card" style="margin-top:16px;">
      <div style="padding:12px 16px;border-bottom:1px solid var(--line);font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--ink-soft);font-weight:600;background:#FCFBF8;">
        Timer log <span style="text-transform:none;letter-spacing:normal;font-weight:400;">— self-reported by ${escapeHtml(worker.name)}, informational only, doesn't affect hours or pay</span>
      </div>
      ${timerSessions.length ? `
      <table>
        <thead><tr><th>Start</th><th>Stop</th><th>Duration</th><th>Note</th><th>Added</th><th></th></tr></thead>
        <tbody>
          ${timerSessions.map(t => `<tr>
            <td>${fmtWhenCell(t.startedAt)}</td>
            <td>${t.endedAt ? fmtWhenCell(t.endedAt) : '<span class="timer-running-tag">running…</span>'}</td>
            <td>${fmtDuration((t.endedAt || Date.now()) - t.startedAt)}</td>
            <td class="note-col">${escapeHtml(t.note || '')}</td>
            <td><input type="checkbox" class="timer-logged-checkbox" data-id="${t.id}" ${t.logged ? 'checked' : ''} title="I've checked this session and added its hours as a work hour entry"></td>
            <td>
              ${!t.endedAt ? `<button class="settings-toggle timer-stop-btn" data-id="${t.id}">Stop</button>` : ''}
              <button class="timer-del-btn" data-id="${t.id}">Delete</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
      ` : `<div class="empty-entries">No timer sessions logged yet.</div>`}
    </div>
  `;

  document.getElementById('fxQuickInput').onchange = async (e) => {
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

  document.getElementById('addEntryBtn').onclick = async () => {
    const date = document.getElementById('entryDate').value;
    const note = document.getElementById('entryNote').value.trim();
    const hours = parseFloat(document.getElementById('entryHours').value);
    const periodEl = document.getElementById('entryPeriod');
    const periodId = periodEl ? periodEl.value : undefined;
    if(!date || !hours || hours <= 0){
      alert('Enter a date and number of hours.');
      return;
    }
    try{
      await addEntryAdmin(worker.id, { date, hours, note, periodId });
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

  document.getElementById('logPaymentBtn').onclick = async () => {
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
        <div class="sub">CA$${state.settings.rate}/hr · ${state.settings.taxPercent}% tax · ${state.workers.length} worker${state.workers.length === 1 ? '' : 's'}</div>
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
            <td>${escapeHtml(r.worker.name)}</td>
            <td>${r.totals.totalHours.toFixed(2)}</td>
            <td>${fmtCAD(r.totals.gross)}</td>
            <td>${fmtCAD(r.totals.workerPay)}</td>
            <td>${fmtCAD(r.totals.unpaidWorkerPay)}</td>
            <td>${fmtCAD(r.totals.personalAdvance)}</td>
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
            <td>${escapeHtml(r.worker.name)}</td>
            <td>${r.running ? `<span class="timer-running-tag">🟢 Running since ${fmtClockBoth(r.running.startedAt)}</span>` : '—'}</td>
            <td>${r.last ? `${fmtDayTZ(r.last.startedAt, TZ_QC)} · ${fmtClockBoth(r.last.startedAt)} · ${fmtDuration((r.last.endedAt || Date.now()) - r.last.startedAt)}${r.last.endedAt ? '' : ' (running)'}` : '—'}</td>
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
