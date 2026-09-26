/**
 * The one normalization for a Contact email (spec 037 C3). A Contact is one
 * row per `(organizationId, normalizeEmail(email))`, so every upsert and every
 * lookup on `organizationId_email` goes through this — never an ad-hoc
 * `toLowerCase()`.
 *
 * @param {unknown} email
 * @returns {string} trimmed, lower-cased address ('' for a missing value)
 */
export function normalizeEmail(email) {
  if (email === undefined || email === null) return '';
  return String(email).trim().toLowerCase();
}

export default normalizeEmail;
