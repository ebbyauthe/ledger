# Ledger — Work Hours Portal

A small hosted app for tracking freelance worker hours and splitting pay
between tax, the worker's cut, and Ebenezer's cut, with live CAD→NGN
conversion.

- `/` — the link to share with workers. Opens straight to a name picker;
  workers can only view their own hours and earnings (never rates, tax,
  other workers, or Ebenezer's cut). Logging hours is admin-only.
- `/admin` — Ebenezer's view, gated by a single shared password
  (`ADMIN_PASSWORD`). Full rate/tax/worker management.

## How it's built

- **Frontend:** static HTML/CSS/JS under `public/` — still no build step,
  but split into ES modules (`public/js/*.js`) by concern (formatting,
  API calls, shared state/pay-math, admin rendering, worker rendering)
  instead of one long inline `<script>`. Talks to the backend over
  `fetch()`.
- **Backend:** Node.js + Express (`server.js` is just the app entry
  point — middleware setup, static file serving, and the `/admin` shell
  route). The actual REST API lives in `src/`, organized by concern:
  - `src/routes/` — one file per resource (`adminWorkers.js`,
    `adminEntries.js`, `adminPayments.js`, `adminPeriods.js`,
    `adminTimers.js`, `adminSettings.js`, `adminState.js`,
    `adminAuth.js`, `worker.js`), combined in `src/routes/index.js`.
  - `src/middleware/` — `requireAdmin`/`requireWorkerSession` session
    gates, the shared login rate limiter.
  - `src/lib/` — pure helpers with no Express dependency: password/session
    crypto, input validation, response mappers, the payment subset-sum
    matcher.
  - `src/db/` — the Turso/libSQL client and schema migration.
- **Database:** SQLite, via [Turso](https://turso.tech) (libSQL) so data
  actually persists on a free host. Locally, no Turso account is needed —
  it falls back to a plain SQLite file at `data/local.db`.
- **Auth:** no per-worker accounts (matches the original prototype —
  anyone with the `/` link can pick any name and log time as them; that's
  still an open question, see below). The `/admin` route is protected by
  one shared password and a session cookie.

## Running it locally

```bash
npm install
cp .env.example .env   # then set ADMIN_PASSWORD to whatever you want locally
npm run dev
```

Visit `http://localhost:3000/` for the worker view, or
`http://localhost:3000/admin` for the admin view. Data is stored in
`data/local.db`, which is gitignored — delete it any time to start fresh.

## Deploying it for real

### 1. Create a free Turso database

1. Install the Turso CLI and sign up: https://docs.turso.tech/quickstart
2. `turso db create ledger`
3. `turso db show ledger --url` → this is your `TURSO_DATABASE_URL`
4. `turso db tokens create ledger` → this is your `TURSO_AUTH_TOKEN`

(The web dashboard at https://app.turso.tech works too, if you'd rather
not use the CLI — it gives you the same URL and token.)

### 2. Deploy to Vercel

1. Push this folder to a GitHub repo.
2. In Vercel, "Add New..." → "Project" → import the repo. Vercel picks up
   `vercel.json` and the `api/index.js` serverless entry point
   automatically — no build command needed.
3. Under the project's Environment Variables settings, add:
   - `ADMIN_PASSWORD` — pick something only you know
   - `TURSO_DATABASE_URL` — from step 1
   - `TURSO_AUTH_TOKEN` — from step 1
4. Deploy. Vercel gives you a URL like `https://ledger-xxxx.vercel.app`.
   - Share `https://ledger-xxxx.vercel.app/` with workers.
   - Use `https://ledger-xxxx.vercel.app/admin` yourself.

Requests run as serverless functions — no persistent Node process, so
admin sessions are stored in the Turso `admin_sessions` table rather than
in-memory (see `src/db/` / `src/middleware/`). This also means there's no
Render-style spin-down: cold starts are rare and sub-second.

## Per-worker access control

Each worker gets a random password when Ebenezer adds them (shown once in
the admin UI so it can be shared directly). Picking a name on `/` now
requires that password before showing hours or letting you log time —
the `/admin` view can reset a worker's password if they lose it, and
workers can change their own password later from their view. Sessions
are stored server-side (`worker_sessions` table), same pattern as the
admin session.

## What's still an open question (carried over from the project brief)

- **Logging/editing/deleting entries as a worker.** All admin-only.
  Workers can view their own hours and earnings but can't log time
  themselves — Ebenezer enters hours as a decimal (e.g. `4.22`) on
  their behalf.
- **Split percentage.** Still per-worker, defaulting to 50%, changeable
  any time in the admin view (not locked per pay period).

## File map

- `server.js` — Express app entry point: middleware, static file
  serving, the `/admin` shell route, migration-on-boot. Exports the app
  for serverless use.
- `src/routes/` — all `/api/*` route handlers, one file per resource.
- `src/middleware/` — `requireAdmin`, `requireWorkerSession`, the login
  rate limiter.
- `src/lib/` — framework-free helpers: `auth.js` (session/password
  crypto), `validation.js`, `mappers.js` (DB row → API shape), `subsetSum.js`
  (the payment-matching algorithm), `sessions.js` (session pruning).
- `src/db/` — `client.js` (Turso/libSQL connection) and `migrate.js`
  (schema + migrations).
- `api/index.js` — Vercel serverless entry point; wraps `server.js`.
- `vercel.json` — rewrites every request to `api/index.js` so Express's
  own routing (static files, `/admin`, `/api/*`) handles it, same as
  running `server.js` directly.
- `public/index.html` — the page shell (loads `styles.css` and
  `js/main.js` as an ES module).
- `public/styles.css` — all styling.
- `public/js/` — the frontend, split by concern: `api.js` (fetch
  wrapper), `format.js` (date/currency formatting), `state.js` (shared
  state + pay-math), `modal.js`, `admin-data.js`/`admin-render.js`
  (admin view), `worker-render.js` (worker view), `main.js` (boots
  whichever view matches the current path).
- `.env.example` — copy to `.env` for local dev.
