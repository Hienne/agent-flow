---
name: angular-mf
description: Angular 16, Nx and Module Federation conventions, and the mf-smoke command that proves a remote renders inside its shell. Use when writing, reviewing or verifying code in an Nx workspace that serves or consumes federated remotes, including inside /flow:code-review and the flow:code-reviewer agent; the project's own written conventions outrank this checklist.
---

# Angular, Nx and Module Federation

## Project conventions first

Read the conventions the project lists (`context.conventions` in `.flow/config.json`, shown by `flow explain <path>`) before creating or editing UI. A written convention outranks this checklist and outranks neighbouring code; when they disagree, follow the convention or ask the developer.

## Federation rules

- Every federated workspace uses identical Angular, Nx, NgRx and i18n library versions. Change them only as one coordinated upgrade across the shell and all remotes; a version bump in one workspace is a review finding.
- A remote exposes `./Routes`; the shell loads it with `loadRemoteModule('<remote>', './Routes')` under a route path and maps the remote in `src/assets/module-federation.manifest.json`.
- Shared singletons (router, store, auth, i18n) come from the shell. A remote does not provide a second root instance.
- Remote production builds keep component inline styles as plain CSS: nested selectors stay unflattened there, while the local dev server compiles them as SCSS. Write flat CSS in inline `styles`, or use a `.scss` file.

## Nx commands

- Run `npm`, `npx` and `nx` with the workspace root (the folder holding `package.json` and `nx.json`) as the working directory, for example `cd <workspace> && npx nx test <project>`.
- Prefer the narrowest target for feedback (`nx test <project> --testFile=...`); `flow verify` runs the full plan once.

## Proving a remote in its shell: mf-smoke

`mf-smoke` is on `PATH` while this plugin is enabled. It serves the remote (or reuses a process already on its port), points the shell manifest at that remote for the duration of the run, serves the shell, opens the route in a headless Chrome or Edge and records proof, then restores the manifest.

```bash
mf-smoke <remote-project> --host <shell-workspace> [--host-project <project>] [--route <path>] [--manifest-key <key>] [--dry-run] [--json]
```

- `--host` is required: there is no default shell. The host project defaults to the only project of that workspace with `src/assets/module-federation.manifest.json`.
- Start with `--dry-run` to see the planned ports, manifest override and URL without starting anything.
- Evidence goes to `<artifactsDir>/.flow/smoke/<stamp>-<remote>/` (logs, screenshot). Set `MF_SMOKE_BROWSER` when Chrome or Edge is not in a standard location; without a browser the result is `partial`, never `passed`.
- If a run was killed before it restored the manifest, list journals with `mf-smoke transactions` and restore with `mf-smoke recover <id> --host <shell-workspace>`. Recovery only ever writes the manifest of the host you name.
- Report a failed or partial smoke as such; do not count it as verified.
