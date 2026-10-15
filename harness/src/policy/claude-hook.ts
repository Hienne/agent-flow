import { handlePolicyEvent, validatePolicyEvent, type PolicyEvent } from './evaluator.js';

type HookOutput = Record<string, unknown> | null;

const denyTool = (reason: string): HookOutput => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });

// Translates a Claude Code hook payload (PreToolUse, PostToolUse, PostToolUseFailure, SessionStart, PreCompact)
// into a policy event, and the policy result back into the hook's JSON output. null means "print nothing".
// PowerShell is a shell like Bash; MultiEdit and NotebookEdit mutate files like Edit.
export function claudePolicyHook(payload: Record<string, unknown>): HookOutput {
  const hookEventName = String(payload.hook_event_name ?? 'PreToolUse');
  const rawTool = String(payload.tool_name ?? '').toLowerCase();
  const toolName = rawTool === 'powershell' ? 'bash' : rawTool === 'multiedit' || rawTool === 'notebookedit' ? 'edit' : rawTool;
  const hookName = hookEventName.toLowerCase();
  const eventType: PolicyEvent['type'] = hookName.includes('sessionstart') ? 'session-start'
    : hookName.includes('compact') ? 'session-compact'
      : hookName.includes('post') ? 'tool-result'
        : 'tool-call';
  const input = (payload.tool_input ?? {}) as Record<string, unknown>;
  const directTarget = String(input.file_path ?? input.notebook_path ?? input.path ?? '');
  let result;
  try {
    result = handlePolicyEvent(validatePolicyEvent({
      schemaVersion: 1,
      type: eventType,
      host: 'claude',
      ...(toolName ? { toolName } : {}),
      cwd: String(input.cwd ?? payload.cwd ?? process.cwd()),
      ...(toolName === 'bash' ? { command: String(input.command ?? '') } : {}),
      targets: toolName === 'write' || toolName === 'edit' ? [directTarget].filter(Boolean) : [],
      task: process.env.FLOW_TASK ?? null,
      isError: hookName.includes('failure') || Boolean((payload.tool_response as { is_error?: unknown } | undefined)?.is_error),
      sessionId: typeof payload.session_id === 'string' ? payload.session_id : null,
    }));
  } catch {
    // A tool call the policy cannot judge is denied; every other event continues.
    if (eventType === 'tool-call') return denyTool('flow policy could not evaluate the tool call.');
    if (eventType === 'tool-result' || eventType === 'session-start') return { hookSpecificOutput: { hookEventName, additionalContext: 'flow non-safety hook processing was unavailable; execution continues.' } };
    return null;
  }
  const message = result.messages.join('; ');
  if (eventType === 'tool-call') {
    if (result.decision === 'block') return denyTool(message);
    return message ? { hookSpecificOutput: { hookEventName, additionalContext: message } } : null;
  }
  // PostToolUse cannot deny a tool that already ran; `decision: block` feeds the reason back to Claude.
  if (eventType === 'tool-result' && result.decision === 'block') return { decision: 'block', reason: message };
  if (!message) return null;
  // PreCompact has no additionalContext channel; surface the message to the user instead.
  return eventType === 'session-compact' ? { systemMessage: message } : { hookSpecificOutput: { hookEventName, additionalContext: message } };
}
