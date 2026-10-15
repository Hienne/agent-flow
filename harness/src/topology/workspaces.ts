import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { loadConfig } from '../config/config.js';
import { IGNORED_DIRECTORIES, ROOT, existingDirectory, isWithin, logicalRelativePath, normalizePath } from '../shared/paths.js';
import type { Project, Workspace } from '../shared/types.js';
import { unitAdapter, type UnitAdapter } from '../units/adapter.js';

interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
}

export function parseJsonObject(path: string, label: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Invalid ${label} ${normalizePath(path)}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label} ${normalizePath(path)}: expected an object`);
  return value as Record<string, unknown>;
}

// The first configured adapter that recognises the directory owns it as a unit workspace.
function detectAdapter(directory: string): UnitAdapter | null {
  return loadConfig().units.adapters.map(unitAdapter).find((adapter) => adapter.detect(directory)) ?? null;
}

export function loadWorkspace(root: string, adapter = detectAdapter(root)): Workspace {
  if (!adapter) throw new Error(`No configured unit adapter recognises ${normalizePath(root)}`);
  // Maven and Gradle workspaces have no package.json.
  const path = join(root, 'package.json');
  const packageJson = (existsSync(path) ? parseJsonObject(path, 'workspace package.json') : {}) as PackageJson;
  if (packageJson.name !== undefined && typeof packageJson.name !== 'string') throw new Error(`Invalid workspace package.json ${normalizePath(path)}: name must be a string`);
  if (packageJson.scripts !== undefined && (!packageJson.scripts || typeof packageJson.scripts !== 'object' || Array.isArray(packageJson.scripts)
      || !Object.values(packageJson.scripts).every((script) => typeof script === 'string'))) {
    throw new Error(`Invalid workspace package.json ${normalizePath(path)}: scripts must map names to strings`);
  }
  return {
    name: packageJson.name ?? basename(root),
    root,
    relativeRoot: logicalRelativePath(relative(ROOT, root)) || '.',
    adapter: adapter.name,
    scripts: packageJson.scripts ?? {},
  };
}

// A physical root (the user's checkout or a task worktree) as a workspace, or null when no adapter recognises it.
export function workspaceAt(root: string): Workspace | null {
  if (!existsSync(root)) return null;
  const adapter = detectAdapter(root);
  return adapter ? loadWorkspace(root, adapter) : null;
}

// layout "single": the project root is the one unit workspace. layout "umbrella": the root only groups nested workspaces.
export function discoverWorkspaces(root = ROOT): Workspace[] {
  if (loadConfig().layout === 'single') {
    const adapter = detectAdapter(root);
    return adapter ? [loadWorkspace(root, adapter)] : [];
  }
  const found: Workspace[] = [];
  const visit = (directory: string): void => {
    const adapter = directory === root ? null : detectAdapter(directory);
    if (adapter) {
      found.push(loadWorkspace(directory, adapter));
      return;
    }
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || IGNORED_DIRECTORIES.has(entry.name)) continue;
      visit(join(directory, entry.name));
    }
  };
  visit(root);
  return found.sort((left, right) => left.relativeRoot.localeCompare(right.relativeRoot));
}

export function findWorkspace(input: string): Workspace | null {
  let current = existingDirectory(input);
  if (!current) return null;
  const umbrella = loadConfig().layout === 'umbrella';
  // The outermost recognised ancestor wins: a Maven module or Gradle subproject has its own build file but belongs to
  // the workspace above it.
  let found: { root: string; adapter: UnitAdapter } | null = null;
  while (isWithin(ROOT, current)) {
    if (current === ROOT && umbrella) break;
    const adapter = detectAdapter(current);
    if (adapter) found = { root: current, adapter };
    if (current === ROOT) break;
    current = dirname(current);
  }
  return found ? loadWorkspace(found.root, found.adapter) : null;
}

export function loadProjects(workspace: Pick<Workspace, 'root' | 'adapter'>): Project[] {
  return unitAdapter(workspace.adapter).loadUnits(workspace);
}

export function resolveProject(input: string, projects: Project[]): Project | null {
  const target = resolve(input);
  return projects
    .filter((project) => isWithin(project.root, target))
    .sort((left, right) => right.root.length - left.root.length)[0] ?? null;
}

export function findProject(name: string): { workspace: Workspace; project: Project } | null {
  const matches: Array<{ workspace: Workspace; project: Project }> = [];
  for (const workspace of discoverWorkspaces()) {
    for (const project of loadProjects(workspace)) {
      if (project.name === name) matches.push({ workspace, project });
    }
  }
  return matches.length === 1 ? matches[0] ?? null : null;
}
