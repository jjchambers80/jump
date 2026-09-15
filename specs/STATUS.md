# Spec Lifecycle Status

This index records the verified lifecycle state of every spec document in this directory.
Last updated: 2026-09-15.

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
| 010 | Settings › Payments (Shopify-style Payment Configuration) | **Implemented** | Phase 1 on `origin/main`: provider card, statement descriptor, payment methods, rates, fraud card. Phase 2 (Stripe Connect) gated. |

## Documents archived as historical

| Document | Lifecycle | Notes |
|----------|-----------|-------|
| [001 implementation summary](./001-online-ticket-purchase/IMPLEMENTATION_SUMMARY.md) | **Superseded** | Replaced architecture snapshot |
| [001 quickstart](./001-online-ticket-purchase/quickstart.md) | **Historical** | Obsolete pre-monorepo setup |
| [Development progress summary](../docs/development/PROGRESS.md) | **Historical** | Archival redirect |

See [docs/roadmap.md](../docs/roadmap.md) for the full roadmap sources index.
