// Purpose-scoped, non-expiring cancellation token for an RSVP.
// Rotating AUTH_SECRET invalidates outstanding links.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { storefrontFor } from '../utils/storefrontUrl.js';

function secret() {
  if (!process.env.AUTH_SECRET) throw new Error('AUTH_SECRET is required to sign RSVP cancellation links');
  return process.env.AUTH_SECRET;
}

function signature(encodedId) {
  return createHmac('sha256', secret()).update(`rsvp-cancel:${encodedId}`).digest('base64url');
}

export function cancelToken(rsvpId) {
  const encodedId = Buffer.from(String(rsvpId), 'utf8').toString('base64url');
  return `${encodedId}.${signature(encodedId)}`;
}

export function rsvpIdFromCancelToken(token) {
  const [encodedId, supplied, extra] = String(token || '').split('.');
  if (!encodedId || !supplied || extra) return null;
  const expected = Buffer.from(signature(encodedId));
  const actual = Buffer.from(supplied);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const id = Buffer.from(encodedId, 'base64url').toString('utf8');
    return id || null;
  } catch {
    return null;
  }
}

export async function cancelUrlFor(rsvp) {
  const { base } = await storefrontFor(rsvp.event.venue.organizationId);
  return `${base}/rsvp/cancel?token=${encodeURIComponent(cancelToken(rsvp.id))}`;
}
