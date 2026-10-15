import { existsSync, lstatSync, readdirSync, rmdirSync, symlinkSync, unlinkSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { removePath } from '../shared/filesystem.js';
import { ROOT, WORKTREES_DIRECTORY, isWithin, normalizePath } from '../shared/paths.js';
import { run } from '../shared/process.js';
import type { IsolatedRepository, TaskIsolation, TaskManifest } from '../shared/types.js';

export interface IsolationRemoval {
  removed: string[];
  deletedBranches: string[];
  keptBranches: string[];
}

export function isolationBranch(feature: string): string {
  return `agent/${feature}`;
}

export function activeIsolation(manifest: Pick<TaskManifest, 'isolation'>): TaskIsolation | null {
  return manifest.isolation && !manifest.isolation.removedAt ? manifest.isolation : null;
}

export function physicalWorkspaceRoot(manifest: Pick<TaskManifest, 'isolation'>, workspace: string): string {
  return resolve(ROOT, activeIsolation(manifest)?.root ?? '', workspace);
}

export function worktreePath(isolation: TaskIsolation, workspace: string): string {
  return resolve(ROOT, isolation.root, workspace);
}

export function dependencyLinkShared(path: string): boolean {
  let current = resolve(path);
  const worktrees = resolve(ROOT, WORKTREES_DIRECTORY);
  while (isWithin(worktrees, current) && current !== worktrees) {
    if (lstatSync(join(current, 'node_modules'), { throwIfNoEntry: false })?.isSymbolicLink()) return true;
    current = resolve(current, '..');
  }
  return false;
}

function git(cwd: string, args: string[]) {
  // Worktrees sit two levels deeper than the user checkout, so Nx/coverage caches exceed MAX_PATH without long paths.
  return run('git', ['-c', 'core.longpaths=true', ...args], { cwd });
}

function gitOutput(cwd: string, args: string[], failure: string): string {
  const result = git(cwd, args);
  if (result.code !== 0) throw new Error(`${failure}: ${(result.stderr || result.stdout).trim()}`);
  return result.stdout.trim();
}

function samePath(left: string, right: string): boolean {
  return resolve(left).toLowerCase() === resolve(right).toLowerCase();
}

function branchExists(repository: string, branch: string): boolean {
  return git(repository, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]).code === 0;
}

// git worktree remove deletes ignored files too; the junction must go first or it would recurse into the user's node_modules.
function unlinkDependencyJunction(worktree: string): void {
  const link = join(worktree, 'node_modules');
  if (!lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink()) return;
  unlinkSync(link);
  if (lstatSync(link, { throwIfNoEntry: false })) throw new Error(`Cannot unlink the shared node_modules junction at ${normalizePath(link)}`);
}

function containsFiles(directory: string): boolean {
  if (!existsSync(directory)) return false;
  return readdirSync(directory, { withFileTypes: true }).some((entry) => !entry.isDirectory() || containsFiles(join(directory, entry.name)));
}

function pruneEmptyDirectories(directory: string): void {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) pruneEmptyDirectories(join(directory, entry.name));
  }
  if (!readdirSync(directory).length) rmdirSync(directory);
}

function removeRepositories(root: string, branch: string, repositories: IsolatedRepository[], force: boolean): IsolationRemoval {
  const removal: IsolationRemoval = { removed: [], deletedBranches: [], keptBranches: [] };
  for (const repository of repositories) {
    const source = resolve(ROOT, repository.workspace);
    const worktree = resolve(ROOT, root, repository.workspace);
    if (existsSync(worktree)) {
      unlinkDependencyJunction(worktree);
      const removed = existsSync(join(worktree, '.git')) ? git(source, ['worktree', 'remove', ...(force ? ['--force'] : []), worktree]) : null;
      const message = removed ? (removed.stderr || removed.stdout).trim() : '';
      // git refuses before deleting anything; a failure while deleting (Windows locks, long paths) leaves a partial tree that is safe to finish.
      const deletionFailed = !removed || /failed to delete|Filename too long|Permission denied|Directory not empty/i.test(message);
      if (removed && removed.code !== 0 && containsFiles(worktree) && !deletionFailed) {
        throw new Error(`Cannot remove the ${repository.workspace} worktree: ${message}`);
      }
      if (!removed || removed.code !== 0) removePath(worktree);
      if (existsSync(worktree)) throw new Error(`Cannot remove the ${repository.workspace} worktree: ${normalizePath(worktree)} is still locked; close editors or dev servers using it and retry`);
    }
    gitOutput(source, ['worktree', 'prune'], `Cannot prune the ${repository.workspace} worktree metadata`);
    removal.removed.push(repository.workspace);
    if (!branchExists(source, branch)) continue;
    if (git(source, ['branch', force ? '-D' : '-d', branch]).code === 0) removal.deletedBranches.push(repository.workspace);
    else removal.keptBranches.push(repository.workspace);
  }
  pruneEmptyDirectories(resolve(ROOT, root));
  return removal;
}

export function createIsolation(feature: string, workspaces: string[], existing: TaskIsolation | null = null): { isolation: TaskIsolation; warnings: string[] } {
  const branch = existing?.branch ?? isolationBranch(feature);
  const root = existing?.root ?? `${WORKTREES_DIRECTORY}/${feature}`;
  const known = new Set(existing?.repositories.map((repository) => repository.workspace) ?? []);
  const created: IsolatedRepository[] = [];
  const warnings: string[] = [];
  try {
    for (const workspace of [...new Set(workspaces)].filter((candidate) => !known.has(candidate))) {
      const source = resolve(ROOT, workspace);
      const top = git(source, ['rev-parse', '--show-toplevel']);
      if (top.code !== 0 || !samePath(top.stdout.trim(), source)) {
        throw new Error(`${workspace} is not the root of its own git repository; start the task with --no-isolate`);
      }
      const baseHead = gitOutput(source, ['rev-parse', 'HEAD'], `Cannot resolve HEAD in ${workspace}`);
      const abbreviated = gitOutput(source, ['rev-parse', '--abbrev-ref', 'HEAD'], `Cannot resolve the current branch in ${workspace}`);
      if (branchExists(source, branch)) throw new Error(`Branch ${branch} already exists in ${workspace}; run task cleanup ${feature} or choose another feature name`);
      const worktree = resolve(ROOT, root, workspace);
      if (existsSync(worktree)) throw new Error(`Worktree path already exists: ${normalizePath(relative(ROOT, worktree))}`);
      gitOutput(source, ['worktree', 'add', '-b', branch, worktree, baseHead], `Cannot create the ${workspace} worktree`);
      const repository: IsolatedRepository = { workspace, baseHead, baseBranch: abbreviated === 'HEAD' ? null : abbreviated };
      created.push(repository);
      const dirty = git(source, ['status', '--porcelain']).stdout.split(/\r?\n/).filter(Boolean).length;
      if (dirty) warnings.push(`${workspace}: ${dirty} uncommitted change(s) in your checkout are not in ${branch}; the worktree starts from ${repository.baseBranch ?? 'detached HEAD'}@${baseHead.slice(0, 8)}`);
      const dependencies = join(source, 'node_modules');
      if (existsSync(dependencies)) symlinkSync(dependencies, join(worktree, 'node_modules'), 'junction');
      else warnings.push(`${workspace}: your checkout has no node_modules, so Nx verification in the worktree fails until dependencies are installed`);
    }
  } catch (error) {
    try {
      removeRepositories(root, branch, created, true);
    } catch (cleanupError) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}; rollback also failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
    }
    throw error;
  }
  return { isolation: { branch, root, repositories: [...(existing?.repositories ?? []), ...created], removedAt: null }, warnings };
}

export function removeIsolation(isolation: TaskIsolation, force: boolean): IsolationRemoval {
  if (!force) {
    const dirty = isolation.repositories.filter((repository) => {
      const worktree = worktreePath(isolation, repository.workspace);
      return existsSync(worktree) && git(worktree, ['status', '--porcelain']).stdout.trim().length > 0;
    }).map((repository) => repository.workspace);
    if (dirty.length) throw new Error(`Worktree has uncommitted changes in ${dirty.join(', ')}; commit them on ${isolation.branch} first, or rerun with --force to discard them`);
  }
  return removeRepositories(isolation.root, isolation.branch, isolation.repositories, force);
}
