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

- [Applications](features/applications.md) — Per-event vendor / sponsor (PAID tiers, capacity on approval) and press / panel (FREE) forms: applicant profiles + photos, questions, approve / reject / waitlist / withdraw with templated emails, bulk, CSV; card on file at submission, off-session charge at approval, pay-now, refunds, overdue sweep behind `APPLICATIONS_PAYMENTS_ENABLED`; saved views, CSV photo URLs, applicant profile self-service, price-changed note, organizer daily digest, event duplicate (spec 011)
- [Add-ons](features/add-ons.md) — Optional products on ticket tiers (parking, VIP lounge) and application tiers (booth power, badges, tables): event-scoped `AddOn` with scope + tier attachments, per-item taxable fee math, PriceTier-style capacity, lines on `OrderAddOn` / `ApplicationAddOn`, approval reservation with sold-out 409, pre-payment line edits with `ADD_ONS_CHANGED` email, per-line refunds, scan hand-over, sales report + purchasers CSV on analytics (spec 012)
- [Application payments — reporting and corrections](features/application-payments-reporting.md) — Customers, event analytics, dashboard and the collected-tax report include application money (`PAID_ORDER_STATUSES` / `PAID_APPLICATION_STATUSES` in `backend/src/services/paidStatuses.js`); pre-payment corrections on applications — tier change, signed adjustments folded into the tier line, ADMIN waive / offline payment (`paymentSource: OFFLINE`), recorded refunds; order refund routes ADMIN. The org-wide Transactions list (spec 018 phase 1) was removed 2026-09-18
- [Participants](features/participants.md) — Sidebar **Participants**: every submission across the organization's events in one list (Eventeny-style: logo, business, short id, tags, application, status, payment, `⋯` actions), server-side search / filters / sorts, saved views, bulk across events, CSV; one `SubmissionsTable` also renders the per-event Applications tab; Applications tab lists forms across events plus reusable form templates (JSON snapshots: save-as from a form, create-from on any upcoming event, template editor) plus free-form tags (filter, search, Edit tags dialog) and on-site check-in ticks on approved rows, and up to 2 pinned questions per form shown as list columns (spec 019, all phases + follow-up)

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
- [Payments Settings](features/payments-settings.md) — Settings › Payments: Stripe status + test-mode badge, statement descriptor suffix (`PREFIX* ORG`), optional payment methods allowlist, rates, Radar (spec 010 phase 1)
- [Connect Payouts](features/connect-payouts.md) — Stripe Connect Express per organization: destination charges (org receives the subtotal, platform keeps fees + tax), onboarding, payouts page, schedule dialog, Connect webhook; dark behind `STRIPE_CONNECT_ENABLED` (spec 010 phase 2)
- [Organization Branding](features/organization-branding.md) — Logo, cover image, brand color with WCAG AA contrast checker
- [Organization Theme Mode](features/organization-theme-mode.md) — Per-org light/dark/system enforcement on public org pages
- [Organization Logo Box](features/organization-logo-box.md) — Public org page logo: square box straddling the mobile cover, plain logo on desktop, blurred backdrop for non-square logos
- [Online Store Pages](features/online-store-pages.md) — Online store › Pages: create/edit custom pages, visibility, search engine listing (SEO title, meta description, URL handle)
- [Online Store Preferences](features/online-store-preferences.md) — Online store › Preferences: store access (private mode + password gate on the public org page), homepage SEO title/description + Open Graph, language redirection toggle (stored only)
- [Venue Management](features/venue-management.md) — CRUD, logo uploads, timezone config
- [User Management](features/user-management.md) — Role assignment, account listing

### Frontend
- [Theme System](features/theme-system.md) — Light/dark/auto modes, localStorage persistence
- [Org Switcher](features/org-switcher.md) — Global organization context in the admin header; `X-Jump-Org` header, backend `activeOrgFor(req)`, JWT claim refresh
- [Organization Onboarding](features/organization-onboarding.md) — Shopify-style `/signup` flow from the org switcher (name → survey → done, new tab), `PlatformCustomer` per organization, pending orgs hidden until complete, `UNASSIGNED` promoted to ADMIN, dashboard setup guide cards; scopes check-in scan/redeem to the staff caller's organization (phase 1); Jump subscriptions on Jump's own Stripe account — subscribe step with embedded Checkout + trial, Settings › Plan, customer portal, `POST /webhooks/stripe/billing`, dark behind `BILLING_ENABLED` (phase 2); survey-tailored starter templates + check-in card, abandoned-signup sweep, SYSTEM_ADMIN funnel + survey summary (phase 3)

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
