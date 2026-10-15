# P-trust-contracts

**Rule.** Trust the contracts declared between components, services and the front and back end. Add runtime validation, normalisation or tests for an impossible input only when the spec or documented legacy data requires it.

**Why.** Guards for inputs the contract rules out hide the real contract, add branches nobody can reach, and make a broken producer look like a working consumer.

**Violation.** A null check on a field the type declares non-null; defensive parsing of a response the API contract fixes; a test for a state the types forbid.

**Apply.** When tempted to guard, find the line that declares the contract (type, spec, API document). If it rules the case out, do not guard. If documented legacy data breaks it, guard and cite that document in a comment.
