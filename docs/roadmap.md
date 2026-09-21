# Jump Platform — Roadmap

**Generated**: 2026-09-14 · **Updated**: 2026-09-18

This page aggregates the project's fragmented roadmap sources into one place.
There is no single "roadmap.md" — the actual direction is carried by the sources below.

---

## Specs (what to build, in order)

Each directory under `specs/` is a feature specification with architecture decisions, requirements, and acceptance criteria. The numbering reflects implementation sequence (this is the closest thing to a backlog).

See [specs/STATUS.md](../specs/STATUS.md) for verified lifecycle states.

| Spec | Branch / Status | Description |
|---|---|---|
| 001 | `main` (merged) — **Superseded by 003** | Online ticket purchase + QR codes (MVP) |
| 002 | `main` (merged) | Theme modes (dark/light/auto) |
| 003 | `main` (merged) | Schema redesign — multi-tenant architecture |
| 004 | `main` (merged) | Admin area with sidebar, RBAC, protected routes |
| 005 | **Proposed** — design reviewed, not implemented | Create Event flow + admin RBAC, onboarding wizard, SUPER_ADMIN role |
| 006 | (bundled into 004) | Organization branding, theme modes per org, logo box |
| 007 | `main` (merged, in prod) | Tenant identity, buyer accounts, custom domains |
| 008 | `main` (merged, in prod) — apex + ops phases open | Shopify-style Settings > Domains connect flow |
| 009 | `main` (merged, in prod) — Stripe Tax activation + §5 decisions open | Settings > Tax — per-org tax regions, recalculate, collected tax report |
| 010 | `main` (merged) — phase 2 dark behind `STRIPE_CONNECT_ENABLED`; account model undecided | Settings > Payments — statement descriptor, payment methods, Stripe Connect payouts |
| 011 | `main` (merged 2026-09-17) — paid forms dark behind `APPLICATIONS_PAYMENTS_ENABLED` | Applications — vendor / sponsor / press / panel forms, charge on approval, pay-now, refunds, digest, event duplicate |
| 012 | `main` (merged 2026-09-17) | Add-ons — products on ticket and application tiers, sales report, purchasers CSV |
| 018 | `main` (phases 1–3 built 2026-09-18; phase 1 Transactions list removed 2026-09-18) — settle-offline-at-approval is a noted follow-up | Application money in customers/analytics/dashboard/tax report; tier change / adjustments / waive / offline payment on applications. The org-wide Transactions list was removed: it duplicated Orders and the per-event Applications tab |
| 024 | `main` + prod (plan PR #90; phases 1–3 PRs #92 / #93 / #95, all merged and deployed 2026-09-19; prod backfill verified) — legal text + `LEGAL_ACCEPTANCE_REQUIRED` / `NEXT_PUBLIC_LEGAL_PAGES_ENABLED` wait on spec 023 phase 1 | A PAID-form application is an `Order`: one ledger for tickets and applications (lines, payment, refunds), `Order.status` derived from the application's payment state, SQL backfill; then the order-level Orders page and the apply-form account / consent capture |
| 019 | `main` (all 3 phases merged 2026-09-18, PRs #70–#75; migrations verified in prod) | Participants — org-wide submissions list, one `SubmissionsTable` shared with the per-event tab, application form templates, tags + check-in |
| 020 | **Phase 1 on `main` + prod 2026-09-19** (limiters, hold cap, abandoned-checkout sweep); phases 2–3 open | Abuse protection and edge security — per-IP and per-buyer limits on `POST /orders` and the other unauthenticated money paths, abandoned-order sweep, staff magic-link guard, `helmet` + CSP, optional Turnstile; edge-layer (Cloudflare vs Railway-only) decision before the first production custom domain |

---

## Discovery research (roadmap inputs)

`docs/research/` holds customer interviews and competitor notes. See [docs/research/README.md](./research/README.md).

Candidate specs surfaced by the 2026-09-15 Eventeny organizer interview ([analysis](./research/2026-09-15-eventeny-organizer-interview.md)), in suggested order:

| Candidate | Scope | Why |
|---|---|---|
| ~~011 applications~~ | Shipped 2026-09-17 (see specs table) | — |
| 012 add-ons | **Planned 2026-09-17** — `specs/012-add-ons/` | Organizer's biggest operational regret; fees on after-the-fact invoices |
| fee modes | Per-product absorb / pass / split with buyer-price preview | "$275 booth costs $303" is the headline complaint |
| 013 messaging | Segment sends from the org's verified domain, per-recipient delivery status, export, event-relative automations | Eventeny mail goes to spam; organizer runs Gmail mail-merge instead |
| check-in role | `SCANNER` role, kiosk mode, unlimited free scanner seats, PII masking | Owner dashboard exposed on volunteer iPads; 10-seat cap |
| 014 maps | **Planned 2026-09-20** — `specs/014-floor-map/`: constrained SVG builder (snap, row duplicate, auto-number, fixed palette), booths as locked rows bound to application tiers, approved vendor picks a booth and buys (sold only on Stripe confirmation), public map with vendor profiles, `?booth=` links, vector PDF, templates; top-level Maps sidebar item | Eventeny's map is the $360/mo tier driver and serves stale assignments |
| 015 pages | Simple CMS pages, org landing page, day-of mobile page on the custom domain | Organizer runs WordPress only to link out to the platform |
| 025–028 content | **Planned 2026-09-19** — `specs/025-content-files/`, `026-blog-posts/`, `027-menus/`, `028-url-redirects/`: Content sidebar with Files (public links), Blog posts (Tiptap, storefront rendering, public Pages route), Menus (header nav + footer), URL redirects | Pages shipped unlisted and unrendered; storefront has no navigation or publishing surface |

---

## Completed features (living index)

`docs/wiki/README.md` — autogenerated index of every completed feature page in the wiki. Updated by running `/doc-feature` after each spec lands.

Wiki pages live under `docs/wiki/features/` and cover what the feature does, how it's configured, key files, and gotchas.

---

## Active task tracking

The Hermes Kanban board at `~/.hermes/kanban/boards/jump/` manages task lifecycle: dispatch, assignments, review, completion. Tasks map to spec phases or discrete implementation chunks. The operating contract is [`docs/development/kanban-workflow.md`](development/kanban-workflow.md): triage → specify/decompose → Claude Code implementation → PR review → merge → done.

---

## Production launch checklist

`docs/wiki/config/production-launch-checklist.md` (on `main`)

Current go-live blockers (as of 2026-09-18):

- Stripe statement descriptor prefix on the platform account
- Live Stripe secret key + webhook secret on the backend service; `payment_intent.*` + `charge.refunded` events on the platform webhook
- Stripe Tax not activated on the platform account; NY / CA regions; seller-of-record and fee-tax decisions
- Connected-account model decision (Express vs organizer-owned Stripe account) before any Connect setup
- `APPLICATIONS_PAYMENTS_ENABLED` and `STRIPE_CONNECT_ENABLED` both off until the above
- Spec 020 phase 1 (rate limits on `POST /orders`, per-buyer hold cap, abandoned-order sweep) before the first public on-sale; edge-layer decision before the first production custom domain
- See the checklist file for the full human-action list

---

## Design history

Architecture decisions: `docs/architecture/decisions/` (ADRs 001-004 + adr-admin-layout.md)

---

## Archived documents

`docs/development/PROGRESS.md` — now an archival redirect (obsolete since Feb 2026).
`docs/development/PHASE_3_COMPLETE.md` — detailed snapshot of Phase 3 User Story 1 completion (not obsolete, preserved as-is).

For spec lifecycle details, see [specs/STATUS.md](../specs/STATUS.md).