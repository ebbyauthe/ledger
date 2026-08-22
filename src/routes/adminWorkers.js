import { Router } from 'express';
import { db } from '../db/client.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { ADMIN_PASSWORD } from '../config.js';
import { uid, generatePassword, hashPassword, safeEqual } from '../lib/auth.js';

const router = Router();

router.post('/workers', requireAdmin, async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name) return res.status(400).json({ error: 'name required' });
  let share = Number(req.body?.sharePercent);
  if (!Number.isFinite(share)) share = 50;
  share = Math.min(100, Math.max(0, share));
  const id = uid();
  const createdAt = Date.now();
  const password = generatePassword();
  await db.execute({
    sql: 'INSERT INTO workers (id, name, share_percent, created_at, password_hash) VALUES (?, ?, ?, ?, ?)',
    args: [id, name, share, createdAt, hashPassword(password)],
  });
  res.status(201).json({ id, name, sharePercent: share, createdAt, password });
});

router.post('/workers/:id/reset-password', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const existing = (await db.execute({ sql: 'SELECT id FROM workers WHERE id = ?', args: [id] })).rows[0];
  if (!existing) return res.status(404).json({ error: 'not found' });
  const password = generatePassword();
  await db.execute({
    sql: 'UPDATE workers SET password_hash = ? WHERE id = ?',
    args: [hashPassword(password), id],
  });
  await db.execute({ sql: 'DELETE FROM worker_sessions WHERE worker_id = ?', args: [id] });
  res.json({ password });
});

router.put('/workers/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const existing = (await db.execute({ sql: 'SELECT * FROM workers WHERE id = ?', args: [id] })).rows[0];
  if (!existing) return res.status(404).json({ error: 'not found' });
  let share = Number(req.body?.sharePercent);
  if (!Number.isFinite(share)) share = existing.share_percent;
  share = Math.min(100, Math.max(0, share));
  const name = typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name.trim() : existing.name;
  await db.execute({
    sql: 'UPDATE workers SET name = ?, share_percent = ? WHERE id = ?',
    args: [name, share, id],
  });
  res.json({ id, name, sharePercent: share, createdAt: existing.created_at });
});

router.delete('/workers/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { password } = req.body || {};
  if (typeof password !== 'string' || !safeEqual(password, ADMIN_PASSWORD)) {
    return res.status(401).json({ error: 'wrong password' });
  }
  const existing = (await db.execute({ sql: 'SELECT id FROM workers WHERE id = ?', args: [id] })).rows[0];
  if (!existing) return res.status(404).json({ error: 'not found' });
  await db.execute({ sql: 'DELETE FROM entries WHERE worker_id = ?', args: [id] });
  await db.execute({ sql: 'DELETE FROM worker_sessions WHERE worker_id = ?', args: [id] });
  await db.execute({ sql: 'DELETE FROM timer_sessions WHERE worker_id = ?', args: [id] });
  await db.execute({ sql: 'DELETE FROM workers WHERE id = ?', args: [id] });
  res.json({ ok: true });
});

export default router;
