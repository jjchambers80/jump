# Spec Lifecycle Status

This index records the verified lifecycle state of every spec document in this directory.
Last updated: 2026-09-18.

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
| 018 | Transactions — unified view of ticket orders and application payments | **Partially implemented** | Phases 1-3 built 2026-09-18 (PRs #65–#67); phase 1 (org-wide Transactions list / search / CSV / refunds) **removed** 2026-09-18 — it duplicated Orders and the per-event Applications tab. Kept: order refunds ADMIN; customers, analytics, dashboard, tax report include application money; tier change, adjustments, waive, offline payment, manual refunds on applications. 013–017 reserved (messaging, floor map, pages, machine access, MCP). |
| 019 | Participants — org-wide submissions list, application forms and templates | **Implemented** | Plan merged 2026-09-18 (PR #70). Phase 1 (PR #71): sidebar **Participants**, one `SubmissionsTable` for the org-wide and per-event lists, `/admin/applications*` routes, Applications tab. Phase 2 (PR #72): `ApplicationFormTemplate` snapshots, save-as / create-from, template editor, shared `FormEditorCards`. Phase 3: `Application.tags` + check-in stamps, Tag filter, Edit tags dialog, ticks on approved rows. All 2026-09-18. |
| 021 | Settings › General › Store defaults (currency display, backup region, time zone) | **Proposed** | Spec written 2026-09-18; no plan. Adds `Organization.currency` / `backupRegion` / `timezone`, a Store defaults card under Store contact details, and moves tax-report / dashboard day boundaries from UTC to the store zone. 020 (abuse protection) is on branch `plan/020-abuse-protection`, PR #76. |
| 022 | Organization onboarding (signup flow, Jump customer record, dashboard setup guide) | **Partially implemented** | Plan 2026-09-18 (`specs/022-organization-onboarding/plan.md`). Phase 1 built 2026-09-18 on `feat/022-onboarding-phase-1`: `/signup` name → survey → done, `PlatformCustomer`, pending orgs hidden until complete, creator membership + `UNASSIGNED → ADMIN`, switcher opens a new tab + cross-tab refresh, dashboard setup guide, check-in scan/redeem org-scoped. Phase 2: subscribe step + Settings › Plan behind `BILLING_ENABLED` (Stripe Billing, embedded Checkout). Phase 3: survey-tailored templates, abandoned-org sweep, funnel. Supersedes spec 005 US2 (wizard) and FR-009 (one org per account). |

## Documents archived as historical

| Document | Lifecycle | Notes |
|----------|-----------|-------|
| [001 implementation summary](./001-online-ticket-purchase/IMPLEMENTATION_SUMMARY.md) | **Superseded** | Replaced architecture snapshot |
| [001 quickstart](./001-online-ticket-purchase/quickstart.md) | **Historical** | Obsolete pre-monorepo setup |
| [Development progress summary](../docs/development/PROGRESS.md) | **Historical** | Archival redirect |

See [docs/roadmap.md](../docs/roadmap.md) for the full roadmap sources index.
