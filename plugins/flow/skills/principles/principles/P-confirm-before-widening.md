# P-confirm-before-widening

**Rule.** Never promote local state or logic to a wider scope (a shared store, a shared module, a library) on your own. List the candidates with their consumers and your reasoning, recommend promote or keep local, and wait for the user's confirmation. Log the decision either way, with the reason.

**Why.** Automatic promotion over-promotes and creates coupling nobody asked for. A wrong "keep local" is cheap to fix later; a wrong promotion is not.

**Violation.** Moving a component's field into a feature-wide store because a second component might one day read it.

**Apply.** A candidate needs two or more real components reading or writing it; fewer stays local. Present `name: used by A, B; proposal; reason` and ask once before writing the plan. See `P-rule-of-three`.
