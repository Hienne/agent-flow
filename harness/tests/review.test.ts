import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { collectWorkspaceChanges, reviewStats } from '../src/inspection/changes.js';
import { claudeReviewOutput, reviewHookEvent } from '../src/review/claude-hook.js';
import { useRoot } from '../src/shared/paths.js';
import { run } from '../src/shared/process.js';
import type { ChangeGroup, WorkspaceChange } from '../src/shared/types.js';

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'flow-review-'));
  test.after(() => rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }));
  return directory;
}

function projectRoot(config: object): string {
  const root = temporaryDirectory();
  mkdirSync(join(root, '.flow'));
  writeFileSync(join(root, '.flow', 'config.json'), JSON.stringify({ layout: 'single', units: { adapters: ['nx'] }, ...config }), 'utf8');
  useRoot(root);
  return root;
}

const group = (codeLines: number, codeFiles: number) => ({
  changes: Array.from({ length: codeFiles }, (_, index) => ({ path: `file-${index}.ts` })) as WorkspaceChange[],
  added: codeLines, deleted: 0, codeAdded: codeLines, codeDeleted: 0, codeFiles,
} as ChangeGroup);

// AC-012: a 10-line deep threshold triggers the gate on an 11-line change.
test('review thresholds come from .flow/config.json', () => {
  projectRoot({ review: { deep: 10, broad: [5, 1] } });
  assert.equal(reviewStats([group(10, 1)]).formalReviewRequired, false);
  assert.equal(reviewStats([group(11, 1)]).formalReviewRequired, true);
  assert.equal(reviewStats([group(6, 2)]).formalReviewRequired, true);
  projectRoot({});
  assert.equal(reviewStats([group(11, 1)]).formalReviewRequired, false);
  assert.equal(reviewStats([group(301, 1)]).formalReviewRequired, true);
});

test('codeFiles in the config replaces the adapter extensions', () => {
  const root = projectRoot({ codeFiles: ['.java'] });
  const git = (...gitArgs: string[]) => run('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...gitArgs], { cwd: root });
  git('init', '-q');
  git('commit', '-q', '--allow-empty', '-m', 'base');
  writeFileSync(join(root, 'A.java'), 'class A {}\n', 'utf8');
  writeFileSync(join(root, 'a.ts'), 'export const a = 1;\n', 'utf8');
  const changes = collectWorkspaceChanges({ root, relativeRoot: '.', name: 'solo', adapter: 'nx', scripts: {} }).changes;
  assert.deepEqual(changes.filter((change) => change.isCode).map((change) => change.path), ['A.java']);
});

test('SubagentStop reads the FLOW-REVIEW-RESULT line from a SubagentHandback transcript', () => {
  const directory = temporaryDirectory();
  const transcript = join(directory, 'agent.jsonl');
  writeFileSync(transcript, [
    JSON.stringify({ type: 'user', message: { content: 'review it' } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'SubagentHandback', input: { message: 'report\nFLOW-REVIEW-RESULT task=demo blocking=0 non-blocking=2' } }] } }),
  ].join('\n'), 'utf8');
  const event = reviewHookEvent({ hook_event_name: 'SubagentStop', session_id: 's1', agent_type: 'flow:code-reviewer', last_assistant_message: '', agent_transcript_path: transcript });
  assert.equal(event?.event, 'subagent-stop');
  assert.match(event?.lastMessage ?? '', /FLOW-REVIEW-RESULT task=demo blocking=0 non-blocking=2$/);
  assert.equal(reviewHookEvent({ hook_event_name: 'SubagentStop', last_assistant_message: 'no marker', agent_transcript_path: join(directory, 'missing.jsonl') })?.lastMessage, 'no marker');
  assert.equal(reviewHookEvent({ hook_event_name: 'PreToolUse' }), null);
});

test('review results map to Claude hook output', () => {
  assert.deepEqual(claudeReviewOutput({ decision: 'block', reason: 'review first' }), { decision: 'block', reason: 'review first' });
  assert.deepEqual(claudeReviewOutput({ decision: 'allow', message: 'recorded' }), { systemMessage: 'recorded' });
  assert.equal(claudeReviewOutput({ decision: 'allow' }), null);
});
