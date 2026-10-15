# flow workflow profile

The canonical workflow policy for projects that use the `flow` plugin. The workflow skills (`grill-with-docs`, `to-spec`, `to-tickets`, `implement`, `improve-codebase-architecture`) read it before they start. A project overlay (its `AGENTS.md`, `.flow/config.json`, and project skills) adds facts; it does not override the gates below.

## Project root and units

- The project root is the nearest ancestor holding `.flow/config.json` (from `CLAUDE_PROJECT_DIR`, then the working directory). Run every `flow` command from it. Without that file the harness commands report "not initialised" and the hooks stay silent; `flow init` creates it.
- `layout: single` treats the root as one unit. `layout: umbrella` treats each direct child the unit adapters recognise as its own unit (workspace), each its own git repository.
- `flow explain <path> [--task <feature>]` names the owning unit, the domain docs (`context.docs`), and the conventions (`context.conventions`) that apply to a path. Read what it lists before changing that path.
- `.flow/config.json` `policy` can require that some executables run only from a unit root (`unitRootOnly`) and that some CLIs stay read-only (`readOnlyCli`); the policy hook enforces both.

## Harness execution

- Start an artifact-backed or direct task with `flow task start <feature> --target <path-or-project> --source <artifact-or-conversation>`. Repeat `--target` for a cross-unit task. The command persists `<artifacts>/<feature>/task.json` with source revision, target ownership, unit HEAD values, the dirty-worktree baseline, config fingerprint, and verification plan.
- Isolation is opt-in. Pass `--isolate` only when the user's prompt contains `--isolate` or asks for a separate branch or worktree; otherwise the task edits the user's checkout. With `--isolate`, `task start` creates a git worktree at `.worktrees/<feature>/<unit>` on branch `agent/<feature>` from the user's current HEAD for every target unit, and links the unit's `node_modules` into it when there is one. After start, edit only files under the printed `WORKTREE` paths and run unit commands from the worktree unit root; the policy hook blocks edits to the matching paths in the user checkout and dependency installs through the shared link. The user's uncommitted changes are not carried into the worktree; `task start` warns when they exist. Once a feature has a live worktree, later `task start` calls for that feature reuse it; pass `--no-isolate` only when the user explicitly asks to edit their checkout instead.
- Tickets share their feature's worktree. When `--source` lies under `<artifacts>/<feature>/`, the task uses `.worktrees/<feature>` on `agent/<feature>` regardless of the task's own name, so each ticket builds on the previous one. Only one unfinished task may hold a shared worktree. Never copy files between worktrees.
- The user reviews and commits on `agent/<feature>`, then merges it. `flow task cleanup <feature>` removes the worktrees, refuses when uncommitted changes remain, and deletes the branch only when it is merged; `--force` discards both. `flow clean --all` sweeps every worktree not held by an unfinished task. Run cleanup only when the user asks.
- Resume with `flow inspect --task <feature>`. Ad-hoc `flow inspect <path-or-project>` is read-only.
- Verify with `flow verify --task <feature> [--plan] [--force]`. Verification derives changes from the persisted baseline, excludes unchanged pre-existing dirty files, scopes the unit adapter's targets to registered owners, and rejects evidence when the manifest revision or the scoped change fingerprint drifts during the run.
- `flow task status` shows lifecycle state; `flow task handoff --to ready-for-verification` and `flow task block` make explicit transitions. Completion requires evidence for the whole persisted plan, or the `task-scope:no-applicable-steps` proof when the task owns no changed file. `flow task complete` only confirms that terminal state.
- `flow doctor` diagnoses root discovery, config, units, and hooks. Machine consumers use `--json`.

## Artifacts

- Root: `<artifacts>/<feature-slug>/`, where `<artifacts>` is `.scratch/` unless `.flow/config.json` sets `artifactsDir`.
- Contract: `workflow-artifacts.md`, in the same directory as this profile.
- Persist decisions, specs, architecture candidates, tickets, task manifests, and worklogs through that contract. Conversation context is working memory, never the only handoff.
- After writing or changing a workflow artifact, emit `flow event artifact.transitioned --feature <feature-slug> --status <status> --artifact-revision <revision> --to <status>`. Telemetry holds identifiers and counts, never prompts or artifact bodies.
- When `grill-with-docs`, `to-spec`, or `to-tickets` writes its handoff, or a ticket's task completes, end the stage by naming the next command (for example `/flow:implement <artifacts>/<feature>/issues/02-<slug>.md`). The artifacts and `inspect --task` carry the state between stages. `/flow:implement --full` runs every ticket of the feature, one task per ticket.
- Validate a handoff with `flow artifact check <artifacts>/<feature-slug>`. Resolve ready tickets with `flow artifact frontier <artifacts>/<feature-slug>`; it fails closed.
- `to-spec` keeps `plan.src.html` (packed to `plan.html`) as the page the developer reviews the spec on, built with the `html-plan` skill. The Markdown stays the source of truth; `artifact check` ignores the page.

## Workflow routing

- Workflow skills are user-invoked stages. An explicit end-to-end prompt may authorise the whole chain; every readiness and validation gate still applies.
- `grill-with-docs` resolves implementation-changing owner decisions, records `decisions.md`, and stops at `ready-for-spec`, `ready-for-implementation`, or `blocked-by-decision`.
- `to-spec` synthesises an eligible source without reopening its decisions, chooses the verification seams itself, and writes traceable `AC-###` criteria without asking first.
- `to-tickets` writes vertical-slice tickets, their blockers, and the frontier directly. A blocked spec is not ticketable; a draft spec cannot produce ready tickets.
- `implement` delivers one coherent slice from a ready ticket, a ready small spec, `ready-for-implementation` decisions or candidate, or a contract-clear direct request.
- `improve-codebase-architecture` writes evidence-backed candidates and never edits production code.
- Validate every source revision and handoff before advancing. Conversation memory never overrides an artifact mismatch.

## Tracker and git

- Agents treat the issue tracker as read-only unless the project overlay and the user explicitly allow writes. Publishing means writing local artifacts; a request to publish externally produces proposed content for the developer.
- Agents never push and do not create merge or pull requests; the policy hook blocks `git push`. Agents commit only when the user asks. `task start` and `task cleanup` manage the local `agent/<feature>` branches and worktrees.

## Verification

- The task manifest, `.flow/config.json`, and the current unit configuration are the command source of truth.
- During implementation, run the narrowest feedback loop that exercises the active acceptance criterion. Once code is stable, run `flow verify --task <feature>`; rerun with `--force` only when a cached success was invalidated outside the changed source fingerprint.
- UI changes require verification on the actual surface when runtime access is available.
- Report unavailable targets as unavailable, never as passed.

## Review policy

Use `overengineering-review` before implementation only when the change introduces or materially expands a public seam, shared abstraction, configurable workflow, or extension mechanism. Start from the dumb production-complete vertical slice; every proposed seam needs current production evidence or a named boundary exception.

Always perform a focused inline simplicity pass.

Formal review is required when the task-scoped change is broad (more than 100 code lines across more than 5 code files) or deep (more than 300 code lines in any number of files). `.flow/config.json` `review` and `codeFiles` change those numbers and what counts as code. `verify` computes this; do not estimate it by hand. When it is required, the gate is hard:

- `flow verify --task` prints `REVIEW REQUIRED`, exits 3, and parks the task in phase `reviewing`. Nothing completes the task until `code-review` and `code-simplification` evidence both exist or the user waived the review.
- In one message, spawn the `flow:code-reviewer` and `flow:code-simplifier` subagents with the task slug. This policy authorises that spawn: do not ask again and do not skip it to save cost. Their SubagentStop hook records evidence from the final `FLOW-REVIEW-RESULT` line. The policy hook blocks `flow review record` and `flow review waive` for the agent.
- A Stop hook blocks the end of a turn while a task this session drove sits in `reviewing` without evidence, at most twice per task revision; after that it warns, and the task stays incomplete.
- Evidence belongs to one task. It stays current while later changes add at most 100 code lines and at most 5 code files it did not cover, so applying findings does not trigger a second review.
- Only the user can waive the review, with `flow review waive --task <feature> --reason <text>` in their own terminal. `flow review status --task <feature>` shows the gate.

The parent agent applies valid findings from both reports, then reruns `verify --task` once.

## Specialist skills

Specialist skills (`tdd`, `systematic-debugging`, a stack plugin's skills, browser tooling) refine execution when their trigger applies. They do not broaden an artifact's scope or acceptance criteria.
