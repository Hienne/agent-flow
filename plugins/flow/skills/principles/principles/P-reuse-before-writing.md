# P-reuse-before-writing

**Rule.** Before writing a helper, component, store or utility, search what the project and its libraries already provide, and use it. This includes the moment you split inline code into a function during a refactor.

**Why.** A second implementation drifts from the first in the edge cases (dates, formats, accessibility), and the library's own components share behaviour a hand-built one lacks.

**Violation.** A hand-written date parser and formatter next to a library date utility; a plain button strip where the library has a tab component. A subtler one: writing a technical constraint into a spec from memory ("logic files may only import types") without checking it on the target project, then building a workaround for it.

**Apply.** Use the search the project's conventions name, with narrow queries (one word, a function name). When nothing fits, say in one sentence why before writing new code. Verify a constraint on the target before you write it down.
