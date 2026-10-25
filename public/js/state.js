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

/* ---------------- Calendar-month progression (separate from admin-defined periods above) ---------------- */

// Day-by-day values through one calendar month, for the "Daily" chart view — that day's own
// hours/pay/take, so a lighter day drops back down and a day with nothing logged is 0.
// entries: [{ date, hours, workerPay, take? }] — the caller resolves the money fields however
// suits its context (via calcEntryRow for admin views, or already-computed for the
// worker-facing view, which never supplies take). yearMonth is a "YYYY-MM" string.
export function calcMonthlyProgression(entries, yearMonth){
  const [year, month] = yearMonth.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const todayStr = new Date().toISOString().slice(0, 10);
  const isCurrentMonth = yearMonth === todayStr.slice(0, 7);
  const lastDay = isCurrentMonth ? Number(todayStr.slice(8, 10)) : daysInMonth;

  const hoursByDay = new Array(daysInMonth + 1).fill(0);
  const payByDay = new Array(daysInMonth + 1).fill(0);
  const takeByDay = new Array(daysInMonth + 1).fill(0);
  entries.forEach(e => {
    if(e.date.slice(0, 7) !== yearMonth) return;
    const day = Number(e.date.slice(8, 10));
    hoursByDay[day] += e.hours;
    payByDay[day] += e.workerPay;
    takeByDay[day] += e.take || 0;
  });

  const dailyHoursPoints = [], dailyPayPoints = [], dailyTakePoints = [];
  let totalHours = 0, totalPay = 0, totalTake = 0;
  for(let d = 1; d <= lastDay; d++){
    totalHours += hoursByDay[d];
    totalPay += payByDay[d];
    totalTake += takeByDay[d];
    dailyHoursPoints.push({ x: d, y: hoursByDay[d] });
    dailyPayPoints.push({ x: d, y: payByDay[d] });
    dailyTakePoints.push({ x: d, y: takeByDay[d] });
  }
  return { dailyHoursPoints, dailyPayPoints, dailyTakePoints, totalHours, totalPay, totalTake, daysInMonth, lastDay };
}

// Totals per calendar month across every month with data, oldest first — the "Overall" view
// of the progression chart (as opposed to "Daily", which is day-by-day within one month).
// entries: [{ date, hours, workerPay, take? }].
export function calcAllMonthsTotals(entries){
  const byMonth = new Map();
  entries.forEach(e => {
    const ym = e.date.slice(0, 7);
    if(!byMonth.has(ym)) byMonth.set(ym, { hours: 0, pay: 0, take: 0 });
    const bucket = byMonth.get(ym);
    bucket.hours += e.hours;
    bucket.pay += e.workerPay;
    bucket.take += e.take || 0;
  });
  const months = Array.from(byMonth.keys()).sort();
  const series = key => months.map((m, i) => ({ x: i + 1, y: byMonth.get(m)[key] }));
  const sum = key => months.reduce((s, m) => s + byMonth.get(m)[key], 0);
  return {
    months,
    hoursPoints: series('hours'), payPoints: series('pay'), takePoints: series('take'),
    totalHours: sum('hours'), totalPay: sum('pay'), totalTake: sum('take'),
    xMax: Math.max(1, months.length),
  };
}

// Every month with at least one entry, plus the current real month (so the dropdown is never
// empty on a fresh account), newest first.
export function getAvailableMonths(entries){
  const set = new Set(entries.map(e => e.date.slice(0, 7)));
  set.add(new Date().toISOString().slice(0, 7));
  return Array.from(set).sort().reverse();
}

export function monthLabel(yearMonth){
  const [year, month] = yearMonth.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

export function shortMonthLabel(yearMonth){
  const [year, month] = yearMonth.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'short' });
}

// Gross/tax/worker-pay/hours for one calendar month, team-wide — feeds the admin's "all
// metrics" stat-tile row. entriesWithShare: [{ entry, sharePct }].
export function calcMonthTotals(entriesWithShare, yearMonth){
  let totalHours = 0, gross = 0, tax = 0, workerPay = 0, workerPayNGN = 0;
  entriesWithShare.forEach(({ entry, sharePct }) => {
    if(entry.date.slice(0, 7) !== yearMonth) return;
    const row = calcEntryRow(entry, sharePct);
    totalHours += entry.hours;
    gross += row.gross;
    tax += row.tax;
    workerPay += row.workerPay;
    workerPayNGN += row.workerPayNGN;
  });
  const myTake = gross - tax - workerPay;
  return { totalHours, gross, tax, workerPay, myTake, workerPayNGN };
}
