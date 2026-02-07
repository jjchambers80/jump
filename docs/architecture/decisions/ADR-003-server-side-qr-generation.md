# ADR-003: Server-Side QR Code Generation

**Status**: Accepted  
**Date**: 2026-02-04  
**Decision Makers**: Engineering Team  
**Context**: Feature 001 – Online Ticket Purchase and QR Code Generation

## Context

Tickets include cryptographically-signed QR codes that encode JWT tokens for event entry validation (FR-006, FR-007). We needed to decide where QR code generation occurs — on the server (backend) or in the browser (frontend).

## Decision

**Generate QR codes server-side** in the backend, delivering them to the frontend as base64 data URLs.

The flow:

1. Backend signs JWT with HMAC-SHA256 using server-side secret key
2. Backend generates QR code image (PNG) from the JWT string using the `qrcode` library
3. Backend returns the QR code as a base64 data URL in the API response
4. Frontend displays the pre-rendered QR code image
5. Email service embeds the same QR code image in the confirmation email

## Rationale

- **Security**: The JWT signing key (HMAC-SHA256 secret) must remain on the server. Client-side signing would expose the key, allowing QR code forgery.
- **Consistency**: The same QR code image is displayed on the confirmation page and in the email. Server-side generation ensures identical output.
- **Performance**: The `qrcode` library generates QR images in <10ms. This is faster than loading a QR library on the client (~50KB bundle increase + initialization time).
- **Reliability**: Server-controlled generation means consistent error correction level (M/H), image size, and format across all clients.
- **Offline Access**: The base64 data URL is self-contained — no external image URL that could expire or fail.

## Alternatives Considered

| Alternative                                      | Pros                                 | Cons                                                                           | Why Rejected                                 |
| ------------------------------------------------ | ------------------------------------ | ------------------------------------------------------------------------------ | -------------------------------------------- |
| **Client-Side Generation**                       | Reduces server load, faster response | Requires shipping JWT secret to client (security risk), inconsistent rendering | Security vulnerability, violates Principle I |
| **Hybrid** (server signs JWT, client renders QR) | Smaller API response                 | Client needs QR library, still sends JWT over wire                             | Marginal benefit, added frontend complexity  |
| **External QR Service**                          | Offloads processing                  | External dependency, latency, privacy concern (ticket data sent externally)    | Unnecessary dependency                       |

## Consequences

### Positive

- JWT signing key never leaves the server
- Identical QR codes in browser and email
- No frontend QR library needed (smaller bundle)
- Self-contained data URLs work offline

### Negative

- Slightly larger API responses (~2-5KB per QR code as base64)
- Server bears QR generation CPU cost (mitigated by <10ms per image)
- Data URLs are larger than external image references

### Technical Details

- **Library**: `qrcode` npm package v1.5.x
- **Format**: PNG image as base64 data URL
- **Error Correction**: Level M (15% redundancy) — balances size and scannability
- **Image Size**: 300×300 pixels with 2px margin
- **JWT Algorithm**: HMAC-SHA256 (symmetric, server-only verification for MVP)
