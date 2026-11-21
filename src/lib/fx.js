import { db } from '../db/client.js';

// Same free rate service the admin view already uses for CAD→NGN; it updates once a day.
const USD_RATES_URL = 'https://open.er-api.com/v6/latest/USD';
const CACHE_TTL_MS = 60 * 60 * 1000;

let cached = null; // { rate, fetchedAt } — survives across requests on a warm instance

async function fetchLiveUsdCad() {
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.rate;
  try {
    const res = await fetch(USD_RATES_URL, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const rate = (await res.json())?.rates?.CAD;
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return null;
    cached = { rate, fetchedAt: Date.now() };
    return rate;
  } catch {
    return null;
  }
}

// CAD per 1 USD, right now. Falls back to the last rate this account successfully used if the
// rate service is unreachable, and returns null only when neither is available — callers must
// refuse to lock a rate rather than guess one.
export async function resolveUsdCadRate(accountId) {
  const live = await fetchLiveUsdCad();
  if (live) {
    await db.execute({ sql: 'UPDATE settings SET usd_cad_rate = ? WHERE account_id = ?', args: [live, accountId] });
    return live;
  }
  const row = (await db.execute({ sql: 'SELECT usd_cad_rate FROM settings WHERE account_id = ?', args: [accountId] })).rows[0];
  return row?.usd_cad_rate || null;
}

// A job's hourly rate in CAD for one entry. USD jobs convert at the rate locked onto that
// entry when it was logged; fallbackUsdCad only applies to entries that somehow lack one.
// Mirrors cadHourlyRate in public/js/state.js — keep the two in sync.
export function cadHourlyRate(rate, currency, entryUsdCad, fallbackUsdCad) {
  if (currency !== 'USD') return rate || 0;
  return (rate || 0) * (entryUsdCad || fallbackUsdCad || 0);
}
