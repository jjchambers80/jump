# Feature Specification: Tenant Identity, Buyer Accounts, and White-Label Custom Domains

**Feature Branch**: `feat/007-custom-domains` (phases 1-3), `feat/007-phase4-cleanup`  
**Created**: 2026-09-12  
**Status**: Implemented — all 3 phases on origin/main  
**Post-spec changes**: Phase 4 removed buyer-as-User remnants; `OrganizationMember` replaces `User.organizationId`; `SettingsNav` moved to its own component; checkout opt-in defaults stayed default-checked per plan.
**Input**: "Organizations will point their own domain at Jump so they fully own the brand. Buyer accounts should be structurally associated with the organization so accounts at org A and org B stay separate. Checkout should offer a checkbox that automatically registers the buyer's account, checked by default unless that creates GDPR or liability exposure."


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

## User Scenarios & Testing _(mandatory)_

### User Story 1 — Guest checkout (Priority: P1)

A buyer purchases tickets as a guest without creating an account. They uncheck the account-creation checkbox, pay via Stripe, and receive a confirmation email with an order lookup link. A Contact row is created for order ownership but is not login-enabled.

**Why this priority**: Guest checkout is the existing baseline flow; the new account-creation checkbox must not break it. Every existing customer depends on this.

**Independent Test**: Complete a checkout with the account checkbox unchecked. Verify the order completes, tickets are issued, and the Contact has `accountCreatedAt: null`. Attempt to log in with that email — the system must reject the magic-link request with "No account found."

**Acceptance Scenarios**:
1. **Given** a published event with available tickets, **When** a buyer completes checkout with the account checkbox unchecked, **Then** the order completes, tickets issue, and `Contact.accountCreatedAt` remains null.
2. **Given** a guest checkout, **When** the buyer attempts to log in via the storefront magic-link form, **Then** the system responds "No account found with that email" (no token issued).
3. **Given** a guest checkout, **When** the buyer uses the order lookup link from the confirmation email, **Then** they can still access their order without authentication.

---

### User Story 2 — Account creation at checkout (Priority: P1)

A buyer purchases tickets and leaves the account-creation checkbox checked (its default). The order completes normally. The confirmation email contains a "Manage your tickets" magic link. Clicking it signs the buyer in on the organization's storefront without a password. The buyer sees only that organization's orders and tickets.

**Why this priority**: This is the new core workflow — passwordless buyer accounts that Just Work from the purchase flow.

**Independent Test**: Complete a checkout with the account checkbox checked. Open the magic link from the confirmation email. Verify the buyer session is established and shows the correct organization's orders.

**Acceptance Scenarios**:
1. **Given** a buyer completes checkout with the account checkbox checked, **When** the confirmation email is sent, **Then** it contains a "Manage your tickets" magic link (a WELCOME-token URL) in addition to the standard order lookup link.
2. **Given** a buyer clicks the magic link within 7 days of purchase, **When** the token is consumed, **Then** the buyer is signed in and sees their order list for that organization.
3. **Given** a buyer has purchased from two organizations (org A and org B), **When** they sign in from org A's storefront, **Then** they see only org A's orders.
4. **Given** a buyer clicks an already-used magic link, **When** the token is checked, **Then** the system rejects it with "This link has already been used."

---

### User Story 3 — Return visit with magic-link login (Priority: P1)

A buyer who previously created an account returns to the organization's storefront. They enter their email on the sign-in page, receive a magic link (LOGIN token), and click it to sign in. They see their orders and tickets without re-entering any information.

**Why this priority**: Passwordless return visits are essential for buyer retention. Without this, buyers would need to remember an order reference every time.

**Independent Test**: From a storefront, request a magic link for an email that has a login-enabled Contact. Verify the email arrives, the token works once, and the session grants access to the correct organization's data.

**Acceptance Scenarios**:
1. **Given** a return buyer on an organization's storefront, **When** they enter their email on the sign-in form, **Then** a magic link is emailed to them within 5 seconds.
2. **Given** a LOGIN token is requested, **When** the buyer clicks the link within 15 minutes, **Then** they are signed in and see their orders for that organization.
3. **Given** a return visitor, **When** they attempt to sign in with an email that exists only as a guest Contact (no account), **Then** the system shows "No account found" — guest contacts cannot log in.
4. **Given** a buyer requests a magic link, **When** they make more than 3 requests within 1 minute from the same IP, **Then** subsequent requests are rate-limited.

---

### User Story 4 — Marketing consent checkbox (Priority: P2)

A buyer sees two independent checkboxes at checkout: "Create an account with [Organization]" (default checked) and "Send me marketing news" (default unchecked). Neither implies the other. Marketing consent is scoped per organization: unsubscribing from org A's emails does not affect org B.

**Why this priority**: Marketing consent with a pre-ticked box is invalid under GDPR/ePrivacy/CASL. This is a legal requirement, not a UI nicety.

**Independent Test**: Complete a checkout with only one checkbox checked (account, not marketing). Verify `Contact.emailSubscribed` is false. Then complete another checkout at the same organization with marketing checked — verify the same Contact gets `emailSubscribed: true`, scoped to that organization only.

**Acceptance Scenarios**:
1. **Given** a checkout page, **When** it renders, **Then** it shows two independent checkboxes: "Create an account" (default checked) and "Send me marketing news" (default unchecked).
2. **Given** a buyer checks only the account box, **When** the order completes, **Then** `Contact.emailSubscribed` is false.
3. **Given** a buyer checks both boxes at organization A, **When** they later unsubscribe from organization A's emails, **Then** org A's consent flag flips to false but org B's is unaffected.
4. **Given** an existing Contact from before spec 007, **When** the backfill runs, **Then** their `emailSubscribed` keeps its current value (no retroactive change).

---

### User Story 5 — Multi-organization staff (Priority: P1)

A staff user is an ADMIN at organization A and an ORGANIZER at organization B. The admin UI shows an organization switcher. All admin queries scope to the active organization. The staff user signs in on the Jump admin domain, never on a custom domain.

**Why this priority**: The single-org `User.organizationId` column could not support staff who manage multiple organizations. The jump team operates several test orgs; event organizers may use multiple brands.

**Independent Test**: Create a User with an ADMIN membership at org A and an ORGANIZER membership at org B. Log in, switch between orgs, verify the correct scoped data is visible in settings, events, and analytics.

**Acceptance Scenarios**:
1. **Given** a User with memberships in multiple organizations, **When** they log in, **Then** the admin layout shows an org switcher in the header.
2. **Given** an ADMIN at org A viewing org A's Settings, **When** they switch to org B via the switcher, **Then** the Settings page reloads with org B's data.
3. **Given** a User with a single membership, **When** they log in, **Then** no org switcher is displayed (just the org name).
4. **Given** a SYSTEM_ADMIN, **When** they view any admin route, **Then** they see an unscoped view across all organizations (with `?organizationId=` query param to filter).

---

### User Story 6 — Tenant isolation (Priority: P1)

Org A staff cannot see any note, consent flag, order, or ticket belonging to the same email address at Org B. Each Contact is scoped per organization.

**Why this priority**: Data leaks between organizations are the primary problem this spec solves. Without tenant isolation, GDPR compliance fails.

**Independent Test**: Create Contact rows with the same email at two organizations. As Org A staff, navigate to Customers and search for that email — only Org A's Contact (with its notes and consent) must appear.

**Acceptance Scenarios**:
1. **Given** the same email has a Contact at org A (with note "Preferred customer") and at org B (with note "Disputed"), **When** org A staff search customers, **Then** they see only the org A Contact with its note.
2. **Given** the same email has orders at both orgs, **When** org A staff view the customer detail, **Then** they see only org A's orders.
3. **Given** a buyer is subscribed at org A but unsubscribed at org B, **When** org A sends a marketing email, **Then** org B's consent flag is not consulted.

---

### User Story 7 — Custom domain setup (Priority: P2)

An organization admin navigates to Settings > Domains, clicks "Connect existing," enters a subdomain (e.g., `tickets.venue.com`), and sees DNS records to publish. After updating DNS, they click "Verify." The system checks CNAME and TXT records, marks the domain VERIFIED, provisions TLS (via Railway when configured), and once ACTIVE the custom domain serves the organization's storefront.

**Why this priority**: White-label storefronts on custom domains are the primary branding deliverable. Without them, organizations cannot own the ticket-buying experience.

**Independent Test**: Add a subdomain, verify DNS records via `dns.promises`, confirm the domain reaches ACTIVE status, and verify the storefront host resolution routes correctly.

**Acceptance Scenarios**:
1. **Given** an organization admin, **When** they enter `tickets.venue.com` in the connect dialog and click Next, **Then** the domain is created with PENDING status and DNS records (CNAME target and TXT value) are displayed.
2. **Given** a domain in PENDING status, **When** DNS records resolve correctly and the admin clicks Verify, **Then** the domain transitions to VERIFIED (or ACTIVE when Railway confirms TLS).
3. **Given** an ACTIVE domain, **When** a buyer visits `https://tickets.venue.com`, **Then** they see the organization's storefront with org branding, not the Jump admin or another org's content.
4. **Given** a visitor navigates to `/admin` on a custom domain, **When** the middleware resolves the tenant host, **Then** they receive a 404 (admin is only on the platform domain).

### Edge Cases

- What happens when a buyer checks the account box but payment fails? The `optInAccount` is recorded on the Order row but never applied to Contact (valid only on COMPLETED orders).
- What happens when an existing global Contact has the same email at multiple organizations? The backfill splits it into one row per organization based on Order history.
- What happens when a staff User loses their last OrganizationMember row? `resolveOrgScope` returns no scope — the dashboard shows zeros, the org switcher shows nothing.
- What happens when a custom domain's DNS stops resolving? The 10-minute sweep marks it FAILED after 72 hours of failures. The storefront falls back to the platform URL.
- What happens when two organizations try to register the same hostname? `OrganizationDomain.hostname` is `@unique` — the second attempt fails at the database level.
- What happens during the backfill if the database has an existing Contact with a non-unique email across orgs? The migration does not change data; a cleanup script splits by order links before enforcing `@@unique([organizationId, email])`.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Contact MUST carry `organizationId`; uniqueness MUST be `@@unique([organizationId, email])`, not global email.
- **FR-002**: Existing contacts MUST be backfilled by splitting each global contact into one row per organization it has orders with.
- **FR-003**: Contact.accountCreatedAt (nullable DateTime) marks a login-enabled buyer. Null = guest.
- **FR-004**: Checkout MUST render two independent checkboxes: account (default checked) and marketing (default unchecked).
- **FR-005**: Contact.emailSubscribed default MUST be `false` (existing rows keep their current value).
- **FR-006**: Buyer login MUST use single-use, time-limited, hashed tokens delivered by email, scoped to one organization.
- **FR-007**: Buyer session MUST be a separate cookie from staff Auth.js, encoding `{ contactId, organizationId }`.
- **FR-008**: Buyer-facing endpoints MUST authorize by buyer session `contactId`, never by email equality.
- **FR-009**: OrganizationMember(userId, organizationId, role) MUST replace User.organizationId for staff scoping.
- **FR-010**: Staff Auth.js JWT MUST carry the active organizationId; an org switcher MUST render when multiple memberships exist.
- **FR-011**: OrganizationDomain(hostname unique, organizationId, status, verificationToken, cnameTarget) MUST resolve the request host to an organization on storefront routes. Admin routes MUST 404 on custom hosts.
- **FR-012**: Storefront URLs in emails and Stripe redirects MUST use the org's primary verified domain when one exists.
- **FR-013**: Buyer login request endpoint MUST be rate-limited per email and per IP (max 3 requests per minute).
- **FR-014**: The backfill migration MUST run idempotently; a dry-run mode MUST exist for production verification.

### Key Entities

- **Contact**: Buyer record scoped per organization (`@@unique([organizationId, email])`). Carries `emailSubscribed` (default false), `accountCreatedAt` (nullable), no direct User link.
- **OrganizationMember**: Join table linking a User to an Organization with a MemberRole. Replaces `User.organizationId` for staff.
- **OrganizationDomain**: White-label hostname owned by an organization. Statuses: PENDING, VERIFIED, ACTIVE, FAILED. Carries verification records, Railway metadata, last DNS snapshot.
- **BuyerLoginToken**: Single-use magic link token. WELCOME (7-day expiry, issued at purchase) or LOGIN (15-minute expiry, requested on demand). Token hashed at rest.
- **Buyer Session**: Separate cookie from Auth.js. Encodes `{ contactId, organizationId }`. Created by magic-link verification.
- **OrgSwitcher**: Header component shown when a User has multiple OrganizationMember rows.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Org A staff cannot see any note, consent flag, or order belonging to the same email at org B (verified by contract test).
- **SC-002**: A buyer who checked the account box at checkout can open the confirmation magic link and see their orders with no password prompt.
- **SC-003**: Backfill runs idempotently against a production snapshot with zero orphaned Order/Ticket rows.
- **SC-004**: Every existing admin route behaves identically for single-org staff after the membership migration.
- **SC-005**: Custom domain setup (CNAME + TXT verification) completes in under 30 seconds for the DNS check portion.
- **SC-006**: Buyer session cookie does not interfere with staff Auth.js session (both can exist in the same browser for different tabs).

## Assumptions

- Auth.js v5 JWT strategy is used; staff sessions are handled by `next-auth` on the platform domain only.
- Buyer sessions use a lightweight cookie-based token (not Auth.js) because buyers never visit the admin domain.
- Railway custom domains are optional: when `RAILWAY_API_TOKEN` is unset, TLS provisioning is manual and OrganizationDomain stops at VERIFIED.
- The backfill does not need to handle edge cases like deleted contacts — those are skipped.
- Custom domain apex support is deferred (spec 008 phase C); subdomains only for this release.