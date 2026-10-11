# Settings › Policies (written store policies)

**Status**: Implemented (spec 052, 2026-10-11)
**Last Updated**: 2026-10-11

## Overview

Each store can publish seven buyer-facing policies from **Settings › Policies › Written policies**: Return and refund policy, Privacy policy, Terms of service, Shipping policy, Contact information, Legal notice, and Accessibility statement. The screen is modelled on Shopify's Policies page.

- Each row shows **Published** or **No policy set** and opens a dialog with a WYSIWYG editor (`RichTextEditorField`). The dialog has Cancel and Save.
- A policy with no saved text opens on **starter text**: a generic template filled in with the store's name, email, phone, address and its self-serve refund rules (Settings › Customer accounts). Nothing is stored until the store presses **Publish**.
- A dialog warning says the starter text is not legal advice. The page footer adds: *"Recommended policies are not legal advice. You are responsible for ensuring they are accurate and comply with applicable laws."*
- **Remove policy** deletes the page, and the row goes back to *No policy set*. Any policy can stay unset.
- Published policies are linked under the storefront footer and below the consent line at checkout. The **⋯** menu has **Show policies in footer and checkout** (`Organization.showPoliciesInFooter`, default on).
- Onboarding has a **Review your store policies** task (`policies`) under *Set up your store*. It is done once any policy is published.

Unrelated: Eventimus's own Terms and Privacy (spec 023, `/legal/*`, `LegalAcceptance`) are the platform's documents. They are separate from these and unchanged.

## Model

Policies are ordinary `Page` rows with `Page.policyType` (`enum PolicyType`: `REFUND`, `PRIVACY`, `TERMS`, `SHIPPING`, `CONTACT`, `LEGAL_NOTICE`, `ACCESSIBILITY`), unique per organization (`@@unique([organizationId, policyType])`). So they:

- render at `/organizations/<slug>/pages/<slug>` (tenant: `/pages/<slug>`) through the existing page route, on the default template (`template: null`), themed or legacy;
- get default slugs `refund-policy`, `privacy-policy`, `terms-of-service`, `shipping-policy`, `contact-information`, `legal-notice`, `accessibility-statement`, suffixed on a clash with an existing page;
- are sanitized on write (`sanitizeContentHtml`) and keep Content › Files *Used in* (`syncReferences`);
- can be picked as menu targets like any page.

They are **hidden from Content › Pages** (`PageService.list` / `get` filter `policyType: null`, as does admin search), so Settings › Policies is their only editor.

## Permissions

The catalog action is `settings.policies` under the locked `settings` feature (`backend/src/permissions/catalog.js`). It is ADMIN-only by default. Any staff member can view the list and the dialog. Save, remove and the footer switch require the action, and ORGANIZER gets 403.

## API

| Route | Notes |
|---|---|
| `GET /admin/settings/policies` | `{ showInFooter, policies: [{ type, title, slug, status: PUBLISHED \| NOT_SET, updatedAt }] }` in display order |
| `PATCH /admin/settings/policies` | `{ showInFooter }`, requires `settings.policies` |
| `GET /admin/settings/policies/:type` | The saved policy, or `{ starter: true, title, content }` with starter text. An unknown type returns 404 |
| `PUT /admin/settings/policies/:type` | `{ title, content }`: create or replace, then publish. Requires `settings.policies` |
| `DELETE /admin/settings/policies/:type` | Unset the policy (204). Requires `settings.policies` |
| `GET /organizations/:id/public/menus` | Now also returns `policies: [{ type, title, href }]`, which is empty when none are published or the switch is off |

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/config/policyTemplates.js` | `POLICY_TYPES` (order, titles, slugs) and `starterPolicy(type, org)` |
| `backend/src/services/PolicyService.js` | list / get (starter fallback) / save / remove / footer switch / `publicLinks` |
| `backend/src/api/validators/policyValidators.js` | type, body and switch validation |
| `backend/src/services/MenuService.js` | `publicMenus` carries `policies`, which feeds the client footer, the theme Footer section and checkout |
| `frontend/src/app/admin/settings/policies/page.tsx`, `PolicyDialog.tsx` | Settings page and edit dialog (`SettingsDialog`) |
| `frontend/src/components/storefront/PolicyLinks.tsx` | Link row used by `FooterMenu` (both footers) and `checkout/[eventId]` |
| `frontend/src/components/onboarding/setupTasks.tsx` | `policies` onboarding task |

## Tests

- `backend/tests/contract/policies.test.js`: the list, starter text (escaped), ORGANIZER 403s, validation, save (sanitized) followed by the public page and menus link, hiding from Content › Pages, org scoping, the footer switch, and remove.
- `backend/tests/unit/policyTemplates.test.js`: every type renders, and the refund rules are filled in.
- `frontend/e2e/admin-settings-policies.spec.ts`: the list, publishing starter text, Cancel, the ⋯ switch, and the storefront footer link.
