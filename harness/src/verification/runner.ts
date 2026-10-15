import { loadVerificationCache, recordVerificationCacheStep } from '../observability/state.js';
import { run, truncateOutput } from '../shared/process.js';
import type { VerificationPlan, VerificationResult } from '../shared/types.js';

export interface VerificationOptions {
  force?: boolean;
  continueOnError?: boolean;
  // Maps a logical workspace to its physical root when the task runs in an isolated worktree.
  workspaceRoot?: (workspace: string) => string;
}

export async function executeVerificationPlan(
  plan: VerificationPlan,
  options: VerificationOptions = {},
): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];
  for (const step of plan.steps) {
    if (step.kind === 'configuration-error') {
      results.push({ id: step.id, status: 'failed', cached: false, cacheMissReason: 'not-cacheable', durationMs: 0, output: step.message });
      if (!options.continueOnError) break;
      continue;
    }
    const cached = loadVerificationCache().steps[step.id];
    if (!options.force && cached?.status === 'passed' && cached.fingerprint === step.fingerprint) {
      results.push({ id: step.id, status: 'passed', cached: true, cacheMissReason: null, durationMs: 0, output: '' });
      continue;
    }
    const cacheMissReason = options.force ? 'forced' : !cached ? 'no-entry' : cached.status !== 'passed' ? 'previous-failure' : 'fingerprint-changed';
    const [command, ...args] = step.command;
    if (!command) {
      results.push({ id: step.id, status: 'failed', cached: false, cacheMissReason: 'invalid-command', durationMs: 0, output: 'Verification command is empty' });
      if (!options.continueOnError) break;
      continue;
    }
    const execution = run(command, args, { cwd: step.cwd, maxBuffer: 32 * 1024 * 1024 });
    const status = execution.code === 0 ? 'passed' : 'failed';
    const result: VerificationResult = {
      id: step.id,
      status,
      cached: false,
      cacheMissReason,
      durationMs: execution.durationMs,
      command: execution.command,
      output: truncateOutput(`${execution.stdout}${execution.stderr}`.trim()),
    };
    results.push(result);
    recordVerificationCacheStep(step.id, { status, fingerprint: step.fingerprint, verifiedAt: new Date().toISOString(), durationMs: execution.durationMs });
    if (status === 'failed' && !options.continueOnError) break;
  }
  return results;
}
