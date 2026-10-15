---
name: grill-with-docs
description: Interview the owner about the implementation-changing decisions of a feature, record them in .scratch/<feature>/decisions.md, and update CONTEXT.md and ADRs as terms and durable decisions settle.
disable-model-invocation: true
argument-hint: "<idea> | .scratch/<feature>/decisions.md"
---

Grill: $ARGUMENTS

`${CLAUDE_PLUGIN_ROOT}/docs/workflow-profile.md` (routing, harness commands) and `${CLAUDE_PLUGIN_ROOT}/docs/workflow-artifacts.md` (the `decisions.md` contract) are the authority; read both before the first question.

## Interview

Call the Skill tool for `grilling` and `domain-modeling`, with these overrides:

- Finding facts is your job. Read the code, config, `CONTEXT.md`, ADRs and backend contracts (`flow explain <path>` lists the domain docs and conventions for a path) before asking, and list what you found under "Facts found" so the user can correct it. Every choice the code does not already answer is the user's decision, however small; when unsure whether something is a fact or a decision, ask.
- Ask the whole frontier each round, as `grilling` describes, with no cap on the number of questions. Number them and give your recommended answer, so the user can reply "1A, 2 as recommended".
- A recommendation is not a decision. Record a `DEC-###` only after the user answered it (an explicit "as recommended" counts); until then it stays open.
- Domain terms go into the domain doc `flow explain` lists for the owning unit (usually its `CONTEXT.md`), never a new `GLOSSARY.md`. Durable, hard-to-reverse decisions become ADRs in the owning unit's `docs/adr/`, or the root `docs/adr/` when they span units.
- When the source is an existing `decisions.md`, settled `DEC-###` entries stay settled; ask only what is still open.

## Record

After every round, write `.scratch/<feature>/decisions.md` per the contract: frontmatter, one `DEC-###` per answered decision with the user's option, the reason and its consequence for scope, contracts or verification, the still-open questions, and exactly one `handoff`. While any question is open the handoff is `blocked-by-decision`; set `ready-for-spec` or `ready-for-implementation` only when the frontier is empty and the user has confirmed you reached a shared understanding. Increment `revision` whenever a decision changes. Then emit the `artifact.transitioned` event and run `artifact check` as the workflow profile describes.

## Finish

Keep running rounds until the frontier is empty and the user confirms; a `blocked-by-decision` write between rounds is a checkpoint, not the end. Then show the handoff as `READY_FOR_SPEC`, `READY_FOR_IMPLEMENTATION` or `BLOCKED_BY_DECISION` and name the next command: `/flow:to-spec .scratch/<feature>/decisions.md` or `/flow:implement .scratch/<feature>/decisions.md`. This stage writes no spec and no code.
