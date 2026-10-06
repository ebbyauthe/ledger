import { Router } from 'express';
import { db } from '../db/client.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { mapSettings } from '../lib/mappers.js';

const router = Router();

router.put('/settings', requireAdmin, async (req, res) => {
  const { accountId } = req;
  const { exchangeRate, exchangeManual } = req.body || {};
  const current = (await db.execute({ sql: 'SELECT * FROM settings WHERE account_id = ?', args: [accountId] })).rows[0];
  const next = {
    exchange_rate: Number.isFinite(exchangeRate) ? exchangeRate : current.exchange_rate,
    exchange_manual: typeof exchangeManual === 'boolean' ? (exchangeManual ? 1 : 0) : current.exchange_manual,
  };
  await db.execute({
    sql: 'UPDATE settings SET exchange_rate = ?, exchange_manual = ? WHERE account_id = ?',
    args: [next.exchange_rate, next.exchange_manual, accountId],
  });
  const updated = (await db.execute({ sql: 'SELECT * FROM settings WHERE account_id = ?', args: [accountId] })).rows[0];
  res.json(mapSettings(updated));
});

export default router;
