# Email Notifications

**Status:** Implemented
**Last Updated:** 2026-09-07

## Overview

Transactional emails via Resend API. Order confirmation emails are sent after successful payment, containing a ticket summary and a "View Tickets" link. Uses a fire-and-forget pattern with retry logic (up to 3 attempts) so email failures never block order completion.

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/services/EmailService.js` | Resend API integration, email templates, retry logic |

## Configuration

| Variable | Description |
|----------|-------------|
| `RESEND_API_KEY` | API key for the Resend transactional email service |
| `BACKEND_URL` | Optional. Public base URL of the backend, used to make organizer logo URLs absolute in email headers. Falls back to `https://$RAILWAY_PUBLIC_DOMAIN` (set automatically on Railway), then `http://localhost:$PORT` |

## How It Works

1. After a successful payment, the order completion flow triggers `EmailService`.
2. `EmailService` builds an order confirmation email with ticket summary and a "View Tickets" link.
3. The email is sent asynchronously via the Resend API (fire-and-forget).
4. On failure, the service retries up to 3 times before giving up.
5. Email send results (success or final failure) are logged but do not affect the order status.

### Organizer logo

Every email header shows the organization's logo centered above the heading (`orgLogoHtml` in `EmailService.js`, `max-height: 60px`). The confirmation email reads `order.event.organizationLogoUrl` / `organizationName` — both call sites pass the output of `OrderService.getOrderById`, which includes them. The cancellation email reads the same fields or falls back to `event.venue.organization`. Logos are served by the backend at a relative path (`/images/:id/:hash/:variant`), so `absoluteAssetUrl` prefixes the public backend URL (see `BACKEND_URL`); the header renders without the image when the org has no logo.

## Gotchas

- Email failures do not block order completion — the async/fire-and-forget pattern means the user gets their tickets even if the email fails.
- Retry logic attempts up to 3 sends before abandoning.
- No email queue or persistent retry mechanism — retries happen inline during the initial send attempt.

## Related Features

- [QR Code Scanning](qr-code-scanning.md) — tickets referenced in emails contain QR codes for event entry.
- [Auth.js Integration](authjs-integration.md) — Resend is also used for magic link authentication emails.
