import crypto from 'node:crypto';

export const SESSION_COOKIE = 'ledger_admin_session';
export const WORKER_SESSION_COOKIE = 'ledger_worker_session';
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

const PASSWORD_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'; // no 0/O/1/l/I

export function uid() {
  return crypto.randomBytes(6).toString('hex');
}

// Session tokens are hashed before hitting the DB so a leaked DB dump can't be replayed as live cookies.
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Every session-cookie read goes through here. cookie-parser turns any value starting with
// "j:" into parsed JSON (an object or number), which would make hashToken throw — and an
// uncaught throw used to take the whole server down from a single unauthenticated request.
// Our tokens are always 48 hex chars, so anything else is simply treated as no session.
export function readSessionToken(req, cookieName) {
  const token = req.cookies?.[cookieName];
  return typeof token === 'string' && /^[0-9a-f]{48}$/.test(token) ? token : null;
}

export function safeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function generatePassword(length = 10) {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += PASSWORD_CHARS[crypto.randomInt(0, PASSWORD_CHARS.length)];
  }
  return out;
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 32).toString('hex');
  const bufA = Buffer.from(candidate);
  const bufB = Buffer.from(hash);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
