import { Router } from 'express';
import { db } from '../db/client.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { mapSettings, mapWorker, mapEntry, mapTimerSession, mapPayment, mapPeriod, mapJob } from '../lib/mappers.js';

const router = Router();

router.get('/state', requireAdmin, async (req, res) => {
  const { accountId } = req;
  const settingsRow = (await db.execute({ sql: 'SELECT * FROM settings WHERE account_id = ?', args: [accountId] })).rows[0];
  const workerRows = (await db.execute({ sql: 'SELECT * FROM workers WHERE account_id = ? ORDER BY created_at ASC', args: [accountId] })).rows;
  const entryRows = (await db.execute({ sql: 'SELECT * FROM entries WHERE account_id = ? ORDER BY date DESC', args: [accountId] })).rows;
  const timerRows = (await db.execute({ sql: 'SELECT * FROM timer_sessions WHERE account_id = ? ORDER BY started_at DESC', args: [accountId] })).rows;
  const paymentRows = (await db.execute({ sql: 'SELECT * FROM payments WHERE account_id = ? ORDER BY created_at DESC', args: [accountId] })).rows;
  const periodRows = (await db.execute({ sql: 'SELECT * FROM periods WHERE account_id = ? ORDER BY started_at DESC', args: [accountId] })).rows;
  const jobRows = (await db.execute({ sql: 'SELECT * FROM jobs WHERE account_id = ? ORDER BY created_at ASC', args: [accountId] })).rows;

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
    jobs: jobRows.map(mapJob),
    entries,
    timers,
    payments,
    periods: periodRows.map(mapPeriod),
  });
});

export default router;
