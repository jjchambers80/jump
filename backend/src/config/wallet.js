// Wallet pass configuration (Apple Wallet / Google Wallet)
// Both providers are optional: when their secrets are absent the wallet
// buttons are simply hidden and the download routes answer 503.
// See specs/006-wallet-passes/quickstart.md for how to obtain each value.

import logger from '../utils/logger.js';

/**
 * Env vars may be pasted as single-line PEMs with literal "\n" sequences
 * (Railway UI) — normalise them back to real newlines.
 */
function pem(value) {
  if (!value) return null;
  return value.includes('\\n') ? value.replace(/\\n/g, '\n') : value;
}

export const appleConfig = {
  passTypeId: process.env.APPLE_PASS_TYPE_ID || null,
  teamId: process.env.APPLE_TEAM_ID || null,
  signerCert: pem(process.env.APPLE_PASS_CERT_PEM),
  signerKey: pem(process.env.APPLE_PASS_KEY_PEM),
  signerKeyPassphrase: process.env.APPLE_PASS_KEY_PASSPHRASE || undefined,
  wwdr: pem(process.env.APPLE_WWDR_PEM),
};

export const googleConfig = {
  issuerId: process.env.GOOGLE_WALLET_ISSUER_ID || null,
  serviceAccountEmail: process.env.GOOGLE_WALLET_SA_EMAIL || null,
  privateKey: pem(process.env.GOOGLE_WALLET_SA_PRIVATE_KEY),
  origins: (process.env.GOOGLE_WALLET_ORIGINS || process.env.FRONTEND_URL || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};

export function isAppleConfigured() {
  const c = appleConfig;
  return Boolean(c.passTypeId && c.teamId && c.signerCert && c.signerKey && c.wwdr);
}

export function isGoogleConfigured() {
  const c = googleConfig;
  return Boolean(c.issuerId && c.serviceAccountEmail && c.privateKey);
}

/**
 * Public base URL of this backend — wallet links in emails and API responses
 * must be absolute because they are opened by the Wallet apps directly.
 * Mirrors the helper used by EmailService for image URLs.
 */
export function backendPublicUrl() {
  if (process.env.BACKEND_URL) return process.env.BACKEND_URL.replace(/\/$/, '');
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  return `http://localhost:${process.env.PORT || 3000}`;
}

/**
 * Days until the Apple pass signing certificate expires, or null when the
 * certificate is missing/unparseable. Logged at startup so an expiring cert
 * (they last one year) is noticed before pass downloads start failing.
 */
export async function appleCertDaysRemaining() {
  if (!appleConfig.signerCert) return null;
  try {
    const { X509Certificate } = await import('crypto');
    const cert = new X509Certificate(appleConfig.signerCert);
    const ms = new Date(cert.validTo).getTime() - Date.now();
    return Math.floor(ms / 86400000);
  } catch (error) {
    logger.warn('Could not parse APPLE_PASS_CERT_PEM', { error: error.message });
    return null;
  }
}

export async function logWalletStatus() {
  if (!isAppleConfigured()) {
    logger.info('Apple Wallet passes disabled (APPLE_PASS_* not set)');
  } else {
    const days = await appleCertDaysRemaining();
    if (days !== null && days < 30) {
      logger.warn('Apple pass signing certificate expires soon', { daysRemaining: days });
    } else {
      logger.info('Apple Wallet passes enabled', { passTypeId: appleConfig.passTypeId, certDaysRemaining: days });
    }
  }
  if (!isGoogleConfigured()) {
    logger.info('Google Wallet passes disabled (GOOGLE_WALLET_* not set)');
  } else {
    logger.info('Google Wallet passes enabled', { issuerId: googleConfig.issuerId });
  }
}
