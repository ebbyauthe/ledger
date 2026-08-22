import { Router } from 'express';
import crypto from 'node:crypto';
import { db } from '../db/client.js';
import { requireWorkerSession } from '../middleware/requireWorkerSession.js';
import { loginLimiter } from '../middleware/rateLimit.js';
import { WORKER_SESSION_COOKIE, SESSION_TTL_MS, uid, hashToken, hashPassword, verifyPassword } from '../lib/auth.js';
import { mapEntry, mapTimerSession, mapPeriod } from '../lib/mappers.js';

const router = Router();

// ---------- Public worker-facing routes ----------
// These never expose hourly rate, tax %, other workers' data, or Ebenezer's cut.

router.get('/worker-names', async (req, res) => {
  const rows = (await db.execute('SELECT id, name FROM workers ORDER BY name ASC')).rows;
  res.json(rows.map(r => ({ id: r.id, name: r.name })));
});

router.get('/workers/session', async (req, res) => {
  const token = req.cookies[WORKER_SESSION_COOKIE];
  if (!token) return res.json({ workerId: null });
  const row = (await db.execute({ sql: 'SELECT worker_id, expires_at FROM worker_sessions WHERE token = ?', args: [hashToken(token)] })).rows[0];
  if (!row || row.expires_at < Date.now()) return res.json({ workerId: null });
  res.json({ workerId: row.worker_id });
});

router.post('/workers/:id/login', loginLimiter, async (req, res) => {
  const { id } = req.params;
  const { password } = req.body || {};
  const worker = (await db.execute({ sql: 'SELECT password_hash FROM workers WHERE id = ?', args: [id] })).rows[0];
  if (!worker) return res.status(404).json({ error: 'not found' });
  if (!worker.password_hash) return res.status(409).json({ error: 'no password set, ask for a password reset' });
  if (typeof password !== 'string' || !verifyPassword(password, worker.password_hash)) {
    return res.status(401).json({ error: 'wrong password' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  await db.execute({ sql: 'DELETE FROM worker_sessions WHERE expires_at < ?', args: [Date.now()] });
  await db.execute({
    sql: 'INSERT INTO worker_sessions (token, worker_id, expires_at) VALUES (?, ?, ?)',
    args: [hashToken(token), id, expiresAt],
  });
  res.cookie(WORKER_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_TTL_MS,
  });
  res.json({ ok: true });
});

router.post('/workers/logout', async (req, res) => {
  const token = req.cookies[WORKER_SESSION_COOKIE];
  if (token) await db.execute({ sql: 'DELETE FROM worker_sessions WHERE token = ?', args: [hashToken(token)] });
  res.clearCookie(WORKER_SESSION_COOKIE);
  res.json({ ok: true });
});

router.put('/workers/:id/password', loginLimiter, requireWorkerSession, async (req, res) => {
  const { id } = req.params;
  const { currentPassword, newPassword } = req.body || {};
  const worker = (await db.execute({ sql: 'SELECT password_hash FROM workers WHERE id = ?', args: [id] })).rows[0];
  if (!worker) return res.status(404).json({ error: 'not found' });
  if (typeof currentPassword !== 'string' || !verifyPassword(currentPassword, worker.password_hash)) {
    return res.status(401).json({ error: 'wrong current password' });
  }
  if (typeof newPassword !== 'string' || newPassword.length < 6) {
    return res.status(400).json({ error: 'new password must be at least 6 characters' });
  }
  await db.execute({
    sql: 'UPDATE workers SET password_hash = ? WHERE id = ?',
    args: [hashPassword(newPassword), id],
  });
  // Keep the session that just made this change alive; revoke every other outstanding session for this worker.
  const currentTokenHash = hashToken(req.cookies[WORKER_SESSION_COOKIE]);
  await db.execute({
    sql: 'DELETE FROM worker_sessions WHERE worker_id = ? AND token != ?',
    args: [id, currentTokenHash],
  });
  res.json({ ok: true });
});

router.get('/workers/:id/summary', requireWorkerSession, async (req, res) => {
  const { id } = req.params;
  const workerRow = (await db.execute({ sql: 'SELECT * FROM workers WHERE id = ?', args: [id] })).rows[0];
  if (!workerRow) return res.status(404).json({ error: 'not found' });
  const settingsRow = (await db.execute('SELECT * FROM settings WHERE id = 1')).rows[0];
  const entryRows = (await db.execute({
    sql: 'SELECT * FROM entries WHERE worker_id = ? ORDER BY date DESC',
    args: [id],
  })).rows;

  const rate = settingsRow.rate;
  const taxPct = settingsRow.tax_percent;
  const sharePct = workerRow.share_percent;
  const fx = settingsRow.exchange_rate || 0;

  let totalHours = 0;
  let totalWorkerPay = 0;
  let unpaidWorkerPay = 0;
  const entries = entryRows.map(row => {
    const e = mapEntry(row);
    const gross = e.hours * rate;
    const workerPay = (gross * sharePct) / 100;
    totalHours += e.hours;
    totalWorkerPay += workerPay;
    if (!e.paid) unpaidWorkerPay += workerPay;
    return { ...e, workerPay, workerPayNGN: workerPay * fx };
  });

  const timerRows = (await db.execute({
    sql: 'SELECT * FROM timer_sessions WHERE worker_id = ? ORDER BY started_at DESC',
    args: [id],
  })).rows;
  const timerSessions = timerRows.map(mapTimerSession);
  const runningTimer = timerSessions.find(t => !t.endedAt) || null;

  const periodRows = (await db.execute('SELECT * FROM periods ORDER BY started_at DESC')).rows;

  res.json({
    id: workerRow.id,
    name: workerRow.name,
    totalHours,
    workerPay: totalWorkerPay,
    workerPayNGN: totalWorkerPay * fx,
    unpaidWorkerPay,
    unpaidWorkerPayNGN: unpaidWorkerPay * fx,
    entries,
    timerSessions,
    runningTimer,
    periods: periodRows.map(mapPeriod),
  });
});

// ---------- Worker-facing timer (start/stop clock) ----------
// Purely informational: never affects hours, pay, or anything computed above.

router.post('/workers/:id/timer/start', requireWorkerSession, async (req, res) => {
  const { id } = req.params;
  const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 500) : '';
  // Only one worker can be clocked in at a time across the whole team, not just one each —
  // so this checks globally rather than scoping to this worker's own sessions. Admin can
  // still force-stop a stuck/forgotten timer via the admin Timer log to unblock everyone else.
  const running = (await db.execute('SELECT worker_id FROM timer_sessions WHERE ended_at IS NULL')).rows[0];
  if (running) {
    return res.status(409).json({
      error: running.worker_id === id ? 'timer already running' : 'someone else is already clocked in',
    });
  }
  const sessionId = uid();
  const startedAt = Date.now();
  await db.execute({
    sql: 'INSERT INTO timer_sessions (id, worker_id, started_at, note) VALUES (?, ?, ?, ?)',
    args: [sessionId, id, startedAt, note],
  });
  res.status(201).json({ id: sessionId, startedAt, endedAt: null, note });
});

router.post('/workers/:id/timer/stop', requireWorkerSession, async (req, res) => {
  const { id } = req.params;
  const running = (await db.execute({
    sql: 'SELECT * FROM timer_sessions WHERE worker_id = ? AND ended_at IS NULL',
    args: [id],
  })).rows[0];
  if (!running) return res.status(404).json({ error: 'no timer running' });
  const endedAt = Date.now();
  await db.execute({ sql: 'UPDATE timer_sessions SET ended_at = ? WHERE id = ?', args: [endedAt, running.id] });
  res.json(mapTimerSession({ ...running, ended_at: endedAt }));
});

export default router;
