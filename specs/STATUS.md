# Spec Lifecycle Status

This index records the verified lifecycle state of every spec document in this directory.
Last updated: 2026-09-17.

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
| 018 | Transactions — unified view of ticket orders and application payments | **In progress** | Spec + plan 2026-09-17 (PR #64). Phase 1 (org-wide list, search, CSV, refunds; order refunds now ADMIN) built 2026-09-18. Phases 2–3 planned. Org-wide transactions list + search + refunds, customers/analytics/tax report including applications, tier change / adjustments / waive / offline payment on applications. 013–017 reserved (messaging, floor map, pages, machine access, MCP). |

## Documents archived as historical

| Document | Lifecycle | Notes |
|----------|-----------|-------|
| [001 implementation summary](./001-online-ticket-purchase/IMPLEMENTATION_SUMMARY.md) | **Superseded** | Replaced architecture snapshot |
| [001 quickstart](./001-online-ticket-purchase/quickstart.md) | **Historical** | Obsolete pre-monorepo setup |
| [Development progress summary](../docs/development/PROGRESS.md) | **Historical** | Archival redirect |

See [docs/roadmap.md](../docs/roadmap.md) for the full roadmap sources index.
