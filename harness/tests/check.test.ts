import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';
import { BANNED_PATTERNS, checkRepository } from '../src/check/check.js';
import { SESSION_CONTEXT_HOOK, sessionStartOutput } from '../src/context/session.js';
import type { FlowConfig } from '../src/config/config.js';
import { run } from '../src/shared/process.js';

const REPOSITORY = join(import.meta.dirname, '..', '..');
const FIXTURE = join(import.meta.dirname, '..', 'evals', 'fixtures', 'check-broken');
// Built at runtime so this file does not contain the strings it tests.
const banned = (reversed: string) => [...reversed].reverse().join('');
const isBanned = (text: string) => BANNED_PATTERNS.some((pattern) => pattern.test(text));

test('banned strings match words and prefixes but not schema or schedule', () => {
  for (const text of [banned('vdib'), `${banned('hcs')}-harness`, `${banned('hcs')}_x`, `the ${banned('HCS')} umbrella`, `a.${banned('hcs')}.b`, `${banned('-tms')}transaction`, banned('tioa'), banned('tsetdupadl')]) {
    assert.ok(isBanned(text), text);
  }
  for (const text of ['schema', 'config.schema.json', 'schedule', 'scheduler', 'Schema', 'rescheduled']) assert.ok(!isBanned(text), text);
});

test('flow check reports banned strings in content and in file names', () => {
  const root = mkdtempSync(join(tmpdir(), 'flow-check-'));
  test.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'notes.md'), `fine\nsee ${banned('vdib')} here\n`, 'utf8');
  mkdirSync(join(root, `${banned('hcs')}-docs`));
  writeFileSync(join(root, `${banned('hcs')}-docs`, 'readme.md'), 'clean\n', 'utf8');
  writeFileSync(join(root, 'schema.md'), 'schedule\n', 'utf8');
  mkdirSync(join(root, 'node_modules'));
  writeFileSync(join(root, 'node_modules', 'skipped.md'), banned('vdib'), 'utf8');
  const problems = checkRepository(root).map((problem) => `${problem.file}:${problem.line ?? '-'}`);
  assert.deepEqual(problems.sort(), ['notes.md:2', `${banned('hcs')}-docs/readme.md:-`]);

  // In a git checkout, ignored files (task state with machine paths) are not repository content.
  run('git', ['init', '-q'], { cwd: root });
  writeFileSync(join(root, '.gitignore'), 'node_modules/\n.scratch/\n', 'utf8');
  mkdirSync(join(root, '.scratch'));
  writeFileSync(join(root, '.scratch', 'task.json'), banned('vdib'), 'utf8');
  assert.deepEqual(checkRepository(root).map((problem) => `${problem.file}:${problem.line ?? '-'}`).sort(), problems.sort());
});

// AC-019: broken skill, agent, principle and plugin-root references fail; valid and dependency references pass.
test('flow check reports broken references and frontmatter in the fixture', () => {
  const problems = checkRepository(FIXTURE).map((problem) => `${problem.file}:${problem.line ?? '-'} ${problem.message}`);
  assert.deepEqual(problems.sort(), [
    'plugins/core/agents/helper.md:- frontmatter description is empty',
    'plugins/core/skills/broken/SKILL.md:- frontmatter name "broken-name" does not match "broken"',
    'plugins/core/skills/broken/SKILL.md:6 ${CLAUDE_PLUGIN_ROOT}/docs/missing.md does not exist',
    'plugins/core/skills/broken/SKILL.md:6 /core:missing is not a skill of core',
    'plugins/core/skills/broken/SKILL.md:6 /other:x names a plugin that core does not depend on',
    'plugins/core/skills/broken/SKILL.md:6 P-unknown is not a principle of core',
    'plugins/core/skills/broken/SKILL.md:6 core:nobody is neither a skill nor an agent of core',
  ]);
});

// AC-003: the whole agentflow repository passes.
test('flow check is clean on the agentflow repository', () => {
  assert.deepEqual(checkRepository(REPOSITORY), []);
});

// AC-013: SessionStart carries the core rules unless the config disables them.
test('SessionStart emits the core rules unless session-context is disabled', () => {
  const rules = readFileSync(join(REPOSITORY, 'plugins', 'flow', 'context', 'core-rules.md'), 'utf8');
  assert.ok(rules.length <= 4000, `core rules are ${rules.length} characters`);
  const config: FlowConfig = { layout: 'single', units: { adapters: ['nx'] } };
  assert.deepEqual(sessionStartOutput(config, rules), { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: rules } });
  assert.equal(sessionStartOutput({ ...config, hooks: { disabled: [SESSION_CONTEXT_HOOK] } }, rules), null);
});

// AC-021: the principle IDs are a contract between the principles skill, the core rules and the agents that cite them.
test('core rules list exactly the principles, each file carries its ID, and the agents preload the index', () => {
  const plugin = join(REPOSITORY, 'plugins', 'flow');
  const directory = join(plugin, 'skills', 'principles', 'principles');
  const ids = readdirSync(directory).filter((name) => /^P-[a-z0-9-]+\.md$/.test(name)).map((name) => basename(name, '.md')).sort();
  assert.ok(ids.length > 0);
  const rules = readFileSync(join(plugin, 'context', 'core-rules.md'), 'utf8');
  assert.deepEqual([...new Set(rules.match(/\bP-[a-z0-9]+(?:-[a-z0-9]+)*\b/g))].sort(), ids);
  const index = readFileSync(join(plugin, 'skills', 'principles', 'SKILL.md'), 'utf8');
  for (const id of ids) {
    assert.ok(index.includes(`\`${id}\``), `${id} is missing from the index`);
    assert.ok(readFileSync(join(directory, `${id}.md`), 'utf8').startsWith(`# ${id}`), `${id} file heading`);
  }
  for (const agent of ['code-reviewer', 'code-simplifier', 'feature-reviewer']) {
    assert.match(readFileSync(join(plugin, 'agents', `${agent}.md`), 'utf8'), /^ {2}- flow:principles$/m, agent);
  }
});
