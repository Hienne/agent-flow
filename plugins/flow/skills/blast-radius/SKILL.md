---
name: blast-radius
description: Find what a change can break outside its diff, and prove the one fact its safety rests on by running real code. Use for "what could this break", "blast radius of X", a small diff you don't trust, and the Merge Danger section of the /flow:implement report.
---

# Blast radius

Name the breakage a symbol search won't show, and prove the **safety fact**: the one fact that, if true, rules out most of the risky cases at once (for example, "the new guard runs only when the form is in create mode"). A blast-radius write-up reads as convincing whether or not it is true, so every claim carries its evidence level and the safety fact is run, not argued.

## Evidence levels

Take each fact as far down this ladder as is cheap, and say where it stopped.

| Level | Means |
| --- | --- |
| `claimed` | Stated, nothing behind it. |
| `cited` | A real `file:line`, in the project or in the library's source at the pinned version. |
| `walked` | The failure path traced step by step to the point where it cannot happen. |
| `ran` | A test or script that calls the real code and fails if the fact is wrong; its output is pasted. |
| `reproduced` | Seen in the running app: the real screen, an endpoint call, `mf-smoke`. |

The safety fact needs `ran` or `reproduced`. Below that, report it as **unproven** and say what blocked the proof.

## Steps

1. **Pin the change.** In a flow task, diff each workspace from its start commit (`baseline.workspaceHeads` in `<artifacts>/<feature>/task.json`): `git -C <workspace root> diff -M <commit>`, plus untracked files. Otherwise diff the fixed point the user names. List the symbols added, changed and removed, and the behaviour that changed without a hunk of its own: a default, an order, a timing, an error path.
   Done when: every changed symbol and behaviour is listed.
2. **Take the consumer list from the harness.** `flow impact --task <feature>` (or `flow impact --files <path>...`) lists the units and workspaces that consume the changed units. It says `unavailable` for gradle and npm units; search for their consumers yourself and say so. This is the part a search already answers, so keep it to a line in the report.
3. **Find the safety fact.** Ask which single fact, if it holds, clears the most risky cases. Spend the effort here rather than on a long list of maybes.
4. **Look where the search stops.**
   - Wire and storage shapes: JSON and DTO fields, database columns and migrations, message payloads, files another program reads.
   - Configuration: config keys, environment variables, feature flags, defaults that changed.
   - Runtime order: lifecycle and teardown, async and microtask timing, transaction boundaries, retries.
   - Library behaviour at the pinned version: read its source in the installed dependency, and check for local patches.
   - Consumers outside the workspace: other workspaces of an umbrella, published packages, federated remotes, another language reading the same bytes.

   A stack plugin's skill can add its own places; read it when its stack is in the change.
5. **Judge each risk**: how it breaks, the `file:line`, how likely, how costly, and its evidence level. Keep the confirmed risks. Move what you checked and found safe to **Cleared**, with the reason. A search that finds nothing is an answer: name the search. A caller or API you have not seen in the code does not go in the report.
6. **Prove the safety fact.** Write the smallest script or test that calls the real code (the same library and version the app ships), run it, and paste the command and output. Keep a throwaway script under `<artifacts>/<feature>/blast-radius/`, not in the source tree; a test worth keeping goes to the user as a proposed test, since adding it changes a reviewed diff.
   Done when: the safety fact is `ran` or `reproduced` with its output, or marked unproven with what blocked it.

## Report

- **Change**: what changed, including the part the diff does not spell out.
- **Consumers**: the `flow impact` line, or what you searched when it was unavailable.
- **Safety fact**: the statement, its level, and the proof (command and output), or `unproven: <what blocked it>`.
- **Risks**: one entry each: how it breaks, `file:line`, likelihood and cost, level, how to check.
- **Cleared**: each risk checked and found safe, with the reason and level.
- **Before merge**: the cheapest check that catches the real risk, with the path of the script you wrote.
