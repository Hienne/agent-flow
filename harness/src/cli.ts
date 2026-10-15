#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { artifactFrontier, checkArtifacts } from './artifacts/artifacts.js';
import { checkRepository } from './check/check.js';
import { NotInitialisedError, initRoot, loadConfig } from './config/config.js';
import { coreRules, sessionStartOutput } from './context/session.js';
import { DEFAULT_SHIM_DIRECTORY, defaultMarketplace, installShim, planInit, writeInit } from './init/init.js';
import { runDoctor } from './doctor/doctor.js';
import { collectWorkspaceChanges, reviewStats } from './inspection/changes.js';
import { inspectTarget, inspectTaskTargets, type InspectionResult } from './inspection/inspect.js';
import { recordTelemetry, updateWorklog } from './observability/state.js';
import { claudePolicyHook } from './policy/claude-hook.js';
import { claudeReviewOutput, reviewHookEvent, type ReviewHookEvent, type ReviewHookResult } from './review/claude-hook.js';
import { handlePolicyEvent, validatePolicyEvent } from './policy/evaluator.js';
import { fileHash } from './shared/filesystem.js';
import { ROOT, WORKTREES_DIRECTORY, normalizePath, slugify } from './shared/paths.js';
import type { ChangeGroup, TaskHandoff, TaskManifest, VerificationStep } from './shared/types.js';
import { activeIsolation, physicalWorkspaceRoot, removeIsolation, worktreePath } from './task/isolation.js';
import { acquireTaskIsolation, beginVerification, findSharedIsolation, isolationGroup, loadTaskManifest, taskManifests, recordFormalReview, recordInspection, recordVerification, requireTaskManifest, setTaskHandoff, startTaskManifest, updateTaskManifest } from './task/manifest.js';
import { impactLines, impactOfChanges, impactOfInputs, planWarnings } from './inspection/impact.js';
import { scopeChangesToTask } from './task/scope.js';
import { FORMAL_REVIEW_KINDS, REVIEW_AGENTS, codeFileKeys, evaluateReviewGate, evaluateStop, markReviewerStarted, markReviewerStopped, parseReviewResult, readSession, reviewEvidence, reviewGateSummary } from './review/gate.js';
import { workspaceAt } from './topology/workspaces.js';
import { planVerification } from './verification/planner.js';
import { executeVerificationPlan } from './verification/runner.js';

// `clean` is the short form of `task cleanup` for the user's own terminal.
const args = process.argv[2] === 'clean' ? ['task', 'cleanup', ...process.argv.slice(3)] : process.argv.slice(2);
const command = args[0];
declare const __FLOW_VERSION__: string | undefined;
const VERSION = typeof __FLOW_VERSION__ === 'string' ? __FLOW_VERSION__ : 'dev';
const json = args.includes('--json');
const BOOLEAN_OPTIONS: Record<string, true> = { '--json': true, '--force': true, '--plan': true, '--dry-run': true, '--continue': true, '--isolate': true, '--no-isolate': true, '--all': true, '--shim': true };

function option(name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? null : null;
}

function options(name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) if (args[index] === name && args[index + 1]) values.push(args[index + 1]!);
  return values;
}

function positional(start = 1): string[] {
  const values: string[] = [];
  for (let index = start; index < args.length; index += 1) {
    const value = args[index];
    if (!value) continue;
    if (value.startsWith('--')) {
      if (!BOOLEAN_OPTIONS[value]) index += 1;
      continue;
    }
    values.push(value);
  }
  return values;
}

function output<T>(value: T, human: (value: T) => string): void {
  process.stdout.write(json ? `${JSON.stringify(value, null, 2)}\n` : `${human(value)}\n`);
}
function taskChangeFingerprint(groups: Array<{ workspace: { relativeRoot: string }; changes: Array<{ path: string; status: string; absolutePath: string }> }>): string {
  const changes = groups.flatMap((group) => group.changes.map((change) => ({
    key: `${group.workspace.relativeRoot}/${change.path}`,
    status: change.status,
    path: change.absolutePath,
  }))).sort((left, right) => left.key.localeCompare(right.key));
  return fileHash(changes.map((change) => change.path), JSON.stringify(changes.map(({ key, status }) => ({ key, status }))));
}

function requireLiveIsolation(manifest: TaskManifest): void {
  if (manifest.isolation?.removedAt) throw new Error(`Task ${manifest.taskId} worktree was removed at ${manifest.isolation.removedAt}; start a new task to continue`);
}

function currentTaskScope(manifest: TaskManifest): { groups: ChangeGroup[]; warnings: ReturnType<typeof scopeChangesToTask>['warnings'] } {
  requireLiveIsolation(manifest);
  const workspaces = [...new Set(manifest.targets.map((target) => target.workspace))]
    .map((workspace) => ({ root: physicalWorkspaceRoot(manifest, workspace), base: manifest.baseline.workspaceHeads[workspace] ?? 'HEAD' }))
    .flatMap(({ root, base }) => {
      const workspace = workspaceAt(root);
      return workspace ? [{ workspace, base }] : [];
    });
  if (!workspaces.length) throw new Error('No unit workspace matched the task manifest');
  // Diff against the HEAD each workspace had at task start, so commits made during the task stay in scope.
  const collected = workspaces.map(({ workspace, base }) => collectWorkspaceChanges(workspace, base));
  const unavailable = collected.filter((group) => !group.available);
  if (unavailable.length) throw new Error(unavailable.map((group) => `${group.workspace.relativeRoot}: ${group.error}`).join('; '));
  const scoped = scopeChangesToTask(collected, manifest);
  return { groups: scoped.groups.filter((group) => group.changes.length), warnings: scoped.warnings };
}


// The formal review gate behind the Stop, SubagentStart and SubagentStop hooks.
function reviewHook(event: ReviewHookEvent): ReviewHookResult {
  if (event.event === 'subagent-start') {
    if (REVIEW_AGENTS[event.agentType ?? '']) markReviewerStarted(event.sessionId, event.agentType ?? '');
    return { decision: 'allow' };
  }
  if (event.event === 'subagent-stop') {
    const kind = REVIEW_AGENTS[event.agentType ?? ''];
    if (!kind) return { decision: 'allow' };
    const parsed = parseReviewResult(event.lastMessage);
    if (!parsed) {
      if (event.stopHookActive) markReviewerStopped(event.sessionId, event.agentType ?? '');
      return event.stopHookActive
        ? { decision: 'allow', message: `flow: ${event.agentType} ended without a FLOW-REVIEW-RESULT line; no ${kind} evidence was recorded.` }
        : { decision: 'block', reason: 'End the report with exactly one line: FLOW-REVIEW-RESULT task=<feature-slug> blocking=<count> non-blocking=<count>' };
    }
    markReviewerStopped(event.sessionId, event.agentType ?? '');
    const manifest = requireTaskManifest(parsed.feature);
    const scoped = currentTaskScope(manifest);
    const recorded = recordFormalReview(parsed.feature, reviewEvidence({ kind, source: 'subagent', agentType: event.agentType, stats: reviewStats(scoped.groups), files: codeFileKeys(scoped.groups), blocking: parsed.blocking, nonBlocking: parsed.nonBlocking }));
    recordTelemetry({ eventType: 'review.recorded', command: 'review.hook', status: kind, ...manifestTelemetry(recorded) });
    return { decision: 'allow', message: `flow recorded ${kind} evidence for ${parsed.feature} (${parsed.blocking} blocking, ${parsed.nonBlocking} non-blocking). Apply valid findings, then rerun verify --task ${parsed.feature}.` };
  }
  const manifests = readSession(event.sessionId).features.flatMap((feature) => {
    try {
      const manifest = loadTaskManifest(feature);
      return manifest ? [manifest] : [];
    } catch {
      return [];
    }
  });
  return evaluateStop(event.sessionId, manifests);
}

function usage(): void {
  process.stderr.write([
    'Usage:',
    '  flow task start <feature> --target <path|project> [--target ...] [--source <artifact|conversation>] [--source-revision <n>] [--isolate | --no-isolate]',
    '  flow task <status|complete> <feature>',
    '  flow task cleanup <feature>|--all [--force]',
    '  flow clean <feature>|--all [--force]   (short for task cleanup)',
    '  flow task handoff <feature> --to <state>',
    '  flow task block <feature> --reason <code>',
    '  flow inspect [<path|project> | --task <feature>]',
    '  flow verify --task <feature> [--plan] [--force] [--continue]',
    '  flow impact --task <feature> | [--files <path>]... [<path|unit>...]  # units and workspaces that consume the changed units',
    '  flow review status --task <feature>',
    '  flow review record --task <feature> --kind <code-review|code-simplification> [--blocking <n>] [--non-blocking <n>]  # outside Claude Code',
    '  flow review waive --task <feature> --reason <text>  # user only',
    '  flow artifact <check|frontier> <feature-dir-or-file>',
    '  flow explain <path> [--task <feature>]',
    '  flow policy evaluate  # normalized event on stdin',
    '  flow hook  # Claude Code hook payload on stdin (policy and review gate)',
    '  flow event <event-type> [--feature <slug>] [--status <status>] [--handoff <state>]',
    '  flow init [<dir>] [--layout single|umbrella] [--stack <name>[,<name>]] [--marketplace <dir>] [--dry-run]',
    '  flow init --shim [--dry-run]  # user-level flow launcher in ~/.local/bin',
    '  flow check [<repo root>]  # plugin repository rules: banned strings, frontmatter, references',
    '  flow doctor',
    '  flow --version',
  ].join('\n') + '\n');
  process.exitCode = 2;
}

function isolationSummary(manifest: TaskManifest): string[] {
  const isolation = manifest.isolation;
  if (!isolation) return ['ISOLATION none: edits land in the user checkout'];
  if (isolation.removedAt) return [`ISOLATION removed at ${isolation.removedAt}`];
  return isolation.repositories.map((repository) => `WORKTREE ${repository.workspace}: ${normalizePath(worktreePath(isolation, repository.workspace))} (branch ${isolation.branch} from ${repository.baseBranch ?? 'detached HEAD'}@${repository.baseHead.slice(0, 8)})`);
}

function manifestTelemetry(manifest: TaskManifest | null): Record<string, unknown> {
  if (!manifest) return {};
  return {
    taskId: manifest.taskId,
    feature: manifest.feature,
    sourceType: manifest.source.type,
    source: manifest.source.path,
    sourceRevision: manifest.source.revision,
  };
}

type SuccessfulInspection = InspectionResult & {
  status: 'ok';
  workspace: NonNullable<InspectionResult['workspace']>;
  project: NonNullable<InspectionResult['project']> | null;
  task: NonNullable<InspectionResult['task']>;
  changes: NonNullable<InspectionResult['changes']>;
  verification: VerificationStep[];
};

function successfulInspection(result: InspectionResult): SuccessfulInspection {
  if (result.status !== 'ok' || !result.workspace || !result.task || !result.changes || !result.verification) throw new Error(result.message ?? 'Inspection failed');
  return result as SuccessfulInspection;
}

function publicInspection(result: InspectionResult): InspectionResult {
  if (!result.verification) return result;
  return {
    ...result,
    verification: result.verification.map((step) => {
      if (step.kind !== 'command') return step;
      const { cwd: _cwd, fingerprint: _fingerprint, ...publicStep } = step;
      return publicStep as VerificationStep;
    }),
  };
}

function contextLines(inspection: InspectionResult): string[] {
  return [
    ...(inspection.context?.docs.map((doc) => `CONTEXT ${doc}`) ?? []),
    ...(inspection.context?.conventions.map((doc) => `CONVENTION ${doc}`) ?? []),
    ...(inspection.context?.preflights.map((preflight) => `PREFLIGHT suggested ${preflight}`) ?? []),
  ];
}

function cleanupWorktree(root: string, force: boolean): { branch: string; tasks: string[]; removed: string[]; deletedBranches: string[]; keptBranches: string[] } {
  const shared = findSharedIsolation(root);
  if (!shared) throw new Error(`No live worktree found at ${root}`);
  const verifying = shared.tasks.filter((task) => task.phase === 'verifying');
  if (verifying.length) throw new Error(`Cannot remove the worktree while verification owns the snapshot of ${verifying.map((task) => task.taskId).join(', ')}`);
  const removal = removeIsolation(shared.isolation, force);
  const removedAt = new Date().toISOString();
  for (const task of shared.tasks) {
    updateTaskManifest(task.feature, (current) => {
      if (current.isolation) current.isolation.removedAt = removedAt;
      return current;
    });
  }
  return { branch: shared.isolation.branch, ...removal, tasks: shared.tasks.map((task) => task.taskId) };
}

function cleanupSummary(value: ReturnType<typeof cleanupWorktree>): string {
  return [
    `CLEANED: ${value.tasks.join(', ')}`,
    ...value.removed.map((workspace) => `REMOVED worktree ${workspace}`),
    ...value.deletedBranches.map((workspace) => `DELETED branch ${value.branch} in ${workspace}`),
    ...value.keptBranches.map((workspace) => `KEPT branch ${value.branch} in ${workspace}: not merged into the checked-out branch; merge it, or rerun with --force to delete it`),
  ].join('\n');
}

// Hooks fire in every project where the plugin is enabled, so outside an initialised project they allow everything.
const FAIL_OPEN = { schemaVersion: 1, decision: 'allow', message: null, messages: [], effects: [] };

async function main(): Promise<void> {
  const started = Date.now();
  if (command === '--version' || command === '-v') {
    output({ schemaVersion: 1, version: VERSION }, (value) => value.version);
    return;
  }
  const initialised = initRoot();
  // Every Claude Code hook of the plugin: payload on stdin, hook JSON on stdout; prints nothing outside an initialised project.
  if (command === 'hook') {
    if (!initialised) return;
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(readFileSync(0, 'utf8')) as Record<string, unknown>;
    } catch {
      payload = {};
    }
    const reviewEvent = reviewHookEvent(payload);
    let hookOutput: Record<string, unknown> | null;
    if (payload.hook_event_name === 'SessionStart') hookOutput = sessionStartOutput(loadConfig(), coreRules());
    else if (!reviewEvent) hookOutput = claudePolicyHook(payload);
    else {
      // The review gate fails open so a harness fault never traps the session; completion stays gated inside verify.
      try {
        hookOutput = claudeReviewOutput(reviewHook(reviewEvent));
      } catch {
        hookOutput = { systemMessage: 'flow review gate hook was unavailable; the task still cannot complete without formal review evidence.' };
      }
    }
    if (hookOutput) process.stdout.write(JSON.stringify(hookOutput));
    return;
  }
  if (command === 'check') {
    const problems = checkRepository(resolve(positional(1)[0] ?? '.'));
    output({ schemaVersion: 1, problems }, (value) => value.problems.length
      ? value.problems.map((problem) => `${problem.file}${problem.line ? `:${problem.line}` : ''}: ${problem.message}`).join('\n')
      : 'flow check: clean');
    if (problems.length) process.exitCode = 1;
    return;
  }
  if (command === 'init') {
    const dryRun = args.includes('--dry-run');
    if (args.includes('--shim')) {
      const files = dryRun ? [] : installShim(DEFAULT_SHIM_DIRECTORY);
      output({ schemaVersion: 1, directory: normalizePath(DEFAULT_SHIM_DIRECTORY), files, dryRun }, (value) => dryRun
        ? `DRY RUN: would write flow, flow.cmd and flow.mjs to ${value.directory}`
        : [...value.files.map((file) => `WROTE ${file}`), `Add ${value.directory} to PATH to run flow from any terminal.`].join('\n'));
      return;
    }
    const layout = option('--layout');
    if (layout !== null && layout !== 'single' && layout !== 'umbrella') return usage();
    const marketplace = option('--marketplace') ?? defaultMarketplace();
    if (!marketplace) throw new Error('Cannot find the agentflow marketplace directory; pass --marketplace <dir>');
    const plan = planInit(resolve(positional(1)[0] ?? '.'), { layout, marketplace, stacks: options('--stack').flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean) });
    if (!dryRun) writeInit(plan);
    output({ schemaVersion: 1, ...plan, dryRun }, (value) => [
      `CONFIG ${normalizePath(value.config.path)} (${value.config.exists ? 'kept' : 'new'}): ${JSON.stringify(value.config.value)}`,
      `SETTINGS ${normalizePath(value.settings.path)}${value.settings.changes.length ? '' : ' (no change)'}`,
      ...value.settings.changes.map((change) => `  ${change}`),
      ...value.warnings.map((warning) => `WARN ${warning}`),
      dryRun ? 'DRY RUN: nothing written' : 'DONE',
    ].join('\n'));
    return;
  }
  if (!initialised && command === 'policy' && args[1] === 'evaluate') {
    output(FAIL_OPEN, () => 'ALLOW');
    return;
  }
  if (!initialised && command && !['artifact', 'doctor'].includes(command)) throw new NotInitialisedError();
  if (command === 'task') {
    const action = args[1];
    const feature = positional(2)[0];
    if (action === 'cleanup' && args.includes('--all')) {
      const force = args.includes('--force');
      const roots = [...new Set(taskManifests().flatMap((task) => task.isolation && !task.isolation.removedAt ? [task.isolation.root] : []))];
      // One stuck worktree must not keep the others alive.
      const results = roots.map((root) => {
        try {
          // A sweep must not pull the worktree out from under a task that is still running; name it explicitly for that.
          const holders = findSharedIsolation(root)?.tasks.filter((task) => task.state !== 'completed') ?? [];
          if (holders.length) throw new Error(`skipped, still held by ${holders.map((task) => `${task.taskId} (${task.state}/${task.phase})`).join(', ')}; run clean ${holders[0]?.feature} to remove it`);
          return { root, ...cleanupWorktree(root, force) };
        } catch (error) {
          return { root, error: error instanceof Error ? error.message : String(error) };
        }
      });
      output({ schemaVersion: 1, status: 'cleaned-all', results }, (value) => value.results.length
        ? value.results.map((result) => 'error' in result ? `FAILED ${result.root}: ${result.error}` : cleanupSummary(result)).join('\n')
        : 'No live worktrees');
      if (results.some((result) => 'error' in result)) process.exitCode = 1;
      return;
    }
    if (!feature || !['start', 'status', 'handoff', 'block', 'complete', 'cleanup'].includes(action ?? '')) return usage();
    if (action === 'start') {
      const targets = options('--target');
      if (!targets.length) throw new Error('task start requires at least one --target');
      if (slugify(feature) !== feature) throw new Error(`Feature must be English kebab-case: ${feature}`);
      const existing = loadTaskManifest(feature);
      if (existing && existing.state !== 'completed' && !existing.isolation?.removedAt) throw new Error(`Feature ${feature} already has an active task in phase ${existing.phase}`);
      let inspections = targets.map(inspectTarget).map(successfulInspection);
      // Isolation is opt-in; a feature that already has a live worktree keeps using it so its tickets stay on one branch.
      const isolate = !args.includes('--no-isolate')
        && (args.includes('--isolate') || Boolean(findSharedIsolation(`${WORKTREES_DIRECTORY}/${isolationGroup(feature, option('--source'))}`)));
      const created = !isolate ? null : acquireTaskIsolation(feature, option('--source'), inspections.map((inspection) => inspection.workspace.root));
      const isolation = created?.isolation ?? null;
      let manifest: TaskManifest;
      try {
        if (isolation) {
          inspections = inspections.map((inspection) => successfulInspection(inspectTarget(resolve(ROOT, isolation.root, relative(ROOT, resolve(ROOT, inspection.target))))));
        }
        manifest = startTaskManifest({ feature, source: option('--source') ?? 'conversation', sourceRevision: option('--source-revision'), inspections, isolation });
      } catch (error) {
        created?.rollback();
        throw error;
      }
      for (const warning of created?.warnings ?? []) process.stderr.write(`WARNING ${warning}\n`);
      output(manifest, (value) => [
        `STARTED: ${value.taskId} (${value.targets.map((target) => `${target.workspace}:${target.project ?? '*'}`).join(', ')})`,
        ...isolationSummary(value),
        ...(isolation ? ['Edit files only inside the worktree above and run npm/nx from its workspace root; the user keeps working in their own checkout.'] : []),
      ].join('\n'));
      recordTelemetry({ eventType: 'task.started', command: 'task.start', status: 'active', ...manifestTelemetry(manifest) });
      return;
    }
    if (action === 'status') {
      const manifest = requireTaskManifest(feature);
      output(manifest, (value) => [`${value.taskId}: ${value.state}/${value.phase}, handoff=${value.taskHandoff.state}, revision=${value.manifestRevision}`, ...isolationSummary(value)].join('\n'));
      return;
    }
    if (action === 'cleanup') {
      // A feature's worktree outlives the task that created it, so resolve it by root rather than by this task's own record.
      const root = loadTaskManifest(feature)?.isolation?.root ?? `${WORKTREES_DIRECTORY}/${feature}`;
      output({ schemaVersion: 1, status: 'cleaned', ...cleanupWorktree(root, args.includes('--force')) }, cleanupSummary);
      return;
    }
    if (action === 'handoff') {
      const handoff = option('--to') as TaskHandoff | null;
      if (!handoff || !['not-ready', 'ready-for-verification', 'blocked', 'completed'].includes(handoff)) throw new Error('Invalid task handoff state');
      const before = requireTaskManifest(feature);
      const manifest = setTaskHandoff(feature, handoff, option('--reason'));
      output(manifest, (value) => `HANDOFF: ${value.taskId} -> ${value.taskHandoff.state}`);
      recordTelemetry({ eventType: 'task.handoff', command: 'task.handoff', status: manifest.state, transitionFrom: before.taskHandoff.state, transitionTo: handoff, handoff, ...manifestTelemetry(manifest) });
      return;
    }
    if (action === 'block') {
      const manifest = setTaskHandoff(feature, 'blocked', option('--reason') ?? 'external-blocker');
      output(manifest, (value) => `BLOCKED: ${value.taskId} (${value.taskHandoff.reason})`);
      return;
    }
    const manifest = setTaskHandoff(feature, 'completed');
    output(manifest, (value) => `COMPLETED: ${value.taskId}`);
    return;
  }

  if (command === 'inspect') {
    const task = option('--task');
    if (task) {
      const manifest = requireTaskManifest(task);
      requireLiveIsolation(manifest);
      const inspections = inspectTaskTargets(manifest.targets).map(successfulInspection);
      const steps = new Map<string, VerificationStep>();
      for (const inspection of inspections) for (const step of inspection.verification) steps.set(step.id, step);
      const updated = recordInspection(task, [...steps.values()]);
      const result = { schemaVersion: 2, status: 'ok', task: updated, inspections: inspections.map(publicInspection) };
      output(result, (value) => [`Task: ${value.task.taskId}`, ...value.inspections.flatMap((inspection) => [
        ...contextLines(inspection),
      ])].join('\n'));
      recordTelemetry({ eventType: 'task.inspected', command: 'inspect', status: 'ok', durationMs: Date.now() - started, ...manifestTelemetry(updated) });
      return;
    }
    const result = inspectTarget(positional()[0] ?? '.');
    output(publicInspection(result), (value) => value.status === 'ok'
      ? [`Workspace: ${value.workspace?.root}`, `Project: ${value.project?.name ?? '(workspace-level)'}`, `Task: ${value.task?.kinds.join(', ')}`, ...contextLines(value), ...(value.verification?.map((step) => `VERIFY ${step.id}`) ?? [])].join('\n')
      : `ERROR: ${value.message}`);
    if (result.status !== 'ok') process.exitCode = 2;
    return;
  }


  if (command === 'impact') {
    const feature = option('--task');
    const inputs = [...positional(), ...options('--files')];
    if (Boolean(feature) === Boolean(inputs.length)) return usage();
    const result = { schemaVersion: 1, status: 'ok', impacts: feature ? impactOfChanges(currentTaskScope(requireTaskManifest(feature)).groups) : impactOfInputs(inputs) };
    output(result, (value) => impactLines(value.impacts).join('\n') || 'No changed unit');
    return;
  }

  if (command === 'verify') {
    const feature = option('--task');
    if (!feature) return usage();
    const manifest = requireTaskManifest(feature);
    const scoped = currentTaskScope(manifest);
    const groups = scoped.groups;
    const stats = reviewStats(groups);
    const plan = planVerification(groups);
    if (args.includes('--plan')) {
      const review = evaluateReviewGate(manifest, stats, codeFileKeys(groups));
      const impact = impactOfChanges(groups);
      const result = { schemaVersion: 2, status: 'planned', stats, review, plan, scopeWarnings: scoped.warnings, impact };
      output(result, (value) => [...value.scopeWarnings.map((warning) => `WARNING ${warning.workspace}/${warning.file}: ${warning.message}`), ...planWarnings(value.impact), ...value.plan.steps.map((step) => `${step.kind.padEnd(12)} ${step.id}`), reviewGateSummary(value.review, value.stats)].join('\n'));
      return;
    }
    const isolation = activeIsolation(manifest);
    recordInspection(feature, plan.steps);
    const active = beginVerification(feature);
    const beforeFingerprint = taskChangeFingerprint(groups);
    const results = await executeVerificationPlan(plan, {
      force: args.includes('--force'),
      continueOnError: args.includes('--continue'),
      ...(isolation ? { workspaceRoot: (workspace: string) => worktreePath(isolation, workspace) } : {}),
    });
    if (!results.length) results.push(groups.length
      ? {
          id: 'task-scope:no-verification-steps',
          status: 'failed',
          cached: false,
          cacheMissReason: 'not-cacheable',
          durationMs: 0,
          output: 'Task-scoped changes exist, but no applicable verification step could be planned.',
        }
      : {
          id: 'task-scope:no-applicable-steps',
          status: 'passed',
          cached: false,
          cacheMissReason: 'not-cacheable',
          durationMs: 0,
          output: 'The current task-scoped change set has no applicable verification steps.',
        });
    const after = currentTaskScope(active);
    const afterGroups = after.groups;
    if (taskChangeFingerprint(afterGroups) !== beforeFingerprint) {
      throw new Error('Task-scoped changes changed during verification; results were not recorded. Re-run verify against the current snapshot.');
    }
    const failed = results.filter((result) => result.status === 'failed');
    const review = evaluateReviewGate(active, stats, codeFileKeys(groups));
    const completed = recordVerification(feature, results, active.manifestRevision, review);
    const worklog = updateWorklog(completed, groups, stats, results, review);
    const status = failed.length ? 'failed' : completed.phase === 'reviewing' ? 'review-required' : 'passed';
    const result = { schemaVersion: 2, status, stats, review, scopeWarnings: scoped.warnings, worklog: normalizePath(relative(ROOT, worklog)), task: completed, results };
    output(result, (value) => [...value.scopeWarnings.map((warning) => `WARNING ${warning.workspace}/${warning.file}: ${warning.message}`), ...value.results.flatMap((item) => [`${item.status.toUpperCase().padEnd(7)} ${item.id}${item.cached ? ' (cached)' : ''}`, ...(item.status === 'failed' && item.output ? [item.output.replace(/^/gm, '    ')] : [])]), reviewGateSummary(value.review, value.stats), `Task: ${value.task.state}/${value.task.phase}`, `Worklog: ${value.worklog}`].join('\n'));
    for (const item of results) recordTelemetry({ eventType: 'verification.completed', command: 'verify', status: item.status, durationMs: item.durationMs, verificationStep: item.id, cacheHits: item.cached ? 1 : 0, cacheMissReason: item.cacheMissReason, ...manifestTelemetry(completed) });
    if (failed.length) process.exitCode = 1;
    else if (status === 'review-required') process.exitCode = 3;
    return;
  }

  if (command === 'review') {
    const action = args[1];
    const feature = option('--task');
    if (!feature || !['status', 'record', 'waive'].includes(action ?? '')) return usage();
    const manifest = requireTaskManifest(feature);
    const scoped = currentTaskScope(manifest);
    const stats = reviewStats(scoped.groups);
    const files = codeFileKeys(scoped.groups);
    if (action === 'record') {
      const kind = option('--kind');
      if (!kind || !(FORMAL_REVIEW_KINDS as string[]).includes(kind)) throw new Error(`review record requires --kind ${FORMAL_REVIEW_KINDS.join('|')}`);
      const count = (name: string): number | null => option(name) === null ? null : Number(option(name));
      recordFormalReview(feature, reviewEvidence({ kind: kind as (typeof FORMAL_REVIEW_KINDS)[number], source: 'manual', stats, files, blocking: count('--blocking'), nonBlocking: count('--non-blocking') }));
    }
    if (action === 'waive') {
      const reason = option('--reason');
      if (!reason) throw new Error('review waive requires --reason');
      recordFormalReview(feature, reviewEvidence({ kind: 'waiver', source: 'user', stats, files, reason }));
    }
    const current = requireTaskManifest(feature);
    const review = evaluateReviewGate(current, stats, files);
    output({ schemaVersion: 1, status: review.satisfied ? 'satisfied' : 'required', stats, review, evidence: current.evidence.formalReviews ?? [] }, (value) => [
      reviewGateSummary(value.review, value.stats),
      ...value.evidence.map((item) => `EVIDENCE ${item.kind} via ${item.source}${item.agentType ? ` (${item.agentType})` : ''} at ${item.recordedAt}: ${item.codeLines} code lines, ${item.codeFiles} files${item.blocking === null ? '' : `, ${item.blocking} blocking/${item.nonBlocking ?? 0} non-blocking`}${item.reason ? `, reason: ${item.reason}` : ''}`),
    ].join('\n'));
    if (!review.satisfied) process.exitCode = 3;
    return;
  }

  if (command === 'artifact') {
    const action = args[1];
    const path = positional(2)[0];
    if (!path || !['check', 'frontier'].includes(action ?? '')) return usage();
    if (action === 'check') {
      const result = checkArtifacts(path);
      output(result, (value) => value.status === 'failed'
        ? value.findings.map((finding) => `${finding.severity.toUpperCase()} ${finding.file}: ${finding.message}`).join('\n')
        : value.findings.length
          ? value.findings.map((finding) => `${finding.severity.toUpperCase()} ${finding.file}: ${finding.message}`).join('\n')
          : 'Workflow artifacts valid');
      if (result.status === 'failed') process.exitCode = 1;
      return;
    }
    const result = artifactFrontier(path);
    output(result, (value) => value.status === 'failed'
      ? value.findings.map((finding) => `${finding.severity.toUpperCase()} ${finding.file}: ${finding.message}`).join('\n')
      : value.frontier.map((ticket) => `${ticket.id}: ${ticket.title} (${ticket.file})`).join('\n') || 'Frontier empty');
    if (result.status === 'failed') process.exitCode = 1;
    return;
  }

  if (command === 'explain') {
    const path = positional()[0];
    if (!path) return usage();
    const task = option('--task');
    const manifest = task ? requireTaskManifest(task) : null;
    const inspection = successfulInspection(inspectTarget(path));
    const explained = { schemaVersion: 1, status: 'ok', target: inspection.target, kinds: inspection.task.kinds, context: inspection.context, taskId: manifest?.taskId ?? null };
    output(explained, () => [`Target: ${inspection.target} (${inspection.task.kinds.join(', ')})`, ...contextLines(inspection)].join('\n'));
    return;
  }

  if (command === 'policy' && args[1] === 'evaluate') {
    const payload = validatePolicyEvent(JSON.parse(readFileSync(0, 'utf8')));
    const result = handlePolicyEvent(payload);
    output(result, (value) => `${value.decision.toUpperCase()}: ${value.messages.join('; ') || 'policy permits event'}`);
    if (result.decision === 'block') process.exitCode = 1;
    return;
  }

  if (command === 'event') {
    const eventType = positional()[0];
    if (!eventType) return usage();
    const feature = option('--feature');
    const manifest = feature ? loadTaskManifest(feature) : null;
    const identity = manifestTelemetry(manifest);
    if (!manifest && feature) Object.assign(identity, { taskId: `feature:${slugify(feature)}`, feature: slugify(feature) });
    recordTelemetry({ eventType, command: 'event', status: option('--status') ?? 'recorded', handoff: option('--handoff'), artifactRevision: option('--artifact-revision') ? Number(option('--artifact-revision')) : null, transitionFrom: option('--from'), transitionTo: option('--to'), questionCount: option('--questions') ? Number(option('--questions')) : null, decisionCount: option('--decisions') ? Number(option('--decisions')) : null, ...identity });
    output({ schemaVersion: 1, status: 'recorded', eventType, taskId: identity.taskId ?? null }, (value) => `RECORDED: ${value.eventType}${value.taskId ? ` (${String(value.taskId)})` : ''}`);
    return;
  }

  if (command === 'doctor') {
    const result = runDoctor();
    output(result, (value) => value.checks.map((item) => `${item.status.toUpperCase().padEnd(7)} ${item.name}: ${item.message}`).join('\n'));
    if (result.status === 'failed') process.exitCode = 1;
    return;
  }
  usage();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const result = { schemaVersion: 2, status: 'error', message };
  if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stderr.write(`ERROR: ${message}\n`);
  recordTelemetry({ command: command ?? 'unknown', status: 'error', durationMs: 0, exitClass: 'runtime-error' });
  process.exitCode = 2;
});
