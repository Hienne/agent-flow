import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { collectWorkspaceChanges } from '../src/inspection/changes.js';
import { collectTestIntegrity, pendingTestIntegrity, scanTestDiff, testIntegrityAllowance } from '../src/review/test-integrity.js';
import { useRoot } from '../src/shared/paths.js';
import { run } from '../src/shared/process.js';
import type { TaskManifest } from '../src/shared/types.js';

const kinds = (findings: Array<{ kind: string; line: string }>) => findings.map((finding) => `${finding.kind}: ${finding.line}`);

test('skips, focus markers and disabled annotations added to a test file are findings', () => {
  const findings = scanTestDiff('spec/a.test.ts', [
    "it.skip('rejects an empty cart', () => {",
    "test.only('sums line items', () => {",
    "xit('applies the discount', () => {",
    '  @Disabled("flaky")',
    "it('counts items', () => {",
  ], []);
  assert.deepEqual(kinds(findings), [
    "skipped: it.skip('rejects an empty cart', () => {",
    "skipped: test.only('sums line items', () => {",
    "skipped: xit('applies the discount', () => {",
    'skipped: @Disabled("flaky")',
  ]);
});

test('a test or assertion turned into a comment is commented-out', () => {
  const findings = scanTestDiff('a.spec.ts', ["// it('rejects an empty cart', () => {", '  // expect(total).toBe(15);', '// sums the cart'], []);
  assert.deepEqual(kinds(findings), ["commented-out: // it('rejects an empty cart', () => {", 'commented-out: // expect(total).toBe(15);']);
});

test('removing more test cases than the diff adds is test-removed; a rename is not', () => {
  assert.deepEqual(kinds(scanTestDiff('a.test.ts', [], ["it('rejects an empty cart', () => {", '  @Test'])), [
    "test-removed: it('rejects an empty cart', () => {",
    'test-removed: @Test',
  ]);
  assert.deepEqual(scanTestDiff('a.test.ts', ["it('rejects a cart with no items', () => {"], ["it('rejects an empty cart', () => {"]), []);
});

test('an existing assertion that changes or disappears is assertion-changed; one that moves is not', () => {
  const removed = ['  expect(calculateTotal(items)).toBe(15);', '  assertThat(order.status()).isEqualTo(CONFIRMED);', '  expect(cart.size).toBe(2);'];
  const added = ['  expect(calculateTotal(items)).toBe(14);', '    expect(cart.size).toBe(2);', '  expect(cart.isEmpty).toBe(false);'];
  assert.deepEqual(kinds(scanTestDiff('CartTest.java', added, removed)), [
    'assertion-changed: expect(calculateTotal(items)).toBe(15);',
    'assertion-changed: assertThat(order.status()).isEqualTo(CONFIRMED);',
  ]);
});

test('only test files of the task diff are scanned, tracked and untracked', () => {
  const root = mkdtempSync(join(tmpdir(), 'flow-integrity-'));
  test.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }));
  mkdirSync(join(root, '.flow'));
  writeFileSync(join(root, '.flow', 'config.json'), JSON.stringify({ layout: 'single', units: { adapters: ['npm'] } }), 'utf8');
  useRoot(root);
  const git = (...gitArgs: string[]) => run('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...gitArgs], { cwd: root });
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'cart.ts'), 'export const total = 15;\nassert(total > 0);\n', 'utf8');
  writeFileSync(join(root, 'src', 'cart.test.ts'), "it('sums', () => {\n  expect(total).toBe(15);\n});\n", 'utf8');
  git('init', '-q');
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  const base = git('rev-parse', 'HEAD').stdout.trim();
  writeFileSync(join(root, 'src', 'cart.ts'), 'export const total = 14;\nexport const pending = test.skip;\n', 'utf8');
  writeFileSync(join(root, 'src', 'cart.test.ts'), "it('sums', () => {\n  expect(total).toBe(14);\n});\n", 'utf8');
  writeFileSync(join(root, 'src', 'discount.test.ts'), "it.skip('applies', () => {});\n", 'utf8');
  const group = collectWorkspaceChanges({ root, relativeRoot: '.', name: 'shop', adapter: 'npm', scripts: {} }, base);
  assert.deepEqual(collectTestIntegrity([group]).map((finding) => `${finding.file} ${finding.kind}: ${finding.line}`), [
    './src/cart.test.ts assertion-changed: expect(total).toBe(15);',
    "./src/discount.test.ts skipped: it.skip('applies', () => {});",
  ]);
});

test('a user allowance covers the findings it lists, never a later one', () => {
  const first = scanTestDiff('a.test.ts', ["it.skip('a', () => {});"], []);
  const manifest = { evidence: { verification: [], lastChangeSnapshotAt: null, testIntegrity: [testIntegrityAllowance(first, 'flaky upstream sandbox, ticket 42')] } } as unknown as TaskManifest;
  assert.deepEqual(pendingTestIntegrity(manifest, first), []);
  const later = [...first, ...scanTestDiff('a.test.ts', ["xit('b', () => {});"], [])];
  assert.deepEqual(kinds(pendingTestIntegrity(manifest, later)), ["skipped: xit('b', () => {});"]);
});
