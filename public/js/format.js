export const TZ_QC = 'America/Toronto';
export const TZ_AB = 'America/Edmonton';
export const TZ_NG = 'Africa/Lagos';

export const fmtCAD = n => 'CA$' + n.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2});
export const fmtNGN = n => '₦' + n.toLocaleString(undefined, {minimumFractionDigits:0, maximumFractionDigits:0});

export function fmtDuration(ms){
  if(!ms || ms < 0) ms = 0;
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${String(m).padStart(2,'0')}m`;
}

export function fmtElapsedLive(ms){
  if(!ms || ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

export function fmtClockTZ(ts, tz){
  return new Date(ts).toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', timeZone: tz });
}

export function fmtDayTZ(ts, tz){
  return new Date(ts).toLocaleDateString('en-US', { month:'short', day:'numeric', timeZone: tz });
}

export function fmtClockBoth(ts){
  return `${fmtClockTZ(ts, TZ_QC)} QC · ${fmtClockTZ(ts, TZ_AB)} AB · ${fmtClockTZ(ts, TZ_NG)} NG`;
}

export function fmtPaymentDate(ts){
  return new Date(ts).toLocaleString('en-US', { month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

// Two-line cell: the date (Quebec-anchored) on top, all three zones' clock time below.
export function fmtWhenCell(ts){
  return `<div>${fmtDayTZ(ts, TZ_QC)}</div><div>${fmtClockBoth(ts)}</div>`;
}

export function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
