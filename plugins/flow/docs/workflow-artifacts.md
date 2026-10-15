# Workflow artifacts

The flow workflow skills hand work to one another through local Markdown artifacts. Conversation context may supplement these files, but it is not their source of truth.

## Location

Use one feature directory under the project root (`.scratch/` unless `.flow/config.json` sets `artifactsDir`):

```text
.scratch/<feature-slug>/
├── decisions.md
├── spec.md
├── architecture/
│   └── candidate-01.md
├── issues/
│   ├── index.md
│   └── 01-<ticket-slug>.md
├── plan.src.html        ← html-plan source, edited by agents
├── plan.html            ← packed view the developer opens, not an artifact
└── worklog.md
```

Use an English kebab-case feature slug. Keep artifacts local; agents do not publish them to an issue tracker. `plan.src.html` and `plan.html` are `to-spec`'s read-only review page of the spec for the developer; they carry no frontmatter, `artifact check` ignores them, and a conflict with the Markdown is resolved in favour of the Markdown.

## Required metadata

Every workflow artifact begins with this YAML frontmatter:

```yaml
---
artifact: decisions | spec | architecture-candidate | ticket-index | ticket | worklog
status: draft | validated | ready | blocked | done
workspace: <workspace name>
project: <project or module name>
source: <relative artifact path, issue reference, or conversation>
source_revision: <source artifact revision; required for a local artifact source>
revision: <positive integer>
```

Use `workspace: cross-workspace` or `project: multiple` only when the artifact genuinely spans more than one owner. Increment `revision` whenever a decision, contract, acceptance criterion, dependency edge, or readiness state changes.

## Artifact contracts

### `decisions.md`

Record only choices that can change implementation. Each decision has a stable ID (`DEC-001`), the selected option, the reason, and any consequence for scope, contracts, or verification. Persist exactly one `handoff` value: `ready-for-spec`, `ready-for-implementation`, or `blocked-by-decision`. The first two require `status: validated`; `blocked-by-decision` requires `status: blocked`. Domain terminology belongs in the owning `CONTEXT.md`; implementation choices stay here or in an ADR when they are durable and hard to reverse.

### `spec.md`

Give every observable acceptance criterion a stable ID (`AC-001`). `artifact check` requires these exact headings, each non-empty, before a spec can be `ready`; `User stories` and `Decisions` are optional:

```markdown
# <Feature title>

## Problem

## Desired behaviour

## User stories

## Decisions

<!-- Reference DEC IDs and architecture candidates rather than restating their rationale. -->

## Observable acceptance criteria

- **AC-001:** <observable outcome>

## Contracts and state transitions

## Verification seams

<!-- The test seams to-spec chose: existing seams first, as few and as high as possible; which modules are tested and the prior-art tests to follow. -->

## Constraints

## Out of scope

## Open decisions

None
```

A spec is `ready` only when `Open decisions` reads `None`, each acceptance criterion has a feasible verification seam, and a local decisions/candidate source has handoff `ready-for-spec`. An open decision that can change behaviour, scope, a contract, a state transition, or verification makes the spec `blocked`; a non-blocking gap is stated as an assumption.

### Architecture candidate

Add this field to the common metadata:

```yaml
readiness: observed | validated | investigation-only | ready-for-spec | ready-for-implementation | rejected
```

The body contains evidence from current code, observed maintenance pressure, the shallow interface, proposed seam, counter-evidence, feasibility, migration shape, verification seam, confidence, and the readiness rationale.

`investigation-only` candidates can produce investigation tickets only. `ready-for-implementation` requires evidence, a feasible migration, an observable verification seam, and a small contract-clear change; larger candidates proceed through a ready spec and tickets.

Use `status: draft` for `observed` and `investigation-only`; use `status: validated` for `validated`, `ready-for-spec`, and `ready-for-implementation`; and use `status: done` for `rejected`.

### Ticket

A ticket delivers one coherent tracer-bullet slice, one file per ticket at `issues/<NN>-<slug>.md`, numbered in dependency order. `artifact check` requires these exact headings, each non-empty:

```markdown
# <NN>: <Ticket title>

## What to build

## Source acceptance criteria

- AC-001

## Contract affected

## Risk

## Suggested verification

## Blocked by

None

## Acceptance criteria

- [ ] <observable criterion>
```

`Blocked by` lists ticket numbers. Use `ready` only when every blocker is `done`, the source spec is `ready`, and every source acceptance-criterion ID exists in that spec. Use `blocked` while any blocker or external decision remains. Use `done` only after implementation and applicable verification pass. Ticket blocker graphs must be acyclic.

### `issues/index.md`

Use `artifact: ticket-index`. Keep the source spec path and revision, one dependency graph, a one-line index of the tickets, and the current frontier: every `ready` ticket whose blockers are done. Reference ticket files; do not duplicate their acceptance criteria.

### `task.json`

The harness owns `.scratch/<feature>/task.json`. It is the resumable implementation identity and contains the versioned source, registered targets, workspace HEAD values, immutable dirty-file baseline, config fingerprint, verification plan, evidence ledger, phase, state, and task handoff.

Use `task start` exactly once for an active feature. Subsequent inspection and verification use `--task <feature>`. A second active task for the same feature is rejected. `modifiedFiles` is derived from Git plus the baseline; agents do not maintain it manually.

Task handoff values are separate from artifact handoffs: `not-ready`, `ready-for-verification`, `blocked`, and `completed`.

### `worklog.md`

A compact recovery record with two owners.

`flow verify --task <feature-slug>` creates the worklog and refreshes its automatic block from the task manifest. That block owns only changed-file, verification, review-threshold, review-gate, and review-evidence data, costs the agent nothing, and is the review scope for `flow:code-reviewer` and `flow:code-simplifier`; authored sections are preserved.

The authored sections (goal, active ticket or slice, contracts and invariants, decisions, open issues) exist for recovery after compaction or in a new session, so write them only when that recovery is likely:

- the task belongs to a multi-ticket run (`--full`) or will span more than one session;
- a decision has no `decisions.md` to land in;
- an issue stays open when the session ends.

Otherwise leave the scaffold the harness writes. Point to the source artifact instead of copying its goal or contracts. When you write them, update at phase boundaries and before compaction, not after every tool call.

## Handoff rules

- `grill-with-docs` writes or updates `decisions.md` and stops at `ready-for-spec`, `ready-for-implementation`, or `blocked-by-decision`.
- `to-spec` consumes eligible decisions, architecture candidates, or settled conversation context and writes `spec.md`.
- `to-tickets` (also selected by “to-ticket”) consumes a ready or draft spec and writes `issues/`; only a ready spec can produce ready tickets.
- `implement` consumes one ready ticket, a ready spec for a small feature, validated decisions with `ready-for-implementation`, an architecture candidate with `ready-for-implementation`, or a contract-clear direct request.
- `improve-codebase-architecture` writes candidates; it does not edit production code.
- `implement` follows source acceptance criteria and may use specialist skills without changing their scope.

Run `flow artifact check .scratch/<feature-slug>` before handing an artifact to the next stage. `artifact frontier` validates the entire feature first and returns no frontier when any validation error exists.