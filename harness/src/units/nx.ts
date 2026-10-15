import { existsSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { affectsWholeWorkspace } from '../inspection/changes.js';
import { fileHash, readJson } from '../shared/filesystem.js';
import { IGNORED_DIRECTORIES, normalizePath } from '../shared/paths.js';
import { run } from '../shared/process.js';
import type { ChangeGroup, CommandVerificationStep, NxTarget, Project, VerificationPlan, VerificationStep, Workspace, WorkspaceChange } from '../shared/types.js';
import { discoverWorkspaces, parseJsonObject, resolveProject } from '../topology/workspaces.js';
import type { UnitAdapter } from './adapter.js';
import { addConsumer, transitiveConsumers, type Dependents } from './dependents.js';

interface ProjectJson {
  name?: string;
  root?: string;
  sourceRoot?: string;
  projectType?: string;
  targets?: Record<string, NxTarget>;
}

function loadProjects(workspace: Pick<Workspace, 'root'>): Project[] {
  const projects: Project[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) visit(join(directory, entry.name));
        continue;
      }
      if (entry.name !== 'project.json') continue;
      const configPath = join(directory, entry.name);
      const raw = parseJsonObject(configPath, 'Nx project.json');
      const config = raw as ProjectJson;
      if (typeof config.name !== 'string' || !config.name) throw new Error(`Invalid Nx project.json ${normalizePath(configPath)}: name is required`);
      for (const field of ['root', 'sourceRoot', 'projectType'] as const) {
        if (config[field] !== undefined && typeof config[field] !== 'string') throw new Error(`Invalid Nx project.json ${normalizePath(configPath)}: ${field} must be a string`);
      }
      if (config.targets !== undefined && (!config.targets || typeof config.targets !== 'object' || Array.isArray(config.targets))) {
        throw new Error(`Invalid Nx project.json ${normalizePath(configPath)}: targets must be an object`);
      }
      const projectRoot = resolve(workspace.root, config.root ?? relative(workspace.root, directory));
      projects.push({
        name: config.name,
        root: projectRoot,
        relativeRoot: normalizePath(relative(workspace.root, projectRoot)),
        sourceRoot: config.sourceRoot ?? null,
        projectType: config.projectType ?? null,
        targets: config.targets ?? {},
        configPath,
      });
    }
  };
  visit(workspace.root);
  return projects.sort((left, right) => left.name.localeCompare(right.name));
}

function addStep(steps: VerificationStep[], step: VerificationStep): void {
  if (!steps.some((existing) => existing.id === step.id)) steps.push(step);
}

function targetStep(workspace: Workspace, project: Project, target: string, changes: WorkspaceChange[]): CommandVerificationStep {
  const id = `${workspace.relativeRoot}:${project.name}:${target}`;
  const relevantFiles = [...changes.map((change) => change.absolutePath), ...[project.configPath, join(workspace.root, 'package.json'), join(workspace.root, 'nx.json')].filter(existsSync)];
  return { id, kind: 'command', workspace: workspace.relativeRoot, project: project.name, target, command: ['npx', 'nx', 'run', `${project.name}:${target}`], cwd: workspace.root, fingerprint: fileHash(relevantFiles, id) };
}

function runManyStep(group: ChangeGroup, target: string): CommandVerificationStep {
  const id = `${group.workspace.relativeRoot}:all:${target}`;
  const relevantFiles = [...group.changes.map((change) => change.absolutePath), ...[join(group.workspace.root, 'package.json'), join(group.workspace.root, 'nx.json')].filter(existsSync)];
  return { id, kind: 'command', workspace: group.workspace.relativeRoot, project: null, target, command: ['npx', 'nx', 'run-many', '--target', target, '--all'], cwd: group.workspace.root, fingerprint: fileHash(relevantFiles, id) };
}

function queryAffectedProjects(group: ChangeGroup, ownerNames: Iterable<string>): { names: string[]; error: string | null } {
  const cli = join(group.workspace.root, 'node_modules', 'nx', 'bin', 'nx.js');
  const result = run('node', [cli, 'show', 'projects', '--affected', '--base=HEAD'], { cwd: group.workspace.root });
  if (result.code !== 0) return { names: [], error: result.stderr.trim() || result.stdout.trim() || 'Nx affected query failed' };
  const names = new Set(ownerNames);
  for (const name of result.stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) names.add(name);
  return { names: [...names], error: null };
}

function verifyPlan(group: ChangeGroup, targets: string[]): Omit<VerificationPlan, 'schemaVersion'> {
  const steps: VerificationStep[] = [];
  const affectedProjects: VerificationPlan['affectedProjects'] = [];
  const projects = loadProjects(group.workspace);
  const byProject = new Map<string, WorkspaceChange[]>();
  const workspaceChanges: WorkspaceChange[] = [];
  for (const change of group.changes) {
    const project = resolveProject(change.absolutePath, projects);
    if (!project) workspaceChanges.push(change);
    else byProject.set(project.name, [...(byProject.get(project.name) ?? []), change]);
  }
  if (workspaceChanges.some(affectsWholeWorkspace)) {
    affectedProjects.push({ workspace: group.workspace.relativeRoot, project: '*' });
    const availableTargets = new Set(projects.flatMap((project) => Object.keys(project.targets)));
    for (const target of targets) if (availableTargets.has(target)) addStep(steps, runManyStep(group, target));
    return { affectedProjects, steps };
  }
  const affected = group.scopeToOwners ? { names: [...byProject.keys()], error: null } : queryAffectedProjects(group, byProject.keys());
  if (affected.error) {
    addStep(steps, { id: `${group.workspace.relativeRoot}:affected-discovery`, kind: 'configuration-error', workspace: group.workspace.relativeRoot, project: null, message: affected.error });
    return { affectedProjects, steps };
  }
  for (const projectName of affected.names) {
    const project = projects.find((candidate) => candidate.name === projectName);
    if (!project) continue;
    affectedProjects.push({ workspace: group.workspace.relativeRoot, project: projectName });
    for (const target of targets) if (project.targets[target]) addStep(steps, targetStep(group.workspace, project, target, group.changes));
  }
  return { affectedProjects, steps };
}

// Nx 18 caches the project graph under .nx/cache, later releases under .nx/workspace-data; flow reads the cache and never runs nx.
const GRAPH_FILES = [join('.nx', 'cache', 'project-graph.json'), join('.nx', 'workspace-data', 'project-graph.json')];
const DEPENDENCY_SECTIONS = ['dependencies', 'devDependencies', 'peerDependencies'] as const;

interface ProjectGraph {
  nodes?: Record<string, unknown>;
  dependencies?: Record<string, Array<{ target: string }>>;
}

function packageName(project: Project): string | undefined {
  return readJson<{ name?: string }>(join(project.root, 'package.json'), {}).name;
}

function cachedGraph(workspace: Workspace): ProjectGraph | null {
  const path = GRAPH_FILES.map((file) => join(workspace.root, file)).find(existsSync);
  return path ? readJson<ProjectGraph | null>(path, null) : null;
}

// Projects that depend on `name`, transitively. Edges to external nodes (npm:…) are not in `nodes` and drop out.
function dependentProjects(graph: ProjectGraph, name: string): string[] {
  const consumers = new Map<string, string[]>();
  for (const [source, edges] of Object.entries(graph.dependencies ?? {})) {
    for (const { target } of edges) if (graph.nodes?.[source] && graph.nodes[target]) addConsumer(consumers, target, source);
  }
  return transitiveConsumers(consumers, name);
}

// Other workspaces whose package.json declares one of `packages`, whatever the spec: a registry version, or a `file:` link to a local build.
function consumingWorkspaces(workspace: Workspace, packages: Set<string>): Array<{ workspace: string; spec: string }> {
  const found: Array<{ workspace: string; spec: string }> = [];
  for (const other of discoverWorkspaces()) {
    if (other.relativeRoot === workspace.relativeRoot) continue;
    const manifest = readJson<Record<string, Record<string, string> | undefined>>(join(other.root, 'package.json'), {});
    const spec = DEPENDENCY_SECTIONS.flatMap((section) => [...packages].map((name) => manifest[section]?.[name])).find((value) => typeof value === 'string');
    if (spec) found.push({ workspace: other.relativeRoot, spec });
  }
  return found;
}

function dependents(workspace: Workspace, project: Project): Dependents {
  const graph = cachedGraph(workspace);
  const units = graph ? dependentProjects(graph, project.name) : [];
  // A consumer of the unit's package consumes the unit; so does a consumer of the package of a project that depends on it.
  const involved = loadProjects(workspace).filter((candidate) => candidate.name === project.name || units.includes(candidate.name));
  const packages = new Set(involved.flatMap((candidate) => packageName(candidate) ?? []));
  return {
    status: 'ok',
    units,
    workspaces: consumingWorkspaces(workspace, packages),
    notes: graph ? [] : [`no cached Nx project graph in ${workspace.relativeRoot} (${normalizePath(GRAPH_FILES[0]!)}); dependents inside the workspace are unknown, run an nx command there to create it`],
  };
}

export const nxAdapter: UnitAdapter = {
  name: 'nx',
  codeFiles: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.html', '.scss', '.css', '.json', '.jsonc', '.yaml', '.yml'],
  detect: (directory) => existsSync(join(directory, 'package.json')) && existsSync(join(directory, 'nx.json')),
  loadUnits: loadProjects,
  verifyPlan,
  unitPlan: (workspace, project, targets) => targets.filter((target) => project.targets[target]).map((target) => targetStep(workspace, project, target, [])),
  dependents,
};
