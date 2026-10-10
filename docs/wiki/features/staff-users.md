# Settings › Users — adding staff

**Status:** Implemented
**Last Updated:** 2026-10-08

## Overview

An organization admin adds people from **Settings › Users › Add users**. They enter one or more email addresses, pick a role (Admin or Organizer) and choose whether a **secure sign-in method** is required. Each person gets an email with a sign-in link. They show as **Pending** until their first sign-in.

The list shows the active organization's staff only. Admins can change a member's role, require two-step, resend a pending invite, remove someone from the organization, or deactivate a user who belongs to this organization alone.

There is no invite table and no accept token. Jump creates the `User` row (by email) and the `OrganizationMember` row up front. The magic-link and Google providers already sign in to an existing User. A member is **Pending** while `OrganizationMember.invitedAt` is set and the user has no `UserSession` yet.

Shopify-style channels (POS-only users) don't exist in Jump, so there is no user-type choice.

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/services/MemberService.js` | `list`, `invite`, `update`, `remove`, `resend`, `_syncGlobalRole` |
| `backend/src/api/routes/admin.js` | `GET/POST /admin/settings/users`, `PATCH/DELETE /admin/settings/users/:userId`, `POST …/:userId/resend`. Scoped by `activeOrgFor` |
| `backend/src/api/validators/memberValidators.js` | Invite body (1–20 emails, `ADMIN`/`ORGANIZER`, boolean `requireTwoStep`); partial PATCH whitelist |
| `backend/src/services/EmailService.js` | `sendStaffInvite`: Eventimus-branded (platform sender and colors, no store logo), subject "<Org> invited you to Eventimus", link to `/auth/signin?callbackUrl=/admin&invite=<orgId>&email=<invitee>` |
| `frontend/src/app/auth/signin/page.tsx` | With `invite`, shows "Join <Org> on Eventimus" (Eventimus logo only; org name from `GET /organizations/:id/public/meta`, never from the query) and prefills `email` |
| `backend/src/middleware/auth.js` | `twoStepSetup: 'required'` → 403 `TWO_STEP_SETUP_REQUIRED` outside `/account`, `/auth`, `GET /organizations` |
| `backend/src/api/routes/twoStep.js` | `POST /disable` → 409 `TWO_STEP_REQUIRED_BY_ORGANIZATION` while a membership requires it |
| `frontend/src/app/admin/settings/users/page.tsx` | The list: status filter, role select, resend / remove |
| `frontend/src/app/admin/settings/users/new/page.tsx` | The Add users form |
| `frontend/src/auth.ts`, `auth.config.ts`, `lib/sessionClaims.ts` | `twoStepSetup` claim, from any membership with `requireTwoStep` while `twoStepEnabledAt` is null, refreshed every 60 s and on `update()` |
| `frontend/src/middleware.ts` | `/admin*` except `/admin/account*` → `/admin/account/security?required=two-step` |
| `frontend/src/services/api.ts` | 403 `TWO_STEP_SETUP_REQUIRED` → the same page |

## Rules

- **Two roles, two places.** `OrganizationMember.role` is the per-org role. `User.role` is the global claim RBAC middleware reads. Every invite, role change and removal re-derives `User.role` from the memberships: any ADMIN membership makes the user ADMIN, any membership makes them ORGANIZER, none leaves them UNASSIGNED, and SYSTEM_ADMIN is never touched. `requireAdmin` alone is not enough here: a global ADMIN who is only ORGANIZER in the active org gets 403.
- **Guards.** You can't change your own role or status or remove yourself. The last ADMIN of an organization can't be demoted or removed (409). Deactivating signs a user out of all of Jump, so it is refused when they belong to another organization; remove them instead.
- **Existing users** keep their account. Inviting an email that already exists adds a membership. Emails that are already members are reported back as `alreadyMember` and get no email.
- **Brand by where the button lands.** Staff email (invite, sign-in link, security, application digest, dispute alerts) opens the Eventimus admin, so it is platform-branded and names the org in the copy. Digest and dispute alerts call `sendApplicationMessage({ ..., staff: true })`. Buyer, applicant and RSVP email opens the storefront and stays store-branded.
- **Email failures never roll back.** They are returned as `emailFailed`; use **Resend invite**.
- **Secure sign-in.** Any membership with `requireTwoStep` and no two-step on puts the user in setup mode. In setup mode only Account pages and the account API work until they turn it on. Enabling it calls `update({ mfaProof })`, which refreshes the claims at once.
- The legacy `GET/PATCH /users` stays for SYSTEM_ADMIN tools; the Settings page no longer calls it.

## Tests

- `backend/tests/contract/members.test.js`
- `frontend/e2e/admin-settings.spec.ts` (Users tests)
- `frontend/e2e/account-two-step.spec.ts` ("required by an organization")
- `frontend/tests/unit/sessionClaims.test.ts`
