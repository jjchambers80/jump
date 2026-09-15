# Feature Specification: Settings › Domains (Shopify-style Connect Flow)

**Feature Branch**: `feat/008-domains-ui`, `plan/008-domains-ui`  
**Created**: 2026-09-13  
**Status**: Implemented — phases A and B on origin/main  
**Post-spec changes**: Phase C (apex subdomain support) and phase D (ops) remain open; Railway DNS record bug fixed in phase A; SettingsNav moved to its own component.  
**Input**: "Create a UI to configure a custom domain, organized under Settings, placed underneath General as a new menu item. Provide the domain via a dialog; on Next, a DNS configuration is presented. The example screens are from Shopify."  
**Builds on**: spec 007 phase 3 (custom domains backend)

## User Scenarios & Testing _(mandatory)_

### User Story 1 — Organization connects a custom domain (Priority: P1)

An organization admin navigates to Settings > Domains, clicks "Connect existing," enters a subdomain (e.g., `tickets.venue.com`), and clicks Next. The system validates the hostname, creates an OrganizationDomain in PENDING status, and displays a setup page with the two DNS records (CNAME target and TXT verification value) that the admin must publish with their DNS provider. The setup page also shows the detected provider name ("Managed by Cloudflare") if detectable.

**Why this priority**: This is the core UI flow — without it, the domain verify backend from spec 007 has no user-facing entry point.

**Independent Test**: Enter a valid subdomain in the connect dialog. Verify the PENDING row appears in the domains table with DNS records displayed. Verify the connect button shows a spinner and is disabled during submission.

**Acceptance Scenarios**:
1. **Given** an organization admin on Settings > Domains, **When** they click "Connect existing," **Then** a dialog opens with a text input for the hostname and a Next / Cancel footer.
2. **Given** the dialog is open, **When** they enter an invalid hostname (apex domain, URL with scheme, or non-ASCII), **Then** the Next button is disabled and inline validation shows a clear error message.
3. **Given** a valid subdomain is entered, **When** they click Next, **Then** a brief spinner is shown, and the page navigates to the domain setup page `/admin/settings/domains/:id`.
4. **Given** the domain creation API fails, **When** the error response is returned, **Then** the dialog stays open and an inline error is displayed without dismissing the entered hostname.

---

### User Story 2 — Admin views the domain setup page (Priority: P1)

After adding a domain, the admin lands on a setup page showing a step-by-step DNS checklist. Each step shows Type, Name, Current value, and Update to columns. A "Managed by [Provider]" banner links to the DNS console. After publishing records, the admin clicks "I updated DNS records" to trigger verification.

**Why this priority**: The DNS checklist is the primary mechanism for an admin to complete setup. Without clear instructions, the domain never reaches ACTIVE.

**Independent Test**: After adding a domain, verify the setup page renders with the 2+ DNS record rows (CNAME, TXT), copy buttons, and a "I updated DNS records" checkbox.

**Acceptance Scenarios**:
1. **Given** a domain in PENDING status, **When** the setup page loads, **Then** it displays a numbered DNS checklist with Type, Name, Current value, and Update to columns for each required record.
2. **Given** a domain, **When** the DNS provider is detectable from the zone's NS records, **Then** a "Managed by [Provider]" banner with a link to the provider's DNS console is shown.
3. **Given** the domain setup page, **When** the admin clicks the copy icon next to a record value, **Then** the value is copied to clipboard and a brief "Copied" tooltip is shown.
4. **Given** a domain setup page, **When** the admin checks "I updated DNS records," **Then** a 15-second cooldown prevents immediate re-verification, and a "Verify now" button appears.
5. **Given** verification succeeds, **When** the DNS records resolve correctly, **Then** the domain transitions to VERIFIED (or ACTIVE when Railway confirms TLS).

---

### User Story 3 — Domain lifecycle: from PENDING to ACTIVE (Priority: P2)

A domain progresses through PENDING → VERIFIED (DNS verified) → ACTIVE (TLS provisioned, storefront serving). The domain list shows each status with a visual indicator. ACTIVE domains get a "Primary" badge when marked as primary. The storefront URL builder uses the primary domain for email links and Stripe redirects.

**Why this priority**: The status lifecycle is what gives the domain operational meaning. Without ACTIVE, no storefront routing happens.

**Independent Test**: Create a domain, verify DNS, wait for Railway TLS provisioning (or skip in test with Railway mock), verify the domain reaches ACTIVE and routes storefront traffic.

**Acceptance Scenarios**:
1. **Given** a PENDING domain, **When** DNS verification succeeds, **Then** the status moves to VERIFIED (if Railway is configured) or ACTIVE (if Railway is not configured).
2. **Given** a VERIFIED domain and Railway configured, **When** Railway confirms the TLS certificate is issued, **Then** the status moves to ACTIVE.
3. **Given** an ACTIVE domain, **When** the admin marks it as primary, **Then** all storefront URLs (email, Stripe) use that domain.
4. **Given** an ACTIVE domain that has been failing DNS checks for 72+ hours, **When** the background sweep runs, **Then** the status moves to FAILED.
5. **Given** a FAILED domain, **When** DNS records are corrected and verification succeeds again, **Then** the status moves back to ACTIVE.

---

### User Story 4 — Domain removal (Priority: P2)

An admin can remove a domain. If the domain is the primary one, the admin must choose a replacement primary first. Removing an ACTIVE domain stops storefront routing for that hostname immediately (in practice: within one middleware cache refresh).

**Why this priority**: Organizations may rebrand or retire subdomains. They must be able to clean up.

**Independent Test**: Remove a non-primary domain — verify it disappears from the list. Attempt to remove the primary domain — verify the UI requires setting a different primary first.

**Acceptance Scenarios**:
1. **Given** a domain that is not primary, **When** the admin clicks "Remove" and confirms, **Then** the domain is deleted and removed from the list.
2. **Given** the primary domain, **When** the admin clicks "Remove," **Then** a dialog appears saying "Set a different primary domain first" with a link to make another domain primary.
3. **Given** a domain that is the only one (and auto-primary), **When** the admin clicks "Remove," **Then** the dialog warns that the organization will have no custom domain (storefront falls back to platform URL), and removal proceeds on confirmation.

---

### User Story 5 — Platform URL shown alongside custom domains (Priority: P3)

The domains list always shows a non-deletable row representing the organization's platform URL (`https://<frontend>/organizations/<orgId>`) so admins understand the default URL their buyers see when no custom domain is set.

**Why this priority**: Without this reference row, an admin may think no storefront exists until a domain is set up.

**Independent Test**: Verify the domains list includes a greyed-out, non-deletable "Jump URL" row with the platform URL.

**Acceptance Scenarios**:
1. **Given** the domains list page, **When** it renders, **Then** it includes a row labeled "Jump URL" showing the platform URL, styled as read-only without action buttons.
2. **Given** the platform URL row, **When** the admin clicks any action on it, **Then** nothing happens (it is not interactive beyond copying the URL).

### Edge Cases

- What happens when an admin tries to add a domain that already exists (same hostname)? The API returns a 409 Conflict; the dialog shows "This domain is already registered."
- What happens when Railway is configured but at its domain limit (Hobby: 2)? The Railway API returns an error; the UI surfaces it verbatim in the dialog.
- What happens when the DNS provider lookup fails? The provider field is null; the setup page just shows the records without a provider banner.
- What happens during DNS verification if only one of the two records (CNAME, TXT) resolves? Verification fails (both required); the setup page shows which records are still missing.
- What happens if a domain is stuck in VERIFIED (Railway unreachable)? A note is shown: "TLS provisioning pending. Contact support if this persists beyond 24 hours."
- What happens when a domain is deleted and the hostname is later re-added? A new OrganizationDomain row is created; the old history is lost.
- What happens when two organizations have the same custom domain on Railway? Each Railway service can have its own domain; the unique constraint on `OrganizationDomain.hostname` prevents duplicate registration in the database.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Settings > Domains MUST show a list of all OrganizationDomain rows for the current organization.
- **FR-002**: A "Connect existing" dialog MUST accept a subdomain hostname, validate it (no scheme, no apex for now, ASCII only), and create a PENDING OrganizationDomain.
- **FR-003**: The domain setup page (`/admin/settings/domains/:id`) MUST show all DNS records the org needs to publish, with Type, Name, Current value, and Update to columns.
- **FR-004**: A "Copy" button MUST be present for each record value.
- **FR-005**: A "Verify" trigger MUST exist with a 15-second cooldown to prevent rapid re-verification.
- **FR-006**: The domain list MUST show a status badge (PENDING, VERIFIED, ACTIVE, FAILED) and a "Primary" marker on the primary domain.
- **FR-007**: An admin MUST be able to mark any ACTIVE domain as primary.
- **FR-008**: An admin MUST be able to delete any non-primary domain; deleting the primary requires setting another primary first.
- **FR-009**: The platform URL MUST appear as a non-deletable row in the domain list.
- **FR-010**: Storefront URLs in emails and Stripe redirects MUST use the primary ACTIVE domain when one exists.
- **FR-011**: Admin routes and staff auth pages MUST return 404 on custom domains.

### Key Entities

- **OrganizationDomain**: Hostname, organizationId, status (PENDING/VERIFIED/ACTIVE/FAILED), verificationHost, verificationToken, cnameTarget, isPrimary, railwayDomainId, certificateStatus, dnsProvider, lastDnsSnapshot (JSON), verifiedAt, lastCheckedAt, failingSince, lastError.
- **ConnectDomainDialog**: Modal dialog with hostname input and validation.
- **Domain Setup Page**: `/admin/settings/domains/:id` — shows DNS records, provider info, verify button, lifecycle steps.
- **Domains List Page**: `/admin/settings/domains` — table of domains with status, primary marker, actions.
- **DomainService**: Backend service for add, remove, setPrimary, verifyDomain, 10-minute sweep, host→org resolve, CORS allowlist.
- **RailwayDomains client**: Optional Railway GraphQL client for customDomainCreate, status, delete.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A new domain can be added and connected in under 3 clicks (Connect existing → enter hostname → verify DNS).
- **SC-002**: DNS verification completes in under 30 seconds for the DNS check portion.
- **SC-003**: An ACTIVE custom domain serves the organization's storefront within 1 minute of reaching ACTIVE status (middleware cache).
- **SC-004**: An admin who does not know DNS can follow the on-screen instructions and complete setup without external help.
- **SC-005**: 100% of domain operations (add, verify, primary, delete) are accessible from the Settings > Domains UI without needing the API directly.

## Assumptions

- Railway custom domains are optional; without Railway, the domain stops at VERIFIED and the operator attaches TLS manually.
- Apex domain support is deferred to phase C and not part of this spec.
- DNS provider detection is best-effort (NS suffix lookup) and never gates verification.
- The Railway client is gated on `RAILWAY_API_TOKEN` + `RAILWAY_FRONTEND_SERVICE_ID` env vars.
- The middleware tenant host resolution uses an in-memory cache with `reloadOnExpire`; no Redis dependency for host→org mapping.