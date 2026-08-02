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

router.delete('/timers/:workerId/:sessionId', requireAdmin, async (req, res) => {
  const { workerId, sessionId } = req.params;
  await db.execute({
    sql: 'DELETE FROM timer_sessions WHERE id = ? AND worker_id = ?',
    args: [sessionId, workerId],
  });
  res.json({ ok: true });
});

export default router;
