---
name: to-tickets
description: Break a spec into tracer-bullet tickets with blocking edges, written directly as .scratch/<feature>/issues/<NN>-<slug>.md plus an index with the current frontier. Also handles "to-ticket".
disable-model-invocation: true
argument-hint: "[.scratch/<feature>/spec.md]"
---

# To Tickets

Source: $ARGUMENTS (when empty, the feature's `spec.md` from this conversation)

`${CLAUDE_PLUGIN_ROOT}/docs/workflow-profile.md` and `${CLAUDE_PLUGIN_ROOT}/docs/workflow-artifacts.md` (the ticket and `issues/index.md` contracts and their exact headings) are the authority; read both first.

Write the tickets directly, without presenting the breakdown for approval. Show the breakdown first only when the user's prompt asks to review it before the files are written. The user reviews the written tickets; when they ask for a merge or split, revise the files and their revisions.

## Process

### 1. Read the source

Read the whole spec and record its path and revision. A `ready` spec produces `ready` and `blocked` tickets, a `draft` spec produces only `draft` tickets, and a `blocked` spec is not ticketable: stop and say so.

### 2. Explore the codebase

Read the code the spec touches, using the vocabulary of the domain docs `flow explain <path>` lists and respecting ADRs in the area. Look for prefactoring that makes the implementation easier: "make the change easy, then make the easy change."

### 3. Draft vertical slices

<vertical-slice-rules>

- Each slice cuts a narrow but complete path through every layer it needs (API contract, state, UI, tests): vertical, never a "UI ticket" or "service ticket".
- A completed slice is demoable or verifiable on its own.
- Each slice fits in a single fresh context window.
- Prefactoring comes first.
- Every spec `AC-###` is covered by at least one ticket.

</vertical-slice-rules>

Give each ticket its **blocking edges**: the tickets that must be `done` before it can start. The graph must be acyclic.

**Wide refactors are the exception to vertical slicing.** A wide refactor is one mechanical change (rename a field, retype a shared symbol) whose blast radius fans across the codebase, so no vertical slice can land green. Sequence it as expand–contract: first expand (add the new form beside the old); then migrate call sites in batches sized by blast radius (per unit, per directory), each its own ticket blocked by the expand; finally contract (delete the old form) in a ticket blocked by every batch.

### 4. Write the tickets

- One file per ticket at `.scratch/<feature>/issues/<NN>-<slug>.md`, numbered from `01` in dependency order, with the contract's frontmatter and headings. `Source acceptance criteria` lists AC IDs that exist in the spec; `Blocked by` lists ticket numbers.
- `.scratch/<feature>/issues/index.md` holds the source spec path and revision, one dependency graph, a one-line index, and the frontier. Reference ticket files; do not duplicate their criteria.
- Describe behaviour, not file paths or code; the prototype-snippet exception from `to-spec` applies.
- Emit the `artifact.transitioned` event, then run `artifact check` and `artifact frontier` as the workflow profile describes.

### 5. Finish

List the tickets one per line with their blockers, show the frontier, and name the next command: `/flow:implement .scratch/<feature>/issues/01-<slug>.md`. This stage implements nothing and writes nothing to the issue tracker.
