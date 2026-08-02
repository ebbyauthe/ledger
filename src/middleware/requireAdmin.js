import { db } from '../db/client.js';
import { SESSION_COOKIE, hashToken } from '../lib/auth.js';
import { maybePruneSessions } from '../lib/sessions.js';

export async function isValidSession(req) {
  await maybePruneSessions();
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return false;
  const tokenHash = hashToken(token);
  const row = (await db.execute({ sql: 'SELECT expires_at FROM admin_sessions WHERE token = ?', args: [tokenHash] })).rows[0];
  if (!row || row.expires_at < Date.now()) {
    if (row) await db.execute({ sql: 'DELETE FROM admin_sessions WHERE token = ?', args: [tokenHash] });
    return false;
  }
  return true;
}

export async function requireAdmin(req, res, next) {
  if (!(await isValidSession(req))) return res.status(401).json({ error: 'unauthorized' });
  next();
}
