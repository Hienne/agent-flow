import { expect, test } from 'claude-code/testing'

const ROOT = '/work/app'
const FILES: Record<string, string> = {
  [`${ROOT}/.flow/config.json`]: JSON.stringify({ layout: 'single', units: { adapters: ['npm'] } }),
  [`${ROOT}/.scratch/.flow/sessions/s1.json`]: JSON.stringify({ features: ['old', 'login'] }),
  [`${ROOT}/.scratch/old/task.json`]: JSON.stringify({ feature: 'old', state: 'completed', phase: 'done', plan: {}, evidence: {} }),
  [`${ROOT}/.scratch/login/task.json`]: JSON.stringify({
    feature: 'login',
    state: 'active',
    phase: 'reviewing',
    plan: { verification: [{ id: 'a' }, { id: 'b' }] },
    evidence: {
      verification: [{ step: 'a', status: 'passed' }, { step: 'b', status: 'failed' }, { step: 'b', status: 'passed' }],
      formalReviews: [{ kind: 'code-review' }],
    },
  }),
}

// The engine hands hooks OS paths: on Windows with backslashes and the drive of the cwd.
const slashes = (path: string) => path.replaceAll('\\', '/').replace(/^[A-Za-z]:/, '')

// A flow project whose session drives `login` after finishing `old`.
function host(on: any) {
  on('session.root', () => ({ value: ROOT }))
  on('session.id', () => ({ value: 's1' }))
  on('fs.exists', ($: unknown, e: { path: string }) => ({ value: slashes(e.path) in FILES }))
  on('fs.read', ($: unknown, e: { path: string }) => ({ value: FILES[slashes(e.path)] }))
  on('clock.every', () => ({ value: undefined }))
  on('session.start', ($: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
}

test('the band shows the unfinished flow task of this session above the prompt', async ($: any, on: any) => {
  host(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'flow-ui', surface, component: 'AbovePrompt', props: { hasSurvey: false }, viewport: { columns: 100, rows: 5 } })
    expect(await ui.find({ type: 'Text', text: /^login$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /reviewing/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /verify 2\/2 · review 1\/2/ })).toBeDefined()
    await ui.unmount()
  }
})
