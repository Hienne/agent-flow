import { expect, test } from 'claude-code/testing'
import { flowCli } from '../hooks/project'

const ROOT = 'D:\\work\\app'

const REPORTS: Record<string, unknown> = {
  'feature-ready': {
    status: 'passed',
    findings: [],
    frontier: [{ id: '02', file: 'issues/02-save.md', title: 'Save the edit' }],
  },
  'feature-broken': {
    status: 'failed',
    findings: [{ severity: 'error', message: 'Source revision mismatch: expected 4, found 3' }, { severity: 'warning', message: 'x' }],
    frontier: [],
  },
  'feature-done': { status: 'passed', findings: [], frontier: [] },
}

// The engine hands hooks OS paths (backslashes on Windows).
const slashes = (path: string) => path.replaceAll('\\', '/')
const dir = (name: string) => ({ name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false })
const ran = (stdout: string, stderr = '', exitCode = 0) => ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })

// The engine half a session would supply: a flow project at ROOT, the pane host, the clipboard, toasts.
function host(on: any, artifactsDir?: string) {
  const copied: string[] = []
  on('session.root', () => ({ value: `${ROOT}\\sub` }))
  on('fs.read', ($: unknown, e: { path: string }) => ({ value: JSON.stringify({ layout: 'single', units: { adapters: ['npm'] }, artifactsDir }) }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.copy', ($: unknown, e: { text: string }) => {
    copied.push(e.text)
    return { value: { isCopied: true } }
  })
  return copied
}

// Mount the pane until the scan has finished drawing, as a person reopening it would see it.
async function paneOnceLoaded($: any, surface: 'terminal' | 'desktop') {
  for (let attempt = 0; attempt < 100; attempt++) {
    const ui = await $.ui.mount({
      plugin: 'flow-ui',
      surface,
      component: 'Pane',
      requestId: 'flow-ui-frontier',
      props: { title: 'flow frontier', isFocused: true, bodyColumns: 100 },
      viewport: { columns: 100, rows: 30 },
    })
    if (await ui.find({ type: 'Text', text: /ready tickets/ })) return ui
    await ui.unmount()
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('the frontier never finished loading')
}

test('/frontier lists ready tickets, copies their command, and explains locked features', async ($: any, on: any) => {
  const copied = host(on, 'work')
  const runs: { argv: readonly string[]; init?: { cwd?: string } }[] = []
  on('fs.list', () => ({ value: [dir('feature-ready'), dir('feature-broken'), dir('feature-done'), dir('no-tickets'), { ...dir('notes.md'), kind: 'file' }] }))
  // The project is found at ROOT, not at the session root's sub folder.
  on('fs.exists', ($: unknown, e: { path: string }) => ({ value: !slashes(e.path).includes('/no-tickets/') && !slashes(e.path).includes('/sub/') }))
  on('process.run', ($: unknown, e: { argv: readonly string[]; init?: { cwd?: string } }) => {
    runs.push(e)
    return ran(JSON.stringify(REPORTS[String(e.argv[4]).replace('work/', '')]))
  })
  await $.command.run({ command: 'frontier', args: '' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await paneOnceLoaded($, surface)
    expect(await ui.find({ type: 'Text', text: /1 ready tickets/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /#02 Save the edit/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /feature-broken: 1 artifact errors.*Source revision mismatch/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /feature-done/ })).toBeUndefined()
    await ui.press({ key: 'copy-feature-ready-02' })
    await ui.unmount()
  }
  expect(copied).toEqual([
    '/flow:implement work/feature-ready/issues/02-save.md',
    '/flow:implement work/feature-ready/issues/02-save.md',
  ])
  expect(runs[0]?.init?.cwd).toBe('D:/work/app')
  expect(String(runs[0]?.argv[1])).toMatch(/\/flow\/dist\/flow\.mjs$/)
})

test('a flow run that prints no JSON shows as a locked feature instead of breaking the pane', async ($: any, on: any) => {
  host(on)
  on('fs.list', () => ({ value: [dir('feature-x')] }))
  on('fs.exists', ($: unknown, e: { path: string }) => ({ value: !slashes(e.path).includes('/sub/') }))
  on('process.run', () => ran('', 'Cannot find module', 1))
  await $.command.run({ command: 'frontier', args: '' })

  const ui = await paneOnceLoaded($, 'terminal')
  expect(await ui.find({ type: 'Text', text: /0 ready tickets/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /feature-x: 1 artifact errors.*Cannot find module/ })).toBeDefined()
})

test('outside a flow project the pane says to run flow init', async ($: any, on: any) => {
  host(on)
  on('fs.exists', () => ({ value: false }))
  await $.command.run({ command: 'frontier', args: '' })

  const ui = await paneOnceLoaded($, 'terminal')
  expect(await ui.find({ type: 'Text', text: /run flow init/ })).toBeDefined()
})

test('the flow CLI is the sibling plugin locally and the installed flow copy in the plugin cache', async () => {
  const installs = JSON.stringify({ plugins: { 'flow@agentflow': [
    { installPath: 'C:\\Users\\me\\.claude\\plugins\\cache\\agentflow\\flow\\0.1.0', lastUpdated: '2026-01-01' },
    { installPath: 'C:\\Users\\me\\.claude\\plugins\\cache\\agentflow\\flow\\0.2.0', lastUpdated: '2026-02-01' },
  ] } })
  const reads: string[] = []
  const files = (registry: string) => ({ exists: async () => false, read: async (path: string) => (reads.push(path), registry) })
  expect(await flowCli(files(installs), 'D:\\agentflow\\plugins\\flow-ui')).toBe('D:/agentflow/plugins/flow-ui/../flow/dist/flow.mjs')
  const cached = 'C:\\Users\\me\\.claude\\plugins\\cache\\agentflow\\flow-ui\\0.2.0'
  expect(await flowCli(files(installs), cached)).toBe('C:/Users/me/.claude/plugins/cache/agentflow/flow/0.2.0/dist/flow.mjs')
  expect(reads).toEqual(['C:/Users/me/.claude/plugins/installed_plugins.json'])
  expect(await flowCli(files('{ broken'), cached)).toBe('C:/Users/me/.claude/plugins/cache/agentflow/flow-ui/0.2.0/../flow/dist/flow.mjs')
})
