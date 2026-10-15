---
name: start
description: "Route a request to the right flow workflow before any work starts: classify it as bug/perf, small change, feature or refactor, propose the route with a one-sentence reason and the first /flow command, then stop and wait for the user to confirm or pick another route. Proposes only; never runs a stage itself."
argument-hint: "<what you want done>"
---

Request: $ARGUMENTS

# Start: propose a route, then wait

Your whole job here is one proposal. Do not invoke another skill, do not edit or create files, do not start a task, and do not begin the first stage, even when the request looks obvious. The user runs the first command, or tells you to.

## 1. Classify

Read the request (and, only if it names them, the files or tickets it points to; reading is allowed, writing is not). Pick exactly one route:

| Route | When | Stages |
| --- | --- | --- |
| **bug / perf** | Something that worked is broken, throws, fails a test, or got slow. | `/flow:diagnosing-bugs` → `/flow:tdd` (regression test at the seam) → `/flow:implement` with the fix as a direct request |
| **small change** | A contained change whose contract and acceptance are already clear: a label, a field, a validation message, one config value, a narrow behaviour tweak in one place. | `/flow:implement` with the request |
| **feature** | New behaviour or a change spanning several units, screens or contracts, or one whose rules are still open. | `/flow:grill-with-docs` → `/flow:to-spec` → `/flow:to-tickets` → `/flow:implement` per ticket |
| **refactor** | Improve structure without changing behaviour: split or merge modules, deepen an interface, remove duplication. | `/flow:improve-codebase-architecture` |

Tie-breakers:
- A defect report is **bug / perf** even when the fix looks one line long; the diagnosis loop is what proves it.
- If a "small change" needs a decision nobody has made yet (which rule, which screen, which API), it is a **feature**.
- If a refactor is requested to enable a feature, propose **feature** and mention the refactor as part of grilling.
- When the request is too vague to classify, ask one question instead of guessing.

## 2. Propose and stop

Reply in the user's language with exactly these lines as plain text (not inside a code block), then end your turn:

```
Route: <bug / perf | small change | feature | refactor>
Why: <one sentence tied to the request>
First step: /flow:<skill> <argument>
Then: <the remaining stages, or "nothing else">

Run the first step, or say which other route you want.
```

The first step uses the skill named first in the route's row, with the request (or the bug symptom) as its argument. If the user answers with a different route, give that route's first step in the same shape and stop again. Only when the user explicitly says to go ahead do you invoke the first stage.
