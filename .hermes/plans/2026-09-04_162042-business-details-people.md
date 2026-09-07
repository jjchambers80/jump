# Business Details “People” Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Extend the existing General → business-details editor with an organization-scoped People section and an accessible Add person dialog containing first name, last name, date of birth, and “Assign as account representative,” while intentionally omitting the “Show optional fields” control and all fields behind it.

**Architecture:** Treat people as a child resource of the authenticated user’s organization rather than embedding them in the organization row or overloading the existing business-details PATCH. Add an `OrganizationPerson` Prisma model, expose organization-scoped list/create/delete endpoints under `/admin/settings/people`, and keep all tenant resolution server-side from `req.user.id`. Store date of birth as a date-only database value, but never return it in list/create responses or write it to logs; represent the single account representative with a boolean protected by a PostgreSQL partial unique index and update it transactionally.

**Tech Stack:** PostgreSQL, Prisma 6, Express 4, Jest/Supertest, Next.js 14, React 18, TypeScript, Tailwind CSS, Playwright.

---

## Scope and acceptance criteria

1. `Edit business details` contains a visually separate section titled `People` below the existing `About your business` fields.
2. The section helper text is `Add account representative, all owners, executives and directors`.
3. Existing people render as compact rows with initials, full name, role text, and a labeled remove action. In this release, the only role that can be assigned or displayed is `Account Representative`; a person without that flag should use neutral supporting text such as `Business person` rather than inventing an owner/executive/director role.
4. An `Add` control opens a second dialog matching the reference: title `Add person`, explanatory copy, First name, Last name, Date of birth split into Month/DD/YYYY controls, `Assign as account representative`, Cancel, Add, and close icon.
5. There is no `Show optional fields` switch and no hidden optional inputs in the DOM. Specifically out of scope: ownership percentage, owner/executive/director classification, job title, address, email, phone, tax ID/SSN, identity documents, and person editing.
6. All four visible data inputs are required. Add remains disabled until they are present; both client and server validate a real calendar date and reject future dates. Do not add a minimum-age rule unless product/legal supplies one.
7. Checking `Assign as account representative` atomically replaces the prior representative. The dialog helper text names the current representative when one exists.
8. Removing a row deletes only a person belonging to the requester’s organization. Removing the representative is allowed and leaves the organization with no representative.
9. Admin and Organizer users retain the current access policy; Customer receives 403; authenticated users without an organization receive 404.
10. Date of birth is accepted only on create, stored as a date-only value, omitted from all response DTOs, and excluded from application logs.
11. Adding/removing people persists immediately through dedicated endpoints. The parent dialog’s `Save`/`Discard` continues to govern business-detail fields only; people operations are not silently rolled back by `Discard`.
12. Desktop and 375px mobile layouts have no horizontal overflow, and nested dialog keyboard/focus behavior is correct.

## Architectural decisions from repository and standards research

- The current settings flow already resolves tenant ownership from `User.organizationId` in `backend/src/services/OrganizationService.js`; new people APIs must follow that pattern and must not accept `organizationId` from the client.
- People are not `User` records (authentication identities) or `Contact` records (ticket buyers). A dedicated `OrganizationPerson` avoids coupling compliance/business-verification data to either domain.
- A separate child-resource API avoids expanding the all-fields-required `/admin/settings/business-details` PATCH and avoids fragile array replacement semantics.
- Use `DateTime @db.Date` in Prisma and a canonical `YYYY-MM-DD` API string. Parse/serialize in UTC so JavaScript timezone conversion cannot shift the birthday by one day.
- A partial unique index on `organizationId WHERE isAccountRepresentative = true` is the PostgreSQL-native way to enforce zero-or-one representative per organization. Prisma cannot express this predicate in the schema, so create it explicitly in the SQL migration and document it next to the model.
- Server-side validation is mandatory even though the form validates client-side. OWASP recommends early syntactic and semantic validation, including structured dates and value ranges.
- Date of birth is personal data. Following data-minimization guidance, collect only the fields requested, do not expose DOB after creation, define a retention/deletion policy, and avoid request-body or field-value logging. OWASP logging guidance supports recording the actor/action/object/result while excluding or masking sensitive personal data.
- Do not introduce bespoke field encryption without an existing key-management design. Before production, verify encryption at rest for PostgreSQL and backups; application-level DOB encryption should be a separate security decision with KMS/key rotation, not ad hoc reversible crypto in this feature.

Research references:
- OWASP Input Validation Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html
- OWASP Logging Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
- PostgreSQL partial indexes: https://www.postgresql.org/docs/current/indexes-partial.html
- ICO data minimisation guidance: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-protection-principles/a-guide-to-the-data-protection-principles/data-minimisation/

---

### Task 1: Lock the API contract and privacy boundary

**Objective:** Define exact payloads, responses, errors, and intentional exclusions before implementation.

**Files:**
- Modify: `specs/003-schema-redesign/contracts/api.yaml`

**Step 1: Add failing contract expectations first**

In the tests planned in Task 4, write expectations against these contracts before adding routes:

- `GET /admin/settings/people` → `200 { people: OrganizationPersonSummary[] }`
- `POST /admin/settings/people` with `{ firstName, lastName, dateOfBirth: "YYYY-MM-DD", isAccountRepresentative }` → `201 OrganizationPersonSummary`
- `DELETE /admin/settings/people/{personId}` → `204` with no body

`OrganizationPersonSummary` should contain only:

- `id: string`
- `firstName: string`
- `lastName: string`
- `isAccountRepresentative: boolean`

It must not contain `dateOfBirth`, `organizationId`, or internal timestamps.

**Step 2: Document validation and error behavior**

Add OpenAPI schemas with `additionalProperties: false`. Require both trimmed names (1–100 characters), canonical date-only format, and an actual boolean. Document 400 for malformed/impossible/future dates, 401/403/404 consistently with business details, and 404 for a person ID outside the requester’s organization (do not reveal cross-tenant existence).

**Step 3: Document replacement semantics**

State that `isAccountRepresentative: true` removes that designation from any existing representative in the same transaction. `false` adds an unclassified business person. This release does not accept role arrays or optional KYC fields.

**Step 4: Validate the YAML**

Run:

`npx prettier --check specs/003-schema-redesign/contracts/api.yaml`

Expected: exit 0. If Prettier is not configured for this file, parse it with the repository’s available YAML tooling rather than installing a dependency solely for planning.

**Step 5: Commit**

`git add specs/003-schema-redesign/contracts/api.yaml && git commit -m "docs: define organization people API"`

---

### Task 2: Add the organization-person database model and invariant

**Objective:** Persist business people independently, with correct tenant ownership, date-only storage, cascade deletion, and one representative per organization.

**Files:**
- Modify: `packages/db/prisma/schema.prisma:84-105`
- Create: `packages/db/prisma/migrations/<timestamp>_add_organization_people/migration.sql`
- Modify: `docs/architecture/data-models.md:196-210` and relationship tables/diagram

**Step 1: Add a schema-level test/validation target**

Plan for the migration verification to prove:

- two ordinary people may belong to one organization;
- one representative may exist per organization;
- a second representative for the same organization violates the partial unique index;
- representatives in different organizations are allowed;
- deleting an organization cascades to its people.

**Step 2: Define `OrganizationPerson`**

Add fields:

- `id String @id @default(cuid())`
- `organizationId String`
- `firstName String`
- `lastName String`
- `dateOfBirth DateTime @db.Date`
- `isAccountRepresentative Boolean @default(false)`
- `createdAt DateTime @default(now())`
- `updatedAt DateTime @updatedAt`
- `organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)`
- `@@index([organizationId])`

Add `people OrganizationPerson[]` to `Organization`. Do not link this model to `User` or `Contact` and do not add future optional fields.

**Step 3: Generate and inspect the migration**

Run:

`npm run db:migrate -- --name add_organization_people --create-only`

Inspect the generated SQL, then add:

`CREATE UNIQUE INDEX "OrganizationPerson_one_account_representative_per_org" ON "OrganizationPerson" ("organizationId") WHERE "isAccountRepresentative" = true;`

Do not use a normal compound unique constraint on `(organizationId, isAccountRepresentative)`, because that would also incorrectly limit each organization to one non-representative.

**Step 4: Apply and validate**

Run:

- `npm run db:migrate`
- `npm run db:generate`
- `npx prisma validate --schema packages/db/prisma/schema.prisma`

Expected: migration applies, client generation succeeds, schema validates.

**Step 5: Update architecture documentation**

Document the new entity, 1:N Organization relationship, date-only semantics, representative invariant, cascade behavior, API non-disclosure of DOB, retention/deletion expectations, and the operational requirement for encrypted database/backups.

**Step 6: Commit**

`git add packages/db/prisma/schema.prisma packages/db/prisma/migrations docs/architecture/data-models.md && git commit -m "feat(db): add organization people"`

---

### Task 3: Add strict person validation

**Objective:** Normalize names and safely validate a canonical, real, non-future birth date and boolean flag.

**Files:**
- Create: `backend/src/api/validators/organizationPersonValidators.js`
- Create: `backend/tests/unit/organizationPersonValidators.test.js`

**Step 1: Write failing unit tests**

Cover:

- trims Unicode-capable first/last names without ASCII-only restrictions;
- requires non-empty first/last names and caps each at 100 characters;
- accepts leap day `2000-02-29`;
- rejects invalid format, rollover dates (`2025-02-29`, `2020-13-01`, `2020-01-32`), and a future date;
- requires `isAccountRepresentative` to be boolean rather than coercing strings/numbers;
- rejects unknown fields including `organizationId`, `roles`, and optional-field data;
- normalizes the accepted DOB to one UTC-safe value for Prisma while preserving date-only meaning.

Run:

`npm test --workspace=backend -- tests/unit/organizationPersonValidators.test.js --runInBand`

Expected: FAIL because the validator does not exist.

**Step 2: Implement the middleware**

Export `validateCreateOrganizationPerson`. Use an allowlist of exactly four request fields, full-string `YYYY-MM-DD` syntax checking, explicit component round-trip validation, and comparison against the current UTC calendar date. Do not infer or enforce age.

**Step 3: Re-run the unit test**

Run the same targeted command.

Expected: PASS.

**Step 4: Commit**

`git add backend/src/api/validators/organizationPersonValidators.js backend/tests/unit/organizationPersonValidators.test.js && git commit -m "feat(api): validate organization people"`

---

### Task 4: Implement tenant-scoped people service and API routes

**Objective:** Provide list/create/delete operations that cannot cross organization boundaries and safely replace the account representative.

**Files:**
- Create: `backend/src/services/OrganizationPersonService.js`
- Modify: `backend/src/api/routes/admin.js:4-45`
- Modify: `backend/tests/contract/organizations.test.js:157-343` (or split into `backend/tests/contract/organizationPeople.test.js` if isolation is cleaner)
- Create: `backend/tests/unit/organizationPersonService.test.js`

**Step 1: Write failing service tests**

Mock Prisma and verify that the service:

- resolves `organizationId` from the authenticated `userId`;
- returns null/no-organization result when absent;
- always filters list/delete by both `personId` and resolved `organizationId`;
- serializes only summary fields and never DOB;
- creates an ordinary person directly;
- for a representative, runs a transaction that clears the current flag only in the same organization and creates the new flagged person;
- logs event name, actor ID, organization ID, person ID, and action only—never names, DOB, or raw request data.

Run:

`npm test --workspace=backend -- tests/unit/organizationPersonService.test.js --runInBand`

Expected: FAIL because the service does not exist.

**Step 2: Implement `OrganizationPersonService`**

Keep tenant lookup in one private/helper method. Use explicit Prisma `select` clauses rather than returning full records. Sort list results predictably: representative first, then `createdAt` ascending (or name order, but encode the selected order in tests).

For representative creation, use an interactive transaction:

1. clear `isAccountRepresentative` on existing people for the resolved organization;
2. create the new person with the flag;
3. return the safe summary.

Translate a partial-unique conflict caused by concurrent representative assignments into a 409 with a stable message; never expose Prisma internals. Ordinary creation does not need the transaction.

For deletion, use a scoped `deleteMany({ where: { id: personId, organizationId } })` or equivalent scoped lookup + delete and return not-found when count is zero. This prevents an ID from another tenant being deleted or distinguished.

**Step 3: Write failing contract tests**

Add database-backed Supertest coverage for:

- authorized Admin and Organizer list/create/delete;
- 403 Customer;
- 404 no assigned organization;
- 400 validation and unknown fields;
- safe response shape with no DOB;
- ordinary multi-person creation;
- representative replacement and persisted single-representative invariant;
- deletion success (204);
- same-tenant missing ID and cross-tenant ID both return 404 and do not delete the other tenant’s row.

Run:

`npm test --workspace=backend -- tests/contract/organizationPeople.test.js --runInBand`

Expected: FAIL with route 404 before implementation.

**Step 4: Add routes**

Under the existing `requireAuth` + `requireOrganizer` admin router, add:

- `GET /settings/people`
- `POST /settings/people` with validator
- `DELETE /settings/people/:personId`

Keep request/response mapping thin and delegate tenant logic to the service. Return 201, 204, 400/403/404/409 exactly as contracted.

**Step 5: Run unit and contract tests**

Run:

- `npm test --workspace=backend -- tests/unit/organizationPersonValidators.test.js tests/unit/organizationPersonService.test.js --runInBand`
- `npm test --workspace=backend -- tests/contract/organizationPeople.test.js --runInBand`

Expected: all targeted tests PASS.

**Step 6: Commit**

`git add backend/src/services/OrganizationPersonService.js backend/src/api/routes/admin.js backend/src/api/validators/organizationPersonValidators.js backend/tests && git commit -m "feat(api): manage organization people"`

---

### Task 5: Add frontend person types and People section

**Objective:** Load and render safe person summaries in the existing business-details dialog with loading, empty, error, remove, and success states.

**Files:**
- Modify: `frontend/src/app/admin/settings/types.ts`
- Modify: `frontend/src/app/admin/settings/BusinessDetailsDialog.tsx:73-329`
- Create: `frontend/src/app/admin/settings/PeopleSection.tsx`

**Step 1: Extend Playwright mocks with failing display tests**

In `frontend/e2e/admin-settings.spec.ts`, mock `GET /admin/settings/people` and add a test that opens `Edit business details` and expects:

- `People` heading and exact helper copy;
- safe person row with initials and full name;
- `Account Representative` text only when flagged;
- `Add` control;
- no date of birth displayed.

Run:

`npm test --workspace=frontend -- admin-settings.spec.ts --grep "renders people"`

Expected: FAIL because the section does not exist.

**Step 2: Define API types**

Add `OrganizationPersonSummary` and `CreateOrganizationPersonPayload` with the exact API fields. Do not add DOB to the summary type.

**Step 3: Build `PeopleSection`**

Responsibilities:

- fetch `/admin/settings/people` when the business-details dialog opens;
- render skeleton/loading text without blocking editing existing business fields;
- render an inline retry state on GET failure;
- render rows and an Add button;
- derive initials defensively from trimmed names;
- expose a descriptive remove button such as `Remove Betty Roman` instead of an unlabeled trash icon;
- confirm deletion, call DELETE, then remove the row from local state only after success;
- keep the row and show an inline error if DELETE fails;
- announce add/remove success through an `aria-live` region.

Use text or an existing project-safe icon approach; do not introduce a new icon dependency for one trash glyph.

**Step 4: Integrate below About your business**

Do not place People inside the existing `<fieldset>` if its `disabled={saving}` state or legend semantics would conflate resources. Render it as a sibling section below the business fields with a border/top spacing matching the reference. People API mutations should have their own pending state and must not alter the parent business form’s dirty calculation.

**Step 5: Re-run the display test**

Expected: PASS.

**Step 6: Commit**

`git add frontend/src/app/admin/settings/types.ts frontend/src/app/admin/settings/BusinessDetailsDialog.tsx frontend/src/app/admin/settings/PeopleSection.tsx frontend/e2e/admin-settings.spec.ts && git commit -m "feat(settings): show organization people"`

---

### Task 6: Build the accessible Add person dialog

**Objective:** Match the provided dialog with only the requested fields and robust nested-modal behavior.

**Files:**
- Create: `frontend/src/app/admin/settings/AddPersonDialog.tsx`
- Modify: `frontend/src/app/admin/settings/PeopleSection.tsx`
- Modify: `frontend/src/app/admin/settings/BusinessDetailsDialog.tsx`
- Modify: `frontend/e2e/admin-settings.spec.ts`

**Step 1: Write failing interaction tests**

Add Playwright tests that verify:

- Add opens a dialog named `Add person`;
- first focus lands on First name;
- exact controls exist: First name, Last name, Month, DD, YYYY, Assign as account representative, Cancel, Add, close;
- `Show optional fields` and known optional labels do not exist;
- Add is disabled until all required inputs are complete;
- invalid date and future date show clear inline errors without POST;
- checkbox helper names the existing representative;
- successful POST uses canonical `YYYY-MM-DD`, updates the list, replaces role display, closes the child dialog, and restores focus to Add;
- API failure leaves the dialog open with values intact and a form-level error;
- Cancel, close, and Escape discard child-form state only;
- Tab/Shift+Tab remain trapped in the active child dialog;
- Escape while child is open does not also close the parent dialog.

Run:

`npm test --workspace=frontend -- admin-settings.spec.ts --grep "Add person"`

Expected: FAIL because the child dialog does not exist.

**Step 2: Implement date inputs and validation**

Use a select for Month and numeric text inputs for day/year to match the reference. Generate month labels locally; constrain day/year input lengths and input modes, but validate the composed date with component round-trip rather than relying on HTML min/max alone. Build the POST payload only after valid composition.

Do not store a JavaScript `Date` in form state; keep components as strings and send a date-only string to avoid timezone shifts.

**Step 3: Implement dialog behavior**

Follow the existing dialog visual conventions, but correct nested behavior:

- child has `role="dialog"`, `aria-modal="true"`, labeled title, and form-level error `role="alert"`;
- child traps focus and restores it to Add on unmount;
- while the child is active, suspend the parent document-level Escape and focus-trap handler so one Escape cannot close both dialogs;
- prevent backdrop clicks inside the panel from closing either dialog;
- disable controls while POST is pending and guard duplicate submission;
- Cancel and close do not submit;
- `Add` displays pending text and closes only after a successful 201.

If practical without a new dependency, render the child through a React portal and mark the parent modal content inert/`aria-hidden` while the child is active. Otherwise, explicitly manage event handling and focus so only the topmost modal is interactive; verify with Playwright and axe.

**Step 4: Wire representative messaging**

When a current representative exists, show: `A verified person with authority to make financial decisions for your business. Currently set to <name>.` If none exists, omit the final sentence. Do not claim the person is verified unless verification status actually exists in the data model; use product-approved neutral wording if that statement is not yet true.

**Step 5: Re-run interaction tests**

Expected: all Add person tests PASS.

**Step 6: Commit**

`git add frontend/src/app/admin/settings/AddPersonDialog.tsx frontend/src/app/admin/settings/PeopleSection.tsx frontend/src/app/admin/settings/BusinessDetailsDialog.tsx frontend/e2e/admin-settings.spec.ts && git commit -m "feat(settings): add business people dialog"`

---

### Task 7: Complete deletion, responsive, accessibility, and failure coverage

**Objective:** Verify the entire user journey and prevent regressions in security, accessibility, and mobile layout.

**Files:**
- Modify: `frontend/e2e/admin-settings.spec.ts`
- Modify as needed for fixes only: `frontend/src/app/admin/settings/AddPersonDialog.tsx`
- Modify as needed for fixes only: `frontend/src/app/admin/settings/PeopleSection.tsx`
- Modify as needed for fixes only: `frontend/src/app/admin/settings/BusinessDetailsDialog.tsx`

**Step 1: Add failing end-to-end cases**

Cover:

- deletion confirmation and 204 success;
- deletion cancellation sends no request;
- deletion failure preserves row and announces error;
- empty-state layout;
- list-fetch retry;
- add representative replacement in rendered list;
- 375×812 viewport has no horizontal overflow with parent and child dialogs;
- long names wrap without pushing controls off-screen;
- dark mode remains legible if existing tests support it;
- `@axe-core/playwright` finds no serious/critical violations in both modal states.

**Step 2: Make minimal UI fixes**

Address only failures found by these tests. Preserve existing business-details save and EIN behavior.

**Step 3: Run targeted frontend suite**

Run:

`npm test --workspace=frontend -- admin-settings.spec.ts`

Expected: all settings tests PASS.

**Step 4: Commit**

`git add frontend/src/app/admin/settings frontend/e2e/admin-settings.spec.ts && git commit -m "test(settings): cover people management"`

---

### Task 8: Full verification and documentation consistency

**Objective:** Prove the schema, backend, frontend, and contracts work together without regressing the in-progress business-details implementation.

**Files:**
- Modify only if verification exposes a defect in files already listed above.

**Step 1: Check generated/database artifacts**

Run:

- `npx prisma validate --schema packages/db/prisma/schema.prisma`
- `npm run db:generate`
- `npm run build --workspace=packages/db`

Expected: all exit 0.

**Step 2: Run backend quality gates**

Run:

- `npm run lint --workspace=backend`
- `npm run test:unit --workspace=backend -- --runInBand`
- `npm run test:contract --workspace=backend -- --runInBand`

Expected: all exit 0. If contract tests require PostgreSQL, point them at the documented test database and apply the new migration first; report infrastructure blockers honestly.

**Step 3: Run frontend quality gates**

Run:

- `npx tsc --noEmit -p frontend/tsconfig.json`
- `npm run build --workspace=frontend`
- `npm test --workspace=frontend -- admin-settings.spec.ts`

Expected: all exit 0.

**Step 4: Manually verify the reference flow**

With backend on port 3002 and frontend on 3001:

1. Open `/admin/settings` as an assigned Admin/Organizer.
2. Open Edit business details.
3. Confirm People section placement and reference styling.
4. Add an ordinary person and confirm no DOB is displayed or returned by GET.
5. Add a representative and confirm the previous representative loses the label.
6. Delete both ordinary and representative rows.
7. Reopen the parent dialog and confirm persistence.
8. Confirm parent Discard does not undo already completed people mutations.
9. Repeat at mobile width and by keyboard only.
10. Inspect application logs to confirm no names or DOB values were logged.

**Step 5: Review the diff against scope**

Run:

`git diff --check && git status --short`

Confirm there are no optional-field controls, no role infrastructure beyond the account-representative boolean, no client-supplied organization IDs, no DOB in response DTOs, and no unrelated edits. Because the working tree already contains substantial uncommitted work, stage only paths from this plan and never overwrite or revert pre-existing changes.

---

## Files likely to change

- `packages/db/prisma/schema.prisma`
- `packages/db/prisma/migrations/<timestamp>_add_organization_people/migration.sql`
- `backend/src/api/routes/admin.js`
- `backend/src/api/validators/organizationPersonValidators.js` (new)
- `backend/src/services/OrganizationPersonService.js` (new)
- `backend/tests/unit/organizationPersonValidators.test.js` (new)
- `backend/tests/unit/organizationPersonService.test.js` (new)
- `backend/tests/contract/organizationPeople.test.js` (new, preferred) or `backend/tests/contract/organizations.test.js`
- `frontend/src/app/admin/settings/types.ts`
- `frontend/src/app/admin/settings/BusinessDetailsDialog.tsx`
- `frontend/src/app/admin/settings/PeopleSection.tsx` (new)
- `frontend/src/app/admin/settings/AddPersonDialog.tsx` (new)
- `frontend/e2e/admin-settings.spec.ts`
- `specs/003-schema-redesign/contracts/api.yaml`
- `docs/architecture/data-models.md`

## Risks and mitigations

- **DOB privacy:** Keep it write-only at the API after creation, omit it from logs and DTOs, scope every operation by organization, define retention, and verify infrastructure encryption before production.
- **Timezone corruption:** Treat DOB as a date-only string at the API boundary and use UTC-safe parsing/serialization for Prisma `@db.Date`.
- **Representative race:** Enforce the invariant in PostgreSQL with a partial unique index in addition to transactional service logic; map conflicts to 409.
- **Cross-tenant IDOR:** Resolve organization from the authenticated user and include it in every list/delete/update predicate; never trust an organization ID from the browser.
- **Nested-modal Escape/focus bugs:** Suspend the parent modal handlers while the child is open and test keyboard behavior explicitly.
- **Unexpected save semantics:** People mutate immediately and separately from business details. Make this behavior clear in tests and do not mark the parent form dirty for successful people operations.
- **Migration conflicts:** The schema and business-details migration are currently uncommitted. Generate the new migration only after the existing `20260904001200_add_organization_business_details` migration and inspect SQL rather than recreating or editing earlier migrations.
- **Misleading verification copy:** The model has no verification status. Do not assert that a person is verified unless that lifecycle exists; use neutral product copy if needed.

## Open product/security questions (non-blocking defaults used by this plan)

1. **Minimum age:** Default is only “valid and not future.” Add an age threshold only after product/legal specifies it.
2. **Verification wording:** Default is neutral because no verification state/provider exists yet.
3. **Role display:** Default is `Account Representative` or `Business person`; `Executive`, `Owner`, and `Director` are not inferred and remain out of scope with the optional fields.
4. **Retention:** Product/legal must define how long DOB is retained and whether deleting a person is hard deletion or requires an audit tombstone. MVP default is hard deletion with an audit log containing identifiers/actions but no PII.
5. **Encryption:** Default is database/backup encryption at rest. Application-level field encryption requires a separate KMS and rotation design before being added.
