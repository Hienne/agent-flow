---
name: code-simplification
description: Behavior-preserving simplification of changed code (YAGNI, public surface, Rule of Three, deletion test). Use when the user asks to simplify code, or as the formal pass when `flow verify` reports REVIEW REQUIRED; in Claude Code that formal pass runs inside the flow:code-simplifier subagent. Small changes only get an inline simplicity pass.
---

# Code Simplification

Simplify for comprehension and maintenance, not line count. Preserve observable behavior, public contracts, side effects, timing, errors, and UI output exactly.

## Mode

- **Apply mode** (default when a user invokes this skill directly): make the edits yourself and verify them (steps 1–6).
- **Report mode** (inside the read-only `flow:code-simplifier` subagent, or whenever you cannot edit): do steps 1–4, then write each accepted candidate as an exact edit for the parent to apply (step 5), and skip step 6. The parent reruns `flow verify --task <feature>` after applying the edits.

The formal pass is meant to review code that someone else wrote. If you wrote the code earlier in this conversation, do not run the formal pass yourself in Claude Code. Spawn `flow:code-simplifier` so the review starts from a fresh context.

## Scope

- Operate only on the requested code or recently changed code.
- The owning unit is the nearest workspace `flow explain <path>` reports.
- Read the conventions `flow explain <path>` lists. Written conventions outrank neighboring code.
- Do not mix unrelated cleanup into a feature or bug-fix diff.

## Workflow

### 1. Establish the behavior fence

Before editing:

1. Inspect the complete changed symbols, templates, tests, callers, and dependencies.
2. Use symbol references before changing exported APIs, public types, configuration, or shared utilities.
3. Record invariants: return values, mutations, emitted events, timing, error paths, loading states, permissions, translations, and rendered output.
4. Understand why an abstraction exists. Keep it when it protects reuse, dependency scope, testability, performance, or a business rule.

Completion: every affected caller and observable behavior is accounted for.

### 2. Test abstraction evidence

Treat post-implementation YAGNI as part of the same behavior-preserving pass:

1. Name each new or suspicious interface, token, base class, registry, strategy, factory, configurable callback, helper, store, and public export.
2. Identify its current production consumers, the knowledge hidden from callers, and the behavior that varies today. A test fake is not production variability.
3. Apply the Rule of Three as evidence rather than arithmetic: the first occurrence proves need, the second reveals similarity and variation, and a third usually gives strong extraction evidence. Two real consumers can justify a seam when they already duplicate the same invariant or lifecycle.
4. Allow a single implementation behind a boundary when it contains an external protocol, framework requirement, security or transaction boundary, or committed public contract.
5. Run the deletion test: mentally inline the abstraction into its nearest owner. Keep it when policy, sequencing, protocol knowledge, or change cost spreads into callers; collapse it when knowledge and ceremony disappear.
6. Remove unsupported optional hooks, public exports, workflow configuration, and fake-only seams when doing so preserves the behavior fence.

Completion: every changed abstraction is either supported by current production evidence or a named boundary exception, and every safe collapse is included in the same coherent simplification.

### 3. Find net simplifications

Prefer changes that remove a mental branch:

- Replace deep nesting with guard clauses when execution order stays identical.
- Name business predicates and transformations; remove helpers that only forward arguments or rename an API.
- Remove view models and mappers that only mirror an API type's fields, even when they predate the diff but the diff reuses, moves or promotes them; use the API type directly.
- Remove dead branches, unused imports, repeated conditions, redundant assertions, and comments that restate code.
- Correct every comment and doc comment the diff made untrue: one that still names a rule, consumer, or invariant the changed code no longer holds misleads the next reader more than no comment.
- Consolidate duplication only when the duplicated behavior and change cadence are the same.
- Keep explicit intermediate values when a compact expression or chained pipeline is harder to scan.
- Keep code near its narrowest owner; do not promote local logic to shared code without multiple real consumers.

Reject a candidate when it merely reduces lines, introduces a second pattern for the same job, broadens scope, or relies on speculative reuse.

### 4. Protect stack semantics

Preserve what the framework and language guarantee around the changed code: dependency-injection scope, lifecycle timing, reactive subscription and cancellation behaviour, form and validation semantics, transaction boundaries, and error propagation. Trust declared contracts between components and services; do not add speculative normalization or runtime validation for impossible inputs. Avoid new allocations or recomputation in hot paths. A stack plugin's conventions may add specific rules here.

### 5. Apply the smallest coherent change

In report mode, write each change as file:line plus a before/after snippet, and list the callers and tests it touches. In apply mode, make one coherent simplification at a time. Use project naming and file placement. Migrate every affected caller and remove obsolete aliases, wrappers, comments, imports, and tests for implementation details. Existing behavior tests stay unchanged unless a test only asserted removed internal structure.

Completion: the diff contains only behavior-preserving, convention-aligned simplifications and no remnants.

### 6. Verify

Run only the affected checks with `flow verify --task <feature>`, and do not repeat a passed check unless a later change invalidates it. For UI changes, verify the actual screen when runtime access is available.

Completion: focused behavior verification passes and the new version is demonstrably easier to understand. Revert any candidate that fails one of these conditions.

## Review output

Report:

1. complexity and unsupported abstraction removed, with the production evidence or deletion-test result, each tagged with the `flow:principles` ID it rests on, such as `[P-deletion-test]` (no ID when none matches; never invent one);
2. abstractions intentionally retained and their boundary or current-consumer evidence;
3. behavior fences preserved;
4. exact verification and results;
5. candidates intentionally left unchanged because risk exceeded value.
