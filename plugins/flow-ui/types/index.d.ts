export type TaskTone = 'ok' | 'warn' | 'bad' | 'idle'

export type TaskView = {
  feature: string
  phase: string
  verify: string
  review: string | null
  branch: string | null
  tone: TaskTone
}

export type ReviewerState = {
  // Spawns of flow:feature-reviewer the user has authorized and the session has not used yet.
  allowed: number
}

// One failing check: how many fixes were tried since it first failed, and the edit count at its last failure.
export type FailingCheck = { fixes: number; editsAtFailure: number }

export type AdvisorState = {
  isEnabled: boolean
  consults: number
  edits: number
  failing: Record<string, FailingCheck>
}

declare module 'claude-code' {
  interface PluginState {
    'flow-ui': { taskView: TaskView | null; reviewer: ReviewerState; advisor: AdvisorState }
  }
}
