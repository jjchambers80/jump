Document a feature for the Jump wiki knowledge base and update agent instructions if needed.

## Instructions

You are documenting a feature of the Jump ticketing platform for the wiki at `docs/wiki/features/`.

### Step 1: Identify the feature
Ask the user which feature was just completed or changed. If they've already specified it, proceed.

### Step 2: Research the implementation
Read the relevant source files to understand:
- What the feature does (user-facing behavior)
- Key files involved (routes, services, components, middleware)
- Configuration required (env vars, Stripe setup, etc.)
- Database models/migrations involved
- API endpoints (method, path, auth requirements)
- How it integrates with other features

### Step 3: Generate the wiki page
Create or update a markdown file at `docs/wiki/features/<feature-name>.md` using this template:

```markdown
# Feature Name

**Status**: Implemented | In Progress | Planned
**Last Updated**: YYYY-MM-DD

## Overview
1-3 sentence description of what this feature does from a user perspective.

## Key Files
| File | Purpose |
|------|---------|
| `path/to/file` | What it does |

## Configuration
Environment variables, Stripe settings, or other config needed.

| Variable | Required | Description |
|----------|----------|-------------|
| `VAR_NAME` | Yes/No | What it controls |

## How It Works
Step-by-step explanation of the feature's flow. Include code snippets only when the logic is non-obvious.

## API Endpoints
(if applicable)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /path | None/Auth/Admin | What it does |

## Database
Models and key fields involved. Link to `docs/wiki/features/database-architecture.md` for full schema.

## Gotchas
Things that are easy to get wrong, non-obvious behaviors, or important constraints.

## Related Features
Links to other wiki pages this feature connects to.
```

### Step 4: Update the wiki index
Add or update the entry in `docs/wiki/README.md` if the feature is new.

### Step 5: Check if AGENTS.md files need updates

Review the feature's impact and determine if any agent instruction files need updating. Check each file against the feature changes:

**Root `AGENTS.md`** — Update if the feature:
- Introduces a new architectural pattern or model relationship
- Adds a new gotcha other agents should know about
- Changes the tech stack (new dependency, new service)
- Alters commit conventions or common task workflows

**Root `CLAUDE.md`** — Update if the feature:
- Adds new npm scripts or commands
- Introduces new required environment variables
- Changes deployment configuration

**`backend/AGENTS.md`** — Update if the feature:
- Adds or changes an auth flow, middleware chain, or role
- Modifies payment/webhook processing
- Changes fee calculation or capacity enforcement logic
- Adds new directories or restructures file layout

**`frontend/AGENTS.md`** — Update if the feature:
- Adds new top-level route groups under `app/`
- Changes auth patterns or data fetching conventions
- Introduces new key files that agents should know about

**`packages/db/AGENTS.md`** — Update if the feature:
- Adds new models or enums to the schema
- Changes the model count or relationship chain
- Alters the migration or generation workflow

For each file that needs updating, make minimal targeted edits — don't rewrite entire sections. If no updates are needed, skip this step.

### Step 6: Confirm
Show the user:
- Wiki page file path and brief summary
- Which AGENTS.md/CLAUDE.md files were updated (if any) and what changed
- If no agent files needed updates, state that explicitly
