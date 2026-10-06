# Spec 045: Agent access (connect ChatGPT, Claude and coding agents to a store)

**Status**: Plan, 2026-10-05. Nothing built. Prerequisite PR #303 (cross-tenant route fix) merged and verified in prod 2026-10-05.
**Ask**: an organizer connects their own LLM to their store and manages it by chatting: events, venues, price tiers, pages, blog, menus, redirects, files, theme and store settings. There is no codebase access. It must work for developers (Claude Code, Codex, Cursor, Agent SDK scripts) and for non-developers (ChatGPT, claude.ai on web, desktop and mobile). It must be the most secure design available.
**Research**: `docs/research/2026-10-05-agent-store-access.md` holds the rationale, citations and threat model. This plan records the decisions and the build.
**Supersedes**: the parked spec 016 (API tokens + OpenAPI + CLI) and spec 017 (MCP server) ideas. Neither was ever written.

## 1. Decisions (owner, 2026-10-05)

| # | Decision |
|---|---|
| D1 | **One remote MCP server** at `https://mcp.eventimus.net/mcp` (Streamable HTTP). That URL is the OAuth `resource` and the token `aud` permanently. |
| D2 | **Jump is the OAuth 2.1 authorization server, built in-house** on spec 043's `DeveloperToken` / `DeveloperAuthCode` code (PKCE S256, single-use codes, hashed opaque tokens). No hosted identity provider: Jump already owns staff login, two-step, step-up and session revocation, and a hosted provider would add a second identity system plus another processor of staff personal data. Use the official MCP TypeScript SDK for the server and transport, and for its Express auth helpers if they fit (§8 Q1). |
| D3 | **Only org ADMIN members can connect an agent.** Each grant is one user + one organization + one client. ORGANIZER members cannot create grants. |
| D4 | **Three switches**: (a) env `AGENT_ACCESS_ENABLED`, so the code deploys dark; (b) SYSTEM_ADMIN **global kill switch** on a new Settings › Platform page; (c) org ADMIN **store switch** on Settings › Agent access. All three are checked on **every** token, consent and tool call. Switching one off blocks the next call without deleting grants. "Revoke all" is a separate, explicit action at both levels. |
| D5 | **No personal data reaches an agent.** Customers, orders, applications and standing-form submissions, RSVPs, ticket holders, contact-form messages and staff lists are excluded. Card data never comes into it (it stays in Stripe). GDPR does: sending personal data to an LLM vendor makes that vendor a processor (DPA plus privacy-policy disclosure). The owner rule is "if it isn't compliant, absolutely not." Aggregates with no personal data (ticket counts, revenue per event) are allowed. Revisit only after counsel signs off, which is spec 023's gate. |
| D6 | **Human-only (never an agent tool)**: refunds of any kind, payment settings, Stripe Connect and payouts, billing and plan, custom domains, users / roles / membership, account security, customer export / erasure / anonymize, legal text, tax-provider configuration. **Approved by the owner 2026-10-05.** |
| D7 | **Writes land as drafts.** Publish, cancel, delete and live-page edits go through a server-side **preview → apply** step. Client confirmation prompts (`destructiveHint`) and elicitation are extra layers, never the only gate. |
| D8 | **Distribution**: a pasted custom-connector URL at launch. Submit to the Claude and ChatGPT directories after phase 3 (stable writes, public docs, a review test account). |

## 2. What exists today (origin/main a3c5042)

| Piece | Where | Reuse |
|---|---|---|
| Loopback + PKCE S256 code flow, 5-minute single-use codes, timing-safe compare | `backend/src/services/DeveloperTokenService.js:16-113` | Core of `/oauth/authorize` and `/oauth/token` |
| Opaque `jmp_` tokens, hash-only storage, per-request expiry / scope / membership check | `DeveloperTokenService.js:103-161`; `schema.prisma` `DeveloperToken`, `DeveloperAuthCode` | Generalise into the OAuth tables |
| Deny-by-default token acceptance per router | `backend/src/middleware/developerToken.js` (themes, storeFiles) | Same opt-in for agent scopes |
| Step-up proof (`requireRecentAuth`, 10 min) | `backend/src/middleware/recentAuth.js` | Required on consent |
| Org membership check | `requireOrgMembership` in `backend/src/middleware/orgScope.js` | Tools run with the grant's org only |
| Drafts | `Event.status DRAFT`, `BlogPost.isVisible`, UNPUBLISHED themes + `ThemePreviewService` | Draft-first writes |
| HTML sanitise on write | `backend/src/utils/sanitizeHtml.js` (gotcha 20) | Every agent content write |
| Redis via `utils/cache.js`, `makeLimiter` | spec 020 | Shared store for per-grant limits |

**Gaps**:
- PR #303 fixes the cross-tenant routes.
- `requireRole` checks the account-wide `User.role`, not `OrganizationMember.role`. Spec 043 tokens accept any membership row.
- No audit table.
- Limiters are keyed by IP, keep counts in memory, and do nothing under test.
- Pages have no draft model (`isVisible` defaults to true).
- No platform-settings storage.

## 3. Data model

```prisma
model OAuthClient {
  id                String   @id @default(cuid())
  clientId          String   @unique        // CIMD URL, DCR id, or "jump-cli"
  kind              OAuthClientKind         // CIMD | DCR | FIRST_PARTY
  name              String
  redirectUris      String[]
  metadataFetchedAt DateTime?
  createdAt         DateTime @default(now())
  grants            OAuthGrant[]
}

model OAuthGrant {                          // one user + one org + one client
  id             String   @id @default(cuid())
  userId         String
  organizationId String
  clientId       String
  scopes         String[]
  createdAt      DateTime @default(now())
  lastUsedAt     DateTime?
  revokedAt      DateTime?
  revokedReason  String?                    // user | org_admin | system_admin | refresh_reuse | member_removed
  @@index([organizationId, revokedAt])
  @@index([userId, revokedAt])
}

model OAuthToken {                          // access + refresh in one table
  id        String   @id @default(cuid())
  grantId   String
  kind      OAuthTokenKind                  // ACCESS | REFRESH
  tokenHash String   @unique                // HMAC-SHA256(token, OAUTH_TOKEN_PEPPER)
  audience  String                          // canonical MCP URL (later also the REST URL)
  familyId  String                          // refresh rotation family
  expiresAt DateTime
  usedAt    DateTime?                       // refresh: set on rotation; a second use revokes the grant
  createdAt DateTime @default(now())
  @@index([grantId])
}

model OAuthAuthCode { /* generalises DeveloperAuthCode: + clientId, organizationId, scopes, resource, redirectUri */ }

model AgentAuditLog {
  id             String   @id @default(cuid())
  organizationId String
  userId         String
  grantId        String
  clientName     String
  tool           String
  argsDigest     String                     // sha256 of canonical args
  summary        String                     // redacted, human-readable
  outcome        String                     // ok | denied | error | preview | applied
  targetType     String?
  targetId       String?
  createdAt      DateTime @default(now())
  @@index([organizationId, createdAt])
  @@index([grantId, createdAt])
}

model PlatformSetting {                     // first row: agentAccessEnabled
  key       String   @id
  value     Json
  updatedBy String?
  updatedAt DateTime @updatedAt
}
```

`Organization.agentAccessEnabled Boolean @default(false)`. A store is off until its ADMIN switches it on.

Token lifetimes: access **15 min**; refresh **30 days idle / 90 days absolute** (matches spec 043's 90 days); auth code 5 min. Opaque tokens with a DB lookup give instant revocation. No JWTs, so no signing keys to manage.

## 4. Authorization server

Routes live in the backend under `/oauth/*` and `/.well-known/*`. The MCP host proxies to them (§8 Q2).

- **Discovery**:
  - RFC 9728 protected-resource metadata at `mcp.eventimus.net/.well-known/oauth-protected-resource`. Its first `authorization_servers` entry is Jump.
  - RFC 8414 metadata with `code_challenge_methods_supported: ["S256"]`, `client_id_metadata_document_supported: true` and `token_endpoint_auth_methods_supported: ["none"]`.
  - An unauthenticated MCP call returns **401** with `WWW-Authenticate: Bearer resource_metadata=…`.
- **Client registration**:
  - CIMD is preferred. The fetcher is HTTPS only, blocks private and link-local ranges, has a size and time cap, and caches results.
  - DCR (`/oauth/register`) is the fallback, rate-limited.
  - `jump-cli` is a pre-registered first-party client.
- **Redirect URIs**: exact match. The allowlist covers the client's registered URIs, `https://claude.ai/api/mcp/auth_callback`, the ChatGPT connector callback, and loopback on any port. Return `iss` in the authorization response (RFC 9207).
- **`/oauth/authorize`**: renders the consent page `frontend/src/app/oauth/consent/page.tsx` behind a normal staff session, two-step included. The page:
  - Requires `requireRecentAuth` before it grants anything.
  - Names the client and shows its redirect host, with an extra warning for loopback-only clients.
  - Lists the scopes in plain language.
  - Lets the user **pick exactly one organization**, limited to orgs where they are an ADMIN member with agent access switched on.
  - Sets `frame-ancestors 'none'`, carries a CSRF token, and requires `resource` (RFC 8707).
- **`/oauth/token`**:
  - `authorization_code` with a PKCE check.
  - `refresh_token` rotation. A reused refresh token revokes the grant and returns `invalid_grant`.
  - Every token is bound to `aud` = the requested resource.
- **`/oauth/revoke`** (RFC 7009).

## 5. Scopes and the authorization choke point

| Scope | Covers | Notes |
|---|---|---|
| `store:read` | Events, venues, tiers, add-ons, pages, blog, menus, redirects, files, theme metadata, non-secret settings, aggregate sales counts | Default |
| `content:write` | Pages, blog posts, menus, redirects, file upload | Drafts / hidden; live-page edits via preview → apply |
| `events:write` | Events, venues, price tiers, add-ons, tier presets | Create + edit; new events are DRAFT |
| `events:publish` | Publish, cancel | Always preview → apply |
| `themes` | Spec 043 scope | Never changes rollout (as today) |
| `settings:write` | Business details, store preferences, customer-account settings | Excludes D6 |

D5 and D6 resources have **no scope at all**. Nothing in the catalog can reach them.

**`agentAuthorize(token, tool)`** is one function, used by every MCP tool and later by REST. It checks, in order:
1. The global switch and the org switch (D4).
2. Token hash found, not expired, `aud` matches, grant not revoked.
3. The user is still active and still an **ADMIN member** of the grant's org. If not, revoke the grant (`member_removed`).
4. Required scope ⊆ grant scopes.
5. Per-grant and per-org rate limits.

It returns `{ userId, organizationId, grantId, clientName }`. Tool handlers take the org **only** from this result. Org ids in arguments are rejected unless they match. Handlers call the same service methods the admin routes call, with the same validators (partial-PATCH whitelist pattern).

## 6. MCP server

New workspace `mcp/`: an Express app on its own Railway service at `mcp.eventimus.net`. It imports `@jump/db` and the backend services in-process. It never forwards a client token anywhere.

- Target the 2025-11-25 protocol behaviour and stay compatible with 2026-07-28: no reliance on `Mcp-Session-Id`, every request authenticated on its own. Validate `Origin`.
- **Tools** are granular, one per action. A grant's tool list hides tools its scopes don't cover. Each tool has a `title`, `readOnlyHint` or `destructiveHint`, `openWorldHint: false`, and an `outputSchema`. No catch-all `api_request`. Tool descriptions describe the tool and never instruct the model.
  - Read: `get_store`, `list_events`, `get_event`, `list_venues`, `get_venue`, `list_price_tiers`, `list_pages`, `get_page`, `list_blog_posts`, `get_blog_post`, `list_menus`, `get_menu`, `list_redirects`, `list_files`, `get_theme`, `get_sales_summary` (aggregates only).
  - Write: `create_event_draft`, `update_event`, `create_venue`, `update_venue`, `create_price_tier`, `update_price_tier`, `reorder_price_tiers`, `create_page_draft`, `update_page`, `create_blog_post_draft`, `update_blog_post`, `update_menu`, `create_redirect`, `delete_redirect`, `upload_file`, `update_store_settings`.
  - Two-phase: `publish_event`, `cancel_event`, `publish_page`, `publish_blog_post`, plus every delete and every edit to a live page. These return `{ preview, confirmation_id }`, and `apply_change(confirmation_id)` executes. The id expires in 10 minutes and is bound to user, grant, tool, an argument hash and the record version (a changed record means the preview is stale). It is re-authorised on apply.
- **Results**: small structured content. Organizer or outsider text is wrapped as `{ "untrusted_text": … }`. No secrets, Stripe ids, tokens or personal data. Responses are capped well under Claude's ~150k characters.
- **Excluded in v1**: any outbound-capable tool (fetch URL, send email, webhooks). Those are exfiltration channels.
- **Pages draft gap**: agent-created pages are forced `isVisible: false`, and edits to a visible page go through preview → apply. A real page draft model is a follow-up.

## 7. UI

- **Settings › Agent access** (`/admin/settings/agent-access`, ADMIN; nav entry `roles: ['ADMIN','SYSTEM_ADMIN']`):
  - Store switch.
  - Grants list: member, client, scopes, created, last used, and **Revoke**.
  - **Revoke all**.
  - The audit log for the store: filter by grant or tool; rows link to the target record.
- **Account › Connected apps** (`/admin/account/connected-apps`): the signed-in user's own grants across orgs, with revoke (gotcha 24 placement).
- **Settings › Platform** (`/admin/settings/platform`, SYSTEM_ADMIN only): the global agent kill switch, platform-wide grant and call counts, and **Revoke every grant**. Every change writes an audit row and a `logger.warn`. This is the one platform-wide settings page. It still renders inside the admin shell and does not change the one-org-at-a-time nav rule for the other pages.
- **Consent page** (`/oauth/consent`), described in §4. Mobile first, WCAG 2.2 AA.
- Docs page (public): how to connect from Claude, ChatGPT, Claude Code, Codex and Cursor. Required later for directory review.

## 8. Open questions

1. Does the current `@modelcontextprotocol/sdk` auth router support CIMD and an opaque-token provider backed by Prisma? If not, write the endpoints ourselves (they are small) and use the SDK only for the MCP server.
2. MCP host: a separate Railway service, or a path on the backend (`api…/mcp`)? A separate host is recommended (cookie and CSP isolation, independent limits). The OAuth endpoints can stay on the backend.
3. Is agent access a paid-plan feature (spec 022 billing)? Owner 2026-10-05: **possibly; decide later**. Build the switches so a plan check can slot into `agentAuthorize()` step 1.
4. **Approved 2026-10-05:** the owner signed off on the human-only list (D6), plus the additions from D5.
5. Should a store's own ORGANIZER members ever get read-only grants (`store:read` only)? D3 says no for now.

## 9. Phases and Kanban cards

Phase 0 is done when PR #303 merges. Each later card is one PR with its own contract tests. Keep the CI suite deterministic: no network, and the CIMD fetcher is mocked.

| Card | Scope | Exit criteria |
|---|---|---|
| **045A Foundations** | Prisma models (§3), `PlatformSetting`, `Organization.agentAccessEnabled`, `AgentAuditLog` writer, `agentAuthorize()` with member-role check, grant-keyed Redis limiter, env flag | Unit tests for every `agentAuthorize` branch, including switch off → denied at once, member removed → grant revoked |
| **045B Authorization server** | Discovery, CIMD fetcher + SSRF guards, DCR, `/oauth/authorize` + consent page, `/oauth/token` with rotation and reuse revoke, `/oauth/revoke` | Contract tests: PKCE, exact redirect, `aud`, reuse → grant revoked, switches block consent and token |
| **045C Switches + grant UI** | Settings › Agent access, Account › Connected apps, Settings › Platform | Playwright with mocked API; SYSTEM_ADMIN-only page refused for ADMIN; revoke takes effect on the next call |
| **045D MCP read-only** | `mcp/` service, Streamable HTTP, 401 + resource metadata, the `store:read` tools | Connects from MCP Inspector, Claude Code, claude.ai and ChatGPT (manual check); cross-org arguments refused; no personal-data fields in any result (schema test) |
| **045E Draft writes** | `content:write`, `events:write`, `themes` tools, sanitise on write, pages forced hidden | No agent write is publicly visible without a human publish; audit row for every call |
| **045F Publish + settings** | `events:publish`, `settings:write`, the two-phase `apply_change`, CLI moves to OAuth tokens (spec 043 tokens keep working until expiry) | Stale preview refused; destructive tools prompt in Claude and ChatGPT |
| **045G Docs + directories** | Public connect docs, review test account, Claude and ChatGPT directory submissions | Listing approved |

## 10. Threat model (summary; full table in the research note)

| Threat | Main control |
|---|---|
| Indirect prompt injection from store content | Draft-first, preview → apply, no outbound tools, untrusted-text labelling, scope ∩ role |
| Cross-tenant access | Org only from the grant; PR #303; services filter by org |
| Token theft | 15-min opaque access tokens, rotating refresh with reuse revoke, peppered hashes, instant revoke |
| Token replay at the wrong service | `aud` check per resource; no passthrough |
| Consent phishing / malicious client | Client domain and redirect host shown, loopback warning, exact redirect match, `iss`, step-up |
| SSRF via CIMD fetch | HTTPS only, private-range block, caps |
| Excessive agency | D5 / D6 have no scopes; ADMIN-only grants |
| Runaway agent | Per-grant and per-org limits; tighter write buckets |
| Repudiation | `AgentAuditLog` row per call with user + client + grant |
| Platform-wide incident | Global kill switch blocks every call at once |
