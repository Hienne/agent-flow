import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileHash } from '../shared/filesystem.js';
import { CONFIG_FILE, ROOT, discoverRoot, useRoot } from '../shared/paths.js';

export type AdapterName = 'nx' | 'maven' | 'gradle' | 'npm';
export type Layout = 'single' | 'umbrella';

// Configured command rules; the core rules (git push, verify lock, task scope, review record/waive) need none.
export interface PolicyConfig {
  // Each pattern is a regular expression tested against every command segment.
  blockedCommands?: Array<{ pattern: string; message: string }>;
  // Executables that may only run with a unit workspace root as cwd.
  unitRootOnly?: string[];
  // CLI name → the subcommands it may run ("mr view" allows "mr view 12"); valueOptions are global options that take a value.
  readOnlyCli?: Record<string, { allow: string[]; valueOptions?: string[] }>;
}

// A command that runs at a workspace root when one of its changed files matches a glob relative to that root.
export interface CustomStep {
  name: string;
  files: string[];
  command: string[];
}

export interface FlowConfig {
  layout: Layout;
  artifactsDir?: string;
  // packageManager overrides package.json packageManager and the lockfile for the npm adapter.
  units: { adapters: AdapterName[]; packageManager?: string };
  verify?: { targets?: string[]; custom?: CustomStep[] };
  codeFiles?: string[];
  review?: { broad?: [number, number]; deep?: number };
  policy?: PolicyConfig;
  context?: { docs?: string[]; conventions?: string[] };
  hooks?: { disabled?: string[] };
}

const ADAPTERS: Record<AdapterName, true> = { nx: true, maven: true, gradle: true, npm: true };
const TOP_KEYS = new Set(['$schema', 'layout', 'artifactsDir', 'units', 'verify', 'codeFiles', 'review', 'policy', 'context', 'hooks']);

export class NotInitialisedError extends Error {
  constructor() {
    super('flow is not initialised here: no .flow/config.json in this directory or its parents. Run `flow init` first.');
  }
}

function strings(value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) throw new Error(`${label} must be an array of strings`);
  return value;
}

function object(value: unknown, label: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

export function parseConfig(value: unknown): FlowConfig {
  const config = object(value, CONFIG_FILE);
  if (!config) throw new Error(`${CONFIG_FILE} must be an object`);
  const unknown = Object.keys(config).filter((key) => !TOP_KEYS.has(key));
  if (unknown.length) throw new Error(`${CONFIG_FILE} has unknown fields: ${unknown.join(', ')}`);
  if (config.layout !== 'single' && config.layout !== 'umbrella') throw new Error(`${CONFIG_FILE}: layout must be "single" or "umbrella"`);
  if (config.artifactsDir !== undefined && (typeof config.artifactsDir !== 'string' || !config.artifactsDir)) throw new Error(`${CONFIG_FILE}: artifactsDir must be a non-empty string`);
  const units = object(config.units, 'units');
  const adapters = strings(units?.adapters, 'units.adapters');
  if (!adapters?.length) throw new Error(`${CONFIG_FILE}: units.adapters must name at least one adapter`);
  for (const adapter of adapters) if (!(adapter in ADAPTERS)) throw new Error(`${CONFIG_FILE}: unknown adapter ${adapter}`);
  if (units?.packageManager !== undefined && (typeof units.packageManager !== 'string' || !units.packageManager)) throw new Error('units.packageManager must be a non-empty string');
  const verify = object(config.verify, 'verify');
  strings(verify?.targets, 'verify.targets');
  const custom = verify?.custom;
  const nonEmptyStrings = (value: unknown) => Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string' && item);
  if (custom !== undefined && !(Array.isArray(custom) && custom.every((step) => step && typeof step.name === 'string' && step.name && nonEmptyStrings(step.files) && nonEmptyStrings(step.command)))) {
    throw new Error('verify.custom must be an array of { name, files: [glob, ...], command: [executable, ...args] }');
  }
  if (!(strings(config.codeFiles, 'codeFiles') ?? []).every((extension) => /^\.[a-z0-9]+$/.test(extension))) throw new Error('codeFiles must list lower-case file extensions such as ".ts"');
  const review = object(config.review, 'review');
  if (review?.broad !== undefined && !(Array.isArray(review.broad) && review.broad.length === 2 && review.broad.every((item) => Number.isInteger(item) && item >= 0))) throw new Error('review.broad must be [lines, files]');
  if (review?.deep !== undefined && !(Number.isInteger(review.deep) && Number(review.deep) >= 0)) throw new Error('review.deep must be a non-negative integer');
  const policy = object(config.policy, 'policy');
  const blocked = policy?.blockedCommands;
  if (blocked !== undefined && !(Array.isArray(blocked) && blocked.every((rule) => rule && typeof rule.pattern === 'string' && typeof rule.message === 'string'))) {
    throw new Error('policy.blockedCommands must be an array of { pattern, message }');
  }
  for (const rule of (blocked ?? []) as Array<{ pattern: string }>) {
    try {
      new RegExp(rule.pattern);
    } catch {
      throw new Error(`policy.blockedCommands: invalid pattern ${rule.pattern}`);
    }
  }
  strings(policy?.unitRootOnly, 'policy.unitRootOnly');
  for (const [cli, rule] of Object.entries(object(policy?.readOnlyCli, 'policy.readOnlyCli') ?? {})) {
    const entry = object(rule, `policy.readOnlyCli.${cli}`);
    if (!strings(entry?.allow, `policy.readOnlyCli.${cli}.allow`)) throw new Error(`policy.readOnlyCli.${cli}.allow is required`);
    strings(entry?.valueOptions, `policy.readOnlyCli.${cli}.valueOptions`);
  }
  const context = object(config.context, 'context');
  strings(context?.docs, 'context.docs');
  strings(context?.conventions, 'context.conventions');
  strings(object(config.hooks, 'hooks')?.disabled, 'hooks.disabled');
  return config as unknown as FlowConfig;
}

export function configPath(root = ROOT): string {
  return join(root, CONFIG_FILE);
}

export function isInitialised(root = ROOT): boolean {
  return existsSync(configPath(root));
}

export function loadConfig(root = ROOT): FlowConfig {
  const path = configPath(root);
  if (!existsSync(path)) throw new NotInitialisedError();
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Invalid ${CONFIG_FILE}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return parseConfig(value);
}

// Config edits invalidate the planned verification of open tasks, as capability edits did before.
export function configFingerprint(root = ROOT): string {
  return fileHash([configPath(root)]);
}

export function reviewThresholds(config = loadConfig()): { broad: [number, number]; deep: number } {
  return { broad: config.review?.broad ?? [100, 5], deep: config.review?.deep ?? 300 };
}

export function verifyTargets(config = loadConfig()): string[] {
  return config.verify?.targets ?? ['lint', 'test', 'build'];
}

// Binds ROOT to the nearest initialised project; returns false (ROOT stays at cwd) when there is none.
export function initRoot(starts?: Array<string | undefined>): boolean {
  const root = discoverRoot(starts);
  if (!root) return false;
  useRoot(root, loadConfig(root).artifactsDir);
  return true;
}
