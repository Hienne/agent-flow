import { appendFileSync, closeSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDirectory, readJson, writeFileAtomic, writeJsonAtomic } from '../shared/filesystem.js';
import { ARTIFACTS_ROOT, SCRATCH_ROOT } from '../shared/paths.js';
import type { ReviewGate } from '../review/gate.js';
import type { ChangeGroup, ReviewStats, TaskManifest, VerificationResult } from '../shared/types.js';

const cachePath = (): string => join(SCRATCH_ROOT, 'cache', 'verification.json');
const cacheLockPath = (): string => join(SCRATCH_ROOT, 'cache', '.verification.lock');
const telemetryPath = (): string => join(SCRATCH_ROOT, 'telemetry', 'events.jsonl');

interface VerificationCache {
  schemaVersion: 1;
  steps: Record<string, { status: string; fingerprint: string; verifiedAt: string; durationMs: number }>;
}

export interface TelemetryEvent {
  eventType?: string;
  command?: string;
  status?: string;
  durationMs?: number;
  taskId?: string;
  feature?: string;
  sourceType?: string;
  source?: string;
  sourceRevision?: number | null;
  handoff?: string | null;
  transitionFrom?: string | null;
  transitionTo?: string | null;
  questionCount?: number | null;
  decisionCount?: number | null;
  artifactRevision?: number | null;
  workspace?: string | null;
  project?: string | null;
  verificationStep?: string | null;
  changedFiles?: number | null;
  totalLines?: number | null;
  codeLines?: number | null;
  cacheHits?: number;
  cacheMissReason?: string | null;
  retries?: number;
  exitClass?: string | null;
}

export function loadVerificationCache(): VerificationCache {
  return readJson<VerificationCache>(cachePath(), { schemaVersion: 1, steps: {} });
}

function mutateVerificationCache(update: (cache: VerificationCache) => void): void {
  ensureDirectory(join(SCRATCH_ROOT, 'cache'));
  let descriptor: number | null = null;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      descriptor = openSync(cacheLockPath(), 'wx');
      writeFileSync(descriptor, `${process.pid}\n`, 'utf8');
      break;
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  if (descriptor === null) throw new Error('Verification cache is locked by another process');
  try {
    const cache = loadVerificationCache();
    update(cache);
    writeJsonAtomic(cachePath(), cache);
  } finally {
    closeSync(descriptor);
    if (existsSync(cacheLockPath())) unlinkSync(cacheLockPath());
  }
}

export function clearVerificationCache(): void {
  mutateVerificationCache((cache) => { cache.steps = {}; });
}

export function recordVerificationCacheStep(id: string, value: VerificationCache['steps'][string]): void {
  mutateVerificationCache((cache) => { cache.steps[id] = value; });
}

export function recordTelemetry(event: TelemetryEvent): void {
  try {
    ensureDirectory(join(SCRATCH_ROOT, 'telemetry'));
    const safe = {
      schemaVersion: 3,
      timestamp: new Date().toISOString(),
      eventType: event.eventType ?? 'command.completed',
      command: event.command ?? null,
      status: event.status ?? null,
      durationMs: event.durationMs ?? null,
      taskId: event.taskId ?? null,
      feature: event.feature ?? null,
      sourceType: event.sourceType ?? null,
      source: event.source ?? null,
      sourceRevision: event.sourceRevision ?? null,
      handoff: event.handoff ?? null,
      transitionFrom: event.transitionFrom ?? null,
      transitionTo: event.transitionTo ?? null,
      questionCount: event.questionCount ?? null,
      decisionCount: event.decisionCount ?? null,
      artifactRevision: event.artifactRevision ?? null,
      workspace: event.workspace ?? null,
      project: event.project ?? null,
      verificationStep: event.verificationStep ?? null,
      changedFiles: event.changedFiles ?? null,
      totalLines: event.totalLines ?? null,
      codeLines: event.codeLines ?? null,
      cacheHits: event.cacheHits ?? 0,
      cacheMissReason: event.cacheMissReason ?? null,
      retries: event.retries ?? 0,
      exitClass: event.exitClass ?? null,
    };
    appendFileSync(telemetryPath(), `${JSON.stringify(safe)}\n`, 'utf8');
  } catch {
    // Telemetry is intentionally fail-open.
  }
}

function automaticWorklogBlock(manifest: TaskManifest, groups: ChangeGroup[], stats: ReviewStats, results: VerificationResult[], review: ReviewGate | null): string {
  const changedFiles = groups.flatMap((group) => group.changes.map((change) => `${group.workspace.relativeRoot}/${change.path}`));
  return [
    '<!-- flow:auto:start -->',
    `Updated: ${new Date().toISOString()}`,
    '',
    '## Changed files',
    '',
    ...(changedFiles.length ? changedFiles.map((path) => `- \`${path}\``) : ['- None']),
    '',
    '## Verification ledger',
    '',
    ...(results.length ? results.map((result) => `- ${result.status.toUpperCase()} — \`${result.id}\`${result.cached ? ' (cached)' : ''}`) : ['- No verification steps required for the current task-scoped change set.']),
    '',
    '## Review threshold',
    '',
    `- Total changed lines: ${stats.totalLines}`,
    `- Implementation/code lines: ${stats.codeLines}`,
    `- Code files: ${stats.codeFiles}`,
    `- Formal review: ${stats.formalReviewRequired ? 'required' : 'not required'}`,
    ...(review ? [`- Gate: ${review.waived ? 'waived by the user' : review.satisfied ? 'satisfied' : `pending (${[...review.missing.map((kind) => `${kind} missing`), ...review.stale.map((kind) => `${kind} stale`)].join(', ')})`}`] : []),
    ...(manifest.evidence.formalReviews ?? []).map((item) => `- Evidence: ${item.kind} via ${item.source}${item.agentType ? ` (${item.agentType})` : ''} at ${item.recordedAt}${item.blocking === null ? '' : `, ${item.blocking} blocking/${item.nonBlocking ?? 0} non-blocking`}`),
    '<!-- flow:auto:end -->',
  ].join('\n');
}

export function updateWorklog(manifest: TaskManifest, groups: ChangeGroup[], stats: ReviewStats, results: VerificationResult[], review: ReviewGate | null = null): string {
  const directory = join(ARTIFACTS_ROOT, manifest.feature);
  const path = join(directory, 'worklog.md');
  const workspaces = [...new Set(manifest.targets.map((target) => target.workspace))];
  const projects = [...new Set(manifest.targets.map((target) => target.project).filter((project): project is string => Boolean(project)))];
  const workspace = workspaces.length > 1 ? 'cross-workspace' : workspaces[0] ?? 'unknown';
  const project = projects.length > 1 ? 'multiple' : projects[0] ?? 'unknown';
  const block = automaticWorklogBlock(manifest, groups, stats, results, review);
  if (!existsSync(path)) {
    writeFileAtomic(path, [
      '---', 'artifact: worklog', 'status: draft', `workspace: ${workspace}`, `project: ${project}`,
      `source: ${manifest.source.path}`, ...(manifest.source.revision ? [`source_revision: ${manifest.source.revision}`] : []),
      'revision: 1', '---', '', '# Worklog', '', '## Goal', '', `Track implementation and verification for ${manifest.feature}.`, '',
      '## Active ticket or slice', '', `- Task: ${manifest.taskId}`, '', '## Contracts and invariants', '', '- None recorded.', '',
      '## Decisions', '', '- None recorded.', '', block, '',
    ].join('\n'));
    return path;
  }
  const current = readFileSync(path, 'utf8');
  const next = current.includes('<!-- flow:auto:start -->')
    ? current.replace(/<!-- flow:auto:start -->[\s\S]*?<!-- flow:auto:end -->/, block)
    : `${current.trimEnd()}\n\n${block}\n`;
  writeFileAtomic(path, next);
  return path;
}
