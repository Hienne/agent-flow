---
name: tdd
description: Test-driven development. Use when the user wants to build features or fix bugs test-first, mentions "red-green-refactor", asks for tests or coverage, or wants integration tests.
---

# Test-Driven Development

TDD is the red → green loop. This skill is the reference that makes that loop produce tests worth keeping: what a good test is, where tests go, the anti-patterns, and the rules of the loop. Every section applies on every cycle: consult them before and during the loop, not after.

When exploring the codebase, read `GLOSSARY.md` (if it exists) so test names and interface vocabulary match the project's domain language, and respect ADRs in the area you're touching.

## What a good test is

Tests verify behavior through public interfaces, not implementation details. Code can change entirely; tests shouldn't. A good test reads like a specification: "user can checkout with valid cart" tells you exactly what capability exists, and it survives refactors because it doesn't care about internal structure.

See [tests.md](tests.md) for examples and [mocking.md](mocking.md) for mocking guidelines.

## Seams: where tests go

A **seam** is the public boundary you test at: the interface where you observe behavior without reaching inside. Tests live at seams, never against internals.

**Test only at pre-agreed seams.** Before writing any test, write down the seams under test and confirm them with the user. No test is written at an unconfirmed seam. You can't test everything, so agreeing the seams up front is how testing effort lands on the critical paths and complex logic instead of every edge case.

Ask: "What's the public interface, and which seams should we test?"

When the shape of that interface is itself in question (how deep the module is, where the seam belongs, what the interface should expose), call the Skill tool with "codebase-design" for the vocabulary. It is the shared source of the module, interface, depth, seam, adapter, leverage and locality terms, and it is a reference to consult, not a session to run.

## Test plan: earn every test before writing it

A test earns its place by catching a breakage no existing test catches. Before the first cycle, fill this table for the change, one row per behaviour that changes:

| Behaviour that changes | How it can break | Existing test that already proves it (`file › test name`, or `none`) | Lowest reliable layer | New test? |

- **Existing coverage first.** Search the suite for the behaviour and run the candidates; a row whose existing test goes red when you break the behaviour is covered, and gets `no` in the last column.
- **Lowest reliable layer**: the cheapest seam whose test still fails for the real breakage (a pure function before a module, a module before a running app). The layer is reliable when the breakage reaches it; a lower layer that the bug bypasses buys nothing.
- One row, at most one new test. A behaviour needing a second test names the second breakage it catches.

Done when every changed behaviour has a row, and every `yes` names the breakage its test catches. In a flow task, put the table in the task's `worklog.md`; otherwise show it to the user with the seams.

## Kill check: every new test is seen red

A test that has never failed proves nothing. Every new test is seen **red** against broken code once:

- In the loop, red-first is the kill check.
- For a test written after its code (a characterisation test, a test a reviewer asked for, coverage around existing behaviour): break the exact line the test guards (flip the condition, drop the branch, return the old value), run the test, record the red output, then restore the line and see it green again.

A test that stays green against broken code is **tautological** or tests the wrong seam: rewrite it at the seam that sees the breakage, or delete it. Done when every new test has a recorded red run, kept in `worklog.md` in a flow task.

## When an existing test goes red

An existing test that goes red is evidence about the change, so treat it as a bug report: run the `systematic-debugging` skill and find which side is wrong. When the code is wrong, fix the code. When the test encodes behaviour the spec now changes, update its expected value to the spec's new value and cite the spec line.

The harness holds the line here: `flow verify` fails its `test-integrity` step when the task's diff skips or focuses a test, comments one out, removes test cases, or changes or removes an existing assertion. Only the user can accept those, with `flow review allow-tests --task <feature> --reason <text>` in their own terminal; give them the root cause and the reason for each listed finding, then wait.

## Anti-patterns

- **Implementation-coupled**: mocks internal collaborators, tests private methods, or verifies through a side channel (querying the database instead of using the interface). The tell: the test breaks when you refactor but behavior hasn't changed.
- **Tautological**: the assertion recomputes the expected value the way the code does (`expect(add(a, b)).toBe(a + b)`, a snapshot derived by hand the same way, a constant asserted equal to itself), so it passes by construction and can never disagree with the code. Expected values must come from an independent source of truth: a known-good literal, a worked example, the spec.
- **Horizontal slicing**: writing all tests first, then all implementation. Bulk tests verify _imagined_ behavior: you test the _shape_ of things rather than user-facing behavior, the tests go insensitive to real changes, and you commit to test structure before understanding the implementation. Work in **vertical slices** instead: one test → one implementation → repeat, each test a **tracer bullet** that responds to what the last cycle taught you.

## Rules of the loop

- **Red before green.** Write the failing test first, then only enough code to pass it. Don't anticipate future tests or add speculative features.
- **One slice at a time.** One seam, one test, one minimal implementation per cycle.
- **Refactoring is not part of the loop.** It belongs to the review stage (see the `code-review` skill), not the red → green implementation cycle.
