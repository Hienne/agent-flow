import { expect, test } from 'claude-code/testing'

const REVIEWER_CALL = { tool: 'Agent', description: 'review feature', prompt: 'feature-slug', subagent_type: 'flow:feature-reviewer' } as never
const OTHER_CALL = { tool: 'Agent', description: 'review task', prompt: 'task-slug', subagent_type: 'flow:code-reviewer' } as never

function engine(on: any) {
  on('tool.call', { tool: 'Agent' }, () => ({ result: { agentId: 'a1' }, text: 'review' }))
  on('prompt.submit', ($: unknown, e: { text: string }) => ({ text: e.text }))
}

test('without --reviewer the feature reviewer is refused', async ($: any, on: any) => {
  engine(on)
  await $.prompt.submit({ text: '/flow:implement .scratch/f/issues/01-a.md --full --advisor' })

  expect((await $.tool.call(REVIEWER_CALL)).deny).toBeDefined()
})

test('--reviewer authorizes exactly one run per prompt', async ($: any, on: any) => {
  engine(on)
  await $.prompt.submit({ text: '/flow:implement .scratch/f/issues/index.md --full --reviewer' })

  expect((await $.tool.call(REVIEWER_CALL)).deny).toBeUndefined()
  expect((await $.tool.call(REVIEWER_CALL)).deny).toBeDefined()

  await $.prompt.submit({ text: 'review it again --reviewer' })
  expect((await $.tool.call(REVIEWER_CALL)).deny).toBeUndefined()
})

test('a flag glued to another word does not count', async ($: any, on: any) => {
  engine(on)
  await $.prompt.submit({ text: 'run with --reviewers or x--reviewer' })

  expect((await $.tool.call(REVIEWER_CALL)).deny).toBeDefined()
})

test('other subagents are not affected', async ($: any, on: any) => {
  engine(on)

  expect((await $.tool.call(OTHER_CALL)).deny).toBeUndefined()
})
