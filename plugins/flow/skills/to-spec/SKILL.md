---
name: to-spec
description: "Synthesize a feature's decisions, architecture candidate, or settled conversation into .scratch/<feature>/spec.md with AC-### criteria and verification seams, plus an HTML review page of that spec. Writes directly: no interview, no confirmation."
disable-model-invocation: true
argument-hint: "[.scratch/<feature>/decisions.md | architecture candidate path]"
---

Source: $ARGUMENTS (when empty, the settled decisions in this conversation)

`${CLAUDE_PLUGIN_ROOT}/docs/workflow-profile.md` and `${CLAUDE_PLUGIN_ROOT}/docs/workflow-artifacts.md` (the `spec.md` contract and its exact headings) are the authority; read both first.

Write the spec without asking the user anything: no interview, no seam confirmation, no approval step before writing. The user reviews the written artifact; when they disagree with an AC or a seam, revise the spec and increment `revision`.

## Process

1. **Validate the source.** Eligible: `decisions.md` with `status: validated` and `handoff: ready-for-spec`; an architecture candidate with `readiness: ready-for-spec` (`validated` alone is not enough); or a conversation that settled every implementation-changing decision. Record `source` and `source_revision`. If the source is not eligible, write nothing and say which gate failed.
2. **Read the context.** The domain docs and conventions `flow explain <path>` lists, ADRs in the area, and the current code. Use the glossary's terms. Reference `DEC-###` IDs instead of restating or reopening their rationale.
3. **Choose the verification seams yourself.** Prefer existing seams, as few and as high as possible (ideally one), and name the prior-art tests to follow. Every acceptance criterion needs a feasible seam.
4. **Write `.scratch/<feature>/spec.md`** with the contract's headings. Describe the problem and desired behaviour from the user's perspective; give each observable outcome a stable `AC-###`. Leave file paths and code snippets out: they go stale. The exception is a prototype snippet that encodes a decision more precisely than prose (state machine, reducer, schema, type shape); inline the decision-rich part and say it came from a prototype.
5. **Set readiness honestly.** A gap that can change behaviour, scope, a contract, a state transition or verification goes under `Open decisions` and makes the spec `blocked`. A non-blocking gap is an assumption under `Constraints`. Use `ready` only when `Open decisions` reads `None` and every AC has a seam.
6. **Validate.** Emit the `artifact.transitioned` event and run `artifact check` as the workflow profile describes.

## HTML review page

The user reviews the spec through an HTML page, because Markdown is easy to skim past. After every write of `spec.md`, rebuild `.scratch/<feature>/plan.src.html` from it with the `flow:html-plan` skill, following its page format with these overrides:

- `spec.md` is the source of truth and the page is a view of it. The page never states a behaviour, decision or criterion the spec lacks.
- Each claim names the `AC-###` it proves and the `DEC-###` behind it in a `<doc-note tone="ok">` (`AC-001 · DEC-003`); every AC appears on some claim. An entry under `Open decisions` becomes a `<doc-ask>` with your recommendation checked, so "to answer" counts only real open decisions.
- Pack it with `-o plan.html --root <owning unit root>` (one `--root` per target unit). The user opens `.scratch/<feature>/plan.html`; never hand over the unpacked source, which renders without styles or controls. Keep it a local file: it embeds source code, so publish it as an artifact only when the user asks.
- Do not wait for a Respond. When the user pastes one, treat it as review feedback under html-plan's data rules: revise `spec.md` first, increment its `revision`, then rebuild the page.

## Finish

Report the spec path, its status, the seams and assumptions you chose, and the `plan.html` path. Name the next command: `/flow:to-tickets .scratch/<feature>/spec.md`, or `/flow:implement .scratch/<feature>/spec.md` when the whole feature is one coherent slice. This stage writes no tickets and no code, and publishes nothing to the issue tracker.
