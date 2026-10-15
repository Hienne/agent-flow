---
name: overengineering-review
description: Preflight designs before implementation when a change may introduce or materially expand public seams, shared abstractions, configurable workflows, plugin systems, strategy layers, registries, factories, or framework-like extension mechanisms. Use for YAGNI, KISS, the dumb version, Rule of Three, abstraction budgets, and deletion-test decisions; post-implementation cleanup belongs to code-simplification.
---

# Over-engineering Preflight

Choose the smallest production-complete design a maintainer can trace. Preserve required behavior, correctness, security, external contracts, and proven shared invariants. Simplicity means lower total knowledge and fewer policy owners, not fewer files.

## Scope

Run before implementation or while comparing designs. Do not use this as a mandatory final review for a large diff. Once implementation is stable, route behavior-preserving YAGNI and deletion-test cleanup to `code-simplification`.

Use the preflight when a proposal creates or materially expands:

- a public interface, token, base class, export, or extension point;
- a shared module or abstraction used across feature owners;
- a registry, strategy, adapter family, plugin system, or middleware pipeline;
- a configuration-driven workflow or optional callback surface;
- an abstraction with only one planned production implementation.

## Calibration

Use YAGNI and the Rule of Three as evidence rules:

- Start with the simplest direct production flow that satisfies current requirements.
- The first occurrence proves need. The second reveals similarity and variation. A third usually supplies strong extraction evidence.
- Two materially different production consumers may justify a seam when they already repeat the same invariant or lifecycle. Never manufacture a third duplicate.
- A test fake is not a production consumer.
- One implementation may sit behind a boundary that contains an external protocol, framework requirement, security or transaction boundary, or committed public contract.
- Numerical budgets are tripwires that request explanation, not automatic defects.

## Workflow

### 1. State current production behavior

List current requirements, committed variants, external boundaries, and invariants. Exclude hypothetical consumers and uncommitted options.

### 2. Write the dumb version

Describe the shortest explicit vertical flow that satisfies the behavior without extension points. It must remain production-complete, observable, and safe.

### 3. Build the abstraction ledger

Evaluate every proposed interface, base class, token, registry, strategy, adapter, factory, configurable callback, and public export:

| Candidate | Current production consumers | Knowledge hidden | Real variation or boundary | Deletion effect | Decision |
|---|---|---|---|---|---|

Keep a candidate only when deleting it spreads policy, sequencing, protocol knowledge, or a required boundary into callers. Reject pass-through ceremony and fake-only seams.

### 4. Fix ownership and precedence

Assign one owner to each concern. State precedence explicitly for overrides, guards, factories, and configuration. Prefer one real vertical flow, then a materially different second flow, before extracting shared lifecycle behavior.

### 5. Record rejected extension points

Name hooks, plugins, callbacks, strategies, exports, and configuration deliberately excluded from the implementation. This keeps speculative surface from reappearing while coding.

Completion: every accepted seam traces to a current requirement, proven duplication, or named boundary exception.

## Output

Write a concise design decision:

```markdown
# Over-engineering preflight

## Dumb version

## Abstraction ledger
| Candidate | Production evidence | Knowledge hidden | Deletion effect | Decision |

## Ownership and precedence

## Rejected extension points

## Decision
Proceed | Revise
```

`Proceed` means the proposed design is the smallest production-complete option supported by current evidence. `Revise` names the smallest correction before implementation begins.
