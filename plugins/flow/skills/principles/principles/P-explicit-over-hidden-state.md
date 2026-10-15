# P-explicit-over-hidden-state

**Rule.** Keep a short explicit expression at each use instead of moving repeated logic into a helper that holds state between calls. Fold repetition into a helper only with three or more real repeats and only when the helper is pure (input to output).

**Why.** Reading one call site should answer "why is it like this". A helper that accumulates state forces the reader to assemble the answer from every call site and from the first time the object was seen.

**Violation.** Replacing `disabled = rule || !visible` at two sites with a registry that collects "disable reasons" per control. The diff shrank by about a hundred lines and readers still found it harder to follow.

**Apply.** Ask whether reading one call site answers the business question. If not, keep the explicit form. See `P-rule-of-three`.
