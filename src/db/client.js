import { createClient } from '@libsql/client';
import fs from 'node:fs';

const LOCAL_DB_PATH = './data/local.db';

// Only relevant for the no-Turso-configured local fallback: libSQL's local-file driver won't
// create a missing parent directory itself, so a truly fresh checkout crashes on first run.
if (!process.env.TURSO_DATABASE_URL) {
  fs.mkdirSync('./data', { recursive: true });
}

export const db = createClient({
  url: process.env.TURSO_DATABASE_URL || `file:${LOCAL_DB_PATH}`,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
