# Contacts (CRM hub)

Admin › **Contacts** (`/admin/contacts`, formerly Customers) is the organization's one contact list: ticket buyers, RSVPs, standing-form submitters and email subscribers. It has two tabs, headed by `frontend/src/app/admin/contacts/ContactsHeader.tsx`:

- **Contacts**: the list (`app/admin/contacts/page.tsx`) and each contact's detail page (`app/admin/contacts/[contactId]/`).
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

## API

The endpoints keep their names: `GET /admin/customers` and `GET|PATCH /admin/customers/:id` (+ timeline, comments, export, erasure). With no `scope` the API still returns paying contacts only, so the frontend always sends `scope` (`customerApiQuery` for the detail call).

## Permissions

Catalog feature `customers` (label **Contacts**, `adminPaths: ['/admin/contacts']`) gates the list, the detail page and Forms; `/admin/standing-application-forms` is `requireFeature('customers')`. Actions: `customers.email`, `customers.comments`, `customers.privacy`, and `applications.standingForms` (build standing forms, ADMIN).
