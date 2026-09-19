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

```bash
hermes kanban --board jump assign <task-id> coding
hermes kanban --board jump dispatch
```

The worker must report changed files, tests and results, migrations, risks, commit SHA, branch, and PR URL/number. It must not call a card `done` merely because local edits exist.

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
