import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { beginManifestTransaction, recoverManifestTransaction } from '../packs/hdt-angular/manifest-transaction.js';
import { MANIFEST_PATH, runSmoke } from '../packs/hdt-angular/smoke.js';
import { useRoot } from '../src/shared/paths.js';
import { run } from '../src/shared/process.js';

const UMBRELLA = join(import.meta.dirname, '..', 'evals', 'fixtures', 'nx-umbrella');
const CLI = join(import.meta.dirname, '..', 'packs', 'hdt-angular', 'cli.ts');

function umbrellaCopy(): string {
  const root = mkdtempSync(join(tmpdir(), 'flow-mf-smoke-'));
  test.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }));
  cpSync(UMBRELLA, root, { recursive: true });
  useRoot(root);
  return root;
}

test('a dry run plans the remote, the host found by its federation manifest, and the shell route', async () => {
  umbrellaCopy();
  const result = await runSmoke('app-a', { host: 'shell-app', dryRun: true });
  assert.equal(result.status, 'planned');
  assert.deepEqual(result.remote, { workspace: 'remote-a', project: 'app-a', port: 4201 });
  assert.equal(result.host.workspace, 'shell-app');
  assert.equal(result.host.project, 'shell');
  assert.deepEqual(result.manifest, { key: 'app-a', original: 'http://localhost:4201', override: 'http://localhost:4201/remoteEntry.mjs' });
  assert.match(result.url, /^http:\/\/127\.0\.0\.1:\d+\/orders$/);
  await assert.rejects(runSmoke('app-a', { host: 'remote-a', dryRun: true }), /remote-a has 0 projects with src\/assets\/module-federation\.manifest\.json; pass --host-project/);
});

test('mf-smoke without --host is an error, not a default host', () => {
  const root = umbrellaCopy();
  const result = run(process.execPath, [...process.execArgv, CLI, 'app-a', '--dry-run'], { cwd: root });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /--host <workspace> is required/);
});

test('recovery restores only the manifest the caller names', () => {
  const root = umbrellaCopy();
  const manifest = join(root, 'shell-app', 'apps', 'shell', MANIFEST_PATH);
  const original = readFileSync(manifest, 'utf8');
  const transaction = beginManifestTransaction(manifest, 'app-a', 'http://localhost:4201/remoteEntry.mjs');
  assert.notEqual(readFileSync(manifest, 'utf8'), original);

  assert.throws(() => recoverManifestTransaction(transaction.journal.id, join(root, 'other.json')), /unexpected manifest path/);
  // The live transaction holds the lock; once it has restored, recovering the named manifest is a no-op.
  assert.equal(transaction.restore().status, 'restored');
  assert.equal(readFileSync(manifest, 'utf8'), original);
  assert.equal(recoverManifestTransaction(transaction.journal.id, manifest).status, 'restored');
});
