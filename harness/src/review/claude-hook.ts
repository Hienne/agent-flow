import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ReviewHookEvent {
  event: 'stop' | 'subagent-start' | 'subagent-stop';
  sessionId: string;
  agentType: string | null;
  lastMessage: string;
  stopHookActive: boolean;
}

export type ReviewHookResult = { decision: 'allow'; message?: string | null } | { decision: 'block'; reason: string };

const REVIEW_HOOK_EVENTS: Record<string, ReviewHookEvent['event']> = { Stop: 'stop', SubagentStart: 'subagent-start', SubagentStop: 'subagent-stop' };

// A subagent that reports through the SubagentHandback tool ends on that tool call, so its report (and the
// FLOW-REVIEW-RESULT line) is the tool's `message` input, not `last_assistant_message`. Read it from the transcript.
function handbackMessage(payload: Record<string, unknown>): string {
  const path = typeof payload.agent_transcript_path === 'string' ? payload.agent_transcript_path
    : typeof payload.transcript_path === 'string' && typeof payload.agent_id === 'string'
      ? join(payload.transcript_path.replace(/\.jsonl$/, ''), 'subagents', `agent-${payload.agent_id}.jsonl`)
      : null;
  if (!path) return '';
  for (const line of readFileSync(path, 'utf8').trim().split(/\r?\n/).reverse()) {
    const entry = JSON.parse(line) as { type?: string; message?: { content?: Array<{ type?: string; name?: string; input?: { message?: unknown } }> } };
    if (entry.type !== 'assistant' || !Array.isArray(entry.message?.content)) continue;
    const handback = entry.message?.content?.find((part) => part.type === 'tool_use' && part.name === 'SubagentHandback');
    return typeof handback?.input?.message === 'string' ? handback.input.message : '';
  }
  return '';
}

// The review-gate view of a Claude Code Stop / SubagentStart / SubagentStop payload, or null for any other hook.
export function reviewHookEvent(payload: Record<string, unknown>): ReviewHookEvent | null {
  const event = REVIEW_HOOK_EVENTS[String(payload.hook_event_name ?? '')];
  if (!event) return null;
  let lastMessage = String(payload.last_assistant_message ?? '');
  if (event === 'subagent-stop' && !lastMessage.includes('FLOW-REVIEW-RESULT')) {
    try {
      lastMessage = handbackMessage(payload) || lastMessage;
    } catch {
      // An unreadable transcript leaves the last message as the report.
    }
  }
  return {
    event,
    sessionId: typeof payload.session_id === 'string' ? payload.session_id : '',
    agentType: typeof payload.agent_type === 'string' ? payload.agent_type : null,
    lastMessage,
    stopHookActive: Boolean(payload.stop_hook_active),
  };
}

export function claudeReviewOutput(result: ReviewHookResult): Record<string, unknown> | null {
  if (result.decision === 'block') return { decision: 'block', reason: result.reason };
  return result.message ? { systemMessage: result.message } : null;
}
