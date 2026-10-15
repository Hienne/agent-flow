import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { affectsWholeWorkspace } from '../inspection/changes.js';
import { normalizePath } from '../shared/paths.js';
import type { ChangeGroup, Project, VerificationPlan, Workspace } from '../shared/types.js';
import { resolveProject } from '../topology/workspaces.js';
import type { UnitAdapter } from './adapter.js';
import { addConsumer, transitiveConsumers, type Dependents } from './dependents.js';
import { commandStep } from './step.js';

const GOAL = 'verify';

function unit(workspace: Pick<Workspace, 'root'>, relativeRoot: string): Project {
  const root = resolve(workspace.root, relativeRoot);
  return { name: relativeRoot === '.' ? basename(workspace.root) : relativeRoot, root, relativeRoot, sourceRoot: null, projectType: null, targets: { [GOAL]: {} }, configPath: join(root, 'pom.xml') };
}

// v1 reads the <module> entries of the root pom only (a flat reactor); a pom without modules is one unit.
function loadModules(workspace: Pick<Workspace, 'root'>): Project[] {
  const pom = readFileSync(join(workspace.root, 'pom.xml'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const modules = [...new Set([...pom.matchAll(/<module>\s*([^<]+?)\s*<\/module>/g)].map((match) => normalizePath(match[1]!).replace(/\/$/, '')))];
  if (!modules.length) return [unit(workspace, '.')];
  return modules.filter((module) => existsSync(join(workspace.root, module, 'pom.xml'))).map((module) => unit(workspace, module)).sort((left, right) => left.name.localeCompare(right.name));
}

function maven(workspace: Pick<Workspace, 'root'>): string {
  if (process.platform === 'win32') return existsSync(join(workspace.root, 'mvnw.cmd')) ? 'mvnw.cmd' : 'mvn';
  return existsSync(join(workspace.root, 'mvnw')) ? './mvnw' : 'mvn';
}

function verifyPlan(group: ChangeGroup): Omit<VerificationPlan, 'schemaVersion'> {
  const modules = loadModules(group.workspace);
  const buildFiles = modules.map((module) => module.configPath).concat(join(group.workspace.root, 'pom.xml'));
  const owners = [...new Set(group.changes.map((change) => resolveProject(change.absolutePath, modules)).filter((module): module is Project => module !== null))];
  if (group.changes.some(affectsWholeWorkspace) || owners.some((module) => module.relativeRoot === '.')) {
    return {
      affectedProjects: [{ workspace: group.workspace.relativeRoot, project: '*' }],
      steps: [commandStep(group.workspace, null, GOAL, [maven(group.workspace), '-q', GOAL], group.changes, buildFiles)],
    };
  }
  if (!owners.length) return { affectedProjects: [], steps: [] };
  const list = owners.map((module) => module.relativeRoot).sort().join(',');
  return {
    affectedProjects: owners.map((module) => ({ workspace: group.workspace.relativeRoot, project: module.name })),
    // One reactor run: -am builds what the changed modules need once instead of once per module.
    steps: [commandStep(group.workspace, list, GOAL, [maven(group.workspace), '-q', '-pl', list, '-am', GOAL], group.changes, buildFiles)],
  };
}

function tag(text: string, name: string): string | undefined {
  return new RegExp(`<${name}>\s*([^<]+?)\s*</${name}>`).exec(text)?.[1];
}

// A module's groupId:artifactId and the groupId:artifactId of each dependency it declares. Plugin and managed
// dependencies are not edges; a groupId left out is the parent's. v1 follows <dependency> edges, not <parent> links.
function coordinates(module: Project): { key: string; dependsOn: string[] } {
  const pom = readFileSync(module.configPath, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const parentGroup = tag(/<parent>[\s\S]*?<\/parent>/.exec(pom)?.[0] ?? '', 'groupId');
  const body = pom.replace(/<(parent|dependencyManagement|build)>[\s\S]*?<\/\1>/g, '');
  const head = body.split('<dependencies>')[0]!;
  const groupId = tag(head, 'groupId') ?? parentGroup;
  const dependsOn = [...body.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)].flatMap(([, dependency]) => {
    const group = tag(dependency!, 'groupId')?.replace(/^\$\{(?:project|pom)\.groupId\}$/, groupId ?? '');
    const artifact = tag(dependency!, 'artifactId');
    return group && artifact ? [`${group}:${artifact}`] : [];
  });
  return { key: `${groupId}:${tag(head, 'artifactId')}`, dependsOn };
}

function dependents(workspace: Workspace, unit: Project): Dependents {
  const modules = loadModules(workspace).map((module) => ({ name: module.name, ...coordinates(module) }));
  const nameOf = new Map(modules.map((module) => [module.key, module.name]));
  const consumers = new Map<string, string[]>();
  for (const module of modules) {
    for (const used of module.dependsOn) {
      const usedName = nameOf.get(used);
      if (usedName) addConsumer(consumers, usedName, module.name);
    }
  }
  return { status: 'ok', units: transitiveConsumers(consumers, unit.name), workspaces: [], notes: [] };
}

export const mavenAdapter: UnitAdapter = {
  name: 'maven',
  codeFiles: ['.java', '.kt', '.kts', '.xml'],
  detect: (directory) => existsSync(join(directory, 'pom.xml')),
  loadUnits: loadModules,
  verifyPlan,
  unitPlan: (workspace, module) => [commandStep(workspace, module.name, GOAL, module.relativeRoot === '.'
    ? [maven(workspace), '-q', GOAL]
    : [maven(workspace), '-q', '-pl', module.relativeRoot, '-am', GOAL], [], [module.configPath, join(workspace.root, 'pom.xml')])],
  dependents,
};
