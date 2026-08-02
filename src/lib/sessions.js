import { db } from '../db/client.js';

export async function maybePruneSessions() {
  if (Math.random() >= 0.02) return;
  const now = Date.now();
  await db.execute({ sql: 'DELETE FROM admin_sessions WHERE expires_at < ?', args: [now] });
  await db.execute({ sql: 'DELETE FROM worker_sessions WHERE expires_at < ?', args: [now] });
}
