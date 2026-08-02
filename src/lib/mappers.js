export function mapSettings(row) {
  return {
    rate: row.rate,
    taxPercent: row.tax_percent,
    exchangeRate: row.exchange_rate,
    exchangeManual: !!row.exchange_manual,
  };
}

export function mapWorker(row) {
  return { id: row.id, name: row.name, sharePercent: row.share_percent, createdAt: row.created_at };
}

export function mapEntry(row) {
  return {
    id: row.id,
    date: row.date,
    hours: row.hours,
    note: row.note || '',
    paid: !!row.paid,
    paymentSource: row.payment_source || null,
    periodId: row.period_id || null,
  };
}

export function mapPeriod(row) {
  return { id: row.id, label: row.label, startedAt: row.started_at };
}

export function mapTimerSession(row) {
  return {
    id: row.id,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? null,
    note: row.note || '',
  };
}

export function mapPayment(row) {
  return {
    id: row.id,
    amount: row.amount,
    paymentSource: row.payment_source || null,
    note: row.note || '',
    createdAt: row.created_at,
  };
}
