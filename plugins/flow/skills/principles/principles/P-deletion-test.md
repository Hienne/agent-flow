# P-deletion-test

**Rule.** Mentally inline the abstraction into its nearest owner. Keep it when policy, sequencing, protocol knowledge or change cost would spread into the callers. Collapse it when only ceremony disappears.

**Why.** An abstraction earns its place by hiding knowledge. One that only forwards arguments or renames an API adds a hop and removes nothing.

**Violation.** A wrapper that passes its arguments through; a factory that only calls a constructor; a helper whose name restates its one line.

**Apply.** In a review or simplification, state the result for each suspicious abstraction: "inlining spreads X into N callers, kept" or "nothing is lost, collapse". Collapse in the same change when behaviour stays identical. See `P-rule-of-three`.
