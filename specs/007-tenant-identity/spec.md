# Feature Specification: Per-Organization Buyer Identity, Checkout Account Opt-In, and White-Label Custom Domains

**Feature Branch**: `007-tenant-identity` | **Created**: 2026-09-12 | **Status**: Draft (not scheduled)
**Decision record**: Obsidian vault `10_Personal/10_Projects/jump--decision--tenant-identity-custom-domains.md`

## Problem

Jump will let organizations point their own domain at the platform (Shopify-style) so ticket buyers purchase under the organization's brand. Before that can happen, buyer identity must be structurally isolated per organization. Today buyers are a single global `Contact` row keyed by email, which already leaks data between organizations:

- `Contact.note` written by org A staff is visible to org B staff for the same buyer.
- `Contact.emailSubscribed` is one flag. Unsubscribing from org B silently stops org A's emails. Consent is legally per sender.
- `Contact.emailSubscribed` defaults to `true` and no checkout consent checkbox exists, so every buyer is auto-subscribed.
- Staff (`User`) can belong to only one organization (`User.organizationId`).

## Decisions (already made)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Buyers are **never** `User` rows. Buyer = `Contact`, scoped per organization: `@@unique([organizationId, email])`. | Row-level tenancy gives the segmentation without per-org schemas. Same email at two orgs is two records, two histories, two consent flags. |
| D2 | Staff remain global `User` rows; org affiliation moves to an `OrganizationMember` join table. | One human can run several orgs. Staff log in on the Jump admin domain only, never on custom domains. |
| D3 | Buyer authentication is **passwordless only** (magic link, later 6-digit code). No passwords. No OAuth on custom domains. | Per-org accounts plus passwords means one password per venue. OAuth redirect URIs cannot be registered for N tenant domains. |
| D4 | Checkout gets a "Create an account with `<Org>`" checkbox, **default checked**. Checking it marks the same `Contact` row as login-enabled. No extra step. | Account for a purchased ticket rests on contract performance (GDPR Art. 6(1)(b)), so a pre-ticked box is permitted. Condition: the box creates only the account and triggers only transactional email. |
| D5 | Marketing consent is a **separate** checkbox, **always default unchecked**. | Pre-ticked consent is invalid under GDPR, ePrivacy, CASL. Do not vary by region. |
| D6 | No global cross-org buyer identity now. May add an opt-in `BuyerIdentity` layer later (Shop Pay model). | Orgs treat their customer list as their asset and expect isolation. |

## User Scenarios

### Buyer

1. **Guest checkout (unchanged)**: buyer unchecks the account box, pays, receives confirmation email with order lookup link. A `Contact` row exists for order ownership but is not login-enabled.
2. **Account at checkout**: buyer leaves the box checked, pays. Confirmation email contains "Manage your tickets" magic link. Clicking it signs the buyer in on the org's storefront (Jump domain now, custom domain later) and shows only that org's orders.
3. **Return visit**: buyer visits org storefront, enters email, receives magic link, sees their orders and tickets for that org only.
4. **Same buyer, second org**: same email checks out at org B. A separate `Contact` row is created for org B. Org A's notes, consent, and history are untouched.
5. **Marketing consent**: buyer must actively tick the marketing box. Unsubscribing affects that org only.

### Organization staff

6. **Multi-org staff**: one `User` is ADMIN at org A and ORGANIZER at org B. Admin UI shows an org switcher; all admin queries scope to the active org.
7. **Customers page**: lists only this org's `Contact` rows, with this org's notes and consent flags.
8. **Custom domain setup** (later phase): org enters `tickets.example.com`, receives CNAME + TXT records, Jump verifies, storefront serves on that host with org branding. Optional: org verifies their sending domain so confirmation emails come from `tickets@example.com`.

### Platform

9. **SYSTEM_ADMIN**: unchanged; unscoped view across all orgs.

## Functional Requirements

- **FR-1** `Contact` MUST carry `organizationId`; uniqueness MUST be `(organizationId, email)`, not `email`.
- **FR-2** Existing contacts MUST be backfilled by splitting each global contact into one row per organization it has orders with (any order status), repointing `Order.contactId` and `Ticket.contactId` accordingly.
- **FR-3** `Contact.accountCreatedAt` (nullable) marks a login-enabled buyer. Null = guest.
- **FR-4** Checkout MUST render two independent checkboxes: account (default checked) and marketing (default unchecked). Neither MUST imply the other.
- **FR-5** `Contact.emailSubscribed` default MUST change to `false`. Existing rows keep their current value (no retroactive consent change without legal review).
- **FR-6** Buyer login MUST be a single-use, time-limited, hashed token delivered by email, scoped to one organization. Sessions MUST be a separate cookie from the staff Auth.js session and MUST encode `{ contactId, organizationId }`.
- **FR-7** Buyer-facing "my orders" and ticket endpoints MUST authorize by buyer session `contactId`, never by email equality across the `User` table.
- **FR-8** `OrganizationMember(userId, organizationId, role)` MUST replace `User.organizationId` for ADMIN/ORGANIZER scoping. `resolveOrgScope` MUST read from it.
- **FR-9** Staff Auth.js JWT MUST carry the active `organizationId`; an org switcher MUST exist when a user has more than one membership.
- **FR-10** (Custom domains) `OrganizationDomain(hostname unique, organizationId, status, verificationToken)` MUST resolve the request host to an organization on storefront routes. Admin routes MUST 404 on custom hosts.
- **FR-11** (Custom domains) Storefront URLs in emails and Stripe success/cancel redirects MUST be built from the org's primary verified domain when one exists.
- **FR-12** Buyer login request endpoint MUST be rate limited per email and per IP.

## Non-Goals

- Passwords for buyers.
- Cross-org buyer dashboard.
- Migrating staff login to custom domains.
- Retroactively unsubscribing existing contacts.

## Success Criteria

- Org A staff cannot see any note, consent flag, or order belonging to the same email at org B (verified by contract test).
- A buyer who checked the box at checkout can open the confirmation email link and see their orders with no password prompt.
- Backfill runs idempotently against a production snapshot with zero orphaned `Order`/`Ticket` rows and row counts reconciled.
- Every existing admin route behaves identically for single-org staff after the membership migration.
