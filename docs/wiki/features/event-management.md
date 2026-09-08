# Event Management

**Status:** Active
**Last Updated:** 2026-09-07

## Overview

Events have a strict lifecycle: DRAFT -> PUBLISHED -> CANCELLED (terminal). Events are created under org-scoped routes, linked to a Venue (which determines the owning Organization). Capacity is validated against the sum of PriceTier `quantityTotal` values. Only PUBLISHED events are visible to the public.

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/services/EventService.js` | Event CRUD, lifecycle transitions, capacity validation, analytics |
| `backend/src/api/routes/events.js` | Public routes (`GET /events`) and org-scoped routes (`/organizations/:orgId/events`) |
| `frontend/src/app/admin/events/` | Admin event management UI |

## How It Works

1. **Create** (`POST /organizations/:orgId/events`): Validates venue belongs to org, capacity is 1--100,000, date is in the future, and sum of tier `quantityTotal` does not exceed capacity. Creates event in DRAFT status with nested price tiers. Tax rate is computed from venue postal code (non-blocking).
2. **Update** (`PATCH /organizations/:orgId/events/:eventId`): Validates org ownership via `event.venue.organizationId`. Capacity floor check prevents reducing below existing tier inventory total. Venue change triggers tax rate refresh.
3. **Publish** (`POST .../events/:eventId/publish`): Only DRAFT -> PUBLISHED allowed. Tax rate refreshed on publish to ensure accuracy.
4. **Cancel** (`POST .../events/:eventId/cancel`): Only PUBLISHED -> CANCELLED allowed. Ticket holder notification is a TODO (T076).
5. **Public listing** (`GET /events`): Returns only PUBLISHED events with pagination, category filter, and date range filter. Includes venue summary and active tier availability.
6. **Public detail** (`GET /events/:eventId`): Returns single event only if status is PUBLISHED.
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
| GET | `/organizations/:orgId/events/:eventId/analytics` | Organizer | Event analytics |
| POST | `/organizations/:orgId/events/:eventId/logo` | Organizer | Upload logo |
| DELETE | `/organizations/:orgId/events/:eventId/logo` | Organizer | Remove logo |

## Gotchas

- **Only PUBLISHED events visible to public.** `getEventById` throws `NotFoundError` for non-PUBLISHED events.
- **Capacity is on Event but actual inventory tracked per-tier.** `Event.capacity` is a ceiling; real availability is `sum(priceTier.quantityTotal - quantitySold - quantityReserved)`.
- **Org ownership resolved transitively** via `venue.organizationId` -- Event has no direct `organizationId` column.
- **CANCELLED is terminal** -- no transition back to DRAFT or PUBLISHED.
- **Tax rate refresh is non-blocking** -- event is created/updated even if Stripe Tax API fails. `taxRate` stays null/0 on failure.
- **Capacity floor check on update** -- cannot reduce capacity below sum of existing tier quantities.

## Related Features

- [Multi-Tenant Architecture](multi-tenant-architecture.md) -- org-scoped routing
- [Price Tiers](price-tiers.md) -- per-event inventory and pricing
- [Tax Calculation](tax-calculation.md) -- venue-based tax rates
