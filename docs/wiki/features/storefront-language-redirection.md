# Storefront Language Redirection

**Status:** Implemented (setting only — no runtime redirect yet)
**Last Updated:** 2026-09-19

## Overview

The **Automatic redirection** section on **Online store › Preferences** has one control: a *Language* switch labelled "Redirect visitors to the language that matches their browser when available." It is the organizer-facing opt-in for a localized storefront. Today the storefront ships in one language, so the flag is persisted and returned but nothing reads it; when localization lands, the storefront should honour `autoRedirectLanguage` by picking the locale from `Accept-Language` / `navigator.languages` among the locales the store actually offers.

## Key Files

| File | Purpose |
|------|---------|
| `packages/db/prisma/schema.prisma` (`model Organization`) | `autoRedirectLanguage Boolean @default(false)` |
| `packages/db/prisma/migrations/20260929100000_storefront_language_redirection` | Adds the column |
| `backend/src/services/StorefrontPreferencesService.js` | Serializes / patches `autoRedirectLanguage` with the other preferences |
| `backend/src/api/validators/storefrontPreferencesValidators.js` | Accepts `autoRedirectLanguage` (boolean) on `PATCH /admin/online-store/preferences` |
| `frontend/src/app/admin/online-store/preferences/page.tsx` | *Automatic redirection* card: `role="switch"` toggle that saves immediately with optimistic rollback |
| `frontend/src/services/api.ts` | `StorefrontPreferences.autoRedirectLanguage` |
| `backend/tests/{unit,contract}/storefrontPreferences.test.js`, `frontend/e2e/admin-preferences.spec.ts` | Coverage for the field and the toggle |

## Configuration

None.

## How It Works

1. Toggle click → `PATCH /admin/online-store/preferences { autoRedirectLanguage: true|false }` (ADMIN). The UI flips first and rolls back on error.
2. `GET /admin/online-store/preferences` returns the current value.
3. Nothing on the storefront reads it yet.

## Follow-up: what a real redirect needs

- A localization layer for the storefront (translated UI strings and, eventually, organizer-entered content per locale).
- The set of locales a store offers (likely `Organization.locales` + default).
- A redirect in `frontend/src/middleware.ts` (tenant hosts) or the storefront layout: when `autoRedirectLanguage` and the visitor's browser language matches an offered non-default locale, send them to that locale's path/subdomain — only "when available"; never redirect to a locale the store does not publish.
- Respect an explicit visitor choice (cookie) over the browser default after the first redirect.

## API Endpoints

Shares `GET` / `PATCH /admin/online-store/preferences` with [Online Store Preferences](online-store-preferences.md).

## Database

`Organization.autoRedirectLanguage` (boolean, default `false`).

## Gotchas

- Do not gate anything on this flag until locales exist — a `true` value with a single-language storefront must be a no-op.
- The toggle saves on click (no Save button), unlike the other two Preferences cards; the e2e test waits for the PATCH count rather than the switch state because the UI is optimistic.

## Related Features

- [Online Store Preferences](online-store-preferences.md)
- [Custom Domains](custom-domains.md) — where a tenant-host locale redirect would live
