import { Router } from 'express';
import { db } from '../db/client.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { uid } from '../lib/auth.js';
import { parseEntryInput } from '../lib/validation.js';
import { mapEntry } from '../lib/mappers.js';

const router = Router();

async function getCurrentPeriodId() {
  const row = (await db.execute('SELECT id FROM periods ORDER BY started_at DESC LIMIT 1')).rows[0];
  return row ? row.id : null;
}

async function addEntry(workerId, { date, hours, note, periodId }) {
  const worker = (await db.execute({ sql: 'SELECT id FROM workers WHERE id = ?', args: [workerId] })).rows[0];
  if (!worker) return null;
  let resolvedPeriodId = periodId;
  if (resolvedPeriodId) {
    const period = (await db.execute({ sql: 'SELECT id FROM periods WHERE id = ?', args: [resolvedPeriodId] })).rows[0];
    if (!period) resolvedPeriodId = null;
  }
  if (!resolvedPeriodId) resolvedPeriodId = await getCurrentPeriodId();
  const id = uid();
  await db.execute({
    sql: 'INSERT INTO entries (id, worker_id, date, hours, note, period_id) VALUES (?, ?, ?, ?, ?, ?)',
    args: [id, workerId, date, hours, note || '', resolvedPeriodId],
  });
  return { id, date, hours, note: note || '', paid: false, periodId: resolvedPeriodId };
}

router.post('/entries/:workerId', requireAdmin, async (req, res) => {
  const { workerId } = req.params;
  const parsed = parseEntryInput(req.body);
  if (!parsed) {
    return res.status(400).json({ error: 'invalid date/time, or hours must be between 0 and 24' });
  }
  const entry = await addEntry(workerId, parsed);
  if (!entry) return res.status(404).json({ error: 'worker not found' });
  res.status(201).json(entry);
});

router.delete('/entries/:workerId/:entryId', requireAdmin, async (req, res) => {
  const { workerId, entryId } = req.params;
  await db.execute({
    sql: 'DELETE FROM entries WHERE id = ? AND worker_id = ?',
    args: [entryId, workerId],
  });
  res.json({ ok: true });
});

router.put('/entries/:workerId/:entryId/paid', requireAdmin, async (req, res) => {
  const { workerId, entryId } = req.params;
  const { paid, paymentSource } = req.body || {};
  const existing = (await db.execute({
    sql: 'SELECT * FROM entries WHERE id = ? AND worker_id = ?',
    args: [entryId, workerId],
  })).rows[0];
  if (!existing) return res.status(404).json({ error: 'not found' });
  const source = paid && (paymentSource === 'personal' || paymentSource === 'official') ? paymentSource : null;
  await db.execute({
    sql: 'UPDATE entries SET paid = ?, payment_source = ? WHERE id = ? AND worker_id = ?',
    args: [paid ? 1 : 0, source, entryId, workerId],
  });
  res.json(mapEntry({ ...existing, paid: paid ? 1 : 0, payment_source: source }));
});

router.post('/entries/:workerId/mark-all-paid', requireAdmin, async (req, res) => {
  const { workerId } = req.params;
  const { paymentSource } = req.body || {};
  const source = paymentSource === 'personal' || paymentSource === 'official' ? paymentSource : null;
  await db.execute({
    sql: 'UPDATE entries SET paid = 1, payment_source = ? WHERE worker_id = ? AND paid = 0',
    args: [source, workerId],
  });
  res.json({ ok: true });
});

export default router;
