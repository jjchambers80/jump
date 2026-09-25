# Vendor door check-in — event-day arrivals

Spec 036 implementation, on `feat/vendor-door-check-in`.

## Overview

Event-day surface for staff at the loading dock: find an approved vendor by name or by scanning the pass the vendor already has, stamp the arrival, and watch `arrived / expected` with booth assignments.

It runs on a phone, one-handed, on venue wifi. That constraint — not the feature list — drove the design.

## The arrival record

There is **one** arrival record and it is `Application.checkedInAt` (spec 019 phase 3). The submissions table, the application detail page, the CSV export and the organizer digest already read it; the door writes to the same column. Do not add a second arrivals table.

Spec 036 adds only provenance:

```prisma
enum CheckInMethod { SEARCH SCAN TOGGLE }

model Application {
  checkedInAt   DateTime?      // the arrival (spec 019)
  checkedInById String?        // staff user who stamped it; null for legacy stamps
  checkedInVia  CheckInMethod? // how
}
```

Migration `20261009100000_vendor_door_check_in` is additive and nullable. **Rollback**: `ALTER TABLE "Application" DROP COLUMN "checkedInVia", DROP COLUMN "checkedInById"; DROP TYPE "CheckInMethod";` — no arrival data is lost, because the arrival itself lives in `checkedInAt`, which spec 036 does not touch.

## Idempotency lives in the database

A door check-in is a **conditional update**, never a read-then-write:

```js
prisma.application.updateMany({
  where: { eventId, organizationId, id, status: 'APPROVED', checkedInAt: null },
  data: { checkedInAt: new Date(), checkedInById, checkedInVia },
});
```

`count === 0` means somebody already stamped it. The service re-reads the row and answers `{ alreadyCheckedIn: true, vendor }` carrying the **first** timestamp.

This makes three different problems the same problem:

| Situation | Outcome |
|---|---|
| Staff double-taps the button | One stamp; the second call reads it back |
| The request times out and the phone retries | One stamp; the retry returns the original time |
| Two staff scan the same badge in the same second | One stamp; the loser reads the winner's time |

Because a retry can never do damage, the client is free to retry blindly — which is what makes the offline queue safe.

The spec 019 submissions-table checkbox (`ApplicationService.updateMeta`) writes through the same conditional update, so a checkbox and a door scan landing together cannot overwrite each other's arrival time. Clearing a stamp is an ordinary write.

## The pass the vendor already has

No new credential is issued. `applicationLinks.statusToken(applicationId)` is an HMAC of the application id under `AUTH_SECRET`, and it is already in every approval email as the status-page link. `QRService.parseVendorPayload` accepts three shapes:

- `jump://vendor?id=…&e=…&t=…` — the badge QR (`generateVendorQRPayload`)
- `…/events/{eventId}/apply/status/{id}?token=…` — the approval-email link, including the custom-domain short form
- `{applicationId}:{token}` — typed in, or a reader that strips the scheme

The bare pair is matched strictly (`[a-z0-9]{8,32}:[a-f0-9]{64}`). Without that, a *ticket* QR held up at the vendor door parses as application id `jump` and staff get a confusing "no vendor matches" instead of a clean rejection.

Rotating `AUTH_SECRET` invalidates every emailed link and therefore every vendor pass, exactly as it already does for status links.

## Endpoints

All under `/admin/events/:eventId/check-in`, ORGANIZER+, scoped by `scopedOrgFor(req)` **and** the event id:

| Route | Does |
|---|---|
| `GET /` | Roster: approved vendors with booth + arrival state, `counts { expected, arrived, awaiting }`, event name/venue/timezone. Unarrived first, then by business name. Optional `?q=` |
| `POST /scan` | `{ payload }` → the vendor, or 404 |
| `POST /:applicationId` | `{ via }` → `{ alreadyCheckedIn, vendor }` |
| `DELETE /:applicationId` | Undo a mis-scan; also idempotent |

Counts always describe the whole event, never the filtered rows, so the header does not appear to change what happened when staff type a search.

**Tenant isolation.** Wrong organization, wrong event, unknown id and forged token all return the same 404 with the same message. The door must not confirm that an application id exists somewhere else.

## The door page

`frontend/src/app/admin/events/[eventId]/check-in/page.tsx`, linked from the Applications header. Phone-first: 390 px reference width, 16 px inputs (iOS Safari zooms the page below that), thumb-sized tap targets.

- **Search filters locally.** The roster is one event's approved vendors — small enough to hold, and filtering in memory keeps working when the network does not.
- **Rows never re-sort after a check-in.** Server order is kept so a row cannot jump under a staffer's thumb mid-tap.
- **`useDoorQueue`** owns retries: one in-flight request per vendor, backoff of 1 s / 3 s / 8 s up to 4 attempts, and an immediate flush on the browser `online` event. `404 / 409 / 400 / 403` are verdicts, not transport failures, and stop immediately.
- **Per-vendor state is always visible**: `Sending… (try 2)` → `Arrived 10:04` or `Not sent — retrying`. A staffer is never left guessing.
- **Arrival times use the viewer's account zone** (`useAccountFormat()`, spec 030) because they are operational; the **event** time uses the venue's wall clock (`formatEventDateTime`, spec 033).
- Camera scanning lazy-loads `html5-qrcode`; manual entry is always available, because a cracked camera at 8am cannot be what stops a vendor getting in.

## Tests

- `backend/tests/contract/vendorCheckIn.test.js` — retry keeps the first stamp, six concurrent check-ins produce exactly one, the spec 019 toggle converges with the door, undo is idempotent, roster counts match the records, cross-org and cross-event 404, scan shapes and forged tokens, non-APPROVED 409.
- `backend/tests/unit/vendorPass.test.js` — payload round-trip and every rejection case, no database needed.
- `frontend/e2e/admin-door-check-in.spec.ts` — 8 specs at a 390×844 viewport with the API mocked, including a double-tap sending one request and an aborted request being retried to success.

## Not covered

- No offline *persistence*: the retry queue lives in memory, so a hard reload mid-outage loses queued taps. The roster reload shows the true state, and nothing is ever double-stamped, but a tab crash during an outage means re-tapping.
- No vendor-facing QR yet. `VendorCheckInService.passPayloadFor` produces the payload, but the applicant status page does not render it — vendors present the approval-email link today.
- Check-*out* (`checkedOutAt`) is still only the spec 019 checkbox; the door page does not surface it.
