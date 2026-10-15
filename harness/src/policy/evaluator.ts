import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { dependencyLinkShared } from '../task/isolation.js';
import { findActiveTaskForTarget, findIsolatedTaskForUserPath, loadTaskManifest, updateTaskManifest } from '../task/manifest.js';
import { findWorkspace } from '../topology/workspaces.js';
import { clearVerificationCache, recordTelemetry } from '../observability/state.js';
import { loadConfig } from '../config/config.js';
import { ROOT, isWithin, normalizePath } from '../shared/paths.js';
import { bindSessionTask, commandTaskFeature } from '../review/gate.js';
import { run } from '../shared/process.js';
import { SHELL_COMMAND_FLAG, SHELL_INTERPRETER, shellTokens, shellWords, splitSegments, withWrappedCommands, withoutHeredocData } from './shell.js';

export type PolicyEventType = 'tool-call' | 'tool-result' | 'session-start' | 'session-compact';
export type PolicyDecision = 'allow' | 'warn' | 'block';

export interface PolicyEvent {
  schemaVersion: 1;
  type: PolicyEventType;
  host: 'claude' | 'manual';
  toolName?: string;
  cwd: string;
  command?: string;
  targets?: string[];
  task?: string | null;
  isError?: boolean;
  failureClass?: string | null;
  sessionId?: string | null;
}

export interface PolicyResult {
  schemaVersion: 1;
  decision: PolicyDecision;
  messages: string[];
  effects: Array<'invalidate-verification-cache' | 'format-targets' | 'touch-task' | 'record-failure' | 'bind-session'>;
}

const DEPENDENCY_MUTATION = /\b(?:(?:npm(?:\.cmd)?\s+(?:i|install|ci|add|uninstall|remove|rm|update|up|dedupe|prune)|pnpm(?:\.cmd)?\s+(?:i|install|add|remove|update)|yarn(?:\.cmd)?\s+(?:install|add|remove|upgrade))(?=\s|$)|yarn(?:\.cmd)?\s*$)/i;
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const nameAlternation = (names: string[]) => names.map(escapeRegExp).join('|');

// An unquoted word that names one of the executables, with an optional path prefix and .exe/.cmd suffix.
function executablePattern(names: string[]): RegExp {
  return new RegExp(`^(?:\\S*[\\\\/])?(?:${nameAlternation(names)})(?:\\.exe|\\.cmd)?$`, 'i');
}

// The words after the first unquoted call of the executable in a segment, or null when the segment never calls it.
function callArguments(segment: string, executable: RegExp): string[] | null {
  const words = shellWords(segment);
  const index = words.findIndex((word) => !word.quoted && executable.test(word.text));
  return index < 0 ? null : words.slice(index + 1).map((word) => word.text);
}

// Git Bash spells D:\x as /d/x; resolve() would read that as a path on the current drive.
const fromGitBashPath = (path: string) => path.replace(/^\/([a-z])(?=\/|$)/i, (_match, drive: string) => `${drive.toUpperCase()}:`);

// Only an executable in command position is a call (after VAR=value, `timeout N`, or a subshell paren),
// so an argument such as `grep -v "npm warn"` is not. A leading `cd <dir>` moves the effective cwd
// for the segments after it, so `cd <unit root> && npx nx test x` is judged where it runs.
// A shell wrapper's command string (`powershell -Command "npm test"`) is checked as its own command.
function unitCommandOutsideRoot(segments: string[], cwd: string, names: string[]): boolean {
  if (!names.length) return false;
  const executable = executablePattern(names);
  const substitution = new RegExp(`(?:\\$\\(|\`)\\s*(?:${nameAlternation(names)})(?:\\.cmd|\\.exe)?(?=\\s|[\`)]|$)`, 'i');
  let effectiveCwd = cwd;
  const outsideRoot = () => {
    const workspace = findWorkspace(effectiveCwd);
    return !workspace || resolve(workspace.root) !== resolve(effectiveCwd);
  };
  for (const segment of segments) {
    const tokens = shellTokens(segment.trim().replace(/^\(+\s*/, ''));
    while (/^[A-Za-z_]\w*=/.test(tokens[0] ?? '')) tokens.shift();
    if (tokens[0] === 'timeout') tokens.splice(0, 2);
    const first = tokens[0] ?? '';
    if (first === 'cd') {
      effectiveCwd = resolve(effectiveCwd, fromGitBashPath(tokens[1] ?? '.'));
      continue;
    }
    if (SHELL_INTERPRETER.test(first)) {
      const flag = tokens.findIndex((token, index) => index > 0 && SHELL_COMMAND_FLAG.test(token));
      if (flag > 0 && unitCommandOutsideRoot(splitSegments(tokens.slice(flag + 1).join(' ')), effectiveCwd, names)) return true;
      continue;
    }
    if ((executable.test(first) || substitution.test(segment)) && outsideRoot()) return true;
  }
  return false;
}

const GIT = executablePattern(['git']);

// Agents may run any git command except push: the developer publishes branches.
function gitPush(segment: string): boolean {
  const tokens = callArguments(segment, GIT);
  if (!tokens) return false;
  let index = 0;
  let pushAlias = false;
  while (index < tokens.length && tokens[index]?.startsWith('-')) {
    const option = tokens[index] ?? '';
    // `git -c alias.p=push p` would otherwise slip through as an unknown subcommand.
    if (option === '-c' && /^alias\.[^=]+=.*\bpush\b/i.test(tokens[index + 1] ?? '')) pushAlias = true;
    index += ['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env'].includes(option) ? 2 : 1;
  }
  return pushAlias || tokens[index]?.toLowerCase() === 'push';
}

// A read-only CLI call passes when its subcommand words start with one allowed entry ("mr view" allows "mr view 12").
// Options are skipped; a global option listed in valueOptions also skips its value.
function readOnlyViolation(segment: string, cli: string, rule: { allow: string[]; valueOptions?: string[] }): boolean {
  const tokens = callArguments(segment, executablePattern([cli]));
  if (!tokens) return false;
  const valueOptions = new Set(rule.valueOptions ?? []);
  const words: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? '';
    if (!token.startsWith('-')) words.push(token.toLowerCase());
    else if (valueOptions.has(token)) index += 1;
  }
  return !rule.allow.some((entry) => {
    const allowed = entry.toLowerCase().split(/\s+/).filter(Boolean);
    return allowed.length > 0 && allowed.every((word, index) => words[index] === word);
  });
}

const MUTATION_TOOLS: Record<string, true> = { write: true, edit: true };
const CACHE_INVALIDATION_TOOLS: Record<string, true> = { write: true, edit: true, bash: true };
const FORMAT_EXTENSIONS = /\.(?:ts|html|scss|css|json|jsonc|js|mjs|cjs)$/i;
const EVENT_KEYS = new Set(['schemaVersion', 'type', 'host', 'toolName', 'cwd', 'command', 'targets', 'task', 'isError', 'failureClass', 'sessionId']);
const REVIEW_RECORD = /\bflow(?:\.mjs|\.cmd)?\s+review\s+record\b/;
const REVIEW_WAIVE = /\bflow(?:\.mjs|\.cmd)?\s+review\s+waive\b/;
const ALLOW_TESTS = /\bflow(?:\.mjs|\.cmd)?\s+review\s+allow-tests\b/;
const EVENT_TYPES: Record<PolicyEventType, true> = { 'tool-call': true, 'tool-result': true, 'session-start': true, 'session-compact': true };
const EVENT_HOSTS: Record<PolicyEvent['host'], true> = { claude: true, manual: true };

export function validatePolicyEvent(value: unknown): PolicyEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Policy event must be an object');
  const event = value as Partial<PolicyEvent>;
  const unknown = Object.keys(value).filter((key) => !EVENT_KEYS.has(key));
  if (unknown.length) throw new Error(`Policy event has unknown fields: ${unknown.join(', ')}`);
  if (event.schemaVersion !== 1 || !event.type || !(event.type in EVENT_TYPES) || !event.host || !(event.host in EVENT_HOSTS)
      || typeof event.cwd !== 'string' || !event.cwd) throw new Error('Policy event has an invalid schemaVersion, type, host, or cwd');
  if ((event.type === 'tool-call' || event.type === 'tool-result') && (typeof event.toolName !== 'string' || !event.toolName)) {
    throw new Error('Tool policy events require toolName');
  }
  if (event.toolName) event.toolName = event.toolName.toLowerCase();
  if (event.type === 'tool-call' && event.toolName === 'bash' && (typeof event.command !== 'string' || !event.command)) {
    throw new Error('Bash tool-call events require command');
  }
  if (event.command !== undefined && typeof event.command !== 'string') throw new Error('Policy event command must be a string');
  if (event.task !== undefined && event.task !== null && typeof event.task !== 'string') throw new Error('Policy event task must be a string or null');
  if (event.failureClass !== undefined && event.failureClass !== null && typeof event.failureClass !== 'string') throw new Error('Policy event failureClass must be a string or null');
  if (event.type === 'tool-call' && (event.toolName === 'write' || event.toolName === 'edit')
      && (!Array.isArray(event.targets) || !event.targets.length || !event.targets.every((target) => typeof target === 'string' && target.length > 0))) {
    throw new Error('Write and edit tool-call events require targets');
  }
  if (event.targets !== undefined && (!Array.isArray(event.targets) || !event.targets.every((target) => typeof target === 'string'))) throw new Error('Policy event targets must be strings');
  if (event.isError !== undefined && typeof event.isError !== 'boolean') throw new Error('Policy event isError must be boolean');
  if (event.sessionId !== undefined && event.sessionId !== null && typeof event.sessionId !== 'string') throw new Error('Policy event sessionId must be a string or null');
  return event as PolicyEvent;
}


function absoluteTarget(target: string, cwd: string): string | null {
  if (!target || target.includes('://') || /\.(?:zip|jar|war|ear|apk|tar|tgz|tar\.gz):/i.test(target)) return null;
  return isAbsolute(target) ? resolve(target) : resolve(cwd, target);
}
function taskForTarget(feature: string | null | undefined, target: string) {
  const manifest = feature ? loadTaskManifest(feature) : findActiveTaskForTarget(target);
  if (!manifest || manifest.state !== 'active') return null;
  return manifest.targets.some((registered) => isWithin(resolve(ROOT, registered.path), target)) ? manifest : null;
}

export function evaluatePolicy(event: PolicyEvent): PolicyResult {
  const messages: string[] = [];
  const effects: PolicyResult['effects'] = [];
  let decision: PolicyDecision = 'allow';
  if (event.type === 'tool-call' && event.command) {
    const commandSegments = splitSegments(withoutHeredocData(event.command));
    const calls = withWrappedCommands(commandSegments);
    if (calls.some(gitPush)) {
      decision = 'block';
      messages.push('flow policy blocks git push; the developer pushes branches.');
    }
    const policy = loadConfig().policy ?? {};
    for (const rule of policy.blockedCommands ?? []) {
      const pattern = new RegExp(rule.pattern);
      if (!calls.some((segment) => pattern.test(segment))) continue;
      decision = 'block';
      messages.push(rule.message);
    }
    for (const [cli, rule] of Object.entries(policy.readOnlyCli ?? {})) {
      if (!calls.some((segment) => readOnlyViolation(segment, cli, rule))) continue;
      decision = 'block';
      messages.push(`flow policy permits only these ${cli} commands: ${rule.allow.join(', ')}.`);
    }
    if (calls.some((segment) => DEPENDENCY_MUTATION.test(segment)) && dependencyLinkShared(event.cwd)) {
      decision = 'block';
      messages.push('This worktree shares node_modules with the user\'s checkout through a junction; installing here would rewrite the user\'s dependencies. Ask the user before changing dependencies.');
    }
    // In Claude Code, review evidence must come from the reviewer subagents (SubagentStop hook), and only the user may waive.
    if (event.host === 'claude' && REVIEW_RECORD.test(event.command)) {
      decision = 'block';
      messages.push('Claude Code records formal review evidence only from the flow:code-reviewer and flow:code-simplifier subagents; spawn them with the Agent tool instead of recording evidence by hand.');
    }
    if (event.host === 'claude' && REVIEW_WAIVE.test(event.command)) {
      decision = 'block';
      messages.push('Only the user can waive formal review. Ask them to run `flow review waive --task <feature> --reason <text>` in their own terminal.');
    }
    if (event.host === 'claude' && ALLOW_TESTS.test(event.command)) {
      decision = 'block';
      messages.push('Only the user can accept skipped, removed or weakened tests. Give them the root cause and the reason for each test-integrity finding, and ask them to run `flow review allow-tests --task <feature> --reason <text>` in their own terminal.');
    }
    const unitRootOnly = policy.unitRootOnly ?? [];
    if (unitCommandOutsideRoot(commandSegments, event.cwd, unitRootOnly)) {
      decision = 'block';
      messages.push(`Run ${unitRootOnly.join(', ')} from the owning unit root (\`cd <unit root> && …\`).`);
    }
  }
  if (event.type === 'tool-call' && event.toolName && MUTATION_TOOLS[event.toolName]) {
    const productionTargets = (event.targets ?? [])
      .map((target) => absoluteTarget(target, event.cwd))
      .filter((target): target is string => Boolean(target))
      .filter((target) => Boolean(findWorkspace(target)));
    const ownership = productionTargets.map((target) => ({ target, manifest: taskForTarget(event.task, target) }));
    const verifying = ownership.filter((item) => item.manifest?.phase === 'verifying');
    if (verifying.length) {
      decision = 'block';
      messages.push(`Production mutation is blocked while task verification owns its snapshot: ${verifying.map((item) => item.target).join(', ')}. If no verify is running (it was stopped or crashed), release it with \`flow task handoff ${verifying[0]?.manifest?.feature} --to not-ready\`.`);
    }
    const redirected = ownership.filter((item) => !item.manifest)
      .map((item) => ({ target: item.target, isolated: findIsolatedTaskForUserPath(item.target) }))
      .filter((item): item is { target: string; isolated: NonNullable<ReturnType<typeof findIsolatedTaskForUserPath>> } => Boolean(item.isolated));
    if (redirected.length) {
      decision = 'block';
      messages.push(...redirected.map((item) => `Task ${item.isolated.manifest.feature} runs in an isolated worktree on ${item.isolated.manifest.isolation?.branch}; the user's checkout is off-limits. Edit ${normalizePath(item.isolated.redirect)} instead of ${normalizePath(item.target)}.`));
    }
    const unowned = ownership.filter((item) => !item.manifest && !redirected.some((entry) => entry.target === item.target)).map((item) => item.target);
    if (unowned.length && decision !== 'block') {
      decision = 'warn';
      messages.push(`Production mutation has no matching active task target: ${unowned.join(', ')}`);
    }
  }
  if (event.type === 'tool-result' && event.toolName && CACHE_INVALIDATION_TOOLS[event.toolName]) effects.push('invalidate-verification-cache');
  if (event.type === 'tool-result' && !event.isError && event.toolName && MUTATION_TOOLS[event.toolName]) effects.push('format-targets');
  if (event.type === 'tool-result' && event.isError) effects.push('record-failure');
  if (event.type === 'tool-result' && !event.isError && event.sessionId && event.command && commandTaskFeature(event.command)) effects.push('bind-session');
  if ((event.type === 'session-start' || event.type === 'session-compact') && event.task) effects.push('touch-task');
  return { schemaVersion: 1, decision, messages, effects };
}

export function handlePolicyEvent(event: PolicyEvent): PolicyResult {
  const result = evaluatePolicy(event);
  for (const effect of result.effects) {
    if (effect === 'invalidate-verification-cache') clearVerificationCache();
    if (effect === 'bind-session' && event.sessionId && event.command) {
      const feature = commandTaskFeature(event.command);
      if (feature && loadTaskManifest(feature)) bindSessionTask(event.sessionId, feature);
    }
    if (effect === 'touch-task' && event.task) updateTaskManifest(event.task, (manifest) => manifest);
    if (effect === 'format-targets') {
      for (const rawTarget of event.targets ?? []) {
        if (!FORMAT_EXTENSIONS.test(rawTarget)) continue;
        const target = absoluteTarget(rawTarget, event.cwd);
        if (!target || !existsSync(target)) continue;
        const workspace = findWorkspace(target);
        if (!workspace) continue;
        const prettier = join(workspace.root, 'node_modules', 'prettier', 'bin-prettier.js');
        if (existsSync(prettier)) run('node', [prettier, '--write', '--ignore-unknown', target], { cwd: workspace.root });
      }
    }
    if (effect === 'record-failure') {
      recordTelemetry({
        eventType: 'tool.failed',
        ...(event.toolName ? { command: event.toolName } : {}),
        status: 'failed',
        ...(event.task ? { feature: event.task } : {}),
        exitClass: event.failureClass ?? 'tool-failure',
      });
    }
  }
  recordTelemetry({
    eventType: `policy.${event.type}`,
    ...(event.toolName ?? event.command ? { command: event.toolName ?? event.command } : {}),
    status: result.decision,
    ...(event.task ? { feature: event.task } : {}),
    exitClass: result.decision === 'block' ? 'policy-block' : null,
  });
  return result;
}
