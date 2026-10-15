# P-rule-of-three

**Rule.** The first occurrence proves a need, the second reveals similarity and variation, the third usually supplies strong evidence to extract. Two real production consumers can justify a seam when they already repeat the same invariant or lifecycle. A test fake is not a consumer. Numeric budgets are tripwires that ask for an explanation, not defects.

**Why.** Extracting from fewer than two real cases guesses the axis of variation, and the guess is usually wrong.

**Violation.** A shared helper created for a second call site that is a test double; a "common" module with one importer; manufacturing a third duplicate to justify an extraction.

**Apply.** Name each production consumer of the abstraction. Fewer than two: inline it, unless a boundary exception from `P-dumb-version-first` applies. See `P-deletion-test`.
