import { expect, test } from 'claude-code/testing'

const CHECK = 'cd /work/app && npx jest -c apps/x/jest.config.ts general 2>&1 | tail -20'
const FAILED = { isError: true, result: 'Exit code 1', text: 'FAIL apps/x/a.spec.ts\nTests: 1 failed, 3 passed' } as never
const PASSED = { result: { stdout: 'Tests: 4 passed', stderr: '' }, text: 'Tests: 4 passed' } as never
const ADVISOR_CALL = { tool: 'Agent', description: 'ask advisor', prompt: 'q', subagent_type: 'flow:solution-advisor' } as never

function engine(on: any, bash: { next: unknown }) {
  on('tool.call', { tool: 'Bash' }, () => bash.next)
  on('tool.call', { tool: 'Edit' }, () => ({ result: {}, text: 'edited' }))
  on('tool.call', { tool: 'Agent' }, () => ({ result: { agentId: 'a1' }, text: 'advice' }))
  on('prompt.submit', ($: unknown, e: { text: string }) => ({ text: e.text }))
}

async function run($: any, command: string) {
  return $.tool.call({ tool: 'Bash', command })
}
async function edit($: any) {
  return $.tool.call({ tool: 'Edit', file_path: '/work/x.ts', old_string: 'a', new_string: 'b' })
}
const nudged = (result: { context?: readonly string[] }) => (result.context ?? []).some(line => line.includes('flow:solution-advisor'))

test('without --advisor it never nudges and refuses the advisor', async ($: any, on: any) => {
  const bash = { next: FAILED }
  engine(on, bash)
  for (let attempt = 0; attempt < 3; attempt++) {
    expect(nudged(await run($, CHECK))).toBe(false)
    await edit($)
  }
  expect((await $.tool.call(ADVISOR_CALL)).deny).toBeDefined()
})

test('with --advisor it nudges once the same check fails after two fixes', async ($: any, on: any) => {
  const bash = { next: FAILED }
  engine(on, bash)
  await $.prompt.submit({ text: '/flow:implement .scratch/f/issues/01-a.md --advisor' })

  expect(nudged(await run($, CHECK))).toBe(false)
  // A rerun with no edit in between is not another fix.
  expect(nudged(await run($, CHECK.replace('tail -20', 'tail -40')))).toBe(false)
  await edit($)
  expect(nudged(await run($, CHECK))).toBe(false)
  await edit($)
  expect(nudged(await run($, CHECK))).toBe(true)

  // A pass clears the history of that check.
  bash.next = PASSED
  expect(nudged(await run($, CHECK))).toBe(false)
})

test('a failed flow verify counts as a failing check', async ($: any, on: any) => {
  const bash = { next: { result: { stdout: '', stderr: '' }, text: 'PASSED  .:app:typecheck\nFAILED  .:app:test' } }
  engine(on, bash)
  await $.prompt.submit({ text: 'go --advisor' })

  expect(nudged(await run($, 'flow verify --task f'))).toBe(false)
  await edit($)
  expect(nudged(await run($, 'flow verify --task f'))).toBe(false)
  await edit($)
  expect(nudged(await run($, 'flow verify --task f'))).toBe(true)
})

test('the advisor runs at most twice per ticket and task start resets the budget', async ($: any, on: any) => {
  const bash = { next: PASSED }
  engine(on, bash)
  await $.prompt.submit({ text: 'fix it --advisor' })

  expect((await $.tool.call(ADVISOR_CALL)).deny).toBeUndefined()
  expect((await $.tool.call(ADVISOR_CALL)).deny).toBeUndefined()
  expect((await $.tool.call(ADVISOR_CALL)).deny).toBeDefined()

  await run($, 'flow task start next-ticket --target x --source y')
  expect((await $.tool.call(ADVISOR_CALL)).deny).toBeUndefined()
})
