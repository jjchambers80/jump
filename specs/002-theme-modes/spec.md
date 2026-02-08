# Feature Specification: Theme Modes (Dark, Light & Auto)

**Feature Branch**: `002-theme-modes`  
**Created**: 2026-02-07  
**Status**: Draft  
**Input**: User description: "dark, light and auto (device settings) modes"

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Toggle Between Light and Dark Mode (Priority: P1)

A user browsing the Jump Tickets platform wants to switch between light and dark visual themes to match their viewing comfort. They access a theme toggle control in the site navigation, select their preferred mode, and the entire interface updates immediately without a page reload. Their choice persists across sessions so they don't need to re-select each visit.

**Why this priority**: This is the core feature — without the ability to manually switch themes, neither dark mode nor persistence has value. Users in low-light environments experience eye strain with the current light-only interface.

**Independent Test**: Can be fully tested by clicking the theme toggle and verifying all pages render correctly in both light and dark modes. Delivers immediate visual comfort value.

**Acceptance Scenarios**:

1. **Given** the user is on any page in light mode, **When** they click the theme icon button, **Then** the mode cycles to dark, the icon changes to a moon, and the interface switches to dark mode immediately without a page reload.
2. **Given** the user is on any page in dark mode, **When** they click the theme icon button, **Then** the mode cycles to auto, the icon changes to an auto indicator, and the interface follows the device setting immediately.
3. **Given** the user selects dark mode, **When** they close the browser and return later, **Then** the site loads in dark mode (their last selection is remembered).
4. **Given** the user is on the checkout page in dark mode, **When** they view the order summary and payment form, **Then** all text, inputs, buttons, and cards are legible and properly styled for dark mode.

---

### User Story 2 - Auto Mode Follows Device Settings (Priority: P2)

A user who has set their operating system or browser to dark mode (e.g., macOS Dark Appearance, Windows dark theme, or `prefers-color-scheme: dark`) wants the Jump Tickets platform to automatically match their device preference without manual configuration. When set to "Auto", the site follows the device setting and responds to real-time changes (e.g., scheduled light-to-dark transitions).

**Why this priority**: Auto mode is the most user-friendly default. Many users expect apps to respect their OS-level preference. This story depends on the theme infrastructure from P1.

**Independent Test**: Can be tested by setting device/OS appearance to dark, loading the site with "Auto" selected, and verifying the dark theme is applied. Then switching the OS to light and confirming the site follows.

**Acceptance Scenarios**:

1. **Given** the user has "Auto" mode selected and their device is set to dark mode, **When** they load the site, **Then** the interface renders in dark mode.
2. **Given** the user has "Auto" mode selected and their device is set to light mode, **When** they load the site, **Then** the interface renders in light mode.
3. **Given** the user has "Auto" mode selected, **When** they change their device setting from light to dark (or vice versa) while the site is open, **Then** the interface updates to match the new device setting in real time.

---

### User Story 3 - Theme Toggle is Accessible and Discoverable (Priority: P3)

A user visiting the site for the first time should easily discover the theme toggle control. The control should be accessible via keyboard navigation, clearly labeled, and indicate the currently active mode. The toggle should work for both authenticated and unauthenticated users.

**Why this priority**: Discoverability and accessibility are essential for all users to benefit from the feature, including those using assistive technologies. Lower priority because the core theme functionality works regardless of toggle placement refinements.

**Independent Test**: Can be tested by navigating to the site, locating the theme control visually, tabbing to it with keyboard-only navigation, and confirming the current mode is indicated.

**Acceptance Scenarios**:

1. **Given** any user (logged in or not) is on any page, **When** they look at the site navigation area, **Then** they see a theme icon button with a tooltip indicating the current mode (Light, Dark, or Auto).
2. **Given** a user navigating with keyboard only, **When** they tab through the navigation, **Then** the theme control is focusable and operable via keyboard.
3. **Given** a screen reader user, **When** the theme control is focused, **Then** the screen reader announces the control's purpose and current state.

---

### Edge Cases

- What happens when a user has "Auto" selected but their browser does not support `prefers-color-scheme`? The system defaults to light mode.
- What happens during the initial page load before the saved preference is read? A brief flash of unstyled/wrong-theme content (FOUC) must be prevented.
- What happens when the user clears their browser storage? The theme resets to "Auto" (the default).
- How does the theme affect third-party embedded content (e.g., Stripe checkout redirect)? Third-party iframes and external redirects are not affected by the theme; only the Jump platform UI is themed.
- What happens on the Stripe-hosted checkout page? The Stripe page has its own styling and is unaffected by the Jump theme selection.

## Clarifications

### Session 2026-02-07

- Q: What type of UI control should the theme toggle be? → A: Cycling icon button (click cycles Light → Dark → Auto, tooltip shows current mode)
- Q: Should theme transitions use a smooth animation or switch instantly? → A: Smooth CSS transition (~150ms) on background and text color changes
- Q: What dark mode color palette strategy should be used for backgrounds? → A: Dark gray/slate tones (e.g., #1a1a2e range) — softer, layered, matches existing blue brand accents

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: System MUST support three theme modes: Light, Dark, and Auto.
- **FR-002**: System MUST apply the selected theme across all pages and components consistently (navigation, event cards, checkout, confirmation, ticket display, admin pages, forms, modals).
- **FR-003**: When "Auto" is selected, the system MUST detect and follow the user's OS/browser color scheme preference.
- **FR-004**: When "Auto" is selected, the system MUST respond to real-time changes in the device color scheme preference without requiring a page reload.
- **FR-005**: System MUST persist the user's theme preference in local browser storage so it survives page reloads and new sessions.
- **FR-006**: System MUST default to "Auto" mode for first-time visitors (no saved preference).
- **FR-007**: Theme transitions MUST occur immediately upon selection without a full page reload.
- **FR-008**: System MUST prevent a flash of incorrect theme (FOUC) on initial page load by applying the saved/detected preference before first paint.
- **FR-009**: The theme toggle control MUST be a single icon button in the navigation bar that cycles through modes on click (Light → Dark → Auto), displaying a contextual icon (e.g., sun, moon, auto) and a tooltip indicating the current mode. It MUST be visible on all pages, for both authenticated and unauthenticated users.
- **FR-010**: The theme toggle MUST be keyboard-navigable and announce its state to screen readers (ARIA attributes).
- **FR-011**: All text, interactive elements, and visual components MUST maintain sufficient color contrast ratios (WCAG AA: 4.5:1 for normal text, 3:1 for large text) in both light and dark modes.
- **FR-012**: The currently active theme mode MUST be visually indicated in the toggle control.
- **FR-013**: Theme color changes MUST use a smooth CSS transition (~150ms) on background and text colors to provide a polished visual experience. The transition MUST NOT apply on initial page load (only on user-triggered mode changes).
- **FR-014**: The dark mode palette MUST use dark gray/slate background tones (not pure black) that complement the existing blue brand accents. Surface layers (cards, modals, dropdowns) MUST use progressively lighter shades to convey visual depth hierarchy.

### Key Entities

- **Theme Preference**: Represents the user's selected mode (Light, Dark, or Auto). Stored client-side. Key attributes: mode value, timestamp of last change.
- **Resolved Theme**: The actual visual theme applied after resolving "Auto" against the device setting. Always either "light" or "dark".

### Terminology Note

> **"Auto" mode** is the user-facing label. In code (`next-themes`), this maps to the value `"system"`. The terms are interchangeable: `defaultTheme="system"` in ThemeProvider ≡ "Auto" in the UI. `"light"` and `"dark"` are the same in both contexts.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Users can switch between all three theme modes (Light, Dark, Auto) in under 2 seconds with no page reload.
- **SC-002**: Theme preference persists across browser sessions — 100% of return visits load the previously selected mode.
- **SC-003**: Auto mode correctly follows the device color scheme preference in all major browsers (Chrome, Safari, Firefox, Edge).
- **SC-004**: No flash of incorrect theme (FOUC) is visible on page load when a theme preference is saved.
- **SC-005**: All pages pass WCAG AA color contrast checks in both light and dark modes.
- **SC-006**: Theme toggle is operable via keyboard navigation and is announced correctly by screen readers.

## Assumptions

- Theme preference is stored client-side only (browser localStorage). There is no server-side or account-level theme sync across devices.
- The existing Tailwind CSS setup supports dark mode class toggling.
- Stripe-hosted pages (checkout redirect) are outside the scope of theming — only the Jump platform UI is themed.
- Admin pages follow the same theme as the public-facing pages.
- No custom color picker or user-defined themes — only the three preset modes (Light, Dark, Auto).
