# Jump Platform — Feature Wiki

Living documentation of every feature in the Jump ticketing platform. Each page covers what the feature does, how it's configured, key files, and gotchas.

Generated and maintained by running `/doc-feature` after completing feature work.

## Features

### Core Platform
- [Multi-Tenant Architecture](features/multi-tenant-architecture.md) — Organizations, venues, org-scoped resources
- [Event Management](features/event-management.md) — CRUD, lifecycle (draft/published/cancelled), capacity
- [Price Tiers](features/price-tiers.md) — Multi-tier pricing, inventory tracking, display ordering
- [Guest Checkout](features/guest-checkout.md) — Stripe Checkout flow, contact creation, order management
- [Tenant Identity](features/tenant-identity.md) — Per-organization buyers (`Contact` unique on org + email), staff memberships (`OrganizationMember`), membership-based scoping
- [Buyer Accounts](features/buyer-accounts.md) — Checkout account opt-in (pre-checked) + marketing consent (unchecked), passwordless magic-link sign-in, org-scoped account page with self-service refunds
- [Custom Domains](features/custom-domains.md) — White-label storefront on an organization's own subdomain: CNAME + TXT verification, tenant-host middleware, per-org email/Stripe links

- [Applications](features/applications.md) — Per-event vendor / sponsor (PAID tiers, capacity on approval) and press / panel (FREE) forms: applicant profiles + photos, questions, approve / reject / waitlist / withdraw with templated emails, bulk, CSV; payments phase 2 behind `APPLICATIONS_PAYMENTS_ENABLED` (spec 011)

### Payments & Pricing
- [Stripe Integration](features/stripe-integration.md) — Payment processing, webhooks, Checkout Sessions
- [Fee Calculation](features/fee-calculation.md) — Platform fees, processing fees, pass-through pricing
- [Tax Calculation](features/tax-calculation.md) — Venue-based rate resolution (region setting → Stripe Tax lookup or manual rate), failure handling, exclusive vs tax-inclusive fee math
- [All-In Pricing](features/all-in-pricing.md) — FTC-compliant price display with fees included
- [Cart Line-Item Breakdown](features/cart-line-item-breakdown.md) — Per-line fee accordion in the cart (dotted-underline price, caret) with Expand all / Collapse all; shared `lib/fees.ts`

### Tickets & Fulfillment
- [Ticket Issuance](features/ticket-issuance.md) — Barcode generation, QR code JWTs, ticket lifecycle
- [QR Code Scanning](features/qr-code-scanning.md) — Redemption flow, JWT verification, admin scanner
- [Email Notifications](features/email-notifications.md) — Transactional emails via Resend with retry

### Authentication & Authorization
- [Auth.js Integration](features/authjs-integration.md) — OAuth (Google), magic links, JWT strategy
- [Role-Based Access Control](features/rbac.md) — Customer/Organizer/Admin roles, middleware enforcement

### Admin & Organizer
- [Admin Dashboard](features/admin-dashboard.md) — Stats, event management, analytics
- [Organization Settings](features/organization-settings.md) — Settings › General: read-only summary cards with edit dialogs (store contact, address, business details), people (OrganizationPerson)
- [Tax Settings](features/tax-settings.md) — Settings › Tax: Stripe Tax status, per-state tax regions (collect / not, Stripe Tax or manual rate, Recalculate now), collected tax report, tax-inclusive pricing
- [Payments Settings](features/payments-settings.md) — Settings › Payments: Stripe status + test-mode badge, statement descriptor suffix (`PREFIX* ORG`), optional payment methods allowlist, rates, Radar; Connect payouts pending (spec 010)
- [Organization Branding](features/organization-branding.md) — Logo, cover image, brand color with WCAG AA contrast checker
- [Organization Theme Mode](features/organization-theme-mode.md) — Per-org light/dark/system enforcement on public org pages
- [Organization Logo Box](features/organization-logo-box.md) — Public org page logo: square box straddling the mobile cover, plain logo on desktop, blurred backdrop for non-square logos
- [Venue Management](features/venue-management.md) — CRUD, logo uploads, timezone config
- [User Management](features/user-management.md) — Role assignment, account listing

### Frontend
- [Theme System](features/theme-system.md) — Light/dark/auto modes, localStorage persistence
- [Org Switcher](features/org-switcher.md) — Global organization context in admin header

### Infrastructure
- [Observability](features/observability.md) — Winston logging, Prometheus metrics, correlation IDs
- [Database Architecture](features/database-architecture.md) — Prisma, shared @jump/db package, migrations
- [Railway Deployment](features/railway-deployment.md) — Production deployment, Railpack configs

## Configuration Reference
- [Environment Variables](config/environment-variables.md)
- [Stripe Setup](config/stripe-setup.md)
- [Production Launch Checklist](config/production-launch-checklist.md) — Human steps before taking real money: Stripe Tax activation/registrations, tax backfill review, open tax decisions, live Stripe keys
- [Database Setup](config/database-setup.md)

## Contributing

After completing a feature, run `/doc-feature` to generate or update the wiki page. The skill will:
1. Ask which feature was built/changed
2. Scan relevant source files
3. Generate a standardized wiki page
4. Update this index
