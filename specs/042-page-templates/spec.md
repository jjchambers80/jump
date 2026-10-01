# Spec 042 — Page templates + contact form

**Status:** Implemented 2026-10-01

## Problem

Online store › Pages had one layout: title + rich text. Stores want pages that do more (a contact form first), and the editor had visibility as an inline checkbox in a narrow column.

## Decisions (2026-10-01)

- Desktop editor gets a right column: **Visibility**, then **Template** (Shopify-style).
- A template is a declarative JSON manifest of whitelisted sections, uploaded **per organization by SYSTEM_ADMIN only**. No custom code or raw HTML runs, so nothing new can script the shared admin/storefront origin.
- First template: **contact** — page content + a general contact form delivered to the store email (`Organization.email`).
- Messages are emailed **and** saved (`ContactInquiry`); no inbox UI yet.
- Spam: honeypot + per-IP `CONTACT_SUBMIT` limiter (10/h). No captcha, so CI stays network-free.

## Out of scope / follow-ups

- Admin inbox for `ContactInquiry` rows and a retention policy.
- More section types (image, FAQ, map) — add to the validator, `PageTemplateSection` and `StorefrontPageBody`.
- Spec 038G themed page templates (Puck documents per page) may later absorb this; the manifest stays the import format.

See `docs/wiki/features/page-templates.md` and `docs/development/page-templates.md`.
