# Admin Business Settings Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Replace the admin sidebar’s bottom-left Create Event quick action with a Settings link and add a responsive `/admin/settings` page where an admin or organizer can view and edit the business details for their assigned company in an accessible dialog.

**Architecture:** Keep the existing top-level admin layout and add a settings-specific two-column layout: a narrow local menu containing `General`, and a main panel containing the assigned organization’s business details. Add current-user-scoped API endpoints under `/admin/settings/business-details`; the backend will derive the organization from the authenticated user instead of accepting an organization ID from the browser. Extend the existing `Organization` model for the new fields while continuing to use `Organization.name` as the registered legal business name.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Tailwind CSS, Express, Prisma, PostgreSQL, Jest/Supertest, Playwright.

---

## Requirements and reference interpretation

The supplied screenshot is treated as a visual/layout reference rather than a request to clone Shopify branding.

The edit dialog will contain these business fields visible in the screenshot:

1. Type of business
2. Registered legal business name (mapped to existing `Organization.name`)
3. Nickname
4. Business address, line 1
5. Apartment, suite, etc. (address line 2)
6. City
7. State
8. ZIP code
9. Phone number
10. Employer Identification Number (EIN)

The US selectors shown beside the business type/phone controls will be represented by persisted `countryCode` and `phoneCountryCode` fields, defaulting to `US` and `+1`. The screenshot’s People, business-verification-document upload, “additional business information,” and “optional fields” sections are not included because they are separate settings capabilities rather than fields in the requested business-details form.

The Create Event routes and buttons on the Events page remain available. Only the bottom block in the global admin sidebar is replaced.

## Assumptions to confirm during implementation

- Both `ADMIN` and `ORGANIZER` users can open Settings and update the organization assigned through `User.organizationId`, matching the roles admitted by the existing admin layout.
- `Organization.name` is the canonical registered legal business name; no duplicate `legalName` column is added.
- `nickname`, address line 2, phone number, and EIN are optional. Business type, legal name, address line 1, city, state, and ZIP code are required before saving.
- The initial business-type dropdown uses a fixed application list (for example sole proprietorship, single-member LLC, multi-member LLC, partnership, C corporation, S corporation, and nonprofit). Confirm product wording before implementation if a different list is required.
- State is stored as a two-letter US code and ZIP accepts either `12345` or `12345-6789`.
- EIN is normalized to nine digits, rendered as `XX-XXXXXXX` while editing, never written to logs, and masked to `••-•••NNNN` in ordinary read responses after save. The current schema has no field-level encryption facility; production storage of EIN should not ship until an encryption/key-management decision is approved.

---

### Task 1: Lock the API contract and persistence shape with failing contract tests

**Objective:** Define the current-user-scoped behavior, validation rules, masking behavior, and authorization before changing implementation.

**Files:**
- Modify: `backend/tests/contract/organizations.test.js`
- Modify: `specs/003-schema-redesign/contracts/api.yaml`

**Step 1: Add failing GET contract coverage**

Add tests for `GET /admin/settings/business-details` that create database users tied to distinct organizations and sign JWTs with their real user IDs. Assert:

- An assigned `ADMIN` receives only their own organization.
- An assigned `ORGANIZER` receives only their own organization.
- A `CUSTOMER` receives 403.
- An unauthenticated request receives 401.
- An admin/organizer with no `organizationId` receives a clear 404 response.
- The response includes all display fields and exposes only the masked EIN representation, never the full EIN.

Do not use placeholder JWT subjects for these tests because organization lookup is intentionally based on `req.user.id`.

**Step 2: Add failing PATCH contract coverage**

Add tests for `PATCH /admin/settings/business-details` asserting that:

- An admin and organizer can update their own assigned organization.
- The request has no organization ID and cannot target another organization.
- Legal name and other string inputs are trimmed.
- State/country codes are normalized to uppercase, phone is normalized, and EIN is normalized from `12-3456789` to nine digits.
- Invalid business type, blank legal name, invalid state/ZIP/phone/EIN, unknown fields, and an empty update are rejected with 400.
- Omitting EIN preserves the existing value; sending `ein: null` explicitly clears it.
- The response masks the saved EIN.
- Customer and unauthenticated requests are rejected.

**Step 3: Run the tests and verify RED**

Run:

```bash
npm test --workspace=backend -- tests/contract/organizations.test.js --runInBand
```

Expected: the new settings endpoint tests fail with 404 because the endpoints do not exist yet; existing organization CRUD tests remain green.

**Step 4: Document the endpoints and schemas**

Add OpenAPI operations for GET/PATCH `/admin/settings/business-details`, including:

- Bearer authentication and Admin/Organizer access notes.
- A `BusinessDetailsResponse` schema.
- A `BusinessDetailsUpdate` schema with nullable optional fields.
- Validation formats and maximum lengths.
- Masked EIN response semantics.
- 400, 401, 403, and 404 responses.

**Step 5: Commit checkpoint (only if the user asks for commits)**

Suggested message: `test(admin): define business settings contract`

---

### Task 2: Extend the Organization schema and create the migration

**Objective:** Persist the requested details without duplicating the existing organization name.

**Files:**
- Modify: `packages/db/prisma/schema.prisma:84-94`
- Create: `packages/db/prisma/migrations/<timestamp>_add_organization_business_details/migration.sql`

**Step 1: Add nullable business-detail fields**

Extend `Organization` with fields equivalent to:

```prisma
businessType    String?
nickname        String?
countryCode     String? @default("US")
addressLine1    String?
addressLine2    String?
city            String?
state           String?
postalCode      String?
phoneCountryCode String? @default("+1")
phoneNumber     String?
ein             String?
```

Keep `name` as the legal business name. Use nullable columns so existing organizations migrate safely; form validation can require completion on save without breaking old rows.

**Step 2: Generate and inspect the migration**

Run:

```bash
npm run db:migrate -- --name add_organization_business_details
npm run db:generate
```

Expected: Prisma creates only the new organization columns/defaults and regenerates the client. Inspect the SQL before proceeding; do not reset or recreate the database.

**Step 3: Commit checkpoint (only if requested)**

Suggested message: `feat(db): add organization business details`

---

### Task 3: Implement scoped business-settings API behavior

**Objective:** Make the contract tests pass while preventing cross-organization access.

**Files:**
- Modify: `backend/src/api/routes/admin.js`
- Modify: `backend/src/api/validators/organizationValidators.js`
- Modify: `backend/src/services/OrganizationService.js`

**Step 1: Add business-details validation**

Export a dedicated `validateUpdateBusinessDetails` middleware. Use an explicit allowlist; reject unknown keys and empty payloads. Validate and normalize:

- `name`: non-empty, maximum 255 characters.
- `businessType`: one of the approved dropdown values.
- `nickname`: nullable/optional, maximum 255 characters.
- `countryCode`: `US` for the first version.
- `addressLine1`: required, bounded string.
- `addressLine2`: nullable/optional, bounded string.
- `city`: required, bounded string.
- `state`: valid two-letter US state/territory code.
- `postalCode`: five digits or ZIP+4.
- `phoneCountryCode`: `+1` for the first version.
- `phoneNumber`: valid normalized US number.
- `ein`: `null` or exactly nine digits after punctuation removal.

Keep the existing create/update organization validators working unchanged.

**Step 2: Add service methods scoped by user ID**

Add methods that first resolve the authenticated user’s `organizationId`, then read or update only that organization. Return a consistent not-found result when the user has no assigned organization. Build response serialization in one helper so GET and PATCH both mask EIN and never accidentally return the stored value.

The response should include `einMasked` and `hasEin`; it should not include raw `ein`. To let the dialog preserve an existing EIN, the frontend leaves EIN untouched unless the user types a replacement or explicitly chooses to clear it.

**Step 3: Add routes under the existing admin router**

Implement:

- `GET /admin/settings/business-details`
- `PATCH /admin/settings/business-details`

The admin router already applies `requireAuth` and `requireOrganizer`; retain that middleware rather than weakening the standalone admin-only `/organizations` CRUD endpoints. Pass `req.user.id` into the service and never accept an organization ID from query/body parameters.

**Step 4: Run contract tests and verify GREEN**

Run:

```bash
npm test --workspace=backend -- tests/contract/organizations.test.js --runInBand
npm run lint --workspace=backend
```

Expected: all organization/settings contract tests pass and ESLint reports no new errors.

**Step 5: Commit checkpoint (only if requested)**

Suggested message: `feat(api): add scoped business settings endpoints`

---

### Task 4: Replace the sidebar quick action with Settings

**Objective:** Put Settings exactly where the sidebar’s bottom Create Event button currently appears.

**Files:**
- Modify: `frontend/src/components/AdminSidebar.tsx:1-3,122-131`
- Modify: `frontend/e2e/admin-mobile.spec.ts`
- Create: `frontend/e2e/admin-settings.spec.ts` (settings navigation assertions can share this file with Task 6)

**Step 1: Add failing navigation assertions**

Assert on desktop and mobile that:

- The bottom sidebar block contains a `Settings` link to `/admin/settings`.
- The bottom sidebar block no longer contains `Create Event`.
- The main nav does not contain a duplicate Settings entry.
- Clicking Settings on mobile navigates and closes the drawer.
- The Settings link has the active style on `/admin/settings` and descendant paths.

Scope locators to the sidebar so the Events page’s legitimate Create Event control does not make the test fail.

**Step 2: Run and verify RED**

Run:

```bash
npm test --workspace=frontend -- admin-settings.spec.ts
```

Expected: failure because the footer still links to `/admin/create-event`.

**Step 3: Replace the footer action**

Replace the quick-action block with a normal settings-style link at `href="/admin/settings"`. Preserve its separated bottom placement, desktop/mobile behavior, dark mode, focus styles, and `onClose` callback. Give it the same active-state treatment as navigation items rather than retaining the primary indigo Create Event button treatment.

Update stale comments that currently promise the Create Event quick action.

**Step 4: Run and verify GREEN**

Re-run the focused Playwright spec. Expected: sidebar placement, navigation, active state, and mobile close behavior pass.

**Step 5: Commit checkpoint (only if requested)**

Suggested message: `feat(admin): replace sidebar create action with settings`

---

### Task 5: Build the Settings page and read-only General view

**Objective:** Add the settings-specific left menu and a clear summary of the assigned company’s business details.

**Files:**
- Create: `frontend/src/app/admin/settings/page.tsx`
- Create: `frontend/src/app/admin/settings/types.ts`
- Modify: `frontend/e2e/admin-settings.spec.ts`

**Step 1: Add failing page tests**

Mock `GET http://localhost:3002/admin/settings/business-details` and assert:

- `/admin/settings` renders a `Settings` heading.
- A left local-navigation column contains one selected item: `General`.
- The main panel is titled with the company/organization name and identifies the content as business details.
- Saved fields are presented as readable label/value rows, not disabled form inputs.
- Missing optional values render `Not provided` rather than blank space.
- Loading skeleton/state, API failure state with Retry, and no-assigned-organization state are usable.
- The page has no horizontal overflow at desktop and 375px mobile widths.

**Step 2: Run and verify RED**

Run the focused settings spec. Expected: route/page not found.

**Step 3: Implement the page data flow**

Create a client page that fetches the scoped endpoint once, stores typed `BusinessDetails`, and updates local state from a successful dialog save. Avoid fetching `/organizations` or selecting the first organization.

**Step 4: Implement the responsive layout**

Use existing Tailwind light/dark conventions:

- Desktop: page heading, left local menu (`General`) around 12–16rem wide, and flexible main content.
- Mobile: stack the local menu above the main panel without introducing a second drawer.
- Main card: organization name, `Business details` subtitle/section, compact label/value groups, and an `Edit` button.
- Preserve semantic headings, visible keyboard focus, and sufficient contrast.

`General` should be a real button or anchored section control with `aria-current="page"`, even though it is the only initial item, so future settings sections can be added without restructuring.

**Step 5: Run and verify GREEN**

Run the focused spec and manually verify desktop/mobile layout in the running app.

**Step 6: Commit checkpoint (only if requested)**

Suggested message: `feat(admin): add general settings page`

---

### Task 6: Add the accessible Edit business details dialog

**Objective:** Let the user edit and save all requested fields without navigating away from Settings.

**Files:**
- Create: `frontend/src/app/admin/settings/BusinessDetailsDialog.tsx`
- Modify: `frontend/src/app/admin/settings/page.tsx`
- Modify: `frontend/e2e/admin-settings.spec.ts`

**Step 1: Add failing dialog interaction tests**

Cover:

- Clicking `Edit` opens a dialog titled `Edit business details` with current values prefilled.
- All labels from the screenshot are associated with their controls.
- Save is disabled while required fields are missing or a request is pending.
- Invalid ZIP, phone, and EIN values produce inline accessible messages without sending PATCH.
- Save sends the normalized explicit payload to the scoped endpoint.
- A successful save updates the summary immediately, announces success, and closes the dialog.
- A failed save leaves the dialog open, preserves typed values, and shows an error.
- `Discard`, backdrop click (when no save is running), and Escape close without saving.
- If fields are dirty, Discard/Escape asks for confirmation before losing edits.
- Initial focus, Tab containment, focus restoration to Edit, `role="dialog"`, `aria-modal`, and labelled error messages work.
- Existing masked EIN is not re-submitted; entering a new EIN replaces it; an explicit Clear action sends `ein: null`.

**Step 2: Run and verify RED**

Run:

```bash
npm test --workspace=frontend -- admin-settings.spec.ts
```

Expected: dialog assertions fail because the Edit control has no implementation.

**Step 3: Implement dialog state and layout**

Build a controlled dialog using React state and existing Tailwind classes (no new UI dependency). Match the reference’s structure:

- Sticky/visible header with title, `Discard`, and `Save`.
- Scrollable form body.
- Full-width business type, legal name, nickname, address lines, phone, and EIN rows.
- City/state/ZIP in a responsive three-column row on desktop and stacked controls on mobile.
- Inline required/error text and disabled/pending Save state.

Use native `<select>` controls for business type and state. Format phone, ZIP, and EIN for display while keeping normalized state/payload rules unambiguous.

**Step 4: Implement save behavior**

Call `PATCH /admin/settings/business-details` with every editable non-EIN field explicitly. Include EIN only when replaced or cleared. Disable close/save races during the request. On success, pass the returned masked response to the page; on failure, retain inputs for correction.

**Step 5: Run and verify GREEN**

Re-run the focused Playwright test. Expected: view/edit/save/error/accessibility flows pass at desktop and mobile viewports.

**Step 6: Commit checkpoint (only if requested)**

Suggested message: `feat(admin): edit organization business details`

---

### Task 7: Update documentation and complete regression verification

**Objective:** Ensure the new navigation and business-settings workflow is documented and does not regress the admin area.

**Files:**
- Modify: `docs/user-guides/organizers/admin-area.md:15-37`
- Modify if feature requirements are tracked there: `specs/005-create-event-rbac/spec.md`

**Step 1: Update the admin guide**

- Add Settings and `/admin/settings` to the navigation table.
- Replace the obsolete Create Event sidebar quick-action statement.
- Explain that Create Event remains on the Events page.
- Add a Settings section describing General, business-details editing, required fields, discard/save behavior, and masked EIN display.
- Document Admin/Organizer access and the no-assigned-organization state.

**Step 2: Run targeted backend verification**

```bash
npm test --workspace=backend -- tests/contract/organizations.test.js --runInBand
npm run lint --workspace=backend
```

Expected: all targeted tests and lint pass.

**Step 3: Run targeted frontend verification**

```bash
npm test --workspace=frontend -- admin-settings.spec.ts admin-mobile.spec.ts
npm run lint --workspace=frontend
npm run build --workspace=frontend
```

Expected: settings/mobile specs pass, Next lint passes, and production build succeeds.

If older admin E2E tests require stale username/password sign-in while current tests use `E2E_ADMIN_EMAIL`, align only the touched settings test with the project’s working dev-email sign-in pattern; do not broaden this feature into an unrelated test-suite rewrite.

**Step 4: Perform live visual and accessibility checks**

With backend/frontend running and a real Admin or Organizer assigned to an organization:

- Verify `/admin/settings` at desktop and 375px mobile sizes.
- Confirm global sidebar scroll/active behavior and mobile drawer closing.
- Confirm the local General menu stacks correctly.
- Open the dialog, tab through every control, trigger validation, discard changes, then save a valid update and reload to prove persistence.
- Verify dark and light modes.
- Check `document.documentElement.scrollWidth === document.documentElement.clientWidth` at both widths.
- Confirm network responses never include the raw EIN.

**Step 5: Review repository integrity**

```bash
git diff --check
git status --short
git diff -- frontend/src/components/AdminSidebar.tsx frontend/src/app/admin/settings backend/src/api/routes/admin.js backend/src/api/validators/organizationValidators.js backend/src/services/OrganizationService.js packages/db/prisma/schema.prisma specs/003-schema-redesign/contracts/api.yaml docs/user-guides/organizers/admin-area.md
```

Expected: no whitespace errors; only intended settings-related edits are reviewed. Preserve all unrelated modified and untracked work already present on branch `005-create-event-rbac`.

**Step 6: Commit checkpoint (only if requested)**

Suggested message: `docs(admin): document business settings`

---

## Files likely to change

- `frontend/src/components/AdminSidebar.tsx`
- `frontend/src/app/admin/settings/page.tsx` (new)
- `frontend/src/app/admin/settings/BusinessDetailsDialog.tsx` (new)
- `frontend/src/app/admin/settings/types.ts` (new)
- `frontend/e2e/admin-settings.spec.ts` (new)
- `frontend/e2e/admin-mobile.spec.ts`
- `backend/src/api/routes/admin.js`
- `backend/src/api/validators/organizationValidators.js`
- `backend/src/services/OrganizationService.js`
- `backend/tests/contract/organizations.test.js`
- `packages/db/prisma/schema.prisma`
- `packages/db/prisma/migrations/<timestamp>_add_organization_business_details/migration.sql` (new)
- `specs/003-schema-redesign/contracts/api.yaml`
- `docs/user-guides/organizers/admin-area.md`
- Possibly `specs/005-create-event-rbac/spec.md` if this navigation change supersedes its Create Event sidebar requirement

## Risks and tradeoffs

1. **EIN sensitivity:** The existing stack has no field-level encryption mechanism. Masking API output reduces accidental exposure but does not protect plaintext at rest. Resolve encryption and key rotation before production use, or defer EIN persistence.
2. **Role semantics:** Existing `/organizations` CRUD is Admin-only while the admin layout admits Organizers. A dedicated current-user-scoped endpoint avoids weakening global organization management and blocks arbitrary organization IDs.
3. **Incomplete legacy organizations:** Nullable database columns permit a safe migration, while the settings form can require a complete address when the user first saves.
4. **Business-type vocabulary:** The screenshot shows one value but not the complete option set. Product should approve the exact dropdown values before they become persisted API vocabulary.
5. **Organization naming:** Reusing `Organization.name` avoids contradictory legal-name fields, but renaming it here also changes the name shown throughout current organization selectors and cards. That is intentional and should be verified.
6. **Existing dirty worktree:** The repository already contains many unrelated modifications and untracked files. Implementation must use scoped diffs and must not reset, reformat, stage, or overwrite unrelated work.

## Acceptance criteria

- Settings occupies the bottom-left sidebar location formerly used by Create Event.
- No Create Event quick action remains in that sidebar location; event creation still works from the Events page/routes.
- `/admin/settings` is available to Admin and Organizer users and inaccessible to Customers.
- The page has a settings-local left column with General selected and a responsive mobile arrangement.
- The company name and saved business details are readable in the main panel.
- Edit opens an accessible dialog with all ten requested business fields plus country/phone-country selectors represented in the reference.
- Validation, Discard, Save, loading, error, no-organization, and persistence states work.
- The backend derives organization scope from the authenticated user and cannot be pointed at another organization.
- Raw EIN does not appear in GET/PATCH responses or logs.
- Targeted backend tests, frontend E2E tests, lint, build, mobile/dark-mode checks, and `git diff --check` pass.
