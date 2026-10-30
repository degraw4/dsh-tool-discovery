import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
export const name='tool-docs-preflight'
export const inject=['agents','tools','systemPrompt']
export function apply(ctx,config) {
  ctx.on('llm/stream',()=>{throw new Error('Preflight forbids model requests')})
  void run().catch(error=>{console.error(String(error));ctx.get('appExit')(1)})
  async function run() {
    await ctx.get('loader')?.await()
    const agent=(await ctx.agents.create({sessionId:'preflight-'+crypto.randomUUID(),meta:{cwd:config.work},
      agentOptions:{provider:'deepseek-official',model:'deepseek-flash'},setup(c){c.tools.presentAs('ptc')}})).agent
    const sdk=async()=>(await ctx.systemPrompt.assemble({scope:agent})).sections.find(x=>x.name==='tools:sdk').text
    const before=await sdk()
    assert.equal(ctx.tools.schemas(agent).filter(t=>t.name!=='run_code').length,79)
    assert.equal((before.match(/Parameters deferred:/g)||[]).length,config.arm==='selective'?9:0)
    const execute=async code=>{
      const result=await ctx.tools.execute({agent,callId:crypto.randomUUID(),name:'run_code',arguments:{description:'Offline benchmark capability check',code},signal:new AbortController().signal})
      if(result.isError)throw new Error(JSON.stringify(result.content));return result
    }
    await execute(await readFile(config.reference,'utf8'))
    const result=await execute(`
      const assert=(await import('node:assert/strict')).default;
      const fs=await import('node:fs/promises');
      const help=JSON.parse(await tools.tool_help({names:['mcp__excel__create_chart']}));
      assert.equal(help.tools[0].name,'mcp__excel__create_chart');
      await tools.mcp__filesystem__write_file({path:'cross-check.txt',content:'verified'});
      assert.equal(await fs.readFile('cross-check.txt','utf8'),'verified');
      let outsideReadable=true;try{await fs.access(${JSON.stringify(config.forbidden)})}catch{outsideReadable=false}
      assert.equal(outsideReadable,false);
      return 'real tools, documentation, shared workspace and isolation verified';
    `)
    assert.equal(await sdk(),before)
    await writeFile(config.evidence,JSON.stringify({arm:config.arm,modelCalls:0,tools:78,sdkBytes:Buffer.byteLength(before),result:result.content},null,2)+'\n')
    ctx.get('appExit')(0)
  }
}
