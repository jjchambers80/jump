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

## How It Works

1. After a successful payment, the order completion flow triggers `EmailService`.
2. `EmailService` builds an order confirmation email with ticket summary and a "View Tickets" link.
3. The email is sent asynchronously via the Resend API (fire-and-forget).
4. On failure, the service retries up to 3 times before giving up.
5. Email send results (success or final failure) are logged but do not affect the order status.

## Gotchas

- Email failures do not block order completion — the async/fire-and-forget pattern means the user gets their tickets even if the email fails.
- Retry logic attempts up to 3 sends before abandoning.
- No email queue or persistent retry mechanism — retries happen inline during the initial send attempt.

## Related Features

- [QR Code Scanning](qr-code-scanning.md) — tickets referenced in emails contain QR codes for event entry.
- [Auth.js Integration](authjs-integration.md) — Resend is also used for magic link authentication emails.
