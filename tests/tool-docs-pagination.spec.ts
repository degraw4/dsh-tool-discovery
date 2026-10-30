import { afterEach, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as plugin from '../src/tool-docs.ts'
import { environment, sampleTool } from './helpers.ts'
let ctx: Context | undefined
afterEach(async()=>{await ctx?.fiber.dispose();ctx=undefined})
async function setup(config: object={}) {
 const env=await environment();ctx=env.ctx
 ctx.provide('ptcRuntime',{language:'typescript',isolation:'test',run:async()=>({logs:[]})} as never)
 const removals=new Map<string,()=>unknown>()
 for(const name of ['alpha','beta','gamma'])removals.set(name,ctx.tools.register(sampleTool(name)))
 await ctx.plugin(plugin,{maxToolsPerQuery:2,toolsets:[{name:'docs',description:'Document tools',tools:['alpha','beta','gamma']}],...config})
 const agent=await env.harness.create(SessionId(crypto.randomUUID()));agent.ctx.tools.presentAs('ptc')
 const help=async(args:object)=>JSON.parse(await ctx!.tools.get('tool_help',agent)!.execute(args,{agent} as never) as string)
 const sdk=async()=>(await ctx!.systemPrompt.assemble({scope:agent})).sections.find(s=>s.name==='tools:sdk')!.text
 return {agent,help,removals,sdk}
}
it('reads an oversized group in complete bounded pages without changing SDK or executing targets',async()=>{
 const {help,sdk}=await setup();const before=await sdk()
 const first=await help({toolsets:['docs']});expect(first.tools.map((t:any)=>t.name)).toEqual(['alpha','beta']);expect(first.matchedCount).toBe(3)
 const second=await help(first.nextQuery);expect(second.tools.map((t:any)=>t.name)).toEqual(['gamma']);expect(second.nextQuery).toBeNull()
 expect(second.tools[0].parameters.properties.path.type).toBe('string');expect(await sdk()).toBe(before)
})
it('refuses to continue after scoped metadata changes rather than skipping or mixing versions',async()=>{
 const {help,removals}=await setup();const first=await help({toolsets:['docs']})
 removals.get('gamma')!();ctx!.tools.register({...sampleTool('gamma'),description:'Replaced documentation'})
 await expect(help(first.nextQuery)).rejects.toThrow(/changed|restart/i)
})
it('never returns hidden names in a page or continuation',async()=>{
 const {help,agent}=await setup();agent.ctx.tools.restrict({allow:['alpha','gamma','tool_help']})
 const page=await help({toolsets:['docs']});expect(page.tools.map((t:any)=>t.name)).toEqual(['alpha','gamma']);expect(page.nextQuery).toBeNull()
 await expect(help({names:['beta']})).rejects.toThrow(/unavailable/)
})
it('budgets serialized whole response bytes and leaves individual schemas intact',async()=>{
 const {help,removals}=await setup({maxDocumentBytes:1400})
 for(const name of ['alpha','beta']){removals.get(name)!();ctx!.tools.register({...sampleTool(name),description:'detail '.repeat(100)})}
 const first=await help({names:['alpha','beta']});expect(first.tools).toHaveLength(1);expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThanOrEqual(1400)
 expect(first.tools[0].description).toBe('detail '.repeat(100));const last=await help(first.nextQuery);expect(last.tools).toHaveLength(1);expect(last.nextQuery).toBeNull()
})
it('requires snapshot-bound continuation and rejects out-of-range offsets',async()=>{
 const {help}=await setup();await expect(help({names:['alpha'],offset:1})).rejects.toThrow(/snapshot|continuation/i)
 const first=await help({toolsets:['docs']});await expect(help({...first.nextQuery,offset:99})).rejects.toThrow(/offset|range/i)
})
it('can finish a selection when the final response fits but a continuation envelope would not',async()=>{
 const longGroup='g'.repeat(1000)
 const {help}=await setup({maxDocumentBytes:1024,toolsets:[{name:longGroup,description:'Two small tools',tools:['alpha','beta']}]})
 const page=await help({toolsets:[longGroup]})
 expect(page.tools.map((t:any)=>t.name)).toEqual(['alpha','beta']);expect(page.nextQuery).toBeNull();expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(1024)
})
