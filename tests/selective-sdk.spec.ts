import { afterEach, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as plugin from '../src/tool-docs.ts'
import { environment, sampleTool } from './helpers.ts'

let ctx: Context | undefined
afterEach(async()=>{ await ctx?.fiber.dispose(); ctx=undefined })

it('only defers large arguments and always retains canonical return types',async()=>{
  const env=await environment();ctx=env.ctx
  ctx.provide('ptcRuntime',{language:'typescript',isolation:'test',run:async()=>({logs:[]})} as never)
  const small={type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false}
  const large={type:'object',properties:{longOptions:{type:'string',description:'many options '.repeat(100)}},required:['longOptions']}
  const output={schema:{type:'object' as const,properties:{content:{type:'array' as const,items:{}},structuredContent:{}},required:['content'],additionalProperties:false},render:()=>[]}
  ctx.tools.register({...sampleTool('small'),parameters:small,output})
  ctx.tools.register({...sampleTool('large'),parameters:large,output})
  await ctx.plugin(plugin,{presentation:'selective',deferSchemaBytes:1024} as never)
  const agent=await env.harness.create(SessionId(crypto.randomUUID()));agent.ctx.tools.presentAs('ptc')
  const sdk=async()=>(await ctx!.systemPrompt.assemble({scope:agent})).sections.find(s=>s.name==='tools:sdk')!.text
  const before=await sdk()
  expect(before).toContain('path: string')
  // The revised selective contract exposes top-level types, not long metadata.
  expect(before).toContain('longOptions: string')
  expect(before).toContain('structuredContent')
  expect(before).toContain('Parameters deferred')
  const docs=JSON.parse(await ctx.tools.get('tool_help',agent)!.execute({names:['large']},{agent} as never) as string)
  expect(docs.tools[0].parameters).toEqual(large)
  expect(await sdk()).toBe(before)
})
