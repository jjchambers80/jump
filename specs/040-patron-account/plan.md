# Spec 040 — Implementation plan

**Spec**: [spec.md](./spec.md)
**Cards**: 040A → 040B → 040C → 040D. Each is its own worktree and PR, merged in order; rebase the next card on `main` after each merge (stacked-merge lesson from specs 012 and 033).

## 040A — Account shell (no behaviour change)

- `frontend/src/app/organizations/[orgId]/account/layout.tsx`: sign-in gate + sign-in form moved out of `page.tsx`, nav (tabs on phones, sidebar at `lg`), `BrandScope` with `themeMode`.
- Split the 511-line `page.tsx` into `frontend/src/components/account/{SignInForm,TicketsList,OrdersList}.tsx`; `ApplicationsSection` / `ApplicantProfileSection` move under `/account/applications`.
- Routes: `account/page.tsx` (overview = upcoming tickets), `account/orders/page.tsx`, `account/applications/page.tsx`. Existing `account/verify` unchanged.
- Hide the Applications tab when `GET /buyer/me/applications` is empty.
- Update existing Playwright specs that open the account page; add one nav spec (phone + desktop, assertions scoped to the visible nav copy — Gotcha 11).

## 040B — Profile, email, RSVPs, receipts, preferences, unsubscribe, sign-out-everywhere

**Schema** (`packages/db/prisma/schema.prisma`, one migration):
- `Contact.buyerSessionsValidAfter DateTime?`
- `BuyerTokenPurpose` + `EMAIL_CHANGE`, `DELETE_CONFIRM`; `BuyerLoginToken.payload Json?`
- `EmailSubscribedSource` + `ACCOUNT` (`LegalSource.ACCOUNT` already exists)

**Backend**:
- New `backend/src/services/BuyerAccountService.js`: `updateProfile`, `requestEmailChange`, `confirmEmailChange`, `listRsvps`, `cancelRsvp`, `setMarketing`, `revokeAllSessions`.
- New `backend/src/validators/buyerAccountValidators.js`: partial whitelist for `PATCH /buyer/me` (pattern: `validateUpdateBusinessDetails`).
- Routes in `backend/src/api/routes/buyerAuth.js`: `PATCH /me`, `POST /me/email`, `POST /me/email/confirm`, `GET /me/rsvps`, `POST /me/rsvps/:id/cancel`, `PATCH /me/preferences`, `POST /me/sessions/revoke-all`, `GET|POST /unsubscribe`.
- `ContactOptInService.buyerMarketingChange()` beside `marketingChangeData()`; writes the `LegalAcceptance` through `LegalAcceptanceService` on opt-in.
- `middleware/buyerAuth.js`: load `buyerSessionsValidAfter` and refuse older `iat` with 401 `SESSION_REVOKED`.
- `utils/unsubscribeToken.js`: HMAC sign/verify (`AUTH_SECRET`), `listUnsubscribeHeaders(contact)`.
- RSVP cancel reuses `RsvpService.cancel` internals keyed by id + contact instead of token.
- Email templates in `EmailService`: email-change confirm (new address), email-change notice (old address).
- Timeline entries through `CustomerTimelineService` for profile edits and account opt-in/out.

**Frontend**:
- Proxies `frontend/src/app/api/buyer/me/{profile,email,email/confirm,rsvps,rsvps/[id]/cancel,preferences,sessions/revoke-all}` and `api/buyer/unsubscribe`, pattern of the existing `api/buyer/me/*` handlers (`lib/buyerSession.ts`); a 401 `SESSION_REVOKED` clears the cookie.
- Pages `account/profile`, `account/preferences`, `account/rsvps`, `account/orders/[orderId]/receipt`, `account/email-confirm`, `account/unsubscribe`.
- Receipt renders from `GET /orders/:orderId` (buyer session already authorized) with print CSS and a Print button.
- Event dates via `formatEventDateTime` with the venue zone (Gotcha 28).

**Tests**: contract `backend/tests/contract/buyerAccount.test.js` (whitelist, email change + 409, preferences + acceptance row, unsubscribe token forgery + One-Click POST, revoke-all refuses old JWT, RSVP cancel scoped to own contact); Playwright profile save, preferences toggle, receipt page.

## 040C — Download my data + staff export

- `backend/src/services/BuyerDataExportService.js`: `build(organizationId, contactId)`; every query filtered by both ids.
- `GET /buyer/me/export` (attachment); limiter `BUYER_EXPORT` via `makeLimiter` in `middleware/rateLimit.js`, keyed by contact id, 3/day.
- `GET /admin/customers/:contactId/export` (ADMIN, `activeOrgFor(req)`), button on `frontend/src/app/admin/customers/[contactId]/page.tsx`.
- `account/privacy/page.tsx` with Download my data and Sign out of all devices (from 040B).
- **Tests**: contract — same email seeded at two orgs, export contains only this org's rows; no `qrCodeJwt`, no Stripe secrets; staff export needs ADMIN and the active org.

## 040D — Delete my data + staff anonymize + sweep

**Schema**: `Contact.erasureScheduledAt DateTime?`, `Contact.anonymizedAt DateTime?`; model `ErasureSuppression { id, organizationId, emailHash, createdAt, @@unique([organizationId, emailHash]) }`; timeline event types `ERASURE_SCHEDULED`, `ERASURE_CANCELLED`, `ANONYMIZED`.

**Backend** — `backend/src/services/ContactErasureService.js`:
- `preview(organizationId, contactId)` → `{ ticketsToVoid, applicationsToWithdraw, rsvpsToCancel, blockers }`.
- `request` (blockers → 409; else `DELETE_CONFIRM` code email), `confirm` (schedules `now + ERASURE_GRACE_DAYS`, email with cancel link), `cancel`.
- `erase(organizationId, contactId, { actor })`: re-check blockers; void tickets and release capacity through a helper factored out of `RefundService` (the ticket-void + tier/add-on release blocks at ~lines 120, 401, 632) with no `Refund` row, `AddOnService.release` for add-ons (Gotcha 16); `ApplicationService.withdrawByApplicant` with reason `erasure`; cancel RSVPs; anonymize per spec §PA-16; delete the Stripe Customer (tests stub the Stripe client, no network); write `ErasureSuppression` (hash with `LEGAL_IP_SALT` → `AUTH_SECRET` fallback); final email to the captured address.
- Sweep `runErasureSweep` registered in `server.js` beside the other sweeps (`ERASURE_SWEEP_INTERVAL_MS`, default 1 h); also purges `BuyerLoginToken` past `expiresAt + 7 d`.
- `BuyerAuthService.requestLink` / `verify*`: anonymized contacts never get a link or session.
- Staff route `POST /admin/customers/:contactId/anonymize` (ADMIN + `requireRecentAuth`).

**Frontend**: privacy page delete flow (preview list, checkbox, code entry, grace banner with Cancel deletion shown in the account layout); staff Anonymize dialog with typed confirmation wrapped in `withReauth`.

**Tests**: contract — blockers 409; confirm schedules; cancel clears; sweep voids tickets and restores `quantitySold`, anonymizes, keeps order totals and the tax report unchanged; suppression row written; anonymized contact gets no sign-in link; staff anonymize requires ADMIN and recent auth. Unit — anonymization field map, suppression hash.

## Docs (after 040D)
- `/doc-feature`: update `docs/wiki/features/buyer-accounts.md`, add `docs/wiki/features/patron-privacy.md`.
- Root `AGENTS.md`: Gotcha "Contact erasure goes only through `ContactErasureService`; never delete a Contact row"; env vars `ERASURE_SWEEP_INTERVAL_MS`, `ERASURE_GRACE_DAYS`.
- `specs/STATUS.md` row for 040.

## Verification
- `cd backend && npm test`; `cd frontend && npm run test && npx tsc --noEmit -p .`.
- Manual: seeded buyer at `/organizations/{orgId}/account` → every tab; export and read the JSON; schedule deletion with `ERASURE_GRACE_DAYS=0`, run the sweep, check tickets `VOIDED`, capacity restored, Contact tombstoned, `/admin/orders` money unchanged.
- CI (`ci.yml`, `e2e.yml`) green on every PR.
