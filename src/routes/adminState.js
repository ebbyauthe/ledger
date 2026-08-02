import { Router } from 'express';
import { db } from '../db/client.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { mapSettings, mapWorker, mapEntry, mapTimerSession, mapPayment, mapPeriod } from '../lib/mappers.js';

const router = Router();

router.get('/state', requireAdmin, async (req, res) => {
  const settingsRow = (await db.execute('SELECT * FROM settings WHERE id = 1')).rows[0];
  const workerRows = (await db.execute('SELECT * FROM workers ORDER BY created_at ASC')).rows;
  const entryRows = (await db.execute('SELECT * FROM entries ORDER BY date DESC')).rows;
  const timerRows = (await db.execute('SELECT * FROM timer_sessions ORDER BY started_at DESC')).rows;
  const paymentRows = (await db.execute('SELECT * FROM payments ORDER BY created_at DESC')).rows;
  const periodRows = (await db.execute('SELECT * FROM periods ORDER BY started_at DESC')).rows;

  const entries = {};
  for (const row of entryRows) {
    if (!entries[row.worker_id]) entries[row.worker_id] = [];
    entries[row.worker_id].push(mapEntry(row));
  }

  const timers = {};
  for (const row of timerRows) {
    if (!timers[row.worker_id]) timers[row.worker_id] = [];
    timers[row.worker_id].push(mapTimerSession(row));
  }

  const payments = {};
  for (const row of paymentRows) {
    if (!payments[row.worker_id]) payments[row.worker_id] = [];
    payments[row.worker_id].push(mapPayment(row));
  }

  res.json({
    settings: mapSettings(settingsRow),
    workers: workerRows.map(mapWorker),
    entries,
    timers,
    payments,
    periods: periodRows.map(mapPeriod),
  });
});

export default router;
