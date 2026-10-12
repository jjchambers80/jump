# Contacts (CRM hub)

Admin › **Contacts** (`/admin/contacts`, formerly Customers) is the organization's one contact list: ticket buyers, RSVPs, standing-form submitters and email subscribers. It has three tabs, headed by `frontend/src/app/admin/contacts/ContactsHeader.tsx`:

- **Contacts**: the list (`app/admin/contacts/page.tsx` → `ContactsList.tsx`) and each contact's detail page (`app/admin/contacts/[contactId]/`).
- **Lists**: saved groups of contacts (spec 055, §Lists below).
- **Forms**: standing application forms (spec 044), moved here from Content (`app/admin/contacts/forms/*`).

Old URLs 308 in `frontend/next.config.mjs`: `/admin/customers*` → `/admin/contacts*`, `/admin/content/forms*` → `/admin/contacts/forms*`.

## List

- Everyone is listed by default. **Show › Paying contacts** sends `scope=customers` (contacts with an order in `PAID_ORDER_STATUSES`).
- **Source** (Bought tickets, RSVP'd, Subscribed, Submitted a form → **Form** picker) and **Sort**. Search runs as you type (300 ms).
- `rsvp=going[&eventId=]` (from an event's RSVPs tab) and `tag=` show as removable chips.
- All list state lives in the URL (`customerListQuery` in `frontend/src/lib/customers.ts`) and is carried to the detail page, whose Previous / Next walk the same list.
- Phones get one card per contact; from `lg` it is a table (Name, Email, Source, Total spent, Last activity). The name link covers the row, so a row is one tab stop.
- Note, location and the email subscription are edited on the detail page, not in the list.

There are no customer segments (Prospect / New / Repeat / Lapsed were removed with this change, from the API too).

## Lists (spec 055)

- **Lists tab** (`app/admin/contacts/lists/page.tsx`): the three built-in lists (All contacts, Paying contacts, Email subscribers, defined in `backend/src/services/ContactListService.js`, read-only) and the store's own lists. It has search, Automatic / Manual chips and a row menu (`ActionsMenu`: Open, Edit list / Rename, Duplicate, Delete).
- **Create a list** (`ListFormDialog.tsx`, on `SettingsDialog`):
  - choose **Automatic** (saved filters, always current) or **Manual** (exactly the people added);
  - then name the list;
  - an automatic list gets the filter builder (`FilterFields.tsx`) and a live count from `POST /admin/contact-lists/preview`;
  - the same dialog edits a list, and the type never changes.
- **A list's page** (`lists/[listId]/page.tsx`) renders the same `ContactsList` with `listId`. Contents come from `GET /admin/customers?list=<id>`, so search, sort, paging and the detail page's Previous / Next walk the list. The detail page's back link returns to the list.
- **Filters** (one translator, `backend/src/services/contactListFilters.js`, shared with the Contacts query; all ANDed):
  - paying;
  - source (and standing form);
  - RSVP'd to an event;
  - bought tickets to an event;
  - tag;
  - spent at least $N;
  - active in the last N days.

  `describeFilters` (`frontend/src/lib/contactLists.ts`) says them in plain words.
- **Permission:** `customers.lists` (ORGANIZER by default) to create, edit, duplicate and delete. Viewing needs only the `customers` feature.
- **Picking members (055-C):**
  - Staff with `customers.lists` get row checkboxes on Contacts. A sticky "Selected contacts" bar offers **Add to list** (`lists/AddToListDialog.tsx`: an existing manual list or "New manual list…").
  - Once a whole page is ticked, **Select all N matching** sends the page's filters as `{ query }` to `POST /admin/contact-lists/:id/members`. The backend resolves them with `CustomerService.whereFor` inside the active organization, up to 10,000 contacts (409 `TOO_MANY_CONTACTS`).
  - A manual list's page has **Add contacts**, a link to `/admin/contacts?addTo=<id>` that preselects the list, and a **Remove from list** bulk action (picked rows only).
  - A contact's page shows a **Lists** card (`[contactId]/ContactListsCard.tsx`) with its manual lists, remove ×, and Add to list.
- **Still to come:** CSV import (055-D), CSV export (055-E).

## API

The endpoints keep their names: `GET /admin/customers` and `GET|PATCH /admin/customers/:id` (+ timeline, comments, export, erasure). With no `scope` the API still returns paying contacts only, so the frontend always sends `scope` (`customerApiQuery` for the detail call).

## Permissions

Catalog feature `customers` (label **Contacts**, `adminPaths: ['/admin/contacts']`) gates the list, the detail page and Forms; `/admin/standing-application-forms` is `requireFeature('customers')`. Actions: `customers.email`, `customers.comments`, `customers.privacy`, and `applications.standingForms` (build standing forms, ADMIN).
