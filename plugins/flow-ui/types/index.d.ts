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

declare module 'claude-code' {
  interface PluginState {
    'flow-ui': { taskView: TaskView | null; reviewer: ReviewerState }
  }
}
