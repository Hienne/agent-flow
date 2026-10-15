#!/usr/bin/env node
import { join } from 'node:path';
import { initRoot } from '../../src/config/config.js';
import { normalizePath } from '../../src/shared/paths.js';
import { listManifestTransactions, recoverManifestTransaction } from './manifest-transaction.js';
import { MANIFEST_PATH, findHost, runSmoke } from './smoke.js';

const USAGE = `Usage:
  mf-smoke <remote-project> --host <workspace> [--host-project <project>] [--route <path>] [--manifest-key <key>] [--dry-run] [--json]
  mf-smoke transactions [--json]
  mf-smoke recover <transaction-id> --host <workspace> [--host-project <project>]`;
const VALUE_OPTIONS = new Set(['--host', '--host-project', '--route', '--manifest-key']);
const BOOLEAN_OPTIONS = new Set(['--dry-run', '--json']);

function parse(argv: string[]): { positional: string[]; values: Map<string, string>; flags: Set<string> } {
  const positional: string[] = [];
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index++) {
    const part = argv[index] ?? '';
    if (BOOLEAN_OPTIONS.has(part)) flags.add(part);
    else if (VALUE_OPTIONS.has(part)) {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error(`${part} needs a value`);
      values.set(part, value);
    } else if (part.startsWith('--')) throw new Error(`Unknown option ${part}`);
    else positional.push(part);
  }
  return { positional, values, flags };
}

function requireHost(values: Map<string, string>): string {
  const host = values.get('--host');
  if (!host) throw new Error('--host <workspace> is required: name the workspace of the shell that loads the remote');
  return host;
}

async function main(): Promise<number> {
  const { positional, values, flags } = parse(process.argv.slice(2));
  const json = flags.has('--json');
  const [first, second] = positional;
  if (!first || positional.length > 2) {
    console.error(USAGE);
    return 2;
  }
  if (!initRoot()) throw new Error('flow is not initialised here: no .flow/config.json in this directory or its parents. Run `flow init` first.');

  if (first === 'transactions') {
    const journals = listManifestTransactions();
    if (json) console.log(JSON.stringify(journals, null, 2));
    else for (const journal of journals) console.log(`${journal.id}  ${journal.state}  ${normalizePath(journal.path)}`);
    return 0;
  }
  if (first === 'recover') {
    if (!second) throw new Error('recover needs a transaction id');
    const { project } = findHost(requireHost(values), values.get('--host-project'));
    const restoration = recoverManifestTransaction(second, join(project.root, MANIFEST_PATH));
    console.log(json ? JSON.stringify(restoration, null, 2) : `Transaction ${second}: ${restoration.status}`);
    return restoration.status === 'conflict' ? 1 : 0;
  }

  const result = await runSmoke(first, {
    host: requireHost(values),
    hostProject: values.get('--host-project') ?? null,
    route: values.get('--route') ?? null,
    manifestKey: values.get('--manifest-key') ?? null,
    dryRun: flags.has('--dry-run'),
  });
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`mf-smoke ${result.status.toUpperCase()}: ${result.remote.workspace}:${result.remote.project} in ${result.host.workspace}:${result.host.project}`);
    console.log(`  url ${result.url}`);
    console.log(`  manifest ${result.manifest.key}: ${result.manifest.original} -> ${result.manifest.override}`);
    for (const item of result.proof) console.log(`  ${item.status.padEnd(11)} ${item.phase}: ${item.evidence}`);
    for (const item of result.diagnostics ?? []) console.log(`  ${item.level} ${item.message}`);
    if (result.screenshot) console.log(`  screenshot ${result.screenshot}`);
  }
  return result.status === 'failed' ? 1 : 0;
}

main().then((code) => { process.exitCode = code; }, (error: unknown) => {
  console.error(`mf-smoke: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
