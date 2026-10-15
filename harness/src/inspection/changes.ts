import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { loadConfig, reviewThresholds } from '../config/config.js';
import { normalizePath } from '../shared/paths.js';
import { run } from '../shared/process.js';
import type { ChangeGroup, ReviewStats, Workspace, WorkspaceChange } from '../shared/types.js';
import { unitAdapter } from '../units/adapter.js';


function parseStatus(output: string): Array<Pick<WorkspaceChange, 'path' | 'status' | 'untracked'>> {
  const tokens = output.split('\0').filter(Boolean);
  const records: Array<Pick<WorkspaceChange, 'path' | 'status' | 'untracked'>> = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const entry = tokens[index];
    if (!entry) continue;
    const status = entry.slice(0, 2);
    records.push({ path: normalizePath(entry.slice(3)), status, untracked: status === '??' });
    if (status.includes('R') || status.includes('C')) index += 1;
  }
  return records;
}

// `git diff --name-status -z`: a status token, then one path (two for renames and copies).
function parseNameStatus(output: string): Array<Pick<WorkspaceChange, 'path' | 'status' | 'untracked'>> {
  const tokens = output.split('\0').filter(Boolean);
  const records: Array<Pick<WorkspaceChange, 'path' | 'status' | 'untracked'>> = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const status = tokens[index] ?? '';
    if (/^[RC]/.test(status)) index += 1;
    index += 1;
    const path = tokens[index];
    if (path) records.push({ path: normalizePath(path), status: `${status[0]} `, untracked: false });
  }
  return records;
}

function parseNumstat(output: string): Map<string, { added: number; deleted: number }> {
  const stats = new Map<string, { added: number; deleted: number }>();
  const tokens = output.split('\0');
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) continue;
    const [added = '0', deleted = '0', path = ''] = token.split('\t');
    let destination = path;
    if (!destination) {
      index += 2;
      destination = tokens[index] ?? '';
    }
    if (!destination) continue;
    stats.set(normalizePath(destination), {
      added: added === '-' ? 0 : Number(added),
      deleted: deleted === '-' ? 0 : Number(deleted),
    });
  }
  return stats;
}

export function countLines(path: string): number {
  if (!existsSync(path) || statSync(path).isDirectory()) return 0;
  const text = readFileSync(path, 'utf8');
  if (!text) return 0;
  const lines = text.split(/\r?\n/);
  return lines.at(-1) === '' ? lines.length - 1 : lines.length;
}

export function affectsWholeWorkspace(change: Pick<WorkspaceChange, 'path'>): boolean {
  return /^(?:package(?:-lock)?\.json|nx\.json|tsconfig(?:\.base)?\.json|eslint\.config\.[cm]?js|jest\.config\.[cm]?ts|\.env(?:\..*)?|pom\.xml|(?:settings|build)\.gradle(?:\.kts)?|gradle\.properties|gradle\/libs\.versions\.toml)$/i.test(normalizePath(change.path));
}

function changedLines(workspaceRoot: string, change: Pick<WorkspaceChange, 'path' | 'untracked'>, base: string): Set<number> {
  const absolute = resolve(workspaceRoot, change.path);
  if (change.untracked) return new Set(Array.from({ length: countLines(absolute) }, (_, index) => index + 1));
  const result = run('git', ['diff', '--unified=0', base, '--', change.path], { cwd: workspaceRoot });
  if (result.code !== 0) return new Set();
  const lines = new Set<number>();
  for (const match of result.stdout.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    for (let line = start; line < start + count; line += 1) lines.add(line);
  }
  return lines;
}

/**
 * Changes of the working tree against `base`. A task passes the HEAD it started from, so work the developer
 * commits mid-task stays in the task's scope instead of dropping out of verification and review.
 */
export function collectWorkspaceChanges(workspace: Workspace, base = 'HEAD'): ChangeGroup {
  const empty = { workspace, available: false, changes: [], added: 0, deleted: 0, codeAdded: 0, codeDeleted: 0, codeFiles: 0 };
  if (!existsSync(join(workspace.root, '.git'))) return { ...empty, error: 'Git repository not found' };
  const statusResult = run('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: workspace.root });
  if (statusResult.code !== 0) return { ...empty, error: statusResult.stderr.trim() };
  const numstatResult = run('git', ['diff', '--numstat', '-z', base, '--'], { cwd: workspace.root });
  if (numstatResult.code !== 0) return { ...empty, error: numstatResult.stderr.trim() };
  const numstat = parseNumstat(numstatResult.stdout);
  const records = parseStatus(statusResult.stdout);
  if (base !== 'HEAD') {
    const committed = run('git', ['diff', '--name-status', '-z', base, 'HEAD', '--'], { cwd: workspace.root });
    if (committed.code !== 0) return { ...empty, error: committed.stderr.trim() };
    const seen = new Set(records.map((record) => record.path));
    // Committed since base, untouched since: still part of the task. Files committed back to their base content have no numstat entry and drop out.
    records.push(...parseNameStatus(committed.stdout).filter((record) => !seen.has(record.path) && numstat.has(record.path)));
  }
  const codeExtensions = new Set(loadConfig().codeFiles ?? unitAdapter(workspace.adapter).codeFiles);
  const changes = records.map((change): WorkspaceChange => {
    const absolutePath = resolve(workspace.root, change.path);
    const stat = numstat.get(change.path) ?? { added: change.untracked ? countLines(absolutePath) : 0, deleted: 0 };
    return {
      ...change,
      absolutePath,
      exists: existsSync(absolutePath),
      added: stat.added,
      deleted: stat.deleted,
      isCode: codeExtensions.has(extname(change.path).toLowerCase()),
      changedLines: changedLines(workspace.root, change, base),
    };
  });
  const codeChanges = changes.filter((change) => change.isCode);
  return {
    workspace,
    base,
    available: true,
    changes,
    added: changes.reduce((sum, change) => sum + change.added, 0),
    deleted: changes.reduce((sum, change) => sum + change.deleted, 0),
    codeAdded: codeChanges.reduce((sum, change) => sum + change.added, 0),
    codeDeleted: codeChanges.reduce((sum, change) => sum + change.deleted, 0),
    codeFiles: codeChanges.length,
  };
}

export function reviewStats(groups: ChangeGroup[], thresholds = reviewThresholds()): ReviewStats {
  const changed = groups.filter((group) => group.changes.length > 0);
  const added = changed.reduce((sum, group) => sum + group.added, 0);
  const deleted = changed.reduce((sum, group) => sum + group.deleted, 0);
  const codeAdded = changed.reduce((sum, group) => sum + group.codeAdded, 0);
  const codeDeleted = changed.reduce((sum, group) => sum + group.codeDeleted, 0);
  const codeFiles = changed.reduce((sum, group) => sum + group.codeFiles, 0);
  const codeLines = codeAdded + codeDeleted;
  return {
    added, deleted, totalLines: added + deleted, codeAdded, codeDeleted, codeLines,
    lines: added + deleted,
    files: changed.reduce((sum, group) => sum + group.changes.length, 0),
    codeFiles,
    workspaces: changed.length,
    // A broad change (more lines than broad[0] over more files than broad[1]) or a deep one (more than deep lines) needs formal review.
    formalReviewRequired: (codeLines > thresholds.broad[0] && codeFiles > thresholds.broad[1]) || codeLines > thresholds.deep,
  };
}
