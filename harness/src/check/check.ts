import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { normalizePath } from '../shared/paths.js';
import { run } from '../shared/process.js';

export interface CheckProblem {
  file: string;
  line: number | null;
  message: string;
}

// The banned names are stored reversed, so this file and the bundle never contain the strings they ban.
const unreverse = (value: string) => [...value].reverse().join('');
// DEC-027: a word or an `-`/`_`/`.` prefix, so `schema` and `schedule` pass.
export const BANNED_PATTERNS: RegExp[] = [
  new RegExp(unreverse('vdib'), 'i'),
  new RegExp(`\\b${unreverse('hcs')}(?:\\b|_)`, 'i'),
  new RegExp(unreverse('-tms'), 'i'),
  new RegExp(unreverse('tioa'), 'i'),
  new RegExp(unreverse('tsetdupadl'), 'i'),
];

const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules']);
const REFERENCE_FILE = /\.(md|json)$/;

function walk(directory: string, files: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) walk(join(directory, entry.name), files);
    } else if (entry.isFile()) files.push(join(directory, entry.name));
  }
  return files;
}

// Inside a git checkout only what git would commit counts: ignored state such as .scratch/ holds machine paths.
function repositoryFiles(root: string): string[] {
  const listed = run('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root });
  if (listed.code !== 0) return walk(root);
  return listed.stdout.split('\0').filter(Boolean).map((file) => join(root, file)).filter((path) => existsSync(path));
}

function textOf(path: string): string | null {
  const buffer = readFileSync(path);
  return buffer.includes(0) ? null : buffer.toString('utf8');
}

function bannedProblems(root: string, files: string[]): CheckProblem[] {
  const problems: CheckProblem[] = [];
  for (const path of files) {
    const file = normalizePath(relative(root, path));
    if (BANNED_PATTERNS.some((pattern) => pattern.test(file))) problems.push({ file, line: null, message: 'banned name in the file path' });
    const text = textOf(path);
    if (text === null) continue;
    text.split(/\r?\n/).forEach((line, index) => {
      const pattern = BANNED_PATTERNS.find((candidate) => candidate.test(line));
      if (pattern) problems.push({ file, line: index + 1, message: `banned string matching /${pattern.source}/i` });
    });
  }
  return problems;
}

interface Plugin {
  name: string;
  root: string;
  dependencies: string[];
  skills: Set<string>;
  agents: Set<string>;
  principles: Set<string>;
}

function names(directory: string, pick: (entry: string) => string | null): Set<string> {
  if (!existsSync(directory)) return new Set();
  return new Set(readdirSync(directory).map(pick).filter((name): name is string => name !== null));
}

function loadPlugins(root: string): Plugin[] {
  const pluginsDirectory = join(root, 'plugins');
  if (!existsSync(pluginsDirectory)) return [];
  return readdirSync(pluginsDirectory).flatMap((entry) => {
    const pluginRoot = join(pluginsDirectory, entry);
    const manifest = join(pluginRoot, '.claude-plugin', 'plugin.json');
    if (!existsSync(manifest)) return [];
    const value = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string; dependencies?: Array<string | { name?: string }> };
    const skillsDirectory = join(pluginRoot, 'skills');
    return [{
      name: value.name ?? entry,
      root: pluginRoot,
      dependencies: (value.dependencies ?? []).map((dependency) => typeof dependency === 'string' ? dependency : dependency.name ?? ''),
      skills: names(skillsDirectory, (name) => existsSync(join(skillsDirectory, name, 'SKILL.md')) ? name : null),
      agents: names(join(pluginRoot, 'agents'), (name) => name.endsWith('.md') ? basename(name, '.md') : null),
      principles: names(join(skillsDirectory, 'principles', 'principles'), (name) => /^P-[a-z0-9-]+\.md$/.test(name) ? basename(name, '.md') : null),
    }];
  });
}

function frontmatter(text: string): Record<string, string> | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return null;
  const fields: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const field = /^([a-zA-Z][\w-]*):\s*(.*)$/.exec(line);
    if (field) fields[field[1]!] = field[2]!.trim().replace(/^["']|["']$/g, '');
  }
  return fields;
}

function frontmatterProblems(root: string, plugin: Plugin): CheckProblem[] {
  const documents = [
    ...[...plugin.skills].map((name) => ({ name, path: join(plugin.root, 'skills', name, 'SKILL.md') })),
    ...[...plugin.agents].map((name) => ({ name, path: join(plugin.root, 'agents', `${name}.md`) })),
  ];
  return documents.flatMap(({ name, path }) => {
    const fields = frontmatter(readFileSync(path, 'utf8'));
    const file = normalizePath(relative(root, path));
    if (!fields) return [{ file, line: 1, message: 'missing frontmatter' }];
    const problems: CheckProblem[] = [];
    if (fields.name !== name) problems.push({ file, line: null, message: `frontmatter name "${fields.name ?? ''}" does not match "${name}"` });
    if (!fields.description) problems.push({ file, line: null, message: 'frontmatter description is empty' });
    return problems;
  });
}

const PLUGIN_ROOT_PATH = /\$\{CLAUDE_PLUGIN_ROOT\}\/([\w./-]*[\w-])/g;
const SLASH_REFERENCE = /(?<![\w.~/-])\/([a-z][a-z0-9-]*):([a-z][a-z0-9-]*)/g;
const PRINCIPLE_REFERENCE = /\bP-[a-z0-9]+(?:-[a-z0-9]+)*\b/g;

function referenceProblems(root: string, plugin: Plugin, plugins: Map<string, Plugin>): CheckProblem[] {
  const visible = [plugin, ...plugin.dependencies.map((name) => plugins.get(name)).filter((value): value is Plugin => Boolean(value))];
  const visibleNames = new Set(visible.map((item) => item.name));
  // `<plugin>:<name>` without a slash names a skill or an agent of a plugin in this repo.
  const bareReference = new RegExp(`(?<![\\w/-])(${[...plugins.keys()].map((name) => name.replace(/[-]/g, '\\-')).join('|')}):([a-z][a-z0-9-]*)`, 'g');
  const problems: CheckProblem[] = [];
  const scanned = walk(plugin.root).filter((path) => REFERENCE_FILE.test(path));
  for (const path of scanned) {
    const file = normalizePath(relative(root, path));
    readFileSync(path, 'utf8').split(/\r?\n/).forEach((line, index) => {
      const report = (message: string) => problems.push({ file, line: index + 1, message });
      for (const match of line.matchAll(PLUGIN_ROOT_PATH)) {
        if (!existsSync(join(plugin.root, match[1]!))) report(`\${CLAUDE_PLUGIN_ROOT}/${match[1]} does not exist`);
      }
      for (const match of line.matchAll(SLASH_REFERENCE)) {
        const [, owner, skill] = match;
        if (!visibleNames.has(owner!)) report(`/${owner}:${skill} names a plugin that ${plugin.name} does not depend on`);
        else if (!plugins.get(owner!)!.skills.has(skill!)) report(`/${owner}:${skill} is not a skill of ${owner}`);
      }
      for (const match of line.matchAll(bareReference)) {
        const [, owner, name] = match;
        const target = plugins.get(owner!)!;
        if (!visibleNames.has(owner!)) report(`${owner}:${name} names a plugin that ${plugin.name} does not depend on`);
        else if (!target.skills.has(name!) && !target.agents.has(name!)) report(`${owner}:${name} is neither a skill nor an agent of ${owner}`);
      }
      for (const match of line.matchAll(PRINCIPLE_REFERENCE)) {
        if (!visible.some((item) => item.principles.has(match[0]))) report(`${match[0]} is not a principle of ${[...visibleNames].join(' or ')}`);
      }
    });
  }
  return problems;
}

// `flow check`: the agentflow repository rules (DEC-021, DEC-027) over a checkout root.
export function checkRepository(root: string): CheckProblem[] {
  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`Not a directory: ${root}`);
  const plugins = new Map(loadPlugins(root).map((plugin) => [plugin.name, plugin]));
  return [
    ...bannedProblems(root, repositoryFiles(root)),
    ...[...plugins.values()].flatMap((plugin) => [...frontmatterProblems(root, plugin), ...referenceProblems(root, plugin, plugins)]),
  ];
}
