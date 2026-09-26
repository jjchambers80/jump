// `frontend/src/lib/legal.ts` mirrors `backend/src/config/legal.js`, and the
// backend re-renders its own copy of the same string to store as
// `LegalAcceptance.presentedText`. A one-sided edit therefore produces a
// consent record that does not match what the applicant was shown — which is
// the failure this file exists to catch. Nothing enforced it before.

import { describe, expect, it } from 'vitest';
import {
  applicationNotBookingText as backendNotBooking,
  applicationRefundText as backendRefund,
  applyConsentText as backendConsent,
  cardAuthorizationText as backendCardAuthorization,
} from '../../../backend/src/config/legal.js';
import {
  applicationNotBookingText,
  applicationRefundText,
  applyConsentText,
  cardAuthorizationText,
} from '../../src/lib/legal';

/** Inputs chosen to move every branch: both variants, singular/plural window, missing organizer. */
const CASES = [
  { amount: 250, paymentDueDays: 7, organizationName: 'Geek Expo', mapBound: false },
  { amount: 250, paymentDueDays: 7, organizationName: 'Geek Expo', mapBound: true },
  { amount: 288.5, paymentDueDays: 1, organizationName: 'Geek Expo', mapBound: false },
  { amount: 288.5, paymentDueDays: 1, organizationName: 'Geek Expo', mapBound: true },
  { amount: 0, paymentDueDays: null, organizationName: null, mapBound: false },
  { amount: 0, paymentDueDays: null, organizationName: null, mapBound: true },
] as const;

describe('legal.ts mirrors backend config/legal.js', () => {
  it.each(CASES)('cardAuthorizationText matches for %j', (input) => {
    expect(cardAuthorizationText(input)).toBe(backendCardAuthorization(input));
  });

  it.each(['Geek Expo', null])('applyConsentText matches for %s', (organizationName) => {
    expect(applyConsentText(organizationName)).toBe(backendConsent({ organizationName }));
    expect(applicationNotBookingText(organizationName)).toBe(
      backendNotBooking({ organizationName })
    );
    expect(applicationRefundText(organizationName)).toBe(backendRefund({ organizationName }));
  });

  // The variants must be distinguishable, not just equal across the mirror:
  // a booth applicant's card is not charged on approval.
  it('the booth variant does not promise a charge on approval', () => {
    const booth = cardAuthorizationText({ amount: 250, paymentDueDays: 7, organizationName: 'Geek Expo', mapBound: true });
    const card = cardAuthorizationText({ amount: 250, paymentDueDays: 7, organizationName: 'Geek Expo' });
    expect(booth).not.toBe(card);
    expect(booth).toContain('Nothing is charged unless my application is approved');
    expect(booth).toContain('I come back to pick my booth and pay $250.00 then');
    expect(card).toContain('I authorize Geek Expo to charge $250.00');
    for (const text of [booth, card]) expect(text).toContain('released to someone else');
  });

  // `publicProfile` defaults on and the listing goes live on approval; that is
  // the one thing an applicant cannot discover from the old label.
  it('the consent label discloses the public listing', () => {
    expect(applyConsentText('Geek Expo')).toContain(
      "my business name, description, website, socials and first photo will be shown on the event's public page"
    );
  });
});
