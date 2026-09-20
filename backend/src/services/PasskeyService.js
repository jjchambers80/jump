// WebAuthn passkeys (spec 030 B) with @simplewebauthn/server. Registration
// needs a signed-in user (plus step-up); sign-in is public and ends in a
// one-time bridge token the frontend swaps for an Auth.js session
// (`token-bridge` Credentials provider). Challenges live in
// VerificationToken for five minutes; private keys never reach Jump.

import { randomBytes } from 'node:crypto';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { prisma } from '@jump/db';
import { AuthenticationError, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import { describeUserAgent, deviceLabel } from './SessionService.js';
import { hashToken } from '../utils/oneTimeTokens.js';
import logger from '../utils/logger.js';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const RP_NAME = 'Jump';

function frontendOrigins() {
  const raw = process.env.FRONTEND_URL || 'http://localhost:3001';
  return raw.split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
}

/** RP id = host of the first FRONTEND_URL unless WEBAUTHN_RP_ID overrides it. */
export function rpID() {
  if (process.env.WEBAUTHN_RP_ID) return process.env.WEBAUTHN_RP_ID;
  return new URL(frontendOrigins()[0]).hostname;
}

/** Accepted origins: the FRONTEND_URL list, plus any localhost port outside production (as CORS does). */
export function expectedOrigin(origin) {
  const list = frontendOrigins();
  if (origin && list.includes(origin)) return origin;
  if (origin && process.env.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    return origin;
  }
  return list;
}

async function storeChallenge(identifier, challenge) {
  await prisma.$transaction([
    prisma.verificationToken.deleteMany({ where: { identifier } }),
    prisma.verificationToken.create({
      data: { identifier, token: hashToken(challenge), expires: new Date(Date.now() + CHALLENGE_TTL_MS) },
    }),
  ]);
}

/** Remove and return the stored challenge hash; null when missing or expired. */
async function takeChallenge(identifier) {
  const row = await prisma.verificationToken.findFirst({ where: { identifier } });
  if (!row) return null;
  await prisma.verificationToken.deleteMany({ where: { identifier } });
  return row.expires >= new Date() ? row.token : null;
}

function toJson(row) {
  return {
    id: row.id,
    label: row.label,
    deviceType: row.deviceType,
    backedUp: row.backedUp,
    transports: row.transports,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
  };
}

class PasskeyService {
  async list(userId) {
    const rows = await prisma.passkey.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
    return rows.map(toJson);
  }

  async count(userId) {
    return prisma.passkey.count({ where: { userId } });
  }

  // ---- Registration (signed in) ----

  async registrationOptions(user) {
    const existing = await prisma.passkey.findMany({ where: { userId: user.id }, select: { credentialId: true, transports: true } });
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: rpID(),
      userID: new TextEncoder().encode(user.id),
      userName: user.email,
      userDisplayName: user.name || user.email,
      attestationType: 'none',
      excludeCredentials: existing.map((c) => ({ id: c.credentialId, transports: c.transports })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    });
    await storeChallenge(`webauthn-reg:${user.id}`, options.challenge);
    return options;
  }

  async verifyRegistration(user, { response, label, origin, userAgent }) {
    const expected = await takeChallenge(`webauthn-reg:${user.id}`);
    if (!expected) throw new ValidationError('The passkey prompt expired. Try again.');

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: (challenge) => hashToken(challenge) === expected,
        expectedOrigin: expectedOrigin(origin),
        expectedRPID: rpID(),
        requireUserVerification: false,
      });
    } catch (error) {
      throw new ValidationError(`Passkey could not be verified: ${error.message}`);
    }
    if (!verification.verified || !verification.registrationInfo) {
      throw new ValidationError('Passkey could not be verified');
    }
    const info = verification.registrationInfo;
    const finalLabel = (typeof label === 'string' && label.trim().slice(0, 80)) || deviceLabel(describeUserAgent(userAgent));
    const row = await prisma.passkey.create({
      data: {
        userId: user.id,
        credentialId: info.credential.id,
        publicKey: Buffer.from(info.credential.publicKey),
        counter: info.credential.counter,
        transports: info.credential.transports || [],
        deviceType: info.credentialDeviceType,
        backedUp: info.credentialBackedUp,
        aaguid: info.aaguid || null,
        label: finalLabel,
      },
    });
    logger.info('Passkey registered', { event: 'passkey_registered', userId: user.id, passkeyId: row.id });
    return toJson(row);
  }

  async rename(userId, id, label) {
    const clean = typeof label === 'string' ? label.trim().slice(0, 80) : '';
    if (!clean) throw new ValidationError('Give the passkey a name');
    const result = await prisma.passkey.updateMany({ where: { id, userId }, data: { label: clean } });
    if (result.count === 0) throw new NotFoundError('Passkey not found');
    return toJson(await prisma.passkey.findUnique({ where: { id } }));
  }

  async remove(userId, id) {
    const result = await prisma.passkey.deleteMany({ where: { id, userId } });
    if (result.count === 0) throw new NotFoundError('Passkey not found');
    logger.info('Passkey removed', { event: 'passkey_removed', userId, passkeyId: id });
  }

  // ---- Authentication (public: sign-in; signed in: step-up) ----

  /**
   * Options for a discoverable-credential assertion. `subject` scopes the
   * challenge: a random id for sign-in, the user id for step-up.
   */
  async authenticationOptions({ subject, userVerification = 'preferred' } = {}) {
    const challengeId = subject || randomBytes(16).toString('base64url');
    const options = await generateAuthenticationOptions({ rpID: rpID(), allowCredentials: [], userVerification });
    await storeChallenge(`webauthn-auth:${challengeId}`, options.challenge);
    return { challengeId, options };
  }

  /**
   * Verify an assertion. Returns the owning user and the passkey. When
   * `expectUserId` is set (step-up) the credential must belong to that user.
   */
  async verifyAuthentication({ challengeId, response, origin, expectUserId = null }) {
    const expected = await takeChallenge(`webauthn-auth:${challengeId}`);
    if (!expected) throw new AuthenticationError('The passkey prompt expired. Try again.');
    const credentialId = response?.id;
    const passkey = credentialId ? await prisma.passkey.findUnique({ where: { credentialId }, include: { user: true } }) : null;
    if (!passkey || (expectUserId && passkey.userId !== expectUserId) || passkey.user.deletedAt) {
      throw new AuthenticationError('Passkey not recognized');
    }

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: (challenge) => hashToken(challenge) === expected,
        expectedOrigin: expectedOrigin(origin),
        expectedRPID: rpID(),
        requireUserVerification: false,
        credential: {
          id: passkey.credentialId,
          publicKey: new Uint8Array(passkey.publicKey),
          counter: passkey.counter,
          transports: passkey.transports,
        },
      });
    } catch (error) {
      throw new AuthenticationError(`Passkey could not be verified: ${error.message}`);
    }
    if (!verification.verified) throw new AuthenticationError('Passkey could not be verified');

    await prisma.passkey.update({
      where: { id: passkey.id },
      data: { counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() },
    });
    return { user: passkey.user, passkey: toJson(passkey), userVerified: verification.authenticationInfo.userVerified };
  }
}

export default new PasskeyService();
