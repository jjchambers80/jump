# Feature Specification: Create Event Flow + Admin RBAC

**Feature Branch**: `005-create-event-rbac`  
**Created**: 2026-02-16  
**Status**: Draft  
**Input**: User description: "Plan Create Event Flow + Admin RBAC (Organization, Venue, Event) — Design the end-to-end 'Create Events' flow and the admin experience for organization-hosted venues/events, including onboarding wizard, one-org-per-account constraint, and Super Admin cross-org access for Jump employees."

## User Scenarios & Testing *(mandatory)*

<!--
  IMPORTANT: User stories should be PRIORITIZED as user journeys ordered by importance.
  Each user story/journey must be INDEPENDENTLY TESTABLE - meaning if you implement just ONE of them,
  you should still have a viable MVP (Minimum Viable Product) that delivers value.
  
  Assign priorities (P1, P2, P3, etc.) to each story, where P1 is the most critical.
  Think of each story as a standalone slice of functionality that can be:
  - Developed independently
  - Tested independently
  - Deployed independently
  - Demonstrated to users independently
-->

### User Story 1 — Public "Create Events" Entry Point (Priority: P1)

A prospective event organizer visits the Jump public site and sees a prominent "Create Events" link in the header. Clicking it takes them to `/create-events`, which guides unauthenticated visitors to sign up or sign in. After authentication and email verification, the user lands in the admin area at `/admin`.

**Why this priority**: This is the top-of-funnel acquisition flow. Without a visible entry point and a clear path from public site → auth → admin, no organizer can onboard.

**Independent Test**: Can be fully tested by navigating to the public site, clicking "Create Events", completing sign-up with email verification, and confirming arrival at `/admin`.

**Acceptance Scenarios**:

1. **Given** an unauthenticated visitor on any public page, **When** they click the "Create Events" link in the header, **Then** they are navigated to `/create-events`.
2. **Given** an unauthenticated visitor on `/create-events`, **When** the page loads, **Then** they see options to sign in or sign up (with links to `/auth/sign-in` and `/auth/sign-up`).
3. **Given** a user who has signed up but not verified their email, **When** they attempt to access `/admin`, **Then** they are redirected to `/auth/verify-email` with a message explaining that email verification is required.
4. **Given** a user who has completed sign-up and email verification, **When** they sign in and the flow completes, **Then** they are redirected to `/admin`.

---

### User Story 2 — Onboarding Wizard for First-Time ADMIN (Priority: P1)

A newly authenticated user with no organization arrives at `/admin` and is presented with a modal wizard that guides them through three steps: (1) create an organization, (2) add a venue, (3) add an event. The wizard blocks access to the rest of the admin area until all three steps are completed. If the user closes the wizard mid-way, their progress is saved and the wizard resumes at the correct step on their next visit.

**Why this priority**: Without an organization, venue, and event, the admin area has no data to manage. The wizard is the critical bootstrapping mechanism.

**Independent Test**: Can be fully tested by signing in as a new user, completing each wizard step, verifying entity creation, then confirming access to the full admin dashboard.

**Acceptance Scenarios**:

1. **Given** an authenticated ADMIN user with no organization, **When** they navigate to `/admin`, **Then** a modal wizard appears with Step 1 "Set up your organization" active, and the admin sidebar/content behind it is not interactive.
2. **Given** the wizard is on Step 1, **When** the user fills in organization details and submits, **Then** the organization is created, the user account is linked to it, and the wizard advances to Step 2 "Add a venue".
3. **Given** the wizard is on Step 2, **When** the user fills in venue details and submits, **Then** a venue is created under the organization and the wizard advances to Step 3 "Add an event".
4. **Given** the wizard is on Step 3, **When** the user fills in event details (selecting the venue from Step 2) and submits, **Then** an event is created and the wizard closes, revealing the full admin dashboard.
5. **Given** the user completed Step 1 and closed the browser, **When** they return to `/admin`, **Then** the wizard reopens at Step 2 with their organization already created.
6. **Given** the user has completed all three wizard steps previously, **When** they visit `/admin`, **Then** the wizard does not appear and they see the regular admin dashboard.

---

### User Story 3 — One Organization per Account (Priority: P1)

An account holder is limited to exactly one organization. The system prevents creation of a second organization via both the user interface and the backend.

**Why this priority**: This is a core business constraint that affects data integrity and the entire multi-tenant model.

**Independent Test**: Can be tested by attempting to create a second organization via the UI and via a direct request, confirming both are rejected.

**Acceptance Scenarios**:

1. **Given** an ADMIN user who already has an organization, **When** they attempt to navigate to any "create organization" flow, **Then** the UI does not show the option and they are informed they already have an organization.
2. **Given** an ADMIN user who already has an organization, **When** a request is made to create another organization for their account, **Then** the system rejects the request with a clear error message: "Your account is already linked to an organization."

---

### User Story 4 — ADMIN Org-Scoped Dashboard (Priority: P2)

An ADMIN user who has completed onboarding sees a dashboard scoped to their organization. The admin header prominently displays their organization name. All admin pages (venues, events, analytics, users) show data belonging only to their organization.

**Why this priority**: Once onboarded, the ADMIN needs a functional, scoped workspace. This is the day-to-day experience after the P1 flows.

**Independent Test**: Can be tested by logging in as an ADMIN, confirming the org name appears in the header, and verifying that venue/event lists only show data belonging to their organization.

**Acceptance Scenarios**:

1. **Given** an authenticated ADMIN user with a completed organization, **When** they view the admin header, **Then** they see their organization name displayed prominently and there is no organization switcher.
2. **Given** an ADMIN user, **When** they browse admin pages (events, venues, analytics), **Then** they see only data belonging to their organization.
3. **Given** an ADMIN user, **When** they create a new venue or event, **Then** it is automatically associated with their organization without them needing to select one.

---

### User Story 5 — SUPER_ADMIN Cross-Organization Access (Priority: P2)

A Jump employee with the SUPER_ADMIN role can access all organizations. The admin header shows an organization selector dropdown instead of a static organization name. Switching the selected organization updates all admin views (events, venues, analytics, settings) to reflect data from the selected organization.

**Why this priority**: Jump employees need cross-org visibility for support, moderation, and platform operations. This is critical for operational readiness but is not on the organizer-facing critical path.

**Independent Test**: Can be tested by logging in as a SUPER_ADMIN, verifying the org dropdown lists all organizations, switching organizations, and confirming all admin pages reflect the newly selected org context.

**Acceptance Scenarios**:

1. **Given** an authenticated SUPER_ADMIN user, **When** they view the admin header, **Then** they see an organization selector dropdown listing all organizations in the system.
2. **Given** a SUPER_ADMIN user viewing the admin area, **When** they select a different organization from the dropdown, **Then** all admin pages (events, venues, analytics, users) update to show data from the selected organization.
3. **Given** a SUPER_ADMIN user who has selected Organization A and navigates to an event list, **When** they switch to Organization B, **Then** the event list refreshes to show Organization B's events and breadcrumbs/context indicators update accordingly.
4. **Given** a SUPER_ADMIN user editing a form for Organization A, **When** they attempt to switch organizations, **Then** they are prompted to confirm or discard unsaved changes before the switch occurs.
5. **Given** a SUPER_ADMIN user who navigates directly to an org-specific URL (e.g., via a bookmark or shared link), **When** the page loads, **Then** the system derives the organization context from the URL and sets the dropdown accordingly.

---

### User Story 6 — Auth Routes for Create Events Flow (Priority: P2)

The authentication flow supports dedicated routes for sign-in (`/auth/sign-in`), sign-up (`/auth/sign-up`), and email verification (`/auth/verify-email`). These routes are accessible to unauthenticated users and integrate with the existing Auth.js (magic link / Google) providers.

**Why this priority**: Auth routes are foundational infrastructure for the Create Events entry point. They must exist before onboarding can work.

**Independent Test**: Can be tested by navigating to each auth route, completing sign-up with email verification, and confirming session creation.

**Acceptance Scenarios**:

1. **Given** an unauthenticated user, **When** they visit `/auth/sign-up`, **Then** they see a registration form with email and Google sign-up options.
2. **Given** a user who submits the sign-up form with a valid email, **When** the form is processed, **Then** a verification email is sent and the user is redirected to `/auth/verify-email`.
3. **Given** a user on `/auth/verify-email`, **When** they click the verification link in their email, **Then** their email is marked as verified and they are redirected to `/admin`.
4. **Given** a user with a verified email, **When** they visit `/auth/sign-in` and authenticate, **Then** they are redirected to `/admin`.

---

### Edge Cases

- **Unverified email access to /admin**: User tries to access `/admin` without a verified email — they are redirected to `/auth/verify-email` with a clear message. No admin content is shown.
- **Wizard resume after partial completion**: User completed the organization step but closed the browser — on return, the wizard detects existing organization (no venue), and reopens at Step 2.
- **Wizard resume with org + venue but no event**: User completed Steps 1 and 2 — wizard reopens at Step 3.
- **Second organization creation attempt**: User with an existing organization attempts to create another via UI — the option is hidden. If attempted via direct request, the system returns a 409 Conflict with an explanatory message.
- **SUPER_ADMIN org switching during form edit**: SUPER_ADMIN is editing an event for Org A and clicks the org dropdown to switch to Org B — a confirmation dialog warns about unsaved changes with "Save", "Discard", and "Cancel" options.
- **SUPER_ADMIN deep-linking to org-specific URL**: SUPER_ADMIN navigates to a URL containing an org-specific resource (e.g., an event belonging to Org B) — the system reads the resource's organization and sets the dropdown context to Org B automatically.
- **Multiple admins per org (future compatibility)**: The current design uses a `organizationId` foreign key on the User model. This does not block future expansion to a many-to-many relationship via a join table. No changes are needed now, but the spec acknowledges this as a future consideration.
- **SUPER_ADMIN with no organizations in system**: When no organizations exist in the system, the SUPER_ADMIN dropdown shows an empty state with a message "No organizations yet" and the admin dashboard shows platform-level metrics only.
- **Concurrent wizard sessions**: If a user opens `/admin` in two tabs during onboarding, both tabs show the wizard. Completing a step in one tab should reflect in the other upon refresh or next interaction (server-side progress is the source of truth).
- **Wizard skip and re-entry**: User clicks "Skip for now" on Step 2 (venue). They land in the admin area but with limited functionality (no events can be created without a venue). The wizard does not automatically reappear, but a persistent banner or prompt in the admin dashboard reminds them to complete setup, linking back to add a venue/event.

## Requirements *(mandatory)*

### Functional Requirements

**Navigation & Entry Point**

- **FR-001**: System MUST display a "Create Events" link in the public site header, visible on all public pages.
- **FR-002**: Clicking the "Create Events" link MUST navigate to `/create-events`.
- **FR-003**: The `/create-events` page MUST present sign-in and sign-up options to unauthenticated visitors, linking to `/auth/sign-in` and `/auth/sign-up` respectively.
- **FR-004**: Authenticated users who click "Create Events" MUST be redirected directly to `/admin`.

**Authentication & Verification**

- **FR-005**: System MUST support user sign-up via email (magic link) and Google authentication.
- **FR-006**: System MUST send a verification email upon sign-up with an email-based provider.
- **FR-007**: System MUST prevent users with unverified emails from accessing `/admin` routes, redirecting them to `/auth/verify-email`.
- **FR-008**: Upon successful email verification, the user MUST be redirected to `/admin`.

**Organization Constraints**

- **FR-009**: System MUST enforce a one-organization-per-account constraint — each user account can be linked to at most one organization.
- **FR-010**: The backend MUST reject any request to create a second organization for an account that already has one, returning a clear error.
- **FR-011**: The UI MUST hide organization creation options from users who already have an organization.

**Onboarding Wizard**

- **FR-012**: System MUST display a modal wizard when an ADMIN user accesses `/admin` and does not yet have a fully onboarded organization (missing org, venue, or event). Wizard completion requires exactly 1 organization, 1 venue, and 1 event.
- **FR-013**: The wizard MUST include three sequential steps: (1) Set up your organization, (2) Add a venue, (3) Add an event. Steps 2 and 3 MUST each include a "Skip for now" option that dismisses the wizard and allows the user to complete setup manually via the admin area.
- **FR-014**: The wizard MUST block interaction with the admin area behind it until all three steps are completed OR the user clicks "Skip for now". Step 1 (organization creation) MUST NOT be skippable — an organization is required before any admin functionality is available.
- **FR-015**: Each wizard step MUST validate required fields before allowing advancement to the next step.
- **FR-016**: Wizard progress MUST be persisted server-side so that if the user leaves and returns, the wizard resumes at the correct step.
- **FR-017**: Each wizard step MUST show a clear success state (e.g., checkmark, confirmation message) upon completion before advancing.
- **FR-018**: The wizard MUST support a progress indicator showing which steps are completed, current, and remaining.

**Admin Area — ADMIN Role**

- **FR-019**: Authenticated users MUST be assigned the ADMIN role when they create an organization (upgrading from CUSTOMER).
- **FR-020**: ADMIN users MUST see their organization name displayed prominently in the admin header.
- **FR-021**: ADMIN users MUST NOT see an organization switcher — their context is fixed to their single organization.
- **FR-022**: All admin pages (events, venues, analytics, users) MUST display only data belonging to the ADMIN's organization.
- **FR-023**: All admin create/update operations MUST automatically scope new entities to the ADMIN's organization.

**Admin Area — SUPER_ADMIN Role**

- **FR-024**: System MUST support a SUPER_ADMIN role for Jump employees with access to all organizations.
- **FR-025**: SUPER_ADMIN users MUST see an organization selector dropdown in the admin header (replacing the static org name).
- **FR-026**: The organization dropdown MUST list all organizations in the system with search/filter capability when the list exceeds 10 items.
- **FR-027**: Switching the selected organization MUST update all scoped admin views (event lists, venue lists, analytics, forms, breadcrumbs).
- **FR-028**: All admin API requests from a SUPER_ADMIN MUST include the currently selected organization context, derived from the `orgId` query parameter in the URL.
- **FR-029**: The SUPER_ADMIN organization context MUST be carried as a `?orgId=<id>` query parameter on all `/admin` routes. When a SUPER_ADMIN navigates to a URL containing an org-scoped resource, the system MUST derive the organization context from that resource and set the `orgId` parameter accordingly.
- **FR-030**: When a SUPER_ADMIN attempts to switch organizations while editing a form with unsaved changes, the system MUST prompt for confirmation before switching.

**Route Structure**

- **FR-031**: The following routes MUST be implemented:
  - `/create-events` — Public entry point for organizer acquisition
  - `/auth/sign-in` — Sign-in page
  - `/auth/sign-up` — Sign-up page
  - `/auth/verify-email` — Email verification pending page
  - `/admin` — Admin dashboard (protected, requires auth + verified email)

### Key Entities

- **User**: Represents an authenticated account. Has a role (CUSTOMER, ADMIN, or SUPER_ADMIN) and an optional link to one Organization. Key attributes: email, name, role, emailVerified status, organizationId.
- **Organization**: Represents an event-organizing entity (company, promoter, venue operator). Belongs to exactly one User (the owner). Key attributes: name, status (active/inactive). Has many Venues and Users.
- **Venue**: A physical location where events are held. Belongs to one Organization. Key attributes: name, address, timezone, isPublic. Has many Events.
- **Event**: A ticketed happening at a venue. Belongs to a Venue (which belongs to an Organization). Key attributes: name, description, date, capacity, status (draft/published/cancelled), category.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 90% of new organizers complete the full onboarding flow (sign-up → verify email → wizard completion) in under 5 minutes.
- **SC-002**: 100% of attempts to create a second organization for an account are blocked with a clear error message.
- **SC-003**: ADMIN users see only their own organization's data across all admin pages — zero cross-org data leakage.
- **SC-004**: SUPER_ADMIN users can switch between organizations and see updated data across all admin views within 2 seconds.
- **SC-005**: Users who abandon the wizard mid-flow and return later resume at the correct step 100% of the time (no data loss, no repeated steps).
- **SC-006**: The "Create Events" link is visible and functional on all public pages, driving new organizer sign-ups.
- **SC-007**: 95% of first-time users complete each wizard step on their first attempt without errors (clear validation and guidance).

## Clarifications

### Session 2026-02-16

- Q: How is the SUPER_ADMIN's selected organization context persisted across page navigations? → A: URL query parameter (`?orgId=xyz`) on all admin routes.
- Q: What is the minimum viable definition for onboarding wizard completion? → A: Exactly 1 org + 1 venue + 1 event. Users can add more via the regular admin area afterward. The wizard also offers a "Skip for now" option on each step (after org creation) so users can complete setup manually.
- Q: What is the relationship between ORGANIZER and ADMIN roles? → A: ORGANIZER is a lower-privilege org member who can manage events and venues but not org-level settings. ADMIN is the org owner with full org control. Both roles are scoped to one organization. The active role hierarchy is: CUSTOMER < ORGANIZER < ADMIN < SUPER_ADMIN.

## Assumptions

- The existing Auth.js v5 setup with Resend (magic link) and Google providers will be used — no new auth providers are needed.
- The current `UserRole` enum (`CUSTOMER`, `ORGANIZER`, `ADMIN`) will be extended to include `SUPER_ADMIN`. All four roles are active: CUSTOMER (public users), ORGANIZER (org member, manages events/venues), ADMIN (org owner, full org control), SUPER_ADMIN (Jump employee, cross-org access).
- The existing `User.organizationId` foreign key already supports the one-org-per-account model; enforcement will be added at the service and API layers.
- SUPER_ADMIN role assignment is performed manually (database or internal tool) — there is no self-service path to become a SUPER_ADMIN.
- The onboarding wizard is a modal overlay on the admin layout, not a separate route.
- Events require a venue — the wizard enforces this by having the venue step precede the event step.
- The existing admin sidebar and layout (from feature 004) will be reused and extended.

## Dependencies

- Feature 004 (Admin Area) — provides the admin layout, sidebar, and protected route structure.
- Feature 003 (Schema Redesign) — provides the current data model (User, Organization, Venue, Event).
- Auth.js v5 with Resend and Google providers — the existing authentication infrastructure.

## Non-Goals

- Advanced team management (inviting multiple admins to an organization) — deferred to a future iteration.
- Organization billing or subscription management.
- Public event discovery or consumer ticket purchase flow (already handled in Feature 001).
- Self-service SUPER_ADMIN role assignment.
