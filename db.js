import { createClient } from '@libsql/client';

export const db = createClient({
  url: process.env.TURSO_DATABASE_URL || 'file:./data/local.db',
  authToken: process.env.TURSO_AUTH_TOKEN,
});

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
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      hours REAL NOT NULL,
      note TEXT
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

  const workerCols = (await db.execute('PRAGMA table_info(workers)')).rows.map(r => r.name);
  if (!workerCols.includes('password_hash')) {
    await db.execute('ALTER TABLE workers ADD COLUMN password_hash TEXT');
  }

  const entryCols = (await db.execute('PRAGMA table_info(entries)')).rows.map(r => r.name);
  if (!entryCols.includes('paid')) {
    await db.execute('ALTER TABLE entries ADD COLUMN paid INTEGER NOT NULL DEFAULT 0');
  }

  await db.execute(`
    INSERT OR IGNORE INTO settings (id, rate, tax_percent, exchange_rate, exchange_manual)
    VALUES (1, 21.3, 20, NULL, 0)
  `);
}
