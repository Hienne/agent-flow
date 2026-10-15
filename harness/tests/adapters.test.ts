import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { detectConfig } from '../src/init/init.js';
import { useRoot } from '../src/shared/paths.js';
import type { ChangeGroup, WorkspaceChange } from '../src/shared/types.js';
import { discoverWorkspaces, findWorkspace } from '../src/topology/workspaces.js';
import { globPattern, planVerification } from '../src/verification/planner.js';

const FIXTURES = join(import.meta.dirname, '..', 'evals', 'fixtures');
const windows = process.platform === 'win32';

function copy(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `flow-${name}-`));
  test.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }));
  cpSync(join(FIXTURES, name), root, { recursive: true });
  return root;
}

// The plan the changed paths produce in the project at root, as one command per step.
function plan(root: string, paths: string[]): string[] {
  useRoot(root);
  const [workspace] = discoverWorkspaces();
  assert.ok(workspace);
  const changes: WorkspaceChange[] = paths.map((path) => ({ path, status: 'M', untracked: false, absolutePath: join(root, path), exists: true, added: 1, deleted: 0, isCode: true, changedLines: new Set([1]) }));
  const group: ChangeGroup = { workspace, available: true, changes, added: changes.length, deleted: 0, codeAdded: changes.length, codeDeleted: 0, codeFiles: changes.length };
  return planVerification([group]).steps.map((step) => (step.kind === 'command' ? step.command.join(' ') : step.message));
}

// AC-007
test('maven: a change in module b verifies b and what it needs, through the wrapper when there is one', () => {
  const root = copy('maven-multi');
  assert.deepEqual(plan(root, ['b/src/main/java/demo/B.java']), ['mvn -q -pl b -am verify']);
  assert.deepEqual(plan(root, ['b/src/main/java/demo/B.java', 'a/pom.xml']), ['mvn -q -pl a,b -am verify']);
  assert.deepEqual(plan(root, ['pom.xml']), ['mvn -q verify']);
  assert.deepEqual(plan(root, ['README.md']), []);
  writeFileSync(join(root, windows ? 'mvnw.cmd' : 'mvnw'), '', 'utf8');
  assert.deepEqual(plan(root, ['b/src/main/java/demo/B.java']), [`${windows ? 'mvnw.cmd' : './mvnw'} -q -pl b -am verify`]);
});

// AC-008
test('gradle: a change in :b runs :b:check through gradlew (gradlew.bat on Windows)', () => {
  const root = copy('gradle-multi');
  const gradlew = windows ? 'gradlew.bat' : './gradlew';
  assert.deepEqual(plan(root, ['b/src/main/java/demo/B.java']), [`${gradlew} :b:check`]);
  assert.deepEqual(plan(root, ['b/src/main/java/demo/B.java', 'a/build.gradle.kts']), [`${gradlew} :a:check :b:check`]);
  assert.deepEqual(plan(root, ['settings.gradle.kts']), [`${gradlew} check`]);
  rmSync(join(root, 'gradlew'));
  rmSync(join(root, 'gradlew.bat'));
  assert.deepEqual(plan(root, ['b/src/main/java/demo/B.java']), ['gradle :b:check']);
});

test('flow init detects maven and gradle workspaces', () => {
  assert.deepEqual(detectConfig(join(FIXTURES, 'maven-multi')), { layout: 'single', units: { adapters: ['maven'] } });
  assert.deepEqual(detectConfig(join(FIXTURES, 'gradle-multi')), { layout: 'single', units: { adapters: ['gradle'] } });
});

test('a module or subproject path belongs to the workspace at the root, not to its own build file', () => {
  for (const name of ['maven-multi', 'gradle-multi']) {
    const root = copy(name);
    useRoot(root);
    assert.equal(findWorkspace(join(root, 'b', 'src', 'main', 'java'))?.root, root);
  }
});

// AC-009
test('npm: the plan runs only the lint, test and build scripts package.json declares, with the configured package manager', () => {
  const root = copy('npm-single');
  assert.deepEqual(plan(root, ['src/index.js']), ['npm run lint', 'npm run test']);
  writeFileSync(join(root, 'yarn.lock'), '', 'utf8');
  assert.deepEqual(plan(root, ['src/index.js']), ['yarn run lint', 'yarn run test']);
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ ...manifest, packageManager: 'pnpm@9.1.0' }), 'utf8');
  assert.deepEqual(plan(root, ['src/index.js']), ['pnpm run lint', 'pnpm run test']);
  const config = JSON.parse(readFileSync(join(root, '.flow', 'config.json'), 'utf8'));
  writeFileSync(join(root, '.flow', 'config.json'), JSON.stringify({ ...config, units: { adapters: ['npm'], packageManager: 'bun' } }), 'utf8');
  assert.deepEqual(plan(root, ['src/index.js']), ['bun run lint', 'bun run test']);
});

test('verify.custom adds its command when a changed file matches, documentation-only changes included', () => {
  const root = copy('npm-single');
  assert.deepEqual(plan(root, ['docs/guide/intro.md']), ['node -e 0']);
  assert.deepEqual(plan(root, ['src/index.js', 'docs/guide/intro.md']), ['npm run lint', 'npm run test', 'node -e 0']);
  assert.deepEqual(plan(root, ['README.md']), []);
});

test('glob patterns: ** crosses directories, * and ? stay in one segment', () => {
  const matches = (glob: string, path: string) => globPattern(glob).test(path);
  assert.ok(matches('docs/**/*.md', 'docs/a.md'));
  assert.ok(matches('docs/**/*.md', 'docs/x/y/a.md'));
  assert.ok(!matches('docs/*.md', 'docs/x/a.md'));
  assert.ok(matches('plugins/**', 'plugins/flow/skills/a/SKILL.md'));
  assert.ok(matches('src/?.ts', 'src/a.ts'));
  assert.ok(!matches('src/?.ts', 'src/ab.ts'));
  assert.ok(!matches('a.md', 'aXmd'));
});

test('flow init detects npm, and nx still wins over npm in an nx workspace', () => {
  assert.deepEqual(detectConfig(join(FIXTURES, 'npm-single')), { layout: 'single', units: { adapters: ['npm'] } });
  assert.deepEqual(detectConfig(join(FIXTURES, 'nx-umbrella', 'remote-a')), { layout: 'single', units: { adapters: ['nx'] } });
});
