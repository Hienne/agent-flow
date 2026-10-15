import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readJson, writeJsonAtomic } from '../shared/filesystem.js';
import { SCRATCH_ROOT } from '../shared/paths.js';
import type { ChangeGroup, FormalReviewEvidence, FormalReviewKind, ReviewStats, TaskManifest } from '../shared/types.js';

export const FORMAL_REVIEW_KINDS: FormalReviewKind[] = ['code-review', 'code-simplification'];

// Claude Code subagent types whose SubagentStop event is the only accepted source of Claude-hosted review evidence.
export const REVIEW_AGENTS: Record<string, FormalReviewKind> = {
  'flow:code-reviewer': 'code-review',
  'flow:code-simplifier': 'code-simplification',
};

// Evidence stays valid while the change made after the review stays below the formal threshold itself.
const STALE_EXTRA_CODE_LINES = 100;
const STALE_UNCOVERED_CODE_FILES = 5;
const MAX_STOP_BLOCKS = 2;
// A reviewer that never reported SubagentStop stops counting as running after this window.
const REVIEWER_RUN_WINDOW_MS = 30 * 60 * 1000;
const SESSION_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const RESULT_MARKER = /FLOW-REVIEW-RESULT\s+task=([a-z0-9]+(?:-[a-z0-9]+)*)\s+blocking=(\d+)\s+non-blocking=(\d+)/;

export interface ReviewGate {
  required: boolean;
  satisfied: boolean;
  waived: boolean;
  missing: FormalReviewKind[];
  stale: FormalReviewKind[];
}

export function codeFileKeys(groups: ChangeGroup[]): string[] {
  return groups.flatMap((group) => group.changes.filter((change) => change.isCode).map((change) => `${group.workspace.relativeRoot}/${change.path}`));
}

function isStale(evidence: FormalReviewEvidence, stats: ReviewStats, files: string[]): boolean {
  const covered = new Set(evidence.files);
  const uncovered = files.filter((file) => !covered.has(file)).length;
  return stats.codeLines > evidence.codeLines + STALE_EXTRA_CODE_LINES || uncovered > STALE_UNCOVERED_CODE_FILES;
}

export function evaluateReviewGate(manifest: TaskManifest, stats: ReviewStats, files: string[]): ReviewGate {
  if (!stats.formalReviewRequired) return { required: false, satisfied: true, waived: false, missing: [], stale: [] };
  const evidence = manifest.evidence.formalReviews ?? [];
  if (evidence.some((item) => item.kind === 'waiver')) return { required: true, satisfied: true, waived: true, missing: [], stale: [] };
  const missing: FormalReviewKind[] = [];
  const stale: FormalReviewKind[] = [];
  for (const kind of FORMAL_REVIEW_KINDS) {
    const latest = evidence.filter((item) => item.kind === kind).at(-1);
    if (!latest) missing.push(kind);
    else if (isStale(latest, stats, files)) stale.push(kind);
  }
  return { required: true, satisfied: !missing.length && !stale.length, waived: false, missing, stale };
}

export function reviewGateSummary(gate: ReviewGate, stats: ReviewStats): string {
  const size = `${stats.codeLines} code lines, ${stats.codeFiles} code files`;
  if (!gate.required) return `REVIEW not required (${size})`;
  if (gate.waived) return `REVIEW waived by the user (${size})`;
  if (gate.satisfied) return `REVIEW satisfied: code-review and code-simplification evidence recorded (${size})`;
  const pending = [...gate.missing.map((kind) => `${kind} missing`), ...gate.stale.map((kind) => `${kind} stale`)].join(', ');
  return `REVIEW REQUIRED (${size}): ${pending}. ${reviewInstruction()}`;
}

export function reviewInstruction(): string {
  return 'Claude Code: spawn the flow:code-reviewer and flow:code-simplifier subagents in one message (Agent tool, subagent_type set to each name) with the task slug; their SubagentStop hook records the evidence. Other hosts: run each formal skill once, then `flow review record --task <feature> --kind <kind>`. Apply valid findings, then rerun `verify --task <feature>`.';
}

export function reviewEvidence(input: {
  kind: FormalReviewEvidence['kind'];
  source: FormalReviewEvidence['source'];
  agentType?: string | null;
  stats: ReviewStats;
  files: string[];
  blocking?: number | null;
  nonBlocking?: number | null;
  reason?: string | null;
}): FormalReviewEvidence {
  return {
    kind: input.kind,
    source: input.source,
    agentType: input.agentType ?? null,
    recordedAt: new Date().toISOString(),
    codeLines: input.stats.codeLines,
    codeFiles: input.stats.codeFiles,
    files: input.files,
    blocking: input.blocking ?? null,
    nonBlocking: input.nonBlocking ?? null,
    reason: input.reason ?? null,
  };
}

export function parseReviewResult(message: string): { feature: string; blocking: number; nonBlocking: number } | null {
  const match = RESULT_MARKER.exec(message);
  return match ? { feature: match[1]!, blocking: Number(match[2]), nonBlocking: Number(match[3]) } : null;
}

// Session binding lets the Stop hook gate only the tasks this Claude session drove, never another session's work.
interface RunningReviewer { agentType: string; startedAt: string }
interface SessionState { features: string[]; stopBlocks: Record<string, number>; running: RunningReviewer[]; updatedAt: string }

function sessionPath(sessionId: string): string | null {
  return SESSION_PATTERN.test(sessionId) ? join(SCRATCH_ROOT, 'sessions', `${sessionId}.json`) : null;
}

export function readSession(sessionId: string): SessionState {
  const path = sessionPath(sessionId);
  const empty: SessionState = { features: [], stopBlocks: {}, running: [], updatedAt: new Date(0).toISOString() };
  return path && existsSync(path) ? { ...empty, ...readJson<Partial<SessionState>>(path, {}) } : empty;
}

function writeSession(sessionId: string, state: SessionState): void {
  const path = sessionPath(sessionId);
  if (path) writeJsonAtomic(path, { ...state, updatedAt: new Date().toISOString() });
}

export function bindSessionTask(sessionId: string, feature: string): void {
  const state = readSession(sessionId);
  if (state.features.includes(feature)) return;
  writeSession(sessionId, { ...state, features: [...state.features, feature] });
}

// SubagentStart/SubagentStop bracket each reviewer run so the parent may end its turn while reviewers work in the background.
export function markReviewerStarted(sessionId: string, agentType: string): void {
  const state = readSession(sessionId);
  writeSession(sessionId, { ...state, running: [...state.running, { agentType, startedAt: new Date().toISOString() }] });
}

export function markReviewerStopped(sessionId: string, agentType: string): void {
  const state = readSession(sessionId);
  const index = state.running.findIndex((item) => item.agentType === agentType);
  if (index < 0) return;
  writeSession(sessionId, { ...state, running: state.running.filter((_, position) => position !== index) });
}

export function commandTaskFeature(command: string): string | null {
  if (!/\bflow(?:\.mjs|\.cmd)?\b/.test(command)) return null;
  const match = /--task\s+([a-z0-9]+(?:-[a-z0-9]+)*)/.exec(command)
    ?? /\btask\s+(?:start|status|handoff|block|complete)\s+([a-z0-9]+(?:-[a-z0-9]+)*)/.exec(command);
  return match?.[1] ?? null;
}

// Presence only: verify re-checks freshness against the current change set.
function hasRecordedReviews(manifest: TaskManifest): boolean {
  const evidence = manifest.evidence.formalReviews ?? [];
  return evidence.some((item) => item.kind === 'waiver') || FORMAL_REVIEW_KINDS.every((kind) => evidence.some((item) => item.kind === kind));
}

export type StopDecision = { decision: 'allow'; message: string | null } | { decision: 'block'; reason: string };

// Blocks a stop while a task driven by this session passed verification but still lacks formal review evidence.
// After MAX_STOP_BLOCKS consecutive blocks for the same task revision the stop is allowed with a user-visible warning;
// the task itself stays incomplete because only verify with satisfied review evidence can complete it.
export function evaluateStop(sessionId: string, manifests: TaskManifest[]): StopDecision {
  const state = readSession(sessionId);
  const pending = manifests.filter((manifest) => state.features.includes(manifest.feature) && manifest.state === 'active'
    && manifest.phase === 'reviewing' && !hasRecordedReviews(manifest));
  if (!pending.length) return { decision: 'allow', message: null };
  const now = Date.now();
  if (state.running.some((item) => now - Date.parse(item.startedAt) < REVIEWER_RUN_WINDOW_MS)) return { decision: 'allow', message: null };
  const exhausted = pending.filter((manifest) => (state.stopBlocks[`${manifest.feature}@${manifest.manifestRevision}`] ?? 0) >= MAX_STOP_BLOCKS);
  const blocking = pending.filter((manifest) => !exhausted.includes(manifest));
  if (!blocking.length) {
    return { decision: 'allow', message: `flow: ${exhausted.map((manifest) => manifest.feature).join(', ')} passed verification but still lacks formal review evidence; the task stays incomplete until code-review and code-simplification run.` };
  }
  const stopBlocks = { ...state.stopBlocks };
  for (const manifest of blocking) {
    const key = `${manifest.feature}@${manifest.manifestRevision}`;
    stopBlocks[key] = (stopBlocks[key] ?? 0) + 1;
  }
  writeSession(sessionId, { ...state, stopBlocks });
  return {
    decision: 'block',
    reason: `flow formal review gate: ${blocking.map((manifest) => manifest.feature).join(', ')} passed verification but the change exceeds the review threshold and has no current code-review/code-simplification evidence. ${reviewInstruction()} If the user has explicitly declined the review, stop and tell them only they can waive it with \`flow review waive --task <feature> --reason <text>\` in their own terminal.`,
  };
}
