import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseConfig } from '../src/config/config.js';
import { defaultMarketplace, detectConfig, directoryMarketplace, installShim, planInit, writeInit } from '../src/init/init.js';
import { run } from '../src/shared/process.js';

const REPOSITORY = join(import.meta.dirname, '..', '..');
const UMBRELLA = join(import.meta.dirname, '..', 'evals', 'fixtures', 'nx-umbrella');
const options = { layout: null, stacks: [], marketplace: directoryMarketplace(REPOSITORY) };

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'flow-init-'));
  test.after(() => rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }));
  return directory;
}

function nxWorkspace(directory: string): string {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'package.json'), '{ "name": "app" }\n', 'utf8');
  writeFileSync(join(directory, 'nx.json'), '{}\n', 'utf8');
  return directory;
}

test('init detects the layout and adapters, and the generated config is valid', () => {
  assert.deepEqual(detectConfig(nxWorkspace(temporaryDirectory())), { layout: 'single', units: { adapters: ['nx'] } });
  assert.deepEqual(detectConfig(UMBRELLA), { layout: 'umbrella', units: { adapters: ['nx'] } });
  const grouped = temporaryDirectory();
  nxWorkspace(join(grouped, 'group', 'app'));
  mkdirSync(join(grouped, 'node_modules', 'pkg'), { recursive: true });
  assert.deepEqual(detectConfig(grouped), { layout: 'umbrella', units: { adapters: ['nx'] } });
  assert.throws(() => detectConfig(temporaryDirectory()), /No workspace of a supported build tool \(nx, maven, gradle, npm\)/);
  assert.throws(() => detectConfig(grouped, 'single'), /recognises .* as a workspace/);
  for (const root of [UMBRELLA, grouped]) parseConfig(detectConfig(root));
});

// AC-004: dry run (plan only) writes nothing; a real run merges settings and keeps existing keys.
test('init merges .claude/settings.json without dropping keys and writes nothing until asked', () => {
  const root = nxWorkspace(temporaryDirectory());
  mkdirSync(join(root, '.claude', 'agents'), { recursive: true });
  const existing = {
    permissions: { allow: ['Bash(git status)'] },
    enabledPlugins: { 'other@market': true },
    hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node old-gate.mjs' }] }] },
  };
  writeFileSync(join(root, '.claude', 'settings.json'), JSON.stringify(existing), 'utf8');
  writeFileSync(join(root, '.claude', 'agents', 'code-reviewer.md'), '---\nname: code-reviewer\n---\n', 'utf8');
  const before = readdirSync(root, { recursive: true }).sort();

  const plan = planInit(root, options);
  assert.deepEqual(readdirSync(root, { recursive: true }).sort(), before);
  assert.equal(plan.config.exists, false);
  assert.deepEqual(plan.settings.changes, [
    `+ extraKnownMarketplaces.agentflow = ${JSON.stringify({ source: { source: 'directory', path: REPOSITORY } })}`,
    '+ enabledPlugins.flow@agentflow = true',
    '+ enabledPlugins.flow-ui@agentflow = true',
  ]);
  assert.equal(plan.warnings.length, 2);
  assert.match(plan.warnings[0]!, /already has Stop hooks \(node old-gate\.mjs\)/);
  assert.match(plan.warnings[1]!, /code-reviewer\.md has the same name as the flow agent flow:code-reviewer/);

  writeInit(plan);
  const settings = JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf8'));
  assert.deepEqual(settings.permissions, existing.permissions);
  assert.deepEqual(settings.hooks, existing.hooks);
  assert.deepEqual(settings.enabledPlugins, { 'other@market': true, 'flow@agentflow': true, 'flow-ui@agentflow': true });
  assert.deepEqual(settings.extraKnownMarketplaces.agentflow, { source: { source: 'directory', path: REPOSITORY } });
  assert.deepEqual(JSON.parse(readFileSync(join(root, '.flow', 'config.json'), 'utf8')), { layout: 'single', units: { adapters: ['nx'] } });

  const again = planInit(root, options);
  assert.equal(again.config.exists, true);
  assert.deepEqual(again.settings.changes, []);
});

test('init writes the git source of a marketplace Claude Code registered from GitHub', () => {
  const registry = join(temporaryDirectory(), 'known_marketplaces.json');
  const github = { source: 'github', repo: 'owner/agent-flow' };
  writeFileSync(registry, JSON.stringify({
    other: { source: { source: 'github', repo: 'owner/other' }, installLocation: temporaryDirectory() },
    agentflow: { source: github, installLocation: REPOSITORY },
  }), 'utf8');
  const cached = join(temporaryDirectory(), 'cache', 'agentflow', 'flow', '0.1.0');
  const marketplace = defaultMarketplace(cached, registry);
  assert.deepEqual(marketplace, { path: REPOSITORY, source: github });
  const plan = planInit(nxWorkspace(temporaryDirectory()), { ...options, marketplace: marketplace! });
  assert.equal(plan.settings.changes[0], `+ extraKnownMarketplaces.agentflow = ${JSON.stringify({ source: github })}`);
  assert.equal(defaultMarketplace(cached, join(temporaryDirectory(), 'missing.json')), null);
});

test('init refuses a stack plugin the marketplace does not offer and a broken settings file', () => {
  const root = nxWorkspace(temporaryDirectory());
  assert.throws(() => planInit(root, { ...options, stacks: ['cobol'] }), /has no plugin stack-cobol/);
  mkdirSync(join(root, '.claude'));
  writeFileSync(join(root, '.claude', 'settings.json'), '{ broken', 'utf8');
  assert.throws(() => planInit(root, options), /Invalid .*settings\.json/);
  assert.equal(readFileSync(join(root, '.claude', 'settings.json'), 'utf8'), '{ broken');
});

test('the shim runs the installed flow plugin that covers the cwd', () => {
  const home = temporaryDirectory();
  const bin = join(home, 'bin');
  assert.deepEqual(installShim(bin, join(REPOSITORY, 'plugins', 'flow')).map((file) => file.split('/').pop()), ['flow.mjs', 'flow', 'flow.cmd']);
  const plugin = (name: string) => {
    mkdirSync(join(home, name, 'dist'), { recursive: true });
    writeFileSync(join(home, name, 'dist', 'flow.mjs'), `process.stdout.write('${name} ' + process.argv.slice(2).join(' '))`, 'utf8');
    return join(home, name);
  };
  const project = join(home, 'project');
  mkdirSync(join(project, 'sub'), { recursive: true });
  mkdirSync(join(home, '.claude', 'plugins'), { recursive: true });
  writeFileSync(join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'flow@agentflow': [
    { scope: 'user', installPath: plugin('user-install'), lastUpdated: '2026-01-01' },
    { scope: 'project', projectPath: project, installPath: plugin('project-install'), lastUpdated: '2025-01-01' },
    { scope: 'project', projectPath: join(home, 'elsewhere'), installPath: plugin('elsewhere-install'), lastUpdated: '2027-01-01' },
  ] } }), 'utf8');
  const shim = (cwd: string) => run(process.execPath, [join(bin, 'flow.mjs'), 'review', 'status'], { cwd, env: { ...process.env, HOME: home, USERPROFILE: home } });
  assert.equal(shim(join(project, 'sub')).stdout, 'project-install review status');
  assert.equal(shim(home).stdout, 'user-install review status');
  assert.ok(existsSync(join(bin, 'flow.cmd')));
});
