import { existsSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

export const CONFIG_FILE = join('.flow', 'config.json');
export const WORKTREES_DIRECTORY = '.worktrees';

// The project root is the nearest ancestor holding .flow/config.json, searched from CLAUDE_PROJECT_DIR and then cwd.
// ROOT, ARTIFACTS_ROOT and SCRATCH_ROOT are live bindings: useRoot() rebinds them (startup, tests).
export function discoverRoot(starts = [process.env.CLAUDE_PROJECT_DIR, process.cwd()]): string | null {
  for (const start of starts) {
    if (!start) continue;
    let current = resolve(start);
    for (;;) {
      if (existsSync(join(current, CONFIG_FILE))) return current;
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return null;
}

export let ROOT = resolve(process.cwd());
export let ARTIFACTS_ROOT = join(ROOT, '.scratch');
export let SCRATCH_ROOT = join(ARTIFACTS_ROOT, '.flow');

export function useRoot(root: string, artifactsDir = '.scratch'): void {
  ROOT = resolve(root);
  ARTIFACTS_ROOT = resolve(ROOT, artifactsDir);
  SCRATCH_ROOT = join(ARTIFACTS_ROOT, '.flow');
}

export const IGNORED_DIRECTORIES = new Set([
  '.git', '.flow', '.nx', '.angular', '.scratch', WORKTREES_DIRECTORY, 'node_modules', 'dist', 'build', 'coverage', 'tmp', 'temp',
]);

export function normalizePath(path: string): string {
  return path.replaceAll('\\', '/');
}

// A task worktree mirrors the umbrella layout under .worktrees/<feature>/, so stripping that prefix yields the logical path.
export function logicalRelativePath(relativePath: string): string {
  return normalizePath(relativePath).replace(/^\.worktrees\/[^/]+(?:\/|$)/, '');
}

export function relativeToRoot(path: string): string {
  return normalizePath(relative(ROOT, path));
}

export function resolveInput(path = '.'): string {
  return isAbsolute(path) ? resolve(path) : resolve(process.cwd(), path);
}

export function nearestExistingPath(path: string): string | null {
  let current = resolve(path);
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return current;
}

export function isWithin(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

export function existingDirectory(path: string): string | null {
  const existing = nearestExistingPath(path);
  if (!existing) return null;
  return statSync(existing).isDirectory() ? existing : dirname(existing);
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}
