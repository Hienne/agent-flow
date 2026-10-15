import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { NotInitialisedError, initRoot, loadConfig, parseConfig, verifyTargets } from '../src/config/config.js';
import { inspectTarget } from '../src/inspection/inspect.js';
import { ARTIFACTS_ROOT, ROOT, SCRATCH_ROOT, discoverRoot, useRoot } from '../src/shared/paths.js';
import { run } from '../src/shared/process.js';
import { discoverWorkspaces, findWorkspace } from '../src/topology/workspaces.js';

const UMBRELLA = join(import.meta.dirname, '..', 'evals', 'fixtures', 'nx-umbrella');

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'flow-config-'));
  test.after(() => rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }));
  return directory;
}

test('root discovery walks up to the nearest .flow/config.json and stops at none', () => {
  assert.equal(discoverRoot([join(UMBRELLA, 'remote-a', 'apps', 'app-a', 'src')]), UMBRELLA);
  assert.equal(discoverRoot([undefined, temporaryDirectory()]), null);
  assert.throws(() => loadConfig(temporaryDirectory()), NotInitialisedError);
});

test('initRoot binds the artifact and state roots from artifactsDir', () => {
  const root = temporaryDirectory();
  mkdirSync(join(root, '.flow'));
  writeFileSync(join(root, '.flow', 'config.json'), '{ "layout": "single", "artifactsDir": "work", "units": { "adapters": ["nx"] } }\n', 'utf8');
  assert.equal(initRoot([join(root)]), true);
  assert.equal(ROOT, root);
  assert.equal(ARTIFACTS_ROOT, join(root, 'work'));
  assert.equal(SCRATCH_ROOT, join(root, 'work', '.flow'));
  assert.equal(initRoot([temporaryDirectory()]), false);
});

test('config parsing rejects unknown fields, layouts and adapters', () => {
  assert.throws(() => parseConfig({ layout: 'umbrella', units: { adapters: ['nx'] }, extra: 1 }), /unknown fields: extra/);
  assert.throws(() => parseConfig({ layout: 'flat', units: { adapters: ['nx'] } }), /layout/);
  assert.throws(() => parseConfig({ layout: 'single', units: { adapters: ['cobol'] } }), /unknown adapter cobol/);
  assert.throws(() => parseConfig({ layout: 'single', units: { adapters: [] } }), /at least one adapter/);
  assert.throws(() => parseConfig({ layout: 'single', units: { adapters: ['nx'] }, review: { broad: [1] } }), /review\.broad/);
  const config = parseConfig({ layout: 'single', units: { adapters: ['nx'] } });
  assert.deepEqual(verifyTargets(config), ['lint', 'test', 'build']);
  assert.deepEqual(verifyTargets({ ...config, verify: { targets: ['test'] } }), ['test']);
});

test('umbrella layout finds nested workspaces and never treats the root as one', () => {
  useRoot(UMBRELLA);
  assert.deepEqual(discoverWorkspaces().map((workspace) => workspace.relativeRoot), ['lib-common', 'remote-a', 'shell-app']);
  assert.equal(findWorkspace(join(UMBRELLA, 'remote-a', 'libs', 'ui-a', 'src', 'index.ts'))?.relativeRoot, 'remote-a');
  assert.equal(findWorkspace(UMBRELLA), null);
});

test('single layout treats the root itself as the workspace', () => {
  const root = temporaryDirectory();
  mkdirSync(join(root, '.flow'));
  mkdirSync(join(root, 'apps', 'demo'), { recursive: true });
  writeFileSync(join(root, '.flow', 'config.json'), '{ "layout": "single", "units": { "adapters": ["nx"] } }\n', 'utf8');
  writeFileSync(join(root, 'package.json'), '{"name":"solo"}\n', 'utf8');
  writeFileSync(join(root, 'nx.json'), '{}\n', 'utf8');
  useRoot(root);
  assert.deepEqual(discoverWorkspaces().map((workspace) => [workspace.name, workspace.relativeRoot]), [['solo', '.']]);
  assert.equal(findWorkspace(join(root, 'apps', 'demo'))?.relativeRoot, '.');
});

// AC-006: the same change in the nx-umbrella layout plans the same per-project Nx targets the original harness planned.
test('nx-umbrella: a change in one app plans that app\'s lint, test and build with its workspace as cwd', () => {
  const root = temporaryDirectory();
  cpSync(UMBRELLA, root, { recursive: true });
  const workspace = join(root, 'remote-a');
  const git = (...gitArgs: string[]) => run('git', ['-c', 'user.name=harness', '-c', 'user.email=harness@example.invalid', ...gitArgs], { cwd: workspace });
  git('init', '-q');
  git('add', '.');
  git('commit', '-q', '-m', 'fixture');
  writeFileSync(join(workspace, 'apps', 'app-a', 'src', 'main.ts'), 'export const appA = 2;\n', 'utf8');
  useRoot(root);

  const result = inspectTarget(join(workspace, 'apps', 'app-a'));

  assert.equal(result.status, 'ok');
  assert.deepEqual(result.task?.kinds, ['code']);
  assert.deepEqual(result.context?.docs, ['remote-a/CONTEXT.md']);
  assert.equal(result.context?.preflights.length, 1);
  assert.deepEqual(result.verification?.map((step) => step.id), ['remote-a:app-a:lint', 'remote-a:app-a:test', 'remote-a:app-a:build']);
  const lint = result.verification?.[0];
  assert.ok(lint?.kind === 'command');
  assert.deepEqual(lint.command, ['npx', 'nx', 'run', 'app-a:lint']);
  assert.equal(lint.cwd, workspace);
});
