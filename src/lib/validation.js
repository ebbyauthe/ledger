export function isValidDate(d) {
  return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
}

export function parseEntryInput(body) {
  const { date, hours, note, periodId } = body || {};
  if (!isValidDate(date)) return null;
  if (typeof hours !== 'number' || !Number.isFinite(hours) || hours <= 0 || hours > 24) return null;
  return { date, hours, note, periodId: typeof periodId === 'string' ? periodId : null };
}

// Reserved so a business handle can never collide with an existing route prefix or static asset.
const RESERVED_SLUGS = new Set(['admin', 'api', 'w', 'js', 'styles.css', 'favicon.ico']);

export function isValidSlug(slug) {
  return typeof slug === 'string' && /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(slug) && !RESERVED_SLUGS.has(slug);
}

// Shape-only validation for creating a new business profile. The invite code itself is an
// authorization check, not an input-shape one, so the route verifies it separately.
export function parseAccountSignupInput(body) {
  const { name, slug, password, code } = body || {};
  const cleanName = typeof name === 'string' ? name.trim() : '';
  if (!cleanName) return null;
  if (!isValidSlug(slug)) return null;
  if (typeof password !== 'string' || password.length < 8) return null;
  return { name: cleanName, slug, password, code: typeof code === 'string' ? code : '' };
}
