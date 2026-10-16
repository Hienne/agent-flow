---
name: test-audit
description: Audit an existing test suite for tests that cannot fail, duplicate each other, test internals, or sit skipped, and propose keep, rewrite, merge or delete for each with run evidence. Use for "audit the tests", "which tests are useless", a slow or bloated suite, or skipped tests piling up.
---

# Test audit

A suite earns its run time test by test: each test stays only when it can go **red** for a breakage no other test catches (`P-test-earns-its-place`). An audit is a measurement, not a reading: a test that looks redundant may be the only one guarding a branch, and one that looks solid may never go red. So every delete verdict rests on a run, and nothing changes until the user approves the report.

Evidence levels follow the `blast-radius` ladder: `claimed`, `cited` (a `file:line`), `ran` (a command whose output you paste).

## Steps

1. **Pin the scope and the baseline.** Take the path or unit the user named; a whole-repository audit is the user's call, so ask before widening. List the scope's test files with `git ls-files` and a pattern (`git ls-files '<scope>/**/*.spec.ts'`), which skips `node_modules` and build output; `find` over an umbrella costs minutes.
   - **Preflight.** Find the scope's test command (`flow explain <path>`, the unit's scripts or build file) and check that the runner starts (`npx jest --version`, or the runner's equivalent). When it does not (missing `node_modules/.bin`, a dependency that will not install), stop and tell the user what is broken: repairing dependencies is their call, and every later step needs a working runner.
   - **One baseline run.** Run the scope once with the runner's machine-readable report (jest: `--json --outputFile <artifacts>/test-audit/baseline.json`), and take the test count, the duration and the slowest files from that one report.
   Done when: the runner starts and one baseline report holds the count, the duration and the per-file timing.
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
4. **Measure catching power.** When the project already has a mutation tool configured or installed (Stryker, PIT, mutmut, go-mutesting), run it on the scope and map each killed mutant to the tests that killed it. Installing a tool changes the project's dependencies: propose it, and install only on a yes. Without a tool, run a **kill check** on each suspect with `${CLAUDE_PLUGIN_ROOT}/skills/test-audit/scripts/kill-check.mjs`: it replaces one exact snippet, runs the commands, lists every test that went red, restores the file byte for byte, and refuses a snippet that matches zero or several times. Pass the spec as JSON on stdin:

   ```json
   { "file": "libs/cart/src/total.ts", "find": "sum > 100 ?", "replace": "sum > 1000 ?",
     "commands": [["npx", "jest", "-c", "libs/cart/jest.config.ts", "--findRelatedTests", "{file}"]],
     "jestJson": true }
   ```

   - **Run only the related tests.** A test can go red only when it imports the broken file, directly or through other modules, so `--findRelatedTests {file}` finds every test that can disagree, duplicates in other files included, without running the whole suite. When the file belongs to a library, add one command per consuming project's jest config (`flow impact --files <file>` lists them). Other runners: select by the same dependency rule (pytest-testmon when the project has it, Gradle and Maven per module), or run the scope. A module loaded through a computed `require` path escapes the dependency graph; name such modules under Not measured.
   - **Pick a mutation that changes behaviour**: flip a condition, move a boundary, drop a branch, return a constant. A replacement that only renames, reformats or touches dead code proves nothing.
   - **Read the status.** `red` lists the tests that caught the mutation; `green` means every related test survived it; `invalid` means the mutation stopped a suite from loading (a compile error), so pick another; `error` means nothing was measured, and the message says why.
   Done when: every suspect has a `red` or `green` result, or a stated reason it could not be run.
5. **Report.** Write `<artifacts>/test-audit/<scope-slug>.md` (`<artifacts>` is `.scratch/` unless `.flow/config.json` sets `artifactsDir`), in the language of the user's prompt:
   - **Baseline**: the command, test count and duration.
   - **Verdicts**: one row per suspect: test (`file › name`), class, evidence (level, plus the command and the tests that went red), verdict, and the time it saves. A verdict is keep, rewrite (name the seam that sees the breakage), merge (name the table-driven test it joins), or delete (name the test that already goes red for the same breakage, or show it never goes red). A delete verdict needs `ran` evidence; below that, the verdict is rewrite or keep.
   - **Skipped tests**: each with its age and the decision the user owes: fix, delete, or keep skipped with an owner and a date.
   - **Not measured**: what the audit could not run, and why.
   Show the user the verdict table and the report path, then stop.
   Done when: every suspect has a verdict and the user has the report.
6. **Apply the approved rows.** Change only the rows the user approved. In a flow task, these deletions trip the `test-integrity` step of `flow verify` by design; the user accepts them with `flow review allow-tests --task <feature> --reason "<report path>"`. Rerun the baseline command, with its report, and put the new count and duration beside the old ones; when step 4 used a mutation tool, rerun it and confirm no mutant that was killed before now survives.
   Done when: the after numbers sit beside the baseline and every mutant killed before is still killed.
