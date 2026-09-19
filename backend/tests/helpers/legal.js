// Legal acceptances for test requests (spec 024 phase 3): the current
// versions from config, so a bump there does not break every submission test.

import { LEGAL_VERSIONS } from '../../src/config/legal.js';

/** `[{ document, version }]` for TERMS + PRIVACY, plus CARD_AUTHORIZATION when asked. */
export function acceptances({ cardAuthorization = false } = {}) {
  return [
    { document: 'TERMS', version: LEGAL_VERSIONS.terms },
    { document: 'PRIVACY', version: LEGAL_VERSIONS.privacy },
    ...(cardAuthorization
      ? [{ document: 'CARD_AUTHORIZATION', version: LEGAL_VERSIONS.cardAuthorization }]
      : []),
  ];
}

/** Every document this config knows, current versions — accepted by any form. */
export function allAcceptances() {
  return acceptances({ cardAuthorization: true });
}
