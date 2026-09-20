// Password rules (spec 030 B): 12–128 characters, not the account's email,
// and not in the Have I Been Pwned corpus (k-anonymity range lookup —
// only the first 5 hex characters of the SHA-1 leave the server). The
// breach check fails open on any network problem and is skipped when
// HIBP_CHECK=false.

import { createHash } from 'node:crypto';
import logger from './logger.js';

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;
const HIBP_TIMEOUT_MS = 2000;

/** Synchronous rules. Returns an error message or null. */
export function passwordRuleError(password, { email } = {}) {
  if (typeof password !== 'string') return 'Password is required';
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters`;
  if (password.length > PASSWORD_MAX) return `Use ${PASSWORD_MAX} characters or fewer`;
  if (email) {
    const lower = password.toLowerCase();
    const local = email.toLowerCase().split('@')[0];
    if (lower === email.toLowerCase() || (local.length >= 4 && lower === local)) {
      return 'Your password cannot be your email address';
    }
  }
  return null;
}

/**
 * True when the password appears in a known breach. Never throws; false on
 * timeout / network error / disabled.
 */
export async function isBreachedPassword(password, { fetchImpl = fetch } = {}) {
  if (process.env.HIBP_CHECK === 'false') return false;
  const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HIBP_TIMEOUT_MS);
    const res = await fetchImpl(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Add-Padding': 'true', 'User-Agent': 'jump-ticketing' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return false;
    const text = await res.text();
    return text.split('\n').some((line) => {
      const [hashSuffix, count] = line.trim().split(':');
      return hashSuffix === suffix && Number(count) > 0;
    });
  } catch (error) {
    logger.warn('HIBP check skipped', { error: error.message });
    return false;
  }
}
