// Spec 048: what an audit diff may keep. Secret-looking columns record only
// that they changed; long values are cut so one save cannot bloat the table.

const SECRET_FIELD = /hash|secret|token|password|totp|recovery|apikey|codeChallenge/i;
const VALUE_MAX = 500;
const CHANGES_MAX = 16_000;

export const REDACTED = '[changed]';

function trim(value) {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (text.length <= VALUE_MAX) return value;
  return `${text.slice(0, VALUE_MAX)}…`;
}

/** { field: [before, after] } → the same, safe to persist. */
export function redactChanges(changes) {
  const out = {};
  for (const [field, [before, after]] of Object.entries(changes)) {
    out[field] = SECRET_FIELD.test(field)
      ? [before == null ? null : REDACTED, after == null ? null : REDACTED]
      : [trim(before), trim(after)];
  }
  if (JSON.stringify(out).length <= CHANGES_MAX) return out;
  // Too big to keep every value: keep which fields changed.
  return Object.fromEntries(Object.keys(out).map((field) => [field, [REDACTED, REDACTED]]));
}
