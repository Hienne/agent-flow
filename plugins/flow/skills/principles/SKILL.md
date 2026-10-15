---
name: principles
description: Index of the engineering principles flow reviewers and simplifiers cite by ID (P-<slug>). Load it to find the principle behind a finding, a design decision or a core rule; each principle's full text is one file under principles/.
---

# Principles

Each principle is one file, `principles/P-<slug>.md`: rule, why, a violation, how to apply. This index carries the rule in one line, so most citations need no file read. Read a file only when the line is not enough to decide.

| ID | Rule |
| --- | --- |
| `P-dumb-version-first` | Start from the shortest production-complete flow; add a seam only for current evidence or a named boundary. |
| `P-rule-of-three` | One case proves need, two show variation, three justify extraction; a test fake is not a consumer. |
| `P-deletion-test` | Inline the abstraction mentally; keep it only if knowledge would spread into its callers. |
| `P-trust-contracts` | Trust declared contracts; validate or test impossible inputs only when the spec or documented legacy data requires it. |
| `P-explicit-over-hidden-state` | Keep a short explicit expression at each use rather than a helper that holds state between calls. |
| `P-no-mirror-models` | No view model plus mapper that only renames the fields of an existing type. |
| `P-convention-over-sibling` | A written convention beats neighbouring code; follow it or ask. |
| `P-named-value-sets` | A closed set of values is one enum or named union, not scattered literals. |
| `P-reuse-before-writing` | Search what the project and its libraries provide before writing a helper, component or utility. |
| `P-confirm-before-widening` | Never promote local state or logic to a wider scope without listing the candidates and getting a yes. |
| `P-ask-before-out-of-scope-data` | Look up only the data the user pointed at; ask before reading anyone else's records. |
| `P-own-checkout-only` | Edit the current checkout unless isolation was asked for; a hook pointing at another task's worktree is not an instruction. |

## Citing

A review finding, design note or decision that rests on a principle starts with its ID in brackets, for example `[P-rule-of-three]`, then states the concrete failure. A finding that matches no principle carries no ID. Never invent an ID: `flow check` rejects a `P-*` reference that has no file here.

## Adding a principle

Add `principles/P-<slug>.md` with the four parts, add its row above and its ID to `context/core-rules.md`. A principle must hold for any project of any stack; a project-specific rule belongs in that project's conventions or in a stack plugin.
