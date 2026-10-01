# Page templates + contact form

**Status:** Implemented (spec 042)
**Last Updated:** 2026-10-01

## Overview

The Online store › Pages editor has a right column on desktop (stacks under the content on phones) with **Visibility** (Visible / Hidden) and, under it, **Template**. Templates are declarative JSON manifests a developer (`SYSTEM_ADMIN`) uploads to one organization from `/admin/online-store/page-templates`; once uploaded they appear in that organization's Template menu. "Default page" keeps today's layout.

The first shipped template is **contact** (`templates/pages/page.contact.json`): the page content followed by a general contact form. A message is saved as a `ContactInquiry` row, then emailed to the store email (`Organization.email`, Settings › Store contact) with `reply_to` set to the visitor. The row records `emailedAt` or `emailError`, so a Resend failure never loses a message. Staff read them in **Online store › Messages** (`/admin/online-store/messages`): list + reading pane on desktop, list → message on phones; All / Unread filter, search, opening marks read, Mark unread, Reply (`mailto:`), Delete (ADMIN). Messages whose email failed are flagged "only here".

Developer guide (manifest format, section reference): `docs/development/page-templates.md`.

## Key Files

| File | Purpose |
|------|---------|
| `packages/db/prisma/schema.prisma` (`PageTemplate`, `ContactInquiry`, `Page.template`) | Template per org (unique `organizationId + name`), normalized manifest in `definition`; `Page.template` is a name with **no FK** |
| `packages/db/prisma/migrations/20261021100000_page_templates` | Column + both tables |
| `backend/src/utils/pageTemplateManifest.js` | `parsePageTemplateManifest` — whitelisted sections (`page_content` exactly once, `rich_text` sanitized, `contact_form` at most once), unknown keys rejected, 64 KB cap |
| `backend/src/services/PageTemplateService.js` | `list` (with page usage), `upsert` (same name replaces), `remove` (clears `Page.template` in the same transaction), `resolve`, `assertAssignable` (400 `UNKNOWN_TEMPLATE`) |
| `backend/src/services/PageService.js` | `template` on create/update; `getPublic` returns `template: { name, sections }` and `contactFormAvailable` — never the store email |
| `backend/src/services/ContactInquiryService.js` | Saves the message, sends `EmailService.sendContactInquiry`, records the outcome; 404 without a contact form, 409 `CONTACT_UNAVAILABLE` without a store email |
| `backend/src/api/routes/admin.js` | `GET /admin/page-templates` (any org member), `POST`, `GET /:id/manifest`, `DELETE /:id` (`requireSystemAdmin`) |
| `backend/src/api/routes/organizations.js` | `POST /:id/public/pages/:slug/contact` — `CONTACT_SUBMIT` limiter (10/h/IP) → `gateByOrgParam` → `validateContactInquiry` (honeypot `website` → 202, nothing saved) |
| `frontend/src/app/admin/online-store/pages/PageForm.tsx` | Two-column editor: Visibility + Template cards, store-email warning for contact templates, "Manage templates" for SYSTEM_ADMIN |
| `frontend/src/app/admin/online-store/page-templates/page.tsx` | Developer screen: upload `.json`, per-path errors, download, delete |
| `frontend/src/components/storefront/StorefrontPageBody.tsx` | Renders template sections in order (shared by legacy and themed renderers) |
| `frontend/src/components/storefront/ContactFormSection.tsx` | Client island: brand-token form, client + server validation, honeypot, success status |
| `backend/src/services/ContactInquiryService.js` (inbox) + `admin.js` `/admin/contact-inquiries` | `GET` (status=all\|unread, q, page; 25 a page, newest first, page titles), `GET /unread-count`, `PATCH /:id {read}`, `DELETE /:id` (ADMIN); `ContactInquiry.readAt` null = unread |
| `frontend/src/app/admin/online-store/messages/page.tsx` | Inbox UI |
| `frontend/src/components/storefront/formStyles.ts` | Storefront input styles shared with the apply form |
| `backend/tests/unit/pageTemplateManifest.test.js`, `backend/tests/contract/pageTemplates.test.js`, `backend/tests/contract/contactInbox.test.js`, `frontend/e2e/{admin-pages,admin-page-templates,public-contact-page,admin-messages}.spec.ts` | Tests |

## Rules

- Templates are data, never code: no scripts, CSS or unsanitized HTML. Extend by adding a section type to the validator, the frontend union and `StorefrontPageBody`.
- Only `SYSTEM_ADMIN` uploads or deletes; org members can only read the list (for the menu).
- The contact form never emails the visitor (it would make the form a relay for spam). Spam control is the honeypot plus the per-IP limiter; no captcha.
- No IP is stored on `ContactInquiry`.
