# Implementation Plan: Account settings › General (spec 030, feature A)

**Status**: Planned (2026-09-20). Not implemented.
**Branch / worktree**: `feat/030-account-general` at `.claude/worktrees/030-account-general`, based on `main`.
**Spec**: [`spec.md`](./spec.md) §4–§5. **Blocks**: B, C, D (they mount on the shell and router built here).
**Dependencies**: `libphonenumber-js` (frontend + backend). Nothing else new.

---

## 1. What exists and is reused

| Piece | Where | Reuse |
|---|---|---|
| Org menu user block | `frontend/src/components/OrgSwitcher.tsx` (name + email `<div>`, initials avatar) | Becomes the link to `/admin/account`; shows the avatar image when one exists |
| Settings shell | `frontend/src/app/admin/settings/SettingsNav.tsx`, `SummaryRow.tsx`, `SettingsDialog.tsx`, per-card dialogs (`BusinessDetailsDialog.tsx`) | Copy the layout for an `AccountNav` + summary cards + edit dialogs |
| Admin guard | `frontend/src/components/AdminRoute.tsx`, `frontend/src/middleware.ts` (`/admin` prefix) | `/admin/account*` is protected without changes |
| JWT claims refresh | `frontend/src/auth.ts` `loadUserClaims`, `frontend/src/lib/sessionClaims.ts` (60 s) | Add `locale`, `timeZone`, `image` to the claims so the UI reads them from `useSession()` |
| Image pipeline | `backend/src/services/ImageService.js` (`processUpload(buffer, name, mime, usageType)`, `deleteImage`), `middleware/imageUpload.js` (multer, 5 MB, MIME allowlist; field name `logo`), org logo handlers in `routes/organizations.js` | Avatar upload / delete are the same three steps as the org logo. `createImageUpload` gets a field-name parameter (default `logo`) so `avatar` works |
| Email | `backend/src/services/EmailService.js` + Resend | `sendEmailChangeConfirmation`, `sendEmailChangedNotice` |
| Magic-link tokens | `VerificationToken` (`identifier`, `token`, `expires`) | Email-change tokens use `identifier = 'email-change:<userId>'`, `token = sha256(raw)` |
| Partial PATCH validator | `validateUpdateBusinessDetails` in `backend/src/api/validators/organizationValidators.js` | Same whitelist + per-key rules shape for `validateUpdateAccount` |
| Rate limiter | `backend/src/middleware/rateLimit.js` `makeLimiter` | `ACCOUNT_EMAIL_CHANGE` (5 / h per IP) |
| API client | `frontend/src/services/api.ts` (`request`, `upload(endpoint, formData)`) | `api.account.*` methods |
| E2E session | `frontend/e2e/helpers/session.ts` `signInAsStaff` | `account-general.spec.ts` |

## 2. Schema

```prisma
model User {
  // …existing
  phone         String?          // E.164
  locale        String   @default("en-US")
  timeZone      String?          // IANA; null = browser default
  avatarImageId String?  @unique
  pendingEmail  String?          // awaiting confirmation; cleared on confirm / cancel / expiry
  avatarImage   Image?   @relation("UserAvatar", fields: [avatarImageId], references: [id])
}
model Image { /* … */ userAvatars User[] @relation("UserAvatar") }
```

Migration `030_account_general`. `db push` on the dev DB (memory: dev syncs with `db push`; run `db:backfill:024` first if still pending).

## 3. Backend

### 3.1 Router `backend/src/api/routes/account.js` — mounted `app.use('/account', accountRouter)` before `/users`
Router-level `requireAuth`. **No `:userId` anywhere; subject is always `req.user.id`.**

| Method | Path | Validator | Service call | Notes |
|---|---|---|---|---|
| GET | `/account` | — | `AccountService.get(userId)` | `{ id, email, pendingEmail, emailVerified, firstName, lastName, name, phone, locale, timeZone, avatar: { id, urls } \| null, imageFallbackUrl, providers: [{ provider }] , supportedLocales, createdAt }` — `providers` here is read-only inventory; B adds management |
| PATCH | `/account` | `validateUpdateAccount` | `AccountService.update(userId, patch)` | Keys: `firstName`, `lastName`, `phone`, `locale`, `timeZone`. Unknown key → 400. `phone: null` removes |
| POST | `/account/email` | `validateEmailChange` | `AccountService.requestEmailChange(userId, email)` | 409 `EMAIL_TAKEN` if another user has it; sends confirmation to the new address; limiter `ACCOUNT_EMAIL_CHANGE` |
| POST | `/account/email/resend` | — | `resendEmailChange` | Same limiter |
| DELETE | `/account/email/pending` | — | `cancelEmailChange` | |
| POST | `/account/email/confirm` | `{ token }` | `confirmEmailChange(token)` | **No auth required** (the link may open in another browser); token identifies the user. 400 `TOKEN_INVALID` / `TOKEN_EXPIRED`, 409 `EMAIL_TAKEN` re-checked |
| POST | `/account/avatar` | `createImageUpload(5, 'avatar')` | `ImageService.processUpload(…, 'avatar')` then `AccountService.setAvatar(userId, imageId)` | Deletes the previous `Image` after the new one is saved (org-logo pattern) |
| DELETE | `/account/avatar` | — | `setAvatar(userId, null)` | |

### 3.2 `backend/src/services/AccountService.js`
- `update`: trims names, rewrites `name = [firstName, lastName].filter(Boolean).join(' ') || null`; `phone` parsed with `libphonenumber-js` `parsePhoneNumber(value, 'US')` → `.number` or 400 `PHONE_INVALID`; `locale` must be in `SUPPORTED_LOCALES` (`backend/src/utils/locales.js`, mirrored in `frontend/src/lib/locales.ts` — keep identical like `fees.ts`); `timeZone` validated with `new Intl.DateTimeFormat('en', { timeZone })` in try/catch.
- `requestEmailChange`: normalize (lowercase, trim), reject if equal to current, 409 if `user.findUnique({ email })` hits, write `pendingEmail`, insert `VerificationToken { identifier: 'email-change:<userId>', token: sha256(raw), expires: now + 1 h }` (delete older ones for that identifier first), send the raw token in the link `${FRONTEND_URL}/account/confirm-email?token=…`.
- `confirmEmailChange`: find by hash + not expired → transaction: re-check uniqueness, `update({ email: pendingEmail, emailVerified: now, pendingEmail: null })`, delete token; then `sendEmailChangedNotice(oldEmail, newEmail)`. Returns `{ email }`.
- `setAvatar`: `update({ avatarImageId })`, returns `{ user, previousAvatarImageId }`.
- Serializer `toAccountJson(user)`: never returns `Account.*_token` fields; `providers` = `accounts.map(a => ({ provider: a.provider }))`.

### 3.3 Validators `backend/src/api/validators/accountValidators.js`
`ACCOUNT_FIELDS = new Set(['firstName','lastName','phone','locale','timeZone'])`; per-key rules; names 1–80 (or `null`), strings only. `validateEmailChange`: RFC-ish email, ≤ 254.

### 3.4 `EmailService`
`sendEmailChangeConfirmation({ to, confirmUrl, currentEmail })`, `sendEmailChangedNotice({ to: oldEmail, newEmail })`. Plain Jump-branded templates like `sendBuyerLoginEmail`.

## 4. Frontend

### 4.1 Entry
`OrgSwitcher.tsx`: the user block becomes `<Link href="/admin/account" data-testid="org-switcher-account">` with the avatar `<img>` (from `session.user.image`) or initials, name, email and a small "Manage account" caption; closes the menu on click.

`auth.ts` `loadUserClaims` selects `firstName`, `lastName`, `locale`, `timeZone`, `avatarImage.file.hash` → claims `name`, `locale`, `timeZone`, `picture` (avatar `thumbnail` URL, else `User.image`). `sessionClaims.ts` `UserClaims` / `applyUserClaims` gain `locale`, `timeZone`, `picture`; `authJwt.ts` `encodeSessionToken` includes them; `session` callback copies to `session.user.locale` / `timeZone` / `image`. Typing in `frontend/src/types/next-auth.d.ts` (create if absent).

### 4.2 Pages
- `frontend/src/app/admin/account/layout.tsx` — `AccountNav` (General · Security) + `<main>`; heading "Account". Security is a stub link until B lands (route exists, renders "Coming soon" card so nav is stable across the four worktrees).
- `frontend/src/app/admin/account/page.tsx` — three cards with `SummaryRow`s:
  1. **Profile photo** — avatar (or initials), *Upload photo* / *Replace* / *Remove* (confirm). Reuses `ImageUploader` with `label="photo"`.
  2. **Personal information** — First name, Last name, Email (with pending state: "Pending confirmation: new@… · Resend · Cancel"), Phone. Each row *Edit* opens a `SettingsDialog` (`NameDialog`, `EmailDialog`, `PhoneDialog`) that PATCHes only its keys.
  3. **Preferences** — Preferred language (`select` over `SUPPORTED_LOCALES`, copy from spec §5.3), Time zone (`TimeZoneSelect`: searchable list from `Intl.supportedValuesOf('timeZone')`, grouped by region, shows `GMT±hh:mm`, first option "Browser default (<zone>)"). Saves on dialog Save, not on change.
- `frontend/src/app/account/confirm-email/page.tsx` — public page (outside `/admin`): posts the token, shows success ("Your email is now …; sign in again if you were signed out") or the error. Wrapped in `<Suspense>` (uses `useSearchParams`).
- After any save: `useSession().update()` so the JWT claims refresh immediately (spec 022 pattern) and the org menu / formatting react without waiting 60 s.

### 4.3 Formatting helper
`frontend/src/lib/accountFormat.ts` — `formatDateTime(date, { locale, timeZone })` + `useAccountFormat()` (reads `useSession()`; falls back to browser). Adopt it on the General page only in this feature; migrating the rest of the admin's date rendering is a follow-up (§8).

### 4.4 `api.ts`
`api.account.get()`, `.update(patch)`, `.requestEmailChange(email)`, `.resendEmailChange()`, `.cancelEmailChange()`, `.confirmEmailChange(token)` (no auth header), `.uploadAvatar(file)` (FormData `avatar`), `.removeAvatar()`.

## 5. Env / config
None new. `FRONTEND_URL` (first entry) builds the confirmation link, as buyer login links do.

## 6. Tests
- **Unit** (`backend/tests/unit/accountValidators.test.js`, `AccountService.test.js`): whitelist rejects unknown keys; phone normalization (`(919) 555-0100` → `+19195550100`, invalid → 400); locale / timeZone validation; `name` rewrite; email-change token hash + expiry.
- **Contract** (`backend/tests/contract/account.test.js`): GET returns no token fields; PATCH partial; POST email → pending + 409 on taken; confirm swaps + notifies; confirm with expired token 400; avatar upload replaces and deletes the old image; another user's id in the body is ignored.
- **Frontend unit** (`frontend/src/lib/__tests__/locales.test.ts`): `SUPPORTED_LOCALES` identical to the backend fixture.
- **E2E** (`frontend/e2e/account-general.spec.ts`, `signInAsStaff` + `page.route` stubs): org menu link → General; name dialog save; email change pending state; time zone select; photo remove confirm.

## 7. Delivery slices
1. Schema + `AccountService` + router + `GET/PATCH /account` + contract tests.
2. Entry link, `AccountNav`, General page cards (name, phone, preferences), JWT claims + `update()`.
3. Email change flow (backend + dialog + confirm page + emails).
4. Avatar upload / remove + org-menu avatar.
5. Docs: `docs/wiki/features/account-settings.md` (`/doc-feature`), `backend/AGENTS.md` note ("account routes: subject is always `req.user.id`"), `specs/STATUS.md`.

## 8. Follow-ups (not in this worktree)
- Adopt `useAccountFormat()` across admin lists (orders, tickets, analytics) once spec 021 decides store-vs-account time zone display rules.
- Additional locales need an i18n layer (new spec).
- UNASSIGNED users reaching `/admin/account` (spec §9.4).
