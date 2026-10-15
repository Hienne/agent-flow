# P-test-earns-its-place

**Rule.** A test stays only when it can go red for a breakage that no other test already catches.

**Why.** A test that cannot fail, or fails only alongside another test for the same breakage, adds run time and maintenance and proves nothing new. Worse, it reads as coverage, so the untested behaviour looks safe.

**Violation.** An expected value recomputed the way the code computes it; a test that asserts only on a mock it configured itself; a second test for the same branch with different literals; a test that stays green when the line it guards is broken.

**Apply.** For each test in scope, name the breakage it catches and how you know it goes red (a red-first run, a kill check, a killed mutant). Keep it when that breakage is caught nowhere else. Rewrite it at the seam that sees the breakage when it cannot go red. Delete it when another test already goes red for the same breakage. See `P-deletion-test`.
