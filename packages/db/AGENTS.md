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

## Models (32 models, 24 enums)

Core chain: Organization → Venue → Event → PriceTier → OrderItem → Ticket
Supporting: User, OrganizationMember, OrganizationDomain, OrganizationStripeAccount, Account, VerificationToken, Contact, BuyerLoginToken, Order, PaymentTransaction, Refund, OrganizationPerson, TierPreset, TaxRegion, File, Image
Applications (spec 011): ApplicationForm → ApplicationTier / ApplicationQuestion; ApplicantProfile (+ ApplicantProfileImage) per organization + contact; Application → ApplicationAnswer / ApplicationDecision / ApplicationRefund; ApplicationMessageTemplate per organization
Enums: UserRole (UNASSIGNED/ORGANIZER/ADMIN/SYSTEM_ADMIN), MemberRole (ADMIN/ORGANIZER, per-org staff role), BuyerTokenPurpose (WELCOME/LOGIN), DomainStatus (PENDING/VERIFIED/ACTIVE/FAILED), OrganizationStatus, ThemeMode (LIGHT/DARK/SYSTEM, org public-page enforcement), EventStatus, OrderStatus, TierVisibility, TicketStatus, PaymentStatus, RefundStatus, TaxSource (STRIPE/MANUAL)

Tenancy: `Contact` is unique on `(organizationId, email)`; `OrganizationMember` holds staff affiliation. `User.organizationId` and `Contact.userId` were dropped in `20260913130000_drop_legacy_identity_columns` (which also renamed `UserRole.CUSTOMER` to `UNASSIGNED`). `20260913000000_contact_per_org_and_membership` did the original backfill in one transaction.

Applications (spec 011): `Application` keeps an amount snapshot (`subtotal … applicantPays, orgReceives`) taken at submission — never recompute it from the tier. `ApplicationTier.quantityApproved` / `quantityReserved` are moved only inside `ApplicationService` capacity transactions. `Contact.stripeCustomerId` is unique. `ApplicantProfile` is unique on `(organizationId, contactId)`; `Application.statusTokenHash` is unique. `Organization.applicationDigestEnabled` / `applicationDigestAt` drive the organizer daily digest (`20260917120000_application_digest`). Enums: ApplicationFormKind, ApplicationFormStatus, ChargeTiming, FeeMode, OverduePolicy, ApplicationStatus, ApplicationPayment, CapacitySlot, QuestionType, ApplicationAction, WithdrawnBy. See `docs/wiki/features/applications.md`.

Tax (spec 009): `TaxRegion` is unique on `(organizationId, country, region)` and keyed by `Venue.state` (two-letter US code, enforced by the venue validator). `Event.taxRate` / `taxRateSource` cache the resolved rate; `Organization.taxInclusivePricing` switches the fee math. `20260914010000_tax_regions` backfilled `collecting = true, source = STRIPE` for every existing organization/state. See `docs/wiki/features/tax-settings.md`.

## Seed Data

`prisma/seed.ts` — Run via `npm run db:seed`. Update when adding required fields.
