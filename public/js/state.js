export const RATE_DEFAULT = 21.3;
export const TAX_DEFAULT = 20;
export const SHARE_DEFAULT = 50;
export const OVERVIEW_ID = '__overview__';
export const MONTHLY_ID = '__monthly__';
export const JOBS_ID = '__jobs__';

export const state = {
  settings: { exchangeRate: null, exchangeManual: false },
  workers: [], entries: {}, timers: {}, payments: {}, periods: [], jobs: [],
};

// `state` gets reassigned wholesale in a couple of places (loading fresh data from the server).
// Other modules hold a live import binding to this exact object, so we mutate its contents in
// place rather than rebind the export — replaceState keeps everyone's reference valid.
export function replaceState(newState){
  Object.keys(state).forEach(k => delete state[k]);
  Object.assign(state, newState);
}

/* ---------------- Pay math (pure, operates on already-loaded state) ---------------- */

// Resolves the rate/tax/fx a given job should use for pay math, falling back to this
// module's defaults if the job can't be found (shouldn't normally happen — every account
// always has at least one job).
export function findJob(jobId){
  return state.jobs.find(j => j.id === jobId) || null;
}

export function resolveJobRate(jobId){
  const job = findJob(jobId);
  if(!job) return { rate: RATE_DEFAULT, taxPercent: TAX_DEFAULT, exchangeRate: state.settings.exchangeRate || 0 };
  const exchangeRate = job.fxMode === 'custom' ? (job.exchangeRate || 0) : (state.settings.exchangeRate || 0);
  return { rate: job.rate, taxPercent: job.taxPercent, exchangeRate };
}

export function calcEntryRow(entry, sharePct){
  const { rate, taxPercent, exchangeRate } = resolveJobRate(entry.jobId);
  const gross = entry.hours * rate;
  const tax = gross * taxPercent / 100;
  const workerPay = gross * sharePct / 100;
  const workerPayNGN = workerPay * exchangeRate;
  return { gross, tax, workerPay, workerPayNGN };
}

export function calcWorkerTotals(workerId){
  const worker = state.workers.find(w => w.id === workerId);
  const list = state.entries[workerId] || [];
  const sharePct = worker ? worker.sharePercent : SHARE_DEFAULT;

  let totalHours = 0, gross = 0, tax = 0, workerPay = 0, workerPayNGN = 0;
  let unpaidWorkerPay = 0, unpaidWorkerPayNGN = 0;
  let personalAdvance = 0, personalAdvanceNGN = 0;
  list.forEach(e => {
    const row = calcEntryRow(e, sharePct);
    totalHours += e.hours;
    gross += row.gross;
    tax += row.tax;
    workerPay += row.workerPay;
    workerPayNGN += row.workerPayNGN;
    if(!e.paid){ unpaidWorkerPay += row.workerPay; unpaidWorkerPayNGN += row.workerPayNGN; }
    if(e.paid && e.paymentSource === 'personal'){ personalAdvance += row.workerPay; personalAdvanceNGN += row.workerPayNGN; }
  });
  const myTake = gross - tax - workerPay;

  return { totalHours, gross, tax, workerPay, myTake, workerPayNGN, unpaidWorkerPay, unpaidWorkerPayNGN, personalAdvance, personalAdvanceNGN };
}

export function calcAllWorkersTotals(){
  let totalHours = 0, gross = 0, tax = 0, workerPay = 0, myTake = 0, workerPayNGN = 0;
  let unpaidWorkerPay = 0, unpaidWorkerPayNGN = 0, personalAdvance = 0, personalAdvanceNGN = 0;
  const perWorker = state.workers.map(w => {
    const t = calcWorkerTotals(w.id);
    totalHours += t.totalHours;
    gross += t.gross;
    tax += t.tax;
    workerPay += t.workerPay;
    myTake += t.myTake;
    workerPayNGN += t.workerPayNGN;
    unpaidWorkerPay += t.unpaidWorkerPay;
    unpaidWorkerPayNGN += t.unpaidWorkerPayNGN;
    personalAdvance += t.personalAdvance;
    personalAdvanceNGN += t.personalAdvanceNGN;
    return { worker: w, totals: t };
  });
  return {
    totalHours, gross, tax, workerPay, myTake, workerPayNGN,
    unpaidWorkerPay, unpaidWorkerPayNGN, personalAdvance, personalAdvanceNGN,
    perWorker,
  };
}

export function isWorkerClockedIn(workerId){
  return (state.timers[workerId] || []).some(t => !t.endedAt);
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

// Ebenezer's own invoice-payment cycle from his client, not when workers get paid: the last
// day of the period's calendar month (taken from when the period was started), plus 30 days,
// shifted back to the nearest Friday if that lands on a weekend.
export function computePaymentDate(periodStartedAt){
  const started = new Date(periodStartedAt);
  const lastDayOfMonth = new Date(started.getFullYear(), started.getMonth() + 1, 0);
  const paymentDate = new Date(lastDayOfMonth);
  paymentDate.setDate(paymentDate.getDate() + 30);
  const dayOfWeek = paymentDate.getDay();
  if(dayOfWeek === 0) paymentDate.setDate(paymentDate.getDate() - 2); // Sunday -> Friday
  if(dayOfWeek === 6) paymentDate.setDate(paymentDate.getDate() - 1); // Saturday -> Friday
  return paymentDate;
}

export function calcPeriodTotals(periodId){
  let totalHours = 0, gross = 0, tax = 0, workerPay = 0, workerPayNGN = 0;
  let unpaidWorkerPay = 0, unpaidWorkerPayNGN = 0, personalAdvance = 0, personalAdvanceNGN = 0;
  state.workers.forEach(w => {
    const sharePct = w.sharePercent;
    (state.entries[w.id] || []).forEach(e => {
      if(e.periodId !== periodId) return;
      const row = calcEntryRow(e, sharePct);
      totalHours += e.hours;
      gross += row.gross;
      tax += row.tax;
      workerPay += row.workerPay;
      workerPayNGN += row.workerPayNGN;
      if(!e.paid){ unpaidWorkerPay += row.workerPay; unpaidWorkerPayNGN += row.workerPayNGN; }
      if(e.paid && e.paymentSource === 'personal'){ personalAdvance += row.workerPay; personalAdvanceNGN += row.workerPayNGN; }
    });
  });
  const myTake = gross - tax - workerPay;
  return {
    totalHours, gross, tax, workerPay, myTake, workerPayNGN,
    unpaidWorkerPay, unpaidWorkerPayNGN, personalAdvance, personalAdvanceNGN,
  };
}

export function calcAllPeriodsTotals(){
  const sortedPeriods = state.periods.slice().sort((a,b) => b.startedAt - a.startedAt);
  return sortedPeriods.map(p => ({ period: p, totals: calcPeriodTotals(p.id) }));
}
