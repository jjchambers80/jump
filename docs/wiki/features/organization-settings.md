# Organization Settings

**Status:** Implemented
**Last Updated:** 2026-09-12

## Overview

Settings › General lets an organizer or admin manage the organization assigned to their account. The page is read-only by default: a **Business details** card (legal entity row with an `…` affordance) and a **Store contact details** card (two chevron rows: store name/email/phone and store address). Clicking a row opens a modal dialog with the editable fields; Save closes it and the row re-renders with the new values. Every dialog saves through the same partial `PATCH /admin/settings/business-details` endpoint, sending only its own fields.

Saving the store name also updates the organization switcher in the admin header immediately, because `name` is the same column the switcher, public pages, and emails display.

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/api/routes/admin.js` | `GET/PATCH /admin/settings/business-details`, `/admin/settings/people` routes |
| `backend/src/api/validators/organizationValidators.js` | `validateUpdateBusinessDetails` — partial-update validator with field whitelist |
| `backend/src/services/OrganizationService.js` | `getBusinessDetailsForUser`, `updateBusinessDetailsForUser`, `serializeBusinessDetails` (masks EIN) |
| `backend/src/services/OrganizationPersonService.js` | People management and account representative designation |
| `frontend/src/app/admin/settings/page.tsx` | Summary cards, which dialog is open, org-switcher sync, mismatch notice |
| `frontend/src/app/admin/settings/SummaryRow.tsx` | Read-only row button (icon, primary/secondary text, chevron or `…`) |
| `frontend/src/app/admin/settings/SettingsDialog.tsx` | Shared modal shell: focus trap, Escape/backdrop close, discard confirm, Cancel/Save header |
| `frontend/src/app/admin/settings/StoreContactDialog.tsx` | Store name / email / phone form |
| `frontend/src/app/admin/settings/StoreAddressDialog.tsx` | Company name / country / address form |
| `frontend/src/app/admin/settings/BusinessDetailsDialog.tsx` | Type of business, nickname, EIN, nested People section |
| `frontend/src/app/admin/settings/formShared.ts` | Shared field classes, validators (ZIP, phone, email), `formatPhone`, `formatAddress` |
| `frontend/src/app/admin/settings/icons.tsx` | Inline SVG icons for the rows (no icon library in the frontend) |
| `frontend/src/components/OrgContext.tsx` | `OrgProvider` with `refresh()` and `updateOrganization(id, patch)` |

## Field Mapping

| UI label | Dialog | Column | Notes |
|---|---|---|---|
| Store name | Store contact details | `Organization.name` | Required. Display name used by the switcher, public pages, emails |
| Store email | Store contact details | `Organization.email` | Optional. Trimmed, lowercased, loose RFC check. Not exposed publicly |
| Store phone number | Store contact details | `phoneNumber` + `phoneCountryCode` | Optional. Normalized to 10 digits; country code fixed to `+1` |
| Company name | Store address | `Organization.companyName` | Optional legal entity name; distinct from the display name |
| Country/region | Store address | `countryCode` | Single-option select; server enforces `US` |
| Address / Apartment, suite | Store address | `addressLine1` / `addressLine2` | Line 1 required |
| City / State / ZIP | Store address | `city` / `state` / `postalCode` | State must be a US state/territory code; ZIP is 5-digit or ZIP+4 |
| Type of business, Nickname, EIN | Business details | `businessType` / `nickname` / `ein` | EIN write-only; response returns `hasEin` + `einMasked` |

### Summary rows

| Row | Primary text | Secondary text | Trigger |
|---|---|---|---|
| Business details | `companyName`, falling back to `name` | business type label · `EIN ••-•••1234` | `…` (button name: "Edit business details") |
| Store contact | `name` | `email · (919) 555-1212` | chevron ("Edit store contact details") |
| Store address | "Store address" | `line1, line2, City, ST 12345, United States` | chevron ("Edit store address") |

Empty values show an "Add …" prompt instead.

## How It Works

1. `page.tsx` loads `GET /admin/settings/business-details` for the signed-in user's `organizationId` (not the header's selected org).
2. Each row is a single `<button>` (the whole row is clickable). `page.tsx` tracks which editor is open (`'contact' | 'address' | 'business' | null`) and renders the matching dialog.
3. Each dialog owns its form state, dirty tracking, and inline errors inside the shared `SettingsDialog` shell. Save is disabled until the form is dirty; Cancel, Escape, or a backdrop click prompt "Discard unsaved changes?" when dirty.
4. On submit the dialog PATCHes only its fields. The validator checks the keys that are present, normalizes them, and rejects unknown keys and empty bodies; the service passes the body straight to `prisma.organization.update`.
5. The response is the full serialized record; the page stores it, closes the dialog, announces "… saved." via a visually hidden `role="status"`, and returns focus to the row that opened the dialog.
6. When the Store contact dialog saves, the page calls `updateOrganization(id, { name })` on `OrgContext` (optimistic in-memory patch) and then `refresh()` in the background. The switcher trigger and list re-render from context immediately.
7. If an ADMIN has a different org selected in the header than the one Settings edits, the page shows a notice naming both orgs. Scoping Settings to the selected org is a follow-up.

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

- **Partial semantics** — the validator is the first partial-update validator in the codebase. Do not reintroduce required-field checks for absent keys; each dialog depends on being able to save independently.
- `SettingsDialog` runs its focus/keyboard effect once per mount and reads `dirty`/`saving`/`childActive` through refs. Passing inline callbacks is fine; the effect does not re-run on re-render.
- `BusinessDetailsDialog` nests `AddPersonDialog`; it sets `childActive` so the shell stops handling Escape/Tab and marks itself `aria-hidden` while the child is open.
- The Settings page edits the JWT user's organization; the header switcher lists all orgs for ADMIN users. The two can disagree — the page warns but does not block.
- `email` and `phoneNumber` are not part of `getPublicOrganization`'s explicit `select`; keep it that way unless a public contact feature is designed.
- EIN is masked on read — the full value is never returned from the API. Sending `ein: null` clears it; omitting it preserves it.
- DOB is stored for people but never returned by list or create responses, nor logged.
- Only one account representative per organization (partial unique index).
- E2E tests mock `GET /organizations` in addition to the settings endpoints, because the switcher label comes from `OrgContext`, not from the settings response.
- Previewing from a worktree frontend on another port (e.g. `:3011`) needs the backend's CORS allowlist to accept it. Since `128659a`, `FRONTEND_URL` is comma-separated and any `localhost` port is allowed outside production — restart the backend after pulling. Run the E2E suite with `PLAYWRIGHT_PORT=3011` so it does not reuse a dev server from a different checkout.

## Related Features

- [RBAC](rbac.md) — organizer role required for settings access.
- [Admin Dashboard](admin-dashboard.md) — org context shared with dashboard.
