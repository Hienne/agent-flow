import { existsSync, readFileSync } from 'node:fs';
import { run } from '../shared/process.js';
import type { ChangeGroup, TaskManifest, TestIntegrityAllowance, TestIntegrityFinding, VerificationResult } from '../shared/types.js';

export const TEST_INTEGRITY_STEP = 'test-integrity';

// Weakening a suite is how a red check turns green without a fix: verify fails on it until the user accepts each finding.
const TEST_FILE = /(?:^|\/)(?:__tests__|tests?|specs?)\/|\.(?:test|spec)\.[cm]?[jt]sx?$|(?:Tests?|IT)\.(?:java|kt)$|(?:^|\/)test_[^/]*\.py$|_test\.(?:py|go)$/;
const SKIP = /\b(?:describe|context|suite|it|test|specify)\s*\.\s*(?:skip|only|todo|fixme)\b|\b(?:xit|xtest|xdescribe|xcontext|fit|fdescribe)\s*\(|@(?:Disabled|Ignore)\b|@(?:pytest\.mark\.(?:skip|skipif|xfail)|unittest\.skip)\b|\bpytest\.skip\s*\(|\bt\.Skip(?:Now)?\s*\(/;
const DECLARATION = /^\s*(?:(?:it|test|specify)\s*(?:\.\s*\w+\s*)*\(|@Test\b|def\s+test_|func\s+Test\w*\s*\()/;
const ASSERTION = /\b(?:expect|assert\w*)\s*[.(]|\bassert\s|\.should\b/;
const COMMENT = /^\s*(?:\/\/+|#|\/?\*+)\s*/;

export function isTestFile(path: string): boolean {
  return TEST_FILE.test(path);
}

const normalize = (line: string): string => line.trim().replace(/\s+/g, ' ');

export function scanTestDiff(file: string, added: string[], removed: string[]): TestIntegrityFinding[] {
  const findings: TestIntegrityFinding[] = [];
  const addedText = new Set(added.map(normalize));
  for (const line of added) {
    const comment = COMMENT.exec(line);
    const body = comment ? line.slice(comment[0].length) : null;
    if (body !== null && (DECLARATION.test(body) || ASSERTION.test(body))) findings.push({ file, kind: 'commented-out', line: normalize(line) });
    else if (SKIP.test(line)) findings.push({ file, kind: 'skipped', line: normalize(line) });
  }
  // A renamed test is one declaration out and one in; only a net loss of test cases counts.
  const removedDeclarations = removed.filter((line) => DECLARATION.test(line));
  if (removedDeclarations.length > added.filter((line) => DECLARATION.test(line)).length) {
    for (const line of removedDeclarations) if (!addedText.has(normalize(line))) findings.push({ file, kind: 'test-removed', line: normalize(line) });
  }
  // An assertion whose exact text survives elsewhere in the diff moved; any other removed assertion changed or went away.
  for (const line of removed) {
    if (!COMMENT.test(line) && ASSERTION.test(line) && !addedText.has(normalize(line))) findings.push({ file, kind: 'assertion-changed', line: normalize(line) });
  }
  return findings;
}

function diffLines(group: ChangeGroup, change: ChangeGroup['changes'][number]): { added: string[]; removed: string[] } {
  if (change.untracked) return { added: existsSync(change.absolutePath) ? readFileSync(change.absolutePath, 'utf8').split(/\r?\n/) : [], removed: [] };
  const result = run('git', ['diff', '--unified=0', '--no-color', group.base ?? 'HEAD', '--', change.path], { cwd: group.workspace.root });
  const lines = result.code === 0 ? result.stdout.split(/\r?\n/) : [];
  return {
    added: lines.filter((line) => line.startsWith('+') && !line.startsWith('+++')).map((line) => line.slice(1)),
    removed: lines.filter((line) => line.startsWith('-') && !line.startsWith('---')).map((line) => line.slice(1)),
  };
}

export function collectTestIntegrity(groups: ChangeGroup[]): TestIntegrityFinding[] {
  return groups.flatMap((group) => group.changes.filter((change) => isTestFile(change.path)).flatMap((change) => {
    const { added, removed } = diffLines(group, change);
    return scanTestDiff(`${group.workspace.relativeRoot}/${change.path}`, added, removed);
  }));
}

const findingKey = (finding: TestIntegrityFinding): string => `${finding.file}|${finding.kind}|${finding.line}`;

export function pendingTestIntegrity(manifest: TaskManifest, findings: TestIntegrityFinding[]): TestIntegrityFinding[] {
  const allowed = new Set((manifest.evidence.testIntegrity ?? []).flatMap((allowance) => allowance.findings));
  return findings.filter((finding) => !allowed.has(findingKey(finding)));
}

export function testIntegrityAllowance(findings: TestIntegrityFinding[], reason: string): TestIntegrityAllowance {
  return { recordedAt: new Date().toISOString(), reason, findings: findings.map(findingKey) };
}

// A verify result outside the planned steps: it fails the run, but never makes the run count as incomplete.
export function testIntegrityResult(pending: TestIntegrityFinding[]): VerificationResult {
  return {
    id: TEST_INTEGRITY_STEP,
    status: pending.length ? 'failed' : 'passed',
    cached: false,
    cacheMissReason: 'not-cacheable',
    durationMs: 0,
    ...(pending.length ? { output: testIntegrityReport(pending) } : {}),
  };
}

export function testIntegrityReport(pending: TestIntegrityFinding[]): string {
  return [
    `${pending.length} change(s) weaken the existing tests:`,
    ...pending.map((finding) => `  ${finding.kind.padEnd(17)} ${finding.file}: ${finding.line}`),
    'Fix the code instead, or restore the test. When the change is right (the spec changed the behaviour, the test is obsolete), tell the user the root cause and the reason for each line; only they can accept it, with `flow review allow-tests --task <feature> --reason <text>` in their own terminal.',
  ].join('\n');
}
