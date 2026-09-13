// Unit tests for GoogleWalletService — class/object projection and save JWT
// The TEST ONLY RSA key from tests/fixtures/wallet stands in for the
// Google Cloud service-account key.

import fs from 'fs';
import path from 'path';
import { createPublicKey } from 'crypto';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../fixtures/wallet');
const privateKey = fs.readFileSync(path.join(fixtures, 'signerKey.pem'), 'utf8');
const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });

process.env.BACKEND_URL = 'https://api.example.com';
process.env.GOOGLE_WALLET_ISSUER_ID = '3388000000012345678';
process.env.GOOGLE_WALLET_SA_EMAIL = 'wallet@test-project.iam.gserviceaccount.com';
process.env.GOOGLE_WALLET_SA_PRIVATE_KEY = privateKey;
process.env.GOOGLE_WALLET_ORIGINS = 'https://app.example.com, https://www.example.com';

const { default: googleWalletService } = await import('../../../src/services/wallet/GoogleWalletService.js');

const eventDate = new Date('2027-01-01T20:00:00Z');

function makeTicket() {
  return {
    id: 'ckticket1',
    eventId: 'ckevent1',
    orderId: 'ckorder1',
    barcode: 'JUMP-ABCDEFGHJKLM',
    ticketNumber: 3,
    status: 'VALID',
    qrCodeJwt: 'jump://ticket?id=ckticket1&b=JUMP-ABCDEFGHJKLM&e=ckevent1',
    priceTier: { name: 'VIP' },
    contact: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
    order: { id: 'ckorder1', orderRef: 'JMP-1234' },
    event: {
      id: 'ckevent1',
      name: 'Test Fest',
      date: eventDate,
      updatedAt: new Date('2026-09-01T00:00:00Z'),
      googleClassId: null,
      googleClassSyncedAt: null,
      venue: {
        name: 'The Hall',
        address: '1 Main St',
        city: 'Raleigh',
        state: 'NC',
        postalCode: '27601',
        organization: {
          id: 'org1',
          name: 'Acme Events',
          brandColor: '#10b981',
          logoImageId: 'img1',
          logoUrl: '/images/img1/abc/thumb',
        },
      },
    },
  };
}

describe('GoogleWalletService ids', () => {
  it('prefixes class and object ids with the issuer id', () => {
    expect(googleWalletService.classId('ckevent1')).toBe('3388000000012345678.event-ckevent1');
    expect(googleWalletService.objectId('ckticket1')).toBe('3388000000012345678.ticket-ckticket1');
  });
});

describe('GoogleWalletService.buildClass', () => {
  it('projects the event into an EventTicketClass', () => {
    const cls = googleWalletService.buildClass(makeTicket().event);
    expect(cls).toMatchObject({
      id: '3388000000012345678.event-ckevent1',
      issuerName: 'Acme Events',
      reviewStatus: 'UNDER_REVIEW',
      eventName: { defaultValue: { language: 'en-US', value: 'Test Fest' } },
      venue: {
        name: { defaultValue: { value: 'The Hall' } },
        address: { defaultValue: { value: '1 Main St, Raleigh, NC, 27601' } },
      },
      dateTime: { start: eventDate.toISOString() },
      hexBackgroundColor: '#10b981',
      logo: { sourceUri: { uri: 'https://api.example.com/images/img1/abc/thumb' } },
    });
  });

  it('omits the logo when it would not be a public https URL', () => {
    const event = makeTicket().event;
    event.venue.organization.logoUrl = 'http://localhost:3000/images/x';
    expect(googleWalletService.buildClass(event).logo).toBeUndefined();
  });
});

describe('GoogleWalletService.buildObject', () => {
  it('projects the ticket into an ACTIVE EventTicketObject with the QR payload', () => {
    const obj = googleWalletService.buildObject(makeTicket());
    expect(obj).toMatchObject({
      id: '3388000000012345678.ticket-ckticket1',
      classId: '3388000000012345678.event-ckevent1',
      state: 'ACTIVE',
      ticketHolderName: 'Ada Lovelace',
      ticketNumber: '3',
      ticketType: { defaultValue: { value: 'VIP' } },
      barcode: {
        type: 'QR_CODE',
        value: 'jump://ticket?id=ckticket1&b=JUMP-ABCDEFGHJKLM&e=ckevent1',
        alternateText: 'JUMP-ABCDEFGHJKLM',
      },
      groupingInfo: { groupingId: 'ckorder1', sortIndex: 3 },
    });
    expect(new Date(obj.validTimeInterval.end.date).getTime()).toBe(eventDate.getTime() + 24 * 3600 * 1000);
  });
});

describe('GoogleWalletService save JWT', () => {
  it('signs a skinny RS256 JWT with the savetowallet claims', () => {
    const token = googleWalletService.skinnySaveJwt('ckticket1');
    const decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'] });

    expect(decoded).toMatchObject({
      iss: 'wallet@test-project.iam.gserviceaccount.com',
      aud: 'google',
      typ: 'savetowallet',
      origins: ['https://app.example.com', 'https://www.example.com'],
      payload: { eventTicketObjects: [{ id: '3388000000012345678.ticket-ckticket1' }] },
    });
    expect(typeof decoded.iat).toBe('number');
    expect(`https://pay.google.com/gp/v/save/${token}`.length).toBeLessThan(1800);
  });

  it('fat JWT embeds both class and object', () => {
    const token = googleWalletService.fatSaveJwt(makeTicket());
    const decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'] });
    expect(decoded.payload.eventTicketClasses[0].id).toBe('3388000000012345678.event-ckevent1');
    expect(decoded.payload.eventTicketObjects[0].id).toBe('3388000000012345678.ticket-ckticket1');
  });
});
