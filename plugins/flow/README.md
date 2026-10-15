# flow

Core workflow plugin: the `flow` task harness (`dist/flow.mjs`, on `PATH` as `flow` through `bin/`), its Claude Code hooks, the review gate, and the review agents and skills.

## Setup

Add the marketplace and install the plugins in Claude Code (the same on macOS, Linux and Windows; needs Node 18.19 or later on `PATH`):

```
/plugin marketplace add Hienne/agent-flow
/plugin install flow@agentflow
/plugin install flow-ui@agentflow
```

Then run `flow init` at the project root. It detects the layout (`single`: the root is one workspace; `umbrella`: the root groups nested workspaces) and the unit adapters, writes `.flow/config.json` (an existing one is kept), and merges `.claude/settings.json`: the marketplace source (as Claude Code registered it, `github` or local `directory`) and `enabledPlugins` for `flow`, `flow-ui` and each `--stack <name>` (`stack-<name>`). Other settings keys stay as they are; the changes are printed as `+`/`~` lines, and `--dry-run` prints them without writing. It warns when the project already has hooks on the events flow handles, or agents named like flow's.

The marketplace is the checkout the running `flow` comes from, else a marketplace registered in Claude Code (`known_marketplaces.json`) that offers `flow`; `--marketplace <dir>` overrides both with a local directory.

## Releasing

Claude Code updates an installed plugin only when its `version` changes. Bump `version` in the plugin's `.claude-plugin/plugin.json` and in its `.claude-plugin/marketplace.json` entry, run `npm run build`, and commit the rebuilt `dist/`; CI fails when the bundles or the two versions disagree.

`flow init --shim` writes a user-level `flow` launcher (`flow`, `flow.cmd`, `flow.mjs`) to `~/.local/bin`, for a terminal outside Claude Code, where the plugin's `bin/` is not on `PATH` (for example to run `flow review waive`). The launcher reads `~/.claude/plugins/installed_plugins.json` at each run and picks the project install that contains the cwd, else the user install, so plugin updates need no new shim.

## Hooks

Every hook in `hooks/hooks.json` runs `flow hook`, which reads the Claude Code payload on stdin:

| Event | What `flow hook` does |
|---|---|
| SessionStart | Adds `context/core-rules.md` to the session, unless `hooks.disabled` contains `session-context`. |
| PreToolUse | Policy: blocks `git push`, the `.flow/config.json` `policy` rules, and edits outside the active task scope. |
| PostToolUse, PostToolUseFailure | Policy follow-up (reminders after edits and failed commands). |
| PreCompact | Reminds the session where the task state lives on disk. |
| Stop | Review gate: blocks the end of a turn while `flow verify` reports REVIEW REQUIRED and evidence is missing. |
| SubagentStart, SubagentStop (`flow:code-reviewer`, `flow:code-simplifier`) | Records review evidence from the agent's last `FLOW-REVIEW-RESULT` line. |

`flow hook` prints nothing in a project without `.flow/config.json`.

## Review gate

`flow verify --task <feature>` exits 3 with `REVIEW REQUIRED` when the task's code change crosses the thresholds in `.flow/config.json`:

```json
{ "review": { "broad": [100, 5], "deep": 300 }, "codeFiles": [".java"] }
```

- `broad: [lines, files]`: more than `lines` code lines across more than `files` code files.
- `deep`: more than `deep` code lines in any number of files.
- `codeFiles` replaces the unit adapter's code extensions when set.

The defaults are the values shown for `review`, and the adapter's extensions for `codeFiles`. In Claude Code, spawn `flow:code-reviewer` and `flow:code-simplifier` in one message with the task slug; their SubagentStop hook records the evidence, then rerun `flow verify --task <feature>`.

## Impact

`flow impact --task <feature>`, or `flow impact [--files <path>]... [<path|unit>...]`, lists what consumes the changed units. `flow verify --task <feature> --plan` prints the same as `WARNING impact` lines; the plan itself does not change.

| Adapter | Dependents |
| --- | --- |
| `nx` | Projects that depend on the unit, transitively, from the cached project graph (`.nx/cache/project-graph.json`; flow never runs nx, and says so when the cache is missing). In an `umbrella`, also every other workspace whose `package.json` declares the unit's package, with the spec it uses (`file:` links included). |
| `maven` | Modules of the reactor whose `<dependency>` entries reach the unit, transitively. |
| `gradle`, `npm` | `unavailable`: `flow impact` says so, and `verify --plan` stays silent. |

## Agents

| Agent | Model | Purpose |
|---|---|---|
| `flow:code-reviewer` | opus | Formal review, Standards and Spec axes (`flow:code-review`). |
| `flow:code-simplifier` | sonnet | Behaviour-preserving simplification, report mode (`flow:code-simplification`). |
| `flow:feature-reviewer` | opus | Whole-feature review once every ticket is `done`. |

### Models are fixed

Claude Code does not substitute `${user_config.*}` in an agent's `model` frontmatter (checked in the plugin spike), so the plugin declares no `review_model` or `simplify_model` option: each agent runs on the model in the table. To run one on another model, edit its `model:` line in the installed copy of `agents/<name>.md`, and expect a plugin update to overwrite that edit.
