# Page templates — developer guide (spec 042)

A page template lays out an Online store › Pages page. Developers write one
JSON manifest per template and upload it to **one organization's store**;
the template then appears in the **Template** menu on that organization's
page editor. Nothing in a manifest runs as code: it is an ordered list of
whitelisted sections with typed settings.

## Upload

1. Sign in as a `SYSTEM_ADMIN` and pick the organization in the org switcher.
2. Online store › Pages › **Page templates** (`/admin/online-store/page-templates`).
3. **Upload template** and choose the `.json` file. Errors list the exact
   path (`sections[1].settings.submitLabel`) and nothing is saved.
4. Uploading a manifest whose `name` already exists replaces that template;
   pages using it pick up the change on their next render.
5. Deleting a template sends every page that used it back to the default layout.

API equivalent: `POST /admin/page-templates` with the manifest as the JSON
body (`X-Jump-Org: <organizationId>`). `GET /admin/page-templates/:id/manifest`
downloads the stored copy; `DELETE /admin/page-templates/:id` removes it.

## Manifest (schemaVersion 1)

```json
{
  "schemaVersion": 1,
  "name": "contact",
  "label": "Contact",
  "description": "Shown under the Template menu.",
  "sections": [
    { "type": "page_content" },
    { "type": "contact_form", "settings": { "heading": "Get in touch" } }
  ]
}
```

| Key | Rule |
|-----|------|
| `schemaVersion` | `1` |
| `name` | 1–40 lowercase letters, digits, hyphens; unique per organization; what `Page.template` stores |
| `label` | 1–60 characters, shown in the Template menu |
| `description` | optional, ≤ 200 characters |
| `sections` | 1–20 entries, rendered in order under the page title |

Unknown keys anywhere are rejected. The whole file must be ≤ 64 KB.

### Sections

| Type | Settings | Notes |
|------|----------|-------|
| `page_content` | none | The page's own rich-text content. **Exactly one** per template, so choosing a template never hides what the organizer wrote |
| `rich_text` | `html` (≤ 20 KB) | Fixed copy that is the same on every page using the template. Sanitized with the same allowlist as page content (`backend/src/utils/sanitizeHtml.js`) |
| `contact_form` | `heading` (≤ 100), `intro` (≤ 500), `submitLabel` (≤ 40), `successMessage` (≤ 300), `showPhone`, `showSubject` (booleans) | At most one. Name, email and message are always asked; phone and subject are optional fields when shown. Messages are emailed to the store email (Settings › Store contact) with reply-to set to the visitor; nothing is stored, and a failed send shows the visitor an error. Missing settings use the defaults in `CONTACT_FORM_DEFAULTS` |

Adding a section type means: the validator (`backend/src/utils/pageTemplateManifest.js`),
the `PageTemplateSection` type in `frontend/src/services/api.ts`, a case in
`frontend/src/components/storefront/StorefrontPageBody.tsx`, and this table.

## Shipped templates

- `templates/pages/page.contact.json` — page content followed by a general contact form.
