import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import test from 'node:test';
import { evaluatePolicy, validatePolicyEvent, type PolicyEvent } from '../src/policy/evaluator.js';
import type { ChangeGroup, TaskManifest, Workspace, WorkspaceChange } from '../src/shared/types.js';
import { artifactFrontier, checkArtifacts } from '../src/artifacts/artifacts.js';
import { collectWorkspaceChanges, countLines, reviewStats } from '../src/inspection/changes.js';
import { fileHash } from '../src/shared/filesystem.js';
import { ROOT, WORKTREES_DIRECTORY, logicalRelativePath, normalizePath, useRoot } from '../src/shared/paths.js';
import { run } from '../src/shared/process.js';
import { createIsolation, isolationBranch, removeIsolation, worktreePath } from '../src/task/isolation.js';
import { acquireTaskIsolation, beginVerification, findActiveTaskForTarget, findSharedIsolation, isolationGroup, loadTaskManifest, recordFormalReview, recordInspection, recordVerification, setTaskHandoff, startTaskManifest, taskManifestPath, updateTaskManifest } from '../src/task/manifest.js';
import { scopeChangesToTask } from '../src/task/scope.js';
import { bindSessionTask, commandTaskFeature, evaluateReviewGate, evaluateStop, markReviewerStarted, markReviewerStopped, parseReviewResult, reviewEvidence } from '../src/review/gate.js';
import { loadProjects } from '../src/topology/workspaces.js';
import { planVerification } from '../src/verification/planner.js';

const EVALS = join(import.meta.dirname, '..', 'evals', 'fixtures');

const FIXTURE_CONFIG = {
  layout: 'umbrella',
  units: { adapters: ['nx'] },
  policy: {
    unitRootOnly: ['npm', 'npx', 'nx', 'glab'],
    readOnlyCli: { glab: { allow: ['issue list', 'issue view', 'mr list', 'mr view', 'mr diff', 'repo view'], valueOptions: ['-R', '--repo'] } },
  },
};

// Every test runs against a throwaway umbrella root with one Nx workspace, `remote-a`.
const fixtureRoot = mkdtempSync(join(tmpdir(), 'flow-harness-root-'));
mkdirSync(join(fixtureRoot, '.flow'), { recursive: true });
writeFileSync(join(fixtureRoot, '.flow', 'config.json'), `${JSON.stringify(FIXTURE_CONFIG)}\n`, 'utf8');
mkdirSync(join(fixtureRoot, 'remote-a', 'apps', 'app-a'), { recursive: true });
writeFileSync(join(fixtureRoot, 'remote-a', 'package.json'), '{"name":"remote-a"}\n', 'utf8');
writeFileSync(join(fixtureRoot, 'remote-a', 'nx.json'), '{}\n', 'utf8');
useRoot(fixtureRoot);
test.after(() => rmSync(fixtureRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }));

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'flow-harness-'));
  test.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function fixtureWorkspace(root: string): Workspace {
  return { root, relativeRoot: 'fixture', name: 'fixture', adapter: 'nx', scripts: {} };
}

function taskEvent(overrides: Partial<PolicyEvent>): PolicyEvent {
  return { schemaVersion: 1, type: 'tool-call', host: 'manual', cwd: ROOT, ...overrides };
}

test('countLines does not count a trailing newline as content', () => {
  const path = join(temporaryDirectory(), 'sample.ts');
  writeFileSync(path, 'first\nsecond\n', 'utf8');
  assert.equal(countLines(path), 2);
});

test('formal review threshold uses code lines instead of total lines', () => {
  const stats = reviewStats([{
    changes: Array.from({ length: 6 }, (_, index) => ({ path: `file-${index}.md` })) as WorkspaceChange[],
    added: 500, deleted: 0, codeAdded: 80, codeDeleted: 20, codeFiles: 6,
  } as ChangeGroup]);
  assert.equal(stats.totalLines, 500);
  assert.equal(stats.codeLines, 100);
  assert.equal(stats.formalReviewRequired, false);
});

test('malformed Nx project configuration fails closed', () => {
  const directory = temporaryDirectory();
  mkdirSync(join(directory, 'apps', 'demo'), { recursive: true });
  writeFileSync(join(directory, 'apps', 'demo', 'project.json'), '{bad json', 'utf8');
  assert.throws(() => loadProjects({ root: directory, adapter: 'nx' }), /Invalid Nx project\.json/);
});

test('HTML-only changes still plan the configured project test target', () => {
  const directory = temporaryDirectory();
  const projectRoot = join(directory, 'apps', 'demo');
  mkdirSync(projectRoot, { recursive: true });
  writeFileSync(join(projectRoot, 'project.json'), JSON.stringify({ name: 'demo', root: 'apps/demo', targets: { test: { executor: '@nx/jest:jest' } } }), 'utf8');
  const htmlPath = join(projectRoot, 'demo.component.html');
  writeFileSync(htmlPath, '<div></div>\n', 'utf8');
  const change = { path: 'apps/demo/demo.component.html', absolutePath: htmlPath, exists: true, added: 1, deleted: 0, isCode: true, changedLines: new Set([1]), status: '??', untracked: true };
  const plan = planVerification([{ workspace: fixtureWorkspace(directory), available: true, changes: [change], scopeToOwners: true, added: 1, deleted: 0, codeAdded: 1, codeDeleted: 0, codeFiles: 1 }]);
  assert.ok(plan.steps.some((step) => step.id === 'fixture:demo:test'));
});

test('whole-workspace changes plan run-many for available targets only', () => {
  const directory = temporaryDirectory();
  const projectRoot = join(directory, 'apps', 'demo');
  mkdirSync(projectRoot, { recursive: true });
  writeFileSync(join(directory, 'package.json'), '{}\n', 'utf8');
  writeFileSync(join(projectRoot, 'project.json'), JSON.stringify({ name: 'demo', root: 'apps/demo', targets: { serve: {}, build: {} } }), 'utf8');
  const packagePath = join(directory, 'package.json');
  const changes = [{ path: 'package.json', absolutePath: packagePath, exists: true, added: 1, deleted: 0, isCode: true, changedLines: new Set([1]), status: 'M', untracked: false }];
  const plan = planVerification([{ workspace: fixtureWorkspace(directory), available: true, changes, scopeToOwners: true, added: 1, deleted: 0, codeAdded: 1, codeDeleted: 0, codeFiles: 1 }]);
  assert.deepEqual(plan.steps.map((step) => step.id), ['fixture:all:build']);
  assert.deepEqual(plan.affectedProjects, [{ workspace: 'fixture', project: '*' }]);
});

test('task manifest persists identity, source, targets, baseline, and plan', () => {
  const feature = `harness-task-${process.pid}`;
  const lock = join(ROOT, '.scratch', feature, '.task.lock');
  mkdirSync(join(ROOT, '.scratch', feature), { recursive: true });
  writeFileSync(lock, `${JSON.stringify({ pid: process.pid })}\n`, 'utf8');
  assert.throws(() => startTaskManifest({
    feature,
    source: 'conversation',
    inspections: [{ status: 'ok', target: 'fixture/apps/demo', workspace: { root: 'fixture' }, project: { name: 'demo' }, changes: { files: [] }, verification: [] }],
  }), /updated concurrently/);
  rmSync(lock);
  const manifest = startTaskManifest({
    feature,
    source: 'conversation',
    inspections: [{ status: 'ok', target: 'fixture/apps/demo', workspace: { root: 'fixture' }, project: { name: 'demo' }, changes: { files: [] }, verification: [] }],
  });
  assert.equal(manifest.taskId, `feature:${feature}`);
  assert.equal(manifest.source.type, 'conversation');
  assert.equal(manifest.targets[0]?.project, 'demo');
  assert.equal(manifest.plan.configFingerprint, fileHash([join(ROOT, '.flow', 'config.json')]));
  assert.ok(readFileSync(taskManifestPath(feature), 'utf8').includes('"schemaVersion": 2'));
  const manifestPath = taskManifestPath(feature);
  const legacyManifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { evidence: Record<string, unknown> };
  legacyManifest.evidence.reviews = [{
    capability: 'overengineering-review',
    artifact: `.scratch/${feature}/overengineering-review.md`,
    artifactHash: 'a'.repeat(64),
    changeFingerprint: 'b'.repeat(64),
    reviewedAt: new Date().toISOString(),
  }];
  writeFileSync(manifestPath, `${JSON.stringify(legacyManifest, null, 2)}\n`, 'utf8');
  assert.ok(!('reviews' in loadTaskManifest(feature)!.evidence));
  assert.equal(findActiveTaskForTarget(join(ROOT, 'fixture', 'apps', 'demo', 'demo.ts'))?.feature, feature);
  const implementing = recordInspection(feature, []);
  assert.ok(!readFileSync(manifestPath, 'utf8').includes('"reviews"'));
  assert.equal(implementing.phase, 'implementing');
  assert.equal(loadTaskManifest(feature)?.manifestRevision, 2);
  assert.throws(() => setTaskHandoff(feature, 'completed'), /successful verification/);
  assert.throws(() => recordVerification(feature, []), /without at least one/);
  recordInspection(feature, [
    { id: 'fixture:first', kind: 'configuration-error', workspace: 'fixture', project: null, message: 'first' },
    { id: 'fixture:second', kind: 'configuration-error', workspace: 'fixture', project: null, message: 'second' },
  ]);
  const verifying = beginVerification(feature);
  const incomplete = recordVerification(feature, [{ id: 'fixture:first', status: 'passed', cached: false }], verifying.manifestRevision);
  assert.equal(incomplete.state, 'active');
  assert.equal(incomplete.taskHandoff.reason, 'verification-incomplete');
  const blocked = setTaskHandoff(feature, 'blocked', 'waiting');
  assert.equal(blocked.state, 'blocked');
  const blockedWrite = evaluatePolicy(taskEvent({ toolName: 'edit', targets: [join(ROOT, 'remote-a', 'apps', 'blocked-task-proof.ts')], task: feature }));
  assert.equal(blockedWrite.decision, 'warn');
  const verifyingFeature = `${feature}-verify`;
  startTaskManifest({
    feature: verifyingFeature,
    source: 'conversation',
    inspections: [{ status: 'ok', target: 'remote-a/apps/app-a', workspace: { root: 'remote-a' }, project: { name: 'app-a' }, changes: { files: [] }, verification: [] }],
  });
  recordInspection(verifyingFeature, []);
  setTaskHandoff(verifyingFeature, 'ready-for-verification');
  const verifyingWrite = evaluatePolicy(taskEvent({ toolName: 'edit', targets: [join(ROOT, 'remote-a', 'apps', 'app-a', 'proof.ts')], task: verifyingFeature }));
  assert.equal(verifyingWrite.decision, 'block');
});

test('task scoping excludes unchanged baseline and reports later overlap', () => {
  const directory = temporaryDirectory();
  const projectRoot = join(directory, 'apps', 'demo');
  mkdirSync(projectRoot, { recursive: true });
  writeFileSync(join(projectRoot, 'project.json'), JSON.stringify({ name: 'demo', root: 'apps/demo', targets: {} }), 'utf8');
  const sourcePath = join(projectRoot, 'demo.ts');
  writeFileSync(sourcePath, 'const value = 1;\n', 'utf8');
  const change = { path: 'apps/demo/demo.ts', absolutePath: sourcePath, exists: true, added: 1, deleted: 0, isCode: true, changedLines: new Set([1]), status: 'M', untracked: false };
  const group = { workspace: fixtureWorkspace(directory), available: true, changes: [change], added: 1, deleted: 0, codeAdded: 1, codeDeleted: 0, codeFiles: 1 };
  const manifest = { targets: [{ workspace: 'fixture', project: 'demo', path: 'apps/demo' }], baseline: { dirtyFiles: { 'fixture/apps/demo/demo.ts': { fingerprint: fileHash([sourcePath]) } } } } as unknown as TaskManifest;
  assert.equal(scopeChangesToTask([group], manifest).groups[0]?.changes.length, 0);
  writeFileSync(sourcePath, 'const value = 2;\n', 'utf8');
  const scoped = scopeChangesToTask([group], manifest);
  assert.equal(scoped.groups[0]?.changes.length, 1);
  assert.equal(scoped.warnings.length, 1);
});

test('task scoping reports excluded sibling-project changes', () => {
  const directory = temporaryDirectory();
  const demoRoot = join(directory, 'apps', 'demo');
  const siblingRoot = join(directory, 'apps', 'sibling');
  mkdirSync(demoRoot, { recursive: true });
  mkdirSync(siblingRoot, { recursive: true });
  writeFileSync(join(demoRoot, 'project.json'), JSON.stringify({ name: 'demo', root: 'apps/demo', targets: {} }), 'utf8');
  writeFileSync(join(siblingRoot, 'project.json'), JSON.stringify({ name: 'sibling', root: 'apps/sibling', targets: {} }), 'utf8');
  const siblingPath = join(siblingRoot, 'sibling.ts');
  writeFileSync(siblingPath, 'export const sibling = true;\n', 'utf8');
  const change = { path: 'apps/sibling/sibling.ts', absolutePath: siblingPath, exists: true, added: 1, deleted: 0, isCode: true, changedLines: new Set([1]), status: 'M', untracked: false };
  const group = { workspace: fixtureWorkspace(directory), available: true, changes: [change], added: 1, deleted: 0, codeAdded: 1, codeDeleted: 0, codeFiles: 1 };
  const manifest = { targets: [{ workspace: 'fixture', project: 'demo', path: 'apps/demo' }], baseline: { dirtyFiles: {} } } as unknown as TaskManifest;
  const scoped = scopeChangesToTask([group], manifest);
  assert.equal(scoped.groups[0]?.changes.length, 0);
  assert.equal(scoped.warnings[0]?.file, 'apps/sibling/sibling.ts');
});

test('artifact frontier validates before returning ready tickets', () => {
  const valid = join(EVALS, 'valid');
  assert.equal(checkArtifacts(valid).status, 'passed');
  assert.deepEqual(artifactFrontier(valid).frontier.map((ticket) => ticket.id), ['02']);
});

test('invalid artifact frontier fails closed', () => {
  const result = artifactFrontier(join(EVALS, 'invalid'));
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.frontier, []);
});

test('policy blocks git push and allows every other git command', () => {
  const blocked = evaluatePolicy(taskEvent({ command: 'git push origin HEAD', cwd: join(ROOT, 'remote-a') }));
  const committed = evaluatePolicy(taskEvent({ command: 'git commit -m change', cwd: join(ROOT, 'remote-a') }));
  assert.equal(blocked.decision, 'block');
  assert.equal(committed.decision, 'allow');
});

test('task changes stay in scope when the developer commits mid-task', () => {
  const directory = temporaryDirectory();
  const git = (...gitArgs: string[]) => run('git', ['-c', 'user.name=harness', '-c', 'user.email=harness@example.invalid', ...gitArgs], { cwd: directory });
  git('init', '-q');
  writeFileSync(join(directory, 'a.ts'), 'export const a = 1;\n', 'utf8');
  writeFileSync(join(directory, 'b.ts'), 'export const b = 1;\n', 'utf8');
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  const base = run('git', ['rev-parse', 'HEAD'], { cwd: directory }).stdout.trim();
  writeFileSync(join(directory, 'a.ts'), 'export const a = 2;\n', 'utf8');
  git('commit', '-q', '-am', 'mid-task');
  writeFileSync(join(directory, 'b.ts'), 'export const b = 2;\n', 'utf8');
  const workspace = fixtureWorkspace(directory);

  const fromBase = collectWorkspaceChanges(workspace, base);
  const fromHead = collectWorkspaceChanges(workspace);

  assert.deepEqual(fromBase.changes.map((change) => change.path).sort(), ['a.ts', 'b.ts']);
  assert.deepEqual([...fromBase.changes.find((change) => change.path === 'a.ts')!.changedLines], [1]);
  assert.deepEqual(fromHead.changes.map((change) => change.path), ['b.ts']);
});

test('policy ignores heredoc data but checks heredocs read by a shell', () => {
  const script = "python - <<'EOF'\nprint('git push and glab mr merge 1 and npm install')\nEOF";
  assert.equal(evaluatePolicy(taskEvent({ command: script, cwd: ROOT })).decision, 'allow');
  assert.equal(evaluatePolicy(taskEvent({ command: 'cat > notes.md <<EOF\ngit push\nEOF', cwd: ROOT })).decision, 'allow');
  assert.equal(evaluatePolicy(taskEvent({ command: 'bash <<EOF\ngit push\nEOF', cwd: ROOT })).decision, 'block');
  assert.equal(evaluatePolicy(taskEvent({ command: "python - <<'EOF'\nx\nEOF\ngit push", cwd: ROOT })).decision, 'block');
});

test('policy blocks workspace commands at the umbrella root', () => {
  assert.equal(evaluatePolicy(taskEvent({ command: 'npx nx build demo', cwd: ROOT })).decision, 'block');
});

test('policy allows git from any cwd, including -C from the umbrella root', () => {
  assert.equal(evaluatePolicy(taskEvent({ command: 'git -C remote-a diff HEAD', cwd: ROOT })).decision, 'allow');
  assert.equal(evaluatePolicy(taskEvent({ command: 'git status', cwd: join(ROOT, 'remote-a', 'apps') })).decision, 'allow');
  assert.equal(evaluatePolicy(taskEvent({ command: 'git -C remote-a push', cwd: ROOT })).decision, 'block');
});

test('policy judges workspace commands at the directory an inline cd moves to', () => {
  const gitBashRoot = normalizePath(ROOT).replace(/^([A-Za-z]):/, (_match, drive: string) => `/${drive.toLowerCase()}`);
  assert.equal(evaluatePolicy(taskEvent({ command: 'cd remote-a && npm run dev', cwd: ROOT })).decision, 'allow');
  assert.equal(evaluatePolicy(taskEvent({ command: `cd ${normalizePath(join(ROOT, 'remote-a'))} && npx nx test demo`, cwd: ROOT })).decision, 'allow');
  assert.equal(evaluatePolicy(taskEvent({ command: `cd ${gitBashRoot}/remote-a; npx jest -c x`, cwd: ROOT })).decision, 'allow');
  assert.equal(evaluatePolicy(taskEvent({ command: 'cd remote-a/apps && npx jest', cwd: ROOT })).decision, 'block');
  assert.equal(evaluatePolicy(taskEvent({ command: 'npm test; cd remote-a', cwd: ROOT })).decision, 'block');
});

test('policy ignores workspace executables that only appear as arguments', () => {
  assert.equal(evaluatePolicy(taskEvent({ command: 'flow verify --task x 2>&1 | grep -v "npm warn" | tail -30', cwd: ROOT })).decision, 'allow');
  assert.equal(evaluatePolicy(taskEvent({ command: 'grep -rn "owning Nx workspace root" harness/src', cwd: ROOT })).decision, 'allow');
  assert.equal(evaluatePolicy(taskEvent({ command: 'echo $(npx nx show projects)', cwd: ROOT })).decision, 'block');
  assert.equal(evaluatePolicy(taskEvent({ command: 'bash -c "npx nx test demo"', cwd: ROOT })).decision, 'block');
});

test('successful Bash results invalidate verification cache without requesting formatting', () => {
  const result = evaluatePolicy({ schemaVersion: 1, type: 'tool-result', host: 'manual', cwd: ROOT, toolName: 'bash', isError: false });
  assert.deepEqual(result.effects, ['invalidate-verification-cache']);
});

test('policy detects global git options and environment-prefixed workspace commands', () => {
  assert.equal(evaluatePolicy(taskEvent({ command: 'git -C remote-a push --force', cwd: ROOT })).decision, 'block');
  assert.equal(evaluatePolicy(taskEvent({ command: 'NODE_OPTIONS=--trace-warnings npm run dev', cwd: ROOT })).decision, 'block');
  assert.equal(evaluatePolicy(taskEvent({ command: 'glab -R group/project issue create --title bad', cwd: ROOT })).decision, 'block');
});

test('policy catches shell wrappers and global mutation options', () => {
  const cwd = join(ROOT, 'remote-a');
  assert.equal(evaluatePolicy(taskEvent({ command: 'echo ok & npm run dev', cwd: ROOT })).decision, 'block');
  assert.equal(evaluatePolicy(taskEvent({ command: 'powershell -NoProfile -Command "npm run test"', cwd: ROOT })).decision, 'block');
  assert.equal(evaluatePolicy(taskEvent({ command: 'git --no-pager push origin main', cwd })).decision, 'block');
  assert.equal(evaluatePolicy(taskEvent({ command: 'glab api /projects --method=POST', cwd })).decision, 'block');
  assert.equal(evaluatePolicy(taskEvent({ command: 'glab api /projects -X=DELETE', cwd })).decision, 'block');
  assert.equal(evaluatePolicy(taskEvent({ command: 'glab api /projects --field name=demo', cwd })).decision, 'block');
  assert.equal(evaluatePolicy(taskEvent({ command: 'git --exec-path=x push', cwd })).decision, 'block');
  assert.equal(evaluatePolicy(taskEvent({ command: 'glab issue delete 1', cwd })).decision, 'block');
  assert.equal(evaluatePolicy(taskEvent({ command: 'glab --repo group/project mr merge 1', cwd })).decision, 'block');
  assert.equal(evaluatePolicy(taskEvent({ command: 'git branch feature', cwd })).decision, 'allow');
  assert.equal(evaluatePolicy(taskEvent({ command: 'git -c alias.p=push p', cwd })).decision, 'block');
  assert.equal(evaluatePolicy(taskEvent({ command: 'glab repo create demo', cwd })).decision, 'block');
  assert.equal(evaluatePolicy(taskEvent({ command: 'glab issue view 1', cwd })).decision, 'allow');
});

test('normalized policy events fail closed on malformed input', () => {
  assert.throws(() => validatePolicyEvent({}), /invalid schemaVersion/);
  assert.equal(evaluatePolicy(taskEvent({ command: 'git status && git push', cwd: join(ROOT, 'remote-a') })).decision, 'block');
  assert.equal(evaluatePolicy(taskEvent({ command: 'glab issue list; glab mr merge 1', cwd: join(ROOT, 'remote-a') })).decision, 'block');
  assert.throws(() => validatePolicyEvent({ schemaVersion: 1, type: 'tool-call', host: 'manual', cwd: ROOT, toolName: 'Edit', targets: [] }), /require targets/);
});

test('worktree paths map back to their logical workspace path', () => {
  assert.equal(logicalRelativePath('.worktrees/print-v2/remote-b/apps/app-b'), 'remote-b/apps/app-b');
  assert.equal(logicalRelativePath('.worktrees\\print-v2\\group\\remote-c'), 'group/remote-c');
  assert.equal(logicalRelativePath('remote-b/apps/app-b'), 'remote-b/apps/app-b');
  assert.equal(logicalRelativePath('.worktrees/print-v2'), '');
});

test('isolated tasks own a worktree branch and keep the user checkout off-limits', () => {
  const workspace = `harness-isolation-fixture-${process.pid}`;
  const feature = `harness-isolation-${process.pid}`;
  const source = join(ROOT, workspace);
  const git = (...gitArgs: string[]) => run('git', ['-c', 'user.name=harness', '-c', 'user.email=harness@example.invalid', ...gitArgs], { cwd: source });
  mkdirSync(join(source, 'apps', 'demo'), { recursive: true });
  mkdirSync(join(source, 'node_modules', 'marker'), { recursive: true });
  writeFileSync(join(source, 'package.json'), '{"name":"fixture"}\n', 'utf8');
  writeFileSync(join(source, 'nx.json'), '{}\n', 'utf8');
  writeFileSync(join(source, '.gitignore'), 'node_modules\n', 'utf8');
  writeFileSync(join(source, 'apps', 'demo', 'project.json'), '{"name":"demo","root":"apps/demo","targets":{}}\n', 'utf8');
  assert.equal(git('init', '--quiet').code, 0);
  assert.equal(git('add', '.').code, 0);
  assert.equal(git('commit', '--quiet', '-m', 'fixture').code, 0);

  assert.throws(() => createIsolation(feature, [workspace, `${workspace}-missing`]), /not the root of its own git repository/);
  assert.equal(existsSync(join(ROOT, WORKTREES_DIRECTORY, feature)), false);
  assert.notEqual(git('show-ref', '--verify', '--quiet', `refs/heads/${isolationBranch(feature)}`).code, 0);

  const { isolation } = createIsolation(feature, [workspace]);
  const worktree = worktreePath(isolation, workspace);
  assert.equal(run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: worktree }).stdout.trim(), isolationBranch(feature));
  assert.equal(run('git', ['status', '--porcelain'], { cwd: worktree }).stdout.trim(), '');
  assert.equal(existsSync(join(worktree, 'node_modules', 'marker')), true);
  assert.throws(() => createIsolation(feature, [workspace]), /already exists/);

  startTaskManifest({
    feature,
    inspections: [{ status: 'ok', target: normalizePath(relative(ROOT, join(worktree, 'apps', 'demo'))), workspace: { root: workspace }, project: { name: 'demo' }, changes: { files: [] }, verification: [] }],
    isolation,
  });
  const userWrite = evaluatePolicy(taskEvent({ toolName: 'edit', targets: [join(source, 'apps', 'demo', 'demo.ts')] }));
  assert.equal(userWrite.decision, 'block');
  assert.match(userWrite.messages.join('\n'), new RegExp(`${WORKTREES_DIRECTORY}/${feature}/${workspace}/apps/demo/demo\\.ts`));
  assert.equal(evaluatePolicy(taskEvent({ toolName: 'edit', targets: [join(worktree, 'apps', 'demo', 'demo.ts')] })).decision, 'allow');
  assert.equal(evaluatePolicy(taskEvent({ command: 'npm install lodash', cwd: worktree })).decision, 'block');
  assert.equal(evaluatePolicy(taskEvent({ command: 'npx nx run demo:lint', cwd: worktree })).decision, 'allow');
  assert.equal(evaluatePolicy(taskEvent({ command: 'npm install', cwd: source })).decision, 'allow');

  writeFileSync(join(worktree, 'apps', 'demo', 'demo.ts'), 'export const demo = 1;\n', 'utf8');
  assert.throws(() => removeIsolation(isolation, false), /uncommitted changes/);
  const removal = removeIsolation(isolation, true);
  assert.deepEqual(removal.deletedBranches, [workspace]);
  assert.equal(existsSync(join(ROOT, WORKTREES_DIRECTORY, feature)), false);
  assert.equal(existsSync(join(source, 'node_modules', 'marker')), true);
});

test('tickets of one feature share its worktree one task at a time', () => {
  const workspace = `harness-shared-fixture-${process.pid}`;
  const group = `harness-shared-${process.pid}`;
  const first = `${group}-t01`;
  const second = `${group}-t02`;
  const source = join(ROOT, workspace);
  const git = (...gitArgs: string[]) => run('git', ['-c', 'user.name=harness', '-c', 'user.email=harness@example.invalid', ...gitArgs], { cwd: source });
  mkdirSync(join(source, 'apps', 'demo'), { recursive: true });
  writeFileSync(join(source, 'package.json'), '{"name":"fixture"}\n', 'utf8');
  writeFileSync(join(source, 'nx.json'), '{}\n', 'utf8');
  writeFileSync(join(source, 'apps', 'demo', 'project.json'), '{"name":"demo","root":"apps/demo","targets":{}}\n', 'utf8');
  assert.equal(git('init', '--quiet').code, 0);
  assert.equal(git('add', '.').code, 0);
  assert.equal(git('commit', '--quiet', '-m', 'fixture').code, 0);

  assert.equal(isolationGroup(first, `.scratch/${group}/issues/01-first.md`), group);
  assert.equal(isolationGroup(first, 'conversation'), first);
  const seed = (target: string) => [{ status: 'ok' as const, target, workspace: { root: workspace }, project: { name: 'demo' }, changes: { files: [] }, verification: [] }];

  const firstIsolation = acquireTaskIsolation(first, `.scratch/${group}/issues/01-first.md`, [workspace]).isolation;
  assert.equal(firstIsolation.root, `${WORKTREES_DIRECTORY}/${group}`);
  assert.equal(firstIsolation.branch, isolationBranch(group));
  const worktree = worktreePath(firstIsolation, workspace);
  startTaskManifest({ feature: first, inspections: seed(normalizePath(relative(ROOT, worktree))), isolation: firstIsolation });
  writeFileSync(join(worktree, 'apps', 'demo', 'first.ts'), 'export const first = 1;\n', 'utf8');

  assert.throws(() => acquireTaskIsolation(second, `.scratch/${group}/issues/02-second.md`, [workspace]), /still held by feature:/);
  updateTaskManifest(first, (manifest) => ({ ...manifest, state: 'completed', phase: 'completed' }));

  const reused = acquireTaskIsolation(second, `.scratch/${group}/issues/02-second.md`, [workspace]);
  assert.equal(reused.isolation.root, firstIsolation.root);
  assert.match(reused.warnings.join('\n'), /Reusing/);
  reused.rollback();
  assert.equal(existsSync(join(worktree, 'apps', 'demo', 'first.ts')), true);
  startTaskManifest({ feature: second, inspections: seed(normalizePath(relative(ROOT, worktree))), isolation: reused.isolation });
  assert.deepEqual(findSharedIsolation(firstIsolation.root)?.tasks.map((task) => task.feature).sort(), [first, second]);

  rmSync(join(worktree, '.git'));
  mkdirSync(join(worktree, '.nx', 'cache', 'outputs'), { recursive: true });
  writeFileSync(join(worktree, '.nx', 'cache', 'outputs', 'left-behind.txt'), 'partial delete\n', 'utf8');
  const removal = removeIsolation(findSharedIsolation(firstIsolation.root)!.isolation, true);
  assert.deepEqual(removal.deletedBranches, [workspace]);
  assert.equal(existsSync(join(ROOT, WORKTREES_DIRECTORY, group)), false);
  assert.doesNotMatch(git('worktree', 'list').stdout, new RegExp(group));
});

test('spawn failures never report successful process results', () => {
  assert.notEqual(run('flow-command-that-does-not-exist', []).code, 0);
});

test('formal review threshold also catches deep changes in few files', () => {
  const stats = (codeLines: number, codeFiles: number) => reviewStats([{
    changes: Array.from({ length: codeFiles }, (_, index) => ({ path: `file-${index}.ts` })) as WorkspaceChange[],
    added: codeLines, deleted: 0, codeAdded: codeLines, codeDeleted: 0, codeFiles,
  } as ChangeGroup]);
  assert.equal(stats(300, 2).formalReviewRequired, false);
  assert.equal(stats(301, 1).formalReviewRequired, true);
  assert.equal(stats(101, 6).formalReviewRequired, true);
});

test('formal review gate requires fresh evidence for both kinds or a user waiver', () => {
  const base = { evidence: { verification: [], lastChangeSnapshotAt: null } } as unknown as TaskManifest;
  const stats = { codeLines: 400, codeFiles: 8, formalReviewRequired: true } as ReturnType<typeof reviewStats>;
  const files = Array.from({ length: 8 }, (_, index) => `ws/file-${index}.ts`);
  assert.deepEqual(evaluateReviewGate(base, stats, files).missing, ['code-review', 'code-simplification']);
  const reviewed = { evidence: { ...base.evidence, formalReviews: [
    reviewEvidence({ kind: 'code-review', source: 'subagent', stats, files }),
    reviewEvidence({ kind: 'code-simplification', source: 'subagent', stats, files }),
  ] } } as unknown as TaskManifest;
  assert.equal(evaluateReviewGate(reviewed, stats, files).satisfied, true);
  assert.equal(evaluateReviewGate(reviewed, { ...stats, codeLines: 480 }, files).satisfied, true);
  assert.deepEqual(evaluateReviewGate(reviewed, { ...stats, codeLines: 520 }, files).stale, ['code-review', 'code-simplification']);
  const grown = [...files, ...Array.from({ length: 6 }, (_, index) => `ws/new-${index}.ts`)];
  assert.equal(evaluateReviewGate(reviewed, stats, grown).satisfied, false);
  const waived = { evidence: { ...base.evidence, formalReviews: [reviewEvidence({ kind: 'waiver', source: 'user', stats, files, reason: 'owner declined' })] } } as unknown as TaskManifest;
  assert.equal(evaluateReviewGate(waived, stats, files).waived, true);
  assert.equal(evaluateReviewGate(base, { ...stats, formalReviewRequired: false }, files).required, false);
});

test('passing verification without review evidence parks the task in reviewing', () => {
  const feature = `harness-review-${process.pid}`;
  startTaskManifest({
    feature,
    source: 'conversation',
    inspections: [{ status: 'ok', target: 'fixture/apps/demo', workspace: { root: 'fixture' }, project: { name: 'demo' }, changes: { files: [] }, verification: [] }],
  });
  recordInspection(feature, [{ id: 'fixture:check', kind: 'configuration-error', workspace: 'fixture', project: null, message: 'check' }]);
  const stats = { codeLines: 400, codeFiles: 8, formalReviewRequired: true } as ReturnType<typeof reviewStats>;
  const pending = evaluateReviewGate(loadTaskManifest(feature)!, stats, []);
  const verifying = beginVerification(feature);
  const parked = recordVerification(feature, [{ id: 'fixture:check', status: 'passed', cached: false }], verifying.manifestRevision, pending);
  assert.equal(parked.state, 'active');
  assert.equal(parked.phase, 'reviewing');
  assert.equal(parked.taskHandoff.reason, 'formal-review-required');
  assert.throws(() => setTaskHandoff(feature, 'completed'), /formal code-review/);

  const sessionId = `session-${process.pid}`;
  assert.equal(evaluateStop(sessionId, [parked]).decision, 'allow');
  bindSessionTask(sessionId, feature);
  assert.ok(existsSync(join(ROOT, '.scratch', '.flow', 'sessions', `${sessionId}.json`)));
  assert.equal(evaluateStop(sessionId, [parked]).decision, 'block');
  assert.equal(evaluateStop(sessionId, [parked]).decision, 'block');
  markReviewerStarted(sessionId, 'flow:code-reviewer');
  assert.equal(evaluateStop(sessionId, [parked]).decision, 'allow');
  markReviewerStopped(sessionId, 'flow:code-reviewer');
  const exhausted = evaluateStop(sessionId, [parked]);
  assert.equal(exhausted.decision, 'allow');
  assert.match(exhausted.decision === 'allow' ? exhausted.message ?? '' : '', /stays incomplete/);

  recordFormalReview(feature, reviewEvidence({ kind: 'code-review', source: 'subagent', stats, files: [] }));
  const reviewed = recordFormalReview(feature, reviewEvidence({ kind: 'code-simplification', source: 'subagent', stats, files: [] }));
  assert.equal(evaluateStop(sessionId, [reviewed]).decision, 'allow');
  const gate = evaluateReviewGate(reviewed, stats, []);
  const again = beginVerification(feature);
  const completed = recordVerification(feature, [{ id: 'fixture:check', status: 'passed', cached: false }], again.manifestRevision, gate);
  assert.equal(completed.state, 'completed');
  assert.throws(() => recordFormalReview(feature, reviewEvidence({ kind: 'code-review', source: 'manual', stats, files: [] })), /completed/);
});

test('reviewer result marker and task command parsing', () => {
  assert.deepEqual(parseReviewResult('## Standards\n...\nFLOW-REVIEW-RESULT task=order-lookup blocking=1 non-blocking=3'), { feature: 'order-lookup', blocking: 1, nonBlocking: 3 });
  assert.equal(parseReviewResult('no marker here'), null);
  assert.equal(commandTaskFeature('flow verify --task order-lookup'), 'order-lookup');
  assert.equal(commandTaskFeature('flow task start order-lookup --target remote-c'), 'order-lookup');
  assert.equal(commandTaskFeature('npx nx test demo --task other'), null);
});

test('Claude hosts cannot record or waive formal review evidence by hand', () => {
  const record = 'flow review record --task demo --kind code-review';
  assert.equal(evaluatePolicy(taskEvent({ host: 'claude', toolName: 'bash', command: record })).decision, 'block');
  assert.equal(evaluatePolicy(taskEvent({ host: 'manual', toolName: 'bash', command: record })).decision, 'allow');
  const waive = 'flow review waive --task demo --reason skip';
  assert.match(evaluatePolicy(taskEvent({ host: 'claude', toolName: 'bash', command: waive })).messages.join(' '), /Only the user/);
  assert.equal(validatePolicyEvent(taskEvent({ toolName: 'bash', command: 'ls', sessionId: 'abc' })).sessionId, 'abc');
});
