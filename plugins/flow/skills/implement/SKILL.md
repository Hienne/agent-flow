---
name: implement
description: "Implement one coherent slice from a ready ticket, a small ready spec, ready-for-implementation decisions or candidate, or a contract-clear request, through the flow task lifecycle."
disable-model-invocation: true
argument-hint: "<.scratch/<feature>/issues/NN-slug.md | spec.md | decisions.md | request> [--full] [--isolate] [--reviewer]"
---

Implement: $ARGUMENTS

`${CLAUDE_PLUGIN_ROOT}/docs/workflow-profile.md` is the authority for the task lifecycle, verification and the review gate, and the project's `AGENTS.md` adds its facts; read the profile first.

## Before editing

- **Validate the source.** Eligible: a `ready` ticket on the frontier, a `ready` spec small enough for one slice, `decisions.md` with `handoff: ready-for-implementation`, an architecture candidate with `readiness: ready-for-implementation`, or a direct request with clear contract, scope and observable acceptance criteria. Run `artifact check` and, for a ticket, `artifact frontier`; a ticket whose blockers are not `done` is not started.
- **Start or resume the task.** `flow task start <feature> --target <path-or-project> --source <artifact>` exactly once per task, with `--isolate` only when the prompt asks for it; resume with `inspect --task <feature>`.
- **Fence the behaviour.** Read what `flow explain <path>` lists (domain docs and conventions), ADRs, callers and existing patterns. The source's acceptance criteria, affected contracts and out-of-scope list bound the work; specialist skills (`tdd`, `systematic-debugging`, a stack plugin's skills, browser tooling) refine how you build, never what. When you are about to change code whose reason nothing above explains, run the `flow:why` skill and carry its Preserve and Avoid lines into the fence.

## Build

Use the `tdd` skill at the verification seams the spec or ticket names. While working, run the narrowest feedback loop that exercises the active acceptance criterion (one test file, one unit's typecheck); the full plan runs once, in `verify`. A decision you make during implementation becomes a `DEC-###` in `decisions.md`, or in the worklog when there is none.

## Finish

1. Do the inline simplicity pass, then run `verify --task <feature>`. On `REVIEW REQUIRED`, spawn `flow:code-reviewer` and `flow:code-simplifier` in one message as the profile describes, apply valid findings, and rerun `verify` once. The harness review gate replaces a separate `code-review` skill run.
   - Review evidence goes stale when the fixes add more than 100 code lines (tests count) or touch more than 5 uncovered files; `verify` then asks for a fresh round of the stale kind. Keep fixes small, and plan for a second round when you add specs.
   - Format only the files you edited, and do not run `prettier --write` on a folder: it rewrites CRLF to LF and reformats unrelated files, which inflates the diff and the review scope. If it happens, restore CRLF on the touched files and undo unrelated hunks by hand (`git checkout` of those files is denied by the auto mode classifier).
2. Verify UI changes on the actual surface when runtime access is available. Report unavailable targets as unavailable.
3. When the task completes, tick the ticket's criteria, set its `status: done` and increment its `revision`, update the frontier in `issues/index.md`, rerun `artifact check` and `artifact frontier`, and emit the `artifact.transitioned` event.
4. Leave committing to the user: do not commit, push or open a merge request unless the user asks. Name the next frontier ticket as a `/flow:implement …` command.

## `--full`: every ticket of the spec in one run

When the arguments contain `--full`, the user authorizes the whole ticket chain in this session. The given path (a ticket, `issues/index.md` or `spec.md`) only locates the feature: read `.scratch/<feature>/issues/index.md` and the spec for the full ticket set.

1. **Loop over the frontier.** Run `artifact frontier`, take the lowest-numbered `ready` ticket, and deliver it with the single-ticket flow above: its own task named `<feature>-<NN>` with `--source` pointing at the ticket, the full Finish steps including the review gate, and the ticket set to `done`. Then recompute the frontier and continue until no ticket is left that is not `done`. Tickets run one at a time; they share the feature worktree when the run is isolated.
2. **Stop instead of skipping.** If a ticket stays blocked (a failing check after two fixes in different directions, an open owner decision, an unavailable required target), stop the run, leave that task in its honest state, and report which tickets are done and which remain. Do not start tickets that depend on it.
3. **Survive compaction.** Claude Code compacts this session automatically at the configured auto-compact window. The state lives on disk, not in the conversation: before starting each ticket, make sure the previous task's `worklog.md` is current. After a compaction, re-orient with `inspect --task <feature>-<NN>` and `artifact frontier` before touching code.
4. **Final review.** When every ticket is `done`, spawn the `flow:feature-reviewer` subagent once with the feature slug. Do not apply its findings: every task is already verified and reviewed, so the findings go to the user as decisions in the report.
   - The spawn only works when the user's prompt contains `--reviewer` (the reviewer gate refuses it otherwise, and `--full` alone does not satisfy that check). Run with `--full --reviewer` to get this step.
   - If the spawn is refused, do not stand in for the reviewer with another agent. Skip the step, write the report, say plainly in the report and the final message that the feature review did not run (the finding count is 0 because nothing ran), and give the user the `--reviewer` rerun as a decision.
5. **Detailed report: a PR description, not a summary of goals.** The report exists so the developer can review the code thoroughly before committing. It must explain **what the code does and why it is written that way**, part by part. A page that only restates the purpose of each ticket is a failed report. Use three parts, Summary, Evidence and Merge Danger, and write one self-contained, hand-written HTML file at `.scratch/<feature>/report.html`. Use inline CSS with light/dark tokens and no external scripts. Do not use html-plan for this report. `references/report-example.html` in this skill's directory is the model to copy: its structure, depth and CSS.
   - **Source of truth.** Build the report from the actual diff of every unit the feature touched (`git -C <worktree> diff HEAD` plus untracked files, including library units), the spec, the tickets and each task's `worklog.md`, not from memory. Re-read current line numbers before you cite `file:line`.
   - **Language.** Write the report in the language of the user's prompt (Vietnamese for a Vietnamese prompt). Keep code names, `AC-###`, `DEC-###` and quoted user words as they are.
   - **Header.** Give the title, the branch and units, a ticket table (ticket, content, `AC-###`, status, with any open criterion named), and a table of contents.
   - **Summary, opening.** A short file tree marks each new or changed file with its role, followed by the real +/− counts. One paragraph explains the paths the change takes, for example "hard error goes through the existing validator, warning goes through a new service".
   - **Summary, one section per ticket and per library change.** Each section has numbered subsections. Each subsection pairs one short paragraph with the one visual that explains it best:
     - pseudocode for rule order and decision tables;
     - a call tree for runtime flow, from the DOM event down to the dialog or API;
     - a `diff` sketch, with green and red lines, for what moved or changed in existing code. Say *why* it moved: what was broken or impossible before;
     - a table for wiring (control × event × call order), boundary cases (equal dates and similar), or a name-derivation mapping.
   - **What each section must cover.** Explain every non-obvious mechanism: state kept between events, ordering dependencies, why one API was chosen over another (for example `.search` vs `.test` on a global regex), prefactors to existing services, providers and scope, i18n and error-key registration, and spec stubs that existing tests needed. For a library fix, show why the old code failed (the event path) and how the new code fixes it, and say when the consuming app gets it (a release, a version bump or a local link).
   - **Review callouts.** Mark the places where a reviewer must look hardest with a "Cần review" (or "Needs review") box: fragile conventions, an ordering that callers must keep, behaviour that changed silently for existing data, and alternatives you rejected.
   - **Evidence.** Give a before/after table per behaviour: situation, before, after, and the spec test name that proves it. Add the commands you ran **in this session** with their real output (suites and test counts). Add a table of harness gates per task (each verify step and the review gate), with pre-existing failures named as such. List the review findings you applied. State plainly what was not verified at runtime.
   - **Merge Danger.** State the door (one-way or two-way) with the reason. Then run the `flow:blast-radius` skill over the feature diff and render its report here: the safety fact with its evidence level and proof, or `unproven`; each risk as a ramification (existing data that newly fails a rule, shared-library consumers, new popups or UX friction, cache or version bumps); the Cleared list; and the cheapest check before merge.
   - **Open items.** List open tickets and why, an unproven safety fact, feature-review findings (each with a recommended action) or the statement that the feature review did not run, runtime checks not done, anything not committed, and what did not change.
   Keep the report a local file. Check every cited `file:line` against the current file. Send it with `SendUserFile` (`display: "render"`). Finish by giving the user the `report.html` path, the ticket list with status, and either the number of feature-review findings or the statement that the feature review did not run.
