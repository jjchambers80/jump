// Guest status-page token and link for an application (spec 011).
// The token is derived (HMAC of the application id under AUTH_SECRET) so any
// email sent later — decisions, payment due — can carry a working link
// without storing the raw token. `Application.statusTokenHash` keeps sha256
// of it for the lookup.

import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { storefrontFor } from '../utils/storefrontUrl.js';

export function hashToken(raw) {
  return createHash('sha256').update(String(raw)).digest('hex');
}

export function statusToken(applicationId) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET is required to sign application status links');
  return createHmac('sha256', secret).update(`application-status:${applicationId}`).digest('hex');
}

export function verifyStatusToken(applicationId, raw) {
  if (!raw) return false;
  const expected = Buffer.from(statusToken(applicationId));
  const given = Buffer.from(String(raw));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Absolute storefront status URL (custom domain when active), token included. */
export async function statusUrlFor(application) {
  const { base } = await storefrontFor(application.organizationId);
  return `${base}/events/${application.eventId}/apply/status/${application.id}?token=${statusToken(application.id)}`;
}
