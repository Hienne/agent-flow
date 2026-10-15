import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { loadConfig, verifyTargets } from '../config/config.js';
import { ROOT, isWithin, normalizePath, relativeToRoot, resolveInput } from '../shared/paths.js';
import type { ChangeGroup, Project, ReviewStats, TaskKind, VerificationStep, Workspace, WorkspaceChange } from '../shared/types.js';
import { findProject, findWorkspace, loadProjects, resolveProject } from '../topology/workspaces.js';
import { unitAdapter } from '../units/adapter.js';
import { planVerification, classifyPaths } from '../verification/planner.js';
import { affectsWholeWorkspace, collectWorkspaceChanges, reviewStats } from './changes.js';

const PREFLIGHT = 'overengineering-review: run it before introducing or materially expanding a public seam, shared abstraction, configurable workflow, or extension mechanism';

export interface InspectionResult {
  schemaVersion: 2;
  status: 'ok' | 'outside-workspace' | 'git-unavailable';
  target: string;
  message?: string;
  workspace?: { name: string; root: string };
  project?: { name: string; root: string; type: string | null; targets: string[] } | null;
  task?: { kinds: TaskKind[] };
  context?: { docs: string[]; conventions: string[]; preflights: string[] };
  changes?: Omit<ReviewStats, 'files'> & {
    fileCount: number;
    files: Array<Pick<WorkspaceChange, 'path' | 'status' | 'added' | 'deleted'>>;
  };
  verification?: VerificationStep[];
}

// context.docs and context.conventions may name {workspace}; a doc that does not exist for this workspace is skipped.
function contextSources(workspace: Workspace, kinds: TaskKind[]): NonNullable<InspectionResult['context']> {
  const context = loadConfig().context;
  const resolveAll = (sources: string[] = []): string[] => sources
    .map((source) => source.replaceAll('{workspace}', workspace.relativeRoot))
    .filter((source) => existsSync(resolve(ROOT, source)));
  return {
    docs: resolveAll(context?.docs),
    conventions: kinds.includes('code') ? resolveAll(context?.conventions) : [],
    preflights: kinds.includes('code') ? [PREFLIGHT] : [],
  };
}

export function inspectTarget(input = '.'): InspectionResult {
  const absolute = resolveInput(input);
  let workspace = findWorkspace(absolute);
  let project: Project | null = null;
  let target = absolute;
  if (!workspace) {
    const named = findProject(input);
    if (named) {
      workspace = named.workspace;
      project = named.project;
      target = project.root;
    }
  }
  if (!workspace) return { schemaVersion: 2, status: 'outside-workspace', target: normalizePath(absolute), message: 'Target is not inside a unit workspace and does not uniquely name a project.' };
  project ??= resolveProject(target, loadProjects(workspace));
  const group = collectWorkspaceChanges(workspace);
  if (!group.available) return {
    schemaVersion: 2,
    status: 'git-unavailable',
    target: relativeToRoot(target),
    workspace: { name: workspace.name, root: workspace.relativeRoot },
    project: project ? { name: project.name, root: project.relativeRoot, type: project.projectType, targets: Object.keys(project.targets).sort() } : null,
    message: group.error ?? 'Git changes are unavailable',
  };
  const resolvedProject = project;
  const scopedChanges = resolvedProject ? group.changes.filter((change) => isWithin(resolvedProject.root, change.absolutePath) || affectsWholeWorkspace(change)) : group.changes;
  const codeChanges = scopedChanges.filter((change) => change.isCode);
  const scopedGroup: ChangeGroup = {
    ...group,
    changes: scopedChanges,
    scopeToOwners: true,
    added: scopedChanges.reduce((sum, change) => sum + change.added, 0),
    deleted: scopedChanges.reduce((sum, change) => sum + change.deleted, 0),
    codeFiles: codeChanges.length,
    codeAdded: codeChanges.reduce((sum, change) => sum + change.added, 0),
    codeDeleted: codeChanges.reduce((sum, change) => sum + change.deleted, 0),
  };
  const paths = scopedChanges.length ? scopedChanges.map((change) => change.path) : [normalizePath(relative(workspace.root, target))];
  const kinds = classifyPaths(paths);
  const plan = scopedChanges.length ? planVerification([scopedGroup])
    : { steps: project ? unitAdapter(workspace.adapter).unitPlan(workspace, project, verifyTargets()) : [] };
  const stats = reviewStats([scopedGroup]);
  return {
    schemaVersion: 2,
    status: 'ok',
    target: existsSync(target) ? relativeToRoot(target) : normalizePath(target),
    workspace: { name: workspace.name, root: workspace.relativeRoot },
    project: project ? { name: project.name, root: normalizePath(project.relativeRoot), type: project.projectType, targets: Object.keys(project.targets).sort() } : null,
    task: { kinds },
    context: contextSources(workspace, kinds),
    changes: { ...stats, fileCount: stats.files, files: scopedChanges.map((change) => ({ path: change.path, status: change.status, added: change.added, deleted: change.deleted })) },
    verification: plan.steps,
  };
}

export function inspectTaskTargets(targets: Array<{ path: string }>): InspectionResult[] {
  return targets.map((target) => inspectTarget(resolve(ROOT, target.path)));
}
