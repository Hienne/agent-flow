---
name: why
description: Find out why code is shaped the way it is from its git history, pull requests, decisions and ADRs, and report each claim at its evidence tier. Use for "why does X work this way", "why did we pick Y", or before changing code whose reason is unclear.
---

# Why

Code shows what it does, never why it exists. The why lives in commit messages, pull request discussion, `decisions.md`, ADRs, `CONTEXT.md` and tickets, and every one of them is incomplete. The job is an honest read: what the record says, what it suggests, and what it does not say. An answer that sounds confident on thin evidence is the failure this skill exists to prevent, because the user will act on it.

## Evidence tiers

Every claim sits in one tier, and the tier sets where it goes in the report and how it is phrased.

| Tier | When | Phrasing |
| --- | --- | --- |
| **Direct** | An author wrote the reason down: a commit message, a PR body or review comment, a `DEC-###`, an ADR, a code comment, a ticket. | Plain and cited: "X exists because Y (`a1b2c3d`)." |
| **Supported** | Several indirect items point the same way, none states it. | "The evidence points to X:" and each item. |
| **Inferred** | Your reading of the context; nothing in the record states it. | Hedged, with the chain: "Given A and B, X seems likely." |
| **Speculative** | Plausible, but other stories fit the evidence as well. | Listed as one competing explanation. |
| **Unknown** | You searched and found nothing. | The searches, named: "Searched X for Y; nothing." |

The code is evidence of mechanics, not motive: what the code does, or its style, never counts as evidence for why the author wrote it. "Because", "was designed to" and "the team decided" belong only next to a Direct or Supported citation.

A hypothesis inside the question ("I assume it's for performance?") is one candidate: check it like any other and say whether the record supports it. When two sources disagree, report both with their citations and leave the call to the user.

## Steps

1. **Pin the target and the question.** When the target is vague, state your reading in one line and go on; the user can redirect.
2. **Build the anchor** from source control, the one source that is always there. Run each git command with `git -C <workspace root>`; in an umbrella layout every workspace is its own repository.
   - `git log --follow --oneline -- <file>` for the history through renames, `git blame -L <start>,<end> <file>` for the last touch of each line.
   - `git log -S '<literal>' -- <file>` to find the commit that introduced a constant, a guard or a magic number.
   - `git show <commit>` for each substantive commit, and `gh pr view <number> --json title,body,comments,reviews` for each PR number in a subject line, when `gh` is available.
3. **Read the project's own record.** Search `decisions.md` under `<artifacts>/` (`.scratch/` unless `.flow/config.json` sets `artifactsDir`) for the symbol and path, the ADRs and domain docs `flow explain <path>` lists, tests whose names encode the edge case, and `TODO`/`FIXME` comments near the target.
4. **Tickets** only read-only, and only the IDs the anchor names. Chat, logs, monitoring and analytics data are outside what the user pointed at: ask before searching them (`P-ask-before-out-of-scope-data`), and otherwise list them as not searched.
5. **Place every claim in a tier**, then check it: each Direct and Supported claim has its citation beside it, no claim reads intent from the code, and every gap names its searches.
   Done when: every claim has a tier, and every source is listed as searched (with what) or not searched (with why).

Work in this context. Splitting the search across subagents is a multi-agent run: explain its cost and get the user's yes first, as the flow core rules require.

## Report

- **Question** and **Code**: the question in a sentence; the paths, line ranges and symbols.
- **Found**: the Direct and Supported claims, each with its citation.
- **Inferred**: hedged claims with their chain. Leave out when empty.
- **Competing explanations**: each with the evidence for it and what is missing. Leave out when the record gives one answer.
- **Unknown**: each open question with what was searched, and who would know (the author `git blame` names).
- **Sources**: one line per source (git history, pull requests, decisions and ADRs, tickets, anything else): what was searched, or why it was not.
- **Constraints for the change**, only when the question comes before a change: **Preserve**, **Change**, **Avoid**, **Risk**, each line citing the finding it rests on. Hand them to the step that plans the change: the questions of `/flow:grill-with-docs`, or the behaviour fence of `/flow:implement`.
