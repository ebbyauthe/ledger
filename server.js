import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from './src/db/migrate.js';
import { PORT } from './src/config.js';
import apiRoutes from './src/routes/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', 1);

// Helmet's default CSP already fits this app well without a build step: script-src stays
// locked to 'self' (no inline script anywhere since the frontend moved to ES modules), while
// style-src/font-src stay permissive enough for the inline style="" attributes throughout the
// JS templates and the Google Fonts stylesheet. The one addition is connect-src, since the
// admin view fetches the live CAD->NGN rate from an external API.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      connectSrc: ["'self'", 'https://open.er-api.com'],
    },
  },
}));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use(apiRoutes);

// ---------- App shell ----------
// "/" is the worker-facing link Ebenezer shares. "/admin" is his own view.

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Turso can occasionally be slow/unreachable waking a cold DB (e.g. SQLITE_NOMEM
// "unable to open db file"); a couple of quick retries rides that out instead of
// crashing the whole serverless function on a single transient blip.
async function migrateWithRetry(retries = 2, delayMs = 400) {
  for (let attempt = 0; ; attempt++) {
    try {
      await migrate();
      return;
    } catch (err) {
      if (attempt >= retries) throw err;
      console.error(`Migration attempt ${attempt + 1} failed, retrying:`, err.message);
      await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
    }
  }
}

try {
  await migrateWithRetry();
} catch (err) {
  console.error('Migration failed', err);
  if (!process.env.VERCEL) process.exit(1);
  throw err;
}

if (!process.env.VERCEL) {
  app.listen(PORT, () => console.log(`Ledger listening on :${PORT}`));
}

export default app;
