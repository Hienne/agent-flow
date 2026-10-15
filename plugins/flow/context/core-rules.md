# flow core rules

This project uses the `flow` plugin. `.flow/config.json` marks the project root; run every `flow` command from there. The full policy is `docs/workflow-profile.md` in the flow plugin: read it before a workflow skill (`/flow:grill-with-docs`, `/flow:to-spec`, `/flow:to-tickets`, `/flow:implement`, `/flow:improve-codebase-architecture`) or a `flow task`.

## Tasks

- Start a task with `flow task start <feature> --target <path-or-project> --source <artifact-or-conversation>`; resume with `flow inspect --task <feature>`. Artifacts live in `.scratch/<feature>/` unless the config sets `artifactsDir`.
- Pass `--isolate` only when the user's prompt contains `--isolate` or asks for a separate branch or worktree; otherwise edit the user's checkout. In an isolated task, edit only under the printed `WORKTREE` paths.
- Before changing a path, run `flow explain <path>` and read the domain docs and conventions it lists.
- Report an unavailable target as unavailable, never as passed.

## Verify and review

- Run `flow verify --task <feature>`. When it prints `REVIEW REQUIRED` (exit 3), spawn `flow:code-reviewer` and `flow:code-simplifier` in one message with the task slug. This rule is the user's standing request for that spawn. Apply valid findings, then rerun `flow verify --task <feature>` once.
- Cost, effort, and session length are not reasons to skip the review; only the user can waive it, with `flow review waive` in their own terminal.
- `flow impact --task <feature>` lists the units and workspaces that consume the change; `verify --plan` prints it as a warning.

## Optional agents

- `flow:feature-reviewer`: spawn once, with the feature slug, only when the user's prompt contains `--reviewer` and every ticket of the feature is `done`. Report its findings to the user as decisions; do not apply them.
- Any other multi-agent run needs the trade-offs explained and the user's explicit approval first.

## Git and external systems

- Never run `git push`; the policy hook blocks it. Do not create merge or pull requests. Commit only when the user asks.
- Treat the issue tracker as read-only unless the project's `AGENTS.md` and the user allow writes.
- Never commit secrets, tokens, or customer data.

## Principles

Do a simplicity pass on every changed path against these principles (`/flow:principles` has the rule, reason and example for each). Reviews and simplifications cite them by ID.

- `P-dumb-version-first`, `P-rule-of-three`, `P-deletion-test`: seams and abstractions need current evidence. Run `/flow:overengineering-review` before adding or widening a seam.
- `P-trust-contracts`, `P-explicit-over-hidden-state`, `P-no-mirror-models`: less code, fewer guards.
- `P-convention-over-sibling`, `P-named-value-sets`, `P-reuse-before-writing`: fit the project.
- `P-confirm-before-widening`, `P-ask-before-out-of-scope-data`, `P-own-checkout-only`: stay within what the user asked.
