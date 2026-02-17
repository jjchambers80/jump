# Feature Specification: Admin Area

**Feature Branch**: `004-admin-area`  
**Created**: 2026-02-15  
**Status**: Draft  
**Input**: User description: "Create an admin area. Use route /admin to access. Only Organizer and Admin roles can access. Remove the admin links from the front end."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Admin accesses the admin area (Priority: P1)

An authenticated user with the ADMIN role navigates to `/admin` and is presented with a dedicated admin area containing a sidebar navigation and dashboard. All administrative functionality (organizations, venues, events, analytics, ticket scanning, user management) is accessible from within this area without returning to the public site navigation.

**Why this priority**: The admin area is the core deliverable — without it, no other stories function. This is the foundational container for all administrative workflows.

**Independent Test**: Can be fully tested by logging in as an ADMIN user, navigating to `/admin`, and verifying the sidebar navigation renders with all expected links and the dashboard loads.

**Acceptance Scenarios**:

1. **Given** an authenticated user with ADMIN role, **When** they navigate to `/admin`, **Then** they see a sidebar navigation with links to Dashboard, Organizations, Venues, Events, Analytics, Scan, Users, and a Create Event quick action button, and the Dashboard page loads by default.
2. **Given** an authenticated ADMIN user on the admin area, **When** they click any sidebar link, **Then** the corresponding admin page loads within the admin layout (sidebar remains visible).
3. **Given** an authenticated ADMIN user, **When** they are on `/admin`, **Then** sidebar navigation highlights the currently active section.

---

### User Story 2 - Organizer accesses the admin area (Priority: P1)

An authenticated user with the ORGANIZER role navigates to `/admin` and sees the admin area with sidebar navigation. The Users management section is hidden from organizers since user role management is an admin-only capability.

**Why this priority**: Organizers are the primary daily users of event management tools. Supporting them is equally critical to supporting admins.

**Independent Test**: Can be fully tested by logging in as an ORGANIZER user, navigating to `/admin`, and verifying the sidebar renders without the Users link.

**Acceptance Scenarios**:

1. **Given** an authenticated user with ORGANIZER role, **When** they navigate to `/admin`, **Then** they see sidebar navigation with Dashboard, Organizations, Venues, Events, Analytics, Scan, and a Create Event quick action button — but NOT Users.
2. **Given** an authenticated ORGANIZER user, **When** they attempt to navigate directly to `/admin/users`, **Then** they see the access denied page indicating that Admin role is required.

---

### User Story 3 - Unauthorized user is denied access (Priority: P1)

An unauthenticated user or a user with the CUSTOMER role cannot access the admin area. Unauthenticated users are redirected to sign-in. Customers see an access denied message explaining that Admin or Organizer role is required.

**Why this priority**: Security is non-negotiable for an area controlling events, finances, and user roles. Without this, the admin area is an open door.

**Independent Test**: Can be fully tested by navigating to `/admin` while logged out (verify redirect to sign-in) and while logged in as a CUSTOMER (verify 403 access denied page).

**Acceptance Scenarios**:

1. **Given** an unauthenticated user, **When** they navigate to `/admin` or any `/admin/*` sub-route, **Then** they are redirected to the sign-in page with a callback URL back to the admin area.
2. **Given** an authenticated user with CUSTOMER role, **When** they navigate to `/admin`, **Then** they see an access denied page indicating Admin or Organizer role is required.
3. **Given** an authenticated CUSTOMER user on the access denied page, **When** they click the provided action button, **Then** they are navigated back to the public events page.

---

### User Story 4 - Admin links removed from public navigation (Priority: P2)

The public navigation bar (Navbar) no longer displays individual admin-specific links (Scan, Dashboard, Orgs, Venues, Events, Analytics). Instead, authenticated ADMIN and ORGANIZER users see a single "Admin" link that takes them to `/admin`. Customer users see only Events, My Tickets, and Orders.

**Why this priority**: Decluttering the Navbar improves customer experience and consolidates admin entry to one link. Depends on the admin area existing first (P1 stories).

**Independent Test**: Can be fully tested by loading the public site as each role and verifying the Navbar contents match expectations.

**Acceptance Scenarios**:

1. **Given** an authenticated ADMIN or ORGANIZER user, **When** they view the public Navbar, **Then** they see a single "Admin" link (no Scan, Dashboard, Orgs, Venues, Events, or Analytics links).
2. **Given** an authenticated CUSTOMER user, **When** they view the Navbar, **Then** they see Events, My Tickets, and Orders links, and NO "Admin" link.
3. **Given** an unauthenticated user, **When** they view the Navbar, **Then** they see Events and Sign In — no admin-related links.

---

### User Story 5 - Mobile-responsive admin sidebar (Priority: P3)

On smaller screens, the admin sidebar collapses and can be toggled open/closed via a floating button. An overlay appears behind the sidebar when open on mobile to allow dismissal by tapping outside.

**Why this priority**: Mobile responsiveness is important but secondary to core functionality. The admin area is primarily used on desktop.

**Independent Test**: Can be tested by resizing the browser to mobile width and verifying the sidebar toggle button appears, the sidebar slides in/out, and tapping the overlay closes it.

**Acceptance Scenarios**:

1. **Given** an admin user on a screen below 768px wide (Tailwind `md:` breakpoint), **When** the page loads, **Then** the sidebar is hidden and a floating toggle button is visible.
2. **Given** a hidden sidebar on a screen below 768px, **When** the user taps the toggle button, **Then** the sidebar slides in from the left with a backdrop overlay.
3. **Given** an open sidebar on a screen below 768px, **When** the user taps the backdrop overlay or a navigation link, **Then** the sidebar closes.

---

### Edge Cases

- What happens when a user's role changes while they're viewing the admin area? The role check is performed client-side on each render via session state. If the session is refreshed and the role has changed, the AdminRoute guard denies access on next navigation.
- What happens when a user bookmarks `/admin/users` and their role is downgraded from ADMIN to ORGANIZER? They see the access denied page since the AdminRoute guard checks the role.
- What happens if the session expires while on the admin area? The edge middleware catches unauthenticated requests and redirects to sign-in with callback URL.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: System MUST provide a dedicated admin area accessible at the `/admin` route.
- **FR-002**: System MUST restrict `/admin` and all `/admin/*` sub-routes to users with ADMIN or ORGANIZER roles only.
- **FR-003**: System MUST redirect unauthenticated users from `/admin` to the sign-in page with a callback URL.
- **FR-004**: System MUST display an access denied page to authenticated users without ADMIN or ORGANIZER role.
- **FR-005**: Admin area MUST include a persistent sidebar navigation with links to: Dashboard, Organizations, Venues, Events, Analytics, Scan.
- **FR-006**: Admin area sidebar MUST include a Users link visible only to ADMIN role users.
- **FR-007**: Admin area sidebar MUST visually highlight the currently active navigation section.
- **FR-008**: Navigating to `/admin` (root) MUST redirect to `/admin/dashboard` as the default landing page.
- **FR-009**: Public Navbar MUST display a single "Admin" link for ADMIN and ORGANIZER users instead of individual admin page links.
- **FR-010**: Public Navbar MUST NOT display any admin links to CUSTOMER role users or unauthenticated users.
- **FR-011**: Admin sidebar MUST include a "Create Event" quick action button.
- **FR-012**: Admin area MUST be responsive — sidebar collapses on mobile with a toggle mechanism.
- **FR-013**: All existing admin pages (Dashboard, Organizations, Venues, Events, Analytics, Users, Scan, Create Event) MUST be relocated under the `/admin` route prefix.
- **FR-014**: All internal links within admin pages MUST point to their new `/admin/*` paths.

### Key Entities

- **User**: Authenticated identity with a `role` field (ADMIN, ORGANIZER, CUSTOMER). Determines access level within the admin area.
- **Admin Layout**: A shared layout component wrapping all `/admin/*` routes, providing the sidebar navigation and role-based access guard.
- **AdminRoute Guard**: Client-side component that checks session role and renders children only for allowed roles (ADMIN, ORGANIZER).

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Users with ADMIN or ORGANIZER role can access all admin pages within 1 click from the public Navbar.
- **SC-002**: Users with CUSTOMER role see zero admin-related links in the public Navbar.
- **SC-003**: 100% of admin pages are accessible exclusively through the `/admin` route prefix.
- **SC-004**: Unauthenticated users attempting to access `/admin` are redirected to sign-in within 1 second.
- **SC-005**: The admin sidebar correctly shows/hides the Users section based on user role with no flash of unauthorized content.
- **SC-006**: All admin pages render within the admin layout with sidebar visible on desktop viewport widths.

## Assumptions

- Auth.js v5 JWT strategy is used — role is available in the session token without a database call at the edge.
- The existing `AdminRoute` component is the designated client-side guard for role checking.
- Edge middleware handles authentication (redirect to sign-in) but not authorization (role check) — role-based access is handled client-side by `AdminRoute`.
- The ORGANIZER role has access to all admin pages except User Management (`/admin/users`).
- Default role for new sign-ups is CUSTOMER, so no new users accidentally gain admin access.
