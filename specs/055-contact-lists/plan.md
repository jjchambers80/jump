# Spec 055 — Contact lists (Contacts › Lists)

Status: **Planned** (2026-10-12). Follows PR #452, which made Contacts the CRM hub (Contacts | Forms tabs). Reference: Zeffy's Contacts › Lists tab and its "Create a list" dialog.

## 1. Problem

A store can filter Contacts (paying, source, form, RSVP'd to an event, tag), but it cannot **name and keep** a group of people:

- "Vendors from the spring market", "VIP buyers" and "Volunteers 2026" have to be rebuilt from filters every time, and some groups cannot be filtered at all.
- Nobody can hand-pick people into a group, or bring in a group that lives in a spreadsheet.
- Nothing exports contacts. The only way to get a group out of Jump is to copy it from the screen.

There is no model for any of this today. Staff cannot create a contact, import contacts or export the contact list (`CustomerService` reads only; contacts are created only by checkout, apply, RSVP and the buyer account).

## 2. Goal

A **Lists** tab between Contacts and Forms, where a store:

1. sees every list with its type, size, who created it and when it last changed;
2. creates a list with the dialog in §4.4: **Automatic** (contacts join and leave by filters, always current) or **Manual** (exactly the people you put in);
3. fills a manual list by picking from Contacts, adding people from the list itself, or **importing a CSV**;
4. opens a list to see its contacts in the same table as Contacts, and **exports it as CSV**.

Out of scope (later specs):
- sending email to a list (campaigns: consent, deliverability, CAN-SPAM);
- Companies;
- AND/OR rule groups;
- list-based automations.

The Zeffy envelope icon on each row does not exist in v1.

## 3. Decisions (owner, 2026-10-12)

1. **CSV import creates contacts it does not find, never subscribed.** A file is no proof of email consent, so an imported contact gets `emailSubscribed: false` and no `LegalAcceptance` row, whatever the file says. An email already in Contacts (matched per organization through `normalizeEmail`, Gotcha 8) joins the list unchanged; Jump never overwrites a name, phone or opt-in from a file. A results screen reports how many rows were added, created and skipped, and why each skipped row was skipped.
2. **Three built-in automatic lists per store:**
   - All contacts;
   - Paying contacts (`PAID_ORDER_STATUSES`);
   - Email subscribers.

   They are defined in code, not stored as rows, and show as "Automatically created". They cannot be edited or deleted.
3. **v1 list actions are View and Export CSV.** Export is a privileged action (§4.7). Email to a list waits for a campaigns spec.
4. **Automatic-list filters:**
   - Today's Contacts filters: paying, source (tickets / RSVP'd / subscribed / submitted a form), standing form, RSVP'd to event, tag.
   - New: **bought tickets to event X**, **total spent ≥ $N**, **last activity within N days**.
   - All filters are ANDed. There are no OR groups.

## 4. Design

### 4.1 Model

```prisma
model ContactList {
  id             String          @id @default(cuid())
  organizationId String
  name           String          // unique per org, case-insensitive (service check + index on lower(name))
  type           ContactListType // AUTOMATIC | MANUAL
  filters        Json?           // AUTOMATIC only; validated shape, §4.2
  createdById    String?         // User; null after the user is deleted
  createdAt      DateTime        @default(now())
  updatedAt      DateTime        @updatedAt
  organization   Organization    @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  createdBy      User?           @relation(fields: [createdById], references: [id], onDelete: SetNull)
  members        ContactListMember[]
  @@index([organizationId])
}

model ContactListMember {
  listId    String
  contactId String
  addedById String?   // null = import or system
  source    ContactListMemberSource // MANUAL | PICKED | IMPORT
  addedAt   DateTime  @default(now())
  list      ContactList @relation(fields: [listId], references: [id], onDelete: Cascade)
  contact   Contact     @relation(fields: [contactId], references: [id], onDelete: Cascade)
  @@id([listId, contactId])
  @@index([contactId])
}

enum ContactListType { AUTOMATIC MANUAL }
enum ContactListMemberSource { MANUAL PICKED IMPORT }
```

- **Tenancy:** a member's contact must belong to the list's organization. The service checks every write, so a contact id from another org answers 404, never a silent add. Lists are read only through `activeOrgFor(req)`.
- **Members only for MANUAL lists.** An AUTOMATIC list has no member rows; its contacts are its filters (§4.2).
- **Audit (spec 048):** add `ContactList` and `ContactListMember` to `backend/src/audit/features.js` under the Customers feature.
- **Patron data rights (Gotcha 30):** `BuyerDataExportService.build` lists the names of the manual lists the contact is on, and `ContactErasureService.erase` deletes their `ContactListMember` rows. A list is staff data about a person; the anonymized row must not stay in "VIP buyers".

### 4.2 Filters (automatic lists)

`filters` is a whitelisted object, validated on write by `validateContactListFilters` (`api/validators/contactListValidators.js`). Unknown keys are a 400.

| Key | Value | Meaning |
|---|---|---|
| `scope` | `'customers'` | has a paid order (`PAID_ORDER_STATUSES`) |
| `source` | `tickets \| rsvp \| subscribed \| form` | as on Contacts |
| `formId` | standing form id (requires `source: 'form'`) | as on Contacts |
| `rsvpEventId` | event id | GOING RSVP to that event |
| `tag` | string | `tags has` |
| `ticketEventId` | event id | **new:** a paid ticket order for that event |
| `minSpent` | number ≥ 0 (dollars) | **new:** gross paid total ≥ N (same sum as `totalSpent`) |
| `activeWithinDays` | 1–3650 | **new:** latest paid order within N days (same date as `lastActivityAt`) |

- **One translator.** `customerWhere` in `CustomerService` is extended to take these keys, so the Contacts list, list contents, counts and export all share it. Never write a second filter builder.
- **`minSpent` cannot be a Prisma relation filter** (it needs `SUM`). It resolves to `id IN (SELECT contactId … GROUP BY contactId HAVING SUM(totalAmount) >= $1)` with `prisma.$queryRaw` scoped to the organization.
  - `ponytail:` the subquery scans the org's paid orders. Materialize a per-contact total if a store passes ~100k orders.
- **Built-in lists** are the same filter objects with fixed ids: `builtin:all` → `{}`, `builtin:paying` → `{ scope: 'customers' }`, `builtin:subscribers` → `{ source: 'subscribed' }`.
- An event or form a filter points at may be deleted later. The filter then matches nobody, and the list page says "This list filters on an event that no longer exists".

### 4.3 API (`backend/src/api/routes/contactLists.js`, under `requireFeature('customers')`)

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/contact-lists?search=&type=` | Built-ins first, then the org's lists. Each row has `id, name, type, builtIn, contactCount, createdBy {id, name} \| null, lastActivityAt` (updatedAt, or the latest member `addedAt` for manual lists) |
| POST | `/admin/contact-lists` | `{ name, type, filters? }`. 409 `LIST_NAME_TAKEN` |
| GET | `/admin/contact-lists/:id` | meta + `filters` + `filterWarnings` |
| PATCH | `/admin/contact-lists/:id` | `{ name?, filters? }`. Type never changes. Built-ins answer 403 `BUILT_IN_LIST` |
| DELETE | `/admin/contact-lists/:id` | Deletes the list and its memberships, never contacts |
| POST | `/admin/contact-lists/:id/duplicate` | "Copy of …"; manual lists copy their members |
| POST | `/admin/contact-lists/preview` | `{ filters }` → `{ count, sample: first 5 }` for the builder's live count |
| GET | `/admin/customers?list=<id>` | **List contents reuse the Contacts list endpoint**: `list` ANDs the list's filters or memberships into `customerWhere`. Search, sort and pagination work unchanged, and so do detail-page Previous / Next |
| POST | `/admin/contact-lists/:id/members` | `{ contactIds: [...] }` (≤ 500), MANUAL only, idempotent (`skipDuplicates`). → `{ added, alreadyOn }` |
| DELETE | `/admin/contact-lists/:id/members` | `{ contactIds }` |
| POST | `/admin/contact-lists/:id/import` | multipart CSV, §4.6 |
| GET | `/admin/contact-lists/:id/export.csv` | §4.7 |
| GET | `/admin/customers/:id/lists` | manual lists this contact is on (detail page card) |

- Writes need the catalog action **`customers.lists`**, which ORGANIZER also gets by default (lists are not money or privacy).
- Import needs **`customers.import`** and export needs **`customers.export`**. Both are ADMIN-only by default, both need step-up (`requireRecentAuth` / `withReauth`), and both are rate limited (`CONTACT_IMPORT` 10 / hour, `CONTACT_EXPORT` 20 / hour per IP, `makeLimiter`).
- The contract tests pin `permissionService._cache` and assert:
  - a role with `customers` hidden gets 403 on every route;
  - a role without the action gets 403 on writes, import and export.

### 4.4 "Create a list" dialog (frontend)

Built on `useDialog` / `role="dialog"`. Focus starts on the first option and is trapped inside; Escape and Cancel close it, and focus returns to **New list**.

1. **How do you want to build this list?** A radio group of two cards: native `<input type="radio">` with the label wrapping the whole card, so arrow keys work.
   - **Automatic list**: "Contacts are added automatically when they match your filters. The list stays up to date on its own."
   - **Manual list**: "You choose exactly who's in it: add contacts by hand, import a file, or pick from your contacts."

   Automatic is preselected. **Continue** moves on.
2. **Name** (required, 1–80 characters; a duplicate shows the error inline under the field).
   - **Automatic** adds the filter builder in the same dialog: one labelled row per filter in §4.2. Each filter is optional; event and form pickers are comboboxes. The dialog shows a live "**N contacts** match" (`aria-live="polite"`, debounced 300 ms, from `/preview`).
   - **Manual** offers "Start with": Empty · Import a CSV · Pick from Contacts.
3. **Create list.**
   - Automatic opens the list page.
   - Manual with Import opens the import step (§4.6).
   - Manual with Pick opens Contacts in select mode for that list (§4.5).

On phones the dialog is a full-height sheet with a sticky footer for Cancel / Continue. Every control is at least 44 px tall.

### 4.5 Pages

- **Lists tab** (`/admin/contacts/lists`, third tab in `ContactsHeader`):
  - toolbar: search plus two toggle chips, **Automatic** and **Manual** (`aria-pressed`);
  - **New list** primary button (gated by `useCan('customers.lists')`);
  - table from `lg`: List name · Type badge · Contacts · Created by ("Automatically created" for built-ins) · Last activity (relative, absolute in `title`) · row menu;
  - cards on phones;
  - row menu (a `button` with `aria-haspopup="menu"`): Open, Rename, Edit filters (automatic), Duplicate, Export CSV (with `customers.export`), Delete (confirm dialog that names the list and its size);
  - built-ins show Open and Export only.
- **List page** (`/admin/contacts/lists/[listId]`):
  - header with name, type badge, count and a filter summary in plain words (e.g. "Bought tickets to Spring Market · spent at least $50");
  - actions: Edit, Add contacts / Import (manual), Export CSV;
  - body: **the Contacts table component extracted from `app/admin/contacts/page.tsx`** (`ContactsTable`, one component, never a fork), driven by `?list=`;
  - manual lists add row checkboxes and a "Remove from list" bulk action.
- **Contacts tab select mode:** a checkbox column and a sticky bulk bar, "N selected · Add to list ▾ · Clear". "Add to list" is a combobox of manual lists plus "New manual list…". Selection covers the current page; a "Select all N matching" link adds every match server side (`POST …/members` with `{ fromQuery }` → resolves `customerWhere`, capped at 10,000).
- **Contact detail:** a **Lists** card with the manual lists the contact is on (remove ×) and "Add to list". Automatic lists are not shown there, because they are not a stored fact about the person.

### 4.6 CSV import (manual lists)

- **Upload:** `.csv`, ≤ 5 MB, ≤ 10,000 rows, UTF-8 (BOM stripped).
- **Map columns:** the first row is the header, and Email is required. Jump auto-maps `email`, `first name` / `firstname` / `first`, `last name`, `name` (split on the last space), `phone` and `tags`, and the user can change any mapping with a select per column. Preview the first 5 rows.
- **The server re-validates everything** (never trusts the mapping preview). Per row:
  - normalize the email (`normalizeEmail`); invalid → skipped "invalid email", repeat in the file → skipped "duplicate in file";
  - look the email up by `organizationId_email`;
  - found → add membership (or "already on list");
  - not found → `upsertContactFillBlanks` creates the contact with `emailSubscribed: false` (no `emailSubscribedSource`, no `LegalAcceptance`) and adds the membership;
  - tags from the file are added to the contact's tags, never replacing them;
  - an erased or erasure-scheduled contact is skipped with "contact asked to be deleted".
- **Batches of 500 in transactions.** A failed batch reports its rows and the rest continue. The request is synchronous up to the 10,000-row cap. `ponytail:` move it to a background job with progress if imports get bigger.
- **Results:** "N added · M new contacts · K already on the list · S skipped". The skipped rows can be downloaded as a CSV with a reason column.
- **Timeline:** one `ContactComment` per created contact, authored by the importing staff member: "Created by import into *List*". A null author would mean the buyer did it (spec 040).
- **Safety:** there is no CSV library in the repo, and none is added. A small RFC 4180 parser goes in `backend/src/utils/csv.js` (quotes, escaped quotes, embedded newlines, CRLF, BOM) with a unit test. Cells are stored as text, never evaluated. The export (§4.7) neutralizes formula injection.

### 4.7 CSV export

- **Columns:** First name, Last name, Email, Phone, Tags, Subscribed (Yes/No), Sources, Total spent, Last activity, Created. Streamed in pages of 1,000.
- **Formula injection:** any cell starting with `= + - @`, a tab or a CR gets a leading `'` (OWASP CSV injection). Move `csvCell` from `backend/src/audit/AuditLogService.js` (it already does this) into `utils/csv.js` and reuse it. `OrderService`'s copy lacks the guard, so switch it to the shared one in the same card.
- **Filename:** `<list-slug>-contacts-YYYY-MM-DD.csv`.
- **Audit:** an audit log entry `CONTACT_LIST_EXPORTED` (list id, row count, user).
- **Permissions:** `customers.export` (ADMIN) plus step-up.
- **The Contacts tab gets the same export** for its current filters (`GET /admin/customers/export.csv?...`), so a list is never needed just to export.

## 5. Phases / cards

| Card | Scope | Depends on |
|---|---|---|
| **055-A** Model + API | Migration, `ContactListService`, filter validator, `customerWhere` extension (new keys, `list=`), built-ins, list CRUD / duplicate / preview / members routes, catalog actions `customers.lists` / `.import` / `.export`, audit mapping, export/erase coverage, contract + unit tests | — |
| **055-B** Lists tab + create dialog | `ContactsHeader` third tab, Lists page, create dialog with filter builder and live count, list page using the extracted `ContactsTable`, rename / edit / duplicate / delete, Playwright + axe at 375 and 1280 | A |
| **055-C** Picking members | Contacts select mode + bulk "Add to list", "Select all N matching", list page remove, contact detail Lists card | A, B |
| **055-D** CSV import | Upload → map → results flow, server import, skipped-rows CSV, limiter, step-up | A, B |
| **055-E** CSV export | List + Contacts export, formula neutralization, audit entry, step-up, docs (`docs/wiki/features/contacts.md` Lists section, AGENTS gotcha) | A |

B and E can run in parallel after A, and so can C and D after B.

## 6. Tests

- **Unit:**
  - the filter validator (each key, unknown key, `formId` without `source`);
  - `customerWhere` with every new key;
  - CSV parser (quotes, embedded newlines, BOM, CRLF);
  - formula neutralization;
  - name split.
- **Contract:**
  - tenancy (another org's list or contact → 404; a cross-org contact id in `members` → 404);
  - built-ins are read-only;
  - duplicate name 409;
  - `minSpent` / `activeWithinDays` / `ticketEventId` boundaries;
  - list contents equal `GET /admin/customers` with the same filters;
  - import creates unsubscribed contacts and never changes an existing contact's name or opt-in;
  - erasure removes memberships;
  - the buyer export lists the list names;
  - permissions (feature hidden 403; action missing 403; ORGANIZER can write lists but not import or export);
  - limiter wiring.
- **Playwright** (mocked API, `signInAsStaff`):
  - the create dialog with keyboard only (arrow keys between the radio cards, Enter continues, Escape closes and returns focus);
  - the automatic builder's live count;
  - manual pick from Contacts;
  - the import mapping and results;
  - the list page;
  - axe with no violations on the tab, dialog and list page at 375 and 1280.

## 7. Risks

- **Consent:** imported people are never emailed by Jump today. If campaigns come later they must send only to `emailSubscribed: true`, and import must never set it. Keep that line in the campaigns spec.
- **Big automatic lists:** the counts run one query per list on the Lists page (≤ 20 rows plus 3 built-ins). Fine at today's sizes; cache counts for 60 s per org if the page slows.
- **Deleted filter targets** make a list quietly empty. The list page warning (§4.2) covers it.
- **Import abuse:** 10k rows × 10 imports per hour per IP, ADMIN plus step-up only, so imports cannot be turned into spam (Jump sends nothing to imported contacts).

## 8. Open questions

None blocking. Later: campaigns ("Email this list"), Companies, OR groups, list-triggered automations, scheduled exports.
