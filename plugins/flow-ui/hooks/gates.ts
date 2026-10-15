import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { ReviewerState } from '../types'

// Mechanical half of the `--reviewer` rule in the flow core rules; the flag survives compaction.
// Each prompt with the flag authorizes exactly one flow:feature-reviewer spawn ("every ticket is done"
// is left to the agent's own first step).

const reviewer = atom({ plugin: 'flow-ui', key: 'reviewer' } as const, { allowed: 0 } as ReviewerState)

const REVIEWER = 'flow:feature-reviewer'
const REVIEWER_FLAG = /(?:^|\s)--reviewer(?=\s|$)/

export const registerGates: Register = on => {
  on('prompt.submit', async ($, e, next) => {
    if (REVIEWER_FLAG.test(e.text)) {
      await update($, reviewer, () => ({ allowed: 1 }))
      $.ui.status('reviewer on · 1 run')
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

    return next(e)
  })
}
