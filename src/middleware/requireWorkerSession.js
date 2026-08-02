import { db } from '../db/client.js';
import { WORKER_SESSION_COOKIE, hashToken } from '../lib/auth.js';
import { maybePruneSessions } from '../lib/sessions.js';

export async function isValidWorkerSession(req, workerId) {
  await maybePruneSessions();
  const token = req.cookies[WORKER_SESSION_COOKIE];
  if (!token) return false;
  const tokenHash = hashToken(token);
  const row = (await db.execute({ sql: 'SELECT worker_id, expires_at FROM worker_sessions WHERE token = ?', args: [tokenHash] })).rows[0];
  if (!row || row.expires_at < Date.now()) {
    if (row) await db.execute({ sql: 'DELETE FROM worker_sessions WHERE token = ?', args: [tokenHash] });
    return false;
  }
  return row.worker_id === workerId;
}

export async function requireWorkerSession(req, res, next) {
  const workerId = req.params.id || req.params.workerId;
  if (!(await isValidWorkerSession(req, workerId))) return res.status(401).json({ error: 'unauthorized' });
  next();
}
