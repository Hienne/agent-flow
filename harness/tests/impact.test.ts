import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { impactOfChanges, impactOfInputs, planWarnings } from '../src/inspection/impact.js';
import { useRoot } from '../src/shared/paths.js';
import type { ChangeGroup, Workspace, WorkspaceChange } from '../src/shared/types.js';
import { unitAdapter } from '../src/units/adapter.js';
import { discoverWorkspaces } from '../src/topology/workspaces.js';
import { planVerification } from '../src/verification/planner.js';

const FIXTURES = join(import.meta.dirname, '..', 'evals', 'fixtures');

function copy(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `flow-${name}-`));
  test.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }));
  cpSync(join(FIXTURES, name), root, { recursive: true });
  useRoot(root);
  return root;
}

function workspaceNamed(relativeRoot: string): Workspace {
  const workspace = discoverWorkspaces().find((candidate) => candidate.relativeRoot === relativeRoot);
  assert.ok(workspace, `workspace ${relativeRoot}`);
  return workspace;
}

function unitNamed(workspace: Workspace, name: string) {
  const unit = unitAdapter(workspace.adapter).loadUnits(workspace).find((candidate) => candidate.name === name);
  assert.ok(unit, `unit ${name}`);
  return unit;
}

function group(workspace: Workspace, paths: string[]): ChangeGroup {
  const changes: WorkspaceChange[] = paths.map((path) => ({ path, status: 'M', untracked: false, absolutePath: join(workspace.root, path), exists: true, added: 1, deleted: 0, isCode: true, changedLines: new Set([1]) }));
  return { workspace, available: true, changes, added: changes.length, deleted: 0, codeAdded: changes.length, codeDeleted: 0, codeFiles: changes.length };
}

// Nx 18 keeps the project graph at <workspace>/.nx/cache/project-graph.json; dependencies map a source to its edges.
function writeGraph(workspaceRoot: string, edges: Array<[string, string]>, names: string[]): void {
  const dependencies: Record<string, Array<{ source: string; target: string; type: string }>> = Object.fromEntries(names.map((name) => [name, []]));
  for (const [source, target] of edges) dependencies[source]!.push({ source, target, type: 'static' });
  mkdirSync(join(workspaceRoot, '.nx', 'cache'), { recursive: true });
  const nodes = Object.fromEntries(names.map((name) => [name, { name, type: 'lib', data: { root: name } }]));
  writeFileSync(join(workspaceRoot, '.nx', 'cache', 'project-graph.json'), JSON.stringify({ nodes, externalNodes: { 'npm:rxjs': {} }, dependencies, version: '6.0' }), 'utf8');
}

// AC-025
test('nx umbrella: a changed lib lists the workspaces whose package.json depends on its package, file: included', () => {
  copy('nx-umbrella');
  const lib = workspaceNamed('lib-common');
  const result = unitAdapter('nx').dependents(lib, unitNamed(lib, 'common'));
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.status === 'ok' && result.workspaces, [{ workspace: 'remote-a', spec: 'file:../lib-common/dist/libs/common' }]);
});

test('nx umbrella: a registry version of the package counts too, from any dependency section', () => {
  const root = copy('nx-umbrella');
  writeFileSync(join(root, 'shell-app', 'package.json'), JSON.stringify({ name: 'shell-app', devDependencies: { '@demo/common': '^1.2.0' } }), 'utf8');
  const lib = workspaceNamed('lib-common');
  const result = unitAdapter('nx').dependents(lib, unitNamed(lib, 'common'));
  assert.deepEqual(result.status === 'ok' && result.workspaces.map((entry) => entry.workspace), ['remote-a', 'shell-app']);
});

test('nx: dependent projects come from the cached project graph, transitively and without external nodes', () => {
  const root = copy('nx-umbrella');
  const remote = workspaceNamed('remote-a');
  writeGraph(join(root, 'remote-a'), [['app-a', 'ui-a'], ['feature-x', 'app-a'], ['app-a', 'npm:rxjs']], ['app-a', 'ui-a', 'feature-x']);
  const result = unitAdapter('nx').dependents(remote, unitNamed(remote, 'ui-a'));
  assert.deepEqual(result.status === 'ok' && result.units, ['app-a', 'feature-x']);
  const leaf = unitAdapter('nx').dependents(remote, unitNamed(remote, 'app-a'));
  assert.deepEqual(leaf.status === 'ok' && leaf.units, ['feature-x']);
});

test('nx: without a cached graph the project dependents are unknown and the result says so, nx is never run', () => {
  copy('nx-umbrella');
  const remote = workspaceNamed('remote-a');
  const result = unitAdapter('nx').dependents(remote, unitNamed(remote, 'ui-a'));
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.status === 'ok' && result.units, []);
  assert.match(result.status === 'ok' ? result.notes.join('\n') : '', /project graph/);
});

test('maven: modules that depend on the changed module in the reactor, groupId inherited from the parent', () => {
  copy('maven-multi');
  const [workspace] = discoverWorkspaces();
  assert.ok(workspace);
  const adapter = unitAdapter('maven');
  const a = adapter.dependents(workspace, unitNamed(workspace, 'a'));
  assert.deepEqual(a.status === 'ok' && a.units, ['b']);
  const b = adapter.dependents(workspace, unitNamed(workspace, 'b'));
  assert.deepEqual(b.status === 'ok' && b.units, []);
});

test('gradle and npm report dependents as unavailable', () => {
  for (const name of ['gradle-multi', 'npm-single']) {
    copy(name);
    const [workspace] = discoverWorkspaces();
    assert.ok(workspace);
    const [unit] = unitAdapter(workspace.adapter).loadUnits(workspace);
    assert.equal(unitAdapter(workspace.adapter).dependents(workspace, unit!).status, 'unavailable', name);
  }
});

test('the impact of a change set is one entry per owning unit, and unowned files are skipped', () => {
  copy('maven-multi');
  const [workspace] = discoverWorkspaces();
  assert.ok(workspace);
  const impacts = impactOfChanges([group(workspace, ['a/src/main/java/demo/A.java', 'a/pom.xml', 'README.md'])]);
  assert.deepEqual(impacts.map((impact) => impact.unit), ['a']);
});

test('inputs resolve from a path or a unit name; an input no unit owns is an error', () => {
  const root = copy('nx-umbrella');
  const byPath = impactOfInputs([join(root, 'lib-common', 'libs', 'common', 'src', 'index.ts')]);
  const byName = impactOfInputs(['common']);
  assert.deepEqual(byPath.map((impact) => [impact.workspace, impact.unit]), [['lib-common', 'common']]);
  assert.deepEqual(byName, byPath);
  assert.throws(() => impactOfInputs([join(root, 'lib-common', 'nx.json')]), /No unit owns/);
  assert.throws(() => impactOfInputs(['no-such-unit']), /No unit owns/);
});

// AC-025: verify --plan prints impact as a warning and the plan itself does not change.
test('plan warnings list dependents and notes only, and planning never reads impact', () => {
  const root = copy('nx-umbrella');
  const lib = workspaceNamed('lib-common');
  const changed = group(lib, ['libs/common/src/index.ts']);
  const before = JSON.stringify(planVerification([{ ...changed, scopeToOwners: true }]));
  const warnings = planWarnings(impactOfChanges([changed]));
  assert.equal(warnings.length, 2);
  assert.match(warnings[0]!, /^WARNING impact lib-common\/common: workspaces remote-a \(file:\.\.\/lib-common\/dist\/libs\/common\)$/);
  assert.match(warnings[1]!, /^WARNING impact lib-common\/common: no cached Nx project graph/);
  assert.equal(JSON.stringify(planVerification([{ ...changed, scopeToOwners: true }])), before);
  // A unit nobody consumes adds nothing once its graph is cached, and an adapter without a graph never warns.
  writeGraph(join(root, 'shell-app'), [], ['shell']);
  assert.deepEqual(planWarnings(impactOfChanges([group(workspaceNamed('shell-app'), ['apps/shell/src/main.ts'])])), []);
  copy('npm-single');
  const [npm] = discoverWorkspaces();
  assert.deepEqual(planWarnings(impactOfChanges([group(npm!, ['package.json'])])), []);
});
