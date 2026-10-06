import crypto from 'node:crypto';
import { db } from './client.js';
import { ADMIN_PASSWORD } from '../config.js';
import { uid, hashPassword, generatePassword } from '../lib/auth.js';

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

  // Business profiles. Each one owns its own workers, settings, periods, and the sessions/
  // entries/timers/payments that hang off them — see the account_id backfill below.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
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

  // Lets admin check off a timer session once its hours have been manually entered as a
  // real entries row — purely a bookkeeping flag, doesn't create or link to that entry.
  const timerCols = (await db.execute('PRAGMA table_info(timer_sessions)')).rows.map(r => r.name);
  if (!timerCols.includes('logged')) {
    await db.execute('ALTER TABLE timer_sessions ADD COLUMN logged INTEGER NOT NULL DEFAULT 0');
  }

  // Ownership column for multi-tenancy. Nullable at the schema level (SQLite can't add a
  // NOT NULL FK column to a non-empty table) — the one-time bootstrap below backfills every
  // existing row, and every INSERT from here on always sets it explicitly.
  for (const table of ['workers', 'periods', 'admin_sessions', 'entries', 'timer_sessions', 'payments']) {
    const cols = (await db.execute(`PRAGMA table_info(${table})`)).rows.map(r => r.name);
    if (!cols.includes('account_id')) {
      await db.execute(`ALTER TABLE ${table} ADD COLUMN account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE`);
    }
  }

  // One-time bootstrap: the first time accounts exist, nothing has an owner yet. Create a
  // "default" account from the current ADMIN_PASSWORD so the existing admin login and the
  // existing workers' bookmarked link keep working unchanged, then backfill every pre-existing
  // row onto it — including admin_sessions, so a live session cookie doesn't get silently
  // invalidated the moment this deploys.
  const accountCount = (await db.execute('SELECT COUNT(*) AS c FROM accounts')).rows[0].c;
  let defaultAccountId = null;
  if (accountCount === 0) {
    defaultAccountId = uid();
    await db.execute({
      sql: 'INSERT INTO accounts (id, name, slug, password_hash, created_at) VALUES (?, ?, ?, ?, ?)',
      args: [defaultAccountId, 'My Business', 'default', hashPassword(ADMIN_PASSWORD || generatePassword()), Date.now()],
    });
    for (const table of ['workers', 'periods', 'admin_sessions', 'entries', 'timer_sessions', 'payments']) {
      await db.execute({
        sql: `UPDATE ${table} SET account_id = ? WHERE account_id IS NULL`,
        args: [defaultAccountId],
      });
    }
  }

  // settings' `id INTEGER PRIMARY KEY CHECK (id = 1)` makes one-row-per-account structurally
  // impossible to reach via ALTER, so it needs a real rebuild rather than a column add. Safe
  // to re-run if a retry lands mid-way (see migrateWithRetry in server.js).
  const settingsCols = (await db.execute('PRAGMA table_info(settings)')).rows.map(r => r.name);
  if (!settingsCols.includes('account_id')) {
    const legacyAccountId = defaultAccountId
      || (await db.execute('SELECT id FROM accounts ORDER BY created_at ASC LIMIT 1')).rows[0]?.id
      || null;

    await db.execute(`
      CREATE TABLE IF NOT EXISTS settings_new (
        account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        rate REAL NOT NULL DEFAULT 21.3,
        tax_percent REAL NOT NULL DEFAULT 20,
        exchange_rate REAL,
        exchange_manual INTEGER NOT NULL DEFAULT 0
      )
    `);

    const oldSettings = (await db.execute('SELECT * FROM settings WHERE id = 1')).rows[0];
    const alreadyMigrated = legacyAccountId
      ? (await db.execute({ sql: 'SELECT 1 FROM settings_new WHERE account_id = ?', args: [legacyAccountId] })).rows[0]
      : null;
    if (legacyAccountId && !alreadyMigrated) {
      if (oldSettings) {
        await db.execute({
          sql: 'INSERT INTO settings_new (account_id, rate, tax_percent, exchange_rate, exchange_manual) VALUES (?, ?, ?, ?, ?)',
          args: [legacyAccountId, oldSettings.rate, oldSettings.tax_percent, oldSettings.exchange_rate, oldSettings.exchange_manual],
        });
      } else {
        // Fresh install: there was never a pre-existing singleton settings row to carry
        // forward (the default account just got bootstrapped above), so give it one with
        // this table's own defaults instead of leaving it with none.
        await db.execute({ sql: 'INSERT INTO settings_new (account_id) VALUES (?)', args: [legacyAccountId] });
      }
    }

    await db.execute('DROP TABLE settings');
    await db.execute('ALTER TABLE settings_new RENAME TO settings');
  }

  // Jobs let one worker log hours against several separate clients/projects, each with its
  // own rate and tax %. fx_mode is 'shared' (track the account's settings.exchange_rate) or
  // 'custom' (use this job's own exchange_rate column) — see adminJobs.js.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      rate REAL NOT NULL DEFAULT 21.3,
      tax_percent REAL NOT NULL DEFAULT 20,
      fx_mode TEXT NOT NULL DEFAULT 'shared',
      exchange_rate REAL,
      created_at INTEGER NOT NULL
    )
  `);

  const entryCols2 = (await db.execute('PRAGMA table_info(entries)')).rows.map(r => r.name);
  if (!entryCols2.includes('job_id')) {
    // No ON DELETE CASCADE here, matching period_id — a job should never be able to silently
    // wipe a worker's historical hour entries (there's no job-delete endpoint, but this keeps
    // that door safe if one's ever added).
    await db.execute('ALTER TABLE entries ADD COLUMN job_id TEXT REFERENCES jobs(id)');
  }

  // Workers pick which job a timer session is for when they clock in, same as entries.
  const timerCols2 = (await db.execute('PRAGMA table_info(timer_sessions)')).rows.map(r => r.name);
  if (!timerCols2.includes('job_id')) {
    await db.execute('ALTER TABLE timer_sessions ADD COLUMN job_id TEXT REFERENCES jobs(id)');
  }

  // Step 1: every account that doesn't have a job yet gets one "General" job, seeded from that
  // account's current settings.rate/tax_percent (read before those columns get dropped below).
  // Self-guarding via the LEFT JOIN — an account that already has a job is excluded, so this is
  // safe to re-run on every migrate() pass.
  const accountsWithoutJobs = (await db.execute(`
    SELECT accounts.id AS id
    FROM accounts
    LEFT JOIN jobs ON jobs.account_id = accounts.id
    WHERE jobs.id IS NULL
    GROUP BY accounts.id
  `)).rows;
  for (const { id: accId } of accountsWithoutJobs) {
    const oldJobSettings = (await db.execute({ sql: 'SELECT rate, tax_percent FROM settings WHERE account_id = ?', args: [accId] })).rows[0];
    await db.execute({
      sql: 'INSERT INTO jobs (id, account_id, name, rate, tax_percent, fx_mode, exchange_rate, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)',
      args: [uid(), accId, 'General', oldJobSettings?.rate ?? 21.3, oldJobSettings?.tax_percent ?? 20, 'shared', Date.now()],
    });
  }

  // Step 2: deliberately not nested inside step 1's loop. If the process crashes between
  // creating a job and backfilling that account's entries, step 1's LEFT JOIN would skip that
  // account on retry (it has a job now) and its entries would stay job_id = NULL forever.
  // Running this unconditionally every pass instead is a no-op once nothing matches.
  await db.execute(`
    UPDATE entries SET job_id = (
      SELECT id FROM jobs WHERE jobs.account_id = entries.account_id ORDER BY created_at ASC LIMIT 1
    ) WHERE job_id IS NULL AND account_id IS NOT NULL
  `);
  await db.execute(`
    UPDATE timer_sessions SET job_id = (
      SELECT id FROM jobs WHERE jobs.account_id = timer_sessions.account_id ORDER BY created_at ASC LIMIT 1
    ) WHERE job_id IS NULL AND account_id IS NOT NULL
  `);

  // rate/tax_percent now live per-job instead of once per account.
  const settingsCols2 = (await db.execute('PRAGMA table_info(settings)')).rows.map(r => r.name);
  if (settingsCols2.includes('rate')) await db.execute('ALTER TABLE settings DROP COLUMN rate');
  if (settingsCols2.includes('tax_percent')) await db.execute('ALTER TABLE settings DROP COLUMN tax_percent');

  await db.execute('CREATE INDEX IF NOT EXISTS idx_jobs_account ON jobs(account_id)');
  await db.execute('CREATE INDEX IF NOT EXISTS idx_entries_job ON entries(job_id)');

  // One-time backfill: the first time periods are introduced, everything logged so far
  // predates the feature and was worked in July, so it becomes the initial "July 2026" period.
  // (In production this is already permanently inert — periodCount is never 0 there anymore.
  // On a genuinely fresh install it runs in the same pass as the account bootstrap above, so
  // defaultAccountId is already set; fall back to the oldest account just in case.)
  const periodCount = (await db.execute('SELECT COUNT(*) AS c FROM periods')).rows[0].c;
  if (periodCount === 0) {
    const initialPeriodId = crypto.randomBytes(6).toString('hex');
    const ownerAccountId = defaultAccountId
      || (await db.execute('SELECT id FROM accounts ORDER BY created_at ASC LIMIT 1')).rows[0]?.id
      || null;
    await db.execute({
      sql: 'INSERT INTO periods (id, label, started_at, account_id) VALUES (?, ?, ?, ?)',
      args: [initialPeriodId, 'July 2026', Date.now(), ownerAccountId],
    });
    await db.execute({
      sql: 'UPDATE entries SET period_id = ? WHERE period_id IS NULL',
      args: [initialPeriodId],
    });
  }
}
