# Organization Settings

**Status:** Implemented
**Last Updated:** 2026-09-12

## Overview

Settings › General lets an organizer or admin manage the organization assigned to their account. The page is split into a **Store contact details** section (two inline cards: Store name and Store address) and a **Business details** card (type of business, nickname, EIN, People) that opens a dialog. Every card saves through the same partial `PATCH /admin/settings/business-details` endpoint, sending only its own fields.

Saving the store name also updates the organization switcher in the admin header immediately, because `name` is the same column the switcher, public pages, and emails display.

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/api/routes/admin.js` | `GET/PATCH /admin/settings/business-details`, `/admin/settings/people` routes |
| `backend/src/api/validators/organizationValidators.js` | `validateUpdateBusinessDetails` — partial-update validator with field whitelist |
| `backend/src/services/OrganizationService.js` | `getBusinessDetailsForUser`, `updateBusinessDetailsForUser`, `serializeBusinessDetails` (masks EIN) |
| `backend/src/services/OrganizationPersonService.js` | People management and account representative designation |
| `frontend/src/app/admin/settings/page.tsx` | Settings page layout, org-switcher sync, mismatch notice |
| `frontend/src/app/admin/settings/StoreContactCard.tsx` | Store name / email / phone inline form |
| `frontend/src/app/admin/settings/StoreAddressCard.tsx` | Company name / country / address inline form |
| `frontend/src/app/admin/settings/BusinessDetailsDialog.tsx` | Type of business, nickname, EIN, nested People section |
| `frontend/src/app/admin/settings/formShared.ts` | Shared field classes and validators (ZIP, phone, email) |
| `frontend/src/components/OrgContext.tsx` | `OrgProvider` with `refresh()` and `updateOrganization(id, patch)` |

## Field Mapping

| UI label | Card | Column | Notes |
|---|---|---|---|
| Store name | Store name | `Organization.name` | Required. Display name used by the switcher, public pages, emails |
| Store email | Store name | `Organization.email` | Optional. Trimmed, lowercased, loose RFC check. Not exposed publicly |
| Store phone number | Store name | `phoneNumber` + `phoneCountryCode` | Optional. Normalized to 10 digits; country code fixed to `+1` |
| Company name | Store address | `Organization.companyName` | Optional legal entity name; distinct from the display name |
| Country/region | Store address | `countryCode` | Single-option select; server enforces `US` |
| Address / Apartment, suite | Store address | `addressLine1` / `addressLine2` | Line 1 required |
| City / State / ZIP | Store address | `city` / `state` / `postalCode` | State must be a US state/territory code; ZIP is 5-digit or ZIP+4 |
| Type of business, Nickname, EIN | Business details dialog | `businessType` / `nickname` / `ein` | EIN write-only; response returns `hasEin` + `einMasked` |

## How It Works

1. `page.tsx` loads `GET /admin/settings/business-details` for the signed-in user's `organizationId` (not the header's selected org).
2. Each card keeps its own form state, dirty tracking, inline errors, and an `aria-live` status. Save is disabled until the form is dirty.
3. On submit the card PATCHes only its fields. The validator checks the keys that are present, normalizes them, and rejects unknown keys and empty bodies; the service passes the body straight to `prisma.organization.update`.
4. The response is the full serialized record; the page stores it and all cards re-sync from it.
5. When the Store name card saves, the page calls `updateOrganization(id, { name })` on `OrgContext` (optimistic in-memory patch) and then `refresh()` in the background. The switcher trigger and list re-render from context immediately.
6. If an ADMIN has a different org selected in the header than the one Settings edits, the page shows a notice naming both orgs. Scoping Settings to the selected org is a follow-up.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/settings/business-details` | Business details for the current user's organization (EIN masked) |
| PATCH | `/admin/settings/business-details` | Partial update; any subset of the whitelisted fields |
| GET | `/admin/settings/people` | List people in the organization (no date of birth) |
| POST | `/admin/settings/people` | Add a person; may replace the account representative |
| DELETE | `/admin/settings/people/:personId` | Remove a person |

### PATCH contract

Whitelisted fields: `name`, `companyName`, `email`, `businessType`, `nickname`, `countryCode`, `addressLine1`, `addressLine2`, `city`, `state`, `postalCode`, `phoneCountryCode`, `phoneNumber`, `ein`.

- Only keys present in the body are validated and written. A present key must still be valid (`name` may be omitted but not blank).
- Unknown keys → `400 Unknown field: <key>`. Empty body → `400`.
- Optional strings accept `null` or `""` to clear.
- `countryCode` must be `US`; `phoneCountryCode` must be `+1`.

## Gotchas

- **Partial semantics** — the validator is the first partial-update validator in the codebase. Do not reintroduce required-field checks for absent keys; each card depends on being able to save independently.
- The Settings page edits the JWT user's organization; the header switcher lists all orgs for ADMIN users. The two can disagree — the page warns but does not block.
- `email` and `phoneNumber` are not part of `getPublicOrganization`'s explicit `select`; keep it that way unless a public contact feature is designed.
- EIN is masked on read — the full value is never returned from the API. Sending `ein: null` clears it; omitting it preserves it.
- DOB is stored for people but never returned by list or create responses, nor logged.
- Only one account representative per organization (partial unique index).
- E2E tests mock `GET /organizations` in addition to the settings endpoints, because the switcher label comes from `OrgContext`, not from the settings response.

## Related Features

- [RBAC](rbac.md) — organizer role required for settings access.
- [Admin Dashboard](admin-dashboard.md) — org context shared with dashboard.
