import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const SCRIPT = join(import.meta.dirname, '..', '..', 'plugins', 'flow', 'skills', 'test-audit', 'scripts', 'kill-check.mjs');

function project(source: string): string {
  const root = mkdtempSync(join(tmpdir(), 'flow-kill-'));
  test.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'total.js'), source, 'utf8');
  // Stands in for a test runner: red when the guarded literal is gone, and with --json it writes a jest-shaped report.
  writeFileSync(join(root, 'runner.js'), `
const { readFileSync, writeFileSync } = require('node:fs');
if (process.argv.includes('{file}')) process.exit(3);
const source = readFileSync(${JSON.stringify(join(root, 'total.js'))}, 'utf8');
const out = process.argv[process.argv.indexOf('--outputFile') + 1];
const broken = source.includes('SYNTAX(');
const red = !source.includes('> 100 ?');
if (process.argv.includes('--json')) writeFileSync(out, JSON.stringify({ testResults: [
  broken
    ? { name: 'total.test.js', status: 'failed', failureMessage: 'SyntaxError: Unexpected token', assertionResults: [] }
    : { name: 'total.test.js', status: red ? 'failed' : 'passed', assertionResults: [
        { fullName: 'applies the discount', status: red ? 'failed' : 'passed' },
        { fullName: 'sums prices', status: 'passed' }] },
] }));
process.exit(broken || red ? 1 : 0);
`, 'utf8');
  return root;
}

function killCheck(root: string, spec: object): { code: number | null; result: Record<string, unknown> } {
  const run = spawnSync(process.execPath, [SCRIPT], { cwd: root, input: JSON.stringify(spec), encoding: 'utf8' });
  return { code: run.status, result: JSON.parse(run.stdout || '{}') as Record<string, unknown> };
}

const SOURCE = 'export function total(sum) {\n  return sum > 100 ? sum * 0.9 : sum;\n}\n';

test('a mutation that breaks the guarded line reports the tests that went red and restores the file', () => {
  const root = project(SOURCE);
  const { code, result } = killCheck(root, {
    file: 'total.js', find: 'sum > 100', replace: 'sum > 1000',
    commands: [[process.execPath, 'runner.js', '{file}']], jestJson: true,
  });
  assert.equal(code, 0);
  assert.equal(result.status, 'red');
  assert.deepEqual(result.failed, ['total.test.js › applies the discount']);
  assert.equal(readFileSync(join(root, 'total.js'), 'utf8'), SOURCE);
});

test('a mutation every test survives is green', () => {
  const root = project(SOURCE);
  const { result } = killCheck(root, { file: 'total.js', find: 'sum * 0.9', replace: 'sum * 0.8', commands: [[process.execPath, 'runner.js']], jestJson: true });
  assert.equal(result.status, 'green');
  assert.deepEqual(result.failed, []);
});

test('a mutation that only stops the suite from loading is invalid, not red', () => {
  const root = project(SOURCE);
  const { result } = killCheck(root, { file: 'total.js', find: 'return sum > 100', replace: 'return SYNTAX( > 100', commands: [[process.execPath, 'runner.js']], jestJson: true });
  assert.equal(result.status, 'invalid');
  assert.deepEqual(result.suiteErrors, ['total.test.js']);
});

test('find text must match exactly once, and nothing runs or changes otherwise', () => {
  const root = project(SOURCE);
  for (const find of ['sum', 'missing text']) {
    const { code, result } = killCheck(root, { file: 'total.js', find, replace: 'x', commands: [[process.execPath, 'runner.js']] });
    assert.equal(code, 2);
    assert.equal(result.status, 'error');
    assert.match(String(result.message), find === 'sum' ? /matches 4 times/ : /matches 0 times/);
  }
  assert.equal(readFileSync(join(root, 'total.js'), 'utf8'), SOURCE);
});

test('a multi-line find written with LF matches a CRLF file, which is restored byte for byte', () => {
  const crlf = SOURCE.replace(/\n/g, '\r\n');
  const root = project(crlf);
  const { result } = killCheck(root, { file: 'total.js', find: 'export function total(sum) {\n  return sum > 100', replace: 'export function total(sum) {\n  return sum > 1000', commands: [[process.execPath, 'runner.js']] });
  assert.equal(result.status, 'red');
  assert.equal(readFileSync(join(root, 'total.js'), 'utf8'), crlf);
});
