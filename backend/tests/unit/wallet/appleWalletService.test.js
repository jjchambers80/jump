// Unit tests for AppleWalletService — pass.json projection and signed .pkpass output
// Uses self-signed TEST ONLY certificates from tests/fixtures/wallet.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../fixtures/wallet');

process.env.BACKEND_URL = 'https://api.example.com';
process.env.APPLE_PASS_TYPE_ID = 'pass.events.jump.test';
process.env.APPLE_TEAM_ID = 'TESTTEAM01';
process.env.APPLE_PASS_CERT_PEM = fs.readFileSync(path.join(fixtures, 'signerCert.pem'), 'utf8');
process.env.APPLE_PASS_KEY_PEM = fs.readFileSync(path.join(fixtures, 'signerKey.pem'), 'utf8');
process.env.APPLE_WWDR_PEM = fs.readFileSync(path.join(fixtures, 'wwdr.pem'), 'utf8');

const { default: appleWalletService } = await import('../../../src/services/wallet/AppleWalletService.js');
const { default: walletTokenService } = await import('../../../src/services/wallet/WalletTokenService.js');

const eventDate = new Date('2027-01-01T20:00:00Z');

function makeTicket(overrides = {}) {
  return {
    id: 'ckticket1',
    eventId: 'ckevent1',
    orderId: 'ckorder1',
    barcode: 'JUMP-ABCDEFGHJKLM',
    ticketNumber: 7,
    status: 'VALID',
    qrCodeJwt: 'jump://ticket?id=ckticket1&b=JUMP-ABCDEFGHJKLM&e=ckevent1',
    priceTier: { name: 'VIP' },
    contact: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
    order: { id: 'ckorder1', orderRef: 'JMP-1234' },
    event: {
      id: 'ckevent1',
      name: 'Test Fest',
      date: eventDate,
      venue: {
        name: 'The Hall',
        address: '1 Main St',
        city: 'Raleigh',
        state: 'NC',
        postalCode: '27601',
        organization: { id: 'org1', name: 'Acme Events', brandColor: '#10b981', logoImageId: null, logoUrl: null },
      },
    },
    ...overrides,
  };
}

describe('AppleWalletService.buildPassJson', () => {
  it('projects ticket data into an eventTicket pass', () => {
    const json = appleWalletService.buildPassJson(makeTicket());

    expect(json.formatVersion).toBe(1);
    expect(json.passTypeIdentifier).toBe('pass.events.jump.test');
    expect(json.teamIdentifier).toBe('TESTTEAM01');
    expect(json.serialNumber).toBe('ckticket1');
    expect(json.organizationName).toBe('Acme Events');
    expect(json.backgroundColor).toBe('rgb(16, 185, 129)');
    expect(json.foregroundColor).toBe('rgb(255, 255, 255)');
    expect(json.sharingProhibited).toBe(true);

    const fields = json.eventTicket;
    expect(fields.primaryFields[0]).toMatchObject({ key: 'event', value: 'Test Fest' });
    expect(fields.secondaryFields.map((f) => f.value)).toEqual(['The Hall', 'VIP']);
    expect(fields.auxiliaryFields[0].value).toBe('Ada Lovelace');
    expect(fields.backFields.find((f) => f.key === 'orderRef').value).toBe('JMP-1234');
    expect(fields.backFields.find((f) => f.key === 'address').value).toBe('1 Main St, Raleigh, NC, 27601');
  });

  it('includes the web service + auth token only for https backends', () => {
    const json = appleWalletService.buildPassJson(makeTicket());
    expect(json.webServiceURL).toBe('https://api.example.com/wallet/apple');
    expect(json.authenticationToken).toBe(walletTokenService.issue('ckticket1'));
  });

  it('uses dark text on light brand colours', () => {
    const ticket = makeTicket();
    ticket.event.venue.organization.brandColor = '#ffff00';
    const json = appleWalletService.buildPassJson(ticket);
    expect(json.foregroundColor).toBe('rgb(17, 24, 39)');
  });

  it('falls back to the default brand colour on invalid input', () => {
    const ticket = makeTicket();
    ticket.event.venue.organization.brandColor = 'not-a-colour';
    expect(appleWalletService.buildPassJson(ticket).backgroundColor).toBe('rgb(37, 99, 235)');
  });
});

/**
 * Minimal reader for the STORE-only zips passkit-generator emits
 * (do-not-zip never compresses). Returns { fileName: Buffer }.
 */
function readStoredZip(buffer) {
  const files = {};
  let offset = 0;
  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const start = offset + 30 + nameLength + extraLength;
    files[name] = buffer.subarray(start, start + compressedSize);
    offset = start + compressedSize;
  }
  return files;
}

describe('AppleWalletService.buildPass', () => {
  it('produces a signed .pkpass zip carrying the QR payload and expiry', async () => {
    const buffer = await appleWalletService.buildPass(makeTicket());
    const files = readStoredZip(buffer);

    expect(Object.keys(files).sort()).toEqual(
      ['icon.png', 'icon@2x.png', 'icon@3x.png', 'manifest.json', 'pass.json', 'signature'].sort()
    );

    const pass = JSON.parse(files['pass.json'].toString('utf8'));
    expect(pass.serialNumber).toBe('ckticket1');
    expect(pass.barcodes).toEqual([
      {
        format: 'PKBarcodeFormatQR',
        message: 'jump://ticket?id=ckticket1&b=JUMP-ABCDEFGHJKLM&e=ckevent1',
        messageEncoding: 'iso-8859-1',
        altText: 'JUMP-ABCDEFGHJKLM',
      },
    ]);
    expect(new Date(pass.expirationDate).getTime()).toBe(eventDate.getTime() + 24 * 3600 * 1000);
    expect(new Date(pass.relevantDate).getTime()).toBe(eventDate.getTime());

    // Manifest lists a SHA-1 for every non-manifest, non-signature file
    const manifest = JSON.parse(files['manifest.json'].toString('utf8'));
    expect(Object.keys(manifest).sort()).toEqual(['icon.png', 'icon@2x.png', 'icon@3x.png', 'pass.json']);
    expect(files['signature'].length).toBeGreaterThan(100);

    // Icons are PNGs at Apple's sizes (width is bytes 16..20 of the IHDR chunk)
    expect(files['icon.png'].subarray(1, 4).toString()).toBe('PNG');
    expect(files['icon.png'].readUInt32BE(16)).toBe(29);
    expect(files['icon@2x.png'].readUInt32BE(16)).toBe(58);
  }, 20000);

  it('refuses to build when Apple is not configured', async () => {
    const saved = process.env.APPLE_PASS_KEY_PEM;
    const { appleConfig } = await import('../../../src/config/wallet.js');
    const key = appleConfig.signerKey;
    appleConfig.signerKey = null;
    try {
      await expect(appleWalletService.buildPass(makeTicket())).rejects.toMatchObject({
        code: 'WALLET_NOT_CONFIGURED',
        statusCode: 503,
      });
    } finally {
      appleConfig.signerKey = key;
      process.env.APPLE_PASS_KEY_PEM = saved;
    }
  });

  it('embeds the same jump:// payload the web QR uses', async () => {
    const ticket = makeTicket({ qrCodeJwt: null });
    // With no stored payload the service regenerates it from id/event/barcode.
    const { passBarcodePayload } = await import('../../../src/services/wallet/passData.js');
    expect(passBarcodePayload(ticket)).toBe('jump://ticket?id=ckticket1&b=JUMP-ABCDEFGHJKLM&e=ckevent1');
  });
});
