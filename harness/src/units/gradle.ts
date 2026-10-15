import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { affectsWholeWorkspace } from '../inspection/changes.js';
import type { ChangeGroup, Project, VerificationPlan, Workspace } from '../shared/types.js';
import { resolveProject } from '../topology/workspaces.js';
import type { UnitAdapter } from './adapter.js';
import { unavailable } from './dependents.js';
import { commandStep } from './step.js';

const GOAL = 'check';
const SETTINGS = ['settings.gradle.kts', 'settings.gradle'];

function settingsFile(root: string): string | null {
  return SETTINGS.map((name) => join(root, name)).find(existsSync) ?? null;
}

// `:a:b` → a/b; v1 follows the default layout and ignores projectDir overrides and included builds.
function unit(workspace: Pick<Workspace, 'root'>, path: string): Project {
  const relativeRoot = path === ':' ? '.' : path.slice(1).replaceAll(':', '/');
  const root = resolve(workspace.root, relativeRoot);
  return { name: path === ':' ? basename(workspace.root) : path, root, relativeRoot, sourceRoot: null, projectType: null, targets: { [GOAL]: {} }, configPath: settingsFile(workspace.root) ?? join(root, 'build.gradle') };
}

// Every quoted name of every include statement, in Groovy (`include 'a', ':b'`) and Kotlin (`include("a", "b")`) form.
function loadProjects(workspace: Pick<Workspace, 'root'>): Project[] {
  const settings = settingsFile(workspace.root);
  const text = settings ? readFileSync(settings, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '') : '';
  const paths = new Set<string>();
  for (const statement of text.matchAll(/\binclude\b\s*\(?((?:\s*["'][^"']+["']\s*,?)+)/g)) {
    for (const name of statement[1]!.matchAll(/["']([^"']+)["']/g)) paths.add(name[1]!.startsWith(':') ? name[1]! : `:${name[1]}`);
  }
  if (!paths.size) return [unit(workspace, ':')];
  return [...paths].map((path) => unit(workspace, path)).sort((left, right) => left.name.localeCompare(right.name));
}

function gradle(workspace: Pick<Workspace, 'root'>): string {
  if (process.platform === 'win32') return existsSync(join(workspace.root, 'gradlew.bat')) ? 'gradlew.bat' : 'gradle';
  return existsSync(join(workspace.root, 'gradlew')) ? './gradlew' : 'gradle';
}

function buildFiles(workspace: Pick<Workspace, 'root'>, projects: Project[]): string[] {
  return [...SETTINGS, 'build.gradle.kts', 'build.gradle', 'gradle.properties'].map((name) => join(workspace.root, name))
    .concat(projects.flatMap((project) => [join(project.root, 'build.gradle.kts'), join(project.root, 'build.gradle')]));
}

function verifyPlan(group: ChangeGroup): Omit<VerificationPlan, 'schemaVersion'> {
  const projects = loadProjects(group.workspace);
  const owners = [...new Set(group.changes.map((change) => resolveProject(change.absolutePath, projects)).filter((project): project is Project => project !== null))];
  if (group.changes.some(affectsWholeWorkspace) || owners.some((project) => project.relativeRoot === '.')) {
    return {
      affectedProjects: [{ workspace: group.workspace.relativeRoot, project: '*' }],
      steps: [commandStep(group.workspace, null, GOAL, [gradle(group.workspace), GOAL], group.changes, buildFiles(group.workspace, projects))],
    };
  }
  if (!owners.length) return { affectedProjects: [], steps: [] };
  const tasks = owners.map((project) => `${project.name}:${GOAL}`).sort();
  return {
    affectedProjects: owners.map((project) => ({ workspace: group.workspace.relativeRoot, project: project.name })),
    // One Gradle invocation, so the daemon configures the build once.
    steps: [commandStep(group.workspace, owners.map((project) => project.name).sort().join(','), GOAL, [gradle(group.workspace), ...tasks], group.changes, buildFiles(group.workspace, owners))],
  };
}

export const gradleAdapter: UnitAdapter = {
  name: 'gradle',
  codeFiles: ['.java', '.kt', '.kts', '.xml'],
  detect: (directory) => [...SETTINGS, 'build.gradle.kts', 'build.gradle'].some((name) => existsSync(join(directory, name))),
  loadUnits: loadProjects,
  verifyPlan,
  unitPlan: (workspace, project) => [commandStep(workspace, project.name, GOAL, [gradle(workspace), project.relativeRoot === '.' ? GOAL : `${project.name}:${GOAL}`], [], buildFiles(workspace, [project]))],
  dependents: () => unavailable('Gradle project dependencies are declared in build scripts and are not read'),
};
