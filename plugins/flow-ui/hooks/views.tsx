import { atom, read, update } from 'claude-code'
import type { EngineInterface, FsEntry, ProcessRunInit, ProcessRunResult, Register } from 'claude-code'

import type { BlockedFeature, Frontier, ReadyTicket, TaskTone, TaskView } from '../types'
import { findProject, flowCli } from './project'

// The task band above the prompt and the /frontier pane.

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

const PANE = 'flow-ui-frontier'
const frontier = atom({ plugin: 'flow-ui', key: 'frontier' } as const, {
  isLoading: false,
  loadedAt: null,
  tickets: [],
  blocked: [],
} as Frontier)

// What a scan needs from the engine, bound to the `$` of the dispatch running it.
type Io = {
  root: () => Promise<string>
  cli: string
  list: (path: string) => Promise<FsEntry[]>
  exists: (path: string) => Promise<boolean>
  read: (path: string) => Promise<string>
  run: (argv: readonly string[], init: ProcessRunInit) => Promise<ProcessRunResult>
}

type FrontierReport = {
  findings: { severity: string; message: string }[]
  frontier: { id: string; file: string; title: string }[]
}

// flow owns readiness: one `flow artifact frontier` run per feature that has tickets, all at once.
async function collect(io: Io): Promise<Pick<Frontier, 'tickets' | 'blocked'>> {
  const project = await findProject(io, await io.root())
  if (!project) return { tickets: [], blocked: [{ feature: '.flow', errors: 1, firstError: 'no .flow/config.json above the session root; run flow init' }] }
  const artifacts = `${project.root}/${project.artifacts}`
  const features: string[] = []
  for (const entry of (await io.exists(artifacts)) ? await io.list(artifacts) : []) {
    if (entry.kind === 'dir' && (await io.exists(`${artifacts}/${entry.name}/issues`))) features.push(entry.name)
  }
  const reports = await Promise.all(features.sort().map(async feature => {
    const ran = await io.run(['node', io.cli, 'artifact', 'frontier', `${project.artifacts}/${feature}`, '--json'], { cwd: project.root, timeoutMs: 60_000 })
    try {
      return { feature, report: JSON.parse(ran.stdout) as FrontierReport }
    } catch {
      return { feature, report: { findings: [{ severity: 'error', message: ran.stderr.trim() || `exit ${ran.exitCode}` }], frontier: [] } }
    }
  }))

  const tickets: ReadyTicket[] = []
  const blocked: BlockedFeature[] = []
  for (const { feature, report } of reports) {
    tickets.push(...report.frontier.map(({ id, file, title }) => ({ feature, id, title, command: `/flow:implement ${project.artifacts}/${feature}/${file}` })))
    const errors = report.findings.filter(finding => finding.severity === 'error')
    if (errors.length) blocked.push({ feature, errors: errors.length, firstError: errors[0]?.message ?? '' })
  }

  return { tickets, blocked }
}

async function reload(io: Io, setFrontier: (fn: (value: Frontier) => Frontier) => Promise<unknown>) {
  await setFrontier(value => ({ ...value, isLoading: true }))
  const found = await collect(io).catch((error: unknown) => ({
    tickets: [],
    blocked: [{ feature: 'frontier', errors: 1, firstError: error instanceof Error ? error.message : String(error) }],
  }))
  await setFrontier(() => ({ ...found, isLoading: false, loadedAt: new Date().toTimeString().slice(0, 5) }))
}

function io($: EngineInterface): Io {
  return {
    root: () => $.session.root(),
    cli: flowCli($.plugin.root),
    list: path => $.fs.list(path),
    exists: path => $.fs.exists(path),
    read: path => $.fs.read(path),
    run: (argv, init) => $.process.run(argv, init),
  }
}

export const registerViews: Register = on => {
  let refresh: () => Promise<void> = async () => {}

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'frontier', description: 'Show ready flow tickets with their /flow:implement command' })

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

  on('command.run', { command: 'frontier' }, async $ => {
    await $.ui.open({ id: PANE, title: 'flow frontier' })
    // Awaited: `$` belongs to this dispatch, so the scan must finish inside it. The pane shows the progress.
    await reload(io($), fn => update($, frontier, fn))
    const value = await read($, frontier)

    return { text: `flow frontier: ${value.tickets.length} ready tickets, ${value.blocked.length} locked features.` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const value = await read($, frontier)
    const refresh = () => reload(io($), fn => update($, frontier, fn))
    const copy = async (ticket: ReadyTicket) => {
      const copied = await $.ui.copy({ text: ticket.command, surface: e.surface })
      $.ui.toast(copied.isCopied ? `Copied: ${ticket.command}` : `Could not copy: ${ticket.command}`)
    }

    return (
      <Box flexDirection="column">
        <Box key="header">
          <Text dimColor>
            {value.isLoading ? 'Scanning features…' : `${value.tickets.length} ready tickets${value.loadedAt ? ` · ${value.loadedAt}` : ''} `}
          </Text>
          <Button key="refresh" label="Refresh" dimColor onPress={refresh} />
        </Box>
        {!value.isLoading && value.tickets.length === 0 && <Text dimColor>No ticket is ready.</Text>}
        {value.tickets.map(ticket => (
          <Box key={`${ticket.feature}/${ticket.id}`}>
            <Button key={`copy-${ticket.feature}-${ticket.id}`} label="Copy" variant="primary" onPress={() => copy(ticket)} />
            <Text bold>{` ${ticket.feature}`}</Text>
            <Text>{` #${ticket.id} ${ticket.title}`}</Text>
          </Box>
        ))}
        {value.blocked.map(item => (
          <Text key={`blocked-${item.feature}`} color="yellow" wrap="truncate-end">
            {`⚠ ${item.feature}: ${item.errors} artifact errors, frontier locked (${item.firstError})`}
          </Text>
        ))}
      </Box>
    )
  })
}
