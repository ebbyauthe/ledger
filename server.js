import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, migrate } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_COOKIE = 'ledger_admin_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const WORKER_SESSION_COOKIE = 'ledger_worker_session';
const PASSWORD_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'; // no 0/O/1/l/I

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

function uid() {
  return crypto.randomBytes(6).toString('hex');
}

async function isValidSession(req) {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return false;
  const row = (await db.execute({ sql: 'SELECT expires_at FROM admin_sessions WHERE token = ?', args: [token] })).rows[0];
  if (!row || row.expires_at < Date.now()) {
    if (row) await db.execute({ sql: 'DELETE FROM admin_sessions WHERE token = ?', args: [token] });
    return false;
  }
  return true;
}

async function requireAdmin(req, res, next) {
  if (!(await isValidSession(req))) return res.status(401).json({ error: 'unauthorized' });
  next();
}

function safeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function generatePassword(length = 10) {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += PASSWORD_CHARS[crypto.randomInt(0, PASSWORD_CHARS.length)];
  }
  return out;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 32).toString('hex');
  const bufA = Buffer.from(candidate);
  const bufB = Buffer.from(hash);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

async function isValidWorkerSession(req, workerId) {
  const token = req.cookies[WORKER_SESSION_COOKIE];
  if (!token) return false;
  const row = (await db.execute({ sql: 'SELECT worker_id, expires_at FROM worker_sessions WHERE token = ?', args: [token] })).rows[0];
  if (!row || row.expires_at < Date.now()) {
    if (row) await db.execute({ sql: 'DELETE FROM worker_sessions WHERE token = ?', args: [token] });
    return false;
  }
  return row.worker_id === workerId;
}

async function requireWorkerSession(req, res, next) {
  const workerId = req.params.id || req.params.workerId;
  if (!(await isValidWorkerSession(req, workerId))) return res.status(401).json({ error: 'unauthorized' });
  next();
}

function isValidTime(t) {
  return typeof t === 'string' && /^\d{2}:\d{2}$/.test(t);
}
function isValidDate(d) {
  return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
}
function computeHours(start, end) {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let diff = (eh * 60 + em) - (sh * 60 + sm);
  if (diff <= 0) diff += 24 * 60; // shift crossing midnight
  return diff / 60;
}

function parseEntryInput(body) {
  const { date, startTime, endTime, hours, note } = body || {};
  if (!isValidDate(date)) return null;
  if (typeof hours === 'number' && Number.isFinite(hours) && hours > 0 && hours <= 24) {
    return { date, hours, note };
  }
  if (isValidTime(startTime) && isValidTime(endTime)) {
    return { date, startTime, endTime, note };
  }
  return null;
}

function mapSettings(row) {
  return {
    rate: row.rate,
    taxPercent: row.tax_percent,
    exchangeRate: row.exchange_rate,
    exchangeManual: !!row.exchange_manual,
  };
}
function mapWorker(row) {
  return { id: row.id, name: row.name, sharePercent: row.share_percent, createdAt: row.created_at };
}
function mapEntry(row) {
  return {
    id: row.id,
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    hours: row.hours,
    note: row.note || '',
    paid: !!row.paid,
  };
}

async function addEntry(workerId, { date, startTime, endTime, hours, note }) {
  const worker = (await db.execute({ sql: 'SELECT id FROM workers WHERE id = ?', args: [workerId] })).rows[0];
  if (!worker) return null;
  let finalHours, finalStart, finalEnd;
  if (typeof hours === 'number') {
    finalHours = hours;
    finalStart = '';
    finalEnd = '';
  } else {
    finalStart = startTime;
    finalEnd = endTime;
    finalHours = computeHours(startTime, endTime);
  }
  const id = uid();
  await db.execute({
    sql: 'INSERT INTO entries (id, worker_id, date, start_time, end_time, hours, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
    args: [id, workerId, date, finalStart, finalEnd, finalHours, note || ''],
  });
  return { id, date, startTime: finalStart, endTime: finalEnd, hours: finalHours, note: note || '', paid: false };
}

// ---------- Admin auth ----------

app.post('/api/admin/login', async (req, res) => {
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
    args: [token, expiresAt],
  });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_TTL_MS,
  });
  res.json({ ok: true });
});

app.post('/api/admin/logout', async (req, res) => {
  const token = req.cookies[SESSION_COOKIE];
  if (token) await db.execute({ sql: 'DELETE FROM admin_sessions WHERE token = ?', args: [token] });
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
});

app.get('/api/admin/session', async (req, res) => {
  res.json({ authenticated: await isValidSession(req) });
});

// ---------- Admin data ----------

app.get('/api/admin/state', requireAdmin, async (req, res) => {
  const settingsRow = (await db.execute('SELECT * FROM settings WHERE id = 1')).rows[0];
  const workerRows = (await db.execute('SELECT * FROM workers ORDER BY created_at ASC')).rows;
  const entryRows = (await db.execute('SELECT * FROM entries ORDER BY date DESC')).rows;

  const entries = {};
  for (const row of entryRows) {
    if (!entries[row.worker_id]) entries[row.worker_id] = [];
    entries[row.worker_id].push(mapEntry(row));
  }

  res.json({
    settings: mapSettings(settingsRow),
    workers: workerRows.map(mapWorker),
    entries,
  });
});

app.put('/api/admin/settings', requireAdmin, async (req, res) => {
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

app.post('/api/admin/workers', requireAdmin, async (req, res) => {
  const name = (req.body?.name || '').trim();
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

app.post('/api/admin/workers/:id/reset-password', requireAdmin, async (req, res) => {
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

app.put('/api/admin/workers/:id', requireAdmin, async (req, res) => {
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

app.delete('/api/admin/workers/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { password } = req.body || {};
  if (typeof password !== 'string' || !safeEqual(password, ADMIN_PASSWORD)) {
    return res.status(401).json({ error: 'wrong password' });
  }
  const existing = (await db.execute({ sql: 'SELECT id FROM workers WHERE id = ?', args: [id] })).rows[0];
  if (!existing) return res.status(404).json({ error: 'not found' });
  await db.execute({ sql: 'DELETE FROM entries WHERE worker_id = ?', args: [id] });
  await db.execute({ sql: 'DELETE FROM worker_sessions WHERE worker_id = ?', args: [id] });
  await db.execute({ sql: 'DELETE FROM workers WHERE id = ?', args: [id] });
  res.json({ ok: true });
});

app.post('/api/admin/entries/:workerId', requireAdmin, async (req, res) => {
  const { workerId } = req.params;
  const parsed = parseEntryInput(req.body);
  if (!parsed) {
    return res.status(400).json({ error: 'invalid date/time, or hours must be between 0 and 24' });
  }
  const entry = await addEntry(workerId, parsed);
  if (!entry) return res.status(404).json({ error: 'worker not found' });
  res.status(201).json(entry);
});

app.delete('/api/admin/entries/:workerId/:entryId', requireAdmin, async (req, res) => {
  const { workerId, entryId } = req.params;
  await db.execute({
    sql: 'DELETE FROM entries WHERE id = ? AND worker_id = ?',
    args: [entryId, workerId],
  });
  res.json({ ok: true });
});

app.put('/api/admin/entries/:workerId/:entryId/paid', requireAdmin, async (req, res) => {
  const { workerId, entryId } = req.params;
  const { paid } = req.body || {};
  const existing = (await db.execute({
    sql: 'SELECT * FROM entries WHERE id = ? AND worker_id = ?',
    args: [entryId, workerId],
  })).rows[0];
  if (!existing) return res.status(404).json({ error: 'not found' });
  await db.execute({
    sql: 'UPDATE entries SET paid = ? WHERE id = ? AND worker_id = ?',
    args: [paid ? 1 : 0, entryId, workerId],
  });
  res.json(mapEntry({ ...existing, paid: paid ? 1 : 0 }));
});

app.post('/api/admin/entries/:workerId/mark-all-paid', requireAdmin, async (req, res) => {
  const { workerId } = req.params;
  await db.execute({
    sql: 'UPDATE entries SET paid = 1 WHERE worker_id = ? AND paid = 0',
    args: [workerId],
  });
  res.json({ ok: true });
});

// ---------- Public worker-facing routes ----------
// These never expose hourly rate, tax %, other workers' data, or Ebenezer's cut.

app.get('/api/worker-names', async (req, res) => {
  const rows = (await db.execute('SELECT id, name FROM workers ORDER BY name ASC')).rows;
  res.json(rows.map(r => ({ id: r.id, name: r.name })));
});

app.get('/api/workers/session', async (req, res) => {
  const token = req.cookies[WORKER_SESSION_COOKIE];
  if (!token) return res.json({ workerId: null });
  const row = (await db.execute({ sql: 'SELECT worker_id, expires_at FROM worker_sessions WHERE token = ?', args: [token] })).rows[0];
  if (!row || row.expires_at < Date.now()) return res.json({ workerId: null });
  res.json({ workerId: row.worker_id });
});

app.post('/api/workers/:id/login', async (req, res) => {
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
    args: [token, id, expiresAt],
  });
  res.cookie(WORKER_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_TTL_MS,
  });
  res.json({ ok: true });
});

app.post('/api/workers/logout', async (req, res) => {
  const token = req.cookies[WORKER_SESSION_COOKIE];
  if (token) await db.execute({ sql: 'DELETE FROM worker_sessions WHERE token = ?', args: [token] });
  res.clearCookie(WORKER_SESSION_COOKIE);
  res.json({ ok: true });
});

app.put('/api/workers/:id/password', requireWorkerSession, async (req, res) => {
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
  res.json({ ok: true });
});

app.get('/api/workers/:id/summary', requireWorkerSession, async (req, res) => {
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
    const net = gross - (gross * taxPct) / 100;
    const workerPay = (net * sharePct) / 100;
    totalHours += e.hours;
    totalWorkerPay += workerPay;
    if (!e.paid) unpaidWorkerPay += workerPay;
    return { ...e, workerPay, workerPayNGN: workerPay * fx };
  });

  res.json({
    id: workerRow.id,
    name: workerRow.name,
    totalHours,
    workerPay: totalWorkerPay,
    workerPayNGN: totalWorkerPay * fx,
    unpaidWorkerPay,
    unpaidWorkerPayNGN: unpaidWorkerPay * fx,
    entries,
  });
});

app.post('/api/entries/:workerId', requireWorkerSession, async (req, res) => {
  const { workerId } = req.params;
  const parsed = parseEntryInput(req.body);
  if (!parsed) {
    return res.status(400).json({ error: 'invalid date/time, or hours must be between 0 and 24' });
  }
  const entry = await addEntry(workerId, parsed);
  if (!entry) return res.status(404).json({ error: 'worker not found' });
  res.status(201).json(entry);
});

// ---------- App shell ----------
// "/" is the worker-facing link Ebenezer shares. "/admin" is his own view.

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

try {
  await migrate();
} catch (err) {
  console.error('Migration failed', err);
  if (!process.env.VERCEL) process.exit(1);
  throw err;
}

if (!process.env.VERCEL) {
  app.listen(PORT, () => console.log(`Ledger listening on :${PORT}`));
}

export default app;
