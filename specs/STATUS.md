# Spec Lifecycle Status

This index records the verified lifecycle state of every spec document in this directory.
Last updated: 2026-09-22.

| # | Title | Lifecycle | Notes |
|---|-------|-----------|-------|
| 001 | Online Ticket Purchase and QR Code Generation | **Superseded** | Implementation replaced by 003-schema-redesign. See [003](./003-schema-redesign/spec.md) for the current schema foundation. |
| 002 | Theme Modes (Dark, Light & Auto) | **Implemented** | Live on main: ThemeProvider, ThemeToggle, ThemeModePicker, and theme-mode E2E coverage. |
| 003 | Schema Redesign — MVP Data Architecture | **Implemented** | Current normalized data foundation in `packages/db/prisma/schema.prisma`, extended by later features. |
| 004 | Admin Area | **Implemented** | Live on main. Post-spec changes: Users moved to `/admin/settings/users`; Settings gained General, People, Payments, Domains, and Tax pages. |
| 005 | Create Event Flow + Admin RBAC | **Proposed** | Not implemented. Code uses `SYSTEM_ADMIN` (not `SUPER_ADMIN`). No onboarding wizard or `/create-events` route exists. |
| 007 | Tenant Identity, Buyer Accounts, and White-Label Custom Domains | **Implemented** | All 3 phases on `origin/main`: per-org Contact, OrganizationMember, custom domains, buyer magic-link auth, checkout opt-in. |
| 008 | Settings › Domains (Shopify-style Connect Flow) | **Implemented** | Phases A and B on `origin/main`: domain list, connect dialog, DNS setup page, verify flow. Phase C (apex) and D (ops) open. |
| 009 | Settings › Tax (Shopify-style Tax Configuration) | **Implemented** | Phases 1-3 on `origin/main`: service card, tax regions table, edit dialog, tax-inclusive pricing, collected tax report. |
| 010 | Settings › Payments (Shopify-style Payment Configuration) | **Implemented** | Phases 1-2 on `origin/main`. Phase 2 (Stripe Connect Express, destination charges, Payouts page) is dark behind `STRIPE_CONNECT_ENABLED`; the connected-account model (Express vs organizer-owned account) is an open decision — see `010-payments-settings/plan-phase-2.md` §11.1. |
| 011 | Applications (vendors, sponsors, press, panels) | **Implemented** | Phases 1-3 on `origin/main` 2026-09-17: forms + free applications, card on file + charge at approval + pay-now + refunds (behind `APPLICATIONS_PAYMENTS_ENABLED`), CSV/saved views/digest/event duplicate. Hand-offs: 012 add-ons, 013 messaging, 014 floor map. |
| 012 | Add-ons (ticket tiers and application tiers) | **Implemented** | Phases 1-3 on `origin/main` 2026-09-17 (PRs #59/#63/#61/#62): add-ons on ticket tiers, on application tiers, sales report + purchasers CSV + analytics. |
| 014 | Maps — booth floor plan builder, self-serve spot purchase, public map | **Proposed** | Spec 2026-09-20 (`specs/014-floor-map/spec.md`); reserved since the spec 011 hand-offs, never written until now. Top-level **Maps** sidebar item. Kanban JUMP-014A/B/C. |
| 018 | Transactions — unified view of ticket orders and application payments | **Partially implemented** | Phases 1-3 built 2026-09-18 (PRs #65–#67); phase 1 (org-wide Transactions list / search / CSV / refunds) **removed** 2026-09-18. |
| 019 | Participants — org-wide submissions list, application forms and templates | **Implemented** | Plan merged 2026-09-18 (PR #70). All three phases built 2026-09-18. |
| 020 | Abuse protection and edge security | **Partially implemented** | Phase 1 (limiter factory on every money path, per-buyer hold cap, abandoned-checkout sweep) built and shipped 2026-09-19. |
| 021 | Settings › General › Store defaults (currency display, backup region, time zone) | **Proposed** | Spec written 2026-09-18; no plan. |
| 024 | Application orders — one ledger under Orders, apply-form account and consent | **Implemented** | Plan 2026-09-19 (PR #90). All three phases on `main` and in prod 2026-09-19 (PRs #92, #93, #95). |
| 022 | Organization onboarding (signup flow, Jump customer record, dashboard setup guide) | **Implemented** | Plan 2026-09-18. All three phases built 2026-09-18 (PRs #77, #78). |
| 025 | Content › Files | **Implemented** | Plan + build 2026-09-19. Adds the **Content** sidebar section. |
| 026 | Content › Blog posts | **Implemented** | Plan + build 2026-09-19. `Blog` + `BlogPost` with Tiptap editor. |
| 027 | Content › Menus | **Implemented** | Plan + build 2026-09-19. 3-level drag-and-drop tree editor. |
| 028 | Content › URL redirects | **Implemented** | Plan + build 2026-09-19. Per-org 301 on the storefront 404 path. |
| 030 | Account settings — General and Security | **Implemented** | All four features built 2026-09-20 (PRs #109, D, B, C). |
| 029 | Administration header search | **Implemented** | All three cards complete 2026-09-20. |
| 031 | Settings › Customer accounts (sign-in links, account URL, self-serve refund policy, code sign-in) | **Implemented** | All three phases built 2026-09-20 (PRs #113, #114). |
| 032 | Customer detail — gap assessment against Shopify and triage plan | **Proposed** | Spec 2026-09-20. |
| 023 | Legal and compliance foundation | **Phase 0 built** | Spec written 2026-09-18 (PR #82). Phase 0 on `main` 2026-09-19. No legal text yet. |
| 033 | Venue time zones — make the venue zone authoritative for event times, then derive it from the postal code | **Implemented** | All three phases built 2026-09-22 (PRs #137 / #138 / #139, stacked; merge in order). See `docs/wiki/features/venue-time-zones.md`. |
| 034 | RSVP events — free admission, headcount and marketing capture | **Implemented** | All three phases + §9.2 reminder email built 2026-09-22. Phases 1-3 (PR #150). Reminder sweep: backend service, migration, unit tests (this card). See `docs/wiki/features/rsvp-events.md`. |
| 040 | Patron "My account" — profile, RSVPs, receipts, marketing preferences, sign-out-everywhere, download and delete my data | **Implemented** | 2026-09-30: 040A #251, 040B #253, 040C #254, 040D erasure. See `docs/wiki/features/patron-account.md`. |
| 041 | Hero carousel and FAQ theme sections | **Implemented** | 2026-09-30: `HeroCarousel` + `Slide`, `Faq` + `FaqItem` in the `@jump/theme` registry. See `docs/wiki/features/theme-sections.md`. |
| 042 | Page templates (developer-uploaded JSON manifests) + contact form template | **Implemented** | 2026-10-01: two-column page editor, `/admin/online-store/page-templates`, `templates/pages/page.contact.json`. See `docs/wiki/features/page-templates.md`. |
| 044 | Standing application forms — organization-level forms (Content › Forms), Customers source filter, page call-to-action drawer | **Planned** | 2026-10-04: plan only. See `specs/044-standing-application-forms/plan.md`. |
| 045 | Agent access — remote MCP server + Jump OAuth 2.1 for ChatGPT, Claude and coding agents; store and platform kill switches; no personal data | **Planned** | 2026-10-05: plan only. Prerequisite PR #303. See `specs/045-agent-access/plan.md` and `docs/research/2026-10-05-agent-store-access.md`. |
| 046 | Photo galleries — Content › Galleries with sections over Content › Files; masonry + lightbox or carousel on Puck pages, classic pages and blog posts | **Implemented** | 2026-10-07: cards A–D merged (PRs #322, #324, #326, 046D); 046E (Hero carousel a11y fixes) open. See `docs/wiki/features/galleries.md`. Supersedes the spec 038 inline `Gallery` section. See `specs/046-photo-galleries/plan.md` and `docs/research/2026-10-07-photo-galleries.md`. |
| 047 | Donations — one-time gifts at ticket checkout, preset or custom amounts, donate-only, recurring monthly gifts; nonprofit verification and receipts | **Planned** | 2026-10-09: D0 groundwork plan only (`specs/047-donations/plan-d0.md`). Full phase plan and law in `docs/research/2026-10-08-donation-platforms.md` and `-donation-legal-compliance.md`. v1 = D0 + DV + D1 + D3 |

## Documents archived as historical

| Document | Lifecycle | Notes |
|----------|-----------|-------|
| [001 implementation summary](./001-online-ticket-purchase/IMPLEMENTATION_SUMMARY.md) | **Superseded** | Replaced architecture snapshot |
| [001 quickstart](./001-online-ticket-purchase/quickstart.md) | **Historical** | Obsolete pre-monorepo setup |
| [Development progress summary](../docs/development/PROGRESS.md) | **Historical** | Archival redirect |

See [docs/roadmap.md](../docs/roadmap.md) for the full roadmap sources index.