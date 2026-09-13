# Implementation Plan: Apple Wallet / Google Wallet Passes + NFC Tap-to-Redeem

**Branch**: `006-wallet-passes` | **Date**: 2026-09-12 | **Research**: [research.md](research.md)
**Input**: "Add tickets to Apple Wallet and Google Wallet from the confirmation page and confirmation email, with NFC embedded so attendees can tap to redeem at the door on compatible hardware."

## Summary

Every VALID ticket gets two wallet actions — **Add to Apple Wallet** (signed `.pkpass`) and **Add to Google Wallet** (signed save-JWT link) — surfaced on the confirmation page, the order page, the ticket detail page, and the order-confirmation email. Both passes carry the existing `jump://` QR payload so the current camera scanner keeps working unchanged. Each ticket also gets an opaque `nfcToken`; when the platform NFC entitlements are in place the same token is embedded as the Apple VAS `nfc.message` / Google `smartTapRedemptionValue`, and certified NFC readers post it to the existing `/tickets/scan` + `/tickets/redeem` endpoints. Delivered in four phases so QR wallet passes ship immediately while the NFC entitlements (which depend on Apple/Google approval and reader hardware) are pursued in parallel.

## Technical Context

**Language/Version**: Node 20 (backend, ESM JavaScript), TypeScript 5.7 / Next.js 14 (frontend)
**New dependencies**: `passkit-generator` (Apple), `hapns` (APNs push, phase 2). Google uses existing `jsonwebtoken`; REST calls via `fetch` + a service-account OAuth helper (`google-auth-library`).
**Storage**: 4 new columns on `Ticket`, 1 new table `WalletRegistration` (Apple device registrations), 2 new columns on `Event` (Google class sync state)
**Testing**: Jest unit tests (backend), supertest contract tests for new routes, Playwright for confirmation/order page buttons, manual device tests on iPhone + Android
**Target Platform**: iOS 15+ Wallet, Android with Google Wallet, web
**Constraints**: Google save URL ≤ 1800 chars; Apple pass images must be PNG at exact sizes; NFC message ≤ 64 bytes; NFC requires vendor approval + certified readers; certs stored only in env, never in repo
**Scale/Scope**: ~10 backend files, 4 frontend pages + 1 component, 1 migration, 1 email template

## Constitution Check

| #    | Principle               | Applies? | Status | Notes |
| ---- | ----------------------- | -------- | ------ | ----- |
| I    | Single Source of Truth  | Yes      | PASS   | Wallet passes are projections of `Ticket`; the QR payload and `nfcToken` originate in the DB and are never derived client-side |
| II   | API-First               | Yes      | PASS   | New routes documented in `contracts/wallet.yaml` before implementation |
| III  | TDD                     | Yes      | PASS   | Unit tests for pass builders (snapshot of `pass.json` / JWT payload), contract tests for routes, Playwright for buttons |
| IV   | Transactional Integrity | Yes      | PASS   | Redemption still flows through `TicketService.redeemByBarcode` (row lock, single-use). NFC only changes *lookup*, not *redeem* |
| V    | RBAC                    | Yes      | PASS   | Pass download requires a per-ticket signed `walletToken` (email links) or ticket ownership (auth) |
| VI   | Real-Time Sync          | Yes      | PASS   | Refunds/voids propagate via Apple web-service push and Google object PATCH (phase 2) |
| VII  | MVP Simplicity          | Yes      | PASS   | Phase 1 is QR-in-wallet only; no push, no NFC, no new infra |
| VIII | Living Documentation    | Yes      | PASS   | `quickstart.md` + `docs/wiki/features/wallet-passes.md` via `/doc-feature` |

## Phases

### Phase 0 — Accounts, certificates, entitlements (no code; start immediately, longest lead time)

| # | Task | Owner | Notes |
|---|------|-------|-------|
| 0.1 | Apple: register Pass Type ID `pass.events.jump.ticket`, issue certificate, export PEMs, download WWDR G4 | JJ | ~1 hour |
| 0.2 | Apple: submit NFC certificate request at `developer.apple.com/contact/passkit/` — use case "event ticketing, entry validation", name the reader partner (Socket Mobile S550 / VTAP) | JJ | Weeks–months; unblocks phase 3 |
| 0.3 | Google: create Wallet API issuer account, Cloud project, service account with Wallet API enabled; grant SA *Developer* role in Wallet Console | JJ | ~1 hour; passes show `[TEST ONLY]` until 0.4 |
| 0.4 | Google: request publishing approval once phase-1 class is final | JJ | Days |
| 0.5 | Google: generate Smart Tap ECDSA P-256 key pair, upload public key (key version 1), record Collector ID | JJ | Unblocks phase 3 |
| 0.6 | Apple NFC: generate ECDH P-256 key pair (`openssl ecparam -name prime256v1`) — public key → passes, private key → reader config | JJ | Unblocks phase 3 |
| 0.7 | Order pilot reader hardware: 1× VTAP100 (USB keyboard-wedge) + 1× Socket Mobile S550 (BLE) | JJ | Unblocks phase 4 |
| 0.8 | Add Railway secrets: `APPLE_*`, `GOOGLE_WALLET_*`, `NFC_*` (see quickstart) | JJ | |

### Phase 1 — QR wallet passes (ship first)

**Data model** (`packages/db/prisma/schema.prisma`, migration `20260912_wallet_passes`):

```prisma
model Ticket {
  // …existing…
  nfcToken         String?   @unique        // base64url(32 random bytes); embedded in NFC passes (phase 3)
  walletTokenHash  String?                  // sha256 of the per-ticket wallet access token
  passUpdatedAt    DateTime  @default(now()) // bumped on any change that must reach installed passes
  googleObjectId   String?                  // "<issuerId>.ticket-<id>" once created via REST (phase 2)
}

model Event {
  // …existing…
  googleClassId        String?   // "<issuerId>.event-<id>"
  googleClassSyncedAt  DateTime?
}
```

`nfcToken`, `walletTokenHash`, `passUpdatedAt` are set in `TicketService.issueTickets` alongside the existing `qrCodeJwt` write (line ≈117). Backfill migration script for existing VALID tickets.

**Backend**

| File | Change |
|------|--------|
| `backend/src/services/wallet/WalletTokenService.js` (new) | `issue(ticketId)` → random 32-byte token, stores sha256; `verify(ticketId, token)` constant-time compare. Used for unauthenticated pass downloads from email links |
| `backend/src/services/wallet/AppleWalletService.js` (new) | `buildPass(ticket)` → `Buffer`. Loads model `backend/src/wallet/models/eventTicket.pass/`, injects fields from research §R1, `barcodes[0].message = ticketService._getQrPayload(ticket)`, org logo via `ImageService` + `sharp` resize to logo/strip sizes (cached per org in Redis, keyed by `logoImageId`), brand colour → `backgroundColor`. Returns 503 `WALLET_NOT_CONFIGURED` if certs missing |
| `backend/src/services/wallet/GoogleWalletService.js` (new) | `ensureClass(event)` (REST upsert, idempotent, stores `googleClassId`), `buildObject(ticket)`, `saveUrl(ticket)` → skinny JWT with `payload.eventTicketObjects[0] = { id, classId }` after `ensureObject(ticket)` REST upsert. Fat-JWT fallback if REST unavailable (dev) |
| `backend/src/api/routes/wallet.js` (new, mounted at `/wallet`) | `GET /wallet/apple/:ticketId.pkpass?t=<walletToken>` → `application/vnd.apple.pkpass`, `Content-Disposition: attachment`; `GET /wallet/google/:ticketId?t=<walletToken>` → 302 to `https://pay.google.com/gp/v/save/<jwt>`. Both also accept `requireAuth` ownership instead of `t`. Rate-limited (existing `express-rate-limit`) |
| `backend/src/services/OrderService.js` `_formatOrderDetail` | Add `wallet: { apple: url, google: url }` per ticket (URLs include `t=`). Same in `TicketService.getTicketById` / `getMyTickets` |
| `backend/src/services/EmailService.js` `sendOrderConfirmation` | Per-ticket rows with two buttons (Apple black pill, Google official asset) linking to the wallet URLs. Apple recommends direct `.pkpass` links in email; Google recommends linking to a page — our `/wallet/google/:id` redirect satisfies both. Keep "View Tickets" CTA |
| `backend/src/config/wallet.js` (new) | Env parsing + `isAppleConfigured()` / `isGoogleConfigured()` helpers; startup warning when Apple cert < 30 days from expiry |
| `backend/src/api/server.js` | Mount router |

**Frontend**

| File | Change |
|------|--------|
| `frontend/src/components/WalletButtons.tsx` (new) | Renders Apple "Add to Apple Wallet" badge (Apple-provided SVG, black/white per theme) and Google "Add to Google Wallet" badge. Platform-aware ordering: iOS → Apple first, Android → Google first, desktop → both. Hidden per provider when backend reports it unconfigured (`wallet.apple === null`) |
| `frontend/src/app/confirmation/page.tsx` | `WalletButtons` under each ticket QR (only when `status === 'VALID'`) |
| `frontend/src/app/orders/[orderId]/page.tsx` | Same |
| `frontend/src/app/tickets/[ticketId]/page.tsx`, `my-tickets` | Same |
| `frontend/src/services/api.ts` | `OrderTicket.wallet` type |

**Tests**

- `backend/tests/unit/wallet/AppleWalletService.test.js`: pass.json snapshot, barcode message equals QR payload, expiration = event + 24h, missing certs → `WALLET_NOT_CONFIGURED`.
- `backend/tests/unit/wallet/GoogleWalletService.test.js`: JWT claims (`iss`, `aud`, `typ`, `origins`), object id format, save URL < 1800 chars.
- `backend/tests/contract/wallet.test.js`: 200 with correct MIME for valid token, 403 for wrong token, 410 for REFUNDED ticket, 302 for Google.
- Playwright `frontend/tests/e2e/wallet-buttons.spec.ts`: buttons render on confirmation + order page, `href` points at backend, hidden when provider unconfigured.
- Manual: install on iPhone + Android, scan the wallet pass's QR with `/admin/orders/scan` → REDEEMED.

**Acceptance**: from checkout → confirmation, a buyer can add each ticket to Apple or Google Wallet in ≤ 2 taps; the same buttons appear in the confirmation email; the wallet pass QR redeems with the existing scanner exactly once.

### Phase 2 — Pass lifecycle (refund / void / reschedule reach installed passes)

| File | Change |
|------|--------|
| `packages/db` | `model WalletRegistration { id, deviceLibraryId, passTypeId, serialNumber (ticketId), pushToken, createdAt; @@unique([deviceLibraryId, serialNumber]) }` |
| `backend/src/api/routes/appleWalletWebService.js` (new, mounted at `/wallet/apple/v1`) | The five Apple web-service endpoints (research §R2). Auth: `Authorization: ApplePass <token>` verified against `walletTokenHash`. `GET /passes/...` regenerates the pass; honours `If-Modified-Since` via `passUpdatedAt` |
| `backend/src/services/wallet/ApplePushService.js` (new) | `notify(ticketId)` → APNs HTTP/2 push (empty payload, topic = Pass Type ID, cert = pass cert) to every registration; prune on 410 |
| `RefundService`, `EventService` (cancel/reschedule) | After status change: bump `passUpdatedAt`, call `ApplePushService.notify`, `GoogleWalletService.patchObject(ticket, { state: 'EXPIRED' })` / class `dateTime` patch. Fire-and-forget with logging, same pattern as email |
| Apple pass builder | Refunded ticket renders `voided: true` + "REFUNDED" primary field |

**Tests**: contract tests for the 5 endpoints (register → list → get → unregister), unit test for push fan-out + 410 pruning, Google PATCH mocked via `nock`.

### Phase 3 — NFC payload in passes (gated on Phase 0.2 / 0.5)

| File | Change |
|------|--------|
| `AppleWalletService.buildPass` | When `NFC_APPLE_PUBLIC_KEY` set **and** cert is NFC-enabled: `pass.setNFC({ message: ticket.nfcToken, encryptionPublicKey, requiresAuthentication: false })`; also `sharingProhibited: true` |
| `GoogleWalletService` | Class: `enableSmartTap: true`, `redemptionIssuers: [GOOGLE_WALLET_ISSUER_ID]`. Object: `smartTapRedemptionValue: ticket.nfcToken` |
| `QRService` / new `PayloadService` | Recognise three payload shapes: `jump://…` (QR), legacy JWT, and `nfc:<token>` or bare 43-char base64url (NFC readers). Map NFC → ticket via `nfcToken` index, then existing `lookupByBarcode` / `redeemByBarcode` |
| `routes/tickets.js` `/scan`, `/redeem` | Route NFC payloads through the new resolver; response includes `source: 'QR' \| 'NFC'` for analytics |
| `RefundService` / reissue | Rotate `nfcToken` on refund so a cloned pass dies |
| Feature flag | `WALLET_NFC_ENABLED=true` per environment; org-level toggle deferred |

**Tests**: pass.json snapshot contains `nfc` only when flag + key present; Google class snapshot; `/redeem` with `nfc:<token>` redeems once and returns `ALREADY_REDEEMED` on repeat; rotated token rejected.

### Phase 4 — Door reader integration (gated on Phase 0.7)

| Item | Change |
|------|--------|
| `frontend/src/app/admin/orders/scan/page.tsx` | Add a **Reader** mode alongside **Camera**: a hidden, always-focused input captures keyboard-wedge output (VTAP100 / Zebra DataWedge) and submits on Enter. Debounce, strip CR/LF, same preview → redeem flow. Show last-tap result large-format for gate staff |
| `frontend/src/lib/readers/socketMobile.ts` (new, optional) | Socket Mobile CaptureSDK JS (via Socket Companion app) for S550 over BLE; emits decoded VAS/Smart Tap payloads into the same handler |
| Reader provisioning doc | `docs/user-guides/nfc-readers.md`: VTAP config (load Apple private key + Google Collector ID/key, set output = message only), S550 pairing steps |
| Admin analytics | `redemption source` breakdown (QR vs NFC) on event analytics page |

**Acceptance**: an attendee with the pass in Apple Wallet taps a VTAP100 or S550 at the door; the scan page shows REDEEMED within 1 s; second tap shows ALREADY_REDEEMED; a screenshot of the pass cannot be tapped.

## Project Structure

```
specs/006-wallet-passes/
├── plan.md                    # this file
├── research.md                # findings + decisions
├── quickstart.md              # cert/env setup, local testing with sample certs  (phase 1)
├── data-model.md              # Ticket/Event/WalletRegistration changes           (phase 1)
├── contracts/wallet.yaml      # OpenAPI for /wallet/* and Apple web service      (phase 1)
└── tasks.md                   # generated task list                                (phase 1)

backend/src/
├── config/wallet.js
├── wallet/models/eventTicket.pass/   # pass.json template + icon/logo placeholders
├── services/wallet/{WalletTokenService,AppleWalletService,GoogleWalletService,ApplePushService}.js
└── api/routes/{wallet,appleWalletWebService}.js

frontend/src/components/WalletButtons.tsx
frontend/src/lib/readers/socketMobile.ts
```

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Apple declines or delays the NFC certificate | Phases 1–2 deliver full value with QR; NFC is additive. Cite a named certified reader partner in the request — Apple has historically favoured requests with concrete hardware |
| Google `[TEST ONLY]` banner in production | Request publishing approval as soon as the class design is stable (phase 0.4), before phase 1 ships |
| Fat JWT exceeds 1800-char URL limit | Pre-create class + object via REST; JWT carries only ids |
| Cert expiry (Apple yearly) breaks pass downloads | Startup warning + Prometheus gauge `wallet_apple_cert_days_remaining` via existing `prom-client` |
| Email links must work without login (guest checkout) | Per-ticket `walletToken` (hashed at rest), identical trust model to the existing public `/orders/:id` CUID access |
| Pass images: org logos are arbitrary aspect ratios | `sharp` contain-fit onto transparent canvas at Apple's exact sizes; fallback to Jump logo |
| Reader vendor SDKs are native-first | Keyboard-wedge (VTAP/Zebra) needs zero SDK; S550 JS SDK is optional enhancement |
| Cloned passes | `sharingProhibited`, rotate `nfcToken` on refund, single-use redemption row lock already in place |

## Recommended sequencing

1. **Today**: Phase 0 tasks 0.1–0.5 (accounts + NFC requests) — these are calendar-bound, not effort-bound.
2. **Sprint 1**: Phase 1 end-to-end (est. 4–5 dev days incl. tests) → ship behind `isAppleConfigured()` / `isGoogleConfigured()` so it lights up when secrets land.
3. **Sprint 2**: Phase 2 lifecycle (est. 3 dev days).
4. **When approvals arrive**: Phase 3 (≈1 dev day, mostly config) then Phase 4 pilot at one event with both readers (≈2 dev days + on-site test).
