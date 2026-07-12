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

- **Frontend:** one static `public/index.html` (no build step) — same
  visual design as the original prototype, now talking to a real backend
  over `fetch()` instead of the Claude-only `window.storage` API.
- **Backend:** Node.js + Express (`server.js`), a handful of REST
  endpoints under `/api/...`.
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
   `vercel.json` and the `api/[...path].js` serverless entry point
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
in-memory (see `db.js` / `server.js`). This also means there's no
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

- `server.js` — Express app: admin auth, all `/api/*` routes, serves
  `public/` locally. Exports the app for serverless use.
- `api/[...path].js` — Vercel serverless entry point; wraps `server.js`.
- `vercel.json` — routes `/admin` to the static frontend on Vercel.
- `db.js` — Turso/libSQL client + schema migration.
- `public/index.html` — the whole frontend (worker view + admin view).
- `.env.example` — copy to `.env` for local dev.
