# Shared DB Package — Scoped Agent Instructions

Loads when agent touches `packages/db/` files. For root-level commands, see [`../../AGENTS.md`](../../AGENTS.md).

## This Package

- Exports singleton Prisma client as `@jump/db`
- All workspaces import from here: `import { prisma } from "@jump/db"`
- Never instantiate PrismaClient elsewhere

## Schema Changes

1. Edit `prisma/schema.prisma`
2. `npm run db:migrate` from repo root (creates migration + applies)
3. `npm run db:generate` from repo root (regenerates client types)
4. Postinstall hook runs generate automatically on `npm install`

## Models

Core chain: Organization → Venue → Event → PriceTier → OrderItem → Ticket
Supporting: User, OrganizationMember, OrganizationDomain, OrganizationStripeAccount, Account, VerificationToken, Contact, BuyerLoginToken, Order, PaymentTransaction, Refund, OrganizationPerson, TierPreset, TaxRegion, File, Image
Applications (spec 011): ApplicationForm → ApplicationTier / ApplicationQuestion; ApplicantProfile (+ ApplicantProfileImage) per organization + contact; Application → ApplicationAnswer / ApplicationDecision; ApplicationMessageTemplate per organization. A PAID-form application's money lives on its `Order` (`kind: APPLICATION`, spec 024)
Add-ons (spec 012): AddOn per event (scope TICKET/APPLICATION/BOTH, `allTiers`) → PriceTierAddOn / ApplicationTierAddOn attachments; OrderAddOn lines on Order for ticket and application orders alike (immutable unitPrice + allocated fees/tax, `refundedAt`); Refund.orderAddOnId
Enums: AddOnScope (TICKET/APPLICATION/BOTH), UserRole (UNASSIGNED/ORGANIZER/ADMIN/SYSTEM_ADMIN), MemberRole (ADMIN/ORGANIZER, per-org staff role), BuyerTokenPurpose (WELCOME/LOGIN), DomainStatus (PENDING/VERIFIED/ACTIVE/FAILED), OrganizationStatus, ThemeMode (LIGHT/DARK/SYSTEM, org public-page enforcement), EventStatus, OrderStatus, TierVisibility, TicketStatus, PaymentStatus, RefundStatus, TaxSource (STRIPE/MANUAL)

Disputes (spec 037, `20261009100000_disputes`): `Dispute` is unique on `stripeDisputeId` and belongs to exactly one `Order`; `Refund.disputeId` is **unique** so the database enforces one money-out row per dispute (`stripeRefundId` stays null — a chargeback has no Stripe Refund object). `Dispute.lastEventAt` is the monotonic ordering guard and `voidedTickets` / `closedAddOnIds` record what to restore on a won dispute; all three are written only by `DisputeService`. Enum: DisputeState (OPEN/WON/LOST). See `docs/wiki/features/disputes-chargebacks.md`.

Tenancy: `Contact` is unique on `(organizationId, email)`; `OrganizationMember` holds staff affiliation. `User.organizationId` and `Contact.userId` were dropped in `20260913130000_drop_legacy_identity_columns` (which also renamed `UserRole.CUSTOMER` to `UNASSIGNED`). `20260913000000_contact_per_org_and_membership` did the original backfill in one transaction.

Applications (spec 011): the amount snapshot is the application's `Order` (lines + totals, spec 024) — never recompute it from the tier. `ApplicationTier.quantityApproved` / `quantityReserved` are moved only inside `ApplicationService` capacity transactions. `Contact.stripeCustomerId` is unique. `ApplicantProfile` is unique on `(organizationId, contactId)`; `Application.statusTokenHash` is unique. `Organization.applicationDigestEnabled` / `applicationDigestAt` drive the organizer daily digest (`20260917120000_application_digest`). Enums: ApplicationFormKind, ApplicationFormStatus, ChargeTiming, FeeMode, OverduePolicy, ApplicationStatus, ApplicationPayment, CapacitySlot, QuestionType, ApplicationAction, WithdrawnBy. Spec 037 phase 5 (apply-then-choose): `ApplicationPayment.NOT_DUE` / `AWAITING_SELECTION`, `ApplicationAction.CHOOSE_SPACE`, `ApplicationForm.reserveOnApproval`, `Application.selectionHeldUntil` (migrations `20261011100000_apply_then_choose_enums` + `…0001_apply_then_choose`; data via `npm run db:backfill:037-applications`). `ApplicationTier.mapBound` is no longer read (map binding is derived from the published map) and is dropped in phase 6; `ChargeTiming` is legacy. Spec 039:
- `SpaceSelectionMode` enum (TIERS / MAP) and `ApplicationForm.spaceSelection`.
- `Booth.price` (nullable; overrides the tier price).
- `Application.tierChosenByVendor` (an APPROVED application may have a null `tierId` on a TIERS form).
- Migrations `20261014100000_vendor_space_selection` and `20261015100000_vendor_chosen_tier`; data via `npm run db:backfill:039-space-selection`.

See `docs/wiki/features/applications.md` and `docs/wiki/features/vendor-space-selection.md`.

Online Store › Preferences: `Organization.storefrontPrivate` / `storefrontPasswordHash` / `storefrontMessage` / `seoTitle` / `seoDescription` (`20260929000000_online_store_preferences`), `autoRedirectLanguage` (`20260929100000_storefront_language_redirection`, stored only until the storefront is localized). The client in `src/index.{js,ts}` is built with `omit: { organization: { storefrontPasswordHash: true } }`, so the hash is absent from every query result unless it passes `omit: { storefrontPasswordHash: false }` or selects it explicitly. See `docs/wiki/features/online-store-preferences.md`.

Tax (spec 009): `TaxRegion` is unique on `(organizationId, country, region)` and keyed by `Venue.state` (two-letter US code, enforced by the venue validator). `Event.taxRate` / `taxRateSource` cache the resolved rate; `Organization.taxInclusivePricing` switches the fee math. `20260914010000_tax_regions` backfilled `collecting = true, source = STRIPE` for every existing organization/state. See `docs/wiki/features/tax-settings.md`.

## Seed Data

`prisma/seed.ts` — Run via `npm run db:seed`. Update when adding required fields.

Add-ons (spec 012): `AddOn.quantityTotal` null = unlimited; `quantitySold` / `quantityReserved` move only through `AddOnService.reserve/commit/release/unsell` (conditional raw UPDATE). `OrderAddOn` is unique on `(orderId, addOnId)`; add-on lines are never `OrderItem`s. Spec 037: `AddOnProduct` is the org-level saved add-on (name unique per org, case-insensitive in the service); `AddOn.productId` points an offering at it (nullable until `db:backfill:037-add-ons`); `OrderAddOn.name` is the receipt snapshot (NOT NULL, `20261010100000_saved_add_ons`).
