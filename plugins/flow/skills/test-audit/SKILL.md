---
name: test-audit
description: Audit an existing test suite for tests that cannot fail, duplicate each other, test internals, or sit skipped, and propose keep, rewrite, merge or delete for each with run evidence. Use for "audit the tests", "which tests are useless", a slow or bloated suite, or skipped tests piling up.
---

# Test audit

A suite earns its run time test by test: each test stays only when it can go **red** for a breakage no other test catches (`P-test-earns-its-place`). An audit is a measurement, not a reading: a test that looks redundant may be the only one guarding a branch, and one that looks solid may never go red. So every delete verdict rests on a run, and nothing changes until the user approves the report.

Evidence levels follow the `blast-radius` ladder: `claimed`, `cited` (a `file:line`), `ran` (a command whose output you paste).

## Steps

1. **Pin the scope and the baseline.** Take the path or unit the user named; a whole-repository audit is the user's call, so ask before widening. Find the scope's test command (`flow explain <path>`, the unit's scripts or build file), run it once, and record the test count, the duration, and the slowest files when the runner reports per-file timing.
   Done when: the baseline command and its numbers are recorded.
2. **Inventory the cheap signals.** Search the scope for skipped, focused and disabled tests (`.skip`, `.only`, `xit`, `test.todo`, `@Disabled`, `@Ignore`, `pytest.mark.skip`), tests commented out, and tests with no assertion. Give each skip its age and the commit that added it (`git log -S '<line>' -- <file>`).
   Done when: every marker is listed with `file:line` and age.
3. **Read and classify.** Read every test file in scope in full, with the code each test calls. Mark each suspect test with one class:
   - **tautological**: the expected value restates the code's computation, or the only assertion checks a mock the test configured;
   - **implementation-coupled**: mocks the project's own modules, asserts call counts or order on internals, or reaches past the interface;
   - **duplicate**: same seam and branch as another test, different literals;
   - **never-red**: stays green when the line it guards is broken (filled in by step 4);
   - **stale skip**: skipped with no live reason;
   - **slow**: near the top of the timings while a lower layer could see the same breakage.
   Done when: every test file in scope is read and every suspect has a class and a `file:line`.
4. **Measure catching power.** When the project already has a mutation tool configured or installed (Stryker, PIT, mutmut, go-mutesting), run it on the scope and map each killed mutant to the tests that killed it. Installing a tool changes the project's dependencies: propose it, and install only on a yes. Without a tool, run a **kill check** on each suspect: break the line it guards, run the scope's tests, record which tests go red, restore the line, and confirm `git diff` shows nothing left over.
   Done when: every suspect has a `ran` result, or a stated reason it could not be run.
5. **Report.** Write `<artifacts>/test-audit/<scope-slug>.md` (`<artifacts>` is `.scratch/` unless `.flow/config.json` sets `artifactsDir`), in the language of the user's prompt:
   - **Baseline**: the command, test count and duration.
   - **Verdicts**: one row per suspect: test (`file › name`), class, evidence (level, plus the command and the tests that went red), verdict, and the time it saves. A verdict is keep, rewrite (name the seam that sees the breakage), merge (name the table-driven test it joins), or delete (name the test that already goes red for the same breakage, or show it never goes red). A delete verdict needs `ran` evidence; below that, the verdict is rewrite or keep.
   - **Skipped tests**: each with its age and the decision the user owes: fix, delete, or keep skipped with an owner and a date.
   - **Not measured**: what the audit could not run, and why.
   Show the user the verdict table and the report path, then stop.
   Done when: every suspect has a verdict and the user has the report.
6. **Apply the approved rows.** Change only the rows the user approved. In a flow task, these deletions trip the `test-integrity` step of `flow verify` by design; the user accepts them with `flow review allow-tests --task <feature> --reason "<report path>"`. Rerun the baseline command and put the new count and duration beside the old ones; when step 4 used a mutation tool, rerun it and confirm no mutant that was killed before now survives.
   Done when: the after numbers sit beside the baseline and every mutant killed before is still killed.
