---
name: code-review
description: Formal code review of a change on two axes, Standards (the project's written conventions) and Spec (the acceptance criteria and decisions). Used by the flow:code-reviewer and flow:feature-reviewer subagents, and when the user asks for a formal review. Read-only; reports findings with severity and coverage.
---

# Code Review

You are reviewing code someone else wrote. Judge it only from the diff and the artifacts, not from what the implementer says it does.

## 1. Pin the change

The calling agent file says how to gather the diff, the source spec or ticket, and the decisions. When the user invokes this skill directly:
- take the fixed point they name;
- diff with `git -C <workspace root> diff -M <fixed point>`, so uncommitted and intent-to-add files are included;
- find the spec under the artifacts directory (`.scratch/<feature>/` unless `.flow/config.json` sets `artifactsDir`);
- if no spec exists, run the Standards lane only and state "no spec available" under Spec.

Scope:
- Review what the diff introduced or made worse.
- For a file the diff only moved, review the content hunks, not the move.
- Pre-existing dirty files that the task baseline excluded are out of scope.
- Skip what `flow verify` already enforces: the configured lint, test and build targets and any custom checks.

Read in full every changed source, template, style, test and translation file, plus the callers of any exported symbol the diff changed.

Done when: every changed file has been read in full and the source artifact is known, or is recorded as absent.

## 2. Standards lane

The authority is the project's written conventions: the files `flow explain <path>` lists under "Conventions" (from `context.conventions` in `.flow/config.json`). A written convention outranks neighbouring code. A sibling that diverges is no defence, but note it so the developer can decide. When the project lists no conventions, say so under Coverage and run only steps 2 and 3.

1. Walk every rule or checklist item of each convention file against every changed file type, then the full section behind each item that applies.
2. Check every comment and doc comment the diff added or left beside changed code. A comment that names a rule, consumer, or invariant the code no longer holds is a defect.
3. Then look for the smell baseline. These are always judgement calls, and a documented convention overrides them:
   - **Mysterious Name**
   - **Duplicated Code** (the same shape in two hunks or files)
   - **Feature Envy**
   - **Data Clumps**
   - **Primitive Obsession**
   - **Repeated Switches**
   - **Shotgun Surgery**
   - **Divergent Change**
   - **Speculative Generality**
   - **Message Chains**
   - **Middle Man**
   - **Refused Bequest**
   - **type lies**: a cast that asserts a field or shape that does not exist

Done when: every convention item is marked pass, fail, or not applicable for this change, and that tally goes into Coverage.

## 3. Spec lane

1. Build the **AC map**, one row per `AC-###` of the spec:

   | AC | Code (file:line) | Logic test (test file › test name) | Screen-only part |
   |---|---|---|---|

   - A criterion with no code is a finding.
   - A criterion with branching logic but no test of that branch is a finding. Check every branch the AC enumerates, such as each row of a decision matrix.
2. Check that each `DEC-###` the change touches is honoured and none is contradicted.
3. Flag scope creep: behaviour no AC or DEC asked for.
4. Flag **screen risk**: layout or styling whose result a logic test cannot show, such as `nowrap` or `overflow` on multi-line content, fixed sizes, or stacked content in a fixed-height row. Name what to look at on the real screen.
5. Behaviour that changed for an existing feature must be named, even when the spec allows it. An example is a filter that went from `includes` to `startsWith`.
6. Build the **test map**, one row per test the diff added or changed, and judge each against `P-test-earns-its-place`:

   | Test (file › name) | AC or test-plan row | Breakage it catches | Seen red | Verdict |
   |---|---|---|---|---|

   - **AC or test-plan row**: the `AC-###` it proves, or the row of the test plan the `tdd` skill puts in the worklog. A test that maps to neither is an **orphan**.
   - **Seen red**: the recorded red-first run or kill check, or `none`.
   - **Verdict**: keep, rewrite (name the seam that sees the breakage), or delete (name the test that already catches it).
   - A test is a finding when it is **tautological** (the expected value restates the code's computation, or the assertion checks only a mock the test configured), **implementation-coupled** (mocks the project's own modules, asserts call counts or order on internals, reaches past the interface), a **duplicate** of a test that goes red for the same breakage, an orphan, or has no red run.
   - Read changed assertions in pre-existing tests against the spec: an expected value that moved without an `AC-###` or `DEC-###` behind it is a test bent to fit the code.

Done when: the AC map has one row per criterion, the test map has one row per added or changed test, and every row is filled or flagged.

## Severity

- **Blocking** is any of:
  - a breach of a written convention rule;
  - a contradiction of an `AC-###` or `DEC-###`;
  - a defect such as wrong output, a crash, or lost data;
  - a test missing for an AC branch that the spec's verification section names;
  - a test the AC map cites as an AC's proof that cannot go red (tautological, or asserting only on its own mock), since the AC is then untested;
  - an existing assertion changed to a new expected value that no `AC-###` or `DEC-###` asks for.
- **Non-blocking** is everything else: judgement calls, smells, screen-risk checks, and missing tests the spec does not demand.
- **Conflicts:** when the spec deliberately requires something a convention forbids, report it Non-blocking as a **conflict**. Cite both, and leave the choice to the developer.
- Trust the declared contracts between components and services. A value that its type rules out is not a finding.

## Report

Keep the two axes separate and never rerank across them:

```
## Standards
### Blocking
### Non-blocking
## Spec
### Blocking
### Non-blocking
### AC map
### Test map
## Coverage
```

- Each finding gives:
  - `file:line`;
  - the rule (convention section) or criterion it breaks; when a principle from `flow:principles` applies, start the finding with its ID in brackets, such as `[P-trust-contracts]`, and read the principle file under `${CLAUDE_PLUGIN_ROOT}/skills/principles/principles` only if the index line is not enough. Cite no ID when none matches, and never invent one;
  - the concrete failure;
  - a fix the parent can apply without reading this conversation.
- **Coverage** lists:
  - the files read;
  - the convention tally;
  - what could not be checked, such as runtime behaviour or the real screen.
- Write "None" under an empty heading.
