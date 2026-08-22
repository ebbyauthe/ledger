import { Router } from 'express';
import { db } from '../db/client.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { uid } from '../lib/auth.js';

const router = Router();

// Manually-declared pay periods. Starting a new one doesn't touch existing entries — it just
// becomes the new default for entries logged from now on (see addEntry/getCurrentPeriodId in adminEntries.js).
router.post('/periods', requireAdmin, async (req, res) => {
  const label = typeof req.body?.label === 'string' ? req.body.label.trim().slice(0, 100) : '';
  if (!label) return res.status(400).json({ error: 'label required' });
  const id = uid();
  const startedAt = Date.now();
  await db.execute({
    sql: 'INSERT INTO periods (id, label, started_at) VALUES (?, ?, ?)',
    args: [id, label, startedAt],
  });
  res.status(201).json({ id, label, startedAt });
});

export default router;
