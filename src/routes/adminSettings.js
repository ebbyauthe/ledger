import { Router } from '../lib/router.js';
import { db } from '../db/client.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { mapSettings } from '../lib/mappers.js';

const router = Router();

router.put('/settings', requireAdmin, async (req, res) => {
  const { accountId } = req;
  const { exchangeRate, exchangeManual, personalRate, personalTaxPercent } = req.body || {};
  const current = (await db.execute({ sql: 'SELECT * FROM settings WHERE account_id = ?', args: [accountId] })).rows[0];
  const next = {
    exchange_rate: Number.isFinite(exchangeRate) ? exchangeRate : current.exchange_rate,
    exchange_manual: typeof exchangeManual === 'boolean' ? (exchangeManual ? 1 : 0) : current.exchange_manual,
    // The owner's own USD hourly rate for "My hours"; only applies to entries logged from now on.
    personal_rate: Number.isFinite(personalRate) && personalRate > 0 && personalRate < 100000 ? personalRate : current.personal_rate,
    personal_tax_percent: Number.isFinite(personalTaxPercent) && personalTaxPercent >= 0 && personalTaxPercent <= 100 ? personalTaxPercent : current.personal_tax_percent,
  };
  await db.execute({
    sql: 'UPDATE settings SET exchange_rate = ?, exchange_manual = ?, personal_rate = ?, personal_tax_percent = ? WHERE account_id = ?',
    args: [next.exchange_rate, next.exchange_manual, next.personal_rate, next.personal_tax_percent, accountId],
  });
  const updated = (await db.execute({ sql: 'SELECT * FROM settings WHERE account_id = ?', args: [accountId] })).rows[0];
  res.json(mapSettings(updated));
});

export default router;
