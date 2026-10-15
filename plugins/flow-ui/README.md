# flow-ui

Interface mods for the `flow` plugin. They need the Claude Code mod engine (desktop app or a terminal session that
loads mods) and read the state `flow` writes; they never write it.

| Part | What it does |
| --- | --- |
| Task band | A line above the prompt with the unfinished flow task this session drives: feature, phase, verify `passed/planned` (failures in red), review `n/2`, branch. Reads `<artifactsDir>/.flow/sessions/<session>.json` and each bound `task.json`; refreshes every 5 s and right after a `flow task/verify/review/inspect` command. |
| Reviewer gate | `flow:feature-reviewer` may be spawned only after a prompt containing `--reviewer`, once per such prompt. |

The project is the nearest folder above the session root holding `.flow/config.json`.

## Development

```bash
claude plugin validate --strict plugins/flow-ui
```

```bash
claude plugin test plugins/flow-ui
```

`hooks/hooks.json` names one module, and the engine follows `$` only within one file and allows one hook without a
matcher per event, so `register.ts` composes two files: `views.tsx` (task band) and `gates.ts` (the reviewer gate).
