import { afterEach, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as plugin from '../src/tool-docs.ts'
import { environment, sampleTool } from './helpers.ts'

let ctx: Context | undefined
afterEach(async () => { await ctx?.fiber.dispose(); ctx = undefined })
const parameters = {
  type: 'object', additionalProperties: false,
  properties: {
    path: { type: 'string', description: 'A workbook path.' },
    style: { $ref: '#/$defs/Style' },
    rows: { type: 'array', items: { type: 'object', properties: { secretNestedField: { type: 'string' } } } },
    label: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    mode: { type: 'string', enum: Array.from({ length: 100 }, (_, i) => `long_enum_value_${i}`) },
  },
  required: ['path', 'style'],
  $defs: { Style: { type: 'object', properties: { bold: { type: 'boolean' }, longDescriptionField: { type: 'string', description: 'details '.repeat(200) } } } },
}

async function setup(presentation: 'selective' | 'full') {
  const env = await environment(); ctx = env.ctx
  ctx.provide('ptcRuntime', { language: 'typescript', isolation: 'test', run: async () => ({ logs: [] }) } as never)
  const tool = { ...sampleTool('format_sheet'), parameters }
  ctx.tools.register(tool)
  await ctx.plugin(plugin, { presentation })
  const agent = await env.harness.create(SessionId(crypto.randomUUID()))
  agent.ctx.tools.presentAs('ptc')
  const sdk = async () => (await env.ctx.systemPrompt.assemble({ scope: agent })).sections.find(x => x.name === 'tools:sdk')!.text
  return { tool, agent, sdk }
}

it('shows required top-level fields and optional types without expanding large details', async () => {
  const { sdk, tool, agent } = await setup('selective')
  const before = await sdk()
  expect(before).toMatch(/path: string/)
  expect(before).toMatch(/style:/)
  expect(before).not.toMatch(/style\?:/)
  expect(before).toMatch(/rows\?:/)
  expect(before).toMatch(/label\?:.*(?:string.*null|null.*string)/)
  expect(before).toMatch(/mode\?: string/)
  expect(before).not.toContain('long_enum_value_99')
  expect(before).not.toContain('longDescriptionField')
  expect(before).not.toContain('secretNestedField')
  expect(before).toContain('details')
  const docs = JSON.parse(await ctx!.tools.get('tool_help', agent)!.execute({ names: ['format_sheet'] }, { agent } as never) as string)
  expect(docs.tools[0].parameters).toEqual(parameters)
  expect(tool.parameters).toBe(parameters)
  expect(await sdk()).toBe(before)
})

it('retains all parameter details for the full baseline', async () => {
  const { sdk } = await setup('full')
  const text = await sdk()
  expect(text).toContain('longDescriptionField')
  expect(text).toContain('long_enum_value_99')
  expect(text).toContain('secretNestedField')
})
