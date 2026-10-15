# P-convention-over-sibling

**Rule.** A written project convention outranks neighbouring code. When a sibling diverges from it, follow the convention or ask the developer which scope to follow. Never copy a sibling's layout silently.

**Why.** Siblings break conventions too; cloning one spreads the break and makes it look like the norm.

**Violation.** Building a new screen as a copy of its closest sibling, including the sibling's file layout, which the convention forbids.

**Apply.** Read the convention files `flow explain <path>` lists before building. Before reporting done, walk the convention's checklist against the change. If the sibling diverges, say so in one sentence and ask. A reviewer reports a divergence that the spec requires as a conflict for the developer to decide.
