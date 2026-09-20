# Account Settings › General

**Status:** Implemented (spec 030 feature A)
**Last Updated:** 2026-09-20

## Overview

Clicking the signed-in user's name / email at the bottom of the organization menu opens `/admin/account` — the person's own settings, not the organization's. General covers the profile photo, first / last name, email address (a verified change), phone number, preferred language and time zone. Nothing here changes with the org switcher, and nothing here affects what customers see on an online store. Security (`/admin/account/security`) is a placeholder until spec 030 features B (sign-in methods), C (two-step) and D (devices) land.

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/api/routes/account.js` | `/account` router. Router-level `requireAuth`; every handler acts on `req.user.id`. `POST /account/email/confirm` is mounted **before** `requireAuth` because the link may open signed out |
| `backend/src/services/AccountService.js` | `get`, `update` (rewrites `User.name` from the parts), `requestEmailChange` / `resendEmailChange` / `cancelEmailChange` / `confirmEmailChange`, `setAvatar`; `toJson` never serializes `Account.*_token` |
| `backend/src/api/validators/accountValidators.js` | `validateUpdateAccount` (whitelist `firstName`, `lastName`, `phone`, `locale`, `timeZone`; partial), `validateEmailChange`, `validateEmailConfirm`; `normalizePhone` (E.164 via `libphonenumber-js`, default region US) |
| `backend/src/utils/locales.js` ↔ `frontend/src/lib/locales.ts` | `SUPPORTED_LOCALES` (launch: `en-US` only) — **keep identical**; `tests/unit/locales.test.ts` diffs them |
| `backend/src/middleware/imageUpload.js` | `uploadAvatar` = `createImageUpload(5, 'avatar')` (multipart field name is now a parameter) |
| `backend/src/services/EmailService.js` | `sendEmailChangeConfirmation` (to the new address), `sendEmailChangedNotice` (to the old one) |
| `frontend/src/components/OrgSwitcher.tsx` | User block is a `Link` to `/admin/account` (`data-testid="org-switcher-account"`), shows the avatar from `session.user.image` |
| `frontend/src/app/admin/account/` | `layout.tsx` + `AccountNav` (General · Security), `page.tsx` (three cards), `PhotoCard`, `NameDialog`, `EmailDialog`, `PhoneDialog`, `LanguageDialog`, `TimeZoneDialog`, `accountApi.ts` (types + calls) |
| `frontend/src/app/auth/confirm-email/page.tsx` | Public landing page for the confirmation link (`?token=`) |
| `frontend/src/lib/timeZones.ts`, `frontend/src/lib/accountFormat.ts` | IANA options with live offsets; `useAccountFormat()` formats dates in the account's locale / zone |
| `frontend/src/auth.ts`, `lib/sessionClaims.ts`, `lib/authJwt.ts`, `types/next-auth.d.ts` | `locale`, `timeZone`, `picture` ride in the JWT claims → `session.user.locale` / `timeZone` / `image` |
| `frontend/src/components/AdminRoute.tsx` | Authentication follows `session` data, not `status`, so `useSession().update()` (status `'loading'` while it re-fetches) no longer unmounts the page |

## Configuration

No new environment variables. Rate limit `ACCOUNT_EMAIL_CHANGE` (5 / h per IP, `RATE_LIMIT_ACCOUNT_EMAIL_CHANGE_*` overrides) covers request + resend. Confirmation links use the first `FRONTEND_URL` entry (`platformBaseUrl()`).

## How It Works

### Data model

`User` gains `phone` (E.164), `locale` (default `en-US`), `timeZone` (IANA, `null` = browser default), `avatarImageId` (→ `Image`, `usageType: 'avatar'`), `pendingEmail`. Migration `20260930600000_account_general`. `User.image` (the Google picture URL) stays an untouched display fallback.

### Verified email change

1. `POST /account/email { email }` → normalize, reject the current address (400) or one another user holds (409 `EMAIL_TAKEN`) → write `pendingEmail`, replace the `VerificationToken` for identifier `email-change:<userId>` (sha256 of a 32-byte token, 1 h) → email the raw token to the **new** address.
2. The row shows "Pending confirmation: new@…" with *Resend* / *Cancel change*.
3. `POST /account/email/confirm { token }` (public) → hash lookup → expiry → uniqueness re-check → transaction swaps `email`, sets `emailVerified`, clears `pendingEmail`, deletes the token → notice to the **old** address. Single use.
4. The JWT `email` claim refreshes within 60 s (`sessionClaims.ts`); the confirmation page calls `update()` when the user is signed in there.

### Photo

`POST /account/avatar` (multipart `avatar`) → `ImageService.processUpload(…, 'avatar')` (MIME sniffed, variants generated) → `setAvatar` → old `Image` deleted after the new one is saved. `DELETE /account/avatar` removes it. The JWT `picture` claim is `/images/<id>/<hash>/thumb` (resolved with `resolveAssetUrl`), else `User.image`.

### Preferences

`locale` must be in `SUPPORTED_LOCALES`; `timeZone` is validated with `Intl.DateTimeFormat`. Both are copied into the JWT so `useSession()` exposes them; `useAccountFormat()` is the helper new admin code should use for dates. Copy on the page: *"When you're logged in to Jump, this is the language you'll see. It doesn't affect the language your customers see on your online store."* / *"This is the time zone for your account. It's used for the dates and times you see in Jump."*

## Testing

- `backend/tests/unit/accountValidators.test.js` — whitelist, phone / locale / zone normalization, `displayName`.
- `backend/tests/contract/account.test.js` — 12 cases: no token leak, partial PATCH, foreign id ignored, email pending → confirm → notice, resend / cancel, expired, contested at confirm, photo upload / replace / remove, bad uploads.
- `frontend/tests/unit/{locales,timeZones,sessionClaims}.test.ts`.
- `frontend/e2e/account-general.spec.ts` — org-menu entry, each dialog, pending email state, photo removal, axe.

## Gotchas

- Never accept a user id on `/account/*`; the subject is `req.user.id`. Admin edits of other people stay on `/users` (roles only).
- `/account/*` on a **custom domain** is the buyer account (`storefrontHost.ts`); the confirmation page therefore lives under `/auth/confirm-email` on the platform host.
- `api.ts` now passes the backend `code` (e.g. `EMAIL_TAKEN`) through on thrown errors.
- Additional languages need an i18n layer; adding a code to `SUPPORTED_LOCALES` without translations only changes `Intl` formatting.

## Related

- Spec: `specs/030-account-settings/spec.md`, plan `plan-general.md`
- [Org Switcher](org-switcher.md) — JWT claims refresh that carries the new preferences
- [Organization Branding](organization-branding.md) — the org logo pipeline the avatar reuses
