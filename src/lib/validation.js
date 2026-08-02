export function isValidDate(d) {
  return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
}

export function parseEntryInput(body) {
  const { date, hours, note, periodId } = body || {};
  if (!isValidDate(date)) return null;
  if (typeof hours !== 'number' || !Number.isFinite(hours) || hours <= 0 || hours > 24) return null;
  return { date, hours, note, periodId: typeof periodId === 'string' ? periodId : null };
}
