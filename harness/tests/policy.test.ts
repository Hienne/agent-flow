import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { claudePolicyHook } from '../src/policy/claude-hook.js';
import { evaluatePolicy, type PolicyDecision } from '../src/policy/evaluator.js';
import { splitSegments } from '../src/policy/shell.js';
import { useRoot } from '../src/shared/paths.js';

function projectRoot(config: object): string {
  const root = mkdtempSync(join(tmpdir(), 'flow-policy-'));
  test.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.flow'));
  writeFileSync(join(root, '.flow', 'config.json'), JSON.stringify({ layout: 'umbrella', units: { adapters: ['nx'] }, ...config }), 'utf8');
  mkdirSync(join(root, 'unit-a', 'apps'), { recursive: true });
  writeFileSync(join(root, 'unit-a', 'package.json'), '{}', 'utf8');
  writeFileSync(join(root, 'unit-a', 'nx.json'), '{}', 'utf8');
  return root;
}

type Case = [command: string, cwd: string, expected: PolicyDecision];

function check(root: string, cases: Case[]): void {
  useRoot(root);
  for (const [command, cwd, expected] of cases) {
    const result = evaluatePolicy({ schemaVersion: 1, type: 'tool-call', host: 'claude', toolName: 'bash', cwd: join(root, cwd), command });
    assert.equal(result.decision, expected, `${command} (cwd ${cwd || '.'}): ${result.messages.join('; ')}`);
  }
}

test('Claude hook payloads map to deny, context and nothing', () => {
  const root = projectRoot({});
  useRoot(root);
  const deny = claudePolicyHook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git push' }, cwd: root });
  assert.equal((deny?.hookSpecificOutput as { permissionDecision?: string }).permissionDecision, 'deny');
  assert.equal(claudePolicyHook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git status' }, cwd: root }), null);
  assert.equal((claudePolicyHook({})?.hookSpecificOutput as { permissionDecision?: string }).permissionDecision, 'deny');
});

test('segments split only on separators outside quotes', () => {
  assert.deepEqual(splitSegments('grep -E "a|nx|b" file'), ['grep -E "a|nx|b" file']);
  assert.deepEqual(splitSegments("echo 'x; y' && git status || true"), ["echo 'x; y' ", ' git status ', ' true']);
  assert.deepEqual(splitSegments('echo "say \\"a|b\\"" | wc -l'), ['echo "say \\"a|b\\"" ', ' wc -l']);
  assert.deepEqual(splitSegments('a\nb & c'), ['a', 'b ', ' c']);
});

test('core rules apply with an empty policy', () => {
  check(projectRoot({}), [
    ['git push', '', 'block'],
    ['git -C unit-a push --force', '', 'block'],
    ['git status && git push origin HEAD', 'unit-a', 'block'],
    ['flow review record --task x --kind code-review', '', 'block'],
    ['flow review waive --task x --reason y', '', 'block'],
    ['flow review allow-tests --task x --reason y', '', 'block'],
    ['bash -c "git status && git push"', '', 'block'],
    ['powershell -Command "git push"', '', 'block'],
    ['echo "git push" > notes.md', '', 'allow'],
    ['grep -rn "git push" docs', '', 'allow'],
    ['npx nx test demo', '', 'allow'],
    ['glab mr create --title x', '', 'allow'],
  ]);
});

test('configured rules: unit-root-only executables, read-only CLIs and blocked patterns', () => {
  check(projectRoot({
    policy: {
      unitRootOnly: ['npm', 'npx', 'nx'],
      readOnlyCli: { glab: { allow: ['mr view', 'issue list'], valueOptions: ['-R', '--repo'] } },
      blockedCommands: [{ pattern: '\\brm\\s+-rf\\s+/', message: 'No recursive delete from the filesystem root.' }],
    },
  }), [
    ['grep -E "a|nx|b" file', '', 'allow'],
    ['grep -E "a|nx|b" file', 'unit-a', 'allow'],
    ['npx nx test demo', '', 'block'],
    ['npx nx test demo', 'unit-a/apps', 'block'],
    ['npx nx test demo', 'unit-a', 'allow'],
    ['cd unit-a && npm test', '', 'allow'],
    ['echo "$(npx nx show projects)"', '', 'block'],
    ['bash -c "npm run build"', '', 'block'],
    ['glab mr create --title view', 'unit-a', 'block'],
    ['glab mr view 12', 'unit-a', 'allow'],
    ['glab -R group/project mr view 12 --web', 'unit-a', 'allow'],
    ['glab issue list', 'unit-a', 'allow'],
    ['glab issue create', 'unit-a', 'block'],
    ['echo "glab mr create"', 'unit-a', 'allow'],
    ['sh -c "glab mr create"', 'unit-a', 'block'],
    ['rm -rf /', '', 'block'],
    ['rm -rf ./dist', '', 'allow'],
  ]);
});
