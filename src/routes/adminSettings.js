import { Router } from 'express';
import { db } from '../db/client.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { mapSettings } from '../lib/mappers.js';

const router = Router();

router.put('/settings', requireAdmin, async (req, res) => {
  const { rate, taxPercent, exchangeRate, exchangeManual } = req.body || {};
  const current = (await db.execute('SELECT * FROM settings WHERE id = 1')).rows[0];
  const next = {
    rate: Number.isFinite(rate) ? rate : current.rate,
    tax_percent: Number.isFinite(taxPercent) ? Math.min(100, Math.max(0, taxPercent)) : current.tax_percent,
    exchange_rate: Number.isFinite(exchangeRate) ? exchangeRate : current.exchange_rate,
    exchange_manual: typeof exchangeManual === 'boolean' ? (exchangeManual ? 1 : 0) : current.exchange_manual,
  };
  await db.execute({
    sql: 'UPDATE settings SET rate = ?, tax_percent = ?, exchange_rate = ?, exchange_manual = ? WHERE id = 1',
    args: [next.rate, next.tax_percent, next.exchange_rate, next.exchange_manual],
  });
  const updated = (await db.execute('SELECT * FROM settings WHERE id = 1')).rows[0];
  res.json(mapSettings(updated));
});

export default router;
