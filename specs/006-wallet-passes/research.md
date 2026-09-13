# Research: Apple Wallet / Google Wallet Passes + NFC Tap-to-Redeem

**Feature**: 006-wallet-passes
**Date**: 2026-09-12
**Status**: Complete

## Summary of findings

| Topic | Finding |
|-------|---------|
| Apple format | `.pkpass` — a ZIP containing `pass.json`, images, `manifest.json` (SHA-1 of every file), and `signature` (PKCS#7 detached signature over the manifest). Served with `Content-Type: application/vnd.apple.pkpass`. Ticket type is `eventTicket`. |
| Google format | No file. A signed JWT (RS256, Google Cloud service-account key) whose payload contains an `EventTicketObject` (optionally its `EventTicketClass`). Delivered as a link: `https://pay.google.com/gp/v/save/<jwt>`. |
| QR-only passes | Self-service on both platforms. Apple: standard developer account + Pass Type ID certificate. Google: Wallet API issuer account; passes show `[TEST ONLY]` until Google grants publishing approval. |
| NFC passes | **Gated on both platforms.** Apple requires an NFC-enabled Pass Type ID certificate granted after a review request at `developer.apple.com/contact/passkit/`. Google requires enabling Smart Tap on the issuer account (upload an ECDSA P-256 public key; Google returns a Collector ID). |
| NFC readers | Phones **cannot** act as readers. Apple VAS and Google Smart Tap are only implemented by certified reader hardware (Socket Mobile S550, VTAP100, Zebra TC22/TC27, ACS WalletMate, etc.). Core NFC / Web NFC cannot read wallet passes. |

## R1: Apple Wallet — pass generation

**Decision**: `passkit-generator` (npm), pass model stored in-repo as `backend/src/wallet/models/eventTicket.pass/`.

**Rationale**:
- Actively maintained, TypeScript-typed, v3 API. Handles manifest + PKCS#7 signing with OpenSSL-compatible PEMs — no native deps beyond Node.
- Splits static assets (icon/logo/strip) from dynamic data (serialNumber, fields, barcode, NFC), which fits our per-ticket generation.
- `pass.setNFC({...})` exposed for the NFC dictionary when we reach phase 3.
- Alternative `@walletpass/pass-js` is also viable (zero deps, includes web-service push helpers) — chosen against because passkit-generator's model-folder approach matches how we already store branding assets, and push helpers are small enough to write ourselves.

**Certificate chain required** (one-time, stored as Railway secrets, PEM strings):
1. Apple Developer account → Certificates, Identifiers & Profiles → Identifiers → Pass Type ID (e.g. `pass.events.jump.ticket`).
2. Create a certificate for that Pass Type ID from a CSR generated on a Mac; download, import to Keychain, export `.p12`.
3. Convert: `openssl pkcs12 -in Certificates.p12 -clcerts -nokeys -out signerCert.pem` and `openssl pkcs12 -in Certificates.p12 -nocerts -out signerKey.pem` (set a passphrase).
4. Download Apple WWDR G4 intermediate certificate; convert to PEM.
5. Env: `APPLE_PASS_TYPE_ID`, `APPLE_TEAM_ID`, `APPLE_PASS_CERT_PEM`, `APPLE_PASS_KEY_PEM`, `APPLE_PASS_KEY_PASSPHRASE`, `APPLE_WWDR_PEM`. Certificates expire yearly — add a startup warning at 30 days.

**`pass.json` skeleton for a Jump ticket**:

```json
{
  "formatVersion": 1,
  "passTypeIdentifier": "pass.events.jump.ticket",
  "teamIdentifier": "TEAMID",
  "serialNumber": "<ticket.id>",
  "organizationName": "<organization.name>",
  "description": "<event.name> ticket",
  "logoText": "<organization.name>",
  "backgroundColor": "<organization.brandColor as rgb()>",
  "foregroundColor": "rgb(255,255,255)",
  "relevantDate": "<event.date ISO>",
  "expirationDate": "<event.date + 24h>",
  "locations": [{ "latitude": 0, "longitude": 0 }],
  "eventTicket": {
    "headerFields": [{ "key": "date", "label": "DATE", "value": "<event.date>", "dateStyle": "PKDateStyleMedium", "timeStyle": "PKDateStyleShort" }],
    "primaryFields": [{ "key": "event", "label": "EVENT", "value": "<event.name>" }],
    "secondaryFields": [
      { "key": "venue", "label": "VENUE", "value": "<venue.name>" },
      { "key": "tier", "label": "TICKET", "value": "<priceTier.name>" }
    ],
    "auxiliaryFields": [{ "key": "holder", "label": "HOLDER", "value": "<contact first last>" }],
    "backFields": [
      { "key": "orderRef", "label": "Order", "value": "<order.orderRef>" },
      { "key": "barcode", "label": "Ticket #", "value": "<ticket.barcode>" },
      { "key": "address", "label": "Address", "value": "<venue.address>" }
    ]
  },
  "barcodes": [{ "format": "PKBarcodeFormatQR", "message": "jump://ticket?id=…&b=…&e=…", "messageEncoding": "iso-8859-1", "altText": "<ticket.barcode>" }],
  "webServiceURL": "https://<backend>/wallet/apple",
  "authenticationToken": "<per-ticket random 32+ char token>"
}
```

Note: `barcodes[].message` must be the **same `jump://` payload** the existing scanner already accepts, so the door flow needs zero changes for QR-based wallet passes.

Images required in the model: `icon.png` (29×29) + `icon@2x.png`, `logo.png` (≤160×50) + `@2x`, optional `strip.png` (375×123 for eventTicket) + `@2x`. Organization logo is fetched from `ImageService` at generation time and resized with `sharp` (already a dependency).

## R2: Apple Wallet — pass updates (refund / void / event changes)

Apple passes are static files unless the issuer implements the **Wallet Web Service**. iPhones register with the issuer when the pass is added and poll/push for updates.

Required endpoints (all under `webServiceURL` + `/v1`, auth header `ApplePass <authenticationToken>`):

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber` | Device adds pass; body has APNs `pushToken` |
| DELETE | same | Device removed pass |
| GET | `/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier?passesUpdatedSince=` | List serials changed since tag |
| GET | `/passes/:passTypeIdentifier/:serialNumber` | Return latest `.pkpass` (honour `If-Modified-Since`) |
| POST | `/log` | Device error log sink |

Push: send an empty APNs notification to each registered `pushToken` using the **same Pass Type ID certificate** as the APNs client cert (HTTP/2 to `api.push.apple.com`, topic = passTypeIdentifier). Library options: `hapns` (modern) or `@parse/node-apn`.

**Decision**: implement the web service in phase 2, not phase 1. Phase 1 passes still get `expirationDate` so they self-void 24h after the event; refunds are enforced server-side at scan time anyway (`TicketService.redeemByBarcode` rejects non-VALID tickets).

## R3: Google Wallet — pass issuance

**Decision**: "fat JWT" for MVP (class + object embedded), migrate to pre-created objects via REST once we need updates.

**Setup (one-time)**:
1. Google Pay & Wallet Console → create issuer account → note **Issuer ID**.
2. Google Cloud project → enable *Google Wallet API* → create service account → download JSON key → in Wallet Console add the service-account email as a user with *Developer* role.
3. Env: `GOOGLE_WALLET_ISSUER_ID`, `GOOGLE_WALLET_SA_EMAIL`, `GOOGLE_WALLET_SA_PRIVATE_KEY` (PEM), `GOOGLE_WALLET_ORIGINS` (frontend origin list).
4. Request **publishing approval** in the console once the class looks final; until then every pass shows `[TEST ONLY]` in its title.

**Class per event** (`id = <issuerId>.event-<event.id>`): `eventName`, `venue.name`, `venue.address`, `dateTime.start`, `logo`, `hexBackgroundColor` (brand colour), `reviewStatus: UNDER_REVIEW`, `issuerName`.
**Object per ticket** (`id = <issuerId>.ticket-<ticket.id>`): `classId`, `state: ACTIVE`, `ticketHolderName`, `ticketType` (tier name), `barcode: { type: QR_CODE, value: <jump:// payload>, alternateText: <barcode> }`, `validTimeInterval.end` (event + 24h), `groupingInfo.groupingId = order.id` so multiple tickets from one order group in the wallet.

**JWT** (`jsonwebtoken`, already a dependency):

```json
{
  "iss": "<service account email>",
  "aud": "google",
  "typ": "savetowallet",
  "iat": 1700000000,
  "origins": ["https://<frontend origin>"],
  "payload": { "eventTicketClasses": [ …class… ], "eventTicketObjects": [ …object… ] }
}
```

Signed RS256 with the service-account private key; link `https://pay.google.com/gp/v/save/<jwt>`. **Constraint**: safe URL length ≈ 1800 chars — a fat JWT with a class easily exceeds this, so the plan pre-creates the class via REST (`POST https://walletobjects.googleapis.com/walletobjects/v1/eventTicketClass`, OAuth via service account) and puts only the object in the JWT. Google also recommends against embedding the save link directly in email; the email links to our `/tickets/:id/wallet/google` redirect endpoint which mints a fresh JWT.

Updates: `PATCH …/eventTicketObject/<id>` with `state: EXPIRED` (refund) or new `dateTime` (reschedule). Users receive the change automatically — no push infra needed on Google's side.

## R4: NFC — Apple VAS

- Adds an `nfc` dictionary to `pass.json`: `{ "message": "<≤64 bytes>", "encryptionPublicKey": "<base64 DER of ECDH P-256 public key>", "requiresAuthentication": false }`.
- Key pair: `openssl ecparam -name prime256v1 -genkey -noout -out nfcKey.pem && openssl ec -in nfcKey.pem -pubout -out nfcPub.pem`; strip PEM headers for `encryptionPublicKey`. The **private key goes into the reader** (or the reader vendor's cloud), never into the pass.
- At tap time the phone encrypts `message` to the reader's public key over the VAS protocol; the certified reader decrypts and hands the app the plaintext message.
- **Gate**: passes containing `nfc` must be signed with an NFC-enabled Pass Type ID certificate. Obtaining one requires a use-case review request to Apple (`developer.apple.com/contact/passkit/`). Reports from third-party issuers indicate weeks-to-months turnaround and that Apple wants to see a concrete reader/hardware partner. Without the enhanced certificate the `nfc` key is ignored (pass still installs, QR still works).
- iOS 15+ also supports "device-bound" passes and `sharingProhibited: true` for anti-transfer.

## R5: NFC — Google Smart Tap

- Issuer console → *Additional features* → *Add an authentication key*: upload an ECDSA P-256 **public** key `.pem` with an integer key version. Then `GET /issuers/<id>` returns `smartTapMerchantData.smartTapMerchantId` — the **Collector ID**.
- Class: `enableSmartTap: true`, `redemptionIssuers: [<issuerId>]`. Object: `smartTapRedemptionValue: "<≤64 chars>"`.
- Reader is configured with the Collector ID + private key; on tap the reader receives `smartTapRedemptionValue`.
- No formal approval beyond normal publishing approval — but only certified terminal vendors implement Smart Tap.

## R6: Reader hardware / door app integration

The current door flow is a browser page (`/admin/orders/scan`) using `html5-qrcode` on a phone camera, posting `jump://` payloads to `POST /tickets/scan` and `POST /tickets/redeem`. Phones cannot read VAS/Smart Tap, so NFC requires an external reader. Options evaluated:

| Reader | Certifications | Integration path | Fit |
|--------|----------------|------------------|-----|
| **Socket Mobile S550** (~$200) | Apple VAS, Google Smart Tap, NFC Forum | Bluetooth LE + CaptureSDK (iOS/Android native, plus **CaptureSDK JS** for web via Socket's Companion app) | Best for our web-based door page; also reads mDL |
| VTAP100 / VTAP50 | Apple VAS, Google Smart Tap | USB HID keyboard-wedge or serial; emits the decrypted message as keystrokes | Simplest possible integration — plug into a laptop/tablet, scan page reads keystrokes |
| Zebra TC22 / TC27 | Apple VAS, Google Smart Tap | Android handheld, EMDK/DataWedge keyboard-wedge into a browser or native app | Ruggedised all-in-one (QR + NFC) |
| ACS WalletMate | Apple VAS, Google Smart Tap | USB / BLE, PC/SC | Desk-mounted counter use |

**Decision**: design the redemption API to be reader-agnostic — accept the NFC message as just another payload string on `POST /tickets/scan` / `/redeem`. Pilot with a VTAP100 in keyboard-wedge mode (zero SDK code: the scan page gets a hidden focused input) and, in parallel, an S550 via CaptureSDK JS for phone-based door staff.

## R7: NFC payload design

Both platforms carry a ≤64-byte message. Reusing the `jump://` payload is too long (≈80 chars) and leaks nothing useful anyway. Chosen payload: an **opaque per-ticket NFC token** (`nfcToken`, 32 random bytes → base64url, 43 chars) stored on the Ticket row and indexed. The reader posts `{ payload: "<nfcToken>" }`; the backend recognises it by a `nfc:` prefix, looks up the ticket, and reuses `redeemByBarcode`. Rotating this token on refund/reissue invalidates any cloned pass.

## Sources

- Apple: https://developer.apple.com/documentation/walletpasses , https://developer.apple.com/documentation/walletpasses/adding-a-web-service-to-update-passes , https://developer.apple.com/documentation/walletpasses/pass/nfc
- Google: https://developers.google.com/wallet/tickets/events/web , https://developers.google.com/wallet/tickets/events/use-cases/jwt , https://developers.google.com/wallet/tickets/events/use-cases/redemption-methods , https://developers.google.com/wallet/smart-tap/introduction/issuer-configuration , https://developers.google.com/wallet/smart-tap/introduction/pass-configuration
- Libraries: https://github.com/alexandercerutti/passkit-generator , https://github.com/tinovyatkin/pass-js
- NFC background: https://www.passcreator.com/en/blog/what-you-need-to-know-about-nfc-passes-in-apple-and-google-wallet , https://www.codereadr.com/blog/apple-vas-and-google-smart-tap-validating-nfc-passes/ , https://www.passninja.com/tutorials/apple-platform/how-to-create-apple-wallet-nfc-encryption-keys
- Readers: https://www.socketmobile.com/products/s550 , https://www.vtapnfc.com/apple-vas-readers/ , https://techdocs.zebra.com/nfc-vas/latest/guide/demo/
