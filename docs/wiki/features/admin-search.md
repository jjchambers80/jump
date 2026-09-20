# Administration search

**Status:** In progress (spec 029; backend implemented)
**Last Updated:** 2026-09-20

## Overview

The administration header search is a bounded launcher across events, venues, customers, orders, tickets, applications, Online Store pages, blog posts, and files. The backend performs nine database-filtered queries in parallel and returns one flat result list in a stable resource order. It never loads full tables for in-memory filtering.

Every query follows the caller's existing administration scope. ORGANIZER and ADMIN users search only their active organization; a staff user without a membership receives an empty result; SYSTEM_ADMIN is unscoped unless `X-Jump-Org` selects one organization.

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/services/AdminSearchService.js` | Nine scoped `ILIKE`/relation queries, per-resource caps, stable row formatting and admin hrefs |
| `backend/src/api/routes/admin.js` | Authenticated `GET /admin/search` route and organization-scope resolution |
| `backend/src/api/validators/adminValidators.js` | Trims `q` and enforces the 2–200 character bound before database work |
| `backend/tests/contract/adminSearch.test.js` | Authentication, validation, all resource groups, empty results, Stripe-id matching and tenant isolation |
| `backend/tests/unit/adminSearch{,Validator}.test.js` | Query caps/scopes/order, error propagation and validator behavior |

## API

### `GET /admin/search?q=<term>`

Requires the existing `/admin` bearer-session guard and an ORGANIZER, ADMIN, or SYSTEM_ADMIN role.

`q` is required, trimmed server-side, and must contain 2–200 characters after trimming. Invalid input returns the standard validation response:

```json
{
  "error": "ValidationError",
  "message": "Validation failed",
  "details": [{ "field": "q", "message": "q must be 2–200 characters" }]
}
```

A successful response is:

```json
{
  "query": "summer",
  "total": 1,
  "data": [
    {
      "type": "EVENT",
      "id": "event-id",
      "title": "Summer Festival",
      "subtitle": "Jun 21, 2027 · Civic Hall",
      "href": "/admin/events/event-id/edit?orgId=organization-id",
      "meta": {
        "date": "2027-06-21T18:00:00.000Z",
        "status": "PUBLISHED"
      }
    }
  ]
}
```

`type` is one of `EVENT`, `VENUE`, `CUSTOMER`, `ORDER`, `TICKET`, `APPLICATION`, `PAGE`, `BLOG_POST`, or `FILE`. Results are grouped in that order. The resource caps are 5 events, 3 venues, 5 customers, 5 orders, 5 tickets, 5 applications, 3 pages, 3 blog posts, and 3 files, for a maximum response size of 37. No match returns `200` with `{ "query": "…", "total": 0, "data": [] }`; the launcher is intentionally not paginated.

Text matching is case-insensitive and contains-based. Order terms beginning with `pi_`, `re_`, `pyr_`, or `cs_` use exact equality against the corresponding Stripe/payment identifiers. Draft applications are excluded. Customer rows follow the Customers definition and therefore require at least one paid order.

## Performance and security

- Every resource query includes the active organization predicate unless the caller is an unscoped SYSTEM_ADMIN.
- Every query has a database-level `take` cap; there is no unbounded in-memory scan.
- The two-character minimum prevents blank and one-character contains scans.
- Version 1 uses PostgreSQL `ILIKE` under the organization predicates. No `pg_trgm` migration is required at current scale; add trigram indexes if a tenant's searchable tables approach tens of thousands of rows.
- Existing `/admin` authentication and role middleware protect the endpoint. Buyer sessions are not accepted.

## Related Features

- [Org Switcher](org-switcher.md) — supplies the active `X-Jump-Org` scope
- [Admin Dashboard](admin-dashboard.md) — administration shell that hosts the search control
- [Participants](participants.md) — application search destination
- [Application orders](application-orders.md) — unified order results
