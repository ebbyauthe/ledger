export const RATE_DEFAULT = 21.3;
export const TAX_DEFAULT = 20;
export const SHARE_DEFAULT = 50;
export const OVERVIEW_ID = '__overview__';
export const MONTHLY_ID = '__monthly__';

export const state = {
  settings: { rate: RATE_DEFAULT, taxPercent: TAX_DEFAULT, exchangeRate: null, exchangeManual: false },
  workers: [], entries: {}, timers: {}, payments: {}, periods: [],
};

// `state` gets reassigned wholesale in a couple of places (loading fresh data from the server).
// Other modules hold a live import binding to this exact object, so we mutate its contents in
// place rather than rebind the export — replaceState keeps everyone's reference valid.
export function replaceState(newState){
  Object.keys(state).forEach(k => delete state[k]);
  Object.assign(state, newState);
}

/* ---------------- Pay math (pure, operates on already-loaded state) ---------------- */

export function calcWorkerTotals(workerId){
  const worker = state.workers.find(w => w.id === workerId);
  const list = state.entries[workerId] || [];
  const rate = state.settings.rate;
  const taxPct = state.settings.taxPercent;
  const sharePct = worker ? worker.sharePercent : SHARE_DEFAULT;
  const fx = state.settings.exchangeRate || 0;

  let totalHours = 0, gross = 0, unpaidHours = 0, personalHours = 0;
  list.forEach(e => {
    totalHours += e.hours;
    gross += e.hours * rate;
    if(!e.paid) unpaidHours += e.hours;
    if(e.paid && e.paymentSource === 'personal') personalHours += e.hours;
  });
  const tax = gross * taxPct / 100;
  const workerPay = gross * sharePct / 100;
  const myTake = gross - tax - workerPay;
  const workerPayNGN = workerPay * fx;

  const unpaidGross = unpaidHours * rate;
  const unpaidWorkerPay = unpaidGross * sharePct / 100;
  const unpaidWorkerPayNGN = unpaidWorkerPay * fx;

  const personalGross = personalHours * rate;
  const personalAdvance = personalGross * sharePct / 100;
  const personalAdvanceNGN = personalAdvance * fx;

  return { totalHours, gross, tax, workerPay, myTake, workerPayNGN, unpaidWorkerPay, unpaidWorkerPayNGN, personalAdvance, personalAdvanceNGN };
}

export function calcAllWorkersTotals(){
  const fx = state.settings.exchangeRate || 0;
  let totalHours = 0, gross = 0, tax = 0, workerPay = 0, myTake = 0, unpaidWorkerPay = 0, personalAdvance = 0;
  const perWorker = state.workers.map(w => {
    const t = calcWorkerTotals(w.id);
    totalHours += t.totalHours;
    gross += t.gross;
    tax += t.tax;
    workerPay += t.workerPay;
    myTake += t.myTake;
    unpaidWorkerPay += t.unpaidWorkerPay;
    personalAdvance += t.personalAdvance;
    return { worker: w, totals: t };
  });
  return {
    totalHours, gross, tax, workerPay, myTake, unpaidWorkerPay, personalAdvance,
    workerPayNGN: workerPay * fx, unpaidWorkerPayNGN: unpaidWorkerPay * fx, personalAdvanceNGN: personalAdvance * fx,
    perWorker,
  };
}

export function isWorkerClockedIn(workerId){
  return (state.timers[workerId] || []).some(t => !t.endedAt);
}

export function calcEntryRow(hours, sharePct){
  const rate = state.settings.rate;
  const taxPct = state.settings.taxPercent;
  const fx = state.settings.exchangeRate || 0;
  const gross = hours * rate;
  const tax = gross * taxPct / 100;
  const workerPay = gross * sharePct / 100;
  const workerPayNGN = workerPay * fx;
  return { gross, tax, workerPay, workerPayNGN };
}

// Groups an (already date-sorted) entries array by period, newest period first.
// Entries with no matching period (shouldn't normally happen) land in a trailing "Unassigned" bucket.
export function groupEntriesByPeriod(entries, periods){
  const byId = new Map();
  entries.forEach(e => {
    const key = e.periodId || '__none__';
    if(!byId.has(key)) byId.set(key, []);
    byId.get(key).push(e);
  });
  const sortedPeriods = periods.slice().sort((a,b) => b.startedAt - a.startedAt);
  const groups = [];
  sortedPeriods.forEach(p => {
    if(byId.has(p.id)) groups.push({ period: p, entries: byId.get(p.id) });
  });
  if(byId.has('__none__')) groups.push({ period: { id: '__none__', label: 'Unassigned' }, entries: byId.get('__none__') });
  return groups;
}

export function currentPeriod(){
  return state.periods.slice().sort((a,b) => b.startedAt - a.startedAt)[0] || null;
}

export function calcPeriodTotals(periodId){
  const rate = state.settings.rate;
  const taxPct = state.settings.taxPercent;
  const fx = state.settings.exchangeRate || 0;
  let totalHours = 0, gross = 0, tax = 0, workerPay = 0, unpaidWorkerPay = 0;
  state.workers.forEach(w => {
    const sharePct = w.sharePercent;
    (state.entries[w.id] || []).forEach(e => {
      if(e.periodId !== periodId) return;
      const g = e.hours * rate;
      const wp = g * sharePct / 100;
      totalHours += e.hours;
      gross += g;
      tax += g * taxPct / 100;
      workerPay += wp;
      if(!e.paid) unpaidWorkerPay += wp;
    });
  });
  const myTake = gross - tax - workerPay;
  return { totalHours, gross, tax, workerPay, myTake, workerPayNGN: workerPay * fx, unpaidWorkerPay, unpaidWorkerPayNGN: unpaidWorkerPay * fx };
}

export function calcAllPeriodsTotals(){
  const sortedPeriods = state.periods.slice().sort((a,b) => b.startedAt - a.startedAt);
  return sortedPeriods.map(p => ({ period: p, totals: calcPeriodTotals(p.id) }));
}
