import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { loadConfig } from '../config/config.js';
import { readJson } from '../shared/filesystem.js';
import type { ChangeGroup, Project, VerificationPlan, Workspace } from '../shared/types.js';
import type { UnitAdapter } from './adapter.js';
import { unavailable } from './dependents.js';
import { commandStep } from './step.js';

const LOCKFILES: Array<[string, string]> = [['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'], ['bun.lock', 'bun'], ['bun.lockb', 'bun'], ['package-lock.json', 'npm']];

// .flow/config.json units.packageManager, then package.json packageManager ("pnpm@9.1.0"), then the lockfile, then npm.
export function packageManager(root: string): string {
  const configured = loadConfig().units.packageManager;
  if (configured) return configured;
  const declared = readJson<{ packageManager?: unknown }>(join(root, 'package.json'), {}).packageManager;
  if (typeof declared === 'string' && declared) return declared.split('@')[0]!;
  return LOCKFILES.find(([file]) => existsSync(join(root, file)))?.[1] ?? 'npm';
}

// The package is the one unit; its targets are the scripts package.json declares.
function loadUnits(workspace: Pick<Workspace, 'root'>): Project[] {
  const { name, scripts = {} } = readJson<{ name?: string; scripts?: Record<string, string> }>(join(workspace.root, 'package.json'), {});
  return [{
    name: name ?? basename(workspace.root),
    root: workspace.root,
    relativeRoot: '.',
    sourceRoot: null,
    projectType: null,
    targets: Object.fromEntries(Object.keys(scripts).map((script) => [script, {}])),
    configPath: join(workspace.root, 'package.json'),
  }];
}

function steps(workspace: Workspace, targets: string[], changes: ChangeGroup['changes']) {
  const manager = packageManager(workspace.root);
  const buildFiles = [join(workspace.root, 'package.json'), ...LOCKFILES.map(([file]) => join(workspace.root, file))];
  return targets.filter((target) => workspace.scripts[target] !== undefined)
    .map((target) => commandStep(workspace, workspace.name, target, [manager, 'run', target], changes, buildFiles));
}

function verifyPlan(group: ChangeGroup, targets: string[]): Omit<VerificationPlan, 'schemaVersion'> {
  return { affectedProjects: [{ workspace: group.workspace.relativeRoot, project: group.workspace.name }], steps: steps(group.workspace, targets, group.changes) };
}

export const npmAdapter: UnitAdapter = {
  name: 'npm',
  codeFiles: ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.html', '.scss', '.css', '.json', '.jsonc', '.yaml', '.yml'],
  detect: (directory) => existsSync(join(directory, 'package.json')),
  loadUnits,
  verifyPlan,
  unitPlan: (workspace, _unit, targets) => steps(workspace, targets, []),
  dependents: () => unavailable('an npm package is one unit; the packages that use it live outside the project'),
};
