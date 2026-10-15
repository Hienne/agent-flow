import { chmodSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pluginRoot } from '../context/session.js';
import { parseConfig, type AdapterName, type FlowConfig, type Layout } from '../config/config.js';
import { ensureDirectory, readJson, writeFileAtomic, writeJsonAtomic } from '../shared/filesystem.js';
import { CONFIG_FILE, IGNORED_DIRECTORIES, normalizePath } from '../shared/paths.js';
import { parseJsonObject } from '../topology/workspaces.js';
import { UNIT_ADAPTERS } from '../units/adapter.js';

const SETTINGS_FILE = join('.claude', 'settings.json');
// Hook events the flow plugin handles; a project hook on the same event may do the same job twice.
const FLOW_HOOK_EVENTS = ['SessionStart', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PreCompact', 'Stop', 'SubagentStart', 'SubagentStop'];

// Where the marketplace manifest is read (`path`) and the source written to settings (`source`): a local
// directory, or a git source such as `{ source: 'github', repo }` as Claude Code registered it.
export interface Marketplace {
  path: string;
  source: Record<string, unknown>;
}

export interface InitOptions {
  layout: Layout | null;
  stacks: string[];
  marketplace: Marketplace;
}

export interface InitPlan {
  root: string;
  config: { path: string; value: FlowConfig; exists: boolean };
  settings: { path: string; value: Record<string, unknown>; changes: string[] };
  warnings: string[];
}

function adapterOf(directory: string): AdapterName | null {
  return UNIT_ADAPTERS.find((adapter) => adapter.detect(directory))?.name ?? null;
}

// The adapters of the workspaces nested below the root, stopping at each workspace as discoverWorkspaces does.
function nestedAdapters(root: string): AdapterName[] {
  const found = new Set<AdapterName>();
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || IGNORED_DIRECTORIES.has(entry.name)) continue;
      const child = join(directory, entry.name);
      const adapter = adapterOf(child);
      if (adapter) found.add(adapter);
      else visit(child);
    }
  };
  visit(root);
  return [...found];
}

export function detectConfig(root: string, layout: Layout | null = null): FlowConfig {
  const supported = UNIT_ADAPTERS.map((adapter) => adapter.name).join(', ');
  const own = layout === 'umbrella' ? null : adapterOf(root);
  if (own) return { layout: 'single', units: { adapters: [own] } };
  if (layout === 'single') throw new Error(`No supported build tool (${supported}) recognises ${normalizePath(root)} as a workspace`);
  const nested = nestedAdapters(root);
  if (!nested.length) throw new Error(`No workspace of a supported build tool (${supported}) found in ${normalizePath(root)}`);
  return { layout: 'umbrella', units: { adapters: nested } };
}

export const directoryMarketplace = (path: string): Marketplace => ({ path: resolve(path), source: { source: 'directory', path: resolve(path) } });

const KNOWN_MARKETPLACES = join(homedir(), '.claude', 'plugins', 'known_marketplaces.json');
const offersFlow = (path: string): boolean => readJson<{ plugins?: Array<{ name?: string }> }>(join(path, '.claude-plugin', 'marketplace.json'), {}).plugins?.some((plugin) => plugin.name === 'flow') ?? false;

// The marketplace: the checkout the running plugin lives in (<checkout>/plugins/flow), else a marketplace registered
// in Claude Code that offers the flow plugin, local directory or git (read from its installLocation clone).
export function defaultMarketplace(plugin = pluginRoot(), registry = KNOWN_MARKETPLACES): Marketplace | null {
  const checkout = resolve(plugin, '..', '..');
  if (existsSync(join(checkout, '.claude-plugin', 'marketplace.json'))) return directoryMarketplace(checkout);
  const known = readJson<Record<string, { source?: Record<string, unknown> & { source?: string; path?: string }; installLocation?: string }>>(registry, {});
  for (const value of Object.values(known)) {
    const path = value.source?.source === 'directory' ? value.source.path : value.installLocation;
    if (value.source && path && offersFlow(path)) return { path, source: value.source };
  }
  return null;
}

function hookCommands(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((group: { hooks?: Array<{ command?: unknown }> }) => (group?.hooks ?? []).map((hook) => String(hook?.command ?? '')));
}

export function writeInit(plan: InitPlan): void {
  if (!plan.config.exists) writeJsonAtomic(plan.config.path, plan.config.value);
  if (plan.settings.changes.length) writeJsonAtomic(plan.settings.path, plan.settings.value);
}

export function planInit(root: string, options: InitOptions): InitPlan {
  const marketplacePath = options.marketplace.path;
  const manifestPath = join(marketplacePath, '.claude-plugin', 'marketplace.json');
  if (!existsSync(manifestPath)) throw new Error(`Not a marketplace directory: ${normalizePath(marketplacePath)} has no .claude-plugin/marketplace.json`);
  const marketplace = parseJsonObject(manifestPath, 'marketplace manifest') as { name?: string; plugins?: Array<{ name?: string; source?: string }> };
  if (!marketplace.name) throw new Error(`${normalizePath(manifestPath)} has no name`);
  const entries = marketplace.plugins ?? [];
  const available = new Set(entries.map((plugin) => plugin.name));
  const plugins = ['flow', 'flow-ui', ...options.stacks.map((stack) => `stack-${stack}`)];
  const missing = plugins.filter((plugin) => !available.has(plugin));
  if (missing.length) throw new Error(`Marketplace ${marketplace.name} has no plugin ${missing.join(', ')}`);

  const configPath = join(root, CONFIG_FILE);
  const exists = existsSync(configPath);
  const config = exists ? parseConfig(parseJsonObject(configPath, CONFIG_FILE)) : detectConfig(root, options.layout);

  const settingsPath = join(root, SETTINGS_FILE);
  // A broken settings file stops init instead of being replaced.
  const settings = existsSync(settingsPath) ? parseJsonObject(settingsPath, SETTINGS_FILE) : {};
  const changes: string[] = [];
  const set = (section: string, key: string, value: unknown): void => {
    const current = (settings[section] ?? {}) as Record<string, unknown>;
    if (JSON.stringify(current[key]) === JSON.stringify(value)) return;
    changes.push(`${key in current ? '~' : '+'} ${section}.${key} = ${JSON.stringify(value)}`);
    settings[section] = { ...current, [key]: value };
  };
  set('extraKnownMarketplaces', marketplace.name, { source: options.marketplace.source });
  for (const plugin of plugins) set('enabledPlugins', `${plugin}@${marketplace.name}`, true);

  const hooks = (settings.hooks ?? {}) as Record<string, unknown>;
  const warnings = FLOW_HOOK_EVENTS.filter((event) => hookCommands(hooks[event]).length)
    .map((event) => `${SETTINGS_FILE} already has ${event} hooks (${hookCommands(hooks[event]).join('; ')}); flow handles ${event} too, so remove any that do the same job`);
  const flowAgentsDirectory = join(marketplacePath, entries.find((plugin) => plugin.name === 'flow')?.source ?? '', 'agents');
  const flowAgents = existsSync(flowAgentsDirectory) ? readdirSync(flowAgentsDirectory).filter((name) => name.endsWith('.md')) : [];
  for (const agent of flowAgents) {
    if (existsSync(join(root, '.claude', 'agents', agent))) warnings.push(`.claude/agents/${agent} has the same name as the flow agent flow:${agent.slice(0, -3)}; remove one of them`);
  }
  return { root, config: { path: configPath, value: config, exists }, settings: { path: settingsPath, value: settings, changes }, warnings };
}

// `flow init --shim`: a user-level `flow` (sh and cmd) for terminals where the plugin's bin/ is not on PATH.
export function installShim(directory: string, plugin = pluginRoot()): string[] {
  ensureDirectory(directory);
  const files: Array<[string, string]> = [
    ['flow.mjs', readFileSync(join(plugin, 'shim', 'flow.mjs'), 'utf8')],
    ['flow', '#!/bin/sh\nexec node "$(dirname -- "$0")/flow.mjs" "$@"\n'],
    ['flow.cmd', '@node "%~dp0flow.mjs" %*\r\n'],
  ];
  for (const [name, content] of files) writeFileAtomic(join(directory, name), content);
  chmodSync(join(directory, 'flow'), 0o755);
  return files.map(([name]) => normalizePath(join(directory, name)));
}

export const DEFAULT_SHIM_DIRECTORY = join(homedir(), '.local', 'bin');
