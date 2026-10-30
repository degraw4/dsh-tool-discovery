import { afterEach, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import * as plugin from '../src/tool-docs.ts'
import { call, environment } from './helpers.ts'

let ctx: Context | undefined
afterEach(async () => { await ctx?.fiber.dispose(); ctx = undefined })

async function setup(presentation: 'selective' | 'catalog' | 'full', alwaysInline = ['frequent']) {
  const env = await environment(); ctx = env.ctx
  ctx.provide('ptcRuntime', { language: 'typescript', isolation: 'test', run: async () => ({ logs: [] }) } as never)
  let executions = 0
  const definition = (name: string) => defineTool({
    name, description: 'Set nested formatting options.',
    parameters: { style: { type: 'object', required: true,
      properties: { alignment: { type: 'string', enum: [`${name}_left`, `${name}_right`], required: true,
        description: 'Detailed input documentation. '.repeat(60) } }, additionalProperties: false } },
    output: { schema: { type: 'string' }, render: () => [] },
    async execute() { executions++; return 'done' },
  })
  const frequent = definition('frequent')
  const frequentSchema = frequent.parameters
  ctx.tools.register(frequent)
  ctx.tools.register(definition('occasional'))
  const fiber = ctx.plugin(plugin, { presentation, deferSchemaBytes: 1024, alwaysInline } as never)
  await fiber
  const agent = await env.harness.create(SessionId(crypto.randomUUID()))
  agent.ctx.tools.presentAs('ptc')
  const sdk = async () => (await env.ctx.systemPrompt.assemble({ scope: agent })).sections.find(s => s.name === 'tools:sdk')!.text
  return { ...env, agent, fiber, sdk, frequentSchema, executions: () => executions }
}

it.each(['selective', 'catalog'] as const)('shows exact nested arguments for alwaysInline tools in %s, leaving others deferred', async mode => {
  const { ctx, agent, sdk, frequentSchema } = await setup(mode)
  const before = await sdk()
  expect(before).toContain('"frequent_left" | "frequent_right"')
  expect(before).not.toContain('"occasional_left"')
  expect(ctx.tools.get('frequent', agent)!.parameters).toBe(frequentSchema)
  const docs = JSON.parse(await ctx.tools.get('tool_help', agent)!.execute({ names: ['occasional'] }, { agent } as never) as string)
  expect(docs.tools[0].parameters.properties.style.properties.alignment.enum).toEqual(['occasional_left', 'occasional_right'])
  expect(await sdk()).toBe(before)
})

it('does not reveal tools hidden from the Agent scope or create configured absent tools', async () => {
  const { ctx, agent, sdk } = await setup('selective', ['frequent', 'absent_tool'])
  agent.ctx.tools.restrict({ allow: ['occasional', 'tool_help'] })
  const text = await sdk()
  expect(text).not.toContain('frequent')
  expect(text).not.toContain('absent_tool')
  expect(ctx.tools.get('frequent', agent)).toBeUndefined()
  await expect(ctx.tools.get('tool_help', agent)!.execute({ names: ['frequent'] }, { agent } as never)).rejects.toThrow(/unavailable/)
})

it('keeps native validation and releases only plugin-owned registrations on unload', async () => {
  const { ctx, agent, fiber, sdk, executions } = await setup('selective')
  const bad = await call(ctx, undefined, 'frequent', { style: { alignment: 'invented' } })
  expect(bad.isError).toBe(true)
  expect(executions()).toBe(0)
  await fiber.dispose()
  expect(ctx.tools.get('tool_help', agent)).toBeUndefined()
  expect(ctx.tools.get('frequent', agent)).toBeDefined()
  expect(await sdk()).toContain('"occasional_left" | "occasional_right"')
})

it('leaves full presentation complete with an alwaysInline list', async () => {
  const { sdk } = await setup('full')
  const text = await sdk()
  expect(text).toContain('"frequent_left" | "frequent_right"')
  expect(text).toContain('"occasional_left" | "occasional_right"')
  expect(text).not.toContain('Parameters deferred')
})

it('rejects duplicate names and reserved transport or help names', async () => {
  const env = await environment(); ctx = env.ctx
  for (const alwaysInline of [['frequent', 'frequent'], ['run_code'], ['tool_help'], ['']]) {
    expect(() => plugin.apply(env.ctx, { alwaysInline } as never)).toThrow()
    expect(ctx.tools.get('tool_help')).toBeUndefined()
  }
})
