import { Router } from 'express';
import { db } from '../db/client.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { uid } from '../lib/auth.js';
import { parseJobInput } from '../lib/validation.js';
import { mapJob } from '../lib/mappers.js';

const router = Router();

// No delete endpoint: a job with historical hour entries shouldn't disappear without a
// reassignment flow, which isn't built. See entries.job_id's lack of ON DELETE CASCADE in migrate.js.
router.post('/jobs', requireAdmin, async (req, res) => {
  const parsed = parseJobInput(req.body);
  if (!parsed) {
    return res.status(400).json({ error: 'name required; rate must be a positive number; tax must be 0-100' });
  }
  const id = uid();
  const createdAt = Date.now();
  await db.execute({
    sql: 'INSERT INTO jobs (id, account_id, name, rate, tax_percent, fx_mode, exchange_rate, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    args: [id, req.accountId, parsed.name, parsed.rate, parsed.taxPercent, parsed.fxMode, parsed.exchangeRate, createdAt],
  });
  res.status(201).json(mapJob({
    id, name: parsed.name, rate: parsed.rate, tax_percent: parsed.taxPercent,
    fx_mode: parsed.fxMode, exchange_rate: parsed.exchangeRate, created_at: createdAt,
  }));
});

router.put('/jobs/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const existing = (await db.execute({ sql: 'SELECT * FROM jobs WHERE id = ? AND account_id = ?', args: [id, req.accountId] })).rows[0];
  if (!existing) return res.status(404).json({ error: 'not found' });
  const parsed = parseJobInput(req.body);
  if (!parsed) {
    return res.status(400).json({ error: 'name required; rate must be a positive number; tax must be 0-100' });
  }
  await db.execute({
    sql: 'UPDATE jobs SET name = ?, rate = ?, tax_percent = ?, fx_mode = ?, exchange_rate = ? WHERE id = ?',
    args: [parsed.name, parsed.rate, parsed.taxPercent, parsed.fxMode, parsed.exchangeRate, id],
  });
  res.json(mapJob({
    ...existing, name: parsed.name, rate: parsed.rate, tax_percent: parsed.taxPercent,
    fx_mode: parsed.fxMode, exchange_rate: parsed.exchangeRate,
  }));
});

export default router;
