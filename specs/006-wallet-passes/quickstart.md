# Quickstart: Wallet Passes (Phase 1)

How to turn on Apple Wallet and Google Wallet ticket passes, and how to test them locally.

Both providers are independent and optional. With no wallet env vars set the app behaves exactly as before: the API returns `wallet: { apple: null, google: null }` for every ticket, the buttons never render, the email section is omitted, and `GET /wallet/*` answers 503.

## 1. Apple Wallet

1. **Pass Type ID** — Apple Developer → Certificates, Identifiers & Profiles → Identifiers → *+* → Pass Type IDs → e.g. `pass.events.jump.ticket`.
2. **Certificate** — select the Pass Type ID → *Create Certificate*. Generate a CSR in Keychain Access (Certificate Assistant → Request a Certificate From a Certificate Authority), upload it, download the `.cer`, double-click to import, then export the certificate **and** private key from Keychain as `Certificates.p12` (set a passphrase).
3. **Convert to PEM**:
   ```bash
   openssl pkcs12 -in Certificates.p12 -clcerts -nokeys -out signerCert.pem
   openssl pkcs12 -in Certificates.p12 -nocerts -out signerKey.pem      # keeps the passphrase
   ```
4. **WWDR intermediate** — download *Worldwide Developer Relations - G4* from https://www.apple.com/certificateauthority/ and convert: `openssl x509 -inform der -in AppleWWDRCAG4.cer -out wwdr.pem`.
5. **Env** (Railway → backend service → Variables; paste PEMs as single lines with `\n`, the loader normalises them):
   | Var | Value |
   |-----|-------|
   | `APPLE_PASS_TYPE_ID` | `pass.events.jump.ticket` |
   | `APPLE_TEAM_ID` | 10-character Team ID from the developer account |
   | `APPLE_PASS_CERT_PEM` | contents of `signerCert.pem` |
   | `APPLE_PASS_KEY_PEM` | contents of `signerKey.pem` |
   | `APPLE_PASS_KEY_PASSPHRASE` | the export passphrase |
   | `APPLE_WWDR_PEM` | contents of `wwdr.pem` |
   | `BACKEND_URL` | public https URL of the backend (already used for email images) |

The certificate expires after one year. The backend logs `Apple pass signing certificate expires soon` at startup once fewer than 30 days remain.

## 2. Google Wallet

1. **Issuer account** — https://pay.google.com/business/console → Google Wallet API → create issuer. Note the numeric **Issuer ID**.
2. **Service account** — Google Cloud console → enable *Google Wallet API* → IAM → Service Accounts → create, then *Keys → Add key → JSON*. In the Wallet Console → *Users* add the service-account email with the *Developer* role.
3. **Env**:
   | Var | Value |
   |-----|-------|
   | `GOOGLE_WALLET_ISSUER_ID` | Issuer ID |
   | `GOOGLE_WALLET_SA_EMAIL` | `client_email` from the JSON key |
   | `GOOGLE_WALLET_SA_PRIVATE_KEY` | `private_key` from the JSON key |
   | `GOOGLE_WALLET_ORIGINS` | comma-separated frontend origins (defaults to `FRONTEND_URL`) |
4. **Publishing approval** — until Google approves the issuer, every pass title shows `[TEST ONLY]`. Request approval from the console once a real event class exists (open one Google link in production so the class is created, then *Publish*).

## 3. How it works

| Piece | Where |
|-------|-------|
| Config + `isAppleConfigured()` / `isGoogleConfigured()` | `backend/src/config/wallet.js` |
| Per-ticket access token (HMAC of ticket id with `AUTH_SECRET`) + link builder | `backend/src/services/wallet/WalletTokenService.js` |
| Apple `.pkpass` builder (passkit-generator) | `backend/src/services/wallet/AppleWalletService.js`, images in `passImages.js` |
| Google class/object sync + save JWT | `backend/src/services/wallet/GoogleWalletService.js` |
| Routes `GET /wallet/apple/:ticketId.pkpass`, `GET /wallet/google/:ticketId` | `backend/src/api/routes/wallet.js` |
| `wallet: { apple, google }` on order + ticket API responses | `OrderService._formatOrderDetail`, `TicketService` formatters |
| Email buttons | `EmailService.sendOrderConfirmation` → `walletSectionHtml` |
| Buttons UI | `frontend/src/components/WalletButtons.tsx`, used on `/confirmation`, `/orders/[orderId]`, `/tickets/[ticketId]` |

Access rules for `/wallet/*`: a valid `?t=` token **or** a signed-in owner/admin; ticket must be `VALID` (else 410). Links are rate-limited to 60 per 15 minutes per IP.

The pass barcode is the same `jump://ticket?...` payload as the web QR, so `/admin/orders/scan` redeems wallet passes with no changes.

New `Ticket` columns: `nfcToken` (issued at purchase, used by phase 3), `passUpdatedAt`, `googleObjectId`. New `Event` columns: `googleClassId`, `googleClassSyncedAt`. Migration `20260912220000_add_wallet_pass_fields`.

## 4. Testing locally

- Unit + contract tests use self-signed **TEST ONLY** certificates in `backend/tests/fixtures/wallet/` — never use them in a real environment:
  ```bash
  cd backend && npm run test:unit -- tests/unit/wallet
  cd backend && TEST_DATABASE_URL=postgresql://... npm run test:contract -- tests/contract/wallet.test.js
  cd frontend && npx playwright test e2e/wallet-buttons.spec.ts --project=chromium
  ```
- To try a real pass on a phone, set the Apple/Google env vars in `backend/.env`, expose the backend over https (e.g. `ngrok http 3000`, set `BACKEND_URL` to the ngrok URL), buy a ticket, and tap the buttons on the confirmation page or in the email. Apple rejects passes whose `webServiceURL` is not https, which is why the pass omits that key when `BACKEND_URL` is plain http.
- Google's REST sync failing (wrong SA permissions, network) falls back to a fat JWT and logs `Google Wallet REST sync failed`; the link still works but may exceed the 1800-char URL guideline.
