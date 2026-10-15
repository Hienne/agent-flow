# P-dumb-version-first

**Rule.** Start from the shortest explicit, production-complete flow that meets the current requirements. Add an interface, hook, export, registry or configuration key only when a current requirement, proven duplication or a named boundary needs it. Boundaries that count: an external protocol, a framework requirement, a security or transaction boundary, a committed public contract.

**Why.** Every seam adds a policy owner and knowledge a maintainer must carry. Speculative seams are paid for by everyone and rarely match the variation that later arrives.

**Violation.** A strategy registry with one implementation "for later"; an optional callback no caller passes; a configuration key nobody sets.

**Apply.** Before coding a change that adds or widens a seam, write the dumb version in the design note and list each proposed seam with its production evidence (`/flow:overengineering-review`). A seam with none is rejected, and the rejected extension points are recorded so they do not return. See `P-rule-of-three`, `P-deletion-test`.
