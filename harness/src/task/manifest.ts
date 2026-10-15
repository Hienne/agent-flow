import { closeSync, existsSync, openSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { configFingerprint } from '../config/config.js';
import { ensureDirectory, fileHash, readJson, writeJsonAtomic } from '../shared/filesystem.js';
import { ARTIFACTS_ROOT, ROOT, WORKTREES_DIRECTORY, isWithin, logicalRelativePath, normalizePath, slugify } from '../shared/paths.js';
import { run } from '../shared/process.js';
import type { ReviewGate } from '../review/gate.js';
import type { BaselineFile, FormalReviewEvidence, TaskHandoff, TaskIsolation, TaskManifest, TaskTarget, VerificationStep, WorkspaceChange } from '../shared/types.js';
import { activeIsolation, createIsolation, physicalWorkspaceRoot, removeIsolation } from './isolation.js';

const FEATURE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TASK_PHASES = new Set(['inspecting', 'implementing', 'verifying', 'reviewing', 'blocked', 'completed']);
const TASK_KEYS = new Set(['schemaVersion', 'manifestRevision', 'taskId', 'feature', 'state', 'phase', 'source', 'targets', 'isolation', 'baseline', 'plan', 'evidence', 'taskHandoff', 'startedAt', 'lastSeenAt']);

export interface TaskInspectionSeed {
  status: 'ok';
  target: string;
  workspace: { root: string };
  project: { name: string } | null;
  changes: { files: Array<Pick<WorkspaceChange, 'path' | 'status'>> };
  verification: VerificationStep[];
}

export function taskManifestPath(feature: string): string {
  return join(ARTIFACTS_ROOT, slugify(feature), 'task.json');
}

function sourceIdentity(source: string, explicitRevision?: string | number | null): TaskManifest['source'] {
  const type = source === 'conversation' ? 'conversation' : /^[a-z]+:\/\//i.test(source) ? 'external' : 'artifact';
  const explicit = explicitRevision === undefined || explicitRevision === null ? null : Number(explicitRevision);
  if (explicit !== null && (!Number.isInteger(explicit) || explicit < 1)) throw new Error(`Source revision must be a positive integer: ${explicitRevision}`);
  if (type !== 'artifact') return { type, path: source, revision: explicit };
  const path = resolve(ROOT, source);
  if (!existsSync(path)) throw new Error(`Source artifact not found: ${source}`);
  const match = readFileSync(path, 'utf8').match(/^---\r?\n[\s\S]*?^revision:\s*([1-9]\d*)\s*$[\s\S]*?^---\s*$/m);
  if (!match?.[1]) throw new Error(`Source artifact revision not found: ${source}`);
  const actual = Number(match[1]);
  if (explicit !== null && explicit !== actual) throw new Error(`Source revision mismatch for ${source}: expected ${actual}, found ${explicit}`);
  return { type, path: source, revision: actual };
}

function workspaceHead(workspaceRoot: string): string | null {
  const result = run('git', ['rev-parse', 'HEAD'], { cwd: workspaceRoot });
  return result.code === 0 ? result.stdout.trim() : null;
}

function processRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireTaskLock(feature: string): () => void {
  const path = join(ARTIFACTS_ROOT, slugify(feature), '.task.lock');
  ensureDirectory(resolve(path, '..'));
  const create = (): void => {
    const descriptor = openSync(path, 'wx');
    try {
      writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`, 'utf8');
    } finally {
      closeSync(descriptor);
    }
  };
  try {
    create();
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
    const owner = readJson<{ pid?: number }>(path, {});
    const pid = Number(owner.pid);
    if (!Number.isInteger(pid) || pid <= 0 || processRunning(pid)) throw new Error(`Task manifest is being updated concurrently for ${feature}; retry the operation`);
    unlinkSync(path);
    create();
  }
  return () => {
    const owner = readJson<{ pid?: number }>(path, {});
    if (existsSync(path) && Number(owner.pid) === process.pid) unlinkSync(path);
  };
}

function validateTaskManifest(value: unknown, path: string): TaskManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid task manifest ${path}: expected an object`);
  const unknown = Object.keys(value).filter((key) => !TASK_KEYS.has(key));
  if (unknown.length) throw new Error(`Invalid task manifest ${path}: unknown fields ${unknown.join(', ')}`);
  const manifest = value as Partial<TaskManifest>;
  if (manifest.schemaVersion !== 2 || !Number.isInteger(manifest.manifestRevision) || Number(manifest.manifestRevision) < 1) {
    throw new Error(`Invalid task manifest ${path}: unsupported schema or revision`);
  }
  if (!manifest.feature || manifest.taskId !== `feature:${manifest.feature}` || !FEATURE_PATTERN.test(manifest.feature)) {
    throw new Error(`Invalid task manifest ${path}: invalid task identity`);
  }
  if (!['active', 'blocked', 'completed'].includes(manifest.state ?? '') || !manifest.phase || !TASK_PHASES.has(manifest.phase)
      || !Array.isArray(manifest.targets) || !manifest.targets.length) {
    throw new Error(`Invalid task manifest ${path}: invalid state, phase, or targets`);
  }
  if (!manifest.targets.every((target) => target && typeof target.path === 'string' && typeof target.workspace === 'string')) {
    throw new Error(`Invalid task manifest ${path}: invalid target`);
  }
  if (!manifest.source || !['artifact', 'conversation', 'external'].includes(manifest.source.type)
      || typeof manifest.source.path !== 'string' || (manifest.source.revision !== null && (!Number.isInteger(manifest.source.revision) || Number(manifest.source.revision) < 1))
      || !manifest.baseline || typeof manifest.baseline.startedAt !== 'string' || !manifest.baseline.workspaceHeads || !manifest.baseline.dirtyFiles
      || !manifest.plan || typeof manifest.plan.configFingerprint !== 'string' || !Array.isArray(manifest.plan.verification)
      || !manifest.evidence || !Array.isArray(manifest.evidence.verification)
      || !manifest.taskHandoff || !['not-ready', 'ready-for-verification', 'blocked', 'completed'].includes(manifest.taskHandoff.state)
      || typeof manifest.startedAt !== 'string' || typeof manifest.lastSeenAt !== 'string') {
    throw new Error(`Invalid task manifest ${path}: invalid source, baseline, plan, evidence, or handoff`);
  }
  const isolation = manifest.isolation;
  if (isolation !== undefined && isolation !== null && (typeof isolation.branch !== 'string' || typeof isolation.root !== 'string'
      || !Array.isArray(isolation.repositories) || !isolation.repositories.every((repository) => repository && typeof repository.workspace === 'string' && typeof repository.baseHead === 'string')
      || (isolation.removedAt !== null && typeof isolation.removedAt !== 'string'))) {
    throw new Error(`Invalid task manifest ${path}: invalid isolation`);
  }
  const formalReviews = manifest.evidence.formalReviews;
  if (formalReviews !== undefined && (!Array.isArray(formalReviews) || !formalReviews.every((item) => item
      && ['code-review', 'code-simplification', 'waiver'].includes(item.kind) && ['subagent', 'manual', 'user'].includes(item.source)
      && typeof item.recordedAt === 'string' && Number.isInteger(item.codeLines) && Number.isInteger(item.codeFiles) && Array.isArray(item.files)))) {
    throw new Error(`Invalid task manifest ${path}: invalid formal review evidence`);
  }
  // Legacy overengineering-review records are no longer consumed; formal review evidence lives in formalReviews.
  delete (manifest.evidence as TaskManifest['evidence'] & { reviews?: unknown }).reviews;
  return manifest as TaskManifest;
}

function readTaskManifest(path: string): TaskManifest {
  try {
    return validateTaskManifest(JSON.parse(readFileSync(path, 'utf8')), path);
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`Invalid task manifest ${path}: ${error.message}`);
    throw error;
  }
}

export function loadTaskManifest(feature: string): TaskManifest | null {
  if (!feature) return null;
  const path = taskManifestPath(feature);
  return existsSync(path) ? readTaskManifest(path) : null;
}

export function requireTaskManifest(feature: string): TaskManifest {
  const manifest = loadTaskManifest(feature);
  if (!manifest) throw new Error(`Task manifest not found for ${feature}; run task start first`);
  return manifest;
}

export function taskManifests(): TaskManifest[] {
  const scratch = ARTIFACTS_ROOT;
  if (!existsSync(scratch)) return [];
  return readdirSync(scratch, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && existsSync(join(scratch, entry.name, 'task.json')))
    .map((entry) => readTaskManifest(join(scratch, entry.name, 'task.json')))
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}

function activeTaskManifests(): TaskManifest[] {
  return taskManifests().filter((manifest) => manifest.state === 'active');
}

// Tickets sourced from <artifactsDir>/<feature>/... share that feature's worktree so each ticket builds on the previous one.
export function isolationGroup(feature: string, source?: string | null): string {
  if (!source || /^[a-z]+:\/\//i.test(source)) return feature;
  const match = normalizePath(relative(ARTIFACTS_ROOT, resolve(ROOT, source))).match(/^([a-z0-9]+(?:-[a-z0-9]+)*)\//);
  return match?.[1] ?? feature;
}

export function findSharedIsolation(root: string): { isolation: TaskIsolation; tasks: TaskManifest[] } | null {
  const tasks = taskManifests().filter((manifest) => manifest.isolation && !manifest.isolation.removedAt && manifest.isolation.root === root);
  const newest = tasks[0]?.isolation;
  if (!newest) return null;
  const repositories = new Map<string, TaskIsolation['repositories'][number]>();
  for (const task of tasks) for (const repository of task.isolation?.repositories ?? []) if (!repositories.has(repository.workspace)) repositories.set(repository.workspace, repository);
  return { isolation: { ...newest, repositories: [...repositories.values()] }, tasks };
}

export function acquireTaskIsolation(feature: string, source: string | null | undefined, workspaces: string[]): { isolation: TaskIsolation; warnings: string[]; rollback: () => void } {
  const group = isolationGroup(feature, source);
  const root = `${WORKTREES_DIRECTORY}/${group}`;
  const divergent = taskManifests().filter((task) => task.feature !== feature && task.isolation && !task.isolation.removedAt
    && task.isolation.root !== root && isolationGroup(task.feature, task.source.path) === group);
  if (divergent.length) {
    throw new Error(`${group} still has per-ticket worktrees from ${divergent.map((task) => task.taskId).join(', ')}; merge the latest one and run task cleanup for each before starting another ticket`);
  }
  const shared = findSharedIsolation(root);
  const holders =shared?.tasks.filter((task) => task.feature !== feature && task.state !== 'completed') ?? [];
  if (holders.length) {
    throw new Error(`Worktree ${root} is still held by ${holders.map((task) => `${task.taskId} (${task.state}/${task.phase})`).join(', ')}; finish that task before starting another ticket of ${group}`);
  }
  const created = createIsolation(group, workspaces, shared?.isolation ?? null);
  const previous = new Set(shared?.isolation.repositories.map((repository) => repository.workspace) ?? []);
  const added: TaskIsolation = { ...created.isolation, repositories: created.isolation.repositories.filter((repository) => !previous.has(repository.workspace)) };
  const warnings = [...created.warnings];
  if (shared) warnings.push(`Reusing ${root} on ${created.isolation.branch} from ${shared.tasks.map((task) => task.taskId).join(', ')}; uncommitted work from earlier tickets belongs to this task's baseline`);
  return { isolation: created.isolation, warnings, rollback: () => { if (added.repositories.length) removeIsolation(added, true); } };
}

export function findActiveTaskForTarget(target: string): TaskManifest | null {
  return activeTaskManifests().find((manifest) => manifest.targets.some((registered) => isWithin(resolve(ROOT, registered.path), target))) ?? null;
}

export function findIsolatedTaskForUserPath(target: string): { manifest: TaskManifest; redirect: string } | null {
  for (const manifest of activeTaskManifests()) {
    const isolation = activeIsolation(manifest);
    if (!isolation) continue;
    const owned = manifest.targets.some((registered) => isWithin(resolve(ROOT, logicalRelativePath(registered.path)), target));
    if (owned) return { manifest, redirect: resolve(ROOT, isolation.root, relative(ROOT, target)) };
  }
  return null;
}

export function startTaskManifest(input: {
  feature: string;
  source?: string;
  sourceRevision?: string | number | null;
  inspections: TaskInspectionSeed[];
  isolation?: TaskIsolation | null;
}): TaskManifest {
  const feature = slugify(input.feature);
  if (!feature || feature !== input.feature || !FEATURE_PATTERN.test(input.feature)) throw new Error(`Feature must be English kebab-case: ${input.feature || '<missing>'}`);
  const release = acquireTaskLock(feature);
  try {
    const existing = loadTaskManifest(feature);
    if (existing && existing.state !== 'completed' && !existing.isolation?.removedAt) throw new Error(`Feature ${feature} already has an active task in phase ${existing.phase}`);
    const now = new Date().toISOString();
    const targets: TaskTarget[] = [];
    const dirtyFiles: Record<string, BaselineFile> = {};
    const workspaceHeads: Record<string, string | null> = {};
    const verification = new Map<string, VerificationStep>();
    const isolation = input.isolation ?? null;
    for (const inspection of input.inspections) {
      const target = { path: normalizePath(inspection.target), workspace: inspection.workspace.root, project: inspection.project?.name ?? null };
      if (!targets.some((item) => item.path === target.path && item.workspace === target.workspace && item.project === target.project)) targets.push(target);
      const workspaceRoot = physicalWorkspaceRoot({ isolation }, target.workspace);
      workspaceHeads[target.workspace] ??= workspaceHead(workspaceRoot);
      for (const change of inspection.changes.files) {
        const key = `${target.workspace}/${normalizePath(change.path)}`;
        if (dirtyFiles[key]) continue;
        dirtyFiles[key] = {
          fingerprint: fileHash([resolve(workspaceRoot, change.path)]),
          status: change.status,
          recordedAt: now,
        };
      }
      for (const step of inspection.verification) verification.set(step.id, step);
    }
    const manifest: TaskManifest = {
      schemaVersion: 2,
      manifestRevision: (existing?.manifestRevision ?? 0) + 1,
      taskId: `feature:${feature}`,
      feature,
      state: 'active',
      phase: 'inspecting',
      source: sourceIdentity(input.source ?? 'conversation', input.sourceRevision),
      targets,
      ...(isolation ? { isolation } : {}),
      baseline: { startedAt: now, workspaceHeads, dirtyFiles },
      plan: { configFingerprint: configFingerprint(), verification: [...verification.values()] },
      evidence: { verification: [], lastChangeSnapshotAt: null },
      taskHandoff: { state: 'not-ready', reason: null, updatedAt: now },
      startedAt: now,
      lastSeenAt: now,
    };
    writeJsonAtomic(taskManifestPath(feature), manifest);
    return manifest;
  } finally {
    release();
  }
}

export function updateTaskManifest(feature: string, update: (manifest: TaskManifest) => TaskManifest): TaskManifest {
  const release = acquireTaskLock(feature);
  try {
    const path = taskManifestPath(feature);
    const current = requireTaskManifest(feature);
    const expectedRevision = current.manifestRevision;
    const next = update(structuredClone(current));
    next.schemaVersion = 2;
    next.manifestRevision = expectedRevision + 1;
    next.lastSeenAt = new Date().toISOString();
    const latest = requireTaskManifest(feature);
    if (latest.manifestRevision !== expectedRevision) throw new Error(`Task manifest revision changed while updating ${feature}; expected ${expectedRevision}, found ${latest.manifestRevision}`);
    writeJsonAtomic(path, next);
    return next;
  } finally {
    release();
  }
}

export function recordInspection(feature: string, verification: VerificationStep[]): TaskManifest {
  return updateTaskManifest(feature, (manifest) => {
    if (manifest.state === 'completed') throw new Error(`Task ${manifest.taskId} is completed`);
    if (manifest.state === 'blocked') throw new Error(`Task ${manifest.taskId} is blocked: ${manifest.taskHandoff.reason ?? 'no reason recorded'}`);
    manifest.state = 'active';
    manifest.phase = 'implementing';
    manifest.plan.configFingerprint = configFingerprint();
    manifest.plan.verification = verification;
    manifest.taskHandoff = { state: 'not-ready', reason: null, updatedAt: new Date().toISOString() };
    return manifest;
  });
}

export function setTaskHandoff(feature: string, handoff: TaskHandoff, reason: string | null = null): TaskManifest {
  return updateTaskManifest(feature, (manifest) => {
    const now = new Date().toISOString();
    if (manifest.state === 'completed' && handoff !== 'completed') throw new Error(`Task ${manifest.taskId} is completed`);
    if (handoff === 'ready-for-verification' && !Array.isArray(manifest.plan.verification)) throw new Error('Task has no persisted verification plan');
    if (handoff === 'ready-for-verification' && manifest.phase !== 'implementing') throw new Error(`Task ${manifest.taskId} must be in implementing phase before verification handoff`);
    manifest.taskHandoff = { state: handoff, reason, updatedAt: now };
    if (handoff === 'blocked') {
      manifest.state = 'blocked';
      manifest.phase = 'blocked';
    } else if (handoff === 'completed') {
      if (manifest.phase === 'reviewing') throw new Error(`Task ${manifest.taskId} passed verification but lacks formal code-review/code-simplification evidence; run the review, then verify --task again`);
      if (manifest.state !== 'completed') throw new Error('Task completion is produced by successful verification; run verify --task first');
      if (!manifest.evidence.lastChangeSnapshotAt) throw new Error('Cannot complete a task before verification records the current change snapshot');
      if (manifest.evidence.verification.some((item) => item.status !== 'passed')) throw new Error('Cannot complete a task with failed verification evidence');
      manifest.phase = 'completed';
    } else {
      manifest.state = 'active';
      manifest.phase = handoff === 'ready-for-verification' ? 'verifying' : 'implementing';
    }
    return manifest;
  });
}

export function beginVerification(feature: string): TaskManifest {
  return updateTaskManifest(feature, (manifest) => {
    if (manifest.state === 'blocked') throw new Error(`Task ${manifest.taskId} is blocked: ${manifest.taskHandoff.reason ?? 'no reason recorded'}`);
    if (manifest.state === 'completed') throw new Error(`Task ${manifest.taskId} is completed`);
    manifest.phase = 'verifying';
    manifest.taskHandoff = { state: 'ready-for-verification', reason: null, updatedAt: new Date().toISOString() };
    return manifest;
  });
}


export function recordFormalReview(feature: string, evidence: FormalReviewEvidence): TaskManifest {
  return updateTaskManifest(feature, (manifest) => {
    if (manifest.state === 'completed') throw new Error(`Task ${manifest.taskId} is completed; formal review evidence can no longer change it`);
    manifest.evidence.formalReviews = [...(manifest.evidence.formalReviews ?? []), evidence];
    return manifest;
  });
}

// Passing verification completes the task only when the formal review gate is satisfied for the same change set.
export function recordVerification(feature: string, results: Array<{ id: string; status: string; cached: boolean }>, expectedRevision?: number, reviewGate?: ReviewGate): TaskManifest {
  return updateTaskManifest(feature, (manifest) => {
    if (expectedRevision !== undefined && manifest.manifestRevision !== expectedRevision) {
      throw new Error(`Task manifest changed during verification; expected revision ${expectedRevision}, found ${manifest.manifestRevision}`);
    }
    if (!results.length) throw new Error('Cannot record verification without at least one verification or no-applicable-steps result');
    const expected = manifest.plan.verification.map((step) => step.id).sort();
    const actual = results.map((result) => result.id).sort();
    const complete = expected.length
      ? expected.length === actual.length && expected.every((id, index) => id === actual[index])
      : actual.length === 1 && actual[0] === 'task-scope:no-applicable-steps';
    const now = new Date().toISOString();
    manifest.evidence.verification = results.map((result) => ({ status: result.status, step: result.id, verifiedAt: now, cached: result.cached }));
    manifest.evidence.lastChangeSnapshotAt = now;
    const passed = complete && results.every((result) => result.status === 'passed');
    const reviewPending = passed && reviewGate !== undefined && !reviewGate.satisfied;
    const done = passed && !reviewPending;
    manifest.state = done ? 'completed' : 'active';
    manifest.phase = done ? 'completed' : reviewPending ? 'reviewing' : 'implementing';
    const reason = done ? null : reviewPending ? 'formal-review-required' : complete ? 'verification-failed' : 'verification-incomplete';
    manifest.taskHandoff = { state: done ? 'completed' : 'not-ready', reason, updatedAt: now };
    return manifest;
  });
}
