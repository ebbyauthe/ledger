import { Router } from 'express';
import crypto from 'node:crypto';
import { db } from '../db/client.js';
import { SIGNUP_CODE } from '../config.js';
import { SESSION_COOKIE, SESSION_TTL_MS, uid, hashToken, hashPassword, verifyPassword, safeEqual } from '../lib/auth.js';
import { parseAccountSignupInput } from '../lib/validation.js';
import { isValidSession } from '../middleware/requireAdmin.js';
import { loginLimiter, signupLimiter } from '../middleware/rateLimit.js';

const router = Router();

async function createAdminSession(res, accountId) {
  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  await db.execute({ sql: 'DELETE FROM admin_sessions WHERE expires_at < ?', args: [Date.now()] });
  await db.execute({
    sql: 'INSERT INTO admin_sessions (token, expires_at, account_id) VALUES (?, ?, ?)',
    args: [hashToken(token), expiresAt, accountId],
  });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_TTL_MS,
  });
}

router.post('/login', loginLimiter, async (req, res) => {
  const { slug, password } = req.body || {};
  if (typeof slug !== 'string' || typeof password !== 'string') {
    return res.status(401).json({ error: 'wrong business handle or password' });
  }
  const account = (await db.execute({ sql: 'SELECT id, password_hash FROM accounts WHERE slug = ?', args: [slug] })).rows[0];
  // Same generic error whether the slug doesn't exist or the password is wrong, so this
  // endpoint can't be used to find out which business handles exist.
  if (!account || !verifyPassword(password, account.password_hash)) {
    return res.status(401).json({ error: 'wrong business handle or password' });
  }
  await createAdminSession(res, account.id);
  res.json({ ok: true });
});

// Creates a brand-new business profile, gated by a shared invite code (not open to the
// public internet) since this is a personal tool, not a public signup product.
router.post('/signup', signupLimiter, async (req, res) => {
  if (!SIGNUP_CODE) return res.status(500).json({ error: 'signup is not configured on server' });
  const parsed = parseAccountSignupInput(req.body);
  if (!parsed) {
    return res.status(400).json({ error: 'check the business name, handle, and password (8+ characters)' });
  }
  if (!safeEqual(parsed.code, SIGNUP_CODE)) {
    return res.status(401).json({ error: 'wrong invite code' });
  }
  const existing = (await db.execute({ sql: 'SELECT id FROM accounts WHERE slug = ?', args: [parsed.slug] })).rows[0];
  if (existing) return res.status(409).json({ error: 'that business handle is already taken' });

  const accountId = uid();
  await db.execute({
    sql: 'INSERT INTO accounts (id, name, slug, password_hash, created_at) VALUES (?, ?, ?, ?, ?)',
    args: [accountId, parsed.name, parsed.slug, hashPassword(parsed.password), Date.now()],
  });
  await db.execute({
    sql: 'INSERT INTO settings (account_id, rate, tax_percent, exchange_rate, exchange_manual) VALUES (?, 21.3, 20, NULL, 0)',
    args: [accountId],
  });
  await createAdminSession(res, accountId);
  res.status(201).json({ ok: true });
});

router.post('/logout', async (req, res) => {
  const token = req.cookies[SESSION_COOKIE];
  if (token) await db.execute({ sql: 'DELETE FROM admin_sessions WHERE token = ?', args: [hashToken(token)] });
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
});

router.get('/session', async (req, res) => {
  const accountId = await isValidSession(req);
  if (!accountId) return res.json({ authenticated: false });
  const account = (await db.execute({ sql: 'SELECT slug, name FROM accounts WHERE id = ?', args: [accountId] })).rows[0];
  res.json({ authenticated: true, slug: account?.slug || null, name: account?.name || null });
});

export default router;
