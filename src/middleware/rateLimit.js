import rateLimit from 'express-rate-limit';

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too many attempts, try again later' },
});

// The worker picker is public by design (workers choose their name before logging in), but
// unthrottled it would let anyone cycle through guessed business handles to find which exist
// and list their workers. Generous enough for normal use, too tight for enumeration.
export const pickerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too many requests, try again later' },
});

// Tighter than loginLimiter: creating a profile hashes a password (scrypt is intentionally
// CPU-expensive) and leaves a persistent row behind, so it's worth throttling harder.
export const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too many attempts, try again later' },
});
