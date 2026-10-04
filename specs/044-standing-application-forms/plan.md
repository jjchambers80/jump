# Spec 044 — Standing application forms (organization-level vendor applications)

**Status**: Plan, 2026-10-04. Nothing built.
**Ask**: an always-on "become a vendor" form at the organization level, built with the existing application-form pattern, opened from a call to action on a storefront page (first target: `/organizations/raleigh-retro-gamers/pages/vendors`) in a dialog / drawer. Mobile first, WCAG 2.2 AA. Admin UX in line with the current admin.

## 1. What exists today (origin/main 60c7a57)

| Piece | Where | Notes |
|---|---|---|
| `ApplicationForm` | `schema.prisma` | `eventId` **required**, `@@unique([eventId, slug])`, kind `PAID`/`FREE`, tiers, questions, status `DRAFT/OPEN/CLOSED`, `opensAt/closesAt` |
| `Application` | `schema.prisma` | `eventId` **required**; already carries `organizationId`, `contactId` (per-org `Contact`, gotcha 8), `profileId` |
| `ApplicantProfile` | `schema.prisma` | Already **organization-level** (`@@unique([organizationId, contactId])`): business name, description, website, socials, photos. Reused across every event application |
| `ApplicationFormTemplate` | spec 019 | Org-level JSON snapshot, materialised into event forms. Editor = `FormEditorCards` with `mode="template"` |
| Form editor UI | `components/applications/FormEditorCards.tsx` | `SettingsCard` / `TiersCard` / `QuestionsCard`, shared by event forms and templates |
| Review UI | `components/applications/SubmissionsTable.tsx` + `ApplicationService.*InScope` | One table, scope `{ eventId?, organizationId? }` (gotcha 18). Rows link to `/admin/events/:eventId/applications/:id` |
| Admin home for applications | Event workspace › **Applications** tab | Spec 037 removed `/admin/participants`; an applicant's cross-event history is on Customer detail |
| Decision emails | Settings › Applications (`ApplicationMessageTemplate`) | Merge fields include `event.name` / `event.date` (`ApplicationTemplateService.js:123`, already `?.`-safe) |
| Public apply form | `app/events/[eventId]/apply/[formSlug]/page.tsx` (512 lines) | Steps: Your details → Your business → Questions → Before you submit (consent, gotcha 17); multipart POST; lands on `/events/:eventId/apply/status/:id` |
| Page CTA hooks | `StorefrontPageBody.tsx`, `PageForm.tsx` | Page editor has sidebar cards (Visibility, Template); spec 042 templates add `contact_form` sections (SYSTEM_ADMIN only) |
| Dialog primitive | none | No Radix / vaul in `frontend`; existing dialogs are hand-rolled |
| The target page | prod `pages/vendors` | Plain Content › Pages HTML (video, "Interested in becoming a vendor?", vendor types list). No template |

**Gap**: every form and every application needs an event. Nothing can collect an application when no event is running.

## 2. Decision: one form model, event optional

**Recommended**: make the event optional on the existing models rather than add parallel tables.

- `ApplicationForm`: add `organizationId String` (backfilled through event → venue → organization, then `NOT NULL`), make `eventId` nullable. A form with `eventId = null` is a **standing form**.
- `Application.eventId` nullable.
- DB `CHECK (event_id IS NOT NULL OR kind = 'FREE')`: standing forms are **FREE only**. No tiers, no add-ons, no space selection, no payment, no capacity. That keeps `ApplicationPaymentService`, `applicationSelection`, capacity and check-in out of scope entirely: they only ever see event forms.
- Slugs: keep `@@unique([eventId, slug])`; add a partial unique index `(organization_id, slug) WHERE event_id IS NULL` (Postgres treats NULLs as distinct, so the existing index does not cover standing forms).

Why not separate `OrganizationApplicationForm` tables: questions, answers, decisions, profiles, emails, the review table and CSV would all fork — gotcha 18 says extend the scope, never fork.

Blast radius (audit list for phase 1): every per-event path already filters on `eventId` through `requireEvent`, so standing rows never appear there. The org-scoped paths do: `ApplicationService` (33 `event` dereferences: serializer, CSV `event`/`eventDate` columns, `_listOrder` `event` sort, status link), `ApplicationTemplateService` merge fields, `ApplicationDigestService` (5), `ApplicationFormTemplateService` (4), `listFormsInScope`, customer detail history, admin search. Each gets a null-event branch plus a test. Gotcha 18's "never a form with a null `eventId`" changes to "a null `eventId` is a standing form: FREE, no tiers".

## 3. Organizer UX (admin)

Decided 2026-10-04: **Customers stays the one place for every contact** — buyers, RSVPs, applicants, subscribers. Forms get their own builder; their submitters show up in Customers through a filter, not a second contact list.

### Customers: one contact list, filter by how they came in

Customers already has a **Customers | All contacts** toggle (spec 032 phase 3) and Segment / RSVP filters (`CustomerService.customerWhere`). Add one **Source** filter beside them, URL-backed like the others:

```
Customers                                                    [ Export ]
[ Customers | All contacts ]   [Search…]  Segment ▾  Source ▾  Tag ▾
                                          ┌─────────────────────────┐
                                          │ Any source              │
                                          │ Bought tickets          │
                                          │ RSVP'd                  │
                                          │ Subscribed (email opt-in)│
                                          │ Submitted a form      ▸ │ → Any form · Become a vendor · Press · …
                                          └─────────────────────────┘
```

- `source=form` (+ optional `formId`) → `applications: { some: { status ≠ DRAFT, form: { eventId: null, id? } } }`; `source=subscribed` → `emailSubscribed: true`; `source=tickets` → the current paid-orders predicate; `source=rsvp` replaces the separate RSVP select (kept as an alias so old URLs still work).
- Picking a form source flips the toggle to **All contacts** (a vendor applicant has no paid order, so the default Customers predicate would hide them — gotcha 29 keeps that default).
- Rows get small source chips (Tickets · RSVP · Form: Become a vendor), so a "vendor segment" is just a saved filter. Customer detail › Applications lists standing submissions with the form name where the event name goes.

### Forms: create the form and its fields

**Content › Forms** (`/admin/content/forms`), beside Files, Menus and Blog posts: a standing form is content you place on a page, and Content already owns that job. Forms are generic — "Become a vendor" is one an organizer makes, not a built-in type.

```
Content › Forms                                            [ New form ]
┌──────────────────────────────────────────────────────────────────────┐
│ ● Open    Become a vendor     14 new · 62 total    On: Vendors page  │
│ ○ Draft   Press request        0                   Not on a page     │
└──────────────────────────────────────────────────────────────────────┘
```

**New form** → name + **Start from** (Blank, the organization's FREE templates, so event vendor forms and standing forms share templates). Form detail `/admin/content/forms/:formId`, three URL-backed tabs:

| Tab | Content |
|---|---|
| **Submissions** (default) | `SubmissionsTable` with scope `{ organizationId, formId }` — same chips, search, tags, saved views, bulk decisions, CSV. Rows open `/admin/content/forms/:formId/submissions/:id`: the existing application detail body extracted into a shared component (no check-in, no money cards) |
| **Fields** | `QuestionsCard` (all question types, required, help text, options, pinned columns, archive-not-delete once answered) + **Collect business details** toggle (on: the Your business step with name, description, website, socials, photos — what vendors need; off: contact details + your questions only, for press, panelists, volunteers, waitlists) |
| **Settings** | `SettingsCard` with `mode="standing"`: name, slug, intro, status (Draft / Open / Closed), optional open/close window, button label, success message, **Pages** it appears on (§4) + the standalone link with Copy, Save as template |

Header actions: status pill, **Preview** (opens the drawer on the public page in a new tab), **Copy link**.

### Decisions and email

Same state machine and `DecisionDialog`: Approve / Waitlist / Reject. Every decision **sends an email** (the dialog already lets the organizer edit it before sending). Standing forms get their own default copy, since the event templates talk about events and spaces: Settings › Applications gains a **Standing forms** group (Received, Approved, Waitlisted, Rejected) whose merge fields are `form.name`, `organization.name`, `contact.firstName`, `statusUrl` — no `event.*`. Same `ApplicationMessageTemplate` table with a `scope` column (`EVENT` default, `STANDING`).

## 4. Public UX (the call to action)

### Attaching a form to a page

Page editor (`PageForm.tsx`) gets one more sidebar card, styled like Visibility / Template:

```
┌ Apply button ─────────────────────────┐
│ Form   [ Become a vendor          ▾ ] │
│ Label  [ Apply to be a vendor       ] │
│ ☑ Also pin the button on phones       │
└───────────────────────────────────────┘
```

`Page.applicationFormId` (nullable, FK `SetNull`) + `Page.applyLabel`. Organizers control it — no developer template upload needed. The public page payload adds `applyForm: { slug, name, label, status, intro }` only when the form is OPEN or CLOSED (DRAFT is invisible).

### On the page

- **CTA band** right under the page title (brand tokens via `BrandScope`, gotcha 6): one line of the form intro + the button. A second, quieter button after the content for people who read to the end.
- **Phones**: optional sticky bottom bar (safe-area inset, 48px target) that appears once the top CTA scrolls out of view and hides while the drawer is open.
- The button is an `<a href="/organizations/:org/apply/:formSlug">` — works without JS, shareable — that JS upgrades to open the drawer. `#apply` on the page URL opens it on load (link from Hero buttons, emails, socials).
- **CLOSED** form: the band says "Vendor applications are closed right now" plus the reopen date if `opensAt` is set; no button.

### The drawer

Native `<dialog>` + `showModal()` (focus trap, `Esc`, inert background, top layer for free — no new dependency).

| | Phone (< 640px) | ≥ 640px |
|---|---|---|
| Shape | Full-screen sheet sliding up, rounded top corners | Right-side panel, `min(560px, 100vw)` wide, full height |
| Header | Sticky: form name, step `2 of 4`, Close (44×44, `aria-label="Close"`) | Same |
| Body | Single column, the same four steps as the event apply page | Same |
| Footer | Sticky: Back · Continue / Submit, safe-area padding | Same |

- One step at a time on phones (progress = `<ol>` with `aria-current="step"`); all steps scroll on desktop with the stepper as anchors. Same `Step` / `QuestionField` / photo picker components as the event page — phase 2 extracts them from `apply/[formSlug]/page.tsx` into `components/applications/ApplyFormFields.tsx` so both routes and the drawer share them.
- Errors: inline under each field (`aria-invalid` + `aria-describedby`), an error summary at the top of the step that takes focus, first invalid field focused — the `ContactFormSection` pattern.
- Draft safety: values held in `sessionStorage` per form (try/catch); closing with unsaved input asks "Discard your application?".
- Motion: 200 ms slide/fade, none under `prefers-reduced-motion`.
- Success replaces the body: check icon, "Application sent", what happens next (the same 3-step list as the event page), **View your application** (status page) and **Done**. Focus moves to the success heading; a live region announces it.
- Signed-in buyers (`jump_buyer`) get contact + business prefilled from their `ApplicantProfile`.
- Consent: `acceptances` from `GET /legal/versions`, same as the apply form (gotcha 17).

### New public routes

- `/organizations/:org/apply/:formSlug` — the no-JS / shared-link page (same fields, page layout), also in `isReservedPath` + `storefrontHost.ts` (gotcha 22) and behind the store-access gate.
- `/organizations/:org/apply/status/:applicationId?token=` — standing status page (no space choice / pay sections).
- Backend: `GET /organizations/:orgId/public/apply/:formSlug`, `POST …/apply/:formSlug` (multipart, `APPLICATION_SUBMIT` limiter, honeypot), status `GET` by token. Writes the per-org `Contact` (`organizationId_email`) and `ApplicantProfile` exactly like the event path.

## 5. Phases (Kanban cards, each a PR with green CI)

1. **044A Model + service** — migration (organizationId backfill, nullable `eventId`s, FREE CHECK, partial unique slug, `collectBusiness`, `buttonLabel`, `successMessage`, message-template `scope`), standing create/update (FREE, no tiers), `ApplicationService` form scope + the §2 null-event branches, public form/submit/status routes, standing email defaults. Contract tests: standing submit creates the per-org Contact (+ profile when `collectBusiness`); per-event lists never include standing rows; PAID standing form refused; slug unique per org; decision sends the standing template.
2. **044B Admin forms** — Content › Forms list, New form with Start from, form detail tabs (Submissions / Fields / Settings), shared detail body, Settings › Applications standing group. Playwright with `signInAsStaff`, mobile + desktop.
3. **044C Customers source filter** — `source` / `formId` on `GET /admin/customers`, Source select, row chips, customer-detail label. Contract test per source; Playwright for the filter.
4. **044D Public drawer** — extract `ApplyFormFields`; standalone `/apply/:formSlug` + status routes; `Page.applicationFormId` / `applyLabel` + Page editor card; CTA band, sticky phone bar, `<dialog>` drawer. Vitest for step validation; Playwright (mocked API) at 390px and 1280px: open → validate → submit → success, keyboard-only, closed form.
5. **044E Invite to an event** (later) — single + bulk invite email with a prefilled event apply link.

Every frontend card is built with the `/frontend-design` skill inside the admin's Tailwind/shadcn conventions; storefront parts use `brand` tokens.

Ops after 044D ships: create "Become a vendor" for raleigh-retro-gamers, attach it to `pages/vendors`, point the Hero "Learn more" at `pages/vendors#apply`.

## 6. Decisions (2026-10-04)

1. Contacts: **Customers is the one central list** for buyers, RSVPs, form submitters and subscribers. Vendors are a Source filter, not a separate list. Forms are built in **Content › Forms**.
2. Standing forms are **never PAID**.
3. A decision **sends an email** (standing-form templates). No auto-invite to events.
4. **Several forms per organization, generic**: any name, any questions, business-details step optional.
