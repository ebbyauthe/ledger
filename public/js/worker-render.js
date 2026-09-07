import { api } from './api.js';
import { groupEntriesByPeriod } from './state.js';
import { fmtCAD, fmtNGN, fmtElapsedLive, fmtDuration, fmtWhenCell, escapeHtml } from './format.js';
import { openModal } from './modal.js';

let workerNames = [];
let workerViewSelectedId = null;
let workerSummary = null;
let workerTimerTickHandle = null;
let workerViewTab = 'overview';

function clearWorkerTimerTick(){
  if(workerTimerTickHandle) clearInterval(workerTimerTickHandle);
  workerTimerTickHandle = null;
}

/* ---------------- Worker view ---------------- */

export async function bootWorkerView(){
  try{
    const session = await api('/api/workers/session');
    if(session && session.workerId){
      workerViewSelectedId = session.workerId;
      await loadWorkerSummary();
      return;
    }
  }catch(e){}
  renderWorkerPicker();
}

async function renderWorkerPicker(){
  try{
    workerNames = await api('/api/worker-names');
  }catch(e){
    workerNames = [];
  }
  paintWorkerPicker();
}

function paintWorkerPicker(){
  clearWorkerTimerTick();
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="worker-view-wrap">
      <div class="worker-view-card">
        <h2 class="wv-title">Who are you?</h2>
        <p class="wv-sub">Pick your name to see your hours and earnings.</p>
        <ul class="wv-picker">
          ${workerNames.map(w => `<li data-id="${w.id}">${escapeHtml(w.name)}</li>`).join('') || '<li class="wv-none">No workers added yet.</li>'}
        </ul>
      </div>
    </div>
  `;
  app.querySelectorAll('.wv-picker li[data-id]').forEach(li => {
    li.onclick = () => {
      const worker = workerNames.find(w => w.id === li.dataset.id);
      paintWorkerLogin(worker);
    };
  });
}

function paintWorkerLogin(worker, errorMsg){
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="worker-view-wrap">
      <div class="worker-view-card">
        <button class="settings-toggle" id="wvLoginBack">← Not ${escapeHtml(worker.name)}?</button>
        <h2 class="wv-title">${escapeHtml(worker.name)}</h2>
        <p class="wv-sub">Enter your password to continue.</p>
        <div class="field">
          <label>Password</label>
          <input type="password" id="wvPassword" autofocus>
        </div>
        ${errorMsg ? `<p class="error-text">${escapeHtml(errorMsg)}</p>` : ''}
        <button class="btn-primary" id="wvLoginBtn" style="width:100%;">Continue</button>
      </div>
    </div>
  `;
  document.getElementById('wvLoginBack').onclick = () => paintWorkerPicker();
  const submit = async () => {
    const password = document.getElementById('wvPassword').value;
    try{
      await api(`/api/workers/${worker.id}/login`, { method: 'POST', body: { password } });
      workerViewSelectedId = worker.id;
      await loadWorkerSummary();
    }catch(e){
      paintWorkerLogin(worker, e.message === 'no password set, ask for a password reset'
        ? 'No password set yet — ask Ebenezer to set one for you.'
        : 'Wrong password.');
    }
  };
  document.getElementById('wvLoginBtn').onclick = submit;
  document.getElementById('wvPassword').addEventListener('keydown', (e) => { if(e.key === 'Enter') submit(); });
}

async function loadWorkerSummary(){
  workerSummary = await api(`/api/workers/${workerViewSelectedId}/summary`);
  paintWorkerSummary();
}

function paintWorkerSummary(){
  const w = workerSummary;
  const entryGroups = groupEntriesByPeriod(w.entries, w.periods || []);
  const periodSummaries = entryGroups.map(g => {
    const unpaid = g.entries.filter(e => !e.paid);
    return {
      period: g.period,
      hours: g.entries.reduce((s,e) => s + e.hours, 0),
      workerPay: g.entries.reduce((s,e) => s + e.workerPay, 0),
      workerPayNGN: g.entries.reduce((s,e) => s + e.workerPayNGN, 0),
      unpaidWorkerPay: unpaid.reduce((s,e) => s + e.workerPay, 0),
      unpaidWorkerPayNGN: unpaid.reduce((s,e) => s + e.workerPayNGN, 0),
    };
  });
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="worker-view-wrap has-tabs">
      <div class="worker-view-card wide">
        <div class="wv-header">
          <button class="settings-toggle" id="wvSwitch">← Not ${escapeHtml(w.name)}? Switch</button>
          <button class="settings-toggle" id="wvChangePassword">Change password</button>
        </div>
        <h2 class="wv-title">${escapeHtml(w.name)}</h2>
        <p class="wv-sub">Your hours and earnings</p>

        <div class="wv-tabs">
          <button class="wv-tab ${workerViewTab === 'overview' ? 'active' : ''}" data-tab="overview"><span class="wv-tab-icon">🏠</span><span class="wv-tab-label">Overview</span></button>
          <button class="wv-tab ${workerViewTab === 'monthly' ? 'active' : ''}" data-tab="monthly"><span class="wv-tab-icon">📅</span><span class="wv-tab-label">Monthly</span></button>
          <button class="wv-tab ${workerViewTab === 'hours' ? 'active' : ''}" data-tab="hours"><span class="wv-tab-icon">📋</span><span class="wv-tab-label">Hours</span></button>
          <button class="wv-tab ${workerViewTab === 'timer' ? 'active' : ''}" data-tab="timer"><span class="wv-tab-icon">⏱️</span><span class="wv-tab-label">Timer</span></button>
        </div>

        ${workerViewTab === 'overview' ? `
        <div class="receipt">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap;">
            <div>
              <div class="label">Timer</div>
              <div class="value" id="timerElapsedValue">${w.runningTimer ? fmtElapsedLive(Date.now() - w.runningTimer.startedAt) : '—'}</div>
            </div>
            ${w.runningTimer ? `
              <button class="btn-primary" id="timerStopBtn" style="background:var(--rust);">Stop timer</button>
            ` : `
              <div style="display:flex;gap:8px;align-items:center;flex:1;min-width:200px;">
                <input type="text" id="timerNoteInput" class="timer-note-input" placeholder="What are you working on? (optional)">
                <button class="btn-primary" id="timerStartBtn">Start timer</button>
              </div>
            `}
          </div>
          ${w.runningTimer && w.runningTimer.note ? `<div class="fx-note">${escapeHtml(w.runningTimer.note)}</div>` : ''}
          <p class="fx-note" style="margin-top:8px;">This timer is just a log for Ebenezer — it doesn't add to your logged hours or pay.</p>
        </div>

        <div class="receipt">
          <div class="receipt-grid wv-grid">
            <div class="receipt-item">
              <div class="label">Hours logged</div>
              <div class="value">${w.totalHours.toFixed(1)}</div>
            </div>
            <div class="receipt-item highlight">
              <div class="label">Earned (CAD)</div>
              <div class="value">${fmtCAD(w.workerPay)}</div>
            </div>
            <div class="receipt-item highlight">
              <div class="label">Earned (₦)</div>
              <div class="value">${fmtNGN(w.workerPayNGN)}</div>
            </div>
          </div>
          <hr class="receipt-divider">
          <div class="receipt-item deduction">
            <div class="label">Still owed to you</div>
            <div class="value">${fmtCAD(w.unpaidWorkerPay)} · ${fmtNGN(w.unpaidWorkerPayNGN)}</div>
          </div>
        </div>
        ` : ''}

        ${workerViewTab === 'monthly' ? `
          ${periodSummaries.length ? `
          <div style="margin: 0 0 10px; font-size:13px; font-weight:600; color: var(--ink-soft); text-transform:uppercase; letter-spacing:0.06em;">All-time</div>
          <div class="receipt">
            <div class="receipt-grid wv-grid">
              <div class="receipt-item">
                <div class="label">Hours logged</div>
                <div class="value">${w.totalHours.toFixed(1)}</div>
              </div>
              <div class="receipt-item highlight">
                <div class="label">Earned (CAD)</div>
                <div class="value">${fmtCAD(w.workerPay)}</div>
              </div>
              <div class="receipt-item highlight">
                <div class="label">Earned (₦)</div>
                <div class="value">${fmtNGN(w.workerPayNGN)}</div>
              </div>
            </div>
            <hr class="receipt-divider">
            <div class="receipt-item deduction">
              <div class="label">Still owed to you</div>
              <div class="value">${fmtCAD(w.unpaidWorkerPay)} · ${fmtNGN(w.unpaidWorkerPayNGN)}</div>
            </div>
          </div>
          ${periodSummaries.map(p => `
          <div style="margin: 20px 0 10px; font-size:13px; font-weight:600; color: var(--ink-soft); text-transform:uppercase; letter-spacing:0.06em;">${escapeHtml(p.period.label)}</div>
          <div class="receipt">
            <div class="receipt-grid wv-grid">
              <div class="receipt-item">
                <div class="label">Hours logged</div>
                <div class="value">${p.hours.toFixed(1)}</div>
              </div>
              <div class="receipt-item highlight">
                <div class="label">Earned (CAD)</div>
                <div class="value">${fmtCAD(p.workerPay)}</div>
              </div>
              <div class="receipt-item highlight">
                <div class="label">Earned (₦)</div>
                <div class="value">${fmtNGN(p.workerPayNGN)}</div>
              </div>
            </div>
            <hr class="receipt-divider">
            <div class="receipt-item deduction">
              <div class="label">Still owed to you</div>
              <div class="value">${fmtCAD(p.unpaidWorkerPay)} · ${fmtNGN(p.unpaidWorkerPayNGN)}</div>
            </div>
          </div>
          `).join('')}
          ` : `<div class="entries-card"><div class="empty-entries">No hours logged yet.</div></div>`}
        ` : ''}

        ${workerViewTab === 'hours' ? `
        <div class="entries-card">
          ${w.entries.length ? entryGroups.map(g => `
          <div style="padding:10px 16px;border-bottom:1px solid var(--line);font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--ink-soft);font-weight:600;background:#FCFBF8;display:flex;justify-content:space-between;align-items:center;">
            <span>${escapeHtml(g.period.label)}</span>
            <span style="text-transform:none;letter-spacing:normal;">${g.entries.reduce((s,e) => s + e.hours, 0).toFixed(2)}h · ${fmtCAD(g.entries.reduce((s,e) => s + e.workerPay, 0))}</span>
          </div>
          <table>
            <thead><tr><th>Date</th><th>Hours</th><th>Earned (CAD)</th><th>Earned (₦)</th><th>Paid</th></tr></thead>
            <tbody>
              ${g.entries.map(e => `<tr>
                <td data-label="Date">${e.date}</td>
                <td data-label="Hours">${e.hours.toFixed(2)}</td>
                <td data-label="Earned (CAD)">${fmtCAD(e.workerPay)}</td>
                <td data-label="Earned (₦)">${fmtNGN(e.workerPayNGN)}</td>
                <td data-label="Paid">${e.paid ? '✓' : '—'}</td>
              </tr>`).join('')}
            </tbody>
          </table>`).join('') : `<div class="empty-entries">No hours logged yet.</div>`}
        </div>
        ` : ''}

        ${workerViewTab === 'timer' ? `
        <div class="entries-card">
          ${w.timerSessions.length ? `
          <table>
            <thead><tr><th>Start</th><th>Stop</th><th>Duration</th><th>Note</th><th>Added to hours</th></tr></thead>
            <tbody>
              ${w.timerSessions.map(t => `<tr>
                <td data-label="Start">${fmtWhenCell(t.startedAt)}</td>
                <td data-label="Stop">${t.endedAt ? fmtWhenCell(t.endedAt) : '<span class="timer-running-tag">running…</span>'}</td>
                <td class="timer-row-duration" data-label="Duration" data-started="${t.startedAt}" data-ended="${t.endedAt || ''}">${fmtDuration((t.endedAt || Date.now()) - t.startedAt)}</td>
                <td class="note-col" data-label="Note">${escapeHtml(t.note || '')}</td>
                <td data-label="Added to hours">${t.logged ? '✓' : '—'}</td>
              </tr>`).join('')}
            </tbody>
          </table>
          ` : `<div class="empty-entries">No timer sessions yet. Start one from the Overview tab.</div>`}
        </div>
        ` : ''}
      </div>
    </div>
  `;
  app.querySelectorAll('.wv-tab').forEach(btn => {
    btn.onclick = () => {
      workerViewTab = btn.dataset.tab;
      paintWorkerSummary();
    };
  });
  document.getElementById('wvSwitch').onclick = async () => {
    clearWorkerTimerTick();
    try{ await api('/api/workers/logout', { method: 'POST' }); }catch(e){}
    workerViewSelectedId = null;
    workerSummary = null;
    workerViewTab = 'overview';
    renderWorkerPicker();
  };
  const timerStartBtn = document.getElementById('timerStartBtn');
  if(timerStartBtn){
    timerStartBtn.onclick = async () => {
      const note = document.getElementById('timerNoteInput').value.trim();
      timerStartBtn.disabled = true;
      try{
        await api(`/api/workers/${w.id}/timer/start`, { method: 'POST', body: { note } });
        await loadWorkerSummary();
      }catch(e){
        alert('Could not start timer: ' + e.message);
        timerStartBtn.disabled = false;
      }
    };
  }
  const timerStopBtn = document.getElementById('timerStopBtn');
  if(timerStopBtn){
    timerStopBtn.onclick = async () => {
      timerStopBtn.disabled = true;
      try{
        await api(`/api/workers/${w.id}/timer/stop`, { method: 'POST' });
        await loadWorkerSummary();
      }catch(e){
        alert('Could not stop timer: ' + e.message);
        timerStopBtn.disabled = false;
      }
    };
  }
  clearWorkerTimerTick();
  if(w.runningTimer){
    const startedAt = w.runningTimer.startedAt;
    workerTimerTickHandle = setInterval(() => {
      const el = document.getElementById('timerElapsedValue');
      if(el) el.textContent = fmtElapsedLive(Date.now() - startedAt);
      document.querySelectorAll('.timer-row-duration[data-ended=""]').forEach(td => {
        td.textContent = fmtDuration(Date.now() - startedAt);
      });
    }, 1000);
  }
  document.getElementById('wvChangePassword').onclick = () => {
    openModal(`
      <h3>Change password</h3>
      <div class="field">
        <label>Current password</label>
        <input type="password" id="modalCurrentPassword" autofocus>
      </div>
      <div class="field">
        <label>New password</label>
        <input type="password" id="modalNewPassword">
        <div class="hint">At least 6 characters.</div>
      </div>
      <div class="field">
        <label>Confirm new password</label>
        <input type="password" id="modalConfirmPassword">
      </div>
    `, async () => {
      const currentPassword = document.getElementById('modalCurrentPassword').value;
      const newPassword = document.getElementById('modalNewPassword').value;
      const confirmPassword = document.getElementById('modalConfirmPassword').value;
      if(newPassword !== confirmPassword){
        alert('New password and confirmation do not match.');
        return false;
      }
      try{
        await api(`/api/workers/${w.id}/password`, { method: 'PUT', body: { currentPassword, newPassword } });
        alert('Password changed.');
        return true;
      }catch(e){
        alert('Could not change password: ' + e.message);
        return false;
      }
    });
  };
}
