# stack-hdt-angular

Angular 16, Nx and Module Federation conventions for `flow`, and `mf-smoke`, which proves a federated remote renders
inside its shell.

| Part | What it does |
| --- | --- |
| Skill `angular-mf` | Federation rules (identical framework versions, `./Routes`, shell-owned singletons, flat inline CSS), Nx commands at the workspace root, and how to run `mf-smoke`. |
| `bin/mf-smoke` | On `PATH` while the plugin is enabled. `mf-smoke <remote> --host <workspace>` serves remote and shell, overrides the shell manifest for the run, captures the route in headless Chrome or Edge and restores the manifest. `--host` is required. |

The project must be initialised with `flow init` (umbrella or single layout, `nx` adapter). Ports come from each
project's `serve` target (`options.port`, else `configurations.development.port`).

## Development

The bundle is built from `harness/packs/hdt-angular/` by `node harness/build.mjs`.

```bash
claude plugin validate --strict plugins/stack-hdt-angular
```
