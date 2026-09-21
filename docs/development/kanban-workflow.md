# Jump Kanban → Pull Request Workflow

Hermes Kanban is Jump's operational project-management source of truth. GitHub remains the source of truth for code review, CI, and merge records.

## Lifecycle

```text
triage → todo → ready/running → review → done
                                  ↘ blocked
```

### Triage

Create a card when a feature, bug, decision, or reliability gap first appears. Triage cards are intentionally incomplete and may link to a spec, incident, or user request.

```bash
hermes kanban --board jump create \
  --triage \
  --tenant <area> \
  --idempotency-key jump-<stable-key> \
  "<outcome-focused title>"
```

### Specify or decompose

The planner turns the card into an executable plan. Use `specify` for a bounded change and `decompose` for a feature with independent dependency-linked work.

```bash
hermes kanban --board jump specify <task-id>
# or
hermes kanban --board jump decompose <task-id>
```

A ready implementation card must include the outcome, scope, acceptance criteria, dependencies, affected paths, test commands, non-goals, and the source spec or decision link.

### Implementation handoff

Hermes assigns implementation cards to the Jump Claude Code worker (`coding`) and dispatches them. The worker must use an isolated worktree when code changes are required.

The board is bound to the `jump` Hermes project (`board.json` `project_id`, set 2026-09-20), so every card created without an explicit `--workspace` — including children produced by `decompose` — is materialised as its own worktree at `<repo>/.worktrees/<task-id>` on branch `jump/<task-id>-<slug>`. Pass `--workspace scratch` only for cards that must not touch the repo. A card that has to continue an existing branch takes `--workspace dir:<path of that worktree>`. Never create implementation cards with the default scratch workspace: before the binding, scratch cards ran in the main checkout (`default_workdir`) and several workers wrote into it at once. Cards that must run in sequence are chained with `--parent <prerequisite>` (a parent is a prerequisite, not a container) — sibling children of one decomposition dispatch concurrently.

```bash
hermes kanban --board jump assign <task-id> coding
hermes kanban --board jump dispatch
```

In the worktree the worker first runs `./scripts/bootstrap-worktree.sh` (copies `backend/.env`, `frontend/.env.local`, `packages/db/.env` from the primary checkout, installs, generates the Prisma client); the backend suite then runs against the dev Postgres with the database name swapped to `jump_test`.

The worker must report changed files, tests and results, migrations, risks, commit SHA, branch, and PR URL/number. It must not call a card `done` merely because local edits exist — on 2026-09-21 a card was closed with its work only staged in the worktree and no PR, and the operator had to commit and publish it (PR #126).

### Completion contracts

Cards created with a PR contract (`--completion-contract <pr-url>` or the repo `jjchambers80/jump`) only close when the PR's **required** GitHub checks are green. `.github/workflows/ci.yml` (`backend tests`, `frontend typecheck + unit`) is required on `main` for exactly this reason — before 2026-09-21 the repository had no required checks, so every PR contract failed with `PR acceptance missing` and the cards cycled through Blocked (t_dfd5e571, t_c2dc0a85). Review cards for already-merged PRs, decisions and docs-only work take `--completion-contract local-only`.

### Review

When implementation and verification are complete, the worker or orchestrator moves the card to review and records the PR URL and evidence:

```bash
hermes kanban --board jump request-review <task-id> \
  --summary "PR #<number>: <what changed>; tests: <commands/results>; migrations: <none or names>"
```

The PR is reviewed in GitHub. Product acceptance and project status remain on the Kanban card.

### Completion

Only mark the card done after the PR is merged and the shipped behavior is verified. Record the PR number, merge commit, verification, and documentation updates:

```bash
hermes kanban --board jump complete <task-id> \
  --result "PR #<number> merged as <sha>; verification: <commands/results>; docs: <paths>"
```

If review finds issues, return the card to implementation rather than creating a duplicate card. If a product decision or external dependency prevents progress, use `blocked` and record the exact unblock condition and owner.

## Source-of-truth contract

- **Kanban:** active work, priority, dependencies, assignment, blockers, review readiness, and completion.
- **Specs/plans:** requirements, decisions, acceptance criteria, and technical approach.
- **GitHub PRs:** implementation diff, branch, CI, review comments, approval, and merge record.
- **Wiki/product docs:** behavior that has shipped.

Historical merged PRs do not need one Kanban card each. Active PRs do. Existing open PRs should be represented by a review card with the exact PR URL and an explicit completion contract.

## Definition of Done

A Jump card is done when:

1. Relevant tests and manual checks pass.
2. The PR is reviewed and merged into `main`.
3. Required migrations and deployment checks are complete.
4. Shipped-behavior documentation is updated where needed.
5. The Kanban card records the PR, merge commit, and verification evidence.
