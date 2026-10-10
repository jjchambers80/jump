# Spec 047 — Donations, phase DV: nonprofit verification and charity agreement

**Status**: Plan, 2026-10-09. Nothing built.
**Ask**: decide which organizations may take gifts and what may be said about them, before D1 puts a gift step in checkout. Research: [Donation platforms](../../docs/research/2026-10-08-donation-platforms.md) §9 "DV" and §10; law: [Donation legal compliance](../../docs/research/2026-10-08-donation-legal-compliance.md) §2.1, §2.2, §3.2–3.5, §5 rows 1, 16, 17, 18, 20, 23. D0 ([plan-d0.md](./plan-d0.md)) is merged: per-line `platformFeeRate` / `feeMode` in both fee libraries with the shared fixture, `Order.organizationId`, and the `DONATION_TERMS` / `RECURRING_GIFT` drafts. D0-S (direct charges) is built in parallel; DV does not plan its work.

DV ships **no donor-facing gift UI**. Its one storefront change is the **3% ticket platform fee** for verified nonprofits.

**Owner decisions (2026-10-09)** this plan follows:

- Option C: every charge is a direct charge on the organization's own Stripe account (D0-S).
- **Flat 3% platform fee for every verified nonprofit** (`DEDUCTIBLE_170C` or `EXEMPT_NOT_DEDUCTIBLE`), not tied to a plan; 5% otherwise. Verification sets `Organization.platformFeeRate`, revocation clears it, pending orders keep the fee they were priced with.
- No counsel. The receipt, disclosure and `DONATION_TERMS` text comes from IRS Publication 1771 and the state legends, approved by the owner. CA and HI donors are geofenced at launch; the geofence itself is D1.
- Stripe's confirmation (Hermes t_570ef200) is a follow-up, not a gate.
- Email over in-app inboxes. Customers stays the one contact list. Every admin page shows one org at a time. Admin keeps its Tailwind/shadcn conventions.

## 1. What exists today (origin/main caab117)

| Piece | Where | What DV needs from it |
|---|---|---|
| Organization identity | `schema.prisma:472` `model Organization`: `companyName` ("Legal entity name, if different from the store name", `StoreAddressDialog.tsx:119`), `ein` (`:494`), `state`, `status` (`ACTIVE`/`INACTIVE`, suspension enforced since #380) | Legal name and EIN for review and receipts. **No deductibility, rate or disclosure fields** |
| EIN handling | `OrganizationService.js:14-20` returns only `einMasked` / `hasEin`; `organizationValidators.js:169` `validateUpdateBusinessDetails` (partial PATCH), `:246-253` EIN format | The org enters its EIN in Settings › General. SYSTEM_ADMIN review needs it unmasked |
| Consent | `LegalDocument` has `DONATION_TERMS` (`schema.prisma:1660`); `LegalSource` (`:1672`) includes the unused `ADMIN_INTERSTITIAL`; `config/legal.js:10-19` `donationTerms: '2026-10-09-draft'`; `LegalAcceptanceService.assertCurrent` (`:49`) and `.record` (`:92`) | Charity agreement acceptance with no schema change |
| Legal pages | `frontend/src/app/legal/[slug]/page.tsx` renders `frontend/content/legal/<slug>.md`; `LEGAL_SLUGS` in `lib/legalContent.ts:9`; 404 unless `NEXT_PUBLIC_LEGAL_PAGES_ENABLED` | Home for the agreement text. Settings › Donations must show it even while the flag is off |
| SYSTEM_ADMIN | `routes/adminSystem.js:42-52` (list, detail, `PATCH …/status` with `requireRecentAuth`); `SystemAdminService.setOrganizationStatus` (`:73-86`) audits via `SecurityEventService.record(actor.id, 'ORG_SUSPENDED', { meta: { organizationId } })`; UI at `app/admin/system/organizations/{page,[id]/page}.tsx` with URL-backed status chips | Review queue and decision. Copy the suspension pattern |
| Org settings | `app/admin/settings/SettingsNav.tsx:14` `SECTIONS`; `SettingsDialog`, `SummaryRow`, `formShared.ts`; tax routes use `requireAdmin` + `activeOrgFor(req)` (`admin.js:464`) | Settings › Donations follows the Tax page |
| Staff email | `EmailService.js:61` `eventimusEmail(...)`, used by `sendSecurityNotice` (`:433`); AGENTS.md gotcha 34: staff email is Eventimus-branded and names the org | Review-request and decision emails |
| Fee rate | `config/fees.js` `platformFeePercent: 0.05`; D0-B per-line `platformFeeRate` in `FeeService.js:58` and `fees.ts` `computeOrderFees`; fixture `backend/tests/fixtures/fees.fixtures.json` | Libraries already accept a per-line rate. **No caller passes one yet** |
| Rate callers (backend) | `OrderService.js:311-327` (tickets + add-ons; org selected at `:198`); `ApplicationFormService.js:51-55` `applicationAmounts` (all application pricing: `OrderLineService.js:34`, `tierAmounts`, public form `:968`, `:992`, `MapService.js:592-605` map prices and legend, `ApplicationService.js:890, 943`) | One line each: pass the org's rate |
| Rate callers (frontend) | `fees.ts:90` `computeTierAllInPrice` and `addOns.ts:98` `addOnAllInPrice` hard-code `FEE_CONFIG.platformFeePercent`; called from `TierStub.tsx:41`, `EventDetailClient.tsx:320, 349`, `checkout/[eventId]/page.tsx:442`, `AddOnPicker.tsx:51`, admin `AddOnsSection.tsx:188, 287`, `TaxInclusiveConfirmDialog.tsx:26-27`; `lib/applications.ts:285` uses `pricing` from `ApplicationService.js:923-928` | Need the rate in the payload and a rate parameter |
| Public payloads | `EventService.js:1410` (`taxInclusivePricing` beside the org fields; org selected at `:568`, `:1044`) | Add `platformFeeRate` beside it |
| Rates display | `PaymentSettingsService.js:359-363` `rates.platformFeePercent` = constant; `settings/payments/page.tsx:310` "5% of ticket price" | Show the org's effective rate |
| Stripe readiness | `OrganizationStripeAccount.chargesEnabled`, `disconnectedAt` (`schema.prisma:647`) | One input to the good-standing gate |

## 2. Scope and cards

| Card | What | Depends on |
|---|---|---|
| **DV-A** | Schema, `NonprofitService` (status changes, rate, audit, emails, eligibility), SYSTEM_ADMIN API | — |
| **DV-B** | 3% rate into every price path and surface, fixture cases | DV-A (column) |
| **DV-C** | SYSTEM_ADMIN review UI: list filter + Nonprofit card on the organization page | DV-A |
| **DV-D** | Settings › Donations: status, request verification, charity agreement, readiness | DV-A |
| **DV-E** | Settings › Donations: receipt identity and state disclosures | DV-D |
| **DV-O** | Ops, no code: agreement text, SYSTEM_ADMIN runbook | — (text needed before DV-D merges) |

B, C and D can run in parallel after A. Each is one PR.

**Not in DV** (and why):

- **IRS bulk-file lookup table and the automated monthly revocation job.** Loading Pub 78 + the revocation list (~1.3M rows, monthly) is a data pipeline for one launch customer. DV ships a manual re-check (§4.3). The job becomes card **DV-R** when there are about ten verified organizations or before any self-serve signup path offers the nonprofit rate (open question 3).
- **Evidence upload.** Determination letters, group-ruling letters and church attestations come in by **email** (reply to the review-request email). SYSTEM_ADMIN records what was received in the evidence note. No file storage for tax documents.
- **The geofence.** `DONATIONS_GEO_BLOCK` protects Jump, not the org, so it is a platform env setting built by D1, not an org setting.
- **California AG "May Not Operate or Solicit" check.** Needed only if Jump registers in California. Geofence instead.
- **Rendering** of the deductibility sentence, §6113 notice, legends and "About this gift": D1 (gift step and receipt). DV stores the settings and previews the legends.
- **Gifts-by-state export**: D4.

## 3. Data model

One migration, all additive. Nullable columns or columns with defaults, so it is safe under CI migration checks.

```prisma
enum DeductibilityStatus {
  NOT_VERIFIED           // default; never reviewed, or verification removed
  DEDUCTIBLE_170C        // gifts are deductible (Pub 78 listed, or church / group / government evidence)
  EXEMPT_NOT_DEDUCTIBLE  // exempt but not 170(c) (501(c)(4), (6), (7)…): §6113 notice applies
  NOT_EXEMPT             // reviewed and declined
}

model Organization {
  // existing: companyName (legal name), ein, state, status
  deductibilityStatus      DeductibilityStatus @default(NOT_VERIFIED)
  deductibilityRequestedAt DateTime?  // org asked for review; null once decided
  deductibilityVerifiedAt  DateTime?  // last time SYSTEM_ADMIN confirmed against IRS data
  deductibilityEvidence    Json?      // §3.1
  platformFeeRate          Decimal?   @db.Decimal(5, 4) // null → FEE_CONFIG (5%); 0.03 when verified
  stateDisclosures         Json?      // §6
  privacyPolicyUrl         String?
}
```

**Challenged and dropped** (research §9 / compliance §5 listed them):

| Field | Why not |
|---|---|
| `legalName` | `companyName` already is "Legal entity name"; receipts use `companyName ?? name`. SYSTEM_ADMIN checks it against the IRS name during review |
| `receiptSignatory` | IRS Pub 1771 requires no signature on a written acknowledgment |
| `deductibilityVerifiedById` | The `SecurityEvent` audit row (actor + `meta.organizationId`) records who decided, as for suspension |
| `donationAgreementAcceptanceId` | The latest `LegalAcceptance` with `organizationId`, `document: DONATION_TERMS` answers it, and a version bump makes it stale without touching the org |
| `donationsEnabled` | Derived by the eligibility gate (§8); a stored flag could drift from status |

`platformFeeRate` stays a column rather than a rule derived from status, because the owner chose it and it allows a negotiated rate later. DV writes only `0.03` or `null`, never another value, and has no UI to edit it.

### 3.1 `deductibilityEvidence`

```json
{
  "claim": "CHARITY | CHURCH | GROUP_SUBORDINATE | GOVERNMENT | OTHER_EXEMPT",
  "groupExemptionNumber": "1234",           // GROUP_SUBORDINATE only
  "orgNote": "≤ 500 chars, from the request",
  "source": "PUB78 | DETERMINATION_LETTER | GROUP_RULING | CHURCH_ATTESTATION | GOVERNMENT",
  "pub78Code": "PC | POF | PF | GROUP | LODGE | …",  // source PUB78 only
  "adminNote": "≤ 1000 chars"
}
```

The org writes `claim` / `groupExemptionNumber` / `orgNote` only while not verified. SYSTEM_ADMIN writes the rest. The JSON lives on one row, so no second table is needed.

## 4. Verification flow

### 4.1 Request (org admin)

1. Settings › Donations › **Request verification** (ADMIN). Requires `ein` and `companyName` to be set (400 `EIN_REQUIRED` / `LEGAL_NAME_REQUIRED`, with a link to Settings › General).
2. The org picks a claim: *501(c)(3) public charity or private foundation* · *Church or religious organization* · *Covered by a group exemption* (+ GEN) · *Government unit* · *Another exempt organization (501(c)(4), (6), (7)…)*, and may add a note.
3. Sets `deductibilityRequestedAt = now`, stores the claim. Emails every active SYSTEM_ADMIN (Eventimus-branded, names the org, button to the org's system page, `reply-to` the requester). The org sees "Under review. We'll email you. If you're a church, group member or government unit, reply to that email with your letter."
4. 409 `ALREADY_REQUESTED` while a request is open; 409 `ALREADY_VERIFIED` when verified.

### 4.2 Review (SYSTEM_ADMIN)

On `/admin/system/organizations/:id`, the **Nonprofit** card shows: claim and note, `companyName`, the unmasked EIN (SYSTEM_ADMIN only), city/state, and lookup links that open in a new tab: IRS Tax Exempt Organization Search for the EIN, and ProPublica Nonprofit Explorer `/organizations/<ein>`. Check the exact URL formats when building. No server-side calls.

The SYSTEM_ADMIN checks:

- the EIN is in Pub 78 under a name matching `companyName`;
- it is not on the auto-revocation list;
- the Pub 78 deductibility code.

Codes `PC` / `POF` / `PF` / `LODGE` / `GROUP` → `DEDUCTIBLE_170C`. An exempt org that is not 170(c) (EO BMF subsection ≠ 03) → `EXEMPT_NOT_DEDUCTIBLE`. Churches, group subordinates and government units are absent from Pub 78: verify them from the emailed letter or attestation (`source` set to match).

**Decide** dialog: status (4 options), source, Pub 78 code, note. Step-up (`requireRecentAuth`, `withReauth`), like Suspend.

### 4.3 Re-check (manual in DV)

- **Confirm still listed** on a verified org writes the same status again and only bumps `deductibilityVerifiedAt`.
- The list's **Re-check due** filter shows verified orgs with `deductibilityVerifiedAt` older than 30 days.
- The runbook (DV-O) has SYSTEM_ADMIN work that filter monthly against the newest revocation file. A hit → set `NOT_VERIFIED` with a note.
- DV-R automates this later.

### 4.4 What a decision does (`NonprofitService.decide`, one transaction)

| Transition | `platformFeeRate` | Request | Email to org ADMINs |
|---|---|---|---|
| any → `DEDUCTIBLE_170C` / `EXEMPT_NOT_DEDUCTIBLE` | `0.03` | cleared | "Verified: your ticket fee is now 3%" (+ what the status means for gift wording) |
| verified → `NOT_VERIFIED` / `NOT_EXEMPT` (revocation) | `null` | cleared | "Nonprofit verification removed: ticket fee back to 5%, gifts off" + reason from `adminNote` |
| request → `NOT_EXEMPT` (decline) | stays `null` | cleared | "We couldn't verify…" + reason |
| same status (re-check) | unchanged | unchanged | none |

Every change is audited with `SecurityEventService.record(actor.id, 'ORG_DEDUCTIBILITY_CHANGED', { req, meta: { organizationId, from, to, source, pub78Code } })` and logged with `event: 'organization_deductibility_changed'`, as `setOrganizationStatus` does.

**Identity changes invalidate verification.** `OrganizationService.updateBusinessDetails`:

- an `ein` change on a verified org → `NOT_VERIFIED`, rate `null`, audit with `actorId` = the editor, revocation email;
- a `companyName` change → keep the status and set `deductibilityRequestedAt = now`, so the org is back in the review queue.

### 4.5 Pending orders keep their fee

- Ticket orders are priced once, in `createOrder`. The Checkout session amount and `Order.platformFeeAmount` are fixed there, and nothing reprices them. A rate change affects only orders created afterwards.
- Application orders: an existing order is re-priced only when staff rewrite it (add-ons, adjustments, booth placement through `OrderLineService.applicationOrderData`). That reads the org's **current** rate, exactly as it already reads the event's current tax rate. A decision never sweeps or rewrites orders.

## 5. Settings › Donations (org admin, DV-D + DV-E)

`/admin/settings/donations`. In `SettingsNav` after Tax, `roles: ['ADMIN', 'SYSTEM_ADMIN']`, shown only with `NEXT_PUBLIC_DONATIONS_ENABLED`. One org at a time (active org, `X-Jump-Org`). Built from the Tax page's card + `SummaryRow` + `SettingsDialog` pattern.

```
Donations
┌ Nonprofit status ─────────────────────────────────────────────┐
│ ● Verified · 501(c)(3), gifts are tax-deductible              │
│   Checked 9 Oct 2026 · Ticket platform fee 3% (was 5%)        │
│   [Request verification]  (when not verified / under review)  │
└───────────────────────────────────────────────────────────────┘
┌ Charity agreement ────────────────────────────────────────────┐
│ Accepted by Jo Smith on 9 Oct 2026 (version 2026-10-09)       │
│   [Read and accept]  (when missing or out of date)            │
└───────────────────────────────────────────────────────────────┘
┌ Receipt details ──────────────────────────────────────────────┐  DV-E
│ Legal name  Raleigh Retro Gamers Inc.   Edit in General ›     │
│ EIN         ••-•••6789                  Edit in General ›     │
│ Privacy policy  https://…               [Edit]                │
└───────────────────────────────────────────────────────────────┘
┌ State disclosures ────────────────────────────────────────────┐  DV-E
│ Registration is your organization's responsibility. …         │
│ North Carolina  On · License 12345 · 919-814-5280   [Edit]    │
│ Add a state ▾                                                 │
│ Local focus sentence  Off                            [Edit]   │
└───────────────────────────────────────────────────────────────┘
┌ Ready to take gifts ──────────────────────────────────────────┐
│ ✓ Verified nonprofit  ✓ Agreement accepted  ✗ Stripe connected│
│ Gifts arrive with phase D1.                                   │
└───────────────────────────────────────────────────────────────┘
```

- **Mobile first.** Single column at 360 px, cards stack, and every dialog is full-screen below `sm`. Rows wrap: label above value. No horizontal scroll. On desktop the Settings nav sits on the left, as on every Settings page.
- **WCAG 2.2 AA:**
  - Status pills carry text, not colour alone.
  - Each card is a `section` with an `aria-labelledby` heading.
  - Save and decision results are announced through `role="status"`. Form errors are linked with `aria-describedby`, and focus moves to the first invalid field.
  - Targets are ≥ 24 × 24 px (2.5.8). The sticky dialog footer never covers a focused field (2.4.11).
  - The agreement's scroll region is keyboard-focusable (`tabIndex=0`, labelled).
  - Accepting needs only a checkbox and a button: no drag, no timed step, no re-typing (3.3.7 / 3.3.8).
- **Agreement dialog.** `page.tsx` is a server component that reads `frontend/content/legal/donation-terms.md` through `loadLegalDocument` (add `donation-terms` to `LEGAL_SLUGS`) and passes the text to the client page, so the agreement renders whether or not `NEXT_PUBLIC_LEGAL_PAGES_ENABLED` is set. The front-matter `version` must equal `LEGAL_VERSIONS.donationTerms`, and a unit test asserts this. The dialog has a checkbox ("I accept the Eventimus Charity Agreement on behalf of {org} and confirm I'm authorized to") and an **Accept** button.
- **Organizers** (non-ADMIN) do not see the section, the same as Users.

## 6. State disclosures (DV-E)

`stateDisclosures` JSON:

```json
{
  "localFocus": { "enabled": false, "text": "≤ 200 chars, plain text" },
  "states": {
    "NC": { "enabled": true, "registration": "LICENSED | EXEMPT | NOT_REQUIRED",
            "registrationNumber": "≤ 50", "phone": "≤ 30" }
  }
}
```

- **Legend text** lives in one backend config, `backend/src/config/stateDisclosures.js`: per state, its `legend(fields)` and the fields it needs (`phone`, `registrationNumber`). `GET` returns each rendered legend for the preview; D1 renders the same strings. The legends are not duplicated in the frontend, so there is no parity pair.
- **Launch states.** These four have statute text read in compliance §3.2–3.3:
  - **NC** (131F-9(c); phone default `919-814-5280`, editable);
  - **FL** (496.411(3), all caps, registration number and toll-free number);
  - **NY** (174-b(1));
  - **PA** (§13(c)).

  VA, WA, NJ, MD, MS and WV are marked ‡ (unverified) in the research. DV-O pastes each legend from the statute before that state is added to the config. Until then, those states are not offered.
- **NC default.** An org with `state = 'NC'` and no saved NC row reads as `NC: { enabled: true, registration: null }`. The readiness card then asks for a license number or **Exempt** (131F-3(3): under $50,000 and all-volunteer). The org's home state is always listed first.
- **Copy.** The card opens with: "Charitable solicitation registration is your organization's responsibility. Eventimus does not register for you." (§5 row 18.)
- **Validation.** `validateUpdateDonationSettings` is a partial PATCH, like `validateUpdateBusinessDetails`:
  - whitelisted keys `privacyPolicyUrl`, `stateDisclosures`;
  - state codes from the config only;
  - `privacyPolicyUrl` is `https:` and ≤ 500 chars;
  - text is plain and length-capped;
  - the stored JSON is replaced whole for the keys sent.

## 7. 3% platform fee in every price path (DV-B)

**One rule:** `platformFeeRateFor(organization) = organization.platformFeeRate != null ? Number(organization.platformFeeRate) : FEE_CONFIG.platformFeePercent`.

It goes in `config/fees.js` next to `FEE_CONFIG`, together with `NONPROFIT_PLATFORM_FEE_RATE = 0.03`, which `NonprofitService` writes. It applies to **every line Jump charges a fee on**: ticket tiers, add-ons and application tiers (the map page is an application surface). D1 gift lines stay at 0%. Open question 1 confirms that applications are included.

**Backend:**

- `OrderService.createOrder`: add `platformFeeRate: true` to the org select (`:198`), and give every `feeItems` entry (`:313-323`) `platformFeeRate: rate`.
- `applicationAmounts` (`ApplicationFormService.js:54`): items carry `platformFeeRate: platformFeeRateFor(organization)`. This one line covers order snapshots, public form tiers, the map's booth prices and legend, and the vendor choose step.
- Every org `select` feeding those callers adds `platformFeeRate`: `ApplicationService.js:163, 177`; `ApplicationFormService.js:116, 131, 142`; `MapService.js:517`; `EventService.js:568, 1044`. The DV-B PR greps `taxInclusivePricing: true` in selects; every hit that prices anything gets `platformFeeRate`.
- Payloads:
  - `EventService.js:1410` adds `platformFeeRate` (number, the effective rate, never null);
  - `ApplicationService.js:923` `pricing` adds `platformFeeRate`;
  - `PaymentSettingsService.js:360` returns the effective rate plus `nonprofitRate: boolean`.

**Frontend:**

- `computeTierAllInPrice(listed, taxRate, taxInclusive, platformFeeRate = FEE_CONFIG.platformFeePercent)` and `addOnAllInPrice(addOn, taxRate, taxInclusive, platformFeeRate = …)`. The default keeps every existing call and test unchanged.
- Callers pass `event.platformFeeRate`: `TierStub.tsx:41` (via prop), `EventDetailClient.tsx:320` (per item) and `:349`, `checkout/[eventId]/page.tsx:442` (per item), `AddOnPicker.tsx:51`, and `lib/applications.ts:285` (`pricing.platformFeeRate`).
- Admin previews: `AddOnsSection.tsx:188, 287` reads the rate from the event it edits; `TaxInclusiveConfirmDialog.tsx:26-27` reads it from the tax settings payload.
- Settings › Payments (`page.tsx:310`): "3% of ticket price · verified nonprofit rate" or "5% of ticket price · 3% for verified nonprofits (Settings › Donations)".

**Parity and fixtures (Gotcha 12).** Both libraries already take the per-line rate, so DV adds cases to `backend/tests/fixtures/fees.fixtures.json`, which Jest and Vitest both assert:

1. The research §7.2 table at 3%, one ticket each: $10 → **$10.90**, $25 → **$26.80**, $50 → **$53.29**, $100 → **$106.29**, $250 → **$265.27**.
2. A $25 ticket at 3%, tax-inclusive at 7.25%.
3. Two tickets at 3% + an untaxed add-on at 3%.
4. A 3% ticket + a 0% ABSORB line (D1's gift shape at the nonprofit rate).

Vitest also asserts that `computeTierAllInPrice(p, t, inc, r).total` and `addOnAllInPrice(…, r).total` equal `computeOrderFees([one item at r]).total` for every single-item fixture case, so the two all-in helpers (which have no backend twin) cannot drift from the order math.

## 8. Good-standing gate

`NonprofitService.eligibility(organizationId)` returns `{ eligible, reasons[] }`. It is read-only and computed on every call (no column):

| Reason | When |
|---|---|
| `DONATIONS_DISABLED` | `DONATIONS_ENABLED !== 'true'` |
| `ORG_SUSPENDED` | `status = INACTIVE` |
| `NOT_VERIFIED` | status not in `DEDUCTIBLE_170C` / `EXEMPT_NOT_DEDUCTIBLE` |
| `AGREEMENT_REQUIRED` | no `DONATION_TERMS` acceptance for the org at the **current** version |
| `STRIPE_NOT_READY` | no `OrganizationStripeAccount` with `chargesEnabled` and no `disconnectedAt` |
| `NC_REGISTRATION_REQUIRED` | NC org with NC `registration` unset (§5 row 18) |

The readiness card in Settings › Donations renders it. **D1 calls it** before showing the gift step and again inside order creation for a DONATION line, which refuses with 409 `DONATIONS_NOT_AVAILABLE`. Revocation, suspension or a new agreement version turns gifts off with no extra write. The revocation email (§4.4) is the notification.

## 9. API

New router `backend/src/api/routes/donationSettings.js`, mounted at `/admin/settings/donations` in `server.js`. It uses `requireAuth`, `requireOrganizer` and `requireAdmin`, plus `activeOrgFor(req)`. Every route answers 404 when `DONATIONS_ENABLED` is off. Logic lives in `NonprofitService`; validators live in `validators/donationValidators.js`.

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/admin/settings/donations` | — | status, verifiedAt, requestedAt, claim, effective `platformFeeRate`, agreement `{ version, acceptedAt, acceptedBy, current }`, receipt `{ legalName, einMasked, privacyPolicyUrl }`, `stateDisclosures` with rendered legends, `eligibility` |
| POST | `/admin/settings/donations/verification` | `{ claim, groupExemptionNumber?, note? }` | §4.1. Rate-limited with the `MEMBER_INVITE` budget (it sends email) |
| POST | `/admin/settings/donations/agreement` | `{ acceptances: [{ document: 'DONATION_TERMS', version }] }` | `assertCurrent(acceptances, ['DONATION_TERMS'])`, then `record` with `subjectType: USER`, `subjectId: req.user.id`, `email`, `organizationId`, `source: ADMIN_INTERSTITIAL`, `referenceType: 'Organization'`, `requestMeta(req)` |
| PATCH | `/admin/settings/donations` | `{ privacyPolicyUrl?, stateDisclosures? }` | Partial PATCH (§6) |

SYSTEM_ADMIN, in `adminSystem.js` / `SystemAdminService`:

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/system/organizations?nonprofit=REQUESTED\|RECHECK_DUE\|VERIFIED` | Extends `validateOrganizationListQuery`. List rows gain `deductibilityStatus` |
| GET | `/admin/system/organizations/:id` | Adds a `nonprofit` block: status, evidence, requestedAt, verifiedAt, **unmasked `ein`**, `companyName`, lookup URLs |
| PATCH | `/admin/system/organizations/:id/deductibility` | `{ status, source?, pub78Code?, note? }`; `requireRecentAuth`. `source` is required for the two verified statuses |

Errors use the existing coded-error pattern: `EIN_REQUIRED`, `LEGAL_NAME_REQUIRED`, `ALREADY_REQUESTED`, `ALREADY_VERIFIED`, `LEGAL_VERSION_STALE`.

## 10. Emails

All of these are staff email, so Eventimus-branded through `eventimusEmail` with the org named in the copy (gotcha 34). They are sent by one `EmailService.sendNonprofitNotice({ to, replyTo?, title, paragraphs, link })`. A failure is logged and never rolls back the decision, the same as the system-admin invite.

| Trigger | To | Link |
|---|---|---|
| Verification requested | every active SYSTEM_ADMIN, `reply-to` the requester | `/admin/system/organizations/:id` |
| Verified / declined / revoked / EIN changed | the org's ADMIN members | `/admin/settings/donations` |

There is no in-app inbox and no notification table.

## 11. Tests

- **DV-A**
  - Unit: the `decide` transition table (§4.4), including the rate set/cleared and the re-check that only bumps `verifiedAt`.
  - Contract:
    - `PATCH …/deductibility` needs SYSTEM_ADMIN + step-up; a non-system user gets 403.
    - The audit row and the emails (mocked `deliver`) are written.
    - The `nonprofit` list filters work.
    - An EIN change through business details resets a verified org.
    - The eligibility reasons, one test per row of §8.
- **DV-B**
  - The fixture cases (§7) pass in both Jest and Vitest, with every existing case unchanged.
  - Contract: a verified org's `POST /orders` writes `platformFeeAmount` at 3% and the Checkout line amounts match. The public event payload carries `platformFeeRate: 0.03`. Application tier amounts and the map legend use 3%.
  - An order created at 3% and then completed by webhook after revocation keeps its amounts.
- **DV-C / DV-D / DV-E**
  - Playwright with `signInAsStaff` and `page.route` mocks (gotcha 11), scoped to visible elements:
    - request verification;
    - accept the agreement (checkbox required, success announced);
    - edit an NC disclosure at 360 px width;
    - the SYSTEM_ADMIN Decide dialog.
  - An axe check on each page.
  - A Vitest test that the `donation-terms.md` front-matter version equals the backend version, read through the `/legal/versions` fixture.
  - Validator unit tests: unknown key, unknown state, a non-https URL, over-length text.

## 12. Rollout

- `DONATIONS_ENABLED` (backend) and `NEXT_PUBLIC_DONATIONS_ENABLED` (frontend, build time). Both are added to the AGENTS.md env table in DV-D. When off, the routes return 404, the nav item is hidden, the SYSTEM_ADMIN Nonprofit card is hidden and eligibility reports `DONATIONS_DISABLED`.
- The 3% rate (DV-B) depends only on the column, which only a SYSTEM_ADMIN decision writes, so it needs no flag of its own: it is live for an org the moment that org is verified.
- **Production.** DV exposes no donor surface and creates no gift, so DV can run in production before L1–L8 clear. That lets the first customer get verified and see 3% tickets before D1. D1 must then gate the gift step on more than the flag (open question 2).
- **Docs**, in the PR that ships each piece:
  - `docs/wiki/features/nonprofit-verification.md`;
  - the SYSTEM_ADMIN runbook (DV-O);
  - Gotcha 12 (rates come from `platformFeeRateFor(org)`, never `FEE_CONFIG` directly, in callers);
  - a new gotcha: "Nonprofit status: only `NonprofitService.decide` writes `deductibilityStatus` / `platformFeeRate`; never print 'tax-deductible' unless `DEDUCTIBLE_170C`; gifts gate on `eligibility()`".

## 13. DV-O: ops (no code)

| # | Item | Owner | Output |
|---|---|---|---|
| O1 | Write `frontend/content/legal/donation-terms.md` from the research §9 DV list: consent to use the org's name (AB 488 / HRS 467B), agency, authority to send acknowledgments in the org's name, data processing, payout timing (its own Stripe account), dispute recovery, the org's own registration duties | Owner | Approved text. The version moves from `-draft` to a date in `config/legal.js` and the front matter together |
| O2 | Paste the VA, WA, NJ, MD, MS and WV legends from each statute into `config/stateDisclosures.js` | Owner + engineering | Each state is enabled only once its text has been read from the source |
| O3 | SYSTEM_ADMIN runbook: review steps (§4.2), mapping from codes to status, the monthly re-check against the newest revocation file, email templates for asking churches and group members for evidence | Engineering | Section of the wiki page |
| O4 | Verify the first customer (Raleigh) | Owner | Status set, NC registration recorded |

## 14. Done when

- DV-A through DV-E are merged with CI green, and every existing fee fixture case is unchanged.
- In a dev build with the flags on:
  - an org admin requests verification and SYSTEM_ADMIN gets the email;
  - SYSTEM_ADMIN verifies it from the system page;
  - the org's event page, checkout, add-on picker, apply form and map show 3% all-in prices, and the backend charges exactly those amounts;
  - revocation brings back 5% for new orders and leaves pending ones alone;
  - the org accepts the agreement and sets the NC disclosure;
  - the readiness card shows only `STRIPE_NOT_READY` until D0-S connects an account.
- O1 and O3 are done before the first production verification; O2 is done before D1 shows any of those states' legends.

## 15. Open questions

1. **Does 3% cover application and add-on fees too?** The plan says yes: one rate per org, matching the research's listing of the map page. The alternative, tickets only, needs a per-kind rate in `applicationAmounts`.
2. **One flag or two?** Running DV in production early (§12) means D1 can't rely on `DONATIONS_ENABLED` alone to keep gifts dark until L1–L8 clear. Options: a second flag `DONATION_GIFTS_ENABLED` for D1, or keep DV dark until D1 launches. The plan recommends a second flag.
3. **When does DV-R (automated revocation re-check) become required?** The plan proposes: at about 10 verified orgs, or before any self-serve path offers the rate.
4. **EIN change resets verification; legal-name change only re-queues.** Is a legal-name change also a reset?
5. **Does an `EXEMPT_NOT_DEDUCTIBLE` org get gifts at launch, or only the 3%?** Gifts need the §6113 notice on every surface in D1. Gating gifts to `DEDUCTIBLE_170C` first would shrink D1's copy work.
