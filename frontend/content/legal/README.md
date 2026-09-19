# Legal documents (spec 023)

One Markdown file per public legal page, rendered by `src/app/legal/[slug]/page.tsx`
at `/legal/<slug>` on every host (Jump's own and organizer custom domains).
Nothing here ships until `NEXT_PUBLIC_LEGAL_PAGES_ENABLED=true` is set on the
frontend build; until then every `/legal/*` path is a 404 and the checkout and
apply forms show plain "Terms of Service" / "Privacy Policy" text without links.

Files are attorney-supplied text — never a placeholder that could be mistaken
for terms. Allowed slugs: `terms`, `privacy`, `organizer-terms`, `copyright`,
`accessibility`, `acceptable-use`.

Front matter (all required):

```markdown
---
title: Terms of Service
version: 2026-10-01
effectiveDate: 2026-10-01
audience: buyers
---

# Terms of Service

…
```

`version` must match `LEGAL_VERSIONS` in `backend/src/config/legal.js` for the
documents the backend records acceptances of (`terms`, `privacy`); a stale
version is refused at checkout with `LEGAL_VERSION_STALE`.
