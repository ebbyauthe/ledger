import { Router } from 'express';
import crypto from 'node:crypto';
import { db } from '../db/client.js';
import { ADMIN_PASSWORD } from '../config.js';
import { SESSION_COOKIE, SESSION_TTL_MS, hashToken, safeEqual } from '../lib/auth.js';
import { isValidSession } from '../middleware/requireAdmin.js';
import { loginLimiter } from '../middleware/rateLimit.js';

const router = Router();

router.post('/login', loginLimiter, async (req, res) => {
  const { password } = req.body || {};
  if (!ADMIN_PASSWORD) return res.status(500).json({ error: 'admin password not configured on server' });
  if (typeof password !== 'string' || !safeEqual(password, ADMIN_PASSWORD)) {
    return res.status(401).json({ error: 'wrong password' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  await db.execute({ sql: 'DELETE FROM admin_sessions WHERE expires_at < ?', args: [Date.now()] });
  await db.execute({
    sql: 'INSERT INTO admin_sessions (token, expires_at) VALUES (?, ?)',
    args: [hashToken(token), expiresAt],
  });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_TTL_MS,
  });
  res.json({ ok: true });
});

router.post('/logout', async (req, res) => {
  const token = req.cookies[SESSION_COOKIE];
  if (token) await db.execute({ sql: 'DELETE FROM admin_sessions WHERE token = ?', args: [hashToken(token)] });
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
});

router.get('/session', async (req, res) => {
  res.json({ authenticated: await isValidSession(req) });
});

export default router;
