import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(join(repo, 'plugins/flow/.claude-plugin/plugin.json'), 'utf8'));
const common = { bundle: true, platform: 'node', format: 'esm', target: 'node18', legalComments: 'none', logLevel: 'info' };

await build({
  ...common,
  entryPoints: [join(repo, 'harness/src/cli.ts')],
  outfile: join(repo, 'plugins/flow/dist/flow.mjs'),
  define: { __FLOW_VERSION__: JSON.stringify(version) },
});
// The stack pack ships its own CLI so the flow bundle stays stack-agnostic.
await build({
  ...common,
  entryPoints: [join(repo, 'harness/packs/hdt-angular/cli.ts')],
  outfile: join(repo, 'plugins/stack-hdt-angular/dist/mf-smoke.mjs'),
});
