import { Router } from 'express';
import { db } from '../db/client.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { uid } from '../lib/auth.js';
import { bestFitSubset, parseMatchedEntryIds } from '../lib/subsetSum.js';

const router = Router();

// Typing a payment amount marks off whatever combination of unpaid entries adds up to it
// (or as close as possible without exceeding), instead of the admin clicking each one.
// Still keeps a running payment-log record regardless of how many entries could be matched.
router.post('/payments/:workerId', requireAdmin, async (req, res) => {
  const { workerId } = req.params;
  const worker = (await db.execute({ sql: 'SELECT * FROM workers WHERE id = ?', args: [workerId] })).rows[0];
  if (!worker) return res.status(404).json({ error: 'worker not found' });
  const { amount, paymentSource, note } = req.body || {};
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }
  const source = paymentSource === 'personal' || paymentSource === 'official' ? paymentSource : null;
  const cleanNote = typeof note === 'string' ? note.trim().slice(0, 500) : '';

  const settingsRow = (await db.execute('SELECT * FROM settings WHERE id = 1')).rows[0];
  const unpaidRows = (await db.execute({
    sql: 'SELECT * FROM entries WHERE worker_id = ? AND paid = 0 ORDER BY date ASC',
    args: [workerId],
  })).rows;
  const items = unpaidRows.map(row => ({
    id: row.id,
    cents: Math.round(row.hours * settingsRow.rate * worker.share_percent / 100 * 100),
  }));

  const targetCents = Math.round(amount * 100);
  const { ids: matchedIds, achievedCents } = bestFitSubset(items, targetCents);

  for (const entryId of matchedIds) {
    await db.execute({
      sql: 'UPDATE entries SET paid = 1, payment_source = ? WHERE id = ? AND worker_id = ?',
      args: [source, entryId, workerId],
    });
  }

  const id = uid();
  const createdAt = Date.now();
  await db.execute({
    sql: 'INSERT INTO payments (id, worker_id, amount, payment_source, note, created_at, matched_entry_ids) VALUES (?, ?, ?, ?, ?, ?, ?)',
    args: [id, workerId, amount, source, cleanNote, createdAt, JSON.stringify(matchedIds)],
  });

  res.status(201).json({
    id, amount, paymentSource: source, note: cleanNote, createdAt,
    matchedEntryIds: matchedIds,
    appliedAmount: achievedCents / 100,
    unappliedAmount: Math.round(targetCents - achievedCents) / 100,
  });
});

// Deleting a payment reverts whichever entries it had auto-marked as paid back to unpaid,
// so the paid/unpaid picture stays consistent with the payment log.
router.delete('/payments/:workerId/:paymentId', requireAdmin, async (req, res) => {
  const { workerId, paymentId } = req.params;
  const payment = (await db.execute({
    sql: 'SELECT matched_entry_ids FROM payments WHERE id = ? AND worker_id = ?',
    args: [paymentId, workerId],
  })).rows[0];
  const revertedEntryIds = payment ? parseMatchedEntryIds(payment.matched_entry_ids) : [];
  for (const entryId of revertedEntryIds) {
    await db.execute({
      sql: 'UPDATE entries SET paid = 0, payment_source = NULL WHERE id = ? AND worker_id = ?',
      args: [entryId, workerId],
    });
  }
  await db.execute({
    sql: 'DELETE FROM payments WHERE id = ? AND worker_id = ?',
    args: [paymentId, workerId],
  });
  res.json({ ok: true, revertedEntryIds });
});

export default router;
