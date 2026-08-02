import { api } from './api.js';
import { state } from './state.js';
import { render } from './admin-render.js';

/* ---------------- Admin: data mutations ---------------- */

export async function saveSettings(){
  state.settings = await api('/api/admin/settings', { method: 'PUT', body: state.settings });
}

export async function fetchExchangeRate(){
  try{
    const res = await fetch('https://open.er-api.com/v6/latest/CAD');
    const data = await res.json();
    if(data && data.rates && data.rates.NGN){
      state.settings.exchangeRate = data.rates.NGN;
      await saveSettings();
      render();
    }
  }catch(e){
    console.error('exchange rate fetch failed', e);
    if(!state.settings.exchangeRate){
      state.settings.exchangeRate = 997;
      await saveSettings();
    }
    render();
  }
}

export async function addWorker(name, share){
  const w = await api('/api/admin/workers', { method: 'POST', body: { name, sharePercent: share } });
  state.workers.push(w);
  return w;
}

export async function addPeriod(label){
  const p = await api('/api/admin/periods', { method: 'POST', body: { label } });
  state.periods.push(p);
  return p;
}

export async function updateWorkerShare(workerId, share){
  const w = await api(`/api/admin/workers/${workerId}`, { method: 'PUT', body: { sharePercent: share } });
  const idx = state.workers.findIndex(x => x.id === workerId);
  if(idx !== -1) state.workers[idx] = w;
}

export async function resetWorkerPassword(workerId){
  return api(`/api/admin/workers/${workerId}/reset-password`, { method: 'POST' });
}

export async function addEntryAdmin(workerId, entry){
  const e = await api(`/api/admin/entries/${workerId}`, { method: 'POST', body: entry });
  if(!state.entries[workerId]) state.entries[workerId] = [];
  state.entries[workerId].push(e);
}

export async function deleteEntryAdmin(workerId, entryId){
  await api(`/api/admin/entries/${workerId}/${entryId}`, { method: 'DELETE' });
  state.entries[workerId] = (state.entries[workerId] || []).filter(e => e.id !== entryId);
}

export async function setEntryPaid(workerId, entryId, paid, paymentSource){
  const updated = await api(`/api/admin/entries/${workerId}/${entryId}/paid`, { method: 'PUT', body: { paid, paymentSource } });
  const list = state.entries[workerId] || [];
  const idx = list.findIndex(e => e.id === entryId);
  if(idx !== -1) list[idx] = updated;
}

export async function markAllPaid(workerId, paymentSource){
  await api(`/api/admin/entries/${workerId}/mark-all-paid`, { method: 'POST', body: { paymentSource } });
  const list = state.entries[workerId] || [];
  list.forEach(e => { e.paid = true; e.paymentSource = paymentSource; });
}

export async function addPaymentAdmin(workerId, payment){
  const p = await api(`/api/admin/payments/${workerId}`, { method: 'POST', body: payment });
  if(!state.payments[workerId]) state.payments[workerId] = [];
  state.payments[workerId].unshift(p);
  const list = state.entries[workerId] || [];
  (p.matchedEntryIds || []).forEach(id => {
    const entry = list.find(e => e.id === id);
    if(entry){ entry.paid = true; entry.paymentSource = p.paymentSource; }
  });
  return p;
}

export async function deletePaymentAdmin(workerId, paymentId){
  const res = await api(`/api/admin/payments/${workerId}/${paymentId}`, { method: 'DELETE' });
  state.payments[workerId] = (state.payments[workerId] || []).filter(p => p.id !== paymentId);
  const list = state.entries[workerId] || [];
  (res.revertedEntryIds || []).forEach(id => {
    const entry = list.find(e => e.id === id);
    if(entry){ entry.paid = false; entry.paymentSource = null; }
  });
}

export async function deleteWorker(workerId, password){
  await api(`/api/admin/workers/${workerId}`, { method: 'DELETE', body: { password } });
  state.workers = state.workers.filter(w => w.id !== workerId);
  delete state.entries[workerId];
}
