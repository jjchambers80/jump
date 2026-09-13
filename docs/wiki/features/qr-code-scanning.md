# QR Code Scanning

**Status:** Implemented
**Last Updated:** 2026-09-07

## Overview

Admin-facing QR code scanner at `/admin/scan` for event entry. Each ticket's QR code contains a JWT. The backend verifies the JWT signature, checks ticket validity, evaluates expiration lazily, and marks the ticket as redeemed with a timestamp. Each ticket can only be redeemed once.

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/api/routes/tickets.js` | POST `/tickets/redeem` endpoint |
| `backend/src/services/TicketService.js` | Ticket redemption logic and status checks |
| `backend/src/services/QRService.js` | QR code generation and JWT encoding |
| `frontend/src/app/admin/scan/` | Admin scanner UI with camera integration |

## How It Works

1. Admin navigates to `/admin/scan` and grants camera permissions.
2. Scanner reads a QR code containing a JWT (HS256-signed).
3. Frontend sends POST `/tickets/redeem` with the scanned JWT.
4. Backend verifies the JWT signature (HS256).
5. Backend checks ticket status — must be `VALID` to proceed.
6. Backend performs lazy `EXPIRED` evaluation based on the event date.
7. If all checks pass, the ticket is marked `REDEEMED` with a timestamp.

## Gotchas

- **`POST /tickets/scan` and `/redeem` are no longer open.** They accept a staff Bearer token (ORGANIZER or above) or `X-Scanner-Key` matching `SCANNER_API_KEY` for hardware readers (spec 006). Buyer sessions and `UNASSIGNED` users are refused. Before this, anyone holding a QR payload could redeem (void) the ticket remotely. The admin check-in UI never used these routes; it calls `/admin/tickets/scan-order` and `/admin/tickets/:id/check-in`, which are also org-scoped.

- JWT expiry is set to 24 hours post-event, allowing late scanning.
- Scanner requires camera permissions — browser will prompt on first use.
- Each ticket is redeemable only once. Duplicate scan attempts are rejected.
- Lazy expiration means a ticket's `EXPIRED` status is evaluated at redeem time, not pre-computed.

## Related Features

- [Email Notifications](email-notifications.md) — confirmation emails contain links to tickets with QR codes.
- [Auth.js Integration](authjs-integration.md) — shared JWT signing secret (HS256) used for QR tokens.
