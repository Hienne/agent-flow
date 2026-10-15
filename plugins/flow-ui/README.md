# flow-ui

Interface mods for the `flow` plugin. They need the Claude Code mod engine (desktop app or a terminal session that
loads mods) and read the state `flow` writes; they never write it.

| Part | What it does |
| --- | --- |
| Task band | A line above the prompt with the unfinished flow task this session drives: feature, phase, verify `passed/planned` (failures in red), review `n/2`, branch. Reads `<artifactsDir>/.flow/sessions/<session>.json` and each bound `task.json`; refreshes every 5 s and right after a `flow task/verify/review/inspect` command. |
| `/frontier` | A pane listing the ready tickets of every feature under `<artifactsDir>/`, from `flow artifact frontier --json`, each with a button that copies `/flow:implement <ticket>`. A feature whose artifacts fail validation shows as locked with its first error. |
| Reviewer gate | `flow:feature-reviewer` may be spawned only after a prompt containing `--reviewer`, once per such prompt. |
| Advisor gate | `flow:solution-advisor` may be spawned only after a prompt containing `--advisor`, at most twice per ticket (`flow task start` resets the count). When the same check (`flow verify`, `tsc`, `jest`, `vitest`, `nx test/build/lint/...`) still fails after two edits, it tells the agent to consult the advisor, or, without the flag, shows a toast. |

The project is the nearest folder above the session root holding `.flow/config.json`. The CLI the pane runs is the
sibling plugin `../flow/dist/flow.mjs` in a local directory marketplace; when the marketplace is installed from git,
it is flow's copy under `~/.claude/plugins/cache/<marketplace>/flow/<version>`, read from `installed_plugins.json`.

## Development

```bash
claude plugin validate --strict plugins/flow-ui
```

```bash
claude plugin test plugins/flow-ui
```

`hooks/hooks.json` names one module, and the engine follows `$` only within one file and allows one hook without a
matcher per event, so `register.ts` composes two files: `views.tsx` (task band and `/frontier`, sharing
`session.start`) and `gates.ts` (both gates, sharing `prompt.submit`).
