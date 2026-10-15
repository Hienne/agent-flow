#!/usr/bin/env node
// User-level `flow` launcher installed by `flow init --shim`. It finds the installed flow plugin in
// ~/.claude/plugins/installed_plugins.json at each run, so plugin updates need no reinstall.
// Project installs whose project contains the cwd win (deepest first), then user installs, newest first.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';

const fold = (path) => (process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path));
const cwd = fold(process.cwd());
const contains = (project) => cwd === fold(project) || cwd.startsWith(fold(project) + sep);

let installs = [];
try {
  const plugins = JSON.parse(readFileSync(join(homedir(), '.claude', 'plugins', 'installed_plugins.json'), 'utf8')).plugins ?? {};
  installs = Object.entries(plugins).filter(([key]) => key.startsWith('flow@')).flatMap(([, entries]) => entries);
} catch {
  // No registry: reported below.
}
const rank = (entry) => (entry.scope === 'project' ? (contains(entry.projectPath ?? '') ? fold(entry.projectPath).length : -1) : 0);
const install = installs
  .filter((entry) => entry.installPath && rank(entry) >= 0)
  .sort((left, right) => rank(right) - rank(left) || String(right.lastUpdated).localeCompare(String(left.lastUpdated)))[0];
if (!install) {
  process.stderr.write('flow: no installed flow plugin covers this directory (see ~/.claude/plugins/installed_plugins.json)\n');
  process.exit(1);
}
const result = spawnSync(process.execPath, [join(install.installPath, 'dist', 'flow.mjs'), ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(result.status ?? 1);
