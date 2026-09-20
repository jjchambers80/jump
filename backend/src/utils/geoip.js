// Approximate location for the Devices list (spec 030). Off unless
// GEOIP_ENABLED=true and `geoip-lite` (bundled MaxMind GeoLite2, CC BY-SA
// 4.0 — attribution shown on the Devices card) is installed in the backend
// workspace. Anything else, private ranges included, resolves to null so the
// UI says "Location unavailable" instead of guessing.

import { isIP } from 'node:net';
import logger from './logger.js';

let loader = null;

async function module_() {
  if (process.env.GEOIP_ENABLED !== 'true') return null;
  if (!loader) {
    const name = 'geoip-lite'; // variable so bundlers never try to resolve it
    loader = import(name)
      .then((mod) => mod.default || mod)
      .catch((error) => {
        logger.warn('GEOIP_ENABLED but geoip-lite is not installed', { error: error.message });
        return null;
      });
  }
  return loader;
}

function isPrivate(ip) {
  return (
    /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip) ||
    ip === '::1' ||
    /^f[cd]/i.test(ip) ||
    /^fe80/i.test(ip)
  );
}

/** @returns {Promise<{ city: string|null, region: string|null, country: string|null }|null>} */
export async function lookupGeo(ip) {
  if (!ip || !isIP(ip) || isPrivate(ip)) return null;
  const geoip = await module_();
  if (!geoip) return null;
  try {
    const hit = geoip.lookup(ip);
    if (!hit) return null;
    return { city: hit.city || null, region: hit.region || null, country: hit.country || null };
  } catch {
    return null;
  }
}
