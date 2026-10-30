import { afterEach, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as plugin from '../src/tool-docs.ts'
import { environment, sampleTool } from './helpers.ts'

let ctx: Context | undefined
afterEach(async () => { await ctx?.fiber.dispose(); ctx = undefined })
const description = 'Read a document only from an allowed path. Detailed examples.'.repeat(4)
const parameters = { type: 'object', properties: { documentPath: { type: 'string' } },
  required: ['documentPath'], additionalProperties: false }

async function setup(config: object = {}) {
  const env = await environment(); ctx = env.ctx
  ctx.provide('ptcRuntime', { language: 'typescript', isolation: 'test', run: async () => ({ logs: [] }) } as never)
  let executions = 0
  const definition = { ...sampleTool('read_docs'), description, parameters,
    async execute() { executions++; return 'document' } }
  const unregister = ctx.tools.register(definition)
  const fiber = ctx.plugin(plugin, config)
  await fiber
  const agent = await env.harness.create(SessionId(crypto.randomUUID()))
  agent.ctx.tools.presentAs('ptc')
  const sdk = async () => (await env.ctx.systemPrompt.assemble({ scope: agent }))
    .sections.find(section => section.name === 'tools:sdk')!.text
  const help = (args: object) => ctx!.tools.get('tool_help', agent)!.execute(args, { agent } as never)
  return { ...env, agent, definition, fiber, unregister, sdk, help, executions: () => executions }
}

it('keeps names and purpose visible without publishing business argument structures', async () => {
  const { sdk } = await setup()
  const text = await sdk()
  expect(text).toContain('read_docs')
  expect(text).toContain('allowed path')
  expect(text).not.toContain('documentPath')
  expect(text).toContain('tool_help')
})

it('returns full definitions by name without execution or changing the catalog', async () => {
  const { sdk, help, definition, executions } = await setup()
  const before = await sdk()
  const docs = JSON.parse(await help({ names: ['read_docs'] }) as string)
  expect(docs.tools[0].parameters).toEqual(parameters)
  expect(docs.tools[0].description).toBe(description)
  expect(docs.tools[0].fingerprint).toMatch(/^[a-f0-9]{64}$/)
  expect(docs.tools[0]).not.toHaveProperty('execute')
  expect(definition.parameters).toBe(parameters)
  expect(executions()).toBe(0)
  expect(await sdk()).toBe(before)
})

it('combines named and grouped requests with deterministic deduplication', async () => {
  const { sdk, help, ctx } = await setup({ toolsets: [{ name: 'documents', description: 'Read stored documents', tools: ['read_docs','metadata'] }] })
  ctx.tools.register(sampleTool('metadata'))
  const before = await sdk()
  expect(before).toContain('Read stored documents')
  const docs = JSON.parse(await help({ names: ['read_docs'], toolsets: ['documents'] }) as string)
  expect(docs.tools.map((t: { name: string }) => t.name)).toEqual(['metadata','read_docs'])
  expect(await sdk()).toBe(before)
})

it('filters each group by Agent scope and rejects direct hidden requests', async () => {
  const { ctx, agent, sdk, help } = await setup({ toolsets: [{ name: 'documents', description: 'Read stored documents', tools: ['read_docs','private_document'] }] })
  ctx.tools.register(sampleTool('private_document'))
  agent.ctx.tools.restrict({ allow: ['read_docs', 'tool_help'] })
  expect(await sdk()).not.toContain('private_document')
  const docs = JSON.parse(await help({ toolsets: ['documents'] }) as string)
  expect(docs.tools.map((t: { name: string }) => t.name)).toEqual(['read_docs'])
  await expect(help({ names: ['private_document'] })).rejects.toThrow(/unavailable/)
  await expect(help({ names: ['run_code'] })).rejects.toThrow(/unavailable/)
})

it('rejects oversized documents instead of silently truncating their constraints', async () => {
  const { ctx, help } = await setup({ maxDocumentBytes: 1024, maxToolsPerQuery: 1,
    toolsets: [{ name: 'documents', description: 'Read', tools: ['read_docs','large'] }] })
  ctx.tools.register({ ...sampleTool('large'), description: 'A'.repeat(2048) })
  await expect(help({ toolsets: ['documents'] })).rejects.toThrow(/limit|at most/)
  await expect(help({ names: ['large'] })).rejects.toThrow(/bytes/)
  await expect(help({})).rejects.toThrow(/Specify/)
  await expect(help({ toolsets: ['unknown'] })).rejects.toThrow(/unavailable/)
})

it('uses current tool metadata and falls back when a configured summary becomes stale', async () => {
  const fingerprint = plugin.metadataFingerprint({ name: 'read_docs', description, parameters, output: { type: 'string' } })
  const { agent, sdk, help, unregister } = await setup({ summaries: [{ name: 'read_docs', fingerprint, text: 'Read approved documents.' }] })
  expect(await sdk()).toContain('Read approved documents.')
  unregister()
  agent.ctx.tools.register({ ...sampleTool('read_docs'), description: 'New documentation.', parameters })
  expect(await sdk()).toContain('New documentation.')
  expect(await sdk()).not.toContain('Read approved documents.')
  expect(JSON.parse(await help({ names: ['read_docs'] }) as string).tools[0].description).toBe('New documentation.')
})

it('unload releases only the documentation tool and presentation listener', async () => {
  const { ctx, agent, fiber, sdk } = await setup()
  await fiber.dispose()
  expect(ctx.tools.get('tool_help', agent)).toBeUndefined()
  expect(ctx.tools.get('read_docs', agent)).toBeDefined()
  expect(await sdk()).toContain('documentPath')
})

it('rejects a scoped shadow of the help entry instead of advertising a different implementation', async () => {
  const { agent, sdk } = await setup()
  agent.ctx.tools.register(sampleTool('tool_help'))
  await expect(sdk()).rejects.toThrow(/tool_help/)
})
