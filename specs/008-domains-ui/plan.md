# Implementation Plan: Settings › Domains (Shopify-style connect flow)

**Status**: Approved 2026-09-13. Phase A in progress on branch `feat/008-domains-ui`.
**Input**: "Create a UI to configure a custom domain, organized under Settings, placed underneath General as a new menu item. Provide the domain via a dialog; on Next, a DNS configuration is presented. The example screens are from Shopify."
**Builds on**: spec 007 phase 3 (custom domains backend), shipped to production 2026-09-13.
**Reference screens**: Shopify Settings › Domains list (`Connect existing` / `Buy new domain`, Domain | Status table with a `Primary` badge and nested platform hosts) and the domain detail page (`test.com · Needs setup`, "Managed by Network Solutions", a numbered DNS checklist with Type / Name / Current value / Update to columns, "I updated DNS records", then greyed "DNS propagation" and "TLS certificate provisioning" steps, and a `More actions › Delete domain` menu).

---

## 1. What already exists

The backend for custom domains is complete and in production. This plan is a UX rebuild of the existing Settings › Domains page plus the small backend additions the new UX needs.

| Layer | Exists today | File |
|-------|--------------|------|
| Schema | `OrganizationDomain` (`hostname`, `status` PENDING/VERIFIED/ACTIVE/FAILED, `verificationToken`, `cnameTarget`, `isPrimary`, `railwayDomainId`, `verifiedAt`, `lastCheckedAt`, `failingSince`, `lastError`) | `packages/db/prisma/schema.prisma:157` |
| Service | add / remove / setPrimary / verifyDomain (TXT + CNAME via `dns.promises`) / 10-minute sweep / host→org resolve / CORS allowlist | `backend/src/services/DomainService.js` |
| Railway client | `customDomainCreate`, `customDomain` status, `customDomainDelete`; optional, gated on `RAILWAY_API_TOKEN` + `RAILWAY_FRONTEND_SERVICE_ID` | `backend/src/lib/railwayDomains.js` |
| Admin API | `GET/POST /admin/settings/domains`, `POST /:id/verify`, `POST /:id/primary`, `DELETE /:id` — org-scoped via `resolveOrgScope`; SYSTEM_ADMIN passes `?organizationId=` | `backend/src/api/routes/admin.js:100-160` |
| Public API | `GET /domains/resolve?host=`, `GET /domains/owner?…` | `backend/src/api/routes/domains.js` |
| Edge routing | tenant host → `/organizations/[orgId]` rewrite, admin/auth 404 on tenant hosts | `frontend/src/middleware.ts`, `frontend/src/lib/storefrontHost.ts` |
| Settings nav | `General`, `Domains` — the menu item the ask describes already exists | `frontend/src/app/admin/settings/SettingsNav.tsx` |
| Domains page | Single page: inline "Add a domain" form + one card per domain with a CNAME/TXT table, Copy buttons, Verify now / Make primary / Remove | `frontend/src/app/admin/settings/domains/page.tsx` |
| Dialog shell | Focus-trapped modal with Cancel/Save header used by General settings | `frontend/src/app/admin/settings/SettingsDialog.tsx` |
| Tests | `tests/unit/domainService.test.js` (15), `tests/contract/domains.test.js` (10), `frontend/tests/unit/storefrontHost.test.ts` (11); no Playwright coverage of the Domains page | |
| Docs | `docs/wiki/features/custom-domains.md` | |

**Verdict**: nothing on the list above needs to be re-invented. The delta is (a) three new screens that follow the Shopify flow, (b) five backend additions so those screens have the data they show, and (c) one correctness fix found during research.

---

## 2. Research findings that change the design

### 2.1 Railway requires *two* DNS records; the current client only keeps one (bug)

Railway custom domains need a `CNAME` **and** a `TXT` record (`_railway-verify.<host>` → `railway-verify=<token>`). Railway's docs: *"If the TXT record is missing, requests to your custom domain will return a 404 error even after the CNAME resolves."* `createCustomDomain()` in `railwayDomains.js` extracts only the CNAME from `status.dnsRecords` and discards the TXT. So today, if `RAILWAY_API_TOKEN` is set, an organization can follow our instructions perfectly, reach ACTIVE in our database, and still get a Railway 404 on their host.

**Fix (phase A)**: when Railway is configured, use Railway's TXT as *the* ownership record instead of adding a third `_jump-verify` record. Store the record's host label and value on the row; `_checkDns` verifies whatever is stored. Our own `_jump-verify` stays as the fallback when Railway is not configured. Same security property (the org must control the DNS zone), one fewer record for the org to add, and Railway's verification and ours can never disagree.

### 2.2 Railway GraphQL enum names are unverified

`railwayDomains.js` compares against `CERTIFICATE_STATUS_TYPE_VALID`, `DNS_RECORD_STATUS_PROPAGATED`, `DNS_RECORD_TYPE_CNAME`. Railway's API guide lists `certificateStatus` as `PENDING | ISSUED | FAILED` and `dnsRecords[].status` as `PENDING | VALID | INVALID`, and does not list `recordType` at all. Spec 007 already flags this as "written from Railway's public schema and not exercised against a live token". Before phase A ships, run one introspection query with the real token and pin the names; until then match both spellings defensively.

### 2.3 Apex domains: Shopify allows them, we reject them, Railway half-supports them

Shopify's second screen shows an `A @ → 23.227.38.65` record — Shopify runs its own anycast IPs. Railway does not offer A records; apex domains work only through CNAME flattening / ALIAS at Cloudflare, DNSimple, Namecheap, bunny.net, and not at Route 53, Azure DNS, GoDaddy, Squarespace, NameSilo, Hostinger. Our `normalizeHostname` rejects apex outright, and `_checkDns` uses `resolveCname`, which never sees a flattened CNAME.

**Decision**: keep rejecting apex in the dialog for this release, but with Shopify-quality copy ("Use a subdomain such as tickets.yourvenue.com. Root domains need a DNS provider that supports CNAME flattening — see phase C"). Phase C adds apex by verifying A/AAAA(host) ⊆ A/AAAA(cnameTarget) and showing provider-specific guidance.

### 2.4 Shopify's flow, mapped to our lifecycle

| Shopify step | Our state | Data we need |
|--------------|-----------|--------------|
| Connect existing → dialog → Next | `POST /admin/settings/domains` → PENDING | exists |
| Detail page "Needs setup" | PENDING | exists |
| "Managed by Network Solutions" + Log in button | — | new: DNS provider detection via `dns.resolveNs(apex)` → known-provider table (name + DNS console URL). Best effort, nullable |
| Table with **Current value → Update to** | — | new: `dnsRecords[].currentValue` and `dnsRecords[].status` from the last check; today the observed values only exist inside `lastError` prose |
| "I updated DNS records" | `POST /:id/verify` | exists; add a 15 s server-side cooldown so polling and button clicks cannot hammer DNS |
| "DNS propagation" step | PENDING with records partially valid | derived from `dnsRecords[].status` |
| "TLS certificate provisioning" step | VERIFIED (Railway cert pending) → ACTIVE | new: persist `certificateStatus` from Railway; `n/a` when Railway is not configured (operator attaches TLS by hand — show that as an info note) |
| Connected badge | ACTIVE | exists |
| Primary badge | `isPrimary` | exists |
| Nested `roman-skin.myshopify.com` row | — | we have no per-org platform subdomain; show the platform URL `https://<frontend>/organizations/<orgId>` as a non-deletable "Jump URL" row. A per-org slug subdomain is out of scope |
| Buy new domain | — | out of scope (no registrar integration). Railway sells domains but only into the Railway account, not the org's |
| More actions › Delete domain | `DELETE /:id` | exists |

### 2.5 Railway domain limits

Trial 1, Hobby 2 per service, Pro 20 per service (raisable on request). With Railway configured, the 3rd domain on Hobby fails at `customDomainCreate`. Surface Railway's error verbatim in the dialog and log it; no product change beyond that.

Sources: Railway "Working with Domains" (`docs.railway.com/networking/domains/working-with-domains`), Railway "Manage Domains with the Public API" (`docs.railway.com/integrations/api/manage-domains`), Shopify "Connecting a third-party domain" (`help.shopify.com/en/manual/domains/add-a-domain/connecting-domains`), Railway Station threads on `_railway-verify` TXT verification.

---

## 3. UX specification

### 3.1 Settings › Domains (list) — `/admin/settings/domains`

```
Settings
Manage your organization and business information.

┌ General ┐  ┌────────────────────────────────────────────────────────────────┐
│ Domains │  │ ⌂ Domains                                   [ Connect existing ]│
└─────────┘  │ ┌────────────────────────────────────┬───────────────────────┐ │
             │ │ Domain                             │ Status                │ │
             │ ├────────────────────────────────────┼───────────────────────┤ │
             │ │ ● tickets.romanskincare.com  Primary│ ● Connected           │ │
             │ │ ├─ <frontend host>/organizations/… │ ● Connected           │ │
             │ │ ● shop.romanskincare.com            │ ● Needs setup         │ │
             │ └────────────────────────────────────┴───────────────────────┘ │
             │                                                                  │
             │ Learn more about domains  (→ docs/wiki/features/custom-domains) │
             └────────────────────────────────────────────────────────────────┘
```

- Rows are links to the detail page. The primary domain is listed first with the platform URL nested beneath it (Shopify nests the `myshopify.com` host under the primary). With no custom domains, the table shows only the platform URL row and an empty-state line: "Sell tickets on your own domain. Connect a subdomain you already own."
- Status pills: `Connected` (ACTIVE, green), `Needs setup` (PENDING, blue), `Verifying` (VERIFIED — DNS proven, certificate pending, amber), `Failed` (FAILED, red).
- `Connect existing` opens the dialog. `Buy new domain` is rendered as a disabled button with a "Coming soon" tooltip (no registrar integration; see 2.4).
- Loading skeleton, 404-org message, and `aria-live` notice region carry over from the current page.

### 3.2 Connect existing domain (dialog)

```
┌ Connect existing domain ─────────────────────────── ✕ ┐
│ Domain                                                 │
│ [ tickets.yourvenue.com                              ] │
│ Enter a subdomain you already own. Root domains        │
│ (yourvenue.com) are not supported yet.                 │
│                                                        │
│                               [ Cancel ]  [ Next ]     │
└────────────────────────────────────────────────────────┘
```

- Built on `SettingsDialog` with a new `submitLabel` prop (`Next`) — the shell already gives us focus trap, Escape, backdrop close, discard prompt, and return-focus.
- Client-side normalisation mirrors `normalizeHostname` (lowercase, strip scheme/path/port, reject `@`/spaces, require ≥3 labels) so the common mistakes — `https://`, a trailing slash, `test@test.com` as in the Shopify screenshot — get inline feedback before the request. The server remains authoritative.
- `Next` → `POST /admin/settings/domains` → on 201, `router.push('/admin/settings/domains/[id]')`. On 409/400/Railway error, show the message under the field and keep the dialog open.

### 3.3 Domain detail — `/admin/settings/domains/[id]`

```
Domains › tickets.romanskincare.com   [Needs setup]        [ Log in to Cloudflare ↗ ] [ More actions ▾ ]
Managed by Cloudflare                                                                   ├ Make primary
                                                                                        └ Delete domain
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ ◌ Configure DNS records on Cloudflare                                                 │
│   1. Log in to Cloudflare and open DNS management for romanskincare.com               │
│   2. Add this record to verify domain ownership                                       │
│      Type  Name                              Current value        Update to           │
│      TXT   _railway-verify.tickets           (empty)          →   railway-verify=…  ⧉ │
│   3. Point your domain at Jump                                                        │
│      Type  Name                              Current value        Update to           │
│      CNAME tickets                           old.host.com     →   g05ns7.up.railway.app ⧉│
│                                                        [ I updated DNS records ]      │
│ ◌ DNS propagation                                                                     │
│ ◌ TLS certificate provisioning                                                        │
└──────────────────────────────────────────────────────────────────────────────────────┘
Last checked 2 minutes ago · Checks run automatically every 10 minutes.
```

- Checklist state is derived on the client from the serialized domain:
  - **Configure DNS records**: active while any `dnsRecords[].status !== 'valid'`. Each row shows `currentValue` (or "(empty)") and the required value with a Copy button; a row that is already valid gets a check mark instead of the arrow.
  - **DNS propagation**: done when all records are valid (`status` ≥ VERIFIED, or ACTIVE without Railway). Copy while waiting: "DNS changes usually take effect within an hour but can take up to 48 hours."
  - **TLS certificate provisioning**: done when `status === 'ACTIVE'` and `certificateStatus === 'ISSUED'`; when Railway is not configured, render as an info row "Jump will attach the certificate for this domain" (operator step) rather than a spinner that never completes.
  - Status FAILED: red banner at the top ("DNS records have been missing since <failingSince>. Restore them and check again.") with the checklist reset to step 1.
- "I updated DNS records" → `POST /:id/verify`; the button shows "Checking…" and the table updates in place. The page also polls `POST /:id/verify` every 60 s while PENDING/VERIFIED and the tab is visible (the server cooldown makes this cheap), and stops polling on ACTIVE/FAILED.
- Header actions: "Log in to <provider>" opens the provider's DNS console when the provider was detected, else hidden. `More actions` menu: `Make primary` (hidden when already primary) and `Delete domain` (red; confirm with the existing `window.confirm` copy about email links breaking; on success `router.replace` to the list).
- Names are shown relative to the zone (`_railway-verify.tickets`, `tickets`) because that is what every DNS console asks for; the full FQDN is available in the Copy value and in a `title` tooltip.

### 3.4 Navigation

The `Domains` item in `SettingsNav` already sits beneath `General`. The ask says "Domain"; the Shopify reference and the plural nature of the page (one org, several hosts) argue for keeping `Domains`. Rename is a one-line change if preferred. Add `pathname.startsWith(s.href)` so the detail page keeps the nav item highlighted.

---

## 4. Backend changes

### 4.1 Schema (one migration)

```prisma
model OrganizationDomain {
  // existing fields …
  verificationHost  String  @default("_jump-verify")   // label prefix of the TXT record
  verificationToken String                              // now the FULL TXT value, e.g. "jump-verify=abc…" or "railway-verify=…"
  certificateStatus String?                             // PENDING | ISSUED | FAILED from Railway; null when not managed
  dnsProvider       String?                             // e.g. "cloudflare"; null when unknown
  lastDnsSnapshot   Json?                               // { "<recordKey>": { currentValue, status } } from the last check
}
```

Migration SQL backfills `verificationToken = 'jump-verify=' || verificationToken` for existing rows so no organization has to change a record it already published.

### 4.2 `DomainService`

- `addDomain`: when Railway is configured, take **both** the CNAME and the TXT from `customDomainCreate().status.dnsRecords`; store `verificationHost = '_railway-verify'` and `verificationToken = <railway value>`. Otherwise generate `jump-verify=<32 hex>` as today. Run `detectDnsProvider(hostname)` (best effort, 2 s timeout) and store the result.
- `_checkDns`: resolve `${verificationHost}.${hostname}` TXT and the CNAME; return a structured result `{ txt: { currentValue, status }, cname: { currentValue, status } }` in addition to the `problems` array. Persist it to `lastDnsSnapshot`.
- `verifyDomain`: if `lastCheckedAt` is within 15 s, return the stored row without re-resolving (cooldown). Persist `certificateStatus` from the Railway status call.
- `serialize`: add `certificateStatus`, `dnsProvider: { key, name, dnsConsoleUrl } | null`, and per-record `currentValue` + `status: 'pending' | 'valid' | 'invalid'` taken from `lastDnsSnapshot`. Add `zone` (apex, for "open DNS management for romanskincare.com") and `platformUrl`.
- `getForOrganization(organizationId, id)` for the new detail route.

### 4.3 `lib/railwayDomains.js`

- Return `{ id, cnameTarget, txtHost, txtValue }` from `createCustomDomain`.
- Map `certificateStatus` and `dnsRecords[].status` accepting both spellings (`ISSUED` / `CERTIFICATE_STATUS_TYPE_VALID`, `VALID` / `DNS_RECORD_STATUS_PROPAGATED`) until introspection pins them.
- Ops task: run introspection (`{ __type(name: "CustomDomainStatus") { fields { name } } }` and the two enums) with the production token and delete the wrong spelling.

### 4.4 `lib/dnsProvider.js` (new, ~60 lines)

`resolveNs(apex)` → match NS suffix against a small table: `cloudflare.com` → Cloudflare, `domaincontrol.com` → GoDaddy, `registrar-servers.com` → Namecheap, `worldnic.com` → Network Solutions, `awsdns-*` → Route 53, `dnsimple.com` → DNSimple, `googledomains.com`/`squarespacedns.com` → Squarespace, `hover.com`, `name.com`, `porkbun.com`, `ns*.bluehost.com`, `ionos.com`. Each entry has a display name, a DNS-console URL, and `supportsApexCname: boolean` (used by phase C). Unknown NS → `null`; UI falls back to "your DNS provider".

### 4.5 Routes (`routes/admin.js`)

- `GET /admin/settings/domains/:id` (new).
- Existing routes unchanged; `POST /:id/verify` now benefits from the cooldown.

### 4.6 Tests

- Unit: Railway TXT captured on add; `_jump-verify` fallback; cooldown; snapshot → `dnsRecords[].status` mapping; provider table lookup (NS stubbed).
- Contract: `GET /:id` scoped to org (404 for another org's domain); verify response carries `currentValue`; migration backfill check on a seeded PENDING row.

---

## 5. Frontend changes

| File | Change |
|------|--------|
| `app/admin/settings/domains/page.tsx` | Rewrite: header + `Connect existing` button, `DomainsTable`, `ConnectDomainDialog` state |
| `app/admin/settings/domains/DomainsTable.tsx` | New. Domain / Status table, primary-first ordering, nested platform row, row → link |
| `app/admin/settings/domains/ConnectDomainDialog.tsx` | New. `SettingsDialog` + hostname field + client normalisation + `Next` |
| `app/admin/settings/domains/[id]/page.tsx` | New. Detail page: breadcrumb header, status pill, provider link, `More actions`, `SetupChecklist`, polling |
| `app/admin/settings/domains/SetupChecklist.tsx` | New. Three-step checklist + `DnsRecordTable` (Type / Name / Current value / Update to, Copy) |
| `app/admin/settings/domains/StatusPill.tsx` | New. Shared by list and detail |
| `app/admin/settings/domains/types.ts` | Move the `StorefrontDomain` types out of `page.tsx`; add `certificateStatus`, `dnsProvider`, record `currentValue`/`status` |
| `app/admin/settings/domains/useDomains.ts` | Fetch/mutate hooks wrapping `api.*` with the existing `?organizationId=` handling for SYSTEM_ADMIN |
| `app/admin/settings/SettingsDialog.tsx` | Add optional `submitLabel` (default `Save`) |
| `app/admin/settings/SettingsNav.tsx` | `startsWith` match for nested routes |
| `app/admin/settings/icons.tsx` | `GlobeIcon`, `ExternalLinkIcon`, `CheckCircleIcon`, `TrashIcon` |
| `e2e/admin-domains.spec.ts` | New Playwright spec (API mocked like `admin-settings.spec.ts`): empty state, connect flow → detail page, records render with copy, "I updated DNS records" transitions PENDING → ACTIVE, delete returns to list, axe scan on both pages |
| `docs/wiki/features/custom-domains.md` | Update Key Files + How It Works (Railway TXT unification, detail page) via `/doc-feature` |

Styling follows the General settings page (`cardClass`, indigo buttons, dark-mode tokens); the Shopify green/blue pills map to the existing `STATUS_STYLE` palette.

---

## 6. Phasing and effort

| Phase | Scope | Est. |
|-------|-------|------|
| **A — Backend** | Railway TXT unification + migration, snapshot/currentValue, cooldown, `certificateStatus`, `GET /:id`, provider detection, tests | 1 day |
| **B — Frontend** | List table, Connect dialog, detail page + checklist + polling, nav tweak, Playwright spec, wiki update | 1.5 days |
| **C — Follow-ups** (separate PRs, only on demand) | Apex domains via A/AAAA comparison + provider guidance; optional automatic `www.` companion; replace `window.confirm` with a dialog; provider-specific deep links (Cloudflare `dash.cloudflare.com/?to=/:account/:zone/dns`) | 1 day |
| **D — Ops** (no code) | Set `STOREFRONT_CNAME_TARGET` in prod; run Railway schema introspection and pin enum names; connect one real subdomain end to end and time the certificate; confirm Railway plan domain limit | 0.5 day |

A then B, one PR each, both behind nothing (the existing page is replaced wholesale). C and D are independent.

---

## 7. Risks

| Risk | Mitigation |
|------|------------|
| Railway enum spellings wrong → certificate step never completes | Defensive matching now; introspection in phase D before enabling `RAILWAY_API_TOKEN` in prod |
| Existing PENDING rows lose their TXT after the token-format migration | Backfill prefixes the stored token; `_checkDns` compares the full stored value, so records already published keep verifying |
| Polling every 60 s × open tabs × domains hits DNS resolvers | 15 s server cooldown; poll only while the tab is visible and status is non-terminal |
| Provider detection wrong (e.g. Cloudflare NS but registrar elsewhere) | Detection drives copy and a link only; never gates verification |
| Org adds a domain at a provider without CNAME flattening and expects apex to work | Apex rejected in the dialog with an explanation until phase C |

---

## 8. Decisions (2026-09-13)

1. Nav label stays `Domains`.
2. Apex (root) domains stay in phase C. Railway cannot serve a root domain at providers without CNAME flattening (GoDaddy, Route 53, Squarespace, Azure), and `_checkDns` would need an A/AAAA comparison path; subdomains such as `tickets.<org>.com` cover the ticketing use case.
3. `Buy new domain` ships as a disabled placeholder button.
