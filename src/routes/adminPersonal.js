import { Router } from '../lib/router.js';
import { db } from '../db/client.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { uid } from '../lib/auth.js';
import { parseEntryInput } from '../lib/validation.js';
import { mapPersonalEntry } from '../lib/mappers.js';
import { resolveUsdCadRate } from '../lib/fx.js';

const router = Router();

// The owner's own work hours ("My hours"). Admin-only and account-scoped; nothing in the
// worker routes reads this table.
router.post('/personal-entries', requireAdmin, async (req, res) => {
  const parsed = parseEntryInput(req.body);
  if (!parsed) return res.status(400).json({ error: 'invalid date, or hours must be between 0 and 24' });

  const settingsRow = (await db.execute({ sql: 'SELECT personal_rate FROM settings WHERE account_id = ?', args: [req.accountId] })).rows[0];
  const rate = settingsRow?.personal_rate;
  if (!(rate > 0)) return res.status(400).json({ error: 'set your hourly rate first' });

  const usdCadRate = await resolveUsdCadRate(req.accountId);
  if (!usdCadRate) return res.status(503).json({ error: "couldn't get the USD to CAD exchange rate right now, try again in a minute" });

  const row = {
    id: uid(),
    account_id: req.accountId,
    date: parsed.date,
    hours: parsed.hours,
    note: typeof parsed.note === 'string' ? parsed.note.trim().slice(0, 500) : '',
    rate,
    usd_cad_rate: usdCadRate,
    created_at: Date.now(),
  };
  await db.execute({
    sql: 'INSERT INTO personal_entries (id, account_id, date, hours, note, rate, usd_cad_rate, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    args: [row.id, row.account_id, row.date, row.hours, row.note, row.rate, row.usd_cad_rate, row.created_at],
  });
  res.status(201).json(mapPersonalEntry(row));
});

router.delete('/personal-entries/:id', requireAdmin, async (req, res) => {
  await db.execute({
    sql: 'DELETE FROM personal_entries WHERE id = ? AND account_id = ?',
    args: [req.params.id, req.accountId],
  });
  res.json({ ok: true });
});

export default router;
