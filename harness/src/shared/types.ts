import type { AdapterName } from '../config/config.js';

export type JsonObject = Record<string, unknown>;

export interface Workspace {
  name: string;
  root: string;
  relativeRoot: string;
  adapter: AdapterName;
  scripts: Record<string, string>;
}

export interface Project {
  name: string;
  root: string;
  relativeRoot: string;
  sourceRoot: string | null;
  projectType: string | null;
  targets: Record<string, NxTarget>;
  configPath: string;
}

export interface NxTarget {
  executor?: string;
  options?: Record<string, unknown>;
  configurations?: Record<string, Record<string, unknown>>;
}

export interface WorkspaceChange {
  path: string;
  status: string;
  untracked: boolean;
  absolutePath: string;
  exists: boolean;
  added: number;
  deleted: number;
  isCode: boolean;
  changedLines: Set<number>;
}

export interface ChangeGroup {
  workspace: Workspace;
  available: boolean;
  changes: WorkspaceChange[];
  added: number;
  deleted: number;
  codeAdded: number;
  codeDeleted: number;
  codeFiles: number;
  error?: string;
  scopeToOwners?: boolean;
  // The commit the changes are diffed against: the workspace HEAD at task start.
  base?: string;
}

export interface ReviewStats {
  added: number;
  deleted: number;
  totalLines: number;
  codeAdded: number;
  codeDeleted: number;
  codeLines: number;
  lines: number;
  files: number;
  codeFiles: number;
  workspaces: number;
  formalReviewRequired: boolean;
}

export type TaskKind = 'docs' | 'code';

export interface TaskTarget {
  path: string;
  workspace: string;
  project: string | null;
}

export interface BaselineFile {
  fingerprint: string;
  status: string;
  recordedAt: string;
}

export type TaskPhase = 'inspecting' | 'implementing' | 'verifying' | 'reviewing' | 'blocked' | 'completed';
export type TaskState = 'active' | 'blocked' | 'completed';
export type TaskHandoff = 'not-ready' | 'ready-for-verification' | 'blocked' | 'completed';

export type FormalReviewKind = 'code-review' | 'code-simplification';

export interface FormalReviewEvidence {
  kind: FormalReviewKind | 'waiver';
  source: 'subagent' | 'manual' | 'user';
  agentType: string | null;
  recordedAt: string;
  codeLines: number;
  codeFiles: number;
  files: string[];
  blocking: number | null;
  nonBlocking: number | null;
  reason: string | null;
}

export type TestIntegrityKind = 'skipped' | 'commented-out' | 'test-removed' | 'assertion-changed';

export interface TestIntegrityFinding {
  file: string;
  kind: TestIntegrityKind;
  line: string;
}

// Only the user records one, with `flow review allow-tests`; it accepts exactly the findings it lists.
export interface TestIntegrityAllowance {
  recordedAt: string;
  reason: string;
  findings: string[];
}

export interface VerificationEvidence {
  status: string;
  step: string;
  verifiedAt: string;
  cached: boolean;
}


export interface IsolatedRepository {
  workspace: string;
  baseHead: string;
  baseBranch: string | null;
}

export interface TaskIsolation {
  branch: string;
  root: string;
  repositories: IsolatedRepository[];
  removedAt: string | null;
}

export interface TaskManifest {
  schemaVersion: 2;
  manifestRevision: number;
  taskId: string;
  feature: string;
  state: TaskState;
  phase: TaskPhase;
  source: {
    type: 'artifact' | 'conversation' | 'external';
    path: string;
    revision: number | null;
  };
  targets: TaskTarget[];
  isolation?: TaskIsolation | null;
  baseline: {
    startedAt: string;
    workspaceHeads: Record<string, string | null>;
    dirtyFiles: Record<string, BaselineFile>;
  };
  plan: {
    configFingerprint: string;
    verification: VerificationStep[];
  };
  evidence: {
    verification: VerificationEvidence[];
    lastChangeSnapshotAt: string | null;
    formalReviews?: FormalReviewEvidence[];
    testIntegrity?: TestIntegrityAllowance[];
  };
  taskHandoff: {
    state: TaskHandoff;
    reason: string | null;
    updatedAt: string;
  };
  startedAt: string;
  lastSeenAt: string;
}

export interface CommandVerificationStep {
  id: string;
  kind: 'command';
  workspace: string;
  project: string | null;
  target: string;
  command: string[];
  cwd: string;
  fingerprint: string;
}

export interface ConfigurationErrorStep {
  id: string;
  kind: 'configuration-error';
  workspace: string;
  project: null;
  message: string;
}

export type VerificationStep = CommandVerificationStep | ConfigurationErrorStep;

export interface VerificationPlan {
  schemaVersion: 1;
  affectedProjects: Array<{ workspace: string; project: string }>;
  steps: VerificationStep[];
}

export interface VerificationResult {
  id: string;
  status: 'passed' | 'failed';
  cached: boolean;
  cacheMissReason: string | null;
  durationMs: number;
  command?: string;
  output?: string;
}
