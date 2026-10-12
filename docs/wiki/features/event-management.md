# Event Management

**Status:** Active
**Last Updated:** 2026-10-11

## Overview

Events have a lifecycle: DRAFT -> PUBLISHED -> CANCELLED (terminal). Since spec 050-D a PUBLISHED event can go back to DRAFT (unpublish, guarded), stop selling while staying PUBLISHED (close / reopen sales), and an unsold DRAFT can be deleted. Events are created under org-scoped routes, linked to a Venue (which determines the owning Organization). Capacity is validated against the sum of PriceTier `quantityTotal` values. Only PUBLISHED events are visible to the public.

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/services/EventService.js` | Event CRUD, lifecycle transitions, capacity validation, analytics |
| `backend/src/api/routes/events.js` | Public routes (`GET /events`) and org-scoped routes (`/organizations/:orgId/events`) |
| `frontend/src/app/admin/events/` | Admin event management UI |

## How It Works

1. **Create** (`POST /organizations/:orgId/events`): Validates venue belongs to org, capacity is 1--100,000, date is in the future, and sum of tier `quantityTotal` does not exceed capacity. Creates event in DRAFT status with nested price tiers. Tax rate is computed from venue postal code (non-blocking).
2. **Update** (`PATCH /organizations/:orgId/events/:eventId`): Validates org ownership via `event.venue.organizationId`. Capacity floor check prevents reducing below existing tier inventory total. Venue change triggers tax rate refresh.
   Spec 050-A: `endDate` (optional, after `date`), `setupStep`, `setupCompleted: true`, and `capacity: null` on DRAFTs only (409 `CAPACITY_REQUIRED`). A `setup: true` create with an `Idempotency-Key` makes a wizard draft (no tiers, capacity optional, `setupCompletedAt: null`); see [Event Setup Wizard](event-setup-wizard.md).
3. **Publish** (`POST .../events/:eventId/publish`): Only DRAFT -> PUBLISHED allowed. Runs `EventReadinessService` first (422 `EVENT_NOT_READY` with blockers; `GET …/readiness` answers the same), opens the listed DRAFT forms (`openFormIds`, per-form `formResults`), sets `setupCompletedAt` if null. Tax rate refreshed on publish to ensure accuracy.
   - **Unpublish** (`POST …/unpublish`): PUBLISHED → DRAFT; 409 `UNPUBLISH_BLOCKED` with `details.reasons` while there is a live order, a GOING RSVP or a submitted application. Clears a sales close.
   - **Close / reopen sales** (`POST …/close-sales`, `…/reopen-sales`): PUBLISHED only, idempotent; `salesClosedAt` makes `assertSalesOpen` refuse new checkouts, RSVPs and application submissions (409 `SALES_CLOSED`). Public payload `salesClosed`.
   - **Delete** (`DELETE …/:eventId`): DRAFT (same guards, 409 `DELETE_BLOCKED`) or CANCELLED; PUBLISHED must be cancelled first. With order history the event is soft-deleted (`Event.deletedAt`): hidden from admin lists and search, its orders and payments kept.
4. **Cancel** (`POST .../events/:eventId/cancel`): Only PUBLISHED -> CANCELLED allowed. Ticket holder notification is a TODO (T076).
5. **Public listing** (`GET /events`): Returns only PUBLISHED events with pagination, category filter, and date range filter. Includes venue summary and active tier availability.
6. **Public detail** (`GET /events/:eventId`): Returns single event only if status is PUBLISHED, or a DRAFT with a verified `X-Event-Preview` token for that event (spec 050-F, `preview: true`, noindex).
7. **Org listing** (`GET /organizations/:orgId/events`): Returns all statuses for the org with optional status filter.
8. **Analytics** (`GET .../events/:eventId/analytics`): Per-tier breakdown of sold, redeemed, remaining, and revenue. Event-level aggregates.
9. **Logo upload/delete**: `POST/DELETE .../events/:eventId/logo`.

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/events` | Public | List published events (paginated) |
| GET | `/events/:eventId` | Public | Get published event detail |
| GET | `/organizations/:orgId/events` | Organizer | List org events (all statuses) |
| POST | `/organizations/:orgId/events` | Organizer | Create event with price tiers |
| PATCH | `/organizations/:orgId/events/:eventId` | Organizer | Update event |
| POST | `/organizations/:orgId/events/:eventId/publish` | Organizer | Publish event |
| POST | `/organizations/:orgId/events/:eventId/cancel` | Organizer | Cancel event |
| GET | `/organizations/:orgId/events/:eventId/readiness` | Organizer | Publish blockers and warnings (spec 050-C) |
| POST | `/organizations/:orgId/events/:eventId/unpublish`, `/close-sales`, `/reopen-sales` | Organizer | Lifecycle (spec 050-D) |
| DELETE | `/organizations/:orgId/events/:eventId` | Organizer | Delete an unsold DRAFT (spec 050-D) |
| POST | `/organizations/:orgId/events/:eventId/preview-link`; GET `…/preview-payload` | Organizer | Signed draft preview, wizard preview data (spec 050-F) |
| GET | `/organizations/:orgId/events/:eventId/analytics` | Organizer | Event analytics |
| POST | `/organizations/:orgId/events/:eventId/logo` | Organizer | Upload logo |
| DELETE | `/organizations/:orgId/events/:eventId/logo` | Organizer | Remove logo |

## Gotchas

- **Only PUBLISHED events visible to public.** `getEventById` throws `NotFoundError` for non-PUBLISHED events, except a DRAFT with a verified preview token.
- **Capacity may be null on a DRAFT** (spec 050-A, DB CHECK `Event_capacity_draft_check`); readers treat null as "not set". Publish requires it for TICKETED events.
- **Capacity is on Event but actual inventory tracked per-tier.** `Event.capacity` is a ceiling; real availability is `sum(priceTier.quantityTotal - quantitySold - quantityReserved)`.
- **Org ownership resolved transitively** via `venue.organizationId` -- Event has no direct `organizationId` column.
- **CANCELLED is terminal** -- no transition back to DRAFT or PUBLISHED. Unpublish is PUBLISHED → DRAFT only.
- **Tax rate refresh is non-blocking** -- event is created/updated even if Stripe Tax API fails. `taxRate` stays null/0 on failure.
- **Capacity floor check on update** -- cannot reduce capacity below sum of existing tier quantities. Relaxed on wizard drafts (`setupCompletedAt` null): publish blocks `TIERS_EXCEED_CAPACITY` instead.

## Related Features

- [Multi-Tenant Architecture](multi-tenant-architecture.md) -- org-scoped routing
- [Price Tiers](price-tiers.md) -- per-event inventory and pricing
- [Tax Calculation](tax-calculation.md) -- venue-based tax rates
- [Event Setup Wizard](event-setup-wizard.md) -- create / edit flow, readiness, previews, lifecycle actions (spec 050)
