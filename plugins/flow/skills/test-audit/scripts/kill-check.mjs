#!/usr/bin/env node
// One kill check: break one exact piece of source, run the tests, report which went red, restore the file byte for byte.
// Spec (JSON on stdin, or a file path as the only argument):
//   { "file": "src/total.ts", "find": "sum > 100", "replace": "sum > 1000",
//     "commands": [["npx", "jest", "-c", "jest.config.ts", "--findRelatedTests", "{file}"]],
//     "jestJson": true, "cwd": ".", "timeoutSeconds": 900 }
// `{file}` in a command becomes `file`. With `jestJson`, each command gets `--json --outputFile <tmp>` and the report
// names every failed test; without it, only the exit code decides. Prints one JSON result; exits 2 when nothing could be measured.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

const started = Date.now();
const finish = (result, code = 0) => {
  process.stdout.write(`${JSON.stringify({ ...result, durationMs: Date.now() - started }, null, 2)}\n`);
  process.exit(code);
};
const fail = (message) => finish({ status: 'error', message }, 2);

let spec;
try {
  spec = JSON.parse(process.argv[2] ? readFileSync(process.argv[2], 'utf8') : readFileSync(0, 'utf8'));
} catch (error) {
  fail(`cannot read the spec: ${error.message}`);
}
const { file, find, replace, commands, jestJson = false, timeoutSeconds = 900 } = spec;
if (typeof file !== 'string' || typeof find !== 'string' || typeof replace !== 'string' || !find || find === replace
    || !Array.isArray(commands) || !commands.length || !commands.every((command) => Array.isArray(command) && command.length && command.every((part) => typeof part === 'string'))) {
  fail('spec needs file, find, replace (different from find) and commands: a non-empty array of argument arrays');
}
const cwd = resolve(spec.cwd ?? '.');
const path = resolve(cwd, file);
if (!existsSync(path)) fail(`${file} does not exist under ${cwd}`);

const original = readFileSync(path);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const originalHash = hash(original);
const text = original.toString('utf8');
// A find written with LF still matches a CRLF file; the replacement takes the file's line ending.
const crlf = text.includes('\r\n') && !find.includes('\r');
const needle = crlf ? find.replace(/\n/g, '\r\n') : find;
const matches = text.split(needle).length - 1;
if (matches !== 1) fail(`find text matches ${matches} times in ${file}; give a longer, unique snippet`);

let restored = false;
const restore = () => {
  if (restored) return;
  writeFileSync(path, original);
  restored = true;
};
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => { restore(); process.exit(130); });

const reports = mkdtempSync(join(tmpdir(), 'kill-check-'));
const runs = [];
try {
  writeFileSync(path, text.replace(needle, crlf ? replace.replace(/\n/g, '\r\n') : replace), 'utf8');
  if (hash(readFileSync(path)) === originalHash) fail('the replacement left the file unchanged');
  commands.forEach((command, index) => {
    const report = join(reports, `report-${index}.json`);
    const args = [...command.slice(1).map((part) => part.replaceAll('{file}', file)), ...(jestJson ? ['--json', '--outputFile', report] : [])];
    const options = { cwd, encoding: 'utf8', timeout: timeoutSeconds * 1000, maxBuffer: 64 * 1024 * 1024 };
    let run = spawnSync(command[0], args, options);
    // npx and npm are .cmd shims on Windows, which only a shell resolves.
    if (run.error?.code === 'ENOENT' && process.platform === 'win32') run = spawnSync(command[0], args, { ...options, shell: true });
    runs.push({ command: [command[0], ...args].join(' '), run, reportText: existsSync(report) ? readFileSync(report, 'utf8') : undefined });
  });
} finally {
  restore();
  rmSync(reports, { recursive: true, force: true, maxRetries: 5 });
}
if (hash(readFileSync(path)) !== originalHash) fail(`${file} was not restored; recover it from version control`);

const failed = [];
const suiteErrors = [];
const problems = [];
for (const { command, run, reportText } of runs) {
  if (run.error) {
    problems.push(`${command}: ${run.error.message}`);
    continue;
  }
  if (!jestJson) {
    if (run.status !== 0) failed.push(`${command} exited ${run.status}`);
    continue;
  }
  if (reportText === undefined) problems.push(`${command} exited ${run.status} without a JSON report: ${`${run.stderr}${run.stdout}`.trim().slice(-800)}`);
  else {
    for (const suite of JSON.parse(reportText).testResults ?? []) {
      const name = relative(cwd, resolve(cwd, suite.name));
      const red = (suite.assertionResults ?? []).filter((assertion) => assertion.status === 'failed');
      failed.push(...red.map((assertion) => `${name} › ${assertion.fullName}`));
      if (suite.status === 'failed' && !red.length) suiteErrors.push(name);
    }
  }
}
const status = failed.length ? 'red' : problems.length ? 'error' : suiteErrors.length ? 'invalid' : 'green';
finish({ status, file, find, replace, failed, suiteErrors, problems, commands: runs.map((item) => item.command) }, status === 'error' ? 2 : 0);
