# Wallet Passes (Apple Wallet / Google Wallet)

**Status:** Implemented (phase 1 — QR passes). NFC tap-to-redeem is planned (phases 3–4).
**Last Updated:** 2026-09-12
**Spec:** `specs/006-wallet-passes/` (research, plan, quickstart)

## Overview

Every `VALID` ticket can be added to Apple Wallet (a signed `.pkpass` file) or Google Wallet (a signed "save" JWT link). Buttons appear on the confirmation page, the order page, the ticket detail page, and in the order-confirmation email. The pass barcode carries the same `jump://ticket?...` payload as the web QR, so the admin scanner redeems wallet passes without any changes.

Both providers are optional and independent: when their secrets are absent the buttons are hidden and `/wallet/*` answers 503.

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/config/wallet.js` | Env parsing, `isAppleConfigured()` / `isGoogleConfigured()`, cert-expiry warning at startup |
| `backend/src/services/wallet/WalletTokenService.js` | Per-ticket HMAC access token + `links(ticket)` builder used by API responses and emails |
| `backend/src/services/wallet/AppleWalletService.js` | Builds and signs the `.pkpass` via `passkit-generator` |
| `backend/src/services/wallet/passImages.js` | Icon/logo PNGs from the organizer logo (or a brand-colour monogram) via `sharp` |
| `backend/src/services/wallet/GoogleWalletService.js` | EventTicketClass/Object upsert through the Wallet REST API, RS256 save JWT |
| `backend/src/services/wallet/passData.js` | Shared ticket loader, barcode payload, colour helpers |
| `backend/src/api/routes/wallet.js` | `GET /wallet/apple/:ticketId.pkpass`, `GET /wallet/google/:ticketId` |
| `backend/src/services/EmailService.js` | `walletSectionHtml()` — per-ticket buttons in the confirmation email |
| `frontend/src/components/WalletButtons.tsx` | Apple/Google badge buttons; Apple first on iOS devices |

## How It Works

1. `TicketService.issueTickets` stores a random `nfcToken` on each new ticket (reserved for NFC passes).
2. Order/ticket API responses include `wallet: { apple, google }` — absolute backend URLs carrying `?t=<token>`, or `null` per unconfigured provider / non-VALID ticket.
3. `GET /wallet/apple/:id.pkpass` authorises via the token (or signed-in owner/admin), loads the ticket graph, renders `pass.json` + images, signs with the Pass Type ID certificate, and streams `application/vnd.apple.pkpass`.
4. `GET /wallet/google/:id` upserts the event's class and the ticket's object via REST (cached in `Event.googleClassId/googleClassSyncedAt` and `Ticket.googleObjectId`), signs a skinny JWT and 302s to `https://pay.google.com/gp/v/save/<jwt>`. If REST fails it falls back to a fat JWT.
5. The pass expires 24h after the event date on both platforms.

## Gotchas

- The wallet token is stateless (HMAC of the ticket id with `AUTH_SECRET`). Rotating `AUTH_SECRET` invalidates links in already-sent emails.
- Apple ignores `webServiceURL` unless it is https, so the pass omits it when `BACKEND_URL` is plain http (local dev). Pass updates/push are phase 2.
- Google passes show `[TEST ONLY]` until the issuer is granted publishing approval in the Wallet Console.
- Google fetches the class logo itself; the org logo is only included when `BACKEND_URL` is a public https URL.
- `backend/tests/fixtures/wallet/*.pem` are self-signed **TEST ONLY** certificates.
- Apple pass certificates expire yearly — watch for the startup warning.

## Related Features

- [QR Code Scanning](qr-code-scanning.md) — the pass barcode is the same payload the scanner already accepts.
- [Ticket Issuance](ticket-issuance.md) — where `nfcToken` is generated.
- [Email Notifications](email-notifications.md) — the confirmation email carries the wallet buttons.
- [Organization Branding](organization-branding.md) — brand colour and logo drive the pass artwork.
