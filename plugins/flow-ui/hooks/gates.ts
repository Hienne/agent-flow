import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { AdvisorState, ReviewerState } from '../types'

// Mechanical half of the `--reviewer` and `--advisor` rules in the flow core rules; both flags survive compaction.
// --reviewer: each prompt with the flag authorizes exactly one flow:feature-reviewer spawn ("every ticket is done"
// is left to the agent's own first step). --advisor: "the same check still fails after two fixes" is counted here
// instead of left to the implementer to notice, and the advisor runs at most twice per ticket. The design-time
// advisor triggers stay with the implementer.

const reviewer = atom({ plugin: 'flow-ui', key: 'reviewer' } as const, { allowed: 0 } as ReviewerState)
const advisor = atom({ plugin: 'flow-ui', key: 'advisor' } as const, {
  isEnabled: false,
  consults: 0,
  edits: 0,
  failing: {},
} as AdvisorState)

const REVIEWER = 'flow:feature-reviewer'
const REVIEWER_FLAG = /(?:^|\s)--reviewer(?=\s|$)/
const ADVISOR = 'flow:solution-advisor'
const ADVISOR_FLAG = /(?:^|\s)--advisor(?=\s|$)/
const MAX_CONSULTS = 2
const FIXES_BEFORE_TRIGGER = 2
const CHECK = /\b(?:nx\s+(?:test|build|lint|typecheck|run|run-many|affected)|jest|tsc|vitest|flow(?:\.mjs)?\s+verify)\b/
// A pipe into grep/tail hides the exit code, so the output decides too.
const FAILURE_TEXT = /Tests:.*\b[1-9]\d* failed|\bFAIL\s|^FAILED\s|error TS\d+|error NG\d+|Failed tasks:|ERROR in /m
const TASK_START = /\bflow(?:\.mjs)?\s+task\s+start\b/

// The check a command runs, normalized so reruns with other pipes or redirections count as the same check.
function checkOf(command: string): string | null {
  const segment = command.split(/&&|\|\||[;|\n]/).find(part => CHECK.test(part))
  if (!segment) return null
  return segment
    .replace(/\s\d?>.*$/, '')
    .replace(/^\s*(?:[A-Za-z_]\w*=\S+\s+)*(?:timeout\s+\S+\s+)?/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
}

export const registerGates: Register = on => {
  on('prompt.submit', async ($, e, next) => {
    if (REVIEWER_FLAG.test(e.text)) {
      await update($, reviewer, () => ({ allowed: 1 }))
      $.ui.status('reviewer on · 1 run')
    }
    if (ADVISOR_FLAG.test(e.text)) {
      await update($, advisor, state => ({ ...state, isEnabled: true }))
      $.ui.status(`advisor on · ${(await read($, advisor)).consults}/${MAX_CONSULTS}`)
    }

    return next(e)
  })

  on('tool.call', ($, e, next) => {
    if (!e.agentId && (e.tool === 'Edit' || e.tool === 'Write' || e.tool === 'MultiEdit')) {
      void update($, advisor, state => ({ ...state, edits: state.edits + 1 }))
    }

    return next(e)
  })

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    if (e.agentId) return next(e)

    if (e.subagent_type === REVIEWER) {
      if ((await read($, reviewer)).allowed < 1) {
        return { deny: `${REVIEWER} runs only when the user's prompt contains --reviewer, once per such prompt, and only after every ticket of the feature is done.` }
      }
      await update($, reviewer, () => ({ allowed: 0 }))
      $.ui.status('reviewer used')
    }

    if (e.subagent_type === ADVISOR) {
      const state = await read($, advisor)
      if (!state.isEnabled) return { deny: `${ADVISOR} runs only when the user's prompt contains --advisor.` }
      if (state.consults >= MAX_CONSULTS) {
        return { deny: `${ADVISOR} already ran ${MAX_CONSULTS} times for this ticket; decide yourself or ask the user.` }
      }
      await update($, advisor, current => ({ ...current, consults: current.consults + 1 }))
      $.ui.status(`advisor on · ${state.consults + 1}/${MAX_CONSULTS}`)
    }

    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId || ran.deny !== undefined || e.run_in_background) return ran

    // A new ticket starts a new budget of consults and a clean failure history.
    if (TASK_START.test(e.command) && !ran.isError) {
      await update($, advisor, state => ({ ...state, consults: 0, failing: {} }))
      if ((await read($, advisor)).isEnabled) $.ui.status(`advisor on · 0/${MAX_CONSULTS}`)
      return ran
    }

    const check = checkOf(e.command)
    if (!check) return ran

    const state = await read($, advisor)
    const { [check]: previous, ...others } = state.failing
    const hasFailed = ran.isError === true || FAILURE_TEXT.test(ran.text ?? '')
    if (!hasFailed) {
      if (previous) await update($, advisor, current => ({ ...current, failing: others }))
      return ran
    }

    // A failure counts as one more fix tried only when files were edited since the last failure of this check.
    const fixes = previous ? previous.fixes + (state.edits > previous.editsAtFailure ? 1 : 0) : 0
    if (fixes < FIXES_BEFORE_TRIGGER) {
      await update($, advisor, current => ({ ...current, failing: { ...others, [check]: { fixes, editsAtFailure: current.edits } } }))
      return ran
    }

    await update($, advisor, current => ({ ...current, failing: others }))
    if (!state.isEnabled) {
      $.ui.toast(`"${check.slice(0, 60)}" still fails after ${fixes} fixes. Add --advisor to the prompt to let the agent ask ${ADVISOR}.`)
      return ran
    }
    if (state.consults >= MAX_CONSULTS) {
      $.ui.toast(`"${check.slice(0, 60)}" still fails; the ${MAX_CONSULTS} advisor runs of this ticket are used up.`)
      return ran
    }

    $.ui.toast(`Advisor trigger: "${check.slice(0, 60)}" failed after ${fixes} fixes`)
    const note = `flow --advisor trigger: \`${check}\` still fails after ${fixes} fixes in this session. `
      + `Per the flow core rules, stop fixing and spawn the ${ADVISOR} subagent with the task slug or ticket path, `
      + `the question, the fixes already tried, and this failing output.`

    return { ...ran, context: [...(ran.context ?? []), note] }
  })
}
