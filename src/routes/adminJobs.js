import { Router } from '../lib/router.js';
import { db } from '../db/client.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { uid } from '../lib/auth.js';
import { parseJobInput } from '../lib/validation.js';
import { mapJob } from '../lib/mappers.js';
import { resolveUsdCadRate } from '../lib/fx.js';

const router = Router();

const INVALID_JOB = 'name required; rate must be a positive number; tax must be 0-100';
const NO_RATE = "couldn't get the USD to CAD exchange rate right now, try again in a minute";

// No delete endpoint: a job with historical hour entries shouldn't disappear without a
// reassignment flow, which isn't built. See entries.job_id's lack of ON DELETE CASCADE in migrate.js.
router.post('/jobs', requireAdmin, async (req, res) => {
  const parsed = parseJobInput(req.body);
  if (!parsed) return res.status(400).json({ error: INVALID_JOB });
  const id = uid();
  const createdAt = Date.now();
  await db.execute({
    sql: 'INSERT INTO jobs (id, account_id, name, rate, currency, tax_percent, fx_mode, exchange_rate, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    args: [id, req.accountId, parsed.name, parsed.rate, parsed.currency, parsed.taxPercent, parsed.fxMode, parsed.exchangeRate, createdAt],
  });
  res.status(201).json(mapJob({
    id, name: parsed.name, rate: parsed.rate, currency: parsed.currency, tax_percent: parsed.taxPercent,
    fx_mode: parsed.fxMode, exchange_rate: parsed.exchangeRate, created_at: createdAt,
  }));
});

router.put('/jobs/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const existing = (await db.execute({ sql: 'SELECT * FROM jobs WHERE id = ? AND account_id = ?', args: [id, req.accountId] })).rows[0];
  if (!existing) return res.status(404).json({ error: 'not found' });
  const parsed = parseJobInput(req.body);
  if (!parsed) return res.status(400).json({ error: INVALID_JOB });

  // Switching an existing job to USD: entries already logged against it have no locked rate,
  // so lock today's onto them — every USD entry then always carries its own rate.
  if (parsed.currency === 'USD' && existing.currency !== 'USD') {
    const usdCad = await resolveUsdCadRate(req.accountId);
    if (!usdCad) return res.status(503).json({ error: NO_RATE });
    await db.execute({
      sql: 'UPDATE entries SET usd_cad_rate = ? WHERE job_id = ? AND account_id = ? AND usd_cad_rate IS NULL',
      args: [usdCad, id, req.accountId],
    });
  }

  await db.execute({
    sql: 'UPDATE jobs SET name = ?, rate = ?, currency = ?, tax_percent = ?, fx_mode = ?, exchange_rate = ? WHERE id = ?',
    args: [parsed.name, parsed.rate, parsed.currency, parsed.taxPercent, parsed.fxMode, parsed.exchangeRate, id],
  });
  res.json(mapJob({
    ...existing, name: parsed.name, rate: parsed.rate, currency: parsed.currency, tax_percent: parsed.taxPercent,
    fx_mode: parsed.fxMode, exchange_rate: parsed.exchangeRate,
  }));
});

export default router;
