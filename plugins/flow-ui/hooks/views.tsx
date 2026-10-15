import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { TaskTone, TaskView } from '../types'
import { findProject } from './project'

// The task band above the prompt.

const view = atom({ plugin: 'flow-ui', key: 'taskView' } as const, null)

const REVIEW_KINDS = ['code-review', 'code-simplification']
const TONE_COLOR: Record<TaskTone, string | undefined> = { ok: 'green', warn: 'yellow', bad: 'red', idle: undefined }

// The fields of <artifactsDir>/<feature>/task.json the band reads (harness/src/shared/types.ts owns the full shape).
type Manifest = {
  feature: string
  state: string
  phase: string
  isolation?: { branch?: string } | null
  plan: { verification?: { id: string }[] }
  evidence: {
    verification?: { step: string; status: string }[]
    formalReviews?: { kind: string }[]
    lastChangeSnapshotAt?: string | null
  }
}

function describe(task: Manifest): TaskView {
  const latest = new Map<string, string>()
  for (const item of task.evidence.verification ?? []) latest.set(item.step, item.status)
  const statuses = [...latest.values()]
  const failed = statuses.filter(status => status === 'failed').length
  const passed = statuses.filter(status => status === 'passed').length
  const at = task.evidence.lastChangeSnapshotAt ? new Date(task.evidence.lastChangeSnapshotAt).toTimeString().slice(0, 5) : null
  const verify = latest.size
    ? `verify ${passed}/${task.plan.verification?.length ?? latest.size}${failed ? `, ${failed} failed` : ''}${at ? ` @${at}` : ''}`
    : 'verify not run'
  const reviewed = new Set((task.evidence.formalReviews ?? []).map(review => review.kind))
  const done = REVIEW_KINDS.filter(kind => reviewed.has(kind)).length
  const tone: TaskTone = failed || task.state === 'blocked' ? 'bad'
    : task.phase === 'reviewing' || task.phase === 'verifying' ? 'warn'
      : task.state === 'completed' ? 'ok'
        : 'idle'

  return {
    feature: task.feature,
    phase: task.phase,
    verify,
    review: task.phase === 'reviewing' || done ? `review ${done}/2` : null,
    branch: task.isolation?.branch ?? null,
    tone,
  }
}

export const registerViews: Register = on => {
  let refresh: () => Promise<void> = async () => {}

  on('session.start', async ($, e, next) => {
    const project = await findProject({ exists: path => $.fs.exists(path), read: path => $.fs.read(path) }, await $.session.root()).catch(() => null)
    const sessionId = await $.session.id()

    // flow binds a session to every feature it runs a task command for; show the latest unfinished one.
    refresh = async () => {
      let current: TaskView | null = null
      const sessionFile = project && `${project.root}/${project.artifacts}/.flow/sessions/${sessionId}.json`
      if (project && sessionFile && (await $.fs.exists(sessionFile))) {
        const { features = [] } = JSON.parse(await $.fs.read(sessionFile)) as { features?: string[] }
        const tasks: Manifest[] = []
        for (const feature of features) {
          const path = `${project.root}/${project.artifacts}/${feature}/task.json`
          if (await $.fs.exists(path)) tasks.push(JSON.parse(await $.fs.read(path)) as Manifest)
        }
        const task = [...tasks].reverse().find(item => item.state !== 'completed') ?? tasks.at(-1)
        current = task ? describe(task) : null
      }
      if (JSON.stringify(await read($, view)) !== JSON.stringify(current)) await update($, view, () => current)
    }

    // The first read is awaited so the band is there when the session opens.
    await refresh().catch(() => {})
    $.clock.every(5000, () => void refresh().catch(() => {}))

    return next(e)
  })

  // flow commands change the manifest; redraw right after them instead of waiting for the timer.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (/\bflow(?:\.mjs)?\s+(?:task|verify|review|inspect)\b/.test(e.command)) await refresh().catch(() => {})

    return ran
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const task = await read($, view)
    if (!task || e.props.hasSurvey) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const details = [task.verify, task.review, task.branch].filter(Boolean).join(' · ')

    return (
      <Box>
        <Text bold>{task.feature}</Text>
        <Text color={TONE_COLOR[task.tone]}> · {task.phase}</Text>
        <Text dimColor> · {details}</Text>
      </Box>
    )
  })
}
