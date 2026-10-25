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

// Must be registered before express.static, whose default index.html-serving behavior for bare
// "/" would otherwise win the route match before this redirect is ever reached.
app.get('/', (req, res) => res.redirect('/w/default'));

app.use(express.static(path.join(__dirname, 'public')));

app.use(apiRoutes);

// ---------- App shell ----------
// "/w/:slug" is the worker-facing link for a given business profile. "/admin" is the owner's view.

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/w/:slug', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Last stop for any error — including async route errors forwarded by src/lib/router.js.
// Client errors (e.g. malformed JSON, status 400) keep their status; anything else becomes a
// generic 500 so internals like stack traces or SQL never reach the browser.
app.use((err, req, res, next) => {
  if(res.headersSent) return next(err);
  const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 500 ? err.status : 500;
  if(status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? 'something went wrong' : 'bad request' });
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
