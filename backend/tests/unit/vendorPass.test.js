// Unit tests for the vendor door pass payload (spec 036)
//
// Parsing runs before any database work, on whatever a camera in bad light or
// a staffer's thumb produced. It must accept every shape a vendor can actually
// present and refuse everything else without throwing.

import { jest } from '@jest/globals';

jest.unstable_mockModule('../../src/utils/metrics.js', () => ({
  recordQRGeneration: jest.fn(),
}));

jest.unstable_mockModule('../../src/utils/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { default: QRService } = await import('../../src/services/QRService.js');

const APP = 'clx1vendor000000000000001';
const EVENT = 'clx1event0000000000000001';
const TOKEN = 'a'.repeat(64);

describe('vendor door pass (spec 036)', () => {
  describe('generateVendorQRPayload', () => {
    it('round-trips through the parser', () => {
      const payload = QRService.generateVendorQRPayload(APP, EVENT, TOKEN);
      expect(payload).toBe(`jump://vendor?id=${APP}&e=${EVENT}&t=${TOKEN}`);
      expect(QRService.parseVendorPayload(payload)).toEqual({ applicationId: APP, eventId: EVENT, token: TOKEN });
    });

    it('escapes values so a stray & cannot forge a second field', () => {
      const payload = QRService.generateVendorQRPayload(APP, EVENT, 'a&t=b');
      expect(QRService.parseVendorPayload(payload).token).toBe('a&t=b');
    });
  });

  describe('parseVendorPayload', () => {
    it('accepts the storefront status URL from the approval email', () => {
      const url = `https://tickets.example.com/events/${EVENT}/apply/status/${APP}?token=${TOKEN}`;
      expect(QRService.parseVendorPayload(url)).toEqual({ applicationId: APP, eventId: EVENT, token: TOKEN });
    });

    it('accepts the shortened status URL served on a custom domain', () => {
      const url = `https://vendors.myfest.com/apply/status/${APP}?token=${TOKEN}`;
      expect(QRService.parseVendorPayload(url)).toEqual({ applicationId: APP, eventId: null, token: TOKEN });
    });

    it('accepts a typed id:token pair', () => {
      expect(QRService.parseVendorPayload(`  ${APP}:${TOKEN}  `)).toEqual({ applicationId: APP, eventId: null, token: TOKEN });
    });

    it('returns null rather than throwing for anything that is not a vendor pass', () => {
      for (const junk of [
        '',
        '   ',
        null,
        undefined,
        42,
        'jump://ticket?id=t1&b=JUMP-1&e=e1', // a ticket QR held up at the vendor door
        'jump://vendor?id=only-an-id',
        'jump://vendor?t=only-a-token',
        'https://tickets.example.com/events/e1',
        `https://tickets.example.com/apply/status/${APP}`, // no token
        'not a url at all',
        'http://[',
      ]) {
        expect(QRService.parseVendorPayload(junk)).toBeNull();
      }
    });

    it('does not mistake a ticket payload for a vendor pass', () => {
      const ticket = QRService.generateQRPayload('tkt-1', EVENT, 'JUMP-TEST00000001');
      expect(QRService.parseVendorPayload(ticket)).toBeNull();
      // …and the ticket parser still does not accept a vendor pass.
      expect(QRService.parseQRPayload(QRService.generateVendorQRPayload(APP, EVENT, TOKEN))).toBeNull();
    });
  });
});
