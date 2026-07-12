# Ledger — Work Hours Portal

A small hosted app for tracking freelance worker hours and splitting pay
between tax, the worker's cut, and Ebenezer's cut, with live USD→NGN
conversion.

- `/` — the link to share with workers. Opens straight to a name picker;
  workers can only see and log their own hours (never rates, tax, other
  workers, or Ebenezer's cut).
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

### 2. Deploy to Render

1. Push this folder to a GitHub repo.
2. In Render, "New +" → "Web Service" → connect the repo. Render should
   pick up `render.yaml` automatically (Node, `npm install`, `npm start`).
   If it doesn't, set those manually and pick the **Free** plan.
3. Under the service's Environment settings, add:
   - `ADMIN_PASSWORD` — pick something only you know
   - `TURSO_DATABASE_URL` — from step 1
   - `TURSO_AUTH_TOKEN` — from step 1
4. Deploy. Render gives you a URL like `https://ledger-xxxx.onrender.com`.
   - Share `https://ledger-xxxx.onrender.com/` with workers.
   - Use `https://ledger-xxxx.onrender.com/admin` yourself.

Free-tier Render instances spin down after inactivity and take a few
seconds to wake back up on the next request — normal for this plan, not a
bug.

## What's still an open question (carried over from the project brief)

- **Per-worker access control.** Right now the worker link has no
  per-person login — anyone with the link can pick any name from the
  worker list and log time as them. The `/admin` password stops outsiders
  from seeing rates/tax/other workers, but doesn't stop one worker from
  logging time as another. A lightweight per-worker PIN would close this
  if it becomes a problem.
- **Editing/deleting entries as a worker.** Still admin-only, as before.
- **Timezones.** Still plain `HH:MM` with no timezone recorded.
- **Split percentage.** Still per-worker, defaulting to 50%, changeable
  any time in the admin view (not locked per pay period).

## File map

- `server.js` — Express app: admin auth, all `/api/*` routes, serves
  `public/`.
- `db.js` — Turso/libSQL client + schema migration.
- `public/index.html` — the whole frontend (worker view + admin view).
- `render.yaml` — Render blueprint (optional convenience for step 2 above).
- `.env.example` — copy to `.env` for local dev.
