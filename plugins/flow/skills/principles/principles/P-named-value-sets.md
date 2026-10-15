# P-named-value-sets

**Rule.** A closed set of values (status, channel, mode, action key) is declared once, as an enum or a named union in the project's shared location. Use its members wherever the value is compared, keyed, passed or faked in a test. No scattered string literals.

**Why.** Literals drift between producers and consumers, escape rename tooling, and hide the full set of values from the reader.

**Violation.** `status === 'pending_confirm'` repeated in three files; a map keyed by literal button names.

**Apply.** Find the existing declaration first (`P-reuse-before-writing`). If a library constant cannot be used in tests, declare a local one with the same values and a comment naming its source.
