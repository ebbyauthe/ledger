import crypto from 'node:crypto';
import { db } from './client.js';

export async function migrate() {
  await db.execute('PRAGMA foreign_keys = ON');

  await db.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      rate REAL NOT NULL DEFAULT 21.3,
      tax_percent REAL NOT NULL DEFAULT 20,
      exchange_rate REAL,
      exchange_manual INTEGER NOT NULL DEFAULT 0
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS workers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      share_percent REAL NOT NULL DEFAULT 50,
      created_at INTEGER NOT NULL
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY,
      worker_id TEXT NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      hours REAL NOT NULL,
      note TEXT
    )
  `);

  // Manually-declared pay periods (e.g. "July 2026"), shared across all workers. An entry's
  // period is set explicitly when it's logged — not inferred from its date — so periods stay
  // under the admin's control (e.g. backdated entries can still count toward the open period).
  await db.execute(`
    CREATE TABLE IF NOT EXISTS periods (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      started_at INTEGER NOT NULL
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS worker_sessions (
      token TEXT PRIMARY KEY,
      worker_id TEXT NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    )
  `);

  // Self-service start/stop clock, purely informational — never feeds into paid hours or pay math.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS timer_sessions (
      id TEXT PRIMARY KEY,
      worker_id TEXT NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      note TEXT
    )
  `);

  // Payment log — typing an amount here auto-marks whichever unpaid entries it matches as
  // paid (see bestFitSubset in src/lib/subsetSum.js). matched_entry_ids remembers which entries
  // that was, so deleting a payment can revert just those entries back to unpaid.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      worker_id TEXT NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
      amount REAL NOT NULL,
      payment_source TEXT,
      note TEXT,
      created_at INTEGER NOT NULL
    )
  `);

  const paymentCols = (await db.execute('PRAGMA table_info(payments)')).rows.map(r => r.name);
  if (!paymentCols.includes('matched_entry_ids')) {
    await db.execute('ALTER TABLE payments ADD COLUMN matched_entry_ids TEXT');
  }

  const workerCols = (await db.execute('PRAGMA table_info(workers)')).rows.map(r => r.name);
  if (!workerCols.includes('password_hash')) {
    await db.execute('ALTER TABLE workers ADD COLUMN password_hash TEXT');
  }

  const entryCols = (await db.execute('PRAGMA table_info(entries)')).rows.map(r => r.name);
  if (!entryCols.includes('paid')) {
    await db.execute('ALTER TABLE entries ADD COLUMN paid INTEGER NOT NULL DEFAULT 0');
  }
  if (!entryCols.includes('payment_source')) {
    await db.execute('ALTER TABLE entries ADD COLUMN payment_source TEXT');
  }
  // start_time/end_time were dropped when decimal-hours became the only logging method.
  if (entryCols.includes('start_time')) {
    await db.execute('ALTER TABLE entries DROP COLUMN start_time');
  }
  if (entryCols.includes('end_time')) {
    await db.execute('ALTER TABLE entries DROP COLUMN end_time');
  }
  if (!entryCols.includes('period_id')) {
    await db.execute('ALTER TABLE entries ADD COLUMN period_id TEXT REFERENCES periods(id)');
  }

  // One-time backfill: the first time periods are introduced, everything logged so far
  // predates the feature and was worked in July, so it becomes the initial "July 2026" period.
  const periodCount = (await db.execute('SELECT COUNT(*) AS c FROM periods')).rows[0].c;
  if (periodCount === 0) {
    const initialPeriodId = crypto.randomBytes(6).toString('hex');
    await db.execute({
      sql: 'INSERT INTO periods (id, label, started_at) VALUES (?, ?, ?)',
      args: [initialPeriodId, 'July 2026', Date.now()],
    });
    await db.execute({
      sql: 'UPDATE entries SET period_id = ? WHERE period_id IS NULL',
      args: [initialPeriodId],
    });
  }

  await db.execute(`
    INSERT OR IGNORE INTO settings (id, rate, tax_percent, exchange_rate, exchange_manual)
    VALUES (1, 21.3, 20, NULL, 0)
  `);
}
