import { Router } from 'express';
import { db } from '../db/client.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { mapTimerSession } from '../lib/mappers.js';

const router = Router();

// Admin can force-stop a timer a worker forgot to stop, or delete a bad session.
// Workers themselves cannot edit or delete their own timer sessions.
router.post('/timers/:workerId/:sessionId/stop', requireAdmin, async (req, res) => {
  const { workerId, sessionId } = req.params;
  const existing = (await db.execute({
    sql: 'SELECT * FROM timer_sessions WHERE id = ? AND worker_id = ?',
    args: [sessionId, workerId],
  })).rows[0];
  if (!existing) return res.status(404).json({ error: 'not found' });
  if (existing.ended_at) return res.json(mapTimerSession(existing));
  const endedAt = Date.now();
  await db.execute({ sql: 'UPDATE timer_sessions SET ended_at = ? WHERE id = ?', args: [endedAt, sessionId] });
  res.json(mapTimerSession({ ...existing, ended_at: endedAt }));
});

// Admin-only bookkeeping flag: marks a timer session as already accounted for in a real
// entries row. Doesn't create or link to that entry — just tracks what's been processed.
router.put('/timers/:workerId/:sessionId/logged', requireAdmin, async (req, res) => {
  const { workerId, sessionId } = req.params;
  const { logged } = req.body || {};
  const existing = (await db.execute({
    sql: 'SELECT * FROM timer_sessions WHERE id = ? AND worker_id = ?',
    args: [sessionId, workerId],
  })).rows[0];
  if (!existing) return res.status(404).json({ error: 'not found' });
  await db.execute({ sql: 'UPDATE timer_sessions SET logged = ? WHERE id = ?', args: [logged ? 1 : 0, sessionId] });
  res.json(mapTimerSession({ ...existing, logged: logged ? 1 : 0 }));
});

router.delete('/timers/:workerId/:sessionId', requireAdmin, async (req, res) => {
  const { workerId, sessionId } = req.params;
  await db.execute({
    sql: 'DELETE FROM timer_sessions WHERE id = ? AND worker_id = ?',
    args: [sessionId, workerId],
  });
  res.json({ ok: true });
});

export default router;
