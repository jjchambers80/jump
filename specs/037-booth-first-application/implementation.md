# Spec 037 — Booth-first application flow: what was built

**Status**: Implemented (2026-09-25), branch `paperclip/EVE-23`. The proposal is `spec.md` beside this file (EVE-16); this document records what the build actually does and where it departs from it.
**Numbering note**: the Paperclip issues call this "spec 036". By the time it was written, `036` had already been taken by the vendor door check-in work (commit `2390ee5`, "chore: renumber door check-in to spec 036"). This is `037`; the issue text is stale, not this document.
**Builds on**: spec 011 applications (`ApplicationForm` / `ApplicationTier` / `Application`, card on file, charge on approval, pay-now, `PAYMENT_DUE`), spec 014 floor map (`FloorMap`, `Booth`, `BoothService`, the public map, the post-approval `BoothPicker`), spec 024 one ledger (`Order kind: APPLICATION`, `dueAt`).
**Depends on**: the booth hold uniqueness hardening in migration `20261009100000_booth_hold_uniqueness` — `Booth.holdApplicationId @unique` plus `Booth_hold_state_check`. This spec extends that CHECK rather than replacing it.

## 1. The problem

Spec 014 phase 2 shipped an **approval-first** flow:

1. vendor applies for a *tier* ("10×10 booth — $275"), saves a card;
2. organizer approves; the application lands `APPROVED + PAYMENT_DUE`;
3. vendor comes back to the status page, opens the map, picks a booth, pays.

That order has two problems the organizer interview keeps surfacing.

**The vendor does not know what they are buying.** "A 10×10" is not what a vendor
is choosing between. Corner versus mid-aisle, next to the food trucks versus
behind a pillar — that is the actual decision, and in the approval-first flow
they make it days later, after they have already committed.

**Approval is not an offer of anything specific.** Step 3 is a second race, held
between the approved vendors, after the organizer thought they were done. A
vendor approved on Monday can find every good booth gone by the time they open
the email. The organizer has no way to say "you are in, and this is your spot".

Booth-first inverts steps 1 and 3: the booth is part of the application.

## 2. What changes

| | Approval-first (spec 014 §4.2) | Booth-first (this spec) |
|---|---|---|
| When the booth is chosen | After approval, on the status page | On the apply form, before submitting |
| What the organizer reviews | An application for a tier | An application for booth A12 |
| When the booth becomes unavailable | On approval + pick | On submission |
| What approval means | "You may now go and pick" | "A12 is yours"; the card is charged |
| Who races | Approved vendors, after the fact | Applicants, at submission — and it resolves in one transaction |

Both flows stay in the codebase. Booth-first is used when the tier is
`mapBound` **and** the event's `FloorMap` is `PUBLISHED`; that pair is the whole
trigger. There is no new "booth-first on/off" column to keep in sync with
`mapBound`, and an organizer who has not published their map yet still gets the
approval-first flow rather than a broken form.

## 3. The hold, and why `Booth.holdKind` exists

Before this spec, `HELD` meant exactly one thing: a checkout is in flight, and
the hold expires in `BOOTH_HOLD_MS` (15 minutes). A booth-first hold has to
survive days of organizer review, so it had nowhere to live. Fifteen minutes
would hand the vendor's spot away while the organizer was still reading; no
expiry at all would leak inventory forever on abandoned applications.

`Booth.holdKind` names the clock a hold runs on. It is written once, when the
hold is created, and never changed:

| `holdKind` | Created by | Clock | Released by a payment failure? |
|---|---|---|---|
| `CHECKOUT` | `BoothService.chooseBooth` — the post-approval pick | `BOOTH_HOLD_MS` (15 min) | **Yes.** The pick was speculative; the vendor chooses again |
| `APPLICATION` | `BoothService.holdForReview` — the booth-first pick | The application's own clock: the review deadline, then `order.dueAt` | **No.** They applied for this booth and were approved for it |

`Booth_hold_state_check` is widened to
`status = 'HELD' ⇔ (holdApplicationId AND holdExpiresAt AND holdKind are all set)`,
so no hold can exist without a stated reason and therefore without a stated way
to expire.

### 3.1 The review deadline

`reviewDeadline(submittedAt, eventStartsAt)` = `submittedAt + BOOTH_REVIEW_HOLD_DAYS`
(default 30, `BOOTH_REVIEW_HOLD_DAYS`), clamped to the event start, floored at
"later than now". Long, because the clock it replaces is the organizer's review
rather than a checkout; finite, because an application nobody ever decides and
nobody ever withdraws must still return its booth.

A `DRAFT` is the exception: it is mid card-capture on Stripe, not under review,
so it holds on the short `BOOTH_HOLD_MS` clock. `promoteToReview` moves it to
the review clock when the card actually lands. Without that split, every
abandoned Stripe Checkout would park a booth for a month.

## 4. Lifecycle

```
                      submit (boothId)                   ┌─ reject ─────────┐
  apply form ──────────────────────────► HELD/APPLICATION ├─ waitlist ───────┼─► AVAILABLE
   (pick A12)         one transaction     (review clock)  ├─ withdraw ───────┤
                                                 │        └─ sweep past due ─┘
                                        approve  │
                                                 ▼
                                    HELD/APPLICATION  ──charge card on file──►  SOLD
                                     (order.dueAt)              │
                                                       declined │
                                                                ▼
                                            HELD/APPLICATION + PAYMENT_DUE
                                             (pay-now; overdue sweep releases)
```

Point by point:

- **Submit.** `ApplicationService.submit` takes the hold inside the same
  transaction that creates the `Application`, via `boothService.holdForReview`.
  The booth and the application commit together: there is never an application
  without its booth, nor a booth held by a submission that rolled back.
- **Losing the race.** A `409 BOOTH_TAKEN` aborts the whole submission. The
  alternative — create the application, skip the booth — leaves a vendor who
  thinks they applied for A12 while somebody else has it. Better to make them
  pick again while they are still on the form.
- **Re-picking.** An applicant's own abandoned `DRAFT` is withdrawn and
  releases its booth *before* the new hold is taken, or the unique index on
  `holdApplicationId` would lock them out of the map by themselves.
- **Approve.** The hold's deadline moves to `order.dueAt` and the card on file
  is charged immediately. There is nothing left for the vendor to choose, so
  approval-first's `PAYMENT_DUE` waiting step is skipped.
- **Declined card.** `releaseHoldOnFailure` keeps an `APPLICATION` hold. This is
  the behaviour change most worth reviewing: previously a decline released the
  booth, which under booth-first would hand an approved vendor's spot to
  whoever clicked next.
- **Reject / waitlist / withdraw.** All release. Waitlisting counts because a
  waitlisted vendor sitting on a specific booth is inventory the organizer
  cannot sell to anyone they *did* approve; approved off the waitlist later,
  they pick again through the approval-first picker.
- **Expiry.** `sweepExpiredHolds` needs no new branch — `holdExpiresAt` already
  carries the right deadline for the kind — but it now also clears
  `Application.boothLabel`, so a reclaimed booth stops being named on a status
  page somebody else can now buy. The `PROCESSING` / `PAID` protection is
  unchanged.
- **Overdue.** Unchanged from spec 011 phase 3: the overdue sweep withdraws the
  application under `overduePolicy: WITHDRAW`, which releases the booth.

## 5. Concurrency

The default case is two vendors submitting for the same booth in the same
second, and there are two independent layers, as in spec 014:

1. One transaction per submission, `SELECT … FOR UPDATE` in Application → Booth
   order — the same order every other `BoothService` mutation uses, so the
   booth-first path cannot deadlock against `assign`, `move` or the sweep.
2. The database holds the invariant regardless: `Booth.applicationId` unique
   (SOLD), `Booth.holdApplicationId` unique (HELD), `Booth_hold_state_check`
   pinning what `HELD` means. A caller that forgets the lock order still gets a
   `23505`, translated to the same `409` the lock would have produced.

Multi-tenant scoping is explicit rather than incidental: `_takeHold` checks the
booth's map belongs to *this application's event* and returns `404` otherwise,
so a booth id from another organizer is invisible rather than merely
tier-mismatched.

## 6. Surfaces

- `POST /events/:eventId/applications` accepts `boothId`. Required when the
  tier is booth-first, refused (`400`) when it is not.
- `GET /events/:eventId/applications/forms[/:slug]` exposes `tiers[].boothFirst`
  — `mapBound && map.status === 'PUBLISHED'` — so the form knows to show a map.
- `ApplyBoothStep` (frontend) renders the same public map patrons see, inside
  the apply form. Selection only: no hold, no countdown, no payment, nothing to
  abandon. A `BOOTH_TAKEN` on submit clears the selection and refetches.
- The existing post-approval `BoothPicker` is untouched and still serves
  approval-first tiers and anyone whose booth-first hold expired.

## 7. Deliberately not in this spec

- **Charging at submission.** `chargeTiming: 'SUBMIT'` is still refused for
  map-bound tiers (`ApplicationFormService.updateForm`). Booth-first makes it
  *possible* — there is a specific booth to charge for — but taking money before
  a human has approved the vendor is a product decision and a money change, and
  money changes belong to Ledger.
- **Multiple booths per application.** `Booth.holdApplicationId` is unique, so
  one application holds at most one booth, by construction. A vendor wanting two
  booths applies twice.
- **Organizer override of a booth-first pick.** `BoothService.move` / `assign`
  already cover it and are unchanged.
- **Showing the vendor a queue position** when their booth is taken mid-form.
  They just pick again.

## 8. Migration and rollback

`20261009120000_booth_first_application`:

- `CREATE TYPE "BoothHoldKind"`, add nullable `Booth.holdKind`.
- Backfill every existing `HELD` booth to `CHECKOUT` — correct by construction,
  since that was the only hold the code could create — keeping its existing
  `holdExpiresAt`. No hold is created, released or re-timed.
- Widen `Booth_hold_state_check`, index `(holdKind, holdExpiresAt)`.

Rollback restores the narrower CHECK and drops the column and type; the SQL is
in the migration header. Rolling back while `APPLICATION` holds exist leaves
them `HELD` on the old 15-minute sweep, so they are reclaimed *early* rather
than stranded — the pre-037 behaviour. Nothing double-books either way.

## 9. Configuration

| Variable | Default | Meaning |
|---|---|---|
| `BOOTH_REVIEW_HOLD_DAYS` | `30` | How long a booth-first hold survives with no decision, before the sweep reclaims it |
| `BOOTH_HOLD_MS` | `900000` | Unchanged: the checkout clock, and the clock a `DRAFT` holds on |
| `BOOTH_SWEEP_INTERVAL_MS` | `60000` | Unchanged |

## 10. Tests

- `backend/tests/unit/boothService.test.js` — the two clocks, `reviewDeadline`
  clamping, what `releaseHoldOnFailure` keeps versus releases,
  `extendApplicationHold` never shortening a hold.
- `backend/tests/contract/boothFirstApplication.test.js` — six concurrent
  submissions at one booth (exactly one wins, the losers create nothing), the
  cross-tenant booth, self re-pick, release on reject / waitlist / withdraw,
  sale on approval, **hold kept on a declined approval charge**, sweep reclaim
  with label cleanup, and the payment-in-flight protection.
