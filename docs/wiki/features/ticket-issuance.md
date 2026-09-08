# Ticket Issuance

**Status:** Active
**Last Updated:** 2026-09-07

## Overview

After payment is confirmed via webhook, individual Ticket records are created with unique barcodes (`JUMP-XXXXXXXXXXXX`) and QR code JWTs (HS256-signed, payload: `{ sub: ticketId, eventId, barcode }`, expiring 24h after event date). Tickets follow a lifecycle: VALID -> REDEEMED (scanned) | EXPIRED (lazy check) | VOIDED (event cancelled). Inventory moves from `quantityReserved` to `quantitySold` during ticket creation.

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/services/TicketService.js` | Ticket creation, retrieval, lazy expiration, redemption |
| `backend/src/services/QRService.js` | JWT generation/verification, QR code image rendering |
| `backend/src/utils/barcode.js` | Barcode generation (`JUMP-XXXXXXXXXXXX` format) |
| `frontend/src/app/tickets/[ticketId]/` | Ticket detail page with QR code display |

## How It Works

### Ticket Creation (`TicketService.createTicketsForOrder`)

Called by `PaymentService.handleCheckoutCompleted()` after successful payment:

1. Load order with items, event, and contact.
2. Generate unique barcodes via `generateBarcodes(quantity)` -- uses `Set` to guarantee uniqueness within batch.
3. In a transaction:
   - Acquire row-level lock on max ticket number: `SELECT MAX(ticketNumber) ... FOR UPDATE`
   - For each order item and quantity:
     - Create `Ticket` with `status: VALID`, `pricePaid` snapshot from tier price, auto-incrementing `ticketNumber`.
     - Generate QR JWT via `QRService.generateQRCodeJWT(ticketId, eventId, barcode, eventDate)`.
     - Update ticket with `qrCodeJwt`.
   - Move inventory per tier: `quantitySold += quantity`, `quantityReserved -= quantity`.

### Barcode Format

- Pattern: `JUMP-XXXXXXXXXXXX` (prefix + 12 alphanumeric characters)
- Charset: `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (excludes `0/O/1/I` to avoid visual ambiguity)
- Generated via `crypto.randomBytes`
- Validation regex: `/^JUMP-[A-HJ-NP-Z2-9]{12}$/`

### QR Code JWT

- Algorithm: HS256
- Secret: `AUTH_SECRET` environment variable
- Payload: `{ sub: ticketId, eventId, barcode, iat, exp }`
- Expiry: 24 hours after event date (minimum 24h from generation time)
- QR image: 300px PNG with error correction level M, rendered via `qrcode` library

### Ticket Lifecycle

| Status | Meaning | Transition |
|--------|---------|------------|
| VALID | Active, unredeemed | Created on payment confirmation |
| REDEEMED | Scanned at event | `redeemTicket()` sets status + `redeemedAt` |
| EXPIRED | Event has passed | Lazy check: evaluated at retrieval/scan time, not by cron |
| VOIDED | Cancelled | Set when event is cancelled |

### Redemption (`TicketService.redeemTicket`)

1. Verify QR JWT signature and expiration (`QRService.verifyQRCode`).
2. Look up ticket by `sub` (ticketId).
3. Optional cross-event validation if `expectedEventId` provided.
4. Lazy expiration: if VALID but event date has passed, update to EXPIRED and reject.
5. Reject REDEEMED (duplicate scan), EXPIRED, or VOIDED tickets with specific error codes.
6. Atomically set `status: REDEEMED`, `redeemedAt: now`.
7. Return redemption result with contact name, tier name, barcode.

### Retrieval

- **`getMyTickets(email)`**: All tickets for a contact, with lazy expiration applied. Returns full detail including QR JWT, venue, tier info, sale status.
- **`getTicketById(ticketId)`**: Single ticket with QR code data URL image generated on the fly, plus order price breakdown.

## Configuration

| Variable | Description |
|----------|-------------|
| `AUTH_SECRET` | Required. HS256 signing key for QR JWTs. |

## Gotchas

- **QR JWT expires 24h after event date**, not 24h after ticket creation. Minimum 24h from generation ensures pre-event usability.
- **EXPIRED status evaluated lazily at retrieval/scan time**, not by a cron job. The `getMyTickets`, `getTicketById`, and `redeemTicket` methods all check `event.date < now` and update status on the fly.
- **Ticket number uses row-level lock** (`FOR UPDATE`) to prevent duplicate numbers within an event under concurrency.
- **`pricePaid` is a snapshot** of the tier price at order time. Subsequent tier price changes do not affect existing tickets.
- **QR code image is generated on every request** (not cached). `generateQRCodeImage` renders the JWT as a data URL PNG. Failures are logged but non-fatal (returns null).
- **Redemption error codes**: `QR_EXPIRED`, `QR_INVALID`, `ALREADY_REDEEMED`, `EXPIRED`, `VOIDED`, `WRONG_EVENT` -- each with distinct HTTP status codes.

## Related Features

- [Guest Checkout](guest-checkout.md) -- order creation triggers ticket issuance
- [Stripe Integration](stripe-integration.md) -- webhook triggers ticket creation
- [QR Code Scanning](qr-code-scanning.md) -- redemption flow and admin scanner
- [Price Tiers](price-tiers.md) -- inventory finalization (reserved -> sold)
