export type TaskTone = 'ok' | 'warn' | 'bad' | 'idle'

export type TaskView = {
  feature: string
  phase: string
  verify: string
  review: string | null
  branch: string | null
  tone: TaskTone
}

// command is the /flow:implement line for the ticket, its path from the project root.
export type ReadyTicket = { feature: string; id: string; title: string; command: string }

// A feature whose artifacts fail validation has no frontier (it fails closed); the pane says why.
export type BlockedFeature = { feature: string; errors: number; firstError: string }

export type Frontier = {
  isLoading: boolean
  loadedAt: string | null
  tickets: ReadyTicket[]
  blocked: BlockedFeature[]
}

export type ReviewerState = {
  // Spawns of flow:feature-reviewer the user has authorized and the session has not used yet.
  allowed: number
}

declare module 'claude-code' {
  interface PluginState {
    'flow-ui': { taskView: TaskView | null; frontier: Frontier; reviewer: ReviewerState }
  }
}
