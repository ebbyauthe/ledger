import { db } from '../db/client.js';
import { SESSION_COOKIE, hashToken } from '../lib/auth.js';
import { maybePruneSessions } from '../lib/sessions.js';

// Resolves the session cookie to the account it belongs to, or null if there isn't a valid
// one. A row with no account_id (shouldn't happen past the one-time migration backfill, but
// cheap to guard) is treated as invalid rather than trusted.
export async function isValidSession(req) {
  await maybePruneSessions();
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return null;
  const tokenHash = hashToken(token);
  const row = (await db.execute({ sql: 'SELECT expires_at, account_id FROM admin_sessions WHERE token = ?', args: [tokenHash] })).rows[0];
  if (!row || row.expires_at < Date.now() || !row.account_id) {
    if (row) await db.execute({ sql: 'DELETE FROM admin_sessions WHERE token = ?', args: [tokenHash] });
    return null;
  }
  return row.account_id;
}

export async function requireAdmin(req, res, next) {
  const accountId = await isValidSession(req);
  if (!accountId) return res.status(401).json({ error: 'unauthorized' });
  req.accountId = accountId;
  next();
}
